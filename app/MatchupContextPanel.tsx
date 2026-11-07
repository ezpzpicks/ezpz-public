"use client";

import { useEffect, useState } from "react";
import type { ContextReview, ContextSport } from "../lib/matchupContext";

type Payload = { ok: boolean; available: boolean; capturedGames: number; passedGames: number; pendingGames: number;
  record: { record: string; pending: number; netUnits: number; roiPct: number | null; assumedPrices: number; unverifiedPrices: number };
  model: { models: { market: string; status: string; games: number; calibrationGames: number }[] } | null;
  today: ContextReview[] };
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const gameClock = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });

export default function MatchupContextPanel({ sport, date }: { sport: ContextSport; date: string }) {
  const [open, setOpen] = useState(false), [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; status: "loading" | "ready" | "error"; data?: Payload } | null>(null);
  const key = `${sport}|${date}|${retry}`;
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setResult({ key, status: "loading" });
    let refreshing = false;
    const refresh = async () => {
      if (refreshing || document.visibilityState === "hidden") return;
      refreshing = true;
      try {
        const response = await fetch(`/api/matchup-context?sport=${encodeURIComponent(sport)}&date=${encodeURIComponent(date)}`, { signal: controller.signal });
        const data = await response.json() as Payload;
        if (!response.ok || !data.ok) throw new Error("Saved review unavailable");
        if (!controller.signal.aborted) setResult({ key, status: "ready", data });
      } catch {
        if (!controller.signal.aborted) setResult(previous => previous?.key === key && previous.status === "ready" ? previous : { key, status: "error" });
      } finally { refreshing = false; }
    };
    void refresh();
    const timer = window.setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [date, sport, open, key]);
  const data = result?.key === key && result.status === "ready" ? result.data : undefined;
  return <details className="fs-results fs-trial mc-review" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Matchup review <span>Every side compared · Paper record</span></summary>
    {open ? <div aria-live="polite">
      {result?.key !== key || result.status === "loading" ? <p>Loading matchup reviews…</p>
        : result.status === "error" ? <p>The review could not be loaded. <button type="button" className="fs-filter" onClick={() => setRetry(value => value + 1)}>Try again</button></p>
        : !data?.available ? <p>Pending reviews appear when both spread sides and both total directions are available. They finalize with the final snapshot.</p>
        : <>
          <p>Paper record through {date} · <strong>{data.record.record}</strong> · {data.record.pending} pending · {data.record.netUnits.toFixed(2)}u</p>
          <p>{data.pendingGames || 0} games pending final snapshot · {data.capturedGames} finalized · {data.passedGames} passed. The evaluator learns from earlier results in this sport and market. Each review includes the evidence for all four choices.</p>
          {data.model?.models.map(model => <p key={model.market}>{model.market} · {model.status} · {model.games} earlier games · {model.calibrationGames} later checks</p>)}
          {data.today.map(game => {
            const pending = game.reviewStatus === "PENDING";
            const selected = game.estimates.find(estimate => estimate.id === game.pickId);
            const selectionLabel = `${pending ? "Current lean: " : ""}${selected?.selection || "Pass"}`;
            const resultLabel = pending ? "" : selected ? ` · ${game.outcomes[selected.id]?.result || "Awaiting result"}` : " · All sides assessed";
            const start = Date.parse(game.gameTime);
            return <details key={game.gameKey} className="fs-results mc-game">
              <summary className="mc-game-summary"><strong className="mc-game-title">{game.game}</strong>
                {Number.isFinite(start) ? <time className="mc-game-time" dateTime={game.gameTime}>{gameClock.format(start)} ET</time> : null}
                <span className={`mc-game-status${pending ? " mc-game-pending" : ""}`}>{pending ? "Pending final snapshot" : "Final snapshot"} · {selectionLabel}{resultLabel}</span></summary>
              <p>{pending ? "Review can change until the final snapshot." : "Review frozen at the final snapshot."} Updated {gameClock.format(Date.parse(game.sourceSnapshotAt))} ET.</p>
              <div className="mc-game-choices">{game.estimates.map(estimate => {
                const context = game.cases.find(item => item.id === estimate.id);
                return <details key={estimate.id} className="fs-results mc-choice">
                  <summary><span className="mc-choice-title">{estimate.selection}</span><span className="mc-choice-status">{estimate.id === game.pickId ? pending ? "Current lean" : "Selected" : estimate.reasons[0] || "Alternative"}</span></summary>
                  <div className="mc-choice-body">
                  <p>{estimate.odds} · {estimate.priceBasis} · Estimated return {percent(estimate.expectedRoi)} · After uncertainty {percent(estimate.conservativeRoi)}</p>
                  {estimate.contributions.length ? <ul>{estimate.contributions.map(factor => <li key={factor.feature}>{factor.feature} · {factor.value > 0 ? "Raises" : "Lowers"} the estimate</li>)}</ul> : null}
                  {context?.disagreements.length ? <><p>Disagreements in the {pending ? "current" : "saved"} evidence</p><ul>{context.disagreements.map(item => <li key={item}>{item}</li>)}</ul></> : null}
                  <dl>{context?.evidence.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}{item.sample != null ? ` · ${item.sample} games` : ""}</dd></div>)}</dl>
                  {context?.missing.length ? <p>{context.missing.join(" · ")}</p> : null}
                  </div>
                </details>;
              })}</div>
            </details>;
          })}
          <p>Pending reviews update automatically and enter the paper record only after the final snapshot. Records use the frozen line and price. Estimated returns are experimental.</p>
          {data.record.assumedPrices || data.record.unverifiedPrices ? <p>{data.record.assumedPrices} selections use assumed −110 · {data.record.unverifiedPrices} have unverified price provenance.</p> : null}
        </>}
    </div> : null}
  </details>;
}
