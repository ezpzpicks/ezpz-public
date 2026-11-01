import { loadScoresAndOddsConsensus } from "./scoresAndOddsBettingSplits";
import { readTursoDatasetByDateKeys } from "./tursoStore";
import { advanceNcaamMarkets, bindNcaamSplits, NCAAM_MARKET_POLICY, ncaamDate, normalizeNcaamSlate, settleNcaamForecast } from "./ncaamMarketCore";
import { saveNcaamMarketRows } from "./ncaamMarketStore";
import { readNcaamForecasts } from "./ncaamForecasts";
import { ncaamScheduleRows, readNcaamAnalysis, refreshNcaamAnalysis } from "./ncaamAnalysis";
import { buildNcaamSignals } from "./ncaamAnalysisCore";
import { NCAAM_SIGNALS_TAB } from "./ncaamTrendLeaderboard";
import { NCAAM_MODEL_RECORD_POLICY, ncaamEzpzSelections, ncaamModelPlays, ncaamRecordTotals, summarizeNcaamModelRecords, updateNcaamModelRecords } from "./ncaamRecords";

import { loadNcaamSos } from "./ncaamSos";

import { signalEzpzPayload } from "./signalPicks";
import { readNcaamSavedLineups, refreshNcaamLineups } from "./ncaamLineups";
import { mergeNbaLineups } from "./nbaLineupsCore";

