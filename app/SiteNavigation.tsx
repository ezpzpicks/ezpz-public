"use client";

import { useEffect, useRef, useState } from "react";
import { BarChart3, ChevronDown, MoreHorizontal, Radio, RefreshCw, Zap } from "lucide-react";

export type BoardTab = "Today’s Model Plays" | "Public Betting Splits" | "EZPZ Picks" | "Full Slate" | "Records" | "Signals";
export type BoardSport = "MLB" | "NFL" | "NCAAF" | "NCAAM" | "NBA";
const primary = [
  { label: "EZPZ Picks", Icon: Zap },
  { label: "Signals", Icon: Radio },
  { label: "Records", Icon: BarChart3 },
] as const;
const supporting: { tab: BoardTab; label: string }[] = [
  { tab: "Today’s Model Plays", label: "Model Plays" },
  { tab: "Public Betting Splits", label: "Public Betting Splits" },
  { tab: "Full Slate", label: "Full Slate" },
];

export function SiteHeader({ sport, onSportChange, dates, date, onDateChange, refreshing, onRefresh }: {
  sport: BoardSport; onSportChange: (sport: BoardSport) => void; dates: string[]; date: string;
  onDateChange: (date: string) => void; refreshing: boolean; onRefresh: () => void;
}) {
  return <>
    <header className="ez-header">
      <div className="ez-brand"><img src="/ezpz_logo.png" width={44} height={44} alt="EZPZ Picks logo" /><h1>EZPZ Picks</h1></div>
      <button type="button" className="ez-refresh" onClick={onRefresh} disabled={refreshing} aria-label={`Refresh ${sport} public board`}>
        <RefreshCw size={21} className={refreshing ? "ez-refreshing" : ""} aria-hidden="true" />
      </button>
    </header>
    <div className="ez-context">
      <label><span className="ez-sr-only">Sport</span><select aria-label="Sport" value={sport} onChange={event => onSportChange(event.target.value as BoardSport)}>
        {(["MLB", "NFL", "NCAAF", "NCAAM", "NBA"] as const).map(value => <option key={value}>{value}</option>)}
      </select><ChevronDown size={17} aria-hidden="true" /></label>
      {dates.length ? <label><span className="ez-sr-only">Slate</span><select aria-label="Slate" value={date} onChange={event => onDateChange(event.target.value)}>
        {dates.map(value => <option key={value} value={value}>{new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" }).format(new Date(value + "T12:00:00Z"))}</option>)}
      </select><ChevronDown size={17} aria-hidden="true" /></label> : null}
    </div>
  </>;
}

export default function SiteNavigation({ active, onChange }: { active: BoardTab; onChange: (tab: BoardTab) => void }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!moreOpen) return;
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) setMoreOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setMoreOpen(false); moreButton.current?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [moreOpen]);
  const navigate = (tab: BoardTab) => { setMoreOpen(false); onChange(tab); };
  return <nav className="ez-nav" aria-label="Main navigation">
    {primary.map(({ label, Icon }) => <button type="button" key={label} className={active === label ? "ez-nav-active" : ""} aria-current={active === label ? "page" : undefined} onClick={() => navigate(label)}>
      <Icon size={22} aria-hidden="true" /><span>{label}</span>
    </button>)}
    <div className="ez-more" ref={menu}>
      <button type="button" ref={moreButton} className={supporting.some(item => item.tab === active) ? "ez-nav-active" : ""} aria-expanded={moreOpen} aria-controls="ez-more-menu" onClick={() => setMoreOpen(value => !value)}>
        <MoreHorizontal size={24} aria-hidden="true" /><span>More</span>
      </button>
      {moreOpen ? <div id="ez-more-menu" className="ez-more-menu" aria-label="More pages">
        {supporting.map(item => <button type="button" key={item.tab} aria-current={active === item.tab ? "page" : undefined} onClick={() => navigate(item.tab)}>{item.label}</button>)}
      </div> : null}
    </div>
  </nav>;
}
