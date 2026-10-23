import { readTursoDatasetByDateKeys, runTursoSql, type TursoRow } from "./tursoStore";
import { saveNbaMarketRows } from "./nbaMarketStore";
import { readNbaForecasts } from "./nbaForecasts";
import { nbaRowKey, normalizeNbaSlate, type NbaGame } from "./nbaMarketCore";
import { buildNbaSignals, emptyNbaAnalysis, mergeNbaTeamHistory, nbaSeason, settleNbaTrendRows, NBA_ANALYSIS_VERSION, type NbaAnalysisState } from "./nbaAnalysisCore";
import { buildNbaTrendLeaderboard, NBA_ANALYSIS_TAB, NBA_SIGNALS_TAB, NBA_TREND_RECORDS_TAB, NBA_SIGNALS_POLICY } from "./nbaTrendLeaderboard";
import { readSavedFootballSignalsForDate } from "./footballSignals";
import { buildSignalResearchDays, SIGNAL_RESEARCH_VERSION } from "./signalCombinationResearch";

const q = (value: string) => `'${value.replaceAll("'", "''")}'`;
export function nbaScheduleRows(games: NbaGame[], observedAt: number): TursoRow[] {
  return games.map(game => ({ Date: game.date, "Game ID": game.gameId, "Game Key": `${game.date}|nba|${game.gameId}`,
    "Game Time": game.tipoff, Game: `${game.away} @ ${game.home}`, "Away Team": game.away, "Home Team": game.home,
    "Away Team ID": game.awayId, "Home Team ID": game.homeId, Status: game.status, Completed: game.completed ? "TRUE" : "FALSE",
    "Away Score": game.awayScore == null ? "" : String(game.awayScore), "Home Score": game.homeScore == null ? "" : String(game.homeScore),
    "Result Updated": game.completed ? new Date(observedAt).toISOString() : "", Source: "ESPN NBA schedule; ScoresAndOdds market lines" }));
}
export async function readNbaAnalysis(date: string): Promise<NbaAnalysisState> {
  const rows = await readTursoDatasetByDateKeys("NBA", NBA_ANALYSIS_TAB, [`season-${nbaSeason(date)}`]);
  if (!rows.length) return emptyNbaAnalysis(date);
  const state = JSON.parse(rows[0]["Details JSON"]);
  if (state.version !== NBA_ANALYSIS_VERSION || state.season !== nbaSeason(date) || !Array.isArray(state.teamHistory)
    || !Array.isArray(state.leaderboard) || !Array.isArray(state.pendingDates) || !Array.isArray(state.archiveDates) || !state.tests) {
    throw new Error("Saved NBA analysis state is invalid; refusing to replace its history.");
  }
  return state;
}
async function readSeasonRecords(season: string) {
  const result = await runTursoSql([`SELECT payload_json FROM dataset_rows WHERE sport='NBA' AND dataset=${q(NBA_TREND_RECORDS_TAB)} AND date_key>=${q(`${season}-07-01`)} AND date_key<${q(`${Number(season) + 1}-07-01`)}`]);
  return result[0].map(row => JSON.parse(row.payload_json) as TursoRow);
}

