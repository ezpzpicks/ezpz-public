"use client";

import { useEffect, useMemo, useState } from "react";

type Pick = { id: string; game: string; selection: string; date: string; result?: "W" | "L" | "P" | "VOID" | "PENDING"; netUnits?: number };

export default function ManualEzpzRecords({ sport }: { sport: string }) {
  const [picks, setPicks] = useState<Pick[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setPicks([]); setError(false); setLoading(true);
    void (async () => {
      try {
        const response = await fetch(`/api/ezpz-picks?sport=${encodeURIComponent(sport)}`,
          { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok || data.ok !== true || data.selectionPolicy !== "manually-approved-only"
          || !Array.isArray(data.picks)) throw new Error("Unverified record feed");
        if (!controller.signal.aborted) setPicks(data.picks.filter((row: Record<string, unknown>) => row.pickCategory === "manual"));
      } catch { if (!controller.signal.aborted) setError(true); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [sport]);
  const totals = useMemo(() => {
    const wins = picks.filter(p => p.result === "W").length;
    const losses = picks.filter(p => p.result === "L").length;
    const pushes = picks.filter(p => p.result === "P").length;
    const voids = picks.filter(p => p.result === "VOID").length;
    const pending = picks.filter(p => !p.result || p.result === "PENDING").length;
    const units = picks.reduce((sum, p) => sum + (typeof p.netUnits === "number" ? p.netUnits : 0), 0);
    const settledRisk = wins + losses + pushes;
    return { wins, losses, pushes, voids, pending, units, roi: settledRisk ? units / settledRisk * 100 : null };
  }, [picks]);
  return <section className="fs-board ep-board" aria-label={`${sport} manually approved EZPZ performance`}>
    <div className="fs-heading"><h2>{sport} Official EZPZ Picks Record</h2></div>
    <p className="fs-notice">Manually selected picks only · beginning November 12, 2026. Legacy automatic signal/model records are tracked separately below.</p>
    {loading ? <div className="fs-empty">Loading approved record…</div>
      : error ? <div className="fs-empty" role="alert">Record feed unavailable; totals cannot be verified.</div>
      : <>
        <div className="fs-picks-summary" aria-label="Official manual-pick performance">
          <span>Record<strong>{totals.wins}-{totals.losses}-{totals.pushes}</strong></span>
          <span>Units<strong>{totals.units >= 0 ? "+" : ""}{totals.units.toFixed(2)}u</strong></span>
          <span>ROI<strong>{totals.roi === null ? "—" : `${totals.roi.toFixed(1)}%`}</strong></span>
          <span>Pending<strong>{totals.pending}</strong></span>
        </div>
        {totals.voids ? <p className="fs-notice">{totals.voids} void selections excluded from settled risk.</p> : null}
        {picks.length ? <div className="fs-games">{picks.slice().reverse().map(pick =>
          <article className="fs-game" key={pick.id}>
            <strong>{pick.selection}</strong>
            <p>{pick.game} · {pick.date}</p>
            <span className="fs-count">{pick.result === "W" ? "✅ Win" : pick.result === "L" ? "❌ Loss" : pick.result === "P" ? "Push" : pick.result === "VOID" ? "Void" : "Pending"}</span>
          </article>)}</div>
          : <div className="fs-empty">No manually approved official picks yet. New records begin when a selection is explicitly approved.</div>}
      </>}
  </section>;
}
