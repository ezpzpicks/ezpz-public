"use client";

import { MatchupWithLogos } from "./TeamLogoName";
import dynamic from "next/dynamic";
import type { FootballSignalsBoard } from "../lib/footballSignals";
import type { NcaafEzpzSubtype } from "../lib/ncaafEzpzWilson";

const PublicSplits = dynamic(() => import("./NbaPublicSplits"), { loading: () => <div className="fs-empty">Loading NBA markets…</div> });
const Signals = dynamic(() => import("./FootballSignalsBoard"), { loading: () => <div className="fs-empty">Loading signals…</div> });

type Row = Record<string, string>;
type Forecast = {
  gameId: string; modelVersion: string; lockedAt: string; tipoff: string; phase: string;
  away_team: string; home_team: string; away_score: number; home_score: number;
  total: number; fair_home_spread: number; home_spread_edge: number | null; total_edge: number | null;
  spread_pick?: string; total_pick?: string; spread_grade?: string; total_grade?: string;
  spreadResult?: string; totalResult?: string;
  availability_mode?: "injury_feed" | "expected_rotation";
  market?: { home_spread: number; total: number; source: string; as_of: string } | null;
};
export type NbaMarketPayload = {
  source: string; games: Row[]; splits: Row[]; forecasts: Forecast[]; stale: boolean;
  refreshPolicy: string; finalWindow: string;
  date?: string; availableDates?: string[]; trendPlays?: Record<string, any>[]; leaderboard?: NcaafEzpzSubtype[]; signals?: FootballSignalsBoard;
};
const time = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleTimeString("en-US", {
  timeZone: "America/New_York", hour: "numeric", minute: "2-digit",
}) + " ET" : "Time unavailable";
const signed = (value: number) => `${value > 0 ? "+" : ""}${Number(value.toFixed(1))}`;
function ForecastCard({ forecast }: { forecast: Forecast }) {
  return <article className="nbaCard">
    <h3><MatchupWithLogos sport="NBA" game={`${forecast.away_team} @ ${forecast.home_team}`} /></h3>
    <p>{time(forecast.tipoff)} · {forecast.phase === "pregame" ? "Pregame refresh" : forecast.phase === "early" ? "Early forecast" : "Manual forecast"}</p>
    {forecast.availability_mode === "expected_rotation" && <p className="nbaNotice">Expected rotation · Injury availability unchecked · Starters unconfirmed</p>}
    <div className="nbaScore">{forecast.away_team} <strong>{forecast.away_score.toFixed(1)}</strong> <span> / </span>{forecast.home_team} <strong>{forecast.home_score.toFixed(1)}</strong></div>
    <div className="nbaScroll"><table><thead><tr><th>Market</th><th>Selection</th><th>Model</th><th>Market line</th><th>Edge</th><th>Grade</th></tr></thead>
      <tbody><tr><td>Spread</td><td>{forecast.spread_pick || "No market line"}</td><td>Home {signed(forecast.fair_home_spread)}</td><td>{forecast.market ? signed(forecast.market.home_spread) : "—"}</td><td>{forecast.home_spread_edge == null ? "—" : `${Math.abs(forecast.home_spread_edge).toFixed(1)} pts`}</td><td><strong>{forecast.spread_grade || "—"}</strong></td></tr>
        <tr><td>Total</td><td>{forecast.total_pick || "No market line"}</td><td>{forecast.total.toFixed(1)}</td><td>{forecast.market?.total ?? "—"}</td><td>{forecast.total_edge == null ? "—" : `${Math.abs(forecast.total_edge).toFixed(1)} pts`}</td><td><strong>{forecast.total_grade || "—"}</strong></td></tr></tbody></table></div>
    <p className="nbaSmall">Locked {time(forecast.lockedAt)}{forecast.market ? ` · ScoresAndOdds ${time(forecast.market.as_of)} · assumed -110` : ""}</p>
    {forecast.spreadResult && <p>Spread: {forecast.spreadResult} · Total: {forecast.totalResult}</p>}
  </article>;
}

export default function NbaBoard({ tab, data }: { tab: string; data: NbaMarketPayload }) {
  if (tab === "Public Betting Splits") return <PublicSplits data={data} />;
  if (tab === "Signals") return <Signals board={data.signals} />;
  const latest = [...new Map([...data.forecasts].reverse().map(f => [f.gameId, f])).values()]
    .sort((a,b) => Date.parse(a.tipoff)-Date.parse(b.tipoff));
  return <section className="nbaBoard">
    <div className="nbaIntro"><h2>{tab === "Public Betting Splits" ? "Public Betting Splits" : tab === "Records" ? "NBA Model Tracking" : "NBA Spreads & Totals"}</h2>
      <p>{data.games.length} games · ScoresAndOdds · Spread and total prices assumed -110</p>
      <p className="nbaSmall">Research model · Conditional rotations · A/B/Lean/Pass grades compare projections with recorded market lines.</p>
    </div>
    {data.stale && <p role="status" className="nbaNotice">The latest live market observation is delayed. Saved lines remain visible; the builder waits for fresh, complete lines.</p>}
    {(tab === "Records" ? data.forecasts : latest).map(f => <ForecastCard key={`${f.gameId}-${f.modelVersion}`} forecast={f} />)}
    {!data.forecasts.length && <div className="nbaCard">No market-compared forecasts saved yet. The builder will save each game once complete lines are ready.</div>}
    {!data.games.length && <div className="nbaCard">No NBA games have been collected for this date.</div>}
    <style jsx global>{`
      .nbaBoard{display:grid;gap:16px}.nbaBoard .nbaIntro h2{margin:0 0 8px}.nbaBoard .nbaIntro p,.nbaBoard .nbaCard p{color:#99aec5;margin:8px 0}.nbaBoard .nbaCard{border:1px solid #203650;border-radius:16px;background:#0b1420;padding:20px}.nbaBoard .nbaCard h3{margin:0 0 10px}.nbaBoard .nbaScroll{overflow-x:auto}.nbaBoard table{border-collapse:collapse;width:100%;font-size:14px;white-space:nowrap}.nbaBoard th,.nbaBoard td{padding:12px 10px;text-align:left;border-bottom:1px solid #203650}.nbaBoard th{color:#8ca9c8;font-size:12px}.nbaBoard strong{color:#b7e2ff}.nbaBoard .nbaSmall{font-size:12px;color:#8ca9c8}.nbaBoard .nbaScore{padding:12px 0;font-size:15px}.nbaBoard .nbaNotice{border:1px solid #81632c;background:#2c2415;padding:14px;border-radius:12px;color:#e5cb8f}.nbaBoard details{margin:8px 0 14px}.nbaBoard summary{cursor:pointer;color:#68b6ff;font-size:13px}.nbaBoard svg{width:100%;max-height:110px;margin-top:10px}
    `}</style>
  </section>;
}