/** Called only by the existing paced collector. Public page reads never write. */
export async function refreshNbaAnalysis(date: string, currentSchedule: TursoRow[], now = Date.now()) {
  const state = await readNbaAnalysis(date);
  const dates = [...new Set([...state.pendingDates, date])].sort();
  // Seed existing frozen observations once. Ordinary ticks keep the same bounded
  // day reads and update compact daily totals in the existing analysis row.
  const seedResearch = state.signalResearch?.version !== SIGNAL_RESEARCH_VERSION;
  const signalDates = seedResearch ? [...new Set([...state.archiveDates, ...dates])].sort() : dates;
  const schedule = [...currentSchedule];
  const previousDays = await Promise.all(dates.filter(day => day !== date).map(async day => {
    const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${day.replaceAll("-", "")}&limit=1000`,
      { cache: "no-store", signal: AbortSignal.timeout(12_000), headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`NBA pending-result schedule request failed: ${response.status}`);
    return nbaScheduleRows(normalizeNbaSlate(await response.json(), day), now);
  }));
  schedule.push(...previousDays.flat());
  const [snapshots, existingRecords, storedSignals, splits, forecasts] = await Promise.all([
    readTursoDatasetByDateKeys("NBA", "public_split_snapshots", dates),
    readTursoDatasetByDateKeys("NBA", NBA_TREND_RECORDS_TAB, dates),
    readTursoDatasetByDateKeys("NBA", NBA_SIGNALS_TAB, signalDates),
    readTursoDatasetByDateKeys("NBA", "weekly_market_trends", dates),
    Promise.all(dates.map(async day => [day, await readNbaForecasts(day)] as const)),
  ]);
  const prior = new Map(existingRecords.map(row => [nbaRowKey(row), row]));
  const changedRecords = settleNbaTrendRows(snapshots, schedule, now).filter(row => {
    const old = prior.get(nbaRowKey(row));
    return !old || old.Result !== row.Result || old["Actual Away Runs"] !== row["Actual Away Runs"] || old["Actual Home Runs"] !== row["Actual Home Runs"];
  });
  // Full-season catalog work happens only when a result changes, never on each
  // page load or ordinary market tick. Day reads and saved rollups cover those.
  if (changedRecords.length) {
    await saveNbaMarketRows(NBA_TREND_RECORDS_TAB, changedRecords);
    const records = await readSeasonRecords(state.season);
    state.leaderboard = buildNbaTrendLeaderboard(records, now);
    state.leaderboardAsOf = new Date(now).toISOString();
    state.teamHistory = mergeNbaTeamHistory(state.teamHistory, records, schedule);
  } else state.teamHistory = mergeNbaTeamHistory(state.teamHistory, existingRecords, schedule);
  for (const rows of previousDays) await saveNbaMarketRows("schedule", rows);
  const forecastDates = new Map(forecasts);
  if (seedResearch) state.signalResearch = { version: SIGNAL_RESEARCH_VERSION, days: buildSignalResearchDays(
    signalDates.flatMap(day => readSavedFootballSignalsForDate(storedSignals, day, now, NBA_SIGNALS_POLICY)), NBA_SIGNALS_POLICY.version, now) };
  let captured = 0, settled = 0;
  for (const day of dates) {
    const result = buildNbaSignals({ date: day, games: schedule.filter(row => row.Date === day), splits: splits.filter(row => row.Date === day),
      forecasts: forecastDates.get(day) || [], storedRows: storedSignals.filter(row => row.Date === day), state, now, capture: true });
    const changed: TursoRow[] = result.changedRows.map(row => ({ ...row, "Game Key": JSON.parse(row["Details JSON"]).gameKey }));
    await saveNbaMarketRows(NBA_SIGNALS_TAB, changed);
    captured += changed.filter(row => !row.Result).length; settled += changed.filter(row => Boolean(row.Result)).length;
    state.tests = result.tests;
    state.signalResearch = result.signalResearch;
  }
  state.archiveDates = [...new Set([...state.archiveDates, ...schedule.map(row => row.Date)])].sort();
  state.pendingDates = dates.filter(day => schedule.some(row => row.Date === day && !/FINAL|CANCEL|POSTPON/i.test(row.Status)));
  await saveNbaMarketRows(NBA_ANALYSIS_TAB, [{ Date: `season-${state.season}`, "Game Key": `nba-analysis|${state.season}`,
    Market: "State", Selection: "NBA", "Details JSON": JSON.stringify(state) }]);
  console.info("[nba-analysis]", JSON.stringify({ date, gradedSides: changedRecords.length, capturedSides: captured, settledSides: settled,
    rankedTrends: state.leaderboard.length, pendingDates: state.pendingDates.length }));
  return { gradedSides: changedRecords.length, capturedSides: captured, settledSides: settled, rankedTrends: state.leaderboard.length };
}
