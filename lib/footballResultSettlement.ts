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
  recoveredTrackerRows: number;
  settledTrackerRows: number;
  repairedScheduleRows: number;
  pendingTrackerRows: number;
  skipped: boolean;
};

const SETTLEMENT_INTERVAL_MS = 5 * 60_000;
const MAX_PENDING_AGE_DAYS = 45;
const lastSettlementRun = new Map<FootballSport, number>();
const settlementInFlight = new Map<FootballSport, Promise<SettlementSummary>>();

const FOOTBALL_TRACKER_HEADERS = [
  "Date", "Season", "Week", "Game ID", "Game", "Bet Type", "Selection", "Odds/Line",
  "Model Probability", "Push Probability", "Implied Probability", "Edge", "Expected Value",
  "Grade", "Confluence", "Result", "Units", "Closing Line", "Closing Line Value", "Reliability",
  "Data Confidence", "Personnel Confidence", "Projected Away", "Projected Home", "Actual Away",
  "Actual Home", "Margin Residual", "Total Residual", "Model Version", "Notes",
];

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

function americanImpliedProbability(odds: number) {
  if (!Number.isFinite(odds) || odds === 0) return 0.5;
  return odds < 0 ? Math.abs(odds) / (Math.abs(odds) + 100) : 100 / (odds + 100);
}

