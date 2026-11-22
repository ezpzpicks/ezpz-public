"use client";

import { useEffect, useState } from "react";
import { MatchupWithLogos } from "./TeamLogoName";
import type { NflPendingGame } from "../lib/nflPendingGames";

function time(raw: string) {
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", timeZoneName: "short" }) : "";
}
function points(value: number, signed = false) { return `${signed && value > 0 ? "+" : ""}${value.toFixed(1)}`; }

export default function NflPendingGamePlays() {
  const [plays, setPlays] = useState<NflPendingGame[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [revision, setRevision] = useState(0), [now, setNow] = useState(Date.now());
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    fetch("/api/nfl-pending-game-plays", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || "Could not load pending spreads and totals.");
        return data.plays as NflPendingGame[];
      }).then(rows => { if (!controller.signal.aborted) setPlays(rows); })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not load pending spreads and totals."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    const timer = window.setInterval(() => { setNow(Date.now()); setRevision(value => value + 1); }, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const upcoming = plays.filter(play => Date.parse(play.gameTime) > now);
  return <section className="pending-games" aria-label="Pending NFL spreads and totals">
    <div className="heading"><h2>Pending Spreads &amp; Totals</h2><button type="button" className="refreshBtn" disabled={loading} onClick={() => { setNow(Date.now()); setRevision(value => value + 1); }}>Refresh</button></div>
    {error ? <div className="empty" role="alert">{error}</div> : loading ? <div className="empty" role="status">Loading pending spreads and totals…</div>
      : !upcoming.length ? <div className="empty">No upcoming spreads or totals currently qualify as pending plays.</div>
      : <div className="game-grid">{upcoming.map(play => <article className="game-card" key={play.id}>
        <div className="top"><span>{play.market}</span><b>Pending · {play.grade}</b></div>
        <div className="matchup"><MatchupWithLogos sport="NFL" game={play.game} compact /></div>
        <small>{time(play.gameTime)}</small><h3>{play.pick}</h3>
        <div className="metrics"><div><span>Model {play.market.toLowerCase()}</span><strong>{points(play.projection, play.market === "Spread")}</strong></div><div><span>Saved line</span><strong>{points(play.line, play.market === "Spread")}</strong></div><div><span>Edge</span><strong>{points(play.edge)} pts</strong></div></div>
        <p>Pending pregame checks · {time(play.builtAt)}{time(play.quoteObservedAt) ? <><br />Saved quote {time(play.quoteObservedAt)}</> : null}</p>
      </article>)}</div>}
    <style jsx>{`
      .pending-games{display:grid;gap:16px}.heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.heading h2{margin:0;font-size:1.6rem;letter-spacing:-.035em}.game-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:14px}.game-card{padding:18px;border:1px solid var(--ez-border);border-radius:20px;background:linear-gradient(145deg,var(--ez-panel),var(--ez-panel-2))}.top{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:.72rem;color:var(--ez-muted)}.top b{border:1px solid rgba(245,190,80,.35);border-radius:99px;padding:6px 9px;color:#f4d482}.matchup{margin:16px 0 8px}.game-card small,.game-card p{color:var(--ez-muted);font-size:.72rem;line-height:1.5}.game-card h3{margin:14px 0;font-size:1.4rem}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:14px 0;border-top:1px solid var(--ez-border);border-bottom:1px solid var(--ez-border)}.metrics div{display:grid;gap:6px}.metrics span{font-size:.65rem;color:var(--ez-muted)}.metrics strong{font-size:1.15rem}.game-card p{margin:14px 0 0}
    `}</style>
  </section>;
}