export async function collectNcaamMarket({ persist = true, now = Date.now(), refresh }: {
  persist?: boolean; now?: number; refresh?: { policy: string; intervalMinutes: number };
} = {}) {
  const date = ncaamDate(now);
  const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${date.replaceAll("-", "")}&groups=50&limit=1000`, {
    cache: "no-store", signal: AbortSignal.timeout(12_000), headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`ESPN NCAAM schedule request failed: ${response.status}`);
  const games = normalizeNcaamSlate(await response.json(), date);
  const schedule = ncaamScheduleRows(games, now);
  // Persist the verified schedule even while lines are unpublished. Otherwise
  // a cold/new-date collector cannot know when to enter the final countdown.
  if (persist) {
    await saveNcaamMarketRows("schedule", schedule);
    await saveNcaamMarketRows("posted_games", schedule);
  }
  // A split-provider outage must not prevent schedule/result/SOS updates.
  let sourceError = "";
  const loaded = await loadScoresAndOddsConsensus("NCAAB", { date }).catch(error => {
    sourceError = error instanceof Error ? error.message : String(error);
    return { splits: [], url: "https://www.scoresandodds.com/ncaab/consensus-picks" };
  });
  const capturedAt = Date.now();
  const bound = bindNcaamSplits(loaded.splits, games, capturedAt);
  const upcoming = games.filter(g => g.status === "STATUS_SCHEDULED" && Date.parse(g.tipoff) > capturedAt);

  const previous = await readTursoDatasetByDateKeys("NCAAM", "weekly_market_trends", [date]);
  const advanced = advanceNcaamMarkets(bound.rows, previous, capturedAt);
  let analysis, lineups;
  if (persist) {
    await saveNcaamMarketRows("weekly_market_trends", advanced.latest);
    await saveNcaamMarketRows("odds_snapshot", advanced.history, true);
    await saveNcaamMarketRows("public_split_snapshots", advanced.finals);
    analysis = await refreshNcaamAnalysis(date, schedule, capturedAt, refresh);
    lineups = await refreshNcaamLineups(date, games, persist, capturedAt);
  }
  return { ok: true, sport: "NCAAM", date, source: "ScoresAndOdds", sourceUrl: loaded.url,
    policy: NCAAM_MARKET_POLICY, capturedAt: new Date(capturedAt).toISOString(), dryRun: !persist,
    games: games.length, matchedGames: bound.rows.length / 4, updatedSides: advanced.latest.length,
    finalSides: advanced.finals.length, historySides: advanced.history.length,
    missingMarkets: bound.missing, errors: [...bound.errors, ...(sourceError ? [sourceError] : [])], partial: Boolean(sourceError) || bound.missing.length > 0,
    refreshCompleted: !sourceError && bound.missing.length === 0, analysis, lineups };
}

export async function readNcaamPublicData(date = ncaamDate()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T12:00:00Z`))
    || new Date(`${date}T12:00:00Z`).toISOString().slice(0,10) !== date) throw new Error("Choose a valid NCAAM slate date.");
  const [games, splits, rawForecasts, state, storedRows, sos, savedLineups] = await Promise.all([
    readTursoDatasetByDateKeys("NCAAM", "schedule", [date]),
    readTursoDatasetByDateKeys("NCAAM", "weekly_market_trends", [date]),
    readNcaamForecasts(date), readNcaamAnalysis(date), readTursoDatasetByDateKeys("NCAAM", NCAAM_SIGNALS_TAB, [date]),
    loadNcaamSos(Number(date.slice(0,4)) + (Number(date.slice(5,7)) >= 7 ? 1 : 0)),
    readNcaamSavedLineups(date),
  ]);
  const now = Date.now();
  const forecasts = rawForecasts.map(forecast => {
    const game = games.find(game => game["Game ID"] === forecast.gameId && Date.parse(game["Game Time"]) === Date.parse(forecast.tipoff)
      && game["Away Team"] === forecast.away_team && game["Home Team"] === forecast.home_team);
    const observed = Date.parse(game?.["Result Updated"] || "");
    if (!game || game.Source !== "ESPN NCAAM schedule; ScoresAndOdds market lines" || game.Completed !== "TRUE" || game.Status !== "STATUS_FINAL" || !Number.isFinite(observed) || observed > now) return forecast;
    const result = settleNcaamForecast(forecast, { game_id: forecast.gameId, completed: true, status: "STATUS_FINAL", tipoff: forecast.tipoff,
      away: { name: forecast.away_team, score: Number(game["Away Score"]) }, home: { name: forecast.home_team, score: Number(game["Home Score"]) },
      source: { observed_at: game["Result Updated"] } }, forecast.gameId, forecast.lockedAt);
    return { ...forecast, ...result };
  });
  const analysis = buildNcaamSignals({ date, games, splits, forecasts, storedRows, state, sos });
  const lineups = mergeNbaLineups(forecasts.flatMap(f => f.lineup?.sport === "NCAAM" ? [f.lineup] : []), savedLineups);
  const lastObservation = splits.map(r => r["Updated At"]).filter(Boolean).sort().at(-1) || "";
  const lastUpdated = Number.isFinite(Date.parse(lastObservation)) ? new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short",
  }).format(new Date(lastObservation)) : "";
  const savedModels = state.modelRecords?.version === NCAAM_MODEL_RECORD_POLICY ? state.modelRecords : undefined;
  const modelRecords = summarizeNcaamModelRecords(updateNcaamModelRecords(savedModels, forecasts, games, Date.now(), [date]), date);
  const modelPlays = ncaamModelPlays(forecasts, games);
  const ezpzHistory = ncaamEzpzSelections(Object.values(analysis.tests));
  const ezpzSelections = ncaamEzpzSelections(analysis.board.sides.filter(side => side.selected));
  const last7Start = new Date(Date.parse(`${date}T12:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10);
  const ezpzRecords = { overall: ncaamRecordTotals(ezpzHistory.filter(row => row.date <= date)),
    last7Days: ncaamRecordTotals(ezpzHistory.filter(row => row.date >= last7Start && row.date <= date)),
    history: ezpzHistory.filter(row => row.date <= date).sort((a, b) => b.gameTime.localeCompare(a.gameTime)) };
  return { ok: true, sport: "NCAAM", today: date, lastUpdated, ...signalEzpzPayload(analysis.board, "NCAAM", date),
    tiles: { last7Days: { ...modelRecords.last7Days, label: "NCAAM model" }, overallGreen: { ...modelRecords.overall, label: "NCAAM model" },
      pendingGreen: modelPlays.filter(row => !row.result).length, bestPlaysToday: modelPlays.length },
    bestPlays: modelPlays, slateToday: games, betTrackerRows: [], trendPlays: analysis.plays, recordSummary: [], last7RecordSummary: [],
    ncaamMarket: { sport: "NCAAM" as const, source: "ScoresAndOdds", date, availableDates: [...new Set([date, ...state.archiveDates])].sort(), games, splits,
      forecasts,
      modelRecords, modelPlays, ezpzSelections, ezpzRecords, lineups, warrenNolan: sos, modelStatus: "Research: completed-season priors, opponent-adjusted efficiencies and college player rotations; grades await validation",
      trendPlays: analysis.plays, leaderboard: state.leaderboard, signals: analysis.board, stale: analysis.stale,
      refreshPolicy: "30 minutes until 90 minutes before tipoff, then 5 minutes", finalWindow: "10–20 minutes before tipoff" } };
}
