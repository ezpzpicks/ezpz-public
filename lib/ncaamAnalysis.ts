import { loadNcaamSos } from "./ncaamSos";
import { readTursoDatasetByDateKeys, runTursoSql, type TursoRow } from "./tursoStore";
import { saveNcaamMarketRows } from "./ncaamMarketStore";
import { readNcaamForecasts, readNcaamForecastHistory } from "./ncaamForecasts";
import { NCAAM_MODEL_RECORD_POLICY, updateNcaamModelRecords } from "./ncaamRecords";
import { ncaamRowKey, normalizeNcaamSlate, type NcaamGame } from "./ncaamMarketCore";
import { buildNcaamSignals, buildNcaamSignalTests, emptyNcaamAnalysis, mergeNcaamTeamHistory, ncaamSeason, settleNcaamTrendRows, ncaamRowsToPlays, NCAAM_ANALYSIS_VERSION, type NcaamAnalysisState } from "./ncaamAnalysisCore";
import { buildNcaamTrendLeaderboard, NCAAM_ANALYSIS_TAB, NCAAM_SIGNALS_TAB, NCAAM_TREND_RECORDS_TAB, NCAAM_SIGNALS_POLICY } from "./ncaamTrendLeaderboard";
import { readSavedFootballSignalsForDate } from "./footballSignals";
import { buildSignalResearchDays, SIGNAL_RESEARCH_VERSION } from "./signalCombinationResearch";
import { signalEzpzPayload, signalPickThreshold } from "./signalPicks";
import { attachSituationBoard } from "./situationStore";
import { persistEzpzCurrentPicks } from "./ezpzCurrentPicks";
import { captureSelectionTrial } from "./selectionTrialStore";
import type { TrialSide } from "./selectionTrial";

import { updateBasketballConsolidation } from "./basketballConsolidation";
import { consolidatedVersion, CONSOLIDATED_SPORT_EFFECTIVE_AT } from "./catalog/consolidatedSportCatalog";
import { ncaamDivisionOneSchedule } from "./ncaamDivisionOne";

const q = (value: string) => `'${value.replaceAll("'", "''")}'`;
export function ncaamScheduleRows(games: NcaamGame[], observedAt: number): TursoRow[] {
  return games.map(game => ({ Date: game.date, "Game ID": game.gameId, "Game Key": `${game.date}|ncaam|${game.gameId}`,
    "Game Time": game.tipoff, Game: `${game.away} @ ${game.home}`, "Away Team": game.away, "Home Team": game.home,
    "Away Team ID": game.awayId, "Home Team ID": game.homeId, Status: game.status, Completed: game.completed ? "TRUE" : "FALSE",
    "Away Score": game.awayScore == null ? "" : String(game.awayScore), "Home Score": game.homeScore == null ? "" : String(game.homeScore),
    "Neutral Site": game.neutralSite == null ? "" : String(game.neutralSite), Season: String(game.season),
    "Result Updated": game.completed ? new Date(observedAt).toISOString() : "", Source: "ESPN NCAAM schedule; ScoresAndOdds market lines" }));
}
export async function readNcaamAnalysis(date: string): Promise<NcaamAnalysisState> {
  const rows = await readTursoDatasetByDateKeys("NCAAM", NCAAM_ANALYSIS_TAB, [`season-${ncaamSeason(date)}`]);
  if (!rows.length) return emptyNcaamAnalysis(date);
  const state = JSON.parse(rows[0]["Details JSON"]);
  if (state.version !== NCAAM_ANALYSIS_VERSION || state.season !== ncaamSeason(date) || !Array.isArray(state.teamHistory)
    || !Array.isArray(state.leaderboard) || !Array.isArray(state.pendingDates) || !Array.isArray(state.archiveDates) || !state.tests) {
    throw new Error("Saved NCAAM analysis state is invalid; refusing to replace its history.");
  }
  return state;
}
async function readSeasonRecords(season: string) {
  const result = await runTursoSql([`SELECT payload_json FROM dataset_rows WHERE sport='NCAAM' AND dataset=${q(NCAAM_TREND_RECORDS_TAB)} AND date_key>=${q(`${season}-07-01`)} AND date_key<${q(`${Number(season) + 1}-07-01`)}`]);
  return result[0].map(row => JSON.parse(row.payload_json) as TursoRow);
}

