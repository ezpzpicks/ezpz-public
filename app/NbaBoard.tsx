"use client";

import { MatchupWithLogos } from "./TeamLogoName";
import dynamic from "next/dynamic";
import type { FootballSignalsBoard } from "../lib/footballSignals";
import type { NcaafEzpzSubtype } from "../lib/ncaafEzpzWilson";
import { useEffect, useState } from "react";
import { latestNbaForecasts, type NbaModelPlay, type NbaModelRecords, type NbaRecordTotals } from "../lib/nbaRecords";
import type { FootballSignalSide } from "../lib/footballSignals";
import type { NbaSignalTest } from "../lib/nbaAnalysisCore";
import NbaEzpzPicks from "./NbaEzpzPicks";
import NbaGameLineups, { NbaLineupProvider } from "./NbaGameLineups";
import type { NbaGameLineup } from "../lib/nbaLineupsCore";

const PublicSplits = dynamic(() => import("./NbaPublicSplits"), { loading: () => <div className="fs-empty">Loading NBA markets…</div> });
const Signals = dynamic(() => import("./FootballSignalsBoard"), { loading: () => <div className="fs-empty">Loading signals…</div> });
const Records = dynamic(() => import("./NbaRecords"), { loading: () => <div className="fs-empty">Loading NBA records…</div> });

