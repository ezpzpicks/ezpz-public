"use client";

import { formatFullSlateDate } from "../lib/fullSlateDate";
import { MatchupWithLogos } from "./TeamLogoName";
import dynamic from "next/dynamic";
import type { FootballSignalsBoard } from "../lib/footballSignals";
import type { NcaafEzpzSubtype } from "../lib/ncaafEzpzWilson";
import { Fragment, useEffect, useState } from "react";
import { latestNbaForecasts, type NbaModelPlay, type NbaModelRecords, type NbaRecordTotals } from "../lib/nbaRecords";
import type { FootballSignalSide } from "../lib/footballSignals";
import type { NbaSignalTest } from "../lib/nbaAnalysisCore";
import NbaEzpzPicks from "./NbaEzpzPicks";
import NbaGameLineups, { NbaLineupProvider } from "./NbaGameLineups";
import NcaamModelDetails, { type NcaamModelContext } from "./NcaamModelDetails";
import type { NbaGameLineup } from "../lib/nbaLineupsCore";
import { ncaamMatchupGrade } from "../lib/ncaamMatchupGrades";
import NcaamMatchupGrade from "./NcaamMatchupGrade";
import { ncaamSpreadGrade } from "../lib/ncaamSpreadGrades";
import NcaamSpreadGrade from "./NcaamSpreadGrade";
import { ncaamPointProjection, isNcaamPointModel } from "../lib/ncaamPointEdges";
import { ncaamTrackingGradesPending } from "../lib/ncaamMarketTrackingPolicy";
import { ncaamProjectionAdjustments } from "../lib/ncaamProjectionAdjustments";
import ProjectionAdjustment from "./ProjectionAdjustment";
import NcaamMobileMatchup from "./NcaamMobileMatchup";
import { marketProjectionPending, projectionAdjustments } from "../lib/marketProjectionPolicy";
import { selectedSpreadSide } from "../lib/selectionSide";

const PublicSplits = dynamic(() => import("./NbaPublicSplits"), { loading: () => <div className="fs-empty">Loading NBA markets…</div> });
const Signals = dynamic(() => import("./FootballSignalsBoard"), { loading: () => <div className="fs-empty">Loading signals…</div> });
const Records = dynamic(() => import("./NbaRecords"), { loading: () => <div className="fs-empty">Loading NBA records…</div> });

type Row = Record<string, string>;
type Forecast = NcaamModelContext & {
  gameId: string; modelVersion: string; lockedAt: string; tipoff: string; phase: string;
  away_team: string; home_team: string; away_score: number; home_score: number;
  total: number; fair_home_spread: number; home_spread_edge: number | null; total_edge: number | null;
  spread_pick?: string; total_pick?: string; spread_grade?: string; total_grade?: string;
  spreadResult?: string; totalResult?: string;
  availability_mode?: "injury_feed" | "expected_rotation" | "rotowire_html";
  availability_source?: string; availability_as_of?: string; starters_confirmed?: boolean;
  market?: { home_spread: number; total: number; source: string; as_of: string } | null;
  grading_status?: string; market_tracking_effective_at?: string;
};
export type NbaMarketPayload = {
  sport?: "NBA" | "NCAAM";
  source: string; games: Row[]; splits: Row[]; forecasts: Forecast[]; stale: boolean;
  refreshPolicy: string; finalWindow: string;
  date?: string; availableDates?: string[]; trendPlays?: Record<string, any>[]; leaderboard?: NcaafEzpzSubtype[]; signals?: FootballSignalsBoard;
  modelRecords?: NbaModelRecords; modelPlays?: NbaModelPlay[]; ezpzSelections?: FootballSignalSide[];
  lineups?: NbaGameLineup[];
  ezpzRecords?: { overall: NbaRecordTotals; last7Days: NbaRecordTotals; history: NbaSignalTest[] };
};
const time = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleTimeString("en-US", {
  timeZone: "America/New_York", hour: "numeric", minute: "2-digit",
}) + " ET" : "Time unavailable";
const signed = (value: number) => `${value > 0 ? "+" : ""}${Number(value.toFixed(1))}`;
const byTipoff = (a: Forecast, b: Forecast) => Date.parse(a.tipoff) - Date.parse(b.tipoff);
const gameStatus = (game?: Row) => game?.Completed === "TRUE" || game?.Status === "STATUS_FINAL" ? "Final"
  : game?.Status === "STATUS_IN_PROGRESS" ? "In progress" : game?.Status === "STATUS_SCHEDULED" ? "Scheduled" : "";
