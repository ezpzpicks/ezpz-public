import { evaluateFootballCatalogGroup } from "./footballTrendCatalog";
import { classifySelectedSideMovement, selectedSideLineMove } from "./footballWeeklyMarket";
import { buildFootballSignalsState, signalNumber, signalRecord, type FootballSignalSide, type FootballSignalsBoard } from "./footballSignals";
import { buildTeamTrendHistory, type TeamTrendHistory } from "./footballTeamTrends";
import { NBA_SIGNALS_POLICY, NBA_TREND_RECORD_POLICY } from "./nbaTrendLeaderboard";
import type { NcaafEzpzSubtype } from "./ncaafEzpzWilson";
import { NBA_ASSUMED_ODDS, NBA_MARKET_POLICY, nbaDate, nbaRowKey, nbaTeamKey } from "./nbaMarketCore";
import type { TursoRow } from "./tursoStore";
import { buildSignalResearchDays, buildSignalResearchReport, SIGNAL_RESEARCH_VERSION, type SignalResearchDay } from "./signalCombinationResearch";

type Row = Record<string, any>;
export type NbaSignalTest = Pick<FootballSignalSide, "id" | "date" | "game" | "gameTime" | "selection" | "market" | "odds" | "signalCount" | "combination" | "result">;
export type NbaAnalysisState = {
  version: string; season: string; archiveDates: string[]; pendingDates: string[];
  leaderboard: NcaafEzpzSubtype[]; leaderboardAsOf: string;
  teamHistory: Array<[string, TeamTrendHistory extends Map<string, infer G> ? G : never]>;
  tests: Record<string, NbaSignalTest>;
  signalResearch?: { version: string; days: Record<string, SignalResearchDay> };
};
export const NBA_ANALYSIS_VERSION = "nba-analysis-2026-10-22-v1";
export function nbaSeason(date: string) { return String(Number(date.slice(0, 4)) - (Number(date.slice(5, 7)) < 7 ? 1 : 0)); }
export function emptyNbaAnalysis(date: string): NbaAnalysisState {
  return { version: NBA_ANALYSIS_VERSION, season: nbaSeason(date), archiveDates: [], pendingDates: [], leaderboard: [], leaderboardAsOf: "",
    teamHistory: [], tests: {} };
}
export function nbaRowsToPlays(rows: TursoRow[], now = Date.now()): Row[] {
  const plays = rows.filter(row => ["Spread", "Total"].includes(row.Market)).map(row => {
    const parse = (value: string) => { try { return JSON.parse(value || "{}"); } catch { return {}; } };
    const details = parse(row["Details JSON"]), line = signalNumber(row.Line), openingLine = signalNumber(row["Opening Line"]);
    const bets = signalNumber(row["Current Bets %"]), money = signalNumber(row["Current Handle %"]);
    const openingBets = signalNumber(row["Opening Bets %"]), openingMoney = signalNumber(row["Opening Handle %"]);
    const delta = bets != null && openingBets != null && openingBets > 0 && openingBets < 100 ? bets - openingBets : null;
    const move = line != null && openingLine != null && Math.abs(line - openingLine) >= .5
      ? selectedSideLineMove(row.Market as "Spread" | "Total", row.Selection, openingLine, line) : null;
    const basis = move == null ? "" : row.Market === "Spread" ? "Spread Line" : "Total Line";
    const classification = delta == null ? { lineMovementSignal: "", lineMovementTone: "" } : classifySelectedSideMovement(delta, move, basis);
    return { date: row.Date, gameId: row["Game ID"], game: row.Game, gameKey: row["Game Key"], gameTime: row["Game Time"],
      awayTeam: row["Away Team"], homeTeam: row["Home Team"], market: row.Market,
      selection: row.Selection, selectionTeam: row.Market === "Spread" ? row.Selection : "", side: row.Market === "Total" ? row.Selection : "",
      sideGroup: row.Market === "Spread" && line != null ? line < 0 ? "Favorite" : line > 0 ? "Underdog" : "Pick'em" : row.Selection,
      line, odds: row.Odds || "-110", observedPriceMissing: true, oddsSource: "DEFAULT_110",
      betsPct: bets, moneyPct: money, openingLine, openingOdds: row["Opening Odds"] || "-110", openingBetsPct: openingBets,
      openingMoneyPct: openingMoney, publicMovementPct: delta, sharpMovementPct: money != null && openingMoney != null ? money - openingMoney : null,
      firstTrackedAt: row["First Tracked At"], openingSnapshotTime: row["First Tracked At"], updatedAt: row["Updated At"],
      frozenAt: row["Frozen At"], snapshotStatus: row["Snapshot Status"] === "FINAL_PREGAME" ? "FINAL_PREGAME"
        : Date.parse(row["Game Time"]) <= now ? "MISSED_LOCK" : "LIVE",
      source: row.Source, lineMovementValue: move, lineMovementBasis: basis, ...classification,
      movementHistory: Array.isArray(details.movementHistory) ? details.movementHistory : [] };
  });
  const groups = new Map<string, Row[]>();
  for (const play of plays) groups.set(play.gameKey, [...(groups.get(play.gameKey) || []), play]);
  for (const group of groups.values()) {
    const evaluated = evaluateFootballCatalogGroup(group, "NBA");
    group.forEach((play, i) => { play.catalogEvaluation = evaluated[i]; });
  }
  return plays;
}

