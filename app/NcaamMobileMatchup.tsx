"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { TeamLogoName } from "./TeamLogoName";
import ProjectionAdjustment from "./ProjectionAdjustment";
import { ncaamProjectionAdjustments } from "../lib/ncaamProjectionAdjustments";
import { selectedSpreadSide } from "../lib/selectionSide";

type Forecast = {
  away_score: number; home_score: number; fair_home_spread: number; total: number;
  spread_pick?: string; total_pick?: string; home_spread_edge: number | null; total_edge: number | null;
  market?: { home_spread: number; total: number } | null;
};
const number = (value: unknown, sign = false) => typeof value === "number" && Number.isFinite(value)
  ? `${sign && value > 0 ? "+" : ""}${value.toFixed(1)}` : "—";

/** Presentation only: all selections, edges and adjustments use the existing saved forecast. */
export default function NcaamMobileMatchup({ game, forecast, children }: {
  game: Record<string, string>; forecast?: Forecast; children: ReactNode;
}) {
  const [mobile, setMobile] = useState(false), [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const returnY = useRef(0);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const change = () => setMobile(media.matches);
    change(); media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (!open || !mobile) return;
    const el = dialog.current;
    el?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const back = () => setOpen(false);
    window.addEventListener("popstate", back);
    return () => {
      window.removeEventListener("popstate", back);
      el?.close(); document.body.style.overflow = overflow;
      trigger.current?.focus({ preventScroll: true });
      window.scrollTo({ top: returnY.current, behavior: "instant" });
    };
  }, [open, mobile]);
  if (!mobile) return children;
  const away = game["Away Team"], home = game["Home Team"];
  const final = game.Completed === "TRUE" || game.Status === "STATUS_FINAL";
  const status = final ? "Final" : !forecast ? "Pending" : "Preview";
  const adjustments = ncaamProjectionAdjustments(forecast);
  const side = forecast ? selectedSpreadSide("NCAAM", forecast.spread_pick, away, home,
    -forecast.fair_home_spread, forecast.market?.home_spread ?? null) : null;
  const spreadSign = side === "away" ? -1 : 1;
  const close = () => { if (window.history.state?.ezpzMatchup === game["Game ID"]) window.history.back(); else setOpen(false); };
  const rows = forecast ? [
    { name: "Spread", pick: forecast.spread_pick || "No market line", model: side ? number(spreadSign * forecast.fair_home_spread, true) : "—", market: side && forecast.market ? number(spreadSign * forecast.market.home_spread, true) : "—", edge: forecast.home_spread_edge, delta: side === "away" ? adjustments?.awaySpread : side === "home" ? adjustments?.homeSpread : null, label: `${side === "away" ? away : home} strength` },
    { name: "Total", pick: forecast.total_pick || "No market line", model: number(forecast.total), market: number(forecast.market?.total), edge: forecast.total_edge, delta: adjustments?.total, label: "total" },
  ] : [];
  return <article className="ncaamCompact" data-game-id={game["Game ID"]}>
    <div className="ncaamScoreLabel">Projected score</div>
    {([ [away, forecast?.away_score, adjustments?.awayScore], [home, forecast?.home_score, adjustments?.homeScore] ] as const).map(([team, score, delta]) => <div className="ncaamCompactTeam" key={team}>
      <TeamLogoName sport="NCAAM" team={team} compact /><strong>{number(score)}</strong><span className="ncaamMovement"><ProjectionAdjustment points={delta} label={`${team} score`} /></span>
    </div>)}
    <div className="ncaamCompactMeta"><span>{status}{game.Status === "STATUS_IN_PROGRESS" ? " · In progress" : ""}</span></div>
    {rows.length ? <div className="ncaamCompactMarkets">
      {rows.map(row => <div className="ncaamCompactMarket" key={row.name}><span className="ncaamMarketLabel">{row.name}</span><strong>{row.pick}</strong><span className="ncaamEdge">{row.edge == null || !Number.isFinite(row.edge) ? "Edge unavailable" : `${Math.abs(row.edge).toFixed(1)} pt edge`}</span></div>)}
    </div> : <p className="ncaamPending">Pending · No saved model forecast</p>}
    {final && <p className="ncaamFinal">Final score · {game["Away Score"] || "—"} – {game["Home Score"] || "—"}</p>}
    <button ref={trigger} className="ncaamOpen" type="button" aria-haspopup="dialog" onClick={() => {
      returnY.current = window.scrollY;
      window.history.pushState({ ...window.history.state, ezpzMatchup: game["Game ID"] }, "", window.location.href);
      setOpen(true);
    }}>Matchup details <span aria-hidden="true">›</span><span className="ez-sr-only"> for {away} at {home}</span></button>
    {open && <dialog ref={dialog} className="ncaamSheet" aria-label={`${away} at ${home} matchup details`} onCancel={event => { event.preventDefault(); close(); }}>
      <div className="ncaamSheetHeader"><span>Matchup details</span><button type="button" onClick={close} autoFocus>Back to slate</button></div>
      {children}
    </dialog>}
  </article>;
}