function Score({ away, home, awayScore, homeScore, label, adjustments }: { away: string; home: string; awayScore: string; homeScore: string; label: string;
  adjustments?: ReturnType<typeof ncaamProjectionAdjustments> }) {
  return <div className={`nbaScoreBlock ${label === "Final score" ? "actualFinalScore" : ""}`}><p className="nbaSmall">{label}</p><div className="nbaScore">
    <div><span>{away}</span><strong>{awayScore}<ProjectionAdjustment points={adjustments?.awayScore} label={`${away} score`} /></strong></div>
    <div><span>{home}</span><strong>{homeScore}<ProjectionAdjustment points={adjustments?.homeScore} label={`${home} score`} /></strong></div>
  </div></div>;
}
function GameScore({ game }: { game?: Row }) {
  return game?.["Away Score"] && game?.["Home Score"] ? <Score away={game["Away Team"]} home={game["Home Team"]}
    awayScore={game["Away Score"]} homeScore={game["Home Score"]} label={gameStatus(game) === "Final" ? "Final score" : "Current score"} /> : null;
}
function ForecastCard({ forecast, game, qualifiedOnly = false, sport = "NBA" }: { forecast: Forecast; game?: Row; qualifiedOnly?: boolean; sport?: "NBA" | "NCAAM" }) {
  const gradingPending = marketProjectionPending(forecast) || (sport === "NCAAM" && ncaamTrackingGradesPending(forecast));
  const adjustments = sport === "NCAAM" ? ncaamProjectionAdjustments(forecast) : projectionAdjustments(forecast);
  const matchupGrade = sport === "NCAAM" && !gradingPending ? ncaamMatchupGrade(forecast) : null;
  const spreadGrade = sport === "NCAAM" && !gradingPending ? ncaamSpreadGrade(forecast) : null;
  const newPointModel = sport === "NCAAM" && isNcaamPointModel(forecast.modelVersion);
  const point = newPointModel ? ncaamPointProjection(forecast) : null;
  const awaySpread = selectedSpreadSide(sport, forecast.spread_pick, forecast.away_team, forecast.home_team,
    -forecast.fair_home_spread, forecast.market?.home_spread ?? null) === "away";
  const spreadSign = awaySpread ? -1 : 1;
  const spreadTeam = awaySpread ? forecast.away_team : forecast.home_team;
  const markets = [
    { name: "Spread", pick: forecast.spread_pick, grade: forecast.spread_grade, model: signed(spreadSign * forecast.fair_home_spread),
      line: forecast.market ? signed(spreadSign * forecast.market.home_spread) : "—", edge: forecast.home_spread_edge, result: forecast.spreadResult },
    { name: "Total", pick: forecast.total_pick, grade: forecast.total_grade, model: forecast.total.toFixed(1),
      line: forecast.market ? String(forecast.market.total) : "—", edge: forecast.total_edge, result: forecast.totalResult },
  ];
  if (newPointModel) for (const market of markets) {
    const captured = market.name === "Spread" ? spreadGrade : matchupGrade;
    market.grade = point && captured ? qualifiedOnly ? captured.grade : captured.edge_grade : "Research";
  }
  if (gradingPending) for (const market of markets) market.grade = "Ungraded";
  const card = <article className="nbaCard" data-game-id={forecast.gameId}>
    <h3><MatchupWithLogos sport={sport} game={`${forecast.away_team} @ ${forecast.home_team}`} /></h3>
    <p className="nbaMeta"><time dateTime={forecast.tipoff}>{time(forecast.tipoff)}</time>
      {gameStatus(game) && <span className="gameStatus" data-status={gameStatus(game)}>{gameStatus(game)}</span>}</p>
    <Score away={forecast.away_team} home={forecast.home_team} awayScore={forecast.away_score.toFixed(1)} homeScore={forecast.home_score.toFixed(1)} label="Projected score" adjustments={adjustments} />
    <div className="nbaMarkets">{markets.filter(market => !qualifiedOnly || ["A", "B"].includes(market.grade || "")).map(market => <section className="nbaMarketCard" key={market.name} aria-label={`${market.name} forecast`}>
      <div className="nbaMarketHeading"><h4>{market.name}</h4><span className="nbaGrade" data-grade={market.grade}>{gradingPending ? "Ungraded" : `Grade ${market.grade || "—"}`}</span></div>
      <strong className="nbaSelection">{market.pick || "No market line"}</strong>
      <dl className="nbaMetrics">
        <div><dt>{market.name === "Spread" ? "Model spread" : "Model total"}</dt><dd title={market.name === "Spread" ? spreadTeam : undefined}>{market.model}
          <ProjectionAdjustment points={market.name === "Spread" ? awaySpread ? adjustments?.awaySpread : adjustments?.homeSpread : adjustments?.total}
            label={market.name === "Spread" ? `${spreadTeam} strength` : "total"} /></dd></div>
        <div><dt>{market.name === "Spread" ? "Market spread" : "Market total"}</dt><dd>{market.line}</dd></div>
        <div><dt>{market.name === "Total" && matchupGrade && !point ? "Point-model lean" : "Edge"}</dt><dd>{market.name === "Total" && matchupGrade && !point
          ? forecast.numeric_total_pick || "—" : market.edge == null ? "—" : `${Math.abs(market.edge).toFixed(1)} pts`}</dd></div>
      </dl>
      {market.name === "Total" && matchupGrade && <NcaamMatchupGrade grade={matchupGrade} away={forecast.away_team} home={forecast.home_team} />}
      {market.name === "Spread" && spreadGrade && <NcaamSpreadGrade grade={spreadGrade} away={forecast.away_team} home={forecast.home_team} />}
      {newPointModel && (market.name === "Spread" ? spreadGrade : matchupGrade)?.eligible === false
        && ["A", "B"].includes(market.grade || "") ? <p className="nbaSmall">Projection only · Saved eligibility or price check did not qualify.</p> : null}
      {!gradingPending && market.result && <p className="nbaSmall">Result: <strong>{market.result}</strong></p>}
    </section>)}</div>
    <GameScore game={game} />
    <NbaGameLineups gameId={forecast.gameId} sport={sport} notice={forecast.availability_mode === "expected_rotation"
      ? "Expected rotation · Injury availability unchecked · Starters unconfirmed"
      : forecast.availability_mode === "rotowire_html" ? `RotoWire availability checked · ${forecast.starters_confirmed ? "Starting fives confirmed" : "Projected starting fives"} · Unresolved statuses remain conditional` : undefined} />
    {sport === "NCAAM" && <NcaamModelDetails forecast={forecast} />}
    <p className="nbaSmall forecastTimestamp">{gradingPending ? "Updated" : "Locked"} {time(forecast.lockedAt)}{forecast.market ? ` · ${forecast.market.source || "ScoresAndOdds"} ${time(forecast.market.as_of)} · assumed -110` : ""}</p>
  </article>;
  return <NcaamMobileMatchup sport={sport} forecast={forecast} game={game || {"Game ID": forecast.gameId, "Away Team":forecast.away_team, "Home Team":forecast.home_team, "Game Time":forecast.tipoff}} modelPlays={qualifiedOnly}
    markets={qualifiedOnly ? markets.filter(market => ["A", "B"].includes(market.grade || "")).map(market => ({name:market.name, selection:market.pick || "No market line", detail:market.edge == null ? "Edge unavailable" : `${Math.abs(market.edge).toFixed(1)} pt edge`, grade:`Grade ${market.grade}`, result:gradingPending ? undefined : market.result})) : undefined}>{card}</NcaamMobileMatchup>;
}

