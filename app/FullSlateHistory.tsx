"use client";

import { useEffect, useState, type ReactNode } from "react";

type Slate = { today?: string; slateToday?: Record<string, string>[]; marketAvailableDates?: string[] };
type Sport = "MLB" | "NFL" | "NCAAF" | "NCAAM";
const todayET = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const dateLabel = (date: string) => new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric",
}).format(new Date(`${date}T12:00:00Z`));

export default function FullSlateHistory<T extends Slate>({ sport, data, children }: {
  sport: Sport; data: T; children: (view: T, historical: boolean) => ReactNode;
}) {
  const current = data.today || todayET();
  const [choice, setChoice] = useState<{ sport: Sport; date: string } | null>(null);
  const [dates, setDates] = useState<{ sport: Sport; values: string[] } | null>(null);
  const [archive, setArchive] = useState<{ sport: Sport; date: string; data?: Slate; error?: boolean } | null>(null);
  const [datesError, setDatesError] = useState(false), [retry, setRetry] = useState(0);
  const selected = choice?.sport === sport ? choice.date : current;

  useEffect(() => {
    const controller = new AbortController();
    setDatesError(false);
    void fetch(`/api/slate-history?sport=${sport}`, { signal: controller.signal }).then(async response => {
      const value = await response.json();
      if (!response.ok || !value.ok || value.sport !== sport || !Array.isArray(value.availableDates)) throw new Error("History unavailable");
      if (!controller.signal.aborted) setDates({ sport, values: value.availableDates });
    }).catch(() => { if (!controller.signal.aborted) setDatesError(true); });
    return () => controller.abort();
  }, [sport, retry]);

  useEffect(() => {
    if (selected === current) return;
    const controller = new AbortController();
    setArchive({ sport, date: selected });
    void fetch(`/api/slate-history?sport=${sport}&date=${encodeURIComponent(selected)}`, { signal: controller.signal }).then(async response => {
      const value = await response.json();
      if (!response.ok || !value.ok || value.sport !== sport || value.today !== selected || !Array.isArray(value.slateToday)) throw new Error("Saved slate unavailable");
      if (!controller.signal.aborted) setArchive({ sport, date: selected, data: value });
    }).catch(() => { if (!controller.signal.aborted) setArchive({ sport, date: selected, error: true }); });
    return () => controller.abort();
  }, [sport, selected, current, retry]);

  const available = [...new Set([current, selected, ...(data.marketAvailableDates || []), ...(dates?.sport === sport ? dates.values : [])])]
    .filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort().reverse();
  const historical = selected !== current;
  const saved = archive?.sport === sport && archive.date === selected ? archive : null;
  const view = historical ? saved?.data ? { ...data, ...saved.data, draftKings: undefined, bestPlays: [], betTrackerRows: [] } as T : null : data;
  return <section className="slateHistory">
    <div className="slateHistoryControls">
      <label><span>Slate date</span><select aria-label={`View ${sport} full slate`} value={selected}
        onChange={event => setChoice({ sport, date: event.target.value })}>
        {available.map(date => <option key={date} value={date}>{dateLabel(date)}{date === todayET() ? " — Today" : ""}</option>)}
      </select></label>
      <p>{historical ? `Saved projections for ${dateLabel(selected)}` : "Choose a date to review saved projections."}</p>
    </div>
    {datesError && <p className="slateHistoryStatus" role="alert">Saved dates could not be loaded. <button type="button" onClick={() => setRetry(n => n + 1)}>Try again</button></p>}
    {view ? children(view, historical) : <p className="slateHistoryStatus" role={saved?.error ? "alert" : "status"}>
      {saved?.error ? <>Saved projections could not be loaded. <button type="button" onClick={() => setRetry(n => n + 1)}>Try again</button></> : "Loading saved projections…"}</p>}
    <style jsx>{`
      .slateHistory{display:grid;gap:18px;min-width:0}.slateHistoryControls{display:flex;align-items:flex-end;flex-wrap:wrap;gap:12px 20px;padding:16px;border:1px solid var(--ez-border);border-radius:18px;background:var(--ez-panel)}
      label{display:grid;gap:7px;min-width:0;max-width:100%;flex:0 1 300px}label>span{color:var(--ez-muted);font-size:.75rem;font-weight:850}select{box-sizing:border-box;width:100%;max-width:100%;min-width:0;min-height:44px;border:1px solid var(--ez-border);border-radius:11px;padding:10px 12px;background:var(--ez-panel-2);color:var(--ez-text,#eef6ff);font:inherit;color-scheme:dark}select:focus-visible,button:focus-visible{outline:2px solid #78b9ff;outline-offset:3px}
      .slateHistoryControls p{margin:0 0 10px;color:var(--ez-muted);font-size:.8rem}.slateHistoryStatus{margin:0;padding:20px;border:1px solid var(--ez-border);border-radius:16px;color:var(--ez-muted)}button{min-height:44px;margin-left:6px;border:1px solid var(--ez-border);border-radius:9px;padding:8px 12px;background:var(--ez-panel-2);color:#8bc5ff;font:inherit;cursor:pointer}@media(max-width:620px){label{flex-basis:100%;width:100%}.slateHistoryControls p{margin:0}}
    `}</style>
  </section>;
}