function expectedValuePerUnit(probability: number, odds: number) {
  const winProfit = odds > 0 ? odds / 100 : 100 / Math.abs(odds || -110);
  return probability * winProfit - (1 - probability);
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

function rowHeaders(rows: SheetRow[], fallback: string[] = []) {
  const headers = new Set<string>(fallback);
  for (const row of rows) for (const key of Object.keys(row || {})) headers.add(key);
  return [...headers];
}

function qualifiedFootballModelGrade(value: unknown) {
  const grade = textKey(value);
  return Boolean(grade) &&
    !grade.includes("no play") &&
    !grade.includes("non edge") &&
    grade !== "research" &&
    grade !== "projection only" &&
    grade !== "no market line";
}

function selectionTeam(value: unknown) {
  return String(value || "")
    .trim()
    .replace(/\s+[+-]?\d+(?:\.\d+)?\s*$/, "")
    .trim();
}

function finiteNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function modelTrackerRowsFromSlate(slate: SheetRow[]) {
  const rows: SheetRow[] = [];
  for (const row of slate) {
    const date = isoDate(row.Date || row["Game Date"] || "");
    const gameId = String(row["Game ID"] || row["Game Key"] || "").trim();
    const game = String(row.Game || `${row["Away Team"] || ""} at ${row["Home Team"] || ""}`).trim();
    if (!date || !gameId) continue;

    const common: SheetRow = {
      Date: date,
      Season: String(row.Season || ""),
      Week: String(row.Week || ""),
      "Game ID": gameId,
      Game: game,
      "Push Probability": "",
      Result: "Pending",
      Units: "",
      "Closing Line": "",
      "Closing Line Value": "",
      Reliability: String(row.Reliability || ""),
      "Data Confidence": String(row["Data Confidence"] || ""),
      "Personnel Confidence": String(row["Personnel Confidence"] || ""),
      "Projected Away": String(row["Projected Away"] || ""),
      "Projected Home": String(row["Projected Home"] || ""),
      "Actual Away": "",
      "Actual Home": "",
      "Margin Residual": "",
      "Total Residual": "",
      "Model Version": String(row["Model Version"] || ""),
      Notes: String(row.Notes || ""),
    };

    const spreadGrade = String(row["Spread Grade"] || "").trim();
    const spreadPick = String(row["Spread Pick"] || "").trim();
    if (spreadPick && qualifiedFootballModelGrade(spreadGrade)) {
      const pickedTeam = selectionTeam(spreadPick);
      const pickedHome = sameTeam(pickedTeam, row["Home Team"]);
      const spreadOdds = parseOdds(
        pickedHome
          ? row["Home Spread Odds"] || row["Spread Odds"] || -110
          : row["Away Spread Odds"] || row["Spread Odds"] || -110,
      );
      const probability = finiteNumber(row["Spread Probability"]);
      const implied = americanImpliedProbability(spreadOdds);
      rows.push({
        ...common,
        "Bet Type": "Spread",
        Selection: spreadPick,
        "Odds/Line": String(spreadOdds),
        "Model Probability": String(probability),
        "Implied Probability": String(implied),
        Edge: String(probability - implied),
        "Expected Value": String(expectedValuePerUnit(probability, spreadOdds)),
        Grade: spreadGrade,
        Confluence: String(row["Spread Confluence"] || ""),
      });
    }

    const totalGrade = String(row["Total Grade"] || "").trim();
    const totalPick = String(row["Total Pick"] || "").trim();
    if (totalPick && qualifiedFootballModelGrade(totalGrade)) {
      const under = textKey(totalPick).startsWith("under");
      const totalOdds = parseOdds(
        under
          ? row["Total Under Odds"] || row["Total Odds"] || -110
          : row["Total Over Odds"] || row["Total Odds"] || -110,
      );
      const probability = finiteNumber(row["Total Probability"]);
      const implied = americanImpliedProbability(totalOdds);
      rows.push({
        ...common,
        "Bet Type": "Total",
        Selection: totalPick,
        "Odds/Line": String(totalOdds),
        "Model Probability": String(probability),
        "Implied Probability": String(implied),
        Edge: String(probability - implied),
        "Expected Value": String(expectedValuePerUnit(probability, totalOdds)),
        Grade: totalGrade,
        Confluence: String(row["Total Confluence"] || ""),
      });
    }
  }
  return rows;
}

async function reconcileModelTrackerRows(
  sport: FootballSport,
  tracker: SheetRow[],
  slate: SheetRow[],
) {
  const existingKeys = new Set(tracker.map(trackerKey));
  const missing = modelTrackerRowsFromSlate(slate).filter((row) => {
    const key = trackerKey(row);
    if (!key || existingKeys.has(key)) return false;
    existingKeys.add(key);
    return true;
  });

  if (missing.length) {
    const headers = rowHeaders([...tracker, ...missing], FOOTBALL_TRACKER_HEADERS);
    await upsertSportRows(sport, "bet_tracker", headers, missing, trackerKey);
  }
  return { tracker: [...tracker, ...missing], recovered: missing.length };
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

function finalFromScheduleRow(row: SheetRow): FinalGame | null {
  const gameId = scheduleKey(row);
  const awayScore = Number(row["Away Score"]);
  const homeScore = Number(row["Home Score"]);
  if (!gameId || !Number.isFinite(awayScore) || !Number.isFinite(homeScore)) return null;
  const completed = ["TRUE", "YES", "Y", "1", "COMPLETED", "FINAL"].includes(
    String(row.Completed || row.Status || "").trim().toUpperCase(),
  );
  if (!completed && (String(row["Away Score"] ?? "").trim() === "" || String(row["Home Score"] ?? "").trim() === "")) return null;
  return {
    gameId,
    date: isoDate(row.Date || row["Game Date"] || ""),
    awayTeam: String(row["Away Team"] || "").trim(),
    homeTeam: String(row["Home Team"] || "").trim(),
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
  const [trackerRaw, schedule, slate] = await Promise.all([
    readSportWorksheet(sport, "bet_tracker"),
    readSportWorksheet(sport, "schedule"),
    readSportWorksheet(sport, "daily_slate"),
  ]);

  const reconciled = await reconcileModelTrackerRows(sport, trackerRaw, slate);
  const tracker = reconciled.tracker;
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
      recoveredTrackerRows: reconciled.recovered,
      settledTrackerRows: 0,
      repairedScheduleRows: 0,
      pendingTrackerRows: 0,
      skipped: false,
    };
  }

  const finals = new Map<string, FinalGame>();
  for (const row of schedule) {
    const final = finalFromScheduleRow(row);
    if (final && gameIds.includes(final.gameId)) finals.set(final.gameId, final);
  }

  const unresolvedIds = gameIds.filter((gameId) => !finals.has(gameId));
  if (unresolvedIds.length) {
    const fetched = await fetchFinalGames(sport, unresolvedIds);
    for (const [gameId, final] of fetched) finals.set(gameId, final);
  }

  const changedTracker: SheetRow[] = [];
  for (const row of pending) {
    const gameId = String(row["Game ID"] || row["Game Key"] || "").trim();
    const final = finals.get(gameId);
    if (!final) continue;
    const graded = gradeTrackerRow(row, final);
    if (graded) changedTracker.push(graded);
  }

  const scheduleById = new Map(schedule.map((row) => [scheduleKey(row), row]));
  const repairedSchedule = [...finals.values()]
    .filter((final) => !finalFromScheduleRow(scheduleById.get(final.gameId) || {}))
    .map((final) => scheduleRepair(scheduleById.get(final.gameId), final));

  if (repairedSchedule.length) {
    const scheduleHeaders = rowHeaders([...schedule, ...repairedSchedule]);
    await upsertSportRows(sport, "schedule", scheduleHeaders, repairedSchedule, scheduleKey);
  }
  if (changedTracker.length) {
    const trackerHeaders = rowHeaders([...tracker, ...changedTracker], FOOTBALL_TRACKER_HEADERS);
    await upsertSportRows(sport, "bet_tracker", trackerHeaders, changedTracker, trackerKey);
  }

  return {
    sport,
    checkedGames: gameIds.length,
    resolvedFinals: finals.size,
    recoveredTrackerRows: reconciled.recovered,
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
      recoveredTrackerRows: 0,
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
