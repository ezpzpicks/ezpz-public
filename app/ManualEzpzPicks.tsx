"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Clock3, Zap } from "lucide-react";
import { MatchupWithLogos, SelectionWithTeamLogo, type LogoSport } from "./TeamLogoName";

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
export default function ManualEzpzPicks({ sport }: { sport: LogoSport }) {
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
        if (!controller.signal.aborted) setError("Could not load EZPZ Picks. Please try again.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [sport]);

  const dates = useMemo(() => [...new Set([today, ...picks.map(pick => pick.date)])]
    .filter(Boolean).sort((a, b) => b.localeCompare(a)), [today, picks]);
  const visible = useMemo(() => picks.filter(pick => pick.date === selectedDate), [picks, selectedDate]);

  return <section className="fs-board ep-board" aria-label={`${sport} EZPZ Picks`}>
    <div className="fs-heading ep-heading"><h2>EZPZ Picks</h2></div>
    <div className="fs-toolbar">
      <span>{loading ? "Loading picks…" : error ? "Picks unavailable" : `${visible.length} ${visible.length === 1 ? "pick" : "picks"}`}</span>
      <label className="fs-date">Slate{" "}
        <select value={selectedDate} onChange={event => setSelectedDate(event.target.value)} aria-label="Picks game date">
          {dates.map(date => <option key={date} value={date}>{readableDate(date)}</option>)}
        </select>
      </label>
    </div>
    {error ? <div className="fs-empty" role="alert">{error}</div>
      : loading ? <div className="fs-empty">Loading picks…</div>
      : visible.length ? <div className="ep-picks-grid">
        {visible.map(pick => <article key={pick.id} className="ep-pick-card">
          <div className="ep-pick-header">
            <span className="ep-pick-badge"><Zap size={13} aria-hidden="true" />EZPZ PICK</span>
            <span className="ep-pick-market">{pick.market}</span>
          </div>
          <h3 className="ep-pick-selection"><SelectionWithTeamLogo sport={sport} selection={pick.selection} game={pick.game} /></h3>
          <p className="ep-pick-matchup"><MatchupWithLogos sport={sport} game={pick.game} compact /></p>
          <div className="ep-pick-footer">
            <time className="ep-pick-schedule" dateTime={pick.gameTime}>
              <span><CalendarDays size={14} aria-hidden="true" />{readableDate(pick.date)}</span>
              <span><Clock3 size={14} aria-hidden="true" />{readableTime(pick.gameTime)}</span>
            </time>
            {pick.odds ? <span className="ep-pick-odds"><span>Odds</span><strong>{pick.odds}</strong></span> : null}
          </div>
        </article>)}
      </div> : <div className="fs-empty">No {sport} EZPZ Picks for {readableDate(selectedDate)}.</div>}
    <style jsx>{`
      .ep-picks-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr));
        gap: 16px;
        align-items: stretch;
      }
      .ep-pick-card {
        position: relative;
        isolation: isolate;
        display: flex;
        flex-direction: column;
        min-width: 0;
        overflow: hidden;
        padding: 20px;
        border: 1px solid rgba(75, 148, 227, .28);
        border-radius: 22px;
        background: radial-gradient(ellipse at top right, rgba(27, 111, 207, .13), transparent 65%),
          linear-gradient(155deg, #0d1b2e, #080f1c);
        box-shadow: 0 18px 42px rgba(0, 0, 0, .24), inset 0 1px 0 rgba(255, 255, 255, .035);
        transition: border-color .2s ease, box-shadow .2s ease;
      }
      .ep-pick-card::before {
        content: "";
        position: absolute;
        inset: 18px auto 18px 0;
        width: 3px;
        border-radius: 0 3px 3px 0;
        background: linear-gradient(180deg, #2f8cff, #2bd875);
        box-shadow: 0 0 18px rgba(47, 140, 255, .25);
      }
      .ep-pick-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 10px;
        margin-bottom: 20px;
      }
      .ep-pick-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 9px;
        border: 1px solid rgba(69, 155, 255, .3);
        border-radius: 8px;
        background: rgba(33, 115, 215, .13);
        color: #8fcbff;
        font-size: 10px;
        font-weight: 850;
        letter-spacing: .08em;
      }
      .ep-pick-market {
        color: #91a7c0;
        font-size: 10px;
        font-weight: 750;
        letter-spacing: .1em;
        text-transform: uppercase;
      }
      .ep-pick-selection {
        margin: 0 0 12px;
        color: #f4f8ff;
        font-size: clamp(22px, 2.4vw, 27px);
        font-weight: 850;
        letter-spacing: -.035em;
        line-height: 1.25;
        overflow-wrap: anywhere;
      }
      .ep-pick-selection :global(img) {
        width: 36px !important;
        height: 36px !important;
        margin-right: 4px;
      }
      .ep-pick-matchup {
        margin: 0 0 22px;
        color: #acbdd1;
        font-size: 12px;
        font-weight: 550;
        line-height: 1.5;
      }
      .ep-pick-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-top: auto;
        padding-top: 14px;
        border-top: 1px solid rgba(122, 157, 196, .14);
      }
      .ep-pick-schedule {
        display: flex;
        flex-wrap: wrap;
        gap: 7px 14px;
        min-width: 0;
        color: #adbed2;
        font-size: 11px;
        font-weight: 600;
        line-height: 1.4;
        font-variant-numeric: tabular-nums;
      }
      .ep-pick-schedule > span {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        white-space: nowrap;
      }
      .ep-pick-schedule :global(svg) { color: #718ba8; }
      .ep-pick-odds {
        display: grid;
        flex: 0 0 auto;
        gap: 3px;
        min-width: 58px;
        padding: 7px 10px;
        border: 1px solid rgba(43, 216, 117, .18);
        border-radius: 10px;
        background: rgba(43, 216, 117, .06);
        text-align: center;
      }
      .ep-pick-odds > span {
        color: #94b5a7;
        font-size: 9px;
        font-weight: 700;
        letter-spacing: .07em;
        text-transform: uppercase;
      }
      .ep-pick-odds > strong {
        color: #75e5ac;
        font-size: 15px;
        font-weight: 850;
        font-variant-numeric: tabular-nums;
      }
      @media (hover: hover) {
        .ep-pick-card:hover {
          border-color: rgba(75, 155, 255, .5);
          box-shadow: 0 20px 48px rgba(0, 0, 0, .3), 0 0 24px rgba(47, 140, 255, .06);
        }
      }
      @media (max-width: 600px) {
        .ep-picks-grid { grid-template-columns: minmax(0, 1fr); gap: 12px; }
        .ep-pick-card { padding: 18px; border-radius: 20px; }
        .ep-pick-header { margin-bottom: 17px; }
      }
      @media (prefers-reduced-motion: reduce) {
        .ep-pick-card { transition: none; }
      }
    `}</style>
  </section>;
}