type Row = Record<string, string>;
type Forecast = {
  gameId: string; modelVersion: string; lockedAt: string; tipoff: string; phase: string;
  away_team: string; home_team: string; away_score: number; home_score: number;
  total: number; fair_home_spread: number; home_spread_edge: number | null; total_edge: number | null;
  spread_pick?: string; total_pick?: string; spread_grade?: string; total_grade?: string;
  spreadResult?: string; totalResult?: string;
  availability_mode?: "injury_feed" | "expected_rotation" | "rotowire_html";
  availability_source?: string; availability_as_of?: string; starters_confirmed?: boolean;
  market?: { home_spread: number; total: number; source: string; as_of: string } | null;
};
export type NbaMarketPayload = {
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
function Score({ away, home, awayScore, homeScore, label }: { away: string; home: string; awayScore: string; homeScore: string; label: string }) {
  return <div className="nbaScoreBlock"><p className="nbaSmall">{label}</p><div className="nbaScore">
    <div><span>{away}</span><strong>{awayScore}</strong></div><div><span>{home}</span><strong>{homeScore}</strong></div>
  </div></div>;
}
function GameScore({ game }: { game?: Row }) {
  return game?.["Away Score"] && game?.["Home Score"] ? <Score away={game["Away Team"]} home={game["Home Team"]}
    awayScore={game["Away Score"]} homeScore={game["Home Score"]} label={gameStatus(game) === "Final" ? "Final score" : "Current score"} /> : null;
}
function ForecastCard({ forecast, game, qualifiedOnly = false }: { forecast: Forecast; game?: Row; qualifiedOnly?: boolean }) {
  const markets = [
    { name: "Spread", pick: forecast.spread_pick, grade: forecast.spread_grade, model: signed(forecast.fair_home_spread),
      line: forecast.market ? signed(forecast.market.home_spread) : "—", edge: forecast.home_spread_edge, result: forecast.spreadResult },
    { name: "Total", pick: forecast.total_pick, grade: forecast.total_grade, model: forecast.total.toFixed(1),
      line: forecast.market ? String(forecast.market.total) : "—", edge: forecast.total_edge, result: forecast.totalResult },
  ];
  return <article className="nbaCard" data-game-id={forecast.gameId}>
    <h3><MatchupWithLogos sport="NBA" game={`${forecast.away_team} @ ${forecast.home_team}`} /></h3>
    <p className="nbaMeta"><time dateTime={forecast.tipoff}>{time(forecast.tipoff)}</time><span>{forecast.phase === "pregame" ? "Pregame refresh" : forecast.phase === "early" ? "Early forecast" : "Manual forecast"}</span>
      {gameStatus(game) && <span>{gameStatus(game)}</span>}</p>
    {forecast.availability_mode === "expected_rotation" && <p className="nbaNotice">Expected rotation · Injury availability unchecked · Starters unconfirmed</p>}
    {forecast.availability_mode === "rotowire_html" && <p className="nbaNotice">RotoWire availability checked · {forecast.starters_confirmed ? "Starting fives confirmed" : "Projected starting fives"} · Unresolved statuses remain conditional</p>}
    <NbaGameLineups gameId={forecast.gameId} />
    <Score away={forecast.away_team} home={forecast.home_team} awayScore={forecast.away_score.toFixed(1)} homeScore={forecast.home_score.toFixed(1)} label="Projected score" />
    <div className="nbaMarkets">{markets.filter(market => !qualifiedOnly || ["A", "B"].includes(market.grade || "")).map(market => <section className="nbaMarketCard" key={market.name} aria-label={`${market.name} forecast`}>
      <div className="nbaMarketHeading"><h4>{market.name}</h4><span className="nbaGrade" data-grade={market.grade}>Grade {market.grade || "—"}</span></div>
      <strong className="nbaSelection">{market.pick || "No market line"}</strong>
      <dl className="nbaMetrics">
        <div><dt>{market.name === "Spread" ? "Model home spread" : "Model total"}</dt><dd>{market.model}</dd></div>
        <div><dt>{market.name === "Spread" ? "Market home spread" : "Market total"}</dt><dd>{market.line}</dd></div>
        <div><dt>Edge</dt><dd>{market.edge == null ? "—" : `${Math.abs(market.edge).toFixed(1)} pts`}</dd></div>
      </dl>
      {market.result && <p className="nbaSmall">Result: <strong>{market.result}</strong></p>}
    </section>)}</div>
    <GameScore game={game} />
    <p className="nbaSmall">Locked {time(forecast.lockedAt)}{forecast.market ? ` · ScoresAndOdds ${time(forecast.market.as_of)} · assumed -110` : ""}</p>
  </article>;
}

function MissingForecastCard({ game, splits }: { game: Row; splits: Row[] }) {
  const homeSpread = splits.find(row => row["Game ID"] === game["Game ID"] && row.Market === "Spread" && row.Selection === game["Home Team"]);
  const total = splits.find(row => row["Game ID"] === game["Game ID"] && row.Market === "Total");
  const line = (row: Row | undefined, spread = false) => row?.Line?.trim() && Number.isFinite(Number(row.Line))
    ? spread ? signed(Number(row.Line)) : row.Line : "Not captured";
  return <article className="nbaCard" data-game-id={game["Game ID"]}>
    <h3><MatchupWithLogos sport="NBA" game={`${game["Away Team"]} @ ${game["Home Team"]}`} /></h3>
    <p className="nbaMeta"><time dateTime={game["Game Time"]}>{time(game["Game Time"])}</time>{gameStatus(game) && <span>{gameStatus(game)}</span>}</p>
    <GameScore game={game} />
    <p className="nbaNotice">No saved model forecast for this matchup.</p>
    <NbaGameLineups gameId={game["Game ID"]} />
    <dl className="nbaMarketQuotes">
      <div><dt>Market home spread · {game["Home Team"]}</dt><dd>{line(homeSpread, true)}</dd></div>
      <div><dt>Market total</dt><dd>{line(total)}</dd></div>
    </dl>
  </article>;
}

function ModelSlate({ tab, data }: { tab: string; data: NbaMarketPayload }) {
  const latest = (latestNbaForecasts(data.forecasts) as Forecast[]).sort(byTipoff);
  const latestByGame = new Map(latest.map(forecast => [forecast.gameId, forecast]));
  const qualified = latest.filter(forecast => [forecast.spread_grade, forecast.total_grade].some(grade => grade === "A" || grade === "B"));
  const games = [...data.games].sort((a, b) => Date.parse(a["Game Time"]) - Date.parse(b["Game Time"]));
  const fullSlate = tab === "Full Slate";
  const gameCount = `${games.length} ${games.length === 1 ? "game" : "games"}`;
  return <section className="nbaBoard">
    <div className="nbaIntro"><h2>{fullSlate ? "NBA Full Slate" : "NBA Model Plays"}</h2>
      <p>{fullSlate ? gameCount : `${qualified.length} ${qualified.length === 1 ? "matchup" : "matchups"} with A/B plays · ${gameCount} on the slate`}</p>
      <p className="nbaSmall">ScoresAndOdds · Spread and total prices assumed -110</p>
      <p className="nbaSmall">{fullSlate ? "All forecasts and grades, including Lean and Pass." : "Qualified A/B spreads and totals. Full Slate includes every forecast and grade."} Lineup-aware projections use the saved availability report.</p>
    </div>
    {data.stale && <p role="status" className="nbaNotice">The latest live market observation is delayed. Saved lines remain visible; the builder waits for fresh, complete lines.</p>}
    {fullSlate ? games.map(game => {
      const forecast = latestByGame.get(game["Game ID"]);
      return forecast ? <ForecastCard key={game["Game ID"]} forecast={forecast} game={game} />
        : <MissingForecastCard key={game["Game ID"]} game={game} splits={data.splits} />;
    }) : qualified.map(forecast => <ForecastCard key={`${forecast.gameId}-${forecast.modelVersion}-${forecast.lockedAt}`}
      forecast={forecast} qualifiedOnly game={games.find(game => game["Game ID"] === forecast.gameId)} />)}
    {!fullSlate && !qualified.length && <div className="nbaCard">No qualifying A/B Model Plays have been saved for this slate yet.</div>}
    {fullSlate && !games.length && <div className="nbaCard">No NBA games have been collected for this date.</div>}
  </section>;
}

function ArchivedSlate({ data, picks = false }: { data: NbaMarketPayload; picks?: boolean }) {
  const current = data.date || data.games[0]?.Date || "", [date, setDate] = useState(current);
  const [archive, setArchive] = useState<{ date: string; data?: NbaMarketPayload; error?: boolean } | null>(null);
  const [retry, setRetry] = useState(0), dates = [...new Set([current, ...(data.availableDates || [])])].filter(Boolean).sort();
  const selected = dates.includes(date) ? date : current;
  useEffect(() => {
    if (selected === current) return;
    const controller = new AbortController(); setArchive({ date: selected });
    void fetch(`/api/nba-public-data?date=${selected}`, { signal: controller.signal }).then(async response => {
      const value = await response.json();
      if (!response.ok || !value.ok || value.today !== selected || !value.nbaMarket) throw new Error("Saved slate unavailable");
      if (!controller.signal.aborted) setArchive({ date: selected, data: value.nbaMarket });
    }).catch(() => { if (!controller.signal.aborted) setArchive({ date: selected, error: true }); });
    return () => controller.abort();
  }, [selected, current, retry]);
  const view = selected === current ? data : archive?.date === selected ? archive.data : undefined;
  return <><div className="nbaControls"><label>{picks ? "View NBA picks slate" : "View NBA slate"} <select aria-label={picks ? "View NBA picks slate" : "View NBA full slate"} value={selected} onChange={event => setDate(event.target.value)} disabled={!dates.length}>
    {dates.map(day => <option key={day} value={day}>{day}</option>)}</select></label></div>
    {view ? <NbaLineupProvider lineups={view.lineups}>{picks ? <NbaEzpzPicks data={view} /> : <ModelSlate tab="Full Slate" data={view} />}</NbaLineupProvider> : <div className="nbaBoard"><p className="nbaCard" role={archive?.error ? "alert" : "status"}>
      {archive?.error ? <>The saved slate could not be loaded. <button type="button" onClick={() => setRetry(n => n + 1)}>Try again</button></> : "Loading saved NBA slate…"}</p></div>}</>;
}

export default function NbaBoard({ tab, data }: { tab: string; data: NbaMarketPayload }) {
  const view = tab === "Public Betting Splits" ? <PublicSplits data={data} />
    : tab === "Signals" ? <Signals board={data.signals} />
    : tab === "Records" ? <Records data={data} />
    : tab === "EZPZ Picks" ? <NbaEzpzPicks data={data} />
    : tab === "Full Slate" ? <ArchivedSlate data={data} /> : <ModelSlate tab={tab} data={data} />;
  return <NbaLineupProvider lineups={data.lineups}>{view}</NbaLineupProvider>;
}