function MissingForecastCard({ game, splits, sport = "NBA" }: { game: Row; splits: Row[]; sport?: "NBA" | "NCAAM" }) {
  const homeSpread = splits.find(row => row["Game ID"] === game["Game ID"] && row.Market === "Spread" && row.Selection === game["Home Team"]);
  const total = splits.find(row => row["Game ID"] === game["Game ID"] && row.Market === "Total");
  const line = (row: Row | undefined, spread = false) => row?.Line?.trim() && Number.isFinite(Number(row.Line))
    ? spread ? signed(Number(row.Line)) : row.Line : "Not captured";
  return <article className="nbaCard" data-game-id={game["Game ID"]}>
    <h3><MatchupWithLogos sport={sport} game={`${game["Away Team"]} @ ${game["Home Team"]}`} /></h3>
    <p className="nbaMeta"><time dateTime={game["Game Time"]}>{time(game["Game Time"])}</time>{gameStatus(game) && <span>{gameStatus(game)}</span>}</p>
    <GameScore game={game} />
    <p className="nbaNotice">No saved model forecast for this matchup.</p>
    <dl className="nbaMarketQuotes">
      <div><dt>Market home spread · {game["Home Team"]}</dt><dd>{line(homeSpread, true)}</dd></div>
      <div><dt>Market total</dt><dd>{line(total)}</dd></div>
    </dl>
    <NbaGameLineups gameId={game["Game ID"]} sport={sport} />
  </article>;
}