/** Called only by the existing paced collector. Public page reads never write. */
export async function refreshNcaamAnalysis(date: string, currentSchedule: TursoRow[], now = Date.now(),
  refresh: { policy?: string; intervalMinutes?: number } = {}) {
  const state = await readNcaamAnalysis(date);
  const sos = await loadNcaamSos(Number(state.season) + 1, true, now);
  const dates = [...new Set([...state.pendingDates, date])].sort();
  // Seed existing frozen observations once. Ordinary ticks keep the same bounded
  // day reads and update compact daily totals in the existing analysis row.
  const seedConsolidation = now >= Date.parse(CONSOLIDATED_SPORT_EFFECTIVE_AT) && state.consolidation?.version !== consolidatedVersion("NCAAM");
  const seedResearch = state.signalResearch?.version !== SIGNAL_RESEARCH_VERSION;
  const seedSelections = state.selectionThreshold !== signalPickThreshold("NCAAM");
  const signalDates = seedConsolidation || seedResearch || seedSelections ? [...new Set([...state.archiveDates, ...dates])].sort() : dates;
  const schedule = ncaamDivisionOneSchedule(currentSchedule);
  const previousDays = await Promise.all(dates.filter(day => day !== date).map(async day => {
    const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${day.replaceAll("-", "")}&groups=50&limit=1000`,
      { cache: "no-store", signal: AbortSignal.timeout(12_000), headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`NCAAM pending-result schedule request failed: ${response.status}`);
    return ncaamScheduleRows(normalizeNcaamSlate(await response.json(), day), now);
  }));
  schedule.push(...previousDays.flat());
  const [snapshots, existingRecords, storedSignals, splits, forecasts] = await Promise.all([
    readTursoDatasetByDateKeys("NCAAM", "public_split_snapshots", dates),
    readTursoDatasetByDateKeys("NCAAM", NCAAM_TREND_RECORDS_TAB, dates),
    readTursoDatasetByDateKeys("NCAAM", NCAAM_SIGNALS_TAB, signalDates),
    readTursoDatasetByDateKeys("NCAAM", "weekly_market_trends", dates),
    Promise.all(dates.map(async day => [day, await readNcaamForecasts(day)] as const)),
  ]);
  const prior = new Map(existingRecords.map(row => [ncaamRowKey(row), row]));
  const changedRecords = settleNcaamTrendRows(snapshots, schedule, now).filter(row => {
    const old = prior.get(ncaamRowKey(row));
    return !old || old.Result !== row.Result || old["Actual Away Runs"] !== row["Actual Away Runs"] || old["Actual Home Runs"] !== row["Actual Home Runs"];
  });
  // Full-season catalog work happens only when a result changes, never on each
  // page load or ordinary market tick. Day reads and saved rollups cover those.
  let consolidationRecords: TursoRow[] | null = null;
  if (changedRecords.length) await saveNcaamMarketRows(NCAAM_TREND_RECORDS_TAB, changedRecords);
  if (changedRecords.length || seedConsolidation) {
    const records = await readSeasonRecords(state.season);
    consolidationRecords = records;
    state.leaderboard = buildNcaamTrendLeaderboard(records, now);
    state.leaderboardAsOf = new Date(now).toISOString();
    state.teamHistory = mergeNcaamTeamHistory(state.teamHistory, records, schedule);
  } else state.teamHistory = mergeNcaamTeamHistory(state.teamHistory, existingRecords, schedule);
  for (const rows of previousDays) await saveNcaamMarketRows("schedule", rows);
  const forecastDates = new Map(forecasts);
  // Once per threshold change, rebuild only the compact test rollup from saved
  // observations. Do not rerank trends, run models or rewrite captured evidence.
  if (seedSelections) {
    state.tests = buildNcaamSignalTests(signalDates.flatMap(day => readSavedFootballSignalsForDate(storedSignals, day, now, NCAAM_SIGNALS_POLICY)), now);
    state.selectionThreshold = signalPickThreshold("NCAAM");
  }
  if (state.modelRecords?.version !== NCAAM_MODEL_RECORD_POLICY) {
    state.modelRecords = updateNcaamModelRecords(undefined, await readNcaamForecastHistory(date), schedule, now);
  }
  state.modelRecords = updateNcaamModelRecords(state.modelRecords, forecasts.flatMap(([, rows]) => rows), schedule, now, dates);
  if (seedResearch) state.signalResearch = { version: SIGNAL_RESEARCH_VERSION, days: buildSignalResearchDays(
    signalDates.flatMap(day => readSavedFootballSignalsForDate(storedSignals, day, now, NCAAM_SIGNALS_POLICY)), NCAAM_SIGNALS_POLICY.version, now) };
  if (consolidationRecords && now >= Date.parse(CONSOLIDATED_SPORT_EFFECTIVE_AT)) {
    const sides = signalDates.flatMap(day => readSavedFootballSignalsForDate(storedSignals, day, now, NCAAM_SIGNALS_POLICY));
    Object.assign(state, updateBasketballConsolidation("NCAAM", state, consolidationRecords, sides,
      ncaamRowsToPlays(snapshots, now), now, NCAAM_SIGNALS_POLICY.version));
  }
  let captured = 0, settled = 0;
  const trialSides: TrialSide[] = [];
  let currentSignals: ReturnType<typeof buildNcaamSignals> | undefined;
  for (const day of dates) {
    const result = buildNcaamSignals({ date: day, games: schedule.filter(row => row.Date === day), splits: splits.filter(row => row.Date === day),
      forecasts: forecastDates.get(day) || [], storedRows: storedSignals.filter(row => row.Date === day), state, now, capture: true, sos });
    const changed: TursoRow[] = result.changedRows.map(row => ({ ...row, "Game Key": JSON.parse(row["Details JSON"]).gameKey }));
    await saveNcaamMarketRows(NCAAM_SIGNALS_TAB, changed);
    if (day === date) currentSignals = result;
    trialSides.push(...result.board.sides);
    captured += changed.filter(row => !row.Result).length; settled += changed.filter(row => Boolean(row.Result)).length;
    state.tests = result.tests;
    state.signalResearch = result.signalResearch;
    state.legacySignalResearch = result.legacySignalResearch;
  }
  state.archiveDates = [...new Set([...state.archiveDates, ...schedule.map(row => row.Date)])].sort();
  state.pendingDates = dates.filter(day => schedule.some(row => row.Date === day && !/FINAL|CANCEL|POSTPON/i.test(row.Status)));
  await saveNcaamMarketRows(NCAAM_ANALYSIS_TAB, [{ Date: `season-${state.season}`, "Game Key": `ncaam-analysis|${state.season}`,
    Market: "State", Selection: "NCAAM", "Details JSON": JSON.stringify(state) }]);
  // Reuse the just-saved signal board; no extra collection, model run, history
  // scan or page read. A durable pick snapshot owns the existing final event.
  if (!currentSignals) throw new Error("NCAAM current signal board was not prepared.");
  currentSignals.board = await attachSituationBoard(currentSignals.board, "NCAAM", true);
  await persistEzpzCurrentPicks("NCAAM", { today: date, lastUpdated: new Date(now).toISOString(),
    stale: currentSignals.stale, refreshPolicy: refresh.policy || "", refreshIntervalMinutes: refresh.intervalMinutes || 5,
    ...signalEzpzPayload(currentSignals.board, "NCAAM", date) }, now);
  try {
    await captureSelectionTrial("NCAAM", trialSides, currentSignals.board.sides.filter(s => s.recorded && s.selected).map(s => s.id),
      Date.now(), !currentSignals.board.captureAvailable);
  } catch (error) { console.error("NCAAM selection trial deferred; official picks preserved", error); }
  console.info("[ncaam-analysis]", JSON.stringify({ date, gradedSides: changedRecords.length, capturedSides: captured, settledSides: settled,
    rankedTrends: state.leaderboard.length, pendingDates: state.pendingDates.length }));
  return { gradedSides: changedRecords.length, capturedSides: captured, settledSides: settled, rankedTrends: state.leaderboard.length };
}

export async function migrateNcaamConsolidation(date: string, now = Date.now()) {
  const state = await readNcaamAnalysis(date);
  const dates = [...new Set([...state.archiveDates, ...state.pendingDates, date])].sort();
  const [records, signals, snapshots] = await Promise.all([readSeasonRecords(state.season),
    readTursoDatasetByDateKeys("NCAAM", NCAAM_SIGNALS_TAB, dates),
    readTursoDatasetByDateKeys("NCAAM", "public_split_snapshots", dates)]);
  const sides = dates.flatMap(day => readSavedFootballSignalsForDate(signals, day, now, NCAAM_SIGNALS_POLICY));
  const next = updateBasketballConsolidation("NCAAM", state, records, sides, ncaamRowsToPlays(snapshots, now), now, NCAAM_SIGNALS_POLICY.version);
  await saveNcaamMarketRows(NCAAM_ANALYSIS_TAB, [{ Date: `season-${state.season}`, "Game Key": `ncaam-analysis|${state.season}`,
    Market: "State", Selection: "NCAAM", "Details JSON": JSON.stringify(next) }]);
  return { ok: true, sport: "NCAAM", consolidation: next.consolidation, qualifiedTypes: next.leaderboard.length, replay: next.consolidationReplay.status };
}