/** Only observed 10–20 minute pregame quartets can enter trend/team records. */
export function settleNbaTrendRows(snapshots: TursoRow[], schedules: TursoRow[], now = Date.now()): TursoRow[] {
  const output: TursoRow[] = [], groups = new Map<string, TursoRow[]>();
  for (const row of snapshots) groups.set(row["Game Key"], [...(groups.get(row["Game Key"]) || []), row]);
  for (const rows of groups.values()) {
    if (rows.length !== 4 || new Set(rows.map(nbaRowKey)).size !== 4) continue;
    const first = rows[0], tipoff = Date.parse(first["Game Time"]);
    if (rows.some(row => ["Date", "Game ID", "Game Key", "Game Time", "Away Team", "Home Team", "Away Team ID", "Home Team ID"]
      .some(key => !row[key] || row[key] !== first[key]))) continue;
    const spread = rows.filter(row => row.Market === "Spread"), total = rows.filter(row => row.Market === "Total");
    if (spread.length !== 2 || total.length !== 2 || !spread.some(row => row.Selection === first["Away Team"])
      || !spread.some(row => row.Selection === first["Home Team"]) || !total.some(row => row.Selection === "Over") || !total.some(row => row.Selection === "Under")) continue;
    if (rows.some(row => signalNumber(row.Line) == null || row.Odds !== NBA_ASSUMED_ODDS || row["Market Policy"] !== NBA_MARKET_POLICY)
      || Math.abs(Number(spread[0].Line) + Number(spread[1].Line)) > .001
      || Number(total[0].Line) <= 0 || Math.abs(Number(total[0].Line) - Number(total[1].Line)) > .001
      || [spread, total].some(pair => ["Current Bets %", "Current Handle %"].some(field => {
        const values = pair.map(row => signalNumber(row[field]));
        return values.some(value => value == null || value < 0 || value > 100) || Math.abs(Number(values[0]) + Number(values[1]) - 100) > 2;
      }))) continue;
    const game = schedules.find(game => game["Game ID"] === first["Game ID"] && game.Date === first.Date
      && game["Game Time"] === first["Game Time"] && game["Away Team ID"] === first["Away Team ID"] && game["Home Team ID"] === first["Home Team ID"]
      && nbaTeamKey(game["Away Team"]) === nbaTeamKey(first["Away Team"]) && nbaTeamKey(game["Home Team"]) === nbaTeamKey(first["Home Team"]));
    const a = signalNumber(game?.["Away Score"]), h = signalNumber(game?.["Home Score"]), observed = Date.parse(game?.["Result Updated"] || "");
    if (!game || game.Source !== "ESPN NBA schedule; ScoresAndOdds market lines" || game.Status !== "STATUS_FINAL" || game.Completed !== "TRUE" || a == null || h == null || a <= 0 || h <= 0 || a === h
      || !Number.isFinite(tipoff) || !Number.isFinite(observed) || observed <= tipoff || observed > now || nbaDate(tipoff) !== first.Date) continue;
    const plays = nbaRowsToPlays(rows, now);
    if (plays.some(play => play.catalogEvaluation.invalid || !["Spread", "Total"].includes(play.market))) continue;
    const locks = rows.map(row => Date.parse(row["Frozen At"]));
    if (Math.max(...locks) - Math.min(...locks) > 60_000 || rows.some((row, i) => row.Source !== "ScoresAndOdds"
      || row["Snapshot Status"] !== "FINAL_PREGAME" || !Number.isFinite(locks[i]) || locks[i] > now || tipoff - locks[i] < 10 * 60_000 || tipoff - locks[i] > 20 * 60_000)) continue;
    rows.forEach((row, i) => {
      const play = plays[i], margin = row.Market === "Total" ? (row.Selection === "Under" ? Number(row.Line) - a - h : a + h - Number(row.Line))
        : (row.Selection === row["Away Team"] ? a - h : h - a) + Number(row.Line);
      output.push({ ...row, Sport: "NBA", "NBA Record Policy": NBA_TREND_RECORD_POLICY,
        Result: Math.abs(margin) < 1e-8 ? "P" : margin > 0 ? "W" : "L", "Result Updated": game["Result Updated"],
        "Actual Away Runs": String(a), "Actual Home Runs": String(h),
        "Record Snapshot Policy": "verified-final-snapshot-v1", "Public Split Snapshot Time": row["Frozen At"],
        "Public Split Source": "ScoresAndOdds", "Public Split Selection": row.Selection, "Public Split Line": row.Line,
        "Public Split Odds": row.Odds || "-110", "Public Bets %": row["Current Bets %"], "Public Money %": row["Current Handle %"],
        "Opening Public %": row["Opening Bets %"], "Opening Sharp %": row["Opening Handle %"], "Opening Public Split Line": row["Opening Line"],
        "Opening Public Split Snapshot Time": row["First Tracked At"], "Observed Price Missing": "TRUE",
        "Catalog Membership JSON": JSON.stringify(play.catalogEvaluation), "Catalog Evidence JSON": JSON.stringify({ movementHistory: play.movementHistory }) });
    });
  }
  return output;
}

