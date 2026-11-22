"use client";

import { useEffect, useMemo, useState } from "react";
import { TeamLogoName, MatchupWithLogos } from "./TeamLogoName";
import { nflPropsDate, upcomingNflProps, validNflPropsDate, type NflPlayerProp } from "../lib/nflPlayerProps";

function numeric(value: number | null) { return value == null ? "—" : value.toFixed(1); }
function odds(value: number | null) { return value == null ? "—" : `${value > 0 ? "+" : ""}${value}`; }
function time(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", timeZoneName: "short" }) : "";
}

export default function NflPlayerProps({ pendingOnly = false }: { pendingOnly?: boolean }) {
  const [date, setDate] = useState(() => {
    const requested = pendingOnly || typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("date") || "";
    return validNflPropsDate(requested) ? requested : nflPropsDate();
  });
  const [props, setProps] = useState<NflPlayerProp[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [search, setSearch] = useState(""), [market, setMarket] = useState("");
  const [game, setGame] = useState(""), [view, setView] = useState("upcoming");
  const [now, setNow] = useState(Date.now());
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setProps([]);
    if (!pendingOnly) {
      const url = new URL(window.location.href); url.searchParams.set("date", date);
      window.history.replaceState(null, "", url);
    }
    fetch(`/api/nfl-player-props?date=${encodeURIComponent(date)}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "Could not load player props.");
        return result.props as NflPlayerProp[];
      }).then(rows => { if (!controller.signal.aborted) setProps(rows); })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not load player props."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [date, revision, pendingOnly]);
  useEffect(() => {
    const timer = window.setInterval(() => { setNow(Date.now()); setRevision(value => value + 1); }, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const markets = [...new Set(props.map(prop => prop.market))].sort();
  const games = [...new Map(props.map(prop => [prop.gameId, prop.game])).entries()];
  const filtered = useMemo(() => (pendingOnly || view === "upcoming" ? upcomingNflProps(props, now, pendingOnly) : props)
    .filter(prop => (!market || prop.market === market) && (!game || prop.gameId === game)
    && (view !== "graded" || prop.qualified)
    && `${prop.player} ${prop.team}`.toLowerCase().includes(search.toLowerCase())), [props, market, game, view, search, now, pendingOnly]);
  return <section className="nfl-props" aria-label="NFL player props">
    <div className="props-heading"><div><h2>{pendingOnly ? "Pending Player Props" : "NFL Player Props"}</h2><p>Graded previews appear as Pending until the pregame checks finalize them.</p>{pendingOnly ? <a href="/?sport=NFL&tab=Player+Props">All player props</a> : null}</div>
      <button type="button" className="refreshBtn" disabled={loading} onClick={() => setRevision(value => value + 1)}>Refresh props</button></div>
    {!pendingOnly ? <div className="props-controls">
      <label>Game date<input type="date" value={date} onChange={event => { if (event.target.value) { setDate(event.target.value); setGame(""); setMarket(""); } }} /></label>
      <label>Player or team<input type="search" placeholder="Search players" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <label>Matchup<select value={game} onChange={event => setGame(event.target.value)}><option value="">All games</option>{games.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label>Market<select value={market} onChange={event => setMarket(event.target.value)}><option value="">All markets</option>{markets.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Show<select value={view} onChange={event => setView(event.target.value)}><option value="upcoming">Upcoming graded plays</option><option value="all">All props</option><option value="graded">All graded props</option></select></label>
    </div> : null}
    {loading ? <div className="empty" role="status">Loading player props…</div> : error ? <div className="empty" role="alert">{error}</div> : <>
      <div className="props-count">{filtered.length} {pendingOnly ? "pending plays" : "props"}</div>
      {!props.length ? <div className="empty">No NFL player props are saved for {date} yet.</div> : !filtered.length ? <div className="empty">{pendingOnly ? "No upcoming prop plays are pending finalization." : "No props match these filters."}</div> : <div className="props-grid">{filtered.map(prop => <article className="prop-card" key={prop.id}>
        <div className="prop-top"><TeamLogoName sport="NFL" team={prop.team} text={prop.team} compact /><span className={prop.qualified ? "prop-grade graded" : "prop-grade"}>{prop.phase === "early" && Date.parse(prop.gameTime) > now ? "Pending · " : ""}{prop.grade}</span></div>
        <h3>{prop.player}</h3><div className="prop-market">{prop.market}</div>
        <div className="prop-game"><MatchupWithLogos sport="NFL" game={prop.game} compact />{time(prop.gameTime) ? <span>{time(prop.gameTime)}</span> : null}</div>
        <div className="prop-values"><div><span>Projection</span><strong>{numeric(prop.projection)}</strong></div><div><span>Saved line</span><strong>{numeric(prop.line)}</strong></div><div><span>Model %</span><strong>{prop.probability == null ? "—" : `${(prop.probability * 100).toFixed(1)}%`}</strong></div></div>
        <div className="prop-pick"><strong>{prop.pick}</strong>{prop.pickOdds != null ? <span>{odds(prop.pickOdds)}</span> : null}</div>
        <div className="prop-prices">Over {odds(prop.overOdds)} · Under {odds(prop.underOdds)}</div>
        <div className="prop-saved"><span>{Date.parse(prop.gameTime) <= now ? "Started" : prop.phase === "early" ? "Pending • pregame checks" : "Finalized"}{time(prop.builtAt) ? ` · ${time(prop.builtAt)}` : ""}</span>{time(prop.quoteObservedAt) ? <span>Saved quote {time(prop.quoteObservedAt)}</span> : null}</div>
      </article>)}</div>}
    </>}
    <style jsx>{`
      .nfl-props{display:grid;gap:18px}.props-heading{display:flex;align-items:center;justify-content:space-between;gap:16px}.props-heading h2{margin:0 0 6px;font-size:1.6rem;letter-spacing:-.035em}.props-heading p,.props-count{margin:0;color:var(--ez-muted);font-size:.82rem;line-height:1.5}.props-controls{display:grid;grid-template-columns:1fr 1.4fr 1.3fr 1.2fr 1fr;gap:10px}.props-controls label{display:grid;gap:6px;font-size:.72rem;color:var(--ez-muted);font-weight:750}.props-controls input,.props-controls select{width:100%;min-width:0;min-height:44px;padding:10px;border:1px solid var(--ez-border);border-radius:12px;background:var(--ez-panel);color:inherit;font:inherit;color-scheme:dark}.props-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.prop-card{min-width:0;padding:18px;border:1px solid var(--ez-border);border-radius:20px;background:linear-gradient(145deg,var(--ez-panel),var(--ez-panel-2))}.prop-top{display:flex;justify-content:space-between;align-items:center;gap:8px}.prop-grade{font-size:.65rem;border:1px solid var(--ez-border);border-radius:99px;padding:5px 8px;color:var(--ez-muted)}.prop-grade.graded{color:#aef2c6;border-color:rgba(43,216,117,.38);background:rgba(28,130,78,.12)}.prop-card h3{margin:14px 0 4px;font-size:1.15rem}.prop-market{font-size:.9rem;color:#9ccaff;font-weight:750}.prop-game{display:grid;gap:5px;margin-top:12px;font-size:.73rem;color:var(--ez-muted)}.prop-values{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:16px;padding:14px 0;border-top:1px solid var(--ez-border);border-bottom:1px solid var(--ez-border)}.prop-values div{display:grid;gap:5px}.prop-values span{font-size:.65rem;color:var(--ez-muted)}.prop-values strong{font-size:1.25rem}.prop-pick{display:flex;justify-content:space-between;gap:10px;margin:14px 0 7px;font-size:.85rem}.prop-prices{font-size:.72rem;color:var(--ez-muted)}.prop-saved{display:grid;gap:3px;margin-top:14px;font-size:.65rem;color:var(--ez-muted)}@media(max-width:1000px){.props-controls{grid-template-columns:repeat(3,minmax(0,1fr))}.props-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:620px){.props-heading{align-items:flex-start;flex-direction:column}.props-controls{grid-template-columns:repeat(2,minmax(0,1fr))}.props-grid{grid-template-columns:1fr}}
    `}</style>
  </section>;
}
