from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


route_path = Path("app/api/public-data/route.ts")
route = route_path.read_text()

old_tracking = '''    const trackingTrendSplits = availableSplits.filter((item) => {
      const key = `${isoPublicDate(item.date)}|${normalizeTeam(item.awayTeam)}|${normalizeTeam(
        item.homeTeam,
      )}`;
      return (
        trackingGameKeys.has(key) &&
        (item.market === "Moneyline" || item.market === "Total")
      );
    });'''
new_tracking = '''    const trackingTrendSplits = availableSplits.filter((item) => {
      const key = draftKingsMarketInstanceKey(item);
      return (
        trackingGameKeys.has(key) &&
        (item.market === "Moneyline" || item.market === "Total")
      );
    });'''
route = replace_once(route, old_tracking, new_tracking, "tracking trend split key")

old_saved = '''    const savedFinalGameKeys = new Set(
      savedFinalPayload.splits.map(
        (split) =>
          `${isoPublicDate(split.date)}|${normalizeTeam(split.awayTeam)}|${normalizeTeam(
            split.homeTeam,
          )}`,
      ),
    );'''
new_saved = '''    const savedFinalGameKeys = new Set(
      savedFinalPayload.splits.map((split) => draftKingsMarketInstanceKey(split)),
    );'''
route = replace_once(route, old_saved, new_saved, "saved final game key")
route_path.write_text(route)

workflow = '''name: EZPZ DraftKings True RLM Snapshots

on:
  schedule:
    # Four checks per hour run all day so the new MLB slate is initialized just
    # after midnight ET, then the market baseline stays current until first pitch.
    # The API separately locks one official snapshot 7-23 minutes before first pitch.
    - cron: "2,17,32,47 0-23 * * *"
      timezone: "America/New_York"
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: ezpz-draftkings-true-rlm-snapshots
  cancel-in-progress: false

jobs:
  capture:
    runs-on: ubuntu-latest
    timeout-minutes: 4
    steps:
      - uses: actions/checkout@v4

      - name: Restore final-lock notification state
        uses: actions/cache/restore@v4
        with:
          path: .cache/final_trend_lock_notification_state.json
          key: final-trend-lock-notifications-${{ github.run_id }}
          restore-keys: |
            final-trend-lock-notifications-

      - name: Initialize MLB slate, refresh DraftKings baseline, and lock eligible pregame snapshots
        env:
          CRON_SECRET: ${{ secrets.CRON_SECRET }}
        run: |
          test -n "$CRON_SECRET" || { echo "Missing repository secret: CRON_SECRET"; exit 1; }
          curl --fail-with-body \
            --silent \
            --show-error \
            --retry 2 \
            --retry-delay 10 \
            --max-time 75 \
            -H "Authorization: Bearer $CRON_SECRET" \
            --output /tmp/ezpz_public_data.json \
            "https://ezpzpicks.com/api/public-data?scheduled=1&tracking=15m"

      - name: Send newly locked trend snapshots to ntfy
        env:
          NTFY_TOPIC: ${{ secrets.NTFY_TOPIC }}
          FINAL_LOCK_CLICK_URL: https://ezpzpicks.com
        run: node scripts/final_trend_lock_notifications.mjs /tmp/ezpz_public_data.json

      - name: Save final-lock notification state
        if: always()
        uses: actions/cache/save@v4
        with:
          path: .cache/final_trend_lock_notification_state.json
          key: final-trend-lock-notifications-${{ github.run_id }}
'''
Path(".github/workflows/draftkings_snapshot.yml").write_text(workflow)

