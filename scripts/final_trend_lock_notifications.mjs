import fs from "node:fs/promises";
import path from "node:path";

const STATE_PATH =
  process.env.FINAL_LOCK_STATE_PATH || ".cache/final_trend_lock_notification_state.json";
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
  return dayDeltaMinutes + hour * 60 + minute - (nowParts.hour * 60 + nowParts.minute);
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

function sameGame(item, reference) {
  if (!item || !reference) return false;
  const awayMatch = textKey(item.awayTeam) && textKey(item.awayTeam) === textKey(reference.awayTeam);
  const homeMatch = textKey(item.homeTeam) && textKey(item.homeTeam) === textKey(reference.homeTeam);
  if (awayMatch && homeMatch) {
    const itemTime = timeKey(item.gameTime || item.eventTime || item.recordGameTime || "");
    const refTime = timeKey(reference.eventTime || reference.gameTime || "");
    return !itemTime || !refTime || itemTime === refTime;
  }
  return textKey(item.game) && textKey(item.game) === textKey(reference.game);
}

function finalTrendPlaysForGame(payload, reference) {
  return (Array.isArray(payload?.trendPlays) ? payload.trendPlays : [])
    .filter((play) => sameGame(play, reference))
    .filter((play) => play?.snapshotStatus === "FINAL_PREGAME")
    .filter((play) => String(play?.tier || "").toLowerCase() !== "pass")
    .sort((a, b) => Number(b?.score || 0) - Number(a?.score || 0));
}

function bestPlaysForGame(payload, reference) {
  return (Array.isArray(payload?.bestPlays) ? payload.bestPlays : [])
    .filter((play) => sameGame(play, reference))
    .sort((a, b) => Number(b?.score || 0) - Number(a?.score || 0));
}

function trendPlaySummary(play) {
  const market = String(play?.market || "").trim();
  const selection = market === "Total"
    ? `${play?.side || play?.selection || "Total"} ${play?.line ?? ""}`.trim()
    : `${play?.selectionTeam || play?.selection || "Moneyline"} ML`.trim();
  return `${play?.tier || "Trend"} ${scoreText(play?.score)} • ${selection}${play?.odds ? ` ${odds(play.odds)}` : ""}`;
}

function bestPlaySummary(play) {
  const label = String(play?.play || play?.playType || "Best Play").trim();
  const type = String(play?.playType || "Best Play").trim();
  const score = Number.isFinite(Number(play?.score)) ? ` • Score ${scoreText(play.score)}` : "";
  const price = String(play?.oddsLine || "").trim() ? ` • ${play.oddsLine}` : "";
  return `${type}: ${label}${score}${price}`;
}

function trimMessage(message) {
  const raw = String(message || "");
  if (raw.length <= MAX_MESSAGE_LENGTH) return raw;
  return `${raw.slice(0, MAX_MESSAGE_LENGTH - 28).trimEnd()}\n…open EZPZ for full details`;
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
    if (parsed?.version === 1 && parsed?.date === today && parsed?.sent) {
      return {
        version: 2,
        date: today,
        gameLocks: parsed.sent,
        aiPicks: {},
        updatedAt: parsed.updatedAt || "",
      };
    }
  } catch (error) {
    if (error?.code !== "ENOENT") console.warn(`Ignoring unreadable final-lock state: ${error.message || error}`);
  }
  return { version: 2, date: today, gameLocks: {}, aiPicks: {}, updatedAt: "" };
}