function ModelSlate({ tab, data }: { tab: string; data: NbaMarketPayload }) {
  const sport = data.sport || "NBA";
  const latest = (latestNbaForecasts(data.forecasts) as Forecast[]).sort(byTipoff);
  const latestByGame = new Map(latest.map(forecast => [forecast.gameId, forecast]));
  const qualified = latest.filter(forecast => !marketProjectionPending(forecast) && !(sport === "NCAAM" && ncaamTrackingGradesPending(forecast))).filter(forecast => sport === "NCAAM" && isNcaamPointModel(forecast.modelVersion)
    ? ncaamSpreadGrade(forecast)?.eligible || ncaamMatchupGrade(forecast)?.eligible
    : [forecast.spread_grade, forecast.total_grade].some(grade => grade === "A" || grade === "B"));
  const games = [...data.games].sort((a, b) => Date.parse(a["Game Time"]) - Date.parse(b["Game Time"]));
  const fullSlate = tab === "Full Slate";
  const completed = games.filter(game => gameStatus(game) === "Final");
  const activeGames = games.filter(game => gameStatus(game) !== "Final")
    .sort((a, b) => Number(gameStatus(b) === "In progress") - Number(gameStatus(a) === "In progress"));
  const gameCard = (game: Row) => {
    const forecast = latestByGame.get(game["Game ID"]);
    const card = forecast ? <ForecastCard key={game["Game ID"]} forecast={forecast} game={game} sport={sport} />
      : <MissingForecastCard key={game["Game ID"]} game={game} splits={data.splits} sport={sport} />;
    return !forecast ? <NcaamMobileMatchup key={game["Game ID"]} sport={sport} game={game}>{card}</NcaamMobileMatchup> : card;
  };
  const timedCards = (items: Row[]) => items.map((game, index) => <Fragment key={game["Game ID"]}>
    {sport === "NCAAM" && (index === 0 || time(items[index - 1]["Game Time"]) !== time(game["Game Time"])) && <h3 className="ncaamStartTime"><time dateTime={game["Game Time"]}>{time(game["Game Time"])}</time></h3>}
    {gameCard(game)}
  </Fragment>);
  return <section className={`nbaBoard${fullSlate && sport === "NCAAM" ? " ncaamSlateTrial" : ""}`}>
    <div className="nbaIntro"><h2>{fullSlate ? <><span className="ncaamTitleSport">{sport} </span>Projections</> : `${sport} Model Plays`}</h2></div>
    {fullSlate ? <>{timedCards(activeGames)}
      {completed.length ? <details className="completedGames" open={!activeGames.length}>
        <summary>Completed games <span>{completed.length}</span></summary>
        <div className="completedGamesList">{timedCards(completed)}</div>
      </details> : null}
    </> : qualified.map(forecast => <ForecastCard key={`${forecast.gameId}-${forecast.modelVersion}-${forecast.lockedAt}`}
      forecast={forecast} sport={sport} qualifiedOnly game={games.find(game => game["Game ID"] === forecast.gameId)} />)}
    {!fullSlate && !qualified.length && <div className="nbaCard">{latest.some(f => marketProjectionPending(f) || (sport === "NCAAM" && ncaamTrackingGradesPending(f)))
      ? `New ${sport} grades are pending. Updated projections are available in Projections.`
      : `No ${sport} model plays for this slate.`}</div>}
    {fullSlate && !games.length && <div className="nbaCard">No {sport} games have been collected for this date.</div>}
  </section>;
}

