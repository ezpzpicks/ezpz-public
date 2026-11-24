"use client";

import { useEffect, useMemo, useState } from "react";

type Pick = {
  id: string; game: string; gameTime?: string; selection: string; date: string;
  result?: "W" | "L" | "P" | "VOID" | "PENDING"; netUnits?: number;
  finalScore?: { away: number; home: number };
};
function dayLabel(date: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" })
    .format(new Date(`${date}T12:00:00Z`));
}
function RecordCard({ pick }: { pick: Pick }) {
  const settled = Boolean(pick.result && pick.result !== "PENDING");
  const label = pick.result === "W" ? "Win" : pick.result === "L" ? "Loss" : pick.result === "P" ? "Push"
    : pick.result === "VOID" ? "Void" : pick.gameTime && Date.parse(pick.gameTime) > Date.now() ? "Upcoming" : "Awaiting result";
  return <article className="officialRecordCard">
    <div><strong>{pick.selection}</strong><p>{pick.game}</p>
      {pick.finalScore ? <span className="officialFinalScore">Final {pick.finalScore.away}–{pick.finalScore.home}</span> : null}</div>
    <div className="officialRecordOutcome"><span className="officialResult" data-result={pick.result || "PENDING"}>{label}</span>
      {settled && typeof pick.netUnits === "number" ? <small>{pick.netUnits > 0 ? "+" : ""}{pick.netUnits.toFixed(2)}u</small> : null}</div>
  </article>;
}
export function OfficialRecordView({ sport, picks }: { sport: string; picks: Pick[] }) {
  const totals = useMemo(() => {
    const wins = picks.filter(p => p.result === "W").length, losses = picks.filter(p => p.result === "L").length;
    const pushes = picks.filter(p => p.result === "P").length, voids = picks.filter(p => p.result === "VOID").length;
    const pending = picks.filter(p => !p.result || p.result === "PENDING").length;
    const settled = picks.filter(p => p.result && p.result !== "PENDING" && p.result !== "VOID");
    const priced = settled.every(p => typeof p.netUnits === "number" && Number.isFinite(p.netUnits));
    const units = settled.reduce((sum, p) => sum + (typeof p.netUnits === "number" ? p.netUnits : 0), 0);
    const risk = wins + losses + pushes;
    return { wins, losses, pushes, voids, pending, units, risk, priced, roi: risk && priced ? units / risk * 100 : null };
  }, [picks]);
  const pending = picks.filter(pick => !pick.result || pick.result === "PENDING");
  const settled = picks.filter(pick => pick.result && pick.result !== "PENDING");
  const days = [...new Set(settled.map(pick => pick.date))].sort().reverse();
  return <>
    <div className="officialRecordSummary" aria-label="Official manual-pick performance">
      <div><span>Record</span><strong>{totals.risk ? `${totals.wins}–${totals.losses}–${totals.pushes}` : "—"}</strong></div>
      <div><span>Units</span><strong>{totals.risk && totals.priced ? `${totals.units >= 0 ? "+" : ""}${totals.units.toFixed(2)}u` : "—"}</strong></div>
      <div><span>ROI</span><strong>{totals.roi === null ? "—" : `${totals.roi >= 0 ? "+" : ""}${totals.roi.toFixed(1)}%`}</strong></div>
      <div><span>Pending</span><strong>{totals.pending}</strong></div>
    </div>
    <p className="officialRecordNote">Official selections · 1 unit risk per pick{totals.voids ? ` · ${totals.voids} void` : ""}</p>
    {pending.length ? <section className="officialRecordPending"><h3>Awaiting results <span>{pending.length}</span></h3>
      {pending.map(pick => <RecordCard key={pick.id} pick={pick} />)}</section> : null}
    {days.map((date, index) => {
      const results = settled.filter(pick => pick.date === date).reverse();
      const wins = results.filter(pick => pick.result === "W").length, losses = results.filter(pick => pick.result === "L").length;
      const pushes = results.filter(pick => pick.result === "P").length;
      return <details className="officialRecordDay" key={date} open={index === 0}>
        <summary><span>{dayLabel(date)}</span><span>{wins}–{losses}–{pushes}</span><span className="officialRecordDayCount">{results.length} picks</span></summary>
        <div>{results.map(pick => <RecordCard key={pick.id} pick={pick} />)}</div>
      </details>;
    })}
    {!picks.length ? <div className="fs-empty">No official picks recorded yet.</div> : null}
  </>;
}

export default function ManualEzpzRecords({ sport }: { sport: string }) {
  const [picks, setPicks] = useState<Pick[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let reading = false;
    setPicks([]); setError(false); setLoading(true);
    const refresh = async () => {
      if (reading || document.visibilityState === "hidden") return;
      reading = true;
      try {
        const response = await fetch(`/api/ezpz-picks?sport=${encodeURIComponent(sport)}`, { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok || data.ok !== true || data.selectionPolicy !== "manually-approved-only" || !Array.isArray(data.picks)) throw new Error("Unverified record feed");
        if (!controller.signal.aborted) { setPicks(data.picks.filter((row: Record<string, unknown>) => row.pickCategory === "manual")); setError(false); }
      } catch { if (!controller.signal.aborted) setError(true); }
      finally { reading = false; if (!controller.signal.aborted) setLoading(false); }
    };
    void refresh();
    const timer = window.setInterval(refresh, 60000);
    document.addEventListener("visibilitychange", refresh);
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [sport, retry]);
  return <section className="fs-board ep-board officialRecords" aria-label={`${sport} manually approved EZPZ performance`}>
    <div className="fs-heading"><h2>{sport} EZPZ Picks Record</h2></div>
    {loading ? <div className="fs-empty">Loading results…</div> : error && !picks.length
      ? <div className="fs-empty" role="alert">Results are unavailable. <button type="button" className="fullSlateShortcut" onClick={() => setRetry(n => n + 1)}>Try again</button></div>
      : <>{error ? <p className="officialRecordNote" role="status">Results could not refresh. Showing the last verified update.</p> : null}<OfficialRecordView sport={sport} picks={picks} /></>}
  </section>;
}
