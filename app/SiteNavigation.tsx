"use client";

import { useEffect, useRef, useState } from "react";
import { BarChart3, List, ChevronDown, MoreHorizontal, Radio, RefreshCw, Zap } from "lucide-react";

export type BoardTab = "Today’s Model Plays" | "Public Betting Splits" | "EZPZ Picks" | "Full Slate" | "Records" | "Signals" | "Player Props";
export type BoardSport = "MLB" | "NFL" | "NCAAF" | "NCAAM" | "NBA";
const primary = [
  { tab: "EZPZ Picks", label: "EZPZ Picks", Icon: Zap },
  { tab: "Signals", label: "Signals", Icon: Radio },
  { tab: "Today’s Model Plays", label: "Model Plays", Icon: BarChart3 },
] as const;
const supporting: { tab: BoardTab; label: string }[] = [
  { tab: "Records", label: "Records" },
  { tab: "Public Betting Splits", label: "Public Betting Splits" },
  { tab: "Full Slate", label: "Full Slate" },
];

export function SiteHeader({ sport, onSportChange, dates, date, onDateChange, refreshing, onRefresh }: {
  sport: BoardSport; onSportChange: (sport: BoardSport) => void; dates: string[]; date: string;
  onDateChange: (date: string) => void; refreshing: boolean; onRefresh: () => void;
}) {
  return <>
    <header className="ez-header">
      <div className="ez-trial-brand" aria-label="EZPZ Picks"><svg viewBox="0 0 92 44" aria-hidden="true"><path fill="currentColor" d="M16 2h34l-5 10H25l-3 6h17l-5 9H18l-3 6h22l-5 10H0zM55 2h37l-5 10-30 21h22l-5 10H37l5-10 30-21H50z" /></svg><span>EZPZ PICKS</span></div>
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

export default function SiteNavigation({ active, onChange, sport }: { active: BoardTab; onChange: (tab: BoardTab) => void; sport: BoardSport }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const mobileTrial = true;
  const primaryPages = mobileTrial ? [{ tab: "EZPZ Picks" as const, label: "Picks", Icon: Zap }, { tab: "Full Slate" as const, label: "Full Slate", Icon: List }, primary[2]] : primary;
  const supportPages = mobileTrial ? [{ tab: "Signals" as const, label: "Signals" }, ...supporting.filter(item => item.tab !== "Full Slate")] : supporting;
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
  const pages = sport === "NFL" ? [{ tab: "Player Props" as const, label: "Player Props" }, ...supportPages] : supportPages;
  return <nav className="ez-nav" aria-label="Main navigation">
    {primaryPages.map(({ tab, label, Icon }) => <button type="button" key={tab} className={active === tab ? "ez-nav-active" : ""} aria-current={active === tab ? "page" : undefined} onClick={() => navigate(tab)}>
      <Icon size={22} aria-hidden="true" /><span>{label}</span>
    </button>)}
    <div className="ez-more" ref={menu}>
      <button type="button" ref={moreButton} className={pages.some(item => item.tab === active) ? "ez-nav-active" : ""} aria-expanded={moreOpen} aria-controls="ez-more-menu" onClick={() => setMoreOpen(value => !value)}>
        <MoreHorizontal size={24} aria-hidden="true" /><span>More</span>
      </button>
      {moreOpen ? <div id="ez-more-menu" className="ez-more-menu" aria-label="More pages">
        {pages.map(item => <button type="button" key={item.tab} aria-current={active === item.tab ? "page" : undefined} onClick={() => navigate(item.tab)}>{item.label}</button>)}
      </div> : null}
    </div>
  </nav>;
}
