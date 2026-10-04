import { buildFootballPublicData as buildFootballPublicDataWithHistory } from "./footballPublicDataHistory";
import { overlayPublishedDirectTrendRows } from "./footballDirectTrendLedger";
import {
  readSportWorksheet,
  upsertSportRows,
  type FootballSport,
  type SheetRow,
} from "./sportSheets";

export {
  PUBLIC_SPLIT_HEADERS,
  ALL_GAME_TRENDS_HEADERS,
  __test__,
} from "./footballPublicDataHistory";
export type { FootballMarket } from "./footballPublicDataHistory";

type AnyPick = Record<string, any>;
type ResultCode = "W" | "L" | "P" | "";

const EZPZ_PICK_HISTORY_TAB = "ezpz_pick_history";
const EZPZ_PICK_HISTORY_HEADERS = [
  "Date",
  "Pick Key",
  "Game",
  "Market",
  "Selection",
  "Odds",
  "Source",
  "Snapshot Status",
  "Player",
  "Player Team",
  "Prop Market",
  "Prop Side",
  "Prop Line",
  "Result",
  "Result Updated",
  "Saved At",
  "Details JSON",
];

function textKey(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/−/g, "-")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isoDate(value: unknown) {
  const raw = String(value || "").trim();
  const iso = raw.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const us = raw.match(/(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?/);
  if (!us) return "";
  const year = us[3] || String(new Date().getFullYear());
  return `${year}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
}

function resultCode(value: unknown): ResultCode {
  const key = String(value || "").trim().toUpperCase();
  if (["W", "WIN", "WON"].includes(key)) return "W";
  if (["L", "LOSS", "LOST"].includes(key)) return "L";
  if (["P", "PUSH"].includes(key)) return "P";
  return "";
}

function normalizeTeam(value: unknown) {
  const aliases: Record<string, string> = {
    pitt: "pittsburgh",
    "app state": "appalachian state",
    "app st": "appalachian state",
    "florida atlantic": "fau",
    "fla atlantic": "fau",
    "florida international": "fiu",
    "florida intl": "fiu",
    "central florida": "ucf",
    "southern california": "usc",
    "louisiana state": "lsu",
    "texas san antonio": "utsa",
    "texas el paso": "utep",
    "nevada las vegas": "unlv",
    "brigham young": "byu",
    "texas christian": "tcu",
    "southern methodist": "smu",
    "north carolina state": "nc state",
    "east carolina": "ecu",
    "western kentucky": "wku",
    "middle tennessee state": "middle tennessee",
    mtsu: "middle tennessee",
    "miami oh": "miami ohio",
    uconn: "connecticut",
    umass: "massachusetts",
    "ul lafayette": "louisiana",
    "louisiana lafayette": "louisiana",
    "ul monroe": "louisiana monroe",
    "missouri st": "missouri state",
    "mississippi st": "mississippi state",
    "michigan st": "michigan state",
    "ohio st": "ohio state",
    "penn st": "penn state",
    "washington st": "washington state",
    "fresno st": "fresno state",
    "oregon st": "oregon state",
    "kansas st": "kansas state",
    "iowa st": "iowa state",
    "boise st": "boise state",
    "colorado st": "colorado state",
    "san jose st": "san jose state",
    "ball st": "ball state",
  };

  const raw = textKey(value);
  const direct = aliases[raw];
  if (direct) return direct;
  const expanded = raw.replace(/\bst\b/g, "state").replace(/\s+/g, " ").trim();
  return aliases[expanded] || expanded;
}

function sameTeamName(left: unknown, right: unknown) {
  const a = normalizeTeam(left);
  const b = normalizeTeam(right);
  if (!a || !b) return false;
  if (a === b) return true;
  return a.startsWith(`${b} `) || b.startsWith(`${a} `);
}

function matchupTeams(value: unknown) {
  return String(value || "")
    .trim()
    .split(/\s*(?:@|\bat\b|\bvs\.?\b|\bversus\b)\s*/i)
    .map(normalizeTeam)
    .filter(Boolean);
}

function normalizeGame(value: unknown) {
  const teams = matchupTeams(value);
  return teams.length === 2 ? `${teams[0]}|${teams[1]}` : textKey(value);
}

function sameGame(left: unknown, right: unknown) {
  const a = matchupTeams(left);
  const b = matchupTeams(right);
  if (a.length === 2 && b.length === 2) {
    return (sameTeamName(a[0], b[0]) && sameTeamName(a[1], b[1])) ||
      (sameTeamName(a[0], b[1]) && sameTeamName(a[1], b[0]));
  }
  return normalizeGame(left) === normalizeGame(right);
}

function normalizedMarket(value: unknown) {
  const key = textKey(value);
  if (key.includes("total")) return "Total";
  if (key.includes("spread") || key.includes("run line")) return "Spread";
  return "";
}

function lineNumber(value: unknown) {
  const matches = String(value || "")
    .replace(/[−–—]/g, "-")
    .match(/[+-]?\d+(?:\.\d+)?/g) || [];
  for (const raw of [...matches].reverse()) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && Math.abs(parsed) <= 100) return parsed;
  }
  return null;
}

function totalSide(value: unknown) {
  const key = textKey(value);
  if (key.startsWith("under") || key.includes(" under ")) return "under";
  if (key.startsWith("over") || key.includes(" over ")) return "over";
  return "";
}

function selectionTeam(value: unknown) {
  return normalizeTeam(
    String(value || "")
      .trim()
      .replace(/\s+[+-]?\d+(?:\.\d+)?\s*$/, "")
      .trim(),
  );
}

function rowGame(row: SheetRow) {
  return String(
    row.Game ||
    `${row["Away Team"] || row.Away || ""} @ ${row["Home Team"] || row.Home || ""}`,
  ).trim();
}

function rowSelection(row: SheetRow) {
  return String(
    row.Selection ||
    row.Pick ||
    row.Side ||
    row["Public Split Selection"] ||
    "",
  ).trim();
}

function rowLine(row: SheetRow) {
  return lineNumber(
    row.Selection ||
    row.Pick ||
    row.Line ||
    row["Market Line"] ||
    row["Odds/Line"] ||
    "",
  );
}

function directPublishedPick(pick: AnyPick) {
  const source = textKey(pick.source);
  const labels = textKey(`${pick.tier || ""} ${pick.trendTier || ""} ${pick.qualification || ""}`);
  return (source === "trend play" || source === "best trend") &&
    (labels.includes("rlm") || labels.includes("public fade") || labels.includes("sharp"));
}

function historyGroupKey(pick: AnyPick) {
  const date = isoDate(pick.date || pick.Date);
  const game = normalizeGame(pick.game || pick.Game);
  const market = normalizedMarket(pick.market || pick.Market);
  return date && game && market ? `${date}|${game}|${market}` : "";
}

function trendGroupKey(row: SheetRow) {
  const date = isoDate(row.Date || row["Game Date"]);
  const game = normalizeGame(rowGame(row));
  const market = normalizedMarket(row.Market || row["Bet Type"]);
  return date && game && market ? `${date}|${game}|${market}` : "";
}

function exactPublishedMatch(pick: AnyPick, row: SheetRow) {
  const pickDate = isoDate(pick.date || pick.Date);
  const rowDate = isoDate(row.Date || row["Game Date"]);
  if (!pickDate || pickDate !== rowDate) return false;
  if (!sameGame(pick.game || pick.Game, rowGame(row))) return false;

  const market = normalizedMarket(pick.market || pick.Market);
  const rowMarket = normalizedMarket(row.Market || row["Bet Type"]);
  if (!market || market !== rowMarket) return false;

  const pickSelection = String(pick.selection || pick.Selection || "");
  const settledSelection = rowSelection(row);

  if (market === "Total") {
    const pickSide = totalSide(pickSelection);
    const settledSide = totalSide(settledSelection);
    if (!pickSide || !settledSide || pickSide !== settledSide) return false;
    const pickLine = lineNumber(pickSelection || pick.line || pick.Line);
    const settledLine = rowLine(row);
    return pickLine != null && settledLine != null && Math.abs(pickLine - settledLine) <= 0.01;
  }

  const pickTeam = selectionTeam(pickSelection);
  const settledTeam = selectionTeam(settledSelection);
  if (!pickTeam || !settledTeam || !sameTeamName(pickTeam, settledTeam)) return false;
  const pickLine = lineNumber(pickSelection || pick.line || pick.Line);
  const settledLine = rowLine(row);
  return pickLine == null || settledLine == null || Math.abs(pickLine - settledLine) <= 0.01;
}

function actualScores(row: SheetRow) {
  const awayRaw = String(row["Away Score"] ?? row["Actual Away"] ?? row["Actual Away Runs"] ?? "").trim();
  const homeRaw = String(row["Home Score"] ?? row["Actual Home"] ?? row["Actual Home Runs"] ?? "").trim();
  if (!awayRaw || !homeRaw) return null;
  const away = Number(awayRaw);
  const home = Number(homeRaw);
  return Number.isFinite(away) && Number.isFinite(home) ? { away, home } : null;
}

function gradePublishedFromFinalRow(pick: AnyPick, row: SheetRow): ResultCode {
  const scores = actualScores(row);
  if (!scores) return "";
  const pickDate = isoDate(pick.date || pick.Date);
  const rowDate = isoDate(row.Date || row["Game Date"]);
  if (pickDate && rowDate && pickDate !== rowDate) return "";
  if (!sameGame(pick.game || pick.Game, rowGame(row))) return "";

  const market = normalizedMarket(pick.market || pick.Market);
  const selection = String(pick.selection || pick.Selection || "");
  const line = lineNumber(pick.line ?? pick.Line ?? selection);
  if (!market || line == null) return "";

  let value = 0;
  if (market === "Total") {
    const side = totalSide(selection);
    if (!side) return "";
    value = scores.away + scores.home - line;
    if (Math.abs(value) <= 0.01) return "P";
    return side === "under" ? (value < 0 ? "W" : "L") : (value > 0 ? "W" : "L");
  }

  const teams = matchupTeams(rowGame(row));
  if (teams.length !== 2) return "";
  const team = selectionTeam(selection);
  if (!team) return "";
  if (sameTeamName(team, teams[0])) value = scores.away - scores.home + line;
  else if (sameTeamName(team, teams[1])) value = scores.home - scores.away + line;
  else return "";
  return Math.abs(value) <= 0.01 ? "P" : value > 0 ? "W" : "L";
}

function backfillPublishedResults(picks: AnyPick[], trendRows: SheetRow[], finalRows: SheetRow[] = []) {
  const settledRows = trendRows.filter((row) => resultCode(row.Result || row.Status));
  const finalScoreRows = [...trendRows, ...finalRows].filter((row) => actualScores(row));
  return picks.map((pick) => {
    if (resultCode(pick.result || pick.Result)) return pick;
    const match = settledRows.find((row) => exactPublishedMatch(pick, row));
    const directResult = match ? resultCode(match.Result || match.Status) : "";
    if (directResult) {
      return {
        ...pick,
        result: directResult,
        resultUpdated: String(
          match?.["Result Updated"] ||
          match?.["Updated At"] ||
          new Date().toISOString(),
        ),
      };
    }

    const finalRow = finalScoreRows.find((row) => gradePublishedFromFinalRow(pick, row));
    if (!finalRow) return pick;
    const result = gradePublishedFromFinalRow(pick, finalRow);
    if (!result) return pick;
    return {
      ...pick,
      result,
      resultUpdated: String(
        finalRow["Result Updated"] ||
        finalRow["Updated At"] ||
        new Date().toISOString(),
      ),
    };
  });
}

function exactPickKey(pick: AnyPick) {
  const date = isoDate(pick.date || pick.Date);
  const game = normalizeGame(pick.game || pick.Game);
  const market = normalizedMarket(pick.market || pick.Market);
  const selection = String(pick.selection || pick.Selection || "");
  if (!date || !game || !market) return "";
  if (market === "Total") {
    return `${date}|${game}|total|${totalSide(selection)}|${lineNumber(selection) ?? ""}`;
  }
  return `${date}|${game}|spread|${selectionTeam(selection)}|${lineNumber(selection) ?? ""}`;
}

function historyRowAsPick(row: SheetRow): AnyPick {
  return {
    date: row.Date,
    game: row.Game,
    market: row.Market,
    selection: row.Selection,
    result: row.Result,
    resultUpdated: row["Result Updated"],
  };
}

async function persistNcaafHistoryBackfill(picks: AnyPick[]) {
  const resolvedByKey = new Map<string, AnyPick>();
  for (const pick of picks) {
    if (!resultCode(pick.result || pick.Result)) continue;
    const key = exactPickKey(pick);
    if (key) resolvedByKey.set(key, pick);
  }
  if (!resolvedByKey.size) return 0;

  let history: SheetRow[];
  try {
    history = await readSportWorksheet("NCAAF", EZPZ_PICK_HISTORY_TAB, EZPZ_PICK_HISTORY_HEADERS);
  } catch {
    return 0;
  }

  const changed: SheetRow[] = [];
  for (const row of history) {
    if (resultCode(row.Result)) continue;
    const resolved = resolvedByKey.get(exactPickKey(historyRowAsPick(row)));
    const result = resultCode(resolved?.result || resolved?.Result);
    if (!resolved || !result) continue;
    changed.push({
      ...row,
      Result: result,
      "Result Updated": String(resolved.resultUpdated || resolved["Result Updated"] || new Date().toISOString()),
    });
  }

  if (!changed.length) return 0;
  await upsertSportRows(
    "NCAAF",
    EZPZ_PICK_HISTORY_TAB,
    EZPZ_PICK_HISTORY_HEADERS,
    changed,
    (row) => String(row["Pick Key"] || exactPickKey(historyRowAsPick(row))),
  );
  return changed.length;
}

function timestamp(value: unknown) {
  const raw = String(value || "")
    .trim()
    .replace(/ EDT$/, " -0400")
    .replace(/ EST$/, " -0500");
  if (!raw) return 0;
  const stamp = Date.parse(raw);
  return Number.isFinite(stamp) ? stamp : 0;
}

function eventTime(pick: AnyPick) {
  for (const value of [pick.gameTime, pick.lockedAt, pick.updatedAt, pick.resultUpdated]) {
    const stamp = timestamp(value);
    if (stamp) return stamp;
  }
  return 0;
}

function decisionTime(pick: AnyPick) {
  return Math.max(
    timestamp(pick.lockedAt),
    timestamp(pick.updatedAt),
    timestamp(pick.resultUpdated),
  );
}

function snapshotRank(pick: AnyPick) {
  return textKey(pick.snapshotStatus) === "final pregame" ? 2 : 1;
}

function duplicateLinePenalty(pick: AnyPick) {
  const numbers = String(pick.selection || pick.play || "").match(/[+-]?\d+(?:\.\d+)?/g) || [];
  return numbers.some((value, index) => index > 0 && value === numbers[index - 1]) ? 1 : 0;
}

function preferPublishedPick(current: AnyPick, candidate: AnyPick) {
  const rankDiff = snapshotRank(candidate) - snapshotRank(current);
  if (rankDiff !== 0) return rankDiff > 0 ? candidate : current;
  const timeDiff = decisionTime(candidate) - decisionTime(current);
  if (timeDiff !== 0) return timeDiff > 0 ? candidate : current;
  const penaltyDiff = duplicateLinePenalty(candidate) - duplicateLinePenalty(current);
  if (penaltyDiff !== 0) return penaltyDiff < 0 ? candidate : current;
  return candidate;
}

function authoritativeDirectHistory(rows: AnyPick[]) {
  const grouped = new Map<string, AnyPick>();
  for (const pick of rows || []) {
    if (!directPublishedPick(pick)) continue;
    const key = historyGroupKey(pick);
    if (!key) continue;
    const previous = grouped.get(key);
    grouped.set(key, previous ? preferPublishedPick(previous, pick) : pick);
  }
  return [...grouped.values()].sort((a, b) => {
    const byDate = isoDate(b.date || b.Date).localeCompare(isoDate(a.date || a.Date));
    if (byDate) return byDate;
    return eventTime(b) - eventTime(a);
  });
}

function hardenDirectTrendRecordRows(rows: SheetRow[], sport: FootballSport) {
  const sharpMin = 25;
  return rows.map((row) => {
    const next = { ...row };

    // FootballBoard historically reduced spread selections to their last word.
    // Give published ledger rows a compact full-team identity so matchups such
    // as "Missouri State" vs "Washington State" remain two distinct sides.
    if (
      textKey(next["Result Source"]) === "ezpz pick history" &&
      textKey(next.Market) === "spread"
    ) {
      const compact = textKey(next.Selection).replace(/\s+/g, "");
      if (compact) next["Public Split Selection"] = compact;
    }

    // FootballTrendMarketBoard still contains retired lower Sharp thresholds.
    // On the record-only ledger, neutralize positive gaps below the active
    // threshold so old UI code cannot promote a non-qualifying Sharp result.
    const bets = Number(next["Public Bets %"] || next["Current Public %"]);
    const money = Number(next["Public Money %"] || next["Current Sharp %"]);
    const gap = money - bets;
    if (
      Number.isFinite(bets) &&
      Number.isFinite(money) &&
      gap > 0 &&
      gap < sharpMin
    ) {
      next["Public Money %"] = String(bets);
      next["Current Sharp %"] = String(bets);
    }

    return next;
  });
}

export async function buildFootballPublicData(
  sport: FootballSport,
  options: { forceFresh?: boolean; persist?: boolean } = {},
): Promise<Record<string, any>> {
  const data = (await buildFootballPublicDataWithHistory(sport, options)) as Record<string, any>;
  const trendRows = Array.isArray(data.trendRecordRows) ? data.trendRecordRows as SheetRow[] : [];
  const trackerRows = Array.isArray(data.betTrackerRows) ? data.betTrackerRows as SheetRow[] : [];
  const scheduleRows = sport === "NCAAF"
    ? await readSportWorksheet("NCAAF", "schedule").catch(() => [] as SheetRow[])
    : [];
  const recordRows = Array.isArray(data.aiPickRecordRows) ? data.aiPickRecordRows as AnyPick[] : [];
  const backfilledRecordRows = sport === "NCAAF"
    ? backfillPublishedResults(recordRows, trendRows, [...trackerRows, ...scheduleRows])
    : recordRows;

  if (sport === "NCAAF" && options.persist) {
    await persistNcaafHistoryBackfill(backfilledRecordRows);
  }

  const resolvedByKey = new Map(
    backfilledRecordRows
      .filter((pick) => resultCode(pick.result || pick.Result))
      .map((pick) => [exactPickKey(pick), pick]),
  );
  const aiPicks = (Array.isArray(data.aiPicks) ? data.aiPicks as AnyPick[] : []).map((pick) => {
    if (sport !== "NCAAF" || resultCode(pick.result || pick.Result)) return pick;
    const resolved = resolvedByKey.get(exactPickKey(pick));
    if (!resolved) return pick;
    return {
      ...pick,
      result: resultCode(resolved.result || resolved.Result),
      resultUpdated: String(resolved.resultUpdated || resolved["Result Updated"] || ""),
    };
  });

  const published = authoritativeDirectHistory(backfilledRecordRows);

  // Any published direct-trend decision owns its game+market record identity,
  // even if its FINAL grade is still pending. This prevents a stale LIVE row or
  // a later reconstruction from being counted in its place.
  const publishedGroups = new Set(published.map(historyGroupKey).filter(Boolean));
  const legacyFallbackRows = trendRows.filter((row) => {
    const key = trendGroupKey(row);
    return !key || !publishedGroups.has(key);
  });

  const directTrendRecordRows = overlayPublishedDirectTrendRows(
    legacyFallbackRows,
    published,
    sport,
  );

  return {
    ...data,
    aiPicks,
    aiPickRecordRows: backfilledRecordRows,
    trendRecordRows: hardenDirectTrendRecordRows(directTrendRecordRows, sport),
  };
}
