"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { TeamLogoName, type LogoSport } from "./TeamLogoName";
import ProjectionAdjustment from "./ProjectionAdjustment";
export type CompactMarket = { name: string; selection: string; detail?: string; grade?: string; result?: string; projection?: string; adjustment?: number | null };
export const savedNumber = (value: unknown) => value == null || String(value).trim() === "" || !Number.isFinite(Number(value)) ? null : Number(value);
const scoreText = (value: number | null | undefined) => typeof value === "number" && Number.isFinite(value) ? value.toFixed(1) : "—";
/** Saved display values only. The original card remains the complete detail view. */
export default function CompactMatchup({ id, sport, away, home, awayScore, homeScore, awayAdjustment, homeAdjustment, time, status, markets, finalScore, returnLabel = "Back to slate", children }: {
  id: string; sport: LogoSport; away: string; home: string; awayScore?: number | null; homeScore?: number | null;
  awayAdjustment?: number | null; homeAdjustment?: number | null; time?: string; status: string; markets: CompactMarket[];
  finalScore?: { away: string | number; home: string | number; awayTeam?: string; homeTeam?: string }; returnLabel?: string; children: ReactNode;
}) {
  const [mobile, setMobile] = useState(false), [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null), returnY = useRef(0);
  useEffect(() => { const media = window.matchMedia("(max-width: 760px)"); const change = () => setMobile(media.matches); change(); media.addEventListener("change", change); return () => media.removeEventListener("change", change); }, []);
  useEffect(() => {
    if (!open || !mobile) return;
    const el = dialog.current; el?.showModal();
    const overflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    const back = () => setOpen(false); window.addEventListener("popstate", back);
    return () => { window.removeEventListener("popstate", back); el?.close(); document.body.style.overflow = overflow;
      trigger.current?.focus({ preventScroll: true }); window.scrollTo({ top: returnY.current, behavior: "instant" }); };
  }, [open, mobile]);
  if (!mobile) return children;
  const close = () => { if (window.history.state?.ezpzMatchup === id) window.history.back(); else setOpen(false); };
  const hasScores = awayScore != null || homeScore != null;
  return <article className="ncaamCompact" data-game-id={id}>
    {time && <div className="compactTime">{time}</div>}
    <div className="ncaamScoreLabel">{hasScores ? "Projected score" : "Projection pending"}</div>
    {([[away, awayScore, awayAdjustment], [home, homeScore, homeAdjustment]] as const).map(([team, score, delta], index) => <div className="ncaamCompactTeam" key={`${team}-${index}`}>
      <TeamLogoName sport={sport} team={team} compact /><strong>{scoreText(score)}</strong><span className="ncaamMovement"><ProjectionAdjustment points={delta} label={`${team} score`} /></span>
    </div>)}
    <div className="ncaamCompactMeta"><span>{status}</span></div>
    {markets.length ? <div className="ncaamCompactMarkets">{markets.map((market, index) => <div className="ncaamCompactMarket" key={`${market.name}-${index}`}>
      <span className="ncaamMarketLabel">{market.name}</span><strong>{market.selection}</strong>
      {market.projection && <span className="compactMarketProjection">Projected <b>{market.projection}</b><ProjectionAdjustment points={market.adjustment} label={market.name} /></span>}
      {market.detail && <span className="ncaamEdge">{market.detail}</span>}
      {market.grade && <small className="compactGrade">{market.grade}</small>}
      {market.result && <small className="compactResult">Result: {market.result}</small>}
    </div>)}</div> : <p className="ncaamPending">No saved model forecast for this matchup.</p>}
    {finalScore && <div className="ncaamFinal"><span>Final score</span><div className="compactFinalTeams"><div><span>{finalScore.awayTeam || away}</span><strong>{finalScore.away}</strong></div><div><span>{finalScore.homeTeam || home}</span><strong>{finalScore.home}</strong></div></div></div>}
    <button ref={trigger} className="ncaamOpen" type="button" aria-haspopup="dialog" onClick={() => { returnY.current = window.scrollY; window.history.pushState({ ...window.history.state, ezpzMatchup: id }, "", window.location.href); setOpen(true); }}>Matchup details <span aria-hidden="true">›</span><span className="ez-sr-only"> for {away} at {home}</span></button>
    {open && <dialog ref={dialog} className="ncaamSheet" aria-label={`${away} at ${home} matchup details`} onCancel={event => { event.preventDefault(); close(); }}>
      <div className="ncaamSheetHeader"><span>Matchup details</span><button type="button" onClick={close} autoFocus>{returnLabel}</button></div>{children}
    </dialog>}
  </article>;
}
