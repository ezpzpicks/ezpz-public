"use client";

import { useEffect, useState } from "react";
import type { TrialModel, TrialDecision, TrialSport } from "../lib/selectionTrial";
import FadeTrialPanel, { type FadeTrialReport } from "./FadeTrialPanel";

type RecordSummary = { record: string; settled: number; pending: number; netUnits: number; roiPct: number | null;
  assumedPrices: number; unverifiedPrices: number };
type Payload = { ok: boolean; available: boolean; error?: string; model: TrialModel | null; capturedGames: number;
  passedGames: number; trial: RecordSummary; comparison: RecordSummary; today: TrialDecision[];
  paperTrial?: { policy: { version: string; minRawRoi: number }; capturedGames: number; reversalGames: number;
    startedAt: string | null; raw: RecordSummary; matchedRaw: RecordSummary; opposite: RecordSummary };
  fadeTrial?: FadeTrialReport };
const pct = (value: number | null) => value == null ? "—" : `${value.toFixed(1)}%`;
const roi = (value: number) => `${value > 0 ? "+" : ""}${(100 * value).toFixed(1)}%`;

export default function SelectionTrial({ sport, date, initiallyOpen = false }: { sport: TrialSport; date: string; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen), [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; status: "loading" | "ready" | "error"; data?: Payload } | null>(null);
  const key = `${sport}|${date}|${retry}`;
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setResult({ key, status: "loading" });
    fetch(`/api/selection-trial?sport=${encodeURIComponent(sport)}&date=${encodeURIComponent(date)}`, { signal: controller.signal })
      .then(async response => { const data = await response.json(); if (!response.ok || !data.ok) throw new Error("Unavailable"); return data as Payload; })
      .then(data => { if (!controller.signal.aborted) setResult({ key, status: "ready", data }); })
      .catch(() => { if (!controller.signal.aborted) setResult({ key, status: "error" }); });
    return () => controller.abort();
  }, [open, key, sport, date]);
  const data = result?.key === key && result.status === "ready" ? result.data : undefined;
  return <details className="fs-results fs-trial" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Selection trial <span>Expected value · Research only</span></summary>
    {open ? <div aria-live="polite">
      {result?.key !== key || result?.status === "loading" ? <p>Loading saved trial…</p>
        : result?.status === "error" ? <p>The trial could not be loaded. <button type="button" className="fs-filter" onClick={() => setRetry(n => n + 1)}>Try again</button></p>
        : !data?.available ? <p>{date < new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
          ? "No prospective trial was recorded for this date." : "The trial is awaiting its first scheduled refresh for this date."} It uses this sport’s original pregame observations.</p>
        : <>
          <p>Tests estimated return after price, overlapping signals and uncertainty. Trial selections have their own record and do not publish as official EZPZ Picks.</p>
          <table className="fs-table"><thead><tr><th scope="col">Selection method</th><th scope="col">Record</th><th scope="col">ROI / units</th></tr></thead><tbody>
            {([["Expected-value trial", data.trial], ["Current rule on matched games", data.comparison]] as const).map(([label, record]) => <tr key={label}>
              <th scope="row">{label}</th><td data-label="Record">{record.record}<small>{record.pending} pending</small></td>
              <td data-label="ROI / units">{pct(record.roiPct)}<small>{record.netUnits > 0 ? "+" : ""}{record.netUnits.toFixed(2)}u</small></td>
            </tr>)}
          </tbody></table>
          <p>{data.capturedGames} complete games captured · {data.passedGames} passed. Comparison covers the same captured games and quotes, not the full official record.</p>
          <table className="fs-table"><thead><tr><th scope="col">Market</th><th scope="col">Earlier training games</th><th scope="col">Later calibration games</th></tr></thead><tbody>
            {data.model!.models.map(model => <tr key={model.market}><th scope="row">{model.market}<small>{model.status}</small></th>
              <td data-label="Earlier training games">{model.games}<small>{model.dates} dates</small></td>
              <td data-label="Later calibration games">{model.calibrationGames}<small>{model.calibrationDates} dates</small></td></tr>)}
          </tbody></table>
          <FadeTrialPanel sport={sport} date={date} data={data.fadeTrial} decisions={data.today} />
          {data.today.length ? <table className="fs-table"><thead><tr><th scope="col">Saved game</th><th scope="col">Trial decision</th><th scope="col">Estimated return</th></tr></thead><tbody>
            {data.today.map(game => { const pick = game.estimates.find(e => e.id === game.pickId);
              const leader = pick || game.estimates.slice().sort((a, b) => b.conservativeRoi - a.conservativeRoi)[0];
              return <tr key={game.gameKey}><th scope="row">{game.game}<small>{game.date}</small></th>
                <td data-label="Trial decision">{pick ? pick.selection : "Pass"}<small>{pick ? game.outcomes[pick.id]?.result || "Pending" : leader?.reasons.join(" · ")}</small></td>
                <td data-label="Estimated return">{leader ? roi(leader.conservativeRoi) : "—"}<small>{leader ? `After uncertainty · ${leader.priceBasis}` : ""}</small></td></tr>; })}
          </tbody></table> : <p>No complete game cards were captured for this date yet. Decisions require both markets in the final 10–20 minutes.</p>}
          {data.paperTrial ? <>
            <h3>Mechanical opposite-side test</h3>
            <p>Tests the other side when a raw candidate reaches +2% estimated ROI, enough earlier validation exists,
              calibration retains zero learned adjustment, and raw probability error is worse than the market baseline.
              Both sides freeze before the game. A rejection caused only by uncertainty or missing validation does not trigger a reversal.</p>
            <table className="fs-table"><thead><tr><th scope="col">Paper strategy</th><th scope="col">Record</th><th scope="col">ROI / units</th></tr></thead><tbody>
              {([["Raw candidates · all qualifying games", data.paperTrial.raw],
                ["Original candidates · reversal games only", data.paperTrial.matchedRaw],
                ["Opposite sides · same reversal games", data.paperTrial.opposite]] as const).map(([label, record]) => <tr key={label}>
                <th scope="row">{label}</th><td data-label="Record">{record.record}<small>{record.pending} pending</small></td>
                <td data-label="ROI / units">{pct(record.roiPct)}<small>{record.netUnits > 0 ? "+" : ""}{record.netUnits.toFixed(2)}u</small></td>
              </tr>)}
            </tbody></table>
            <p>{data.paperTrial.capturedGames} prospective paper cards · {data.paperTrial.reversalGames} reversal selections.
              {data.paperTrial.startedAt ? ` First card: ${new Date(data.paperTrial.startedAt).toLocaleString("en-US", {
                timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} Eastern.`
                : " Awaiting the first complete pregame card after this test was added."}
              {" "}Historical reversed records are exploratory and are excluded from these results.</p>
            {data.today.some(game => game.paperComparison?.version === data.paperTrial!.policy.version)
              ? <table className="fs-table"><thead><tr><th scope="col">Saved game</th><th scope="col">Raw candidate</th><th scope="col">Opposite-side test</th></tr></thead><tbody>
                {data.today.filter(game => game.paperComparison?.version === data.paperTrial!.policy.version).map(game => {
                  const paper = game.paperComparison!, candidate = game.estimates.find(e => e.id === paper.candidateId);
                  const raw = paper.rawEstimates.find(e => e.id === paper.candidateId), opposite = game.estimates.find(e => e.id === paper.oppositePickId);
                  return <tr key={game.gameKey}><th scope="row">{game.game}<small>{game.date}</small></th>
                    <td data-label="Raw candidate">{candidate?.selection || "Pass"}<small>{candidate && raw
                      ? `${candidate.odds} · ${roi(raw.expectedRoi)} estimated · ${candidate.priceBasis}` : "No raw candidate reaches +2%."}</small>
                      {candidate ? <small>{paper.rawPickId ? game.outcomes[candidate.id]?.result || "Pending" : "Training requirements not met; no raw paper selection."}</small> : null}</td>
                    <td data-label="Opposite-side test">{opposite?.selection || "Pass"}<small>{opposite
                      ? `${opposite.odds} · ${game.outcomes[opposite.id]?.result || "Pending"} · ${opposite.priceBasis}` : paper.reason}</small>
                      {opposite ? <small>Calibration rejected the learned direction; earlier raw error exceeded the market baseline.</small> : null}</td></tr>;
                })}
              </tbody></table> : null}
            <p>The opposite side is a paper hypothesis, without an established profitable win probability. Its price determines actual test returns.
              Official EZPZ selections and publishing use their existing rules.</p>
          </> : null}
          <p>Training uses results known before this date’s Eastern midnight. Return estimates are experimental. Basketball prices may assume −110; other unverified prices are identified.</p>
        </>}
      <p><a href="/selection-trial">Review all sports</a></p>
    </div> : null}
  </details>;
}