export function buildNbaSignals({ date, games, splits, forecasts, storedRows, state, now = Date.now(), capture = false }: {
  date: string; games: TursoRow[]; splits: TursoRow[]; forecasts: Row[]; storedRows: TursoRow[] | null;
  state: NbaAnalysisState; now?: number; capture?: boolean;
}) {
  const plays = nbaRowsToPlays(splits, now);
  const stale = plays.some(play => play.snapshotStatus === "LIVE" && Date.parse(play.gameTime) > now
    && now - Date.parse(play.updatedAt) > (Date.parse(play.gameTime) - now <= 90 * 60_000 ? 10 : 35) * 60_000);
  const result = buildFootballSignalsState({ sport: "NBA", now, capture, storedRows, policy: NBA_SIGNALS_POLICY,
    leaderboard: state.leaderboard, leaderboardAsOf: Date.parse(state.leaderboardAsOf), history: new Map(state.teamHistory),
    core: { today: date, slateToday: games, teamTrendScheduleRows: games, trendPlays: plays, nbaForecasts: forecasts, stale } });
  result.board.archiveDates = [...new Set([...state.archiveDates, ...result.board.archiveDates])].sort();
  const tests = { ...state.tests };
  for (const side of result.board.sides) if (side.recorded && side.selected) {
    const { id, date, game, gameTime, selection, market, odds, signalCount, combination, result: settled } = side;
    tests[id] = { id, date, game, gameTime, selection, market, odds, signalCount, combination, result: settled };
  }
  const selected = Object.values(tests);
  result.board.summary = signalRecord(selected);
  result.board.history = selected.sort((a, b) => b.gameTime.localeCompare(a.gameTime)).slice(0, 200);
  result.board.breakdowns = [];
  for (const [dimension, field] of [["Market", "market"], ["Signal count", "signalCount"], ["Combination", "combination"]] as const) {
    for (const label of [...new Set(selected.map(row => String(row[field])))]) result.board.breakdowns.push({ dimension, label,
      record: signalRecord(selected.filter(row => String(row[field]) === label)) });
  }
  const researchDays = state.signalResearch?.version === SIGNAL_RESEARCH_VERSION ? { ...state.signalResearch.days } : {};
  const capturedDays = buildSignalResearchDays(result.board.sides, NBA_SIGNALS_POLICY.version, now);
  Object.assign(researchDays, capturedDays);
  result.board.research = buildSignalResearchReport("NBA", NBA_SIGNALS_POLICY.version, researchDays);
  return { ...result, plays, stale, tests, signalResearch: { version: SIGNAL_RESEARCH_VERSION, days: researchDays } };
}

export function mergeNbaTeamHistory(previous: NbaAnalysisState["teamHistory"], records: TursoRow[], schedule: TursoRow[]) {
  const history = new Map(previous);
  for (const [key, game] of buildTeamTrendHistory("NBA", records, [], schedule)) history.set(key, { ...history.get(key), ...game });
  return [...history].filter(([, game]) => game.completed);
}