function ArchivedSlate({ data, picks = false }: { data: NbaMarketPayload; picks?: boolean }) {
  const sport = data.sport || "NBA", field = sport === "NCAAM" ? "ncaamMarket" : "nbaMarket";
  const current = data.date || data.games[0]?.Date || "", [date, setDate] = useState(current);
  const [archive, setArchive] = useState<{ date: string; data?: NbaMarketPayload; error?: boolean } | null>(null);
  const [retry, setRetry] = useState(0), dates = [...new Set([current, ...(data.availableDates || [])])].filter(Boolean).sort();
  const selected = dates.includes(date) ? date : current;
  useEffect(() => {
    if (selected === current) return;
    const controller = new AbortController(); setArchive({ date: selected });
    void fetch(`/api/sport-public-data?sport=${sport}&date=${selected}`, { signal: controller.signal }).then(async response => {
      const value = await response.json();
      if (!response.ok || !value.ok || value.today !== selected || !value[field]) throw new Error("Saved slate unavailable");
      if (!controller.signal.aborted) setArchive({ date: selected, data: value[field] });
    }).catch(() => { if (!controller.signal.aborted) setArchive({ date: selected, error: true }); });
    return () => controller.abort();
  }, [selected, current, retry, sport, field]);
  const view = selected === current ? data : archive?.date === selected ? archive.data : undefined;
  return <div className={sport === "NCAAM" && !picks ? "ncaamArchive" : undefined}><div className={picks ? "nbaControls" : "fullSlateDateControl"}><label><span className="nbaDateLabel">{picks ? `View ${sport} picks slate` : "Slate date"}</span> <select aria-label={picks ? `View ${sport} picks slate` : `View ${sport} projections`} value={selected} onChange={event => setDate(event.target.value)} disabled={!dates.length}>
    {dates.map(day => <option key={day} value={day}>{picks ? day : formatFullSlateDate(day)}</option>)}</select></label></div>
    {view ? <NbaLineupProvider lineups={view.lineups}>{picks ? <NbaEzpzPicks data={view} /> : <ModelSlate tab="Full Slate" data={view} />}</NbaLineupProvider> : <div className="nbaBoard"><p className="nbaCard" role={archive?.error ? "alert" : "status"}>
      {archive?.error ? <>The saved slate could not be loaded. <button type="button" onClick={() => setRetry(n => n + 1)}>Try again</button></> : `Loading saved ${sport} slate…`}</p></div>}</div>;
}

export default function NbaBoard({ tab, data }: { tab: string; data: NbaMarketPayload }) {
  const view = tab === "Public Betting Splits" ? <PublicSplits data={data} />
    : tab === "Signals" ? <Signals board={data.signals} />
    : tab === "Records" ? <Records data={data} />
    : tab === "EZPZ Picks" ? <NbaEzpzPicks data={data} />
    : tab === "Full Slate" ? <ArchivedSlate data={data} /> : <ModelSlate tab={tab} data={data} />;
  return <NbaLineupProvider lineups={data.lineups}>{view}</NbaLineupProvider>;
}
