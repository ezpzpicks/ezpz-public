"use client";

import { useEffect, useState } from "react";
import type { ContextDecision, ContextSport } from "../lib/matchupContext";

type Payload = { ok: boolean; available: boolean; capturedGames: number; passedGames: number;
  record: { record: string; pending: number; netUnits: number; roiPct: number | null; assumedPrices: number; unverifiedPrices: number };
  model: { models: { market: string; status: string; games: number; calibrationGames: number }[] } | null;
  today: ContextDecision[] };
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
    fetch(`/api/matchup-context?sport=${encodeURIComponent(sport)}&date=${encodeURIComponent(date)}`, { signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error("Saved review unavailable");
        return data as Payload;
      }).then(data => { if (!controller.signal.aborted) setResult({ key, status: "ready", data }); })
      .catch(() => { if (!controller.signal.aborted) setResult({ key, status: "error" }); });
    return () => controller.abort();
  }, [date, sport, open, key]);
  const data = result?.key === key && result.status === "ready" ? result.data : undefined;
  return <details className="fs-results fs-trial mc-review" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Matchup review <span>Every side compared · Paper record</span></summary>
    {open ? <div aria-live="polite">
      {result?.key !== key || result.status === "loading" ? <p>Loading saved matchup reviews…</p>
        : result.status === "error" ? <p>The review could not be loaded. <button type="button" className="fs-filter" onClick={() => setRetry(value => value + 1)}>Try again</button></p>
        : !data?.available ? <p>Reviews begin with complete pregame snapshots. Each game compares both spread sides and both total directions.</p>
        : <>
          <p>Paper record through {date} · <strong>{data.record.record}</strong> · {data.record.pending} pending · {data.record.netUnits.toFixed(2)}u</p>
          <p>{data.capturedGames} games reviewed · {data.passedGames} passed. The evaluator learns from earlier results in this sport and market. Each saved decision includes the evidence for all four choices.</p>
          {data.model?.models.map(model => <p key={model.market}>{model.market} · {model.status} · {model.games} earlier games · {model.calibrationGames} later checks</p>)}
          {data.today.map(game => {
            const selected = game.estimates.find(estimate => estimate.id === game.pickId);
            const start = Date.parse(game.gameTime);
            return <details key={game.gameKey} className="fs-results mc-game">
              <summary className="mc-game-summary"><strong className="mc-game-title">{game.game}</strong>
                {Number.isFinite(start) ? <time className="mc-game-time" dateTime={game.gameTime}>{gameClock.format(start)} ET</time> : null}
                <span className="mc-game-status">{selected?.selection || "Pass"} · {selected ? game.outcomes[selected.id]?.result || "Pending" : "All sides assessed"}</span></summary>
              <div className="mc-game-choices">{game.estimates.map(estimate => {
                const context = game.cases.find(item => item.id === estimate.id);
                return <details key={estimate.id} className="fs-results mc-choice">
                  <summary><span className="mc-choice-title">{estimate.selection}</span><span className="mc-choice-status">{estimate.id === game.pickId ? "Selected" : estimate.reasons[0] || "Alternative"}</span></summary>
                  <div className="mc-choice-body">
                  <p>{estimate.odds} · {estimate.priceBasis} · Estimated return {percent(estimate.expectedRoi)} · After uncertainty {percent(estimate.conservativeRoi)}</p>
                  {estimate.contributions.length ? <ul>{estimate.contributions.map(factor => <li key={factor.feature}>{factor.feature} · {factor.value > 0 ? "Raises" : "Lowers"} the estimate</li>)}</ul> : null}
                  {context?.disagreements.length ? <><p>Disagreements in the saved evidence</p><ul>{context.disagreements.map(item => <li key={item}>{item}</li>)}</ul></> : null}
                  <dl>{context?.evidence.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}{item.sample != null ? ` · ${item.sample} games` : ""}</dd></div>)}</dl>
                  {context?.missing.length ? <p>{context.missing.join(" · ")}</p> : null}
                  </div>
                </details>;
              })}</div>
            </details>;
          })}
          <p>Decisions freeze before kickoff. Records use the saved line and price. Estimated returns are experimental.</p>
          {data.record.assumedPrices || data.record.unverifiedPrices ? <p>{data.record.assumedPrices} selections use assumed −110 · {data.record.unverifiedPrices} have unverified price provenance.</p> : null}
        </>}
    </div> : null}
  </details>;
}