notifier = r'''import fs from "node:fs/promises";
import path from "node:path";

const STATE_PATH =
  process.env.FINAL_LOCK_STATE_PATH || ".cache/final_trend_lock_notification_state.json";
const NTFY_TOPIC = String(process.env.NTFY_TOPIC || "").trim();
const CLICK_URL = String(process.env.FINAL_LOCK_CLICK_URL || "https://ezpzpicks.com").trim();

function textKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function timeKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const meridiem = raw.match(/(?:^|[,\s])(\d{1,2})(?::(\d{2}))\s*(AM|PM)\b/i);
  if (meridiem) {
    let hour = Number(meridiem[1]) % 12;
    if (meridiem[3].toUpperCase() === "PM") hour += 12;
    return `${String(hour).padStart(2, "0")}:${String(Number(meridiem[2] || 0)).padStart(2, "0")}`;
  }
  const clock24 = raw.match(/(?:^|[,T\s])([01]?\d|2[0-3]):([0-5]\d)(?::\d{2})?(?:\s*(?:ET|EST|EDT))?\s*$/i);
  if (clock24) return `${String(Number(clock24[1])).padStart(2, "0")}:${clock24[2]}`;
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(parsed);
    const hour = parts.find((part) => part.type === "hour")?.value || "";
    const minute = parts.find((part) => part.type === "minute")?.value || "";
    if (hour && minute) return `${hour}:${minute}`;
  }
  return "";
}

function groupKey(split) {
  return [
    String(split.date || "").trim(),
    textKey(split.awayTeam),
    textKey(split.homeTeam),
    timeKey(split.eventTime),
  ].join("|");
}

function currentEasternParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

function minutesFromNowEt(dateIso, eventTime, now = new Date()) {
  const time = timeKey(eventTime);
  const match = String(dateIso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!time || !match) return null;
  const [hour, minute] = time.split(":").map(Number);
  const nowParts = currentEasternParts(now);
  const targetDay = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const nowDay = Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day);
  const dayDeltaMinutes = (targetDay - nowDay) / 60000;
  const targetClock = hour * 60 + minute;
  const nowClock = nowParts.hour * 60 + nowParts.minute;
  return dayDeltaMinutes + targetClock - nowClock;
}

function pct(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `${number.toFixed(number % 1 ? 1 : 0)}%`;
}

function odds(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "—";
  if (/^\d{3,4}$/.test(raw)) return `+${raw}`;
  return raw.replace(/−/g, "-");
}

function numberText(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return String(number);
}

function movementShort(value) {
  const label = String(value || "").trim();
  const map = new Map([
    ["Strong Reverse Line Movement Support", "Strong RLM Support"],
    ["Reverse Line Movement Support", "RLM Support"],
    ["Strong Reverse Line Movement Against", "Strong RLM Against"],
    ["Reverse Line Movement Against", "RLM Against"],
    ["Line Movement Confirmation", "Confirmation"],
    ["Adverse Line Movement", "Adverse"],
  ]);
  return map.get(label) || label || "No meaningful move";
}

function splitSummary(split) {
  const openBets = split.openingBetsPct ?? split.betsPct;
  const openHandle = split.openingMoneyPct ?? split.moneyPct;
  const movement = movementShort(split.lineMovementSignal);
  if (split.market === "Total") {
    const side = split.side || (String(split.selection || "").toLowerCase().startsWith("under") ? "Under" : "Over");
    const openLine = split.openingLine ?? split.line;
    const openOdds = split.openingOdds || split.odds;
    return `${side}: ${numberText(openLine)} ${odds(openOdds)} → ${numberText(split.line)} ${odds(split.odds)} | Bets ${pct(openBets)}→${pct(split.betsPct)} | Handle ${pct(openHandle)}→${pct(split.moneyPct)} | ${movement}`;
  }
  const selection = split.selectionTeam || split.selection || "Moneyline";
  const openOdds = split.openingOdds || split.odds;
  return `${selection} ML: ${odds(openOdds)} → ${odds(split.odds)} | Bets ${pct(openBets)}→${pct(split.betsPct)} | Handle ${pct(openHandle)}→${pct(split.moneyPct)} | ${movement}`;
}

function formatTime12(eventTime) {
  const key = timeKey(eventTime);
  if (!key) return "";
  const [hour24, minute] = key.split(":").map(Number);
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour = hour24 % 12 || 12;
  return `${hour}:${String(minute).padStart(2, "0")} ${suffix} ET`;
}

function finalGroups(payload) {
  const splits = Array.isArray(payload?.draftKings?.splits) ? payload.draftKings.splits : [];
  const groups = new Map();
  for (const split of splits) {
    if (split?.snapshotStatus !== "FINAL_PREGAME") continue;
    if (split?.market !== "Moneyline" && split?.market !== "Total") continue;
    const key = groupKey(split);
    const existing = groups.get(key) || [];
    existing.push(split);
    groups.set(key, existing);
  }
  return groups;
}

async function readState(today) {
  try {
    const parsed = JSON.parse(await fs.readFile(STATE_PATH, "utf8"));
    if (parsed?.version === 1 && parsed?.date === today && parsed?.sent) return parsed;
  } catch (error) {
    if (error?.code !== "ENOENT") console.warn(`Ignoring unreadable final-lock state: ${error.message || error}`);
  }
  return { version: 1, date: today, sent: {}, updatedAt: "" };
}

async function writeState(state) {
  await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
  const temporary = `${STATE_PATH}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await fs.rename(temporary, STATE_PATH);
}

async function publishNtfy(title, message) {
  if (!NTFY_TOPIC) throw new Error("NTFY_TOPIC repository secret is missing or empty");
  if (!/^[-_A-Za-z0-9]{1,64}$/.test(NTFY_TOPIC)) {
    throw new Error("NTFY_TOPIC contains invalid characters or is longer than 64 characters");
  }
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch("https://ntfy.sh/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: NTFY_TOPIC,
          title,
          message,
          priority: 3,
          tags: ["lock", "chart_with_upwards_trend"],
          click: CLICK_URL || undefined,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`ntfy returned HTTP ${response.status} ${response.statusText}`);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  throw lastError || new Error("ntfy publish failed");
}

function buildNotification(group) {
  const rows = [...group].sort((a, b) => {
    const marketOrder = (a.market === "Moneyline" ? 0 : 1) - (b.market === "Moneyline" ? 0 : 1);
    if (marketOrder) return marketOrder;
    return String(a.selection || a.side || "").localeCompare(String(b.selection || b.side || ""));
  });
  const first = rows[0] || {};
  const game = first.game || `${first.awayTeam || "Away"} at ${first.homeTeam || "Home"}`;
  const eventTime = formatTime12(first.eventTime);
  const title = `EZPZ Final Trend Lock — ${game}`;
  const lines = [eventTime ? `${game} • ${eventTime}` : game];
  let currentMarket = "";
  for (const row of rows) {
    if (row.market !== currentMarket) {
      currentMarket = row.market;
      lines.push(currentMarket === "Moneyline" ? "MONEYLINE" : "TOTAL");
    }
    lines.push(splitSummary(row));
  }
  return { title, message: lines.join("\n") };
}

function runSelfTest() {
  const payload = {
    today: "2026-08-17",
    draftKings: {
      splits: [
        {
          date: "2026-08-17",
          eventTime: "18:40",
          game: "St. Louis Cardinals at Cincinnati Reds",
          awayTeam: "St. Louis Cardinals",
          homeTeam: "Cincinnati Reds",
          market: "Total",
          selection: "Over 9",
          side: "Over",
          line: 9,
          odds: "-118",
          openingLine: 9.5,
          openingOdds: "+100",
          betsPct: 100,
          moneyPct: 100,
          openingBetsPct: 55,
          openingMoneyPct: 60,
          lineMovementSignal: "Reverse Line Movement Against",
          snapshotStatus: "FINAL_PREGAME",
        },
      ],
    },
  };
  const groups = finalGroups(payload);
  if (groups.size !== 1) throw new Error(`Self-test expected one final group, got ${groups.size}`);
  const group = [...groups.values()][0];
  const notification = buildNotification(group);
  if (!notification.message.includes("9.5 +100 → 9 -118")) throw new Error("Self-test opening/final total formatting failed");
  if (!notification.message.includes("RLM Against")) throw new Error("Self-test movement formatting failed");
  const keyA = groupKey(payload.draftKings.splits[0]);
  const keyB = groupKey({ ...payload.draftKings.splits[0], eventTime: "13:40" });
  if (keyA === keyB) throw new Error("Self-test doubleheader grouping collision");
  console.log("Final trend lock notifier self-test passed.");
}

async function main() {
  if (process.argv.includes("--self-test")) {
    runSelfTest();
    return;
  }

  const inputPath = process.argv[2];
  if (!inputPath) throw new Error("Usage: node scripts/final_trend_lock_notifications.mjs <public-data.json>");
  const payload = JSON.parse(await fs.readFile(inputPath, "utf8"));
  if (!payload?.ok) throw new Error(`Public-data capture failed: ${payload?.error || "unknown error"}`);
  if (payload?.draftKings?.persistence?.status === "ERROR") {
    throw new Error(`Final-lock persistence failed: ${payload.draftKings.persistence.error || "unknown error"}`);
  }

  const today = String(payload.today || "").trim();
  if (!today) throw new Error("Public-data response did not include today's date");
  const state = await readState(today);
  const groups = finalGroups(payload);
  let sent = 0;
  let alreadySent = 0;
  let seeded = 0;

  for (const [key, group] of groups) {
    if (state.sent[key]) {
      alreadySent += 1;
      continue;
    }
    const first = group[0] || {};
    const minutes = minutesFromNowEt(first.date || today, first.eventTime);

    // When this feature is first enabled mid-slate, silently seed locks that are
    // already well in the past so the phone is not flooded with old games.
    if (minutes == null || minutes < -5) {
      state.sent[key] = { seededAt: new Date().toISOString(), reason: "historical final lock" };
      seeded += 1;
      continue;
    }

    // A genuine final lock should be close to first pitch. If a malformed future
    // snapshot appears much earlier, leave it unsent so a later run can retry.
    if (minutes > 35) continue;

    const notification = buildNotification(group);
    await publishNtfy(notification.title, notification.message);
    state.sent[key] = {
      sentAt: new Date().toISOString(),
      game: first.game || "",
      eventTime: timeKey(first.eventTime),
    };
    state.updatedAt = new Date().toISOString();
    await writeState(state);
    sent += 1;
  }

  state.updatedAt = new Date().toISOString();
  await writeState(state);
  console.log(
    `Final-lock notifier complete: ${groups.size} final game(s), ${sent} sent, ${alreadySent} already announced, ${seeded} historical lock(s) seeded silently.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
'''
Path("scripts/final_trend_lock_notifications.mjs").write_text(notifier)

print("Final-lock notification production patch applied.")