async function writeState(state) {
  await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
  const temporary = `${STATE_PATH}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await fs.rename(temporary, STATE_PATH);
}

async function publishNtfy({ title, message, priority = 3, tags = [] }) {
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
          message: trimMessage(message),
          priority,
          tags,
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

function buildGameLockNotification(group, payload) {
  const rows = [...group].sort((a, b) => {
    const marketOrder = (a.market === "Moneyline" ? 0 : 1) - (b.market === "Moneyline" ? 0 : 1);
    if (marketOrder) return marketOrder;
    return String(a.selection || a.side || "").localeCompare(String(b.selection || b.side || ""));
  });
  const first = rows[0] || {};
  const game = first.game || `${first.awayTeam || "Away"} at ${first.homeTeam || "Home"}`;
  const eventTime = formatTime12(first.eventTime);
  const lines = [eventTime ? `${game} • ${eventTime}` : game, "", "FINAL MARKET"];
  let currentMarket = "";
  for (const row of rows) {
    if (row.market !== currentMarket) {
      currentMarket = row.market;
      lines.push(currentMarket === "Moneyline" ? "Moneyline" : "Total");
    }
    lines.push(`• ${splitSummary(row)}`);
  }

  const trends = finalTrendPlaysForGame(payload, first);
  if (trends.length) {
    lines.push("", "FINAL TREND PLAYS");
    for (const play of trends) lines.push(`• ${trendPlaySummary(play)}`);
  }

  const bestPlays = bestPlaysForGame(payload, first);
  if (bestPlays.length) {
    lines.push("", "BEST PLAYS");
    for (const play of bestPlays) lines.push(`• ${bestPlaySummary(play)}`);
  }

  return {
    title: `EZPZ Final Lock — ${game}`,
    message: lines.join("\n"),
    priority: 4,
    tags: ["lock", "chart_with_upwards_trend"],
  };
}

function finalAiPicks(payload, today) {
  return (Array.isArray(payload?.aiPicks) ? payload.aiPicks : [])
    .filter((pick) => String(pick?.date || "").trim() === String(today || "").trim())
    .filter((pick) => pick?.selected === true)
    .filter((pick) => pick?.protectionStatus === "PASSED")
    .filter((pick) => pick?.snapshotStatus === "FINAL_PREGAME")
    .filter((pick) => pick?.externalReviewStatus === "WEB_REVIEWED")
    .sort((a, b) => String(a?.gameTime || "").localeCompare(String(b?.gameTime || "")));
}

function aiPickKey(pick) {
  return String(pick?.candidateId || [pick?.date, pick?.gameKey, pick?.market, pick?.selection, pick?.line].map(textKey).join("|")).trim();
}

function compactList(value, limit = 2) {
  const items = Array.isArray(value) ? value : [];
  return items.map((item) => String(item || "").trim()).filter(Boolean).slice(0, limit);
}

function buildAiPickNotification(pick) {
  const game = pick?.game || `${pick?.awayTeam || "Away"} at ${pick?.homeTeam || "Home"}`;
  const time = formatTime12(pick?.gameTime);
  const lines = [
    time ? `${game} • ${time}` : game,
    `${pick?.play || pick?.selection || "AI Pick"}${pick?.odds ? ` • ${odds(pick.odds)}` : ""}`,
    `AI Score ${scoreText(pick?.aiScore)} | Est. ${pct(pick?.estimatedProbability)} | Advantage ${pct(pick?.estimatedAdvantage)}`,
  ];

  const sourceParts = [pick?.source, pick?.bestPlayType, pick?.trendTier].map((value) => String(value || "").trim()).filter(Boolean);
  if (sourceParts.length) lines.push(`Source: ${sourceParts.join(" • ")}`);

  const why = compactList(pick?.whySelected, 2);
  if (why.length) {
    lines.push("", "WHY IT MADE THE CUT");
    for (const item of why) lines.push(`• ${item}`);
  }

  const research = String(pick?.researchSummary || "").trim();
  if (research) lines.push("", `Research: ${research}`);

  const historical = compactList(pick?.historicalNotes, 1);
  if (historical.length) lines.push(`History: ${historical[0]}`);

  const risks = compactList(pick?.risks, 1);
  if (risks.length) lines.push(`Risk: ${risks[0]}`);

  const verdict = String(pick?.verdict || "").trim();
  if (verdict) lines.push("", `Final verdict: ${verdict}`);

  return {
    title: `EZPZ AI Pick Final — ${pick?.play || game}`,
    message: lines.join("\n"),
    priority: 5,
    tags: ["robot", "white_check_mark"],
  };
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
          betsPct: 68,
          moneyPct: 74,
          openingBetsPct: 55,
          openingMoneyPct: 60,
          lineMovementSignal: "Reverse Line Movement Against",
          snapshotStatus: "FINAL_PREGAME",
        },
      ],
    },
    trendPlays: [
      {
        game: "St. Louis Cardinals at Cincinnati Reds",
        awayTeam: "St. Louis Cardinals",
        homeTeam: "Cincinnati Reds",
        market: "Total",
        selection: "Over",
        side: "Over",
        line: 9,
        odds: "-118",
        score: 91,
        tier: "Elite",
        snapshotStatus: "FINAL_PREGAME",
      },
    ],
    bestPlays: [
      {
        game: "St. Louis Cardinals at Cincinnati Reds",
        awayTeam: "St. Louis Cardinals",
        homeTeam: "Cincinnati Reds",
        playType: "Strong Total Over",
        play: "Over 9",
        oddsLine: "-118",
        score: 88,
      },
    ],
    aiPicks: [
      {
        date: "2026-08-17",
        candidateId: "test-ai-pick",
        gameKey: "123",
        gameTime: "18:40",
        game: "St. Louis Cardinals at Cincinnati Reds",
        awayTeam: "St. Louis Cardinals",
        homeTeam: "Cincinnati Reds",
        market: "Total",
        play: "Over 9",
        selection: "Over",
        line: "9",
        odds: "-118",
        source: "Best + Trend",
        bestPlayType: "Strong Total Over",
        trendTier: "Elite",
        aiScore: 92,
        estimatedProbability: 61.2,
        estimatedAdvantage: 7.1,
        selected: true,
        protectionStatus: "PASSED",
        snapshotStatus: "FINAL_PREGAME",
        externalReviewStatus: "WEB_REVIEWED",
        whySelected: ["Model and final market agree", "Trend history remains strong"],
        researchSummary: "Starting pitching and bullpen context support the over.",
        historicalNotes: ["Matchup history is supportive."],
        risks: ["Late lineup scratch."],
        verdict: "Approved as a final AI pick.",
      },
    ],
  };

  const groups = finalGroups(payload);
  if (groups.size !== 1) throw new Error(`Self-test expected one final group, got ${groups.size}`);
  const group = [...groups.values()][0];
  const notification = buildGameLockNotification(group, payload);
  if (!notification.message.includes("9.5 +100 → 9 -118")) throw new Error("Self-test opening/final total formatting failed");
  if (!notification.message.includes("FINAL TREND PLAYS")) throw new Error("Self-test trend section missing");
  if (!notification.message.includes("BEST PLAYS")) throw new Error("Self-test best-play section missing");
  const ai = finalAiPicks(payload, payload.today);
  if (ai.length !== 1) throw new Error(`Self-test expected one final AI pick, got ${ai.length}`);
  const aiNotification = buildAiPickNotification(ai[0]);
  if (!aiNotification.message.includes("AI Score 92")) throw new Error("Self-test AI score formatting failed");
  if (!aiNotification.message.includes("Final verdict")) throw new Error("Self-test AI verdict missing");
  const keyA = groupKey(payload.draftKings.splits[0]);
  const keyB = groupKey({ ...payload.draftKings.splits[0], eventTime: "13:40" });
  if (keyA === keyB) throw new Error("Self-test doubleheader grouping collision");
  console.log("Final lock + AI notifier self-test passed.");
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
  let gameLocksSent = 0;
  let gameLocksAlreadySent = 0;
  let gameLocksSeeded = 0;
  let aiPicksSent = 0;
  let aiPicksAlreadySent = 0;
  let aiPicksSeeded = 0;

  for (const [key, group] of groups) {
    if (state.gameLocks[key]) {
      gameLocksAlreadySent += 1;
      continue;
    }
    const first = group[0] || {};
    const minutes = minutesFromNowEt(first.date || today, first.eventTime);

    if (minutes == null || minutes < -5) {
      state.gameLocks[key] = { seededAt: new Date().toISOString(), reason: "historical final lock" };
      gameLocksSeeded += 1;
      continue;
    }
    if (minutes > 35) continue;

    const notification = buildGameLockNotification(group, payload);
    await publishNtfy(notification);
    state.gameLocks[key] = {
      sentAt: new Date().toISOString(),
      game: first.game || "",
      eventTime: timeKey(first.eventTime),
    };
    state.updatedAt = new Date().toISOString();
    await writeState(state);
    gameLocksSent += 1;
  }

  for (const pick of finalAiPicks(payload, today)) {
    const key = aiPickKey(pick);
    if (state.aiPicks[key]) {
      aiPicksAlreadySent += 1;
      continue;
    }
    const minutes = minutesFromNowEt(pick.date || today, pick.gameTime);
    if (minutes == null || minutes < -5) {
      state.aiPicks[key] = { seededAt: new Date().toISOString(), reason: "historical final AI pick" };
      aiPicksSeeded += 1;
      continue;
    }
    if (minutes > 35) continue;

    const notification = buildAiPickNotification(pick);
    await publishNtfy(notification);
    state.aiPicks[key] = {
      sentAt: new Date().toISOString(),
      game: pick.game || "",
      play: pick.play || "",
      gameTime: timeKey(pick.gameTime),
    };
    state.updatedAt = new Date().toISOString();
    await writeState(state);
    aiPicksSent += 1;
  }

  state.updatedAt = new Date().toISOString();
  await writeState(state);
  console.log(
    `Final notifier complete: ${groups.size} final game(s); game locks ${gameLocksSent} sent / ${gameLocksAlreadySent} already announced / ${gameLocksSeeded} seeded; AI picks ${aiPicksSent} sent / ${aiPicksAlreadySent} already announced / ${aiPicksSeeded} seeded.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
