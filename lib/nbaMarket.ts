import { loadScoresAndOddsConsensus } from "./scoresAndOddsBettingSplits";
import { readTursoDatasetByDateKeys } from "./tursoStore";
import { advanceNbaMarkets, bindNbaSplits, NBA_MARKET_POLICY, nbaDate, normalizeNbaSlate } from "./nbaMarketCore";
import { saveNbaMarketRows } from "./nbaMarketStore";
import { readNbaForecasts } from "./nbaForecasts";
import { nbaScheduleRows, readNbaAnalysis, refreshNbaAnalysis } from "./nbaAnalysis";
import { buildNbaSignals } from "./nbaAnalysisCore";
import { NBA_SIGNALS_TAB } from "./nbaTrendLeaderboard";
import { NBA_MODEL_RECORD_POLICY, nbaEzpzSelections, nbaModelPlays, nbaRecordTotals, summarizeNbaModelRecords, updateNbaModelRecords } from "./nbaRecords";
import { readNbaModelRecordSeed } from "./nbaModelRecordStore";
import { readNbaSavedLineups, refreshNbaLineups } from "./nbaLineups";
import { mergeNbaLineups, type NbaGameLineup } from "./nbaLineupsCore";
import { signalEzpzPayload } from "./signalPicks";

export async function collectNbaMarket({ persist = true, now = Date.now(), refresh }: {
  persist?: boolean; now?: number; refresh?: { policy: string; intervalMinutes: number };
} = {}) {
  const date = nbaDate(now);
  const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${date.replaceAll("-", "")}&limit=1000`, {
    cache: "no-store", signal: AbortSignal.timeout(12_000), headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`ESPN NBA schedule request failed: ${response.status}`);
  const games = normalizeNbaSlate(await response.json(), date);
  const schedule = nbaScheduleRows(games, now);
  // Persist the verified schedule even while lines are unpublished. Otherwise
  // a cold/new-date collector cannot know when to enter the final countdown.
  if (persist) {
    await saveNbaMarketRows("schedule", schedule);
    await saveNbaMarketRows("posted_games", schedule);
  }
  const loaded = await loadScoresAndOddsConsensus("NBA", { date });
  const capturedAt = Date.now();
  const bound = bindNbaSplits(loaded.splits, games, capturedAt);
  const upcoming = games.filter(g => g.status === "STATUS_SCHEDULED" && Date.parse(g.tipoff) > capturedAt);
  if (upcoming.length && !bound.rows.length) throw new Error(`NBA ScoresAndOdds returned no complete matching spread/total pairs: ${bound.missing.join(", ")}`);
  const previous = await readTursoDatasetByDateKeys("NBA", "weekly_market_trends", [date]);
  const advanced = advanceNbaMarkets(bound.rows, previous, capturedAt);
  let analysis;
  if (persist) {
    await saveNbaMarketRows("weekly_market_trends", advanced.latest);
    await saveNbaMarketRows("odds_snapshot", advanced.history, true);
    await saveNbaMarketRows("public_split_snapshots", advanced.finals);
    analysis = await refreshNbaAnalysis(date, schedule, capturedAt, refresh);
  }
  // A lineup-provider outage must never prevent a real market observation or
  // its final pregame lock from being saved.
  let lineups;
  try { lineups = await refreshNbaLineups(date, games, persist, capturedAt); }
  catch (error) {
    console.warn("NBA lineup refresh unavailable; market snapshots saved independently", error);
    lineups = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  return { ok: true, sport: "NBA", date, source: "ScoresAndOdds", sourceUrl: loaded.url,
    policy: NBA_MARKET_POLICY, capturedAt: new Date(capturedAt).toISOString(), dryRun: !persist,
    games: games.length, matchedGames: bound.rows.length / 4, updatedSides: advanced.latest.length,
    finalSides: advanced.finals.length, historySides: advanced.history.length,
    missingMarkets: bound.missing, errors: bound.errors, partial: bound.missing.length > 0,
    refreshCompleted: bound.missing.length === 0, lineups, analysis };
}

export async function readNbaPublicData(date = nbaDate()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T12:00:00Z`))
    || new Date(`${date}T12:00:00Z`).toISOString().slice(0,10) !== date) throw new Error("Choose a valid NBA slate date.");
  const [games, splits, forecasts, state, storedRows, savedLineups] = await Promise.all([
    readTursoDatasetByDateKeys("NBA", "schedule", [date]),
    readTursoDatasetByDateKeys("NBA", "weekly_market_trends", [date]),
    readNbaForecasts(date), readNbaAnalysis(date), readTursoDatasetByDateKeys("NBA", NBA_SIGNALS_TAB, [date]),
    readNbaSavedLineups(date),
  ]);
  const lineups = mergeNbaLineups(forecasts.flatMap(forecast => forecast.lineup ? [forecast.lineup as NbaGameLineup] : []), savedLineups);
  const analysis = buildNbaSignals({ date, games, splits, forecasts, storedRows, state });
  const lastObservation = splits.map(r => r["Updated At"]).filter(Boolean).sort().at(-1) || "";
  const lastUpdated = Number.isFinite(Date.parse(lastObservation)) ? new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short",
  }).format(new Date(lastObservation)) : "";
  const savedModels = state.modelRecords?.version === NBA_MODEL_RECORD_POLICY ? state.modelRecords : await readNbaModelRecordSeed(date);
  const modelRecords = summarizeNbaModelRecords(updateNbaModelRecords(savedModels, forecasts, games, Date.now(), [date]), date);
  const modelPlays = nbaModelPlays(forecasts, games);
  const ezpzHistory = nbaEzpzSelections(Object.values(analysis.tests));
  const ezpzSelections = nbaEzpzSelections(analysis.board.sides.filter(side => side.selected));
  const last7Start = new Date(Date.parse(`${date}T12:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10);
  const ezpzRecords = { overall: nbaRecordTotals(ezpzHistory.filter(row => row.date <= date)),
    last7Days: nbaRecordTotals(ezpzHistory.filter(row => row.date >= last7Start && row.date <= date)),
    history: ezpzHistory.filter(row => row.date <= date).sort((a, b) => b.gameTime.localeCompare(a.gameTime)) };
  return { ok: true, sport: "NBA", today: date, lastUpdated, ...signalEzpzPayload(analysis.board, "NBA", date),
    tiles: { last7Days: { ...modelRecords.last7Days, label: "NBA model" }, overallGreen: { ...modelRecords.overall, label: "NBA model" },
      pendingGreen: modelPlays.filter(row => !row.result).length, bestPlaysToday: modelPlays.length },
    bestPlays: modelPlays, slateToday: games, betTrackerRows: [], trendPlays: analysis.plays, recordSummary: [], last7RecordSummary: [],
    nbaMarket: { source: "ScoresAndOdds", date, availableDates: [...new Set([date, ...state.archiveDates])].sort(), games, splits,
      forecasts: forecasts.map(({ lineup, ...forecast }) => forecast),
      modelRecords, modelPlays, ezpzSelections, ezpzRecords, lineups,
      trendPlays: analysis.plays, leaderboard: state.leaderboard, signals: analysis.board, stale: analysis.stale,
      refreshPolicy: "30 minutes until 90 minutes before tipoff, then 5 minutes", finalWindow: "10–20 minutes before tipoff" } };
}
