import { loadScoresAndOddsConsensus } from "./scoresAndOddsBettingSplits";
import { readTursoDatasetByDateKeys, runTursoSql, type TursoRow } from "./tursoStore";
import { advanceNbaMarkets, bindNbaSplits, NBA_MARKET_POLICY, nbaDate, normalizeNbaSlate, settleNbaForecast } from "./nbaMarketCore";
import { saveNbaMarketRows } from "./nbaMarketStore";

const q = (value: string) => `'${value.replaceAll("'", "''")}'`;

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
  const schedule: TursoRow[] = games.map(game => ({ Date: date, "Game ID": game.gameId,
    "Game Key": `${date}|nba|${game.gameId}`, "Game Time": game.tipoff, Game: `${game.away} @ ${game.home}`,
    "Away Team": game.away, "Home Team": game.home, "Away Team ID": game.awayId, "Home Team ID": game.homeId,
    Status: game.status, "Away Score": game.awayScore == null ? "" : String(game.awayScore),
    "Home Score": game.homeScore == null ? "" : String(game.homeScore), Source: "ESPN schedule; ScoresAndOdds market lines" }));
  if (persist) {
    await saveNbaMarketRows("schedule", schedule);
    await saveNbaMarketRows("posted_games", schedule);
    await saveNbaMarketRows("weekly_market_trends", advanced.latest);
    await saveNbaMarketRows("odds_snapshot", advanced.history, true);
    await saveNbaMarketRows("public_split_snapshots", advanced.finals);
  }
  return { ok: true, sport: "NBA", date, source: "ScoresAndOdds", sourceUrl: loaded.url,
    policy: NBA_MARKET_POLICY, capturedAt: new Date(capturedAt).toISOString(), dryRun: !persist,
    games: games.length, matchedGames: bound.rows.length / 4, updatedSides: advanced.latest.length,
    finalSides: advanced.finals.length, historySides: advanced.history.length,
    missingMarkets: bound.missing, errors: bound.errors, partial: bound.missing.length > 0,
    refreshCompleted: bound.missing.length === 0 };
}

export async function readNbaPublicData(date = nbaDate()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T12:00:00Z`))
    || new Date(`${date}T12:00:00Z`).toISOString().slice(0,10) !== date) throw new Error("Choose a valid NBA slate date.");
  const [games, splits, forecasts] = await Promise.all([
    readTursoDatasetByDateKeys("NBA", "schedule", [date]),
    readTursoDatasetByDateKeys("NBA", "weekly_market_trends", [date]),
    runTursoSql([`SELECT p.game_id,p.model_version,p.locked_at,json_extract(p.payload_json,'$.tipoff') AS tipoff,json_extract(p.payload_json,'$.selected') AS selected,json_extract(p.payload_json,'$.inputs.automation.phase') AS phase,json_extract(p.payload_json,'$.review_method') AS review_method,(SELECT json_extract(r.payload_json,'$.game') FROM nba_research_results r WHERE r.game_id=p.game_id ORDER BY r.observed_at DESC LIMIT 1) AS observed_game FROM nba_research_predictions p WHERE p.locked_at>=${q(`${date}T00:00:00+00:00`)} AND p.locked_at<${q(`${new Date(Date.parse(`${date}T00:00:00Z`)+2*86_400_000).toISOString().slice(0,10)}T00:00:00+00:00`)} ORDER BY p.locked_at DESC`])
      .then(result => result[0].flatMap(row => {
        if (!row.tipoff || nbaDate(Date.parse(row.tipoff)) !== date) return [];
        const selected = JSON.parse(row.selected);
        const settled = settleNbaForecast(selected, row.observed_game ? JSON.parse(row.observed_game) : null, row.game_id, row.locked_at);
        const { away_rotation, home_rotation, flags, ...summary } = selected;
        return [{ gameId: row.game_id, modelVersion: row.model_version, lockedAt: row.locked_at,
          tipoff: row.tipoff, phase: row.phase || "manual", reviewMethod: row.review_method || "manual",
          ...summary, ...settled }];
      })).catch(error => {
        // A brand-new integration can be read before its first builder creates
        // the research tables. Connectivity/permission errors must still fail.
        if (String(error).toLowerCase().includes("no such table")) return [];
        throw error;
      }),
  ]);
  const lastUpdated = splits.map(r => r["Updated At"]).filter(Boolean).sort().at(-1) || "";
  const zero = { label: "NBA model", record: "0-0-0", totalBets: 0, winPct: 0, unitsWon: 0, roiPct: 0, wins: 0, losses: 0, pushes: 0 };
  return { ok: true, sport: "NBA", today: date, lastUpdated,
    tiles: { last7Days: zero, overallGreen: zero, pendingGreen: 0, bestPlaysToday: 0 },
    bestPlays: [], slateToday: games, betTrackerRows: [], trendPlays: [], recordSummary: [], last7RecordSummary: [],
    nbaMarket: { source: "ScoresAndOdds", games, splits, forecasts,
      stale: splits.some(row => row["Snapshot Status"] !== "FINAL_PREGAME" && Date.parse(row["Game Time"]) > Date.now()
        && Date.now()-Date.parse(row["Updated At"]) > (Date.parse(row["Game Time"])-Date.now() <= 90*60_000 ? 10 : 35)*60_000),
      refreshPolicy: "30 minutes until 90 minutes before tipoff, then 5 minutes", finalWindow: "10–20 minutes before tipoff" } };
}
