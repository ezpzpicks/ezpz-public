import { loadScoresAndOddsConsensus } from "./scoresAndOddsBettingSplits";
import { readTursoDatasetByDateKeys } from "./tursoStore";
import { advanceNbaMarkets, bindNbaSplits, NBA_MARKET_POLICY, nbaDate, normalizeNbaSlate } from "./nbaMarketCore";
import { saveNbaMarketRows } from "./nbaMarketStore";
import { readNbaForecasts } from "./nbaForecasts";
import { nbaScheduleRows, readNbaAnalysis, refreshNbaAnalysis } from "./nbaAnalysis";
import { buildNbaSignals } from "./nbaAnalysisCore";
import { NBA_SIGNALS_TAB } from "./nbaTrendLeaderboard";

export async function collectNbaMarket({ persist = true, now = Date.now() } = {}) {
  const date = nbaDate(now);
  const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${date.replaceAll("-", "")}&limit=1000`, {
    cache: "no-store", signal: AbortSignal.timeout(12_000), headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`ESPN NBA schedule request failed: ${response.status}`);
  const games = normalizeNbaSlate(await response.json(), date);
  const loaded = await loadScoresAndOddsConsensus("NBA");
  const capturedAt = Date.now();
  const bound = bindNbaSplits(loaded.splits, games, capturedAt);
  const upcoming = games.filter(g => g.status === "STATUS_SCHEDULED" && Date.parse(g.tipoff) > capturedAt);
  if (upcoming.length && !bound.rows.length) throw new Error(`NBA ScoresAndOdds returned no complete matching spread/total pairs: ${bound.missing.join(", ")}`);
  const previous = await readTursoDatasetByDateKeys("NBA", "weekly_market_trends", [date]);
  const advanced = advanceNbaMarkets(bound.rows, previous, capturedAt);
  const schedule = nbaScheduleRows(games, capturedAt);
  let analysis;
  if (persist) {
    await saveNbaMarketRows("schedule", schedule);
    await saveNbaMarketRows("posted_games", schedule);
    await saveNbaMarketRows("weekly_market_trends", advanced.latest);
    await saveNbaMarketRows("odds_snapshot", advanced.history, true);
    await saveNbaMarketRows("public_split_snapshots", advanced.finals);
    analysis = await refreshNbaAnalysis(date, schedule, capturedAt);
  }
  return { ok: true, sport: "NBA", date, source: "ScoresAndOdds", sourceUrl: loaded.url,
    policy: NBA_MARKET_POLICY, capturedAt: new Date(capturedAt).toISOString(), dryRun: !persist,
    games: games.length, matchedGames: bound.rows.length / 4, updatedSides: advanced.latest.length,
    finalSides: advanced.finals.length, historySides: advanced.history.length,
    missingMarkets: bound.missing, errors: bound.errors, partial: bound.missing.length > 0,
    refreshCompleted: bound.missing.length === 0, analysis };
}

export async function readNbaPublicData(date = nbaDate()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T12:00:00Z`))
    || new Date(`${date}T12:00:00Z`).toISOString().slice(0,10) !== date) throw new Error("Choose a valid NBA slate date.");
  const [games, splits, forecasts, state, storedRows] = await Promise.all([
    readTursoDatasetByDateKeys("NBA", "schedule", [date]),
    readTursoDatasetByDateKeys("NBA", "weekly_market_trends", [date]),
    readNbaForecasts(date), readNbaAnalysis(date), readTursoDatasetByDateKeys("NBA", NBA_SIGNALS_TAB, [date]),
  ]);
  const analysis = buildNbaSignals({ date, games, splits, forecasts, storedRows, state });
  const lastUpdated = splits.map(r => r["Updated At"]).filter(Boolean).sort().at(-1) || "";
  const zero = { label: "NBA model", record: "0-0-0", totalBets: 0, winPct: 0, unitsWon: 0, roiPct: 0, wins: 0, losses: 0, pushes: 0 };
  return { ok: true, sport: "NBA", today: date, lastUpdated,
    tiles: { last7Days: zero, overallGreen: zero, pendingGreen: 0, bestPlaysToday: 0 },
    bestPlays: [], slateToday: games, betTrackerRows: [], trendPlays: [], recordSummary: [], last7RecordSummary: [],
    nbaMarket: { source: "ScoresAndOdds", date, availableDates: [...new Set([date, ...state.archiveDates])].sort(), games, splits, forecasts,
      trendPlays: analysis.plays, leaderboard: state.leaderboard, signals: analysis.board, stale: analysis.stale,
      refreshPolicy: "30 minutes until 90 minutes before tipoff, then 5 minutes", finalWindow: "10–20 minutes before tipoff" } };
}
