import fs from "node:fs/promises";
import path from "node:path";

const STATE_PATH = process.env.FINAL_LOCK_STATE_PATH || ".cache/final_trend_lock_notification_state.json";
const NTFY_TOPIC = String(process.env.NTFY_TOPIC || "").trim();
const CLICK_URL = String(process.env.FINAL_LOCK_CLICK_URL || "https://ezpzpicks.com").trim();
const MAX_MESSAGE_LENGTH = 3500;

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

function aiPickKey(pick) {
  return String(
    pick?.candidateId ||
      [pick?.date, pick?.gameKey, pick?.market, pick?.selection, pick?.line].map(textKey).join("|"),
  ).trim();
}

// IMPORTANT: This intentionally matches the state the public site presents as a
// finalized AI pick. The notification must not depend on a second hidden review
// status after the pick is already Selected + PASSED + FINAL_PREGAME.
function finalAiPicks(payload, today) {
  return (Array.isArray(payload?.aiPicks) ? payload.aiPicks : [])
    .filter((pick) => String(pick?.date || "").trim() === String(today || "").trim())
    .filter((pick) => pick?.selected === true)
    .filter((pick) => pick?.protectionStatus === "PASSED")
    .filter((pick) => pick?.snapshotStatus === "FINAL_PREGAME");
}

function pct(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `${number.toFixed(number % 1 ? 1 : 0)}%`;
}

function scoreText(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toFixed(number % 1 ? 1 : 0);
}

function odds(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "—";
  if (/^\d{3,4}$/.test(raw)) return `+${raw}`;
  return raw.replace(/−/g, "-");
}

function compactList(value, limit = 2) {
  const items = Array.isArray(value) ? value : [];
  return items.map((item) => String(item || "").trim()).filter(Boolean).slice(0, limit);
}

function trimMessage(message) {
  const raw = String(message || "");
  if (raw.length <= MAX_MESSAGE_LENGTH) return raw;
  return `${raw.slice(0, MAX_MESSAGE_LENGTH - 28).trimEnd()}\n…open EZPZ for full details`;
}

function buildAiPickNotification(pick) {
  const game = pick?.game || `${pick?.awayTeam || "Away"} at ${pick?.homeTeam || "Home"}`;
  const key = timeKey(pick?.gameTime);
  let displayTime = "";
  if (key) {
    const [hour24, minute] = key.split(":").map(Number);
    const suffix = hour24 >= 12 ? "PM" : "AM";
    const hour = hour24 % 12 || 12;
    displayTime = `${hour}:${String(minute).padStart(2, "0")} ${suffix} ET`;
  }

  const lines = [
    displayTime ? `${game} • ${displayTime}` : game,
    `${pick?.play || pick?.selection || "AI Pick"}${pick?.odds ? ` • ${odds(pick.odds)}` : ""}`,
    `AI Score ${scoreText(pick?.aiScore)} | Est. ${pct(pick?.estimatedProbability)} | Advantage ${pct(pick?.estimatedAdvantage)}`,
  ];

  const sourceParts = [pick?.source, pick?.bestPlayType, pick?.trendTier]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (sourceParts.length) lines.push(`Source: ${sourceParts.join(" • ")}`);

  const why = compactList(pick?.whySelected, 2);
  if (why.length) {
    lines.push("", "WHY IT MADE THE CUT");
    for (const item of why) lines.push(`• ${item}`);
  }

  const verdict = String(pick?.verdict || "").trim();
  if (verdict) lines.push("", `Final verdict: ${verdict}`);

  return {
    title: `EZPZ AI Pick Final — ${pick?.play || game}`,
    message: lines.join("\n"),
    priority: 5,
    tags: ["robot", "white_check_mark"],
  };
}

async function publishNtfy(notification) {
  if (!NTFY_TOPIC) throw new Error("NTFY_TOPIC repository secret is missing or empty");
  const response = await fetch("https://ntfy.sh/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topic: NTFY_TOPIC,
      title: notification.title,
      message: trimMessage(notification.message),
      priority: notification.priority,
      tags: notification.tags,
      click: CLICK_URL || undefined,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`ntfy returned HTTP ${response.status} ${response.statusText}`);
}

async function readState(today) {
  try {
    const parsed = JSON.parse(await fs.readFile(STATE_PATH, "utf8"));
    if (parsed?.version === 2 && parsed?.date === today) {
      return {
        version: 2,
        date: today,
        gameLocks: parsed.gameLocks || {},
        aiPicks: parsed.aiPicks || {},
        updatedAt: parsed.updatedAt || "",
      };
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return { version: 2, date: today, gameLocks: {}, aiPicks: {}, updatedAt: "" };
}

async function writeState(state) {
  await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
  const temporary = `${STATE_PATH}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await fs.rename(temporary, STATE_PATH);
}

function logAiPickStates(payload, today) {
  const picks = Array.isArray(payload?.aiPicks) ? payload.aiPicks : [];
  console.log(`AI notification scan: ${picks.length} total aiPicks in payload; today=${today}.`);
  for (const pick of picks) {
    console.log(
      `AI state | ${pick?.game || "unknown game"} | ${pick?.play || pick?.selection || "unknown pick"}` +
        ` | date=${pick?.date || ""}` +
        ` | selected=${String(pick?.selected)}` +
        ` | protection=${pick?.protectionStatus || ""}` +
        ` | snapshot=${pick?.snapshotStatus || ""}` +
        ` | review=${pick?.externalReviewStatus || ""}`,
    );
  }
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) throw new Error("Usage: node scripts/ai_final_notifications.mjs <public-data.json>");

  const payload = JSON.parse(await fs.readFile(inputPath, "utf8"));
  if (!payload?.ok) throw new Error(`Public-data capture failed: ${payload?.error || "unknown error"}`);

  const today = String(payload.today || "").trim();
  if (!today) throw new Error("Public-data response did not include today's date");

  logAiPickStates(payload, today);

  const state = await readState(today);
  let sent = 0;
  let alreadySent = 0;
  const finalPicks = finalAiPicks(payload, today);
  console.log(`AI notification scan: ${finalPicks.length} pick(s) match visible Final state.`);

  for (const pick of finalPicks) {
    const key = aiPickKey(pick);
    const existing = state.aiPicks[key];
    if (existing?.sentAt) {
      alreadySent += 1;
      console.log(`AI notification already sent: ${pick?.game || ""} | ${pick?.play || pick?.selection || ""}`);
      continue;
    }

    // Same-day visible Final picks are always eligible for backfill. We do not
    // use game time as a notification gate; sentAt is the sole duplicate guard.
    await publishNtfy(buildAiPickNotification(pick));
    state.aiPicks[key] = {
      sentAt: new Date().toISOString(),
      game: pick.game || "",
      play: pick.play || "",
      gameTime: timeKey(pick.gameTime),
      triggeredBy: "AI_VISIBLE_FINAL",
      externalReviewStatus: pick.externalReviewStatus || "",
      recoveredFromSeed: Boolean(existing?.seededAt),
    };
    state.updatedAt = new Date().toISOString();
    await writeState(state);
    sent += 1;
    console.log(`AI notification sent: ${pick?.game || ""} | ${pick?.play || pick?.selection || ""}`);
  }

  state.updatedAt = new Date().toISOString();
  await writeState(state);
  console.log(`AI-final notifier complete: ${sent} sent / ${alreadySent} already sent.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
