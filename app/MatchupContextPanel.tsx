"use client";

import { useEffect, useState } from "react";
import type { ContextCase, ContextEvidence, ContextReview, ContextSport } from "../lib/matchupContext";

type Payload = { ok: boolean; available: boolean; capturedGames: number; passedGames: number; pendingGames: number; missedFinalGames?: number;
  record: { record: string; pending: number; netUnits: number; roiPct: number | null; assumedPrices: number; unverifiedPrices: number };
  model: { models: { market: string; status: string; games: number; calibrationGames: number }[] } | null;
  today: ContextReview[] };
const percent = (value: number) => `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
const number = (value: number | null | undefined, signed = false) => value == null || !Number.isFinite(value) ? "—"
  : `${signed && value > 0 ? "+" : ""}${Number(value.toFixed(1))}`;
const gameClock = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
const SIGNAL_NAMES: Record<string, string> = { money: "Money", move: "Line", system: "Public", team: "Team", model: "Model", sos: "SOS" };
const tone = (direction: ContextEvidence["direction"]) => direction.toLowerCase();
const valueTone = (value: number | null) => value == null || value === 0 ? "" : value > 0 ? "mc-positive" : "mc-negative";

function metrics(context?: ContextCase) {
  if (context?.metrics) return context.metrics;
  // Older saved reviews keep their original evidence and do not acquire a new grade.
  const split = context?.evidence.find(item => /betting split$/.test(item.label))?.value.match(/([\d.]+)% tickets.*?([\d.]+)% money/);
  const edge = context?.evidence.find(item => item.label === "Saved model")?.value.match(/edge ([+-]?[\d.]+) points/);
  const opening = context?.evidence.find(item => item.label === "Tracked line")?.value.split("→")[0].trim();
  return { tickets: split ? Number(split[1]) : null, money: split ? Number(split[2]) : null,
    moneyGap: split ? Number(split[2]) - Number(split[1]) : null, teamScore: null,
    modelEdge: edge ? Number(edge[1]) : null, modelProjection: null,
    openingLine: opening && Number.isFinite(Number(opening)) ? Number(opening) : null, activeSignals: [] as string[] };
}

function EvidenceRows({ items }: { items: ContextEvidence[] }) {
  return <dl className="mc-evidence-rows">{items.map((item, index) => <div key={`${item.label}-${index}`} className={`mc-evidence-row mc-${tone(item.direction)}`}>
    <dt>{item.label}</dt><dd><strong>{item.label === "Saved model" ? item.value.replace(/-?\d+\.\d{3,}/g, value => Number(Number(value).toFixed(2)).toString()) : item.value}</strong><span>{item.direction}{item.sample != null ? ` · ${item.sample} games` : ""}</span></dd>
  </div>)}</dl>;
}

function CaseEvidence({ context, line, market: marketType }: { context?: ContextCase; line: number | null; market: "Spread" | "Total" }) {
  if (!context) return <p>Saved evidence is unavailable for this choice.</p>;
  const teams = new Map<string, ContextEvidence[]>(), market: ContextEvidence[] = [], model: ContextEvidence[] = [], schedule: ContextEvidence[] = [];
  for (const item of context.evidence) {
    if (item.label.includes(" · ")) {
      const [team, ...label] = item.label.split(" · ");
      teams.set(team, [...(teams.get(team) || []), { ...item, label: label.join(" · ") }]);
    } else if (/model/i.test(item.label)) model.push(item);
    else if (/schedule/i.test(item.label)) schedule.push(item);
    else market.push(item);
  }
  return <>
    {context.disagreements.length ? <section className="mc-conflicts" aria-label="Conflicting evidence"><h5>What conflicts</h5>
      <ul>{context.disagreements.slice(0, 3).map(item => <li key={item}>{item}</li>)}</ul>
      {context.disagreements.length > 3 ? <details><summary>{context.disagreements.length - 3} more comparisons</summary>
        <ul>{context.disagreements.slice(3).map(item => <li key={item}>{item}</li>)}</ul></details> : null}</section> : null}
    {teams.size ? <section className="mc-evidence-section"><h5>Team records</h5><div className="mc-team-records">
      {[...teams].map(([team, records]) => <section className="mc-record-card" key={team}><h6>{team}</h6><EvidenceRows items={records} /></section>)}
    </div></section> : null}
    {market.length ? <section className="mc-evidence-section"><h5>Betting splits &amp; line movement</h5><EvidenceRows items={market} /></section> : null}
    {model.length ? <section className="mc-evidence-section"><h5>Model evidence</h5>
      {context.metrics?.modelProjection != null ? <p className="mc-snapshot-note">Projection <strong>{number(context.metrics.modelProjection, marketType === "Spread")}</strong> · Line {number(line, marketType === "Spread")}</p> : null}
      <EvidenceRows items={model} /></section> : null}
    {schedule.length ? <section className="mc-evidence-section"><h5>Schedule strength</h5><EvidenceRows items={schedule} /></section> : null}
    {context.missing.length ? <p className="mc-missing">Missing information: {context.missing.join(" · ")}</p> : null}
  </>;
}

function MatchupGame({ game }: { game: ContextReview }) {
  const choices = [...game.estimates].sort((a, b) => (a.market === "Spread" ? 0 : 1) - (b.market === "Spread" ? 0 : 1));
  const [choiceId, setChoiceId] = useState(game.pickId || choices[0]?.id);
  const choice = choices.find(estimate => estimate.id === choiceId) || choices[0];
  const context = game.cases.find(item => item.id === choice?.id), current = metrics(context);
  const pending = game.reviewStatus === "PENDING", missed = game.reviewStatus === "MISSED_FINAL";
  const preliminary = pending || missed, selected = game.estimates.find(estimate => estimate.id === game.pickId);
  const selectionLabel = `${pending ? "Current lean: " : missed ? "Last pregame lean: " : "Review: "}${selected?.selection || "Pass"}`;
  const resultLabel = preliminary ? "" : selected ? ` · ${game.outcomes[selected.id]?.result || "Awaiting result"}` : " · All sides assessed";
  const start = Date.parse(game.gameTime), updated = Date.parse(game.sourceSnapshotAt);
  const completed = game.estimates.every(estimate => game.outcomes[estimate.id]);
  const finalStatus = `${completed ? "Completed · " : Date.now() >= start ? "Started · " : ""}Final snapshot`;
  const evidenceId = `matchup-evidence-${encodeURIComponent(`${game.sport}|${game.gameKey}`)}`;
  return <details className="fs-results mc-game">
    <summary className="mc-game-summary"><strong className="mc-game-title">{game.game}</strong>
      {Number.isFinite(start) ? <time className="mc-game-time" dateTime={game.gameTime}>{gameClock.format(start)} ET</time> : null}
      <span className={`mc-game-status${preliminary ? " mc-game-pending" : ""}`}>{pending ? "Pending final snapshot" : missed ? "Started · Final snapshot unavailable" : finalStatus} · {selectionLabel}{resultLabel}</span>
    </summary>
    <p className="mc-snapshot-note">{pending ? "Review can change until the final snapshot." : missed
      ? "Last pregame review retained. A final review was not captured; this game is outside the paper record."
      : "Review frozen at the final snapshot."} {Number.isFinite(updated) ? `Updated ${gameClock.format(updated)} ET.` : ""}</p>
    <div className="mc-game-choices" aria-label="Compare all four choices">
      {(["Spread", "Total"] as const).map(market => <section className="mc-market-comparison" key={market}>
        <h4>{market === "Spread" ? "Spread comparison" : "Total comparison"}</h4>
        <div className="mc-choice-grid">{choices.filter(estimate => estimate.market === market).map(estimate => {
          const detail = game.cases.find(item => item.id === estimate.id), values = metrics(detail), active = estimate.id === choice.id;
          const result = !preliminary ? game.outcomes[estimate.id]?.result : undefined;
          return <button key={estimate.id} type="button" className={`mc-choice-card${active ? " mc-choice-active" : ""}`}
            onClick={() => setChoiceId(estimate.id)} aria-pressed={active} aria-controls={evidenceId} aria-label={`Show evidence for ${estimate.selection}`}>
            <span className="mc-choice-title">{estimate.selection}</span>
            <span className="mc-choice-status">{estimate.id === game.pickId ? pending ? "Current lean" : missed ? "Pregame lean" : "Selected" : "Alternative"}{result ? ` · ${result}` : ""}</span>
            <span className="mc-choice-line">{values.openingLine != null ? `${number(values.openingLine, market === "Spread")} → ` : ""}{number(estimate.line, market === "Spread")} · {estimate.odds}</span>
            <span className="mc-choice-stats">
              <span><small>Money − bets</small><strong className={valueTone(values.moneyGap)}>{number(values.moneyGap, true)}{values.moneyGap != null ? " pts" : ""}</strong></span>
              <span><small>Team grade</small><strong className={values.teamScore != null && values.teamScore >= 75 ? "mc-positive" : ""}>{values.teamScore == null ? "See records" : `${number(values.teamScore)}/100`}</strong></span>
              <span><small>Model edge</small><strong className={valueTone(values.modelEdge)}>{number(values.modelEdge, true)}{values.modelEdge != null ? " pts" : ""}</strong></span>
              <span><small>Return after uncertainty</small><strong className={valueTone(estimate.conservativeRoi)}>{percent(estimate.conservativeRoi)}</strong></span>
            </span>
          </button>;
        })}</div>
      </section>)}
      <section id={evidenceId} className="mc-selected-evidence" aria-label={`Evidence for ${choice.selection}`}>
        <div className="mc-evidence-heading"><div><span>Viewing evidence</span><h4>{choice.selection}</h4></div><span>{choice.odds}</span></div>
        {current.activeSignals.length ? <div className="mc-signal-badges" aria-label="Active signals">{current.activeSignals.map(key => <span key={key}>{SIGNAL_NAMES[key] || key}</span>)}</div> : null}
        <CaseEvidence context={context} line={choice.line} market={choice.market as "Spread" | "Total"} />
        <details className="mc-estimate-details"><summary>Review estimate &amp; contributing factors</summary>
          <p>{choice.priceBasis} · Estimated return {percent(choice.expectedRoi)} · After uncertainty {percent(choice.conservativeRoi)}</p>
          {current.modelProjection != null ? <p>Model projection {number(current.modelProjection, choice.market === "Spread")} · Quoted line {number(choice.line, choice.market === "Spread")}</p> : null}
          {choice.reasons.length ? <p>{choice.reasons.join(" · ")}</p> : null}
          {choice.contributions.length ? <ul>{choice.contributions.map(factor => <li key={factor.feature}>{factor.feature} · {factor.value > 0 ? "Raises" : "Lowers"} the estimate</li>)}</ul> : null}
        </details>
      </section>
    </div>
  </details>;
}

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
    <summary>Matchup review <span>Four choices · Evidence at a glance</span></summary>
    {open ? <div aria-live="polite">
      {result?.key !== key || result.status === "loading" ? <p>Loading matchup reviews…</p>
        : result.status === "error" ? <p>The review could not be loaded. <button type="button" className="fs-filter" onClick={() => setRetry(value => value + 1)}>Try again</button></p>
        : !data?.available ? <p>Pending reviews appear when both spread sides and both total directions are available. They finalize with the final snapshot.</p>
        : <>
          <div className="mc-overview"><p>Paper record <strong>{data.record.record}</strong> · {data.record.pending} awaiting result · {data.record.netUnits.toFixed(2)}u</p>
            <p>{data.pendingGames || 0} pending final snapshot · {data.capturedGames} finalized{data.missedFinalGames ? ` · ${data.missedFinalGames} retained without a final snapshot` : ""}</p></div>
          <p className="mc-instructions">Open a game to compare both spread sides and both totals. Tap a choice for its team records, market evidence, and conflicts.</p>
          {data.today.map(game => <MatchupGame key={game.gameKey} game={game} />)}
          <details className="mc-estimate-details"><summary>About the paper review</summary>
            <p>Paper record through {date} · {data.passedGames} passed. Pending reviews update until the final snapshot. Final reviews use the frozen line and price. A retained preview without a final snapshot stays outside the record.</p>
            <p>The evaluator uses earlier results in the same sport and market. Estimated returns are experimental.</p>
            {data.model?.models.map(model => <p key={model.market}>{model.market} · {model.status} · {model.games} earlier games · {model.calibrationGames} later checks</p>)}
            {data.record.assumedPrices || data.record.unverifiedPrices ? <p>{data.record.assumedPrices} selections use assumed −110 · {data.record.unverifiedPrices} have unverified price provenance.</p> : null}
          </details>
        </>}
    </div> : null}
  </details>;
}
