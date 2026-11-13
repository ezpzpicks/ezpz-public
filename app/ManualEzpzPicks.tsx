"use client";

import { useEffect, useMemo, useState } from "react";

type Pick = {
  id: string; pickId: string; sport: string; date: string; game: string;
  market: string; selection: string; line: number | string | null;
  odds: string | null; gameTime: string; approvedAt: string;
  pickCategory: "manual"; pickLabel: "EZPZ PICK"; eligibleForPosting: boolean;
  selectedBy: "Ryan";
  notes?: string;
};

function dateET() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function readableDate(date: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" })
    .format(new Date(`${date}T12:00:00Z`));
}

function readableTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true,
  }).format(new Date(value)) + " ET";
}

/**
 * Official Picks is no longer a view of the signal selector. The only entries
 * on this page are manually approved decisions in the official approval ledger.
 */
export default function ManualEzpzPicks({ sport }: { sport: string }) {
  const [today, setToday] = useState(dateET);
  const [selectedDate, setSelectedDate] = useState(dateET);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setToday(dateET());
    setSelectedDate(dateET());
    setPicks([]);
    setError("");
    setLoading(true);
    void (async () => {
      try {
        const response = await fetch(`/api/ezpz-picks?sport=${encodeURIComponent(sport)}`,
          { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok || data.ok !== true || data.selectionPolicy !== "manually-approved-only" || !Array.isArray(data.picks)) {
          throw new Error("The approved-pick feed is unavailable.");
        }
        if (!controller.signal.aborted) setPicks(data.picks.filter(
          (pick: Pick) => pick.pickCategory === "manual" && pick.pickLabel === "EZPZ PICK" && pick.selectedBy === "Ryan"));
      } catch {
        if (!controller.signal.aborted) setError("Could not verify official manual selections. No candidate picks will be substituted.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [sport]);

  const dates = useMemo(() => [...new Set([today, ...picks.map(pick => pick.date)])]
    .filter(Boolean).sort((a, b) => b.localeCompare(a)), [today, picks]);
  const visible = useMemo(() => picks.filter(pick => pick.date === selectedDate), [picks, selectedDate]);

  return <section className="fs-board ep-board" aria-label={`${sport} manually approved EZPZ Picks`}>
    <div className="fs-heading ep-heading"><h2>EZPZ Picks</h2></div>
    <div className="fs-toolbar">
      <span>{loading ? "Checking approved picks…" : error ? "Approval feed unavailable" : `${visible.length} officially approved ${visible.length === 1 ? "pick" : "picks"}`}</span>
      <label className="fs-date">Slate{" "}
        <select value={selectedDate} onChange={event => setSelectedDate(event.target.value)} aria-label="Approved picks game date">
          {dates.map(date => <option key={date} value={date}>{readableDate(date)}</option>)}
        </select>
      </label>
    </div>
    {error ? <div className="fs-empty" role="alert">{error}</div>
      : loading ? <div className="fs-empty">Loading approved picks…</div>
      : visible.length ? <div className="fs-games">
        {visible.map(pick => <article key={pick.id} className="fs-game fs-official-pick">
          <div className="fs-game-status"><strong>🎯 EZPZ PICK</strong><span>Selected by Ryan</span></div>
          <h3>{pick.selection}</h3>
          <p>{pick.game}</p>
          <div className="fs-summary-signals">
            <span className="fs-signal-chip">{pick.market}</span>
            <span className="fs-count">{readableDate(pick.date)} · {readableTime(pick.gameTime)}</span>
            {pick.odds ? <span className="fs-count">{pick.odds}</span> : null}
          </div>
          {/* Approval notes remain in the ledger; the card shows Ryan’s selection. */}
        </article>)}
      </div> : <div className="fs-empty">No official {sport} picks were manually approved for {readableDate(selectedDate)}. Picks appear here after Ryan selects them.</div>}
  </section>;
}
