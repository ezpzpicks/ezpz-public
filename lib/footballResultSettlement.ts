import {
  readSportWorksheet,
  upsertSportRows,
  type FootballSport,
  type SheetRow,
} from "./sportSheets";

type FinalGame = {
  gameId: string;
  date: string;
  awayTeam: string;
  homeTeam: string;
  awayScore: number;
  homeScore: number;
};

type SettlementSummary = {
  sport: FootballSport;
  checkedGames: number;
  resolvedFinals: number;
  settledTrackerRows: number;
  repairedScheduleRows: number;
  pendingTrackerRows: number;
  skipped: boolean;
};

const SETTLEMENT_INTERVAL_MS = 5 * 60_000;
const MAX_PENDING_AGE_DAYS = 45;
const lastSettlementRun = new Map<FootballSport, number>();
const settlementInFlight = new Map<FootballSport, Promise<SettlementSummary>>();

function todayET(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function isoDate(value: unknown) {
  const raw = String(value || "").trim();
  const iso = raw.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const us = raw.match(/(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?/);
  if (!us) return "";
  const year = us[3] || todayET().slice(0, 4);
  return `${year}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
}

function resultCode(value: unknown) {
  const key = String(value || "").trim().toUpperCase();
  if (["W", "WIN", "WON"].includes(key)) return "W";
  if (["L", "LOSS", "LOST"].includes(key)) return "L";
  if (["P", "PUSH"].includes(key)) return "P";
  return "";
}

function textKey(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(university|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sameTeam(a: unknown, b: unknown) {
  const left = textKey(a);
  const right = textKey(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const compactLeft = left.replace(/\s+/g, "");
  const compactRight = right.replace(/\s+/g, "");
  return compactLeft === compactRight || compactLeft.includes(compactRight) || compactRight.includes(compactLeft);
}

function pendingDateEligible(row: SheetRow, today: string) {
  const date = isoDate(row.Date || row["Game Date"] || "");
  if (!date || date > today) return false;
  const todayStamp = Date.parse(`${today}T12:00:00Z`);
  const dateStamp = Date.parse(`${date}T12:00:00Z`);
  if (!Number.isFinite(todayStamp) || !Number.isFinite(dateStamp)) return false;
  const ageDays = Math.floor((todayStamp - dateStamp) / 86_400_000);
  return ageDays >= 0 && ageDays <= MAX_PENDING_AGE_DAYS;
}

function trackerLine(value: unknown) {
  const match = String(value || "")
    .replace(/[−–—]/g, "-")
    .match(/([+-]?\d+(?:\.\d+)?)\s*$/);
  const parsed = match ? Number(match[1]) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function parseOdds(value: unknown) {
  const match = String(value || "").replace(/−/g, "-").match(/[+-]?\d{3,4}/);
  const parsed = match ? Number(match[0]) : -110;
  return Number.isFinite(parsed) ? parsed : -110;
}

function profitUnits(odds: number) {
  return odds > 0 ? odds / 100 : odds < 0 ? 100 / Math.abs(odds) : 1;
}

function trackerKey(row: SheetRow) {
  return [
    isoDate(row.Date || row["Game Date"] || ""),
    String(row["Game ID"] || row["Game Key"] || "").trim(),
    textKey(row["Bet Type"] || row.Market),
    textKey(row.Selection),
  ].join("|");
}

function scheduleKey(row: SheetRow) {
  return String(row["Game ID"] || row["Game Key"] || "").trim();
}

function kickoffDateET(value: unknown) {
  const date = new Date(String(value || ""));
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const item = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${item("year")}-${item("month")}-${item("day")}`;
}

function parseFinalGame(payload: any, requestedGameId: string): FinalGame | null {
  const competition = payload?.header?.competitions?.[0] || payload?.competitions?.[0] || null;
  if (!competition) return null;
  const completed = Boolean(competition?.status?.type?.completed || payload?.header?.competitions?.[0]?.status?.type?.completed);
  if (!completed) return null;

  const competitors = Array.isArray(competition?.competitors) ? competition.competitors : [];
  const home = competitors.find((entry: any) => String(entry?.homeAway || "").toLowerCase() === "home");
  const away = competitors.find((entry: any) => String(entry?.homeAway || "").toLowerCase() === "away");
  if (!home || !away) return null;

  const awayScore = Number(away?.score);
  const homeScore = Number(home?.score);
  if (!Number.isFinite(awayScore) || !Number.isFinite(homeScore)) return null;

  const name = (entry: any) => String(
    entry?.team?.displayName || entry?.team?.shortDisplayName || entry?.team?.name || "",
  ).trim();
  const gameId = String(competition?.id || payload?.header?.id || requestedGameId || "").trim();
  if (!gameId) return null;

  return {
    gameId,
    date: kickoffDateET(competition?.date || payload?.header?.competitions?.[0]?.date),
    awayTeam: name(away),
    homeTeam: name(home),
    awayScore,
    homeScore,
  };
}

async function fetchFinalGame(sport: FootballSport, gameId: string): Promise<FinalGame | null> {
  const league = sport === "NFL" ? "nfl" : "college-football";
  const url = new URL(`https://site.api.espn.com/apis/site/v2/sports/football/${league}/summary`);
  url.searchParams.set("event", gameId);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    return parseFinalGame(await response.json(), gameId);
  } catch {
    return null;
  }
}

async function fetchFinalGames(sport: FootballSport, gameIds: string[]) {
  const finals = new Map<string, FinalGame>();
  const uniqueIds = [...new Set(gameIds.filter(Boolean))];
  const batchSize = 8;
  for (let start = 0; start < uniqueIds.length; start += batchSize) {
    const batch = uniqueIds.slice(start, start + batchSize);
    const results = await Promise.all(batch.map(async (gameId) => [gameId, await fetchFinalGame(sport, gameId)] as const));
    for (const [gameId, final] of results) {
      if (final) finals.set(gameId, final);
    }
  }
  return finals;
}

function gradeTrackerRow(row: SheetRow, final: FinalGame): SheetRow | null {
  if (resultCode(row.Result || row.Status)) return null;
  const market = textKey(row["Bet Type"] || row.Market);
  const selection = String(row.Selection || row.Pick || "").trim();
  const line = trackerLine(selection);
  if (line == null) return null;

  let result = "";
  if (market.includes("spread")) {
    const team = selection.replace(/\s+[+-]?\d+(?:\.\d+)?\s*$/, "").trim();
    const isAway = sameTeam(team, final.awayTeam);
    const isHome = sameTeam(team, final.homeTeam);
    if (!isAway && !isHome) return null;
    const margin = (isAway ? final.awayScore - final.homeScore : final.homeScore - final.awayScore) + line;
    result = Math.abs(margin) < 1e-9 ? "Push" : margin > 0 ? "Win" : "Loss";
  } else if (market.includes("total")) {
    const side = textKey(selection).startsWith("under") ? "under" : textKey(selection).startsWith("over") ? "over" : "";
    if (!side) return null;
    const difference = final.awayScore + final.homeScore - line;
    result = Math.abs(difference) < 1e-9
      ? "Push"
      : side === "under"
        ? difference < 0 ? "Win" : "Loss"
        : difference > 0 ? "Win" : "Loss";
  } else {
    return null;
  }

  const code = resultCode(result);
  const odds = parseOdds(row["Odds/Line"] || row.Odds || -110);
  const units = code === "W" ? profitUnits(odds) : code === "L" ? -1 : 0;
  return {
    ...row,
    Result: result,
    Units: String(Math.round(units * 10_000) / 10_000),
    "Actual Away": String(final.awayScore),
    "Actual Home": String(final.homeScore),
  };
}

function scheduleRepair(row: SheetRow | undefined, final: FinalGame): SheetRow {
  return {
    ...(row || {}),
    "Game ID": final.gameId,
    ...(final.date ? { "Game Date": final.date, Date: final.date } : {}),
    ...(final.awayTeam ? { "Away Team": final.awayTeam } : {}),
    ...(final.homeTeam ? { "Home Team": final.homeTeam } : {}),
    "Away Score": String(final.awayScore),
    "Home Score": String(final.homeScore),
    Completed: "TRUE",
  };
}

async function settlePendingFootballResultsNow(sport: FootballSport): Promise<SettlementSummary> {
  const today = todayET();
  const [tracker, schedule] = await Promise.all([
    readSportWorksheet(sport, "bet_tracker"),
    readSportWorksheet(sport, "schedule"),
  ]);

  const pending = tracker.filter((row) =>
    !resultCode(row.Result || row.Status) &&
    pendingDateEligible(row, today) &&
    String(row["Game ID"] || row["Game Key"] || "").trim(),
  );
  const gameIds = [...new Set(pending.map((row) => String(row["Game ID"] || row["Game Key"] || "").trim()))];
  if (!gameIds.length) {
    return {
      sport,
      checkedGames: 0,
      resolvedFinals: 0,
      settledTrackerRows: 0,
      repairedScheduleRows: 0,
      pendingTrackerRows: 0,
      skipped: false,
    };
  }

  const finals = await fetchFinalGames(sport, gameIds);
  const changedTracker: SheetRow[] = [];
  for (const row of pending) {
    const gameId = String(row["Game ID"] || row["Game Key"] || "").trim();
    const final = finals.get(gameId);
    if (!final) continue;
    const graded = gradeTrackerRow(row, final);
    if (graded) changedTracker.push(graded);
  }

  const scheduleById = new Map(schedule.map((row) => [scheduleKey(row), row]));
  const repairedSchedule = [...finals.values()].map((final) => scheduleRepair(scheduleById.get(final.gameId), final));

  if (repairedSchedule.length) {
    const scheduleHeaders = Object.keys(schedule[0] || repairedSchedule[0]);
    await upsertSportRows(sport, "schedule", scheduleHeaders, repairedSchedule, scheduleKey);
  }
  if (changedTracker.length) {
    const trackerHeaders = Object.keys(tracker[0] || changedTracker[0]);
    await upsertSportRows(sport, "bet_tracker", trackerHeaders, changedTracker, trackerKey);
  }

  return {
    sport,
    checkedGames: gameIds.length,
    resolvedFinals: finals.size,
    settledTrackerRows: changedTracker.length,
    repairedScheduleRows: repairedSchedule.length,
    pendingTrackerRows: Math.max(0, pending.length - changedTracker.length),
    skipped: false,
  };
}

export async function settlePendingFootballResults(
  sport: FootballSport,
  options: { force?: boolean } = {},
): Promise<SettlementSummary> {
  const now = Date.now();
  const force = options.force === true;
  const lastRun = lastSettlementRun.get(sport) || 0;
  if (!force && now - lastRun < SETTLEMENT_INTERVAL_MS) {
    return {
      sport,
      checkedGames: 0,
      resolvedFinals: 0,
      settledTrackerRows: 0,
      repairedScheduleRows: 0,
      pendingTrackerRows: 0,
      skipped: true,
    };
  }

  const active = settlementInFlight.get(sport);
  if (active) return active;

  const operation = (async () => {
    const summary = await settlePendingFootballResultsNow(sport);
    lastSettlementRun.set(sport, Date.now());
    return summary;
  })();
  settlementInFlight.set(sport, operation);
  try {
    return await operation;
  } finally {
    if (settlementInFlight.get(sport) === operation) settlementInFlight.delete(sport);
  }
}
