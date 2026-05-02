"use client";

import { useEffect, useMemo, useState } from "react";

type RecordTotals = {
  label: string;
  record: string;
  totalBets: number;
  winPct: number;
  unitsWon: number;
  roiPct: number;
  wins: number;
  losses: number;
  pushes: number;
};
type Summary = {
  betType: string;
  status: "WINNING" | "EVEN" | "LOSING";
  wins: number;
  losses: number;
  pushes: number;
  totalBets: number;
  winPct: number;
  unitsWon: number;
  roiPct: number;
};
type Play = {
  playType: string;
  game: string;
  play: string;
  oddsLine: string;
  score: string | number;
  isGreen: boolean;
  awayTeam: string;
  homeTeam: string;
  headshotUrl?: string;
  playerTeam?: string;
  moneylinePct?: string;
};
type SheetRow = Record<string, string>;
type ApiData = {
  ok: boolean;
  error?: string;
  today: string;
  lastUpdated: string;
  tiles: {
    last7Days: RecordTotals;
    overallGreen: RecordTotals;
    pendingGreen: number;
    bestPlaysToday: number;
  };
  bestPlays: Play[];
  slateToday: SheetRow[];
  recordSummary: Summary[];
  last7RecordSummary: Summary[];
};

type Tab = "Today’s Best Plays" | "Full Slate" | "Records";
const TABS: Tab[] = ["Today’s Best Plays", "Full Slate", "Records"];

const GLOBAL_CSS = `
:root {
  --bg: #030712;
  --bg2: #07111f;
  --panel: rgba(11, 18, 32, 0.86);
  --panel2: rgba(15, 23, 42, 0.92);
  --panel3: rgba(17, 32, 54, 0.72);
  --bubble: rgba(30, 41, 59, 0.82);
  --bubble2: rgba(15, 23, 42, 0.62);
  --line: rgba(148, 163, 184, 0.18);
  --line2: rgba(56, 189, 248, 0.24);
  --text: #f8fafc;
  --muted: #8aa0bd;
  --soft: #cbd5e1;
  --green: #22c55e;
  --green2: #16a34a;
  --blue: #38bdf8;
  --blue2: #2563eb;
  --yellow: #f59e0b;
  --red: #ef4444;
}
* { box-sizing: border-box; }
html { background: var(--bg); scroll-behavior: smooth; }
body {
  margin: 0;
  min-height: 100vh;
  color: var(--text);
  background:
    radial-gradient(circle at 50% -7%, rgba(14, 165, 233, 0.33), transparent 28rem),
    radial-gradient(circle at 88% 4%, rgba(34, 197, 94, 0.15), transparent 23rem),
    radial-gradient(circle at 8% 20%, rgba(37, 99, 235, 0.18), transparent 24rem),
    linear-gradient(180deg, #030712 0%, #07111f 48%, #040816 100%);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
}
body:before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(rgba(255,255,255,.028) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,.028) 1px, transparent 1px);
  background-size: 44px 44px;
  mask-image: linear-gradient(to bottom, rgba(0,0,0,.42), transparent 70%);
}
button { font: inherit; }
.shell { width: min(1120px, calc(100% - 28px)); margin: 0 auto; padding: 22px 0 44px; position: relative; }
.hero {
  position: relative;
  text-align: center;
  padding: 18px 0 24px;
}
.hero:after {
  content:"";
  position:absolute;
  left:50%;
  bottom:-2px;
  width:min(740px, 90vw);
  height:1px;
  transform:translateX(-50%);
  background:linear-gradient(90deg, transparent, rgba(56,189,248,.5), rgba(34,197,94,.32), transparent);
}
.logoWrap {
  width: 176px; height: 176px; margin: 0 auto 18px; display: grid; place-items: center; border-radius: 999px;
  background:
    linear-gradient(145deg, rgba(56,189,248,.24), rgba(37,99,235,.08) 42%, rgba(34,197,94,.12)),
    rgba(15,23,42,.72);
  border: 1px solid rgba(125,211,252,.42);
  box-shadow: 0 0 34px rgba(56,189,248,.32), 0 0 96px rgba(37,99,235,.18), inset 0 0 24px rgba(255,255,255,.07);
  position: relative;
}
.logoWrap:before { content:""; position:absolute; inset:-16px; border-radius:999px; background:conic-gradient(from 120deg, rgba(56,189,248,.0), rgba(56,189,248,.25), rgba(34,197,94,.20), rgba(56,189,248,.0)); filter: blur(10px); z-index:-1; }
.logoWrap:after { content:""; position:absolute; inset:8px; border-radius:999px; border:1px solid rgba(255,255,255,.08); }
.logo { width: 132px; height: 132px; object-fit: contain; border-radius: 999px; position:relative; z-index:2; filter: drop-shadow(0 10px 18px rgba(0,0,0,.36)); }
.logoFallback { position:absolute; font-size:42px; font-weight:950; letter-spacing:-2px; color:#dbeafe; z-index:1; }
h1 {
  margin: 0;
  font-size: clamp(2.2rem, 6vw, 4.5rem);
  line-height: .92;
  letter-spacing: -.085em;
  text-shadow: 0 12px 36px rgba(37,99,235,.34);
}
.heroSub { max-width: 720px; margin: 12px auto 0; color: var(--soft); line-height: 1.45; font-weight: 700; font-size: clamp(.92rem, 2vw, 1.05rem); }
.heroSub:before { content:"LIVE MODEL • "; color:#86efac; font-weight:950; letter-spacing:.08em; font-size:.78em; }
.tileGrid { display:grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin: 18px 0 18px; }
.tile {
  position:relative;
  overflow:hidden;
  background:
    linear-gradient(135deg, rgba(15,23,42,.92), rgba(17,24,39,.78)),
    radial-gradient(circle at 100% 0%, rgba(56,189,248,.11), transparent 55%);
  border:1px solid rgba(148,163,184,.18);
  border-radius: 24px;
  padding: 17px 17px 16px;
  box-shadow: 0 18px 54px rgba(0,0,0,.30), inset 0 1px 0 rgba(255,255,255,.04);
}
.tile:before { content:""; position:absolute; inset:0 0 auto; height:1px; background:linear-gradient(90deg, transparent, rgba(125,211,252,.38), transparent); }
.tile.green { border-color: rgba(34,197,94,.46); box-shadow: 0 18px 58px rgba(34,197,94,.10), 0 18px 54px rgba(0,0,0,.30); }
.tile.green:after { content:""; position:absolute; right:-28px; top:-28px; width:94px; height:94px; border-radius:999px; background:radial-gradient(circle, rgba(34,197,94,.18), transparent 68%); }
.tileLabel { color: #93c5fd; font-size: .68rem; font-weight: 950; letter-spacing:.10em; text-transform: uppercase; }
.tileValue { margin-top: 8px; font-size: 1.8rem; line-height: 1; font-weight: 950; letter-spacing:-.05em; }
.tileMeta { margin-top: 7px; color: var(--soft); font-size: .8rem; font-weight: 800; }
.tabs {
  position: sticky; top: 0; z-index: 10;
  display:flex; justify-content:center; gap:9px; padding: 13px 0;
  backdrop-filter: blur(18px);
}
.tabs:before { content:""; position:absolute; inset:0 -20px; background:linear-gradient(180deg, rgba(3,7,18,.82), rgba(3,7,18,.35)); z-index:-1; border-bottom:1px solid rgba(148,163,184,.08); }
.tabBtn {
  cursor:pointer;
  border:1px solid rgba(148,163,184,.18);
  background: linear-gradient(135deg, rgba(15,23,42,.78), rgba(30,41,59,.46));
  color:#dbeafe;
  border-radius:999px;
  padding: 11px 16px;
  font-weight: 950;
  transition: .18s ease;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.04);
}
.tabBtn:hover { transform: translateY(-1px); border-color: rgba(56,189,248,.50); box-shadow:0 12px 30px rgba(14,165,233,.12); }
.tabBtn.active { background: linear-gradient(135deg, rgba(37,99,235,.98), rgba(14,165,233,.86)); border-color: rgba(125,211,252,.62); box-shadow: 0 12px 34px rgba(37,99,235,.28), inset 0 1px 0 rgba(255,255,255,.16); color:white; }
.sectionHead { display:flex; justify-content:space-between; gap: 16px; align-items:flex-end; margin: 22px 0 14px; }
.sectionHead h2 { margin:0; font-size: clamp(1.45rem, 3.8vw, 2.35rem); letter-spacing:-.055em; line-height:1; }
.sectionHead h2:after { content:""; display:block; width:62px; height:3px; border-radius:999px; margin-top:10px; background:linear-gradient(90deg, var(--green), var(--blue)); box-shadow:0 0 14px rgba(56,189,248,.35); }
.sectionHead p { margin: 8px 0 0; color: var(--muted); font-weight: 750; line-height:1.35; max-width:760px; }
.cards { display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.card {
  position:relative;
  overflow:hidden;
  background:
    linear-gradient(145deg, rgba(15,23,42,.92), rgba(17,24,39,.80)),
    radial-gradient(circle at 110% 0%, rgba(56,189,248,.11), transparent 40%);
  border:1px solid rgba(148,163,184,.17);
  border-radius: 26px;
  padding: 17px;
  box-shadow: 0 24px 72px rgba(0,0,0,.32), inset 0 1px 0 rgba(255,255,255,.04);
}
.card.green { border-left: 6px solid var(--green); border-top-color: rgba(34,197,94,.28); box-shadow: 0 24px 72px rgba(0,0,0,.32), 0 0 0 1px rgba(34,197,94,.10), 0 18px 70px rgba(34,197,94,.06); }
.card.yellow { border-left: 6px solid var(--yellow); }
.card.red { border-left: 6px solid var(--red); }
.card:before { content:""; position:absolute; top:0; left:0; right:0; height:1px; background:linear-gradient(90deg, transparent, rgba(125,211,252,.34), rgba(34,197,94,.22), transparent); }
.card:hover { transform: translateY(-1px); transition: transform .18s ease, border-color .18s ease; border-color:rgba(125,211,252,.24); }
.cardTop { display:flex; justify-content:space-between; align-items:flex-start; gap: 12px; margin-bottom: 4px; }
.rankBadge {
  width:42px; height:42px; display:grid; place-items:center; border-radius:14px;
  background: linear-gradient(135deg, rgba(34,197,94,.26), rgba(14,165,233,.14));
  border:1px solid rgba(34,197,94,.50);
  color:#dcfce7;
  font-weight: 950;
  box-shadow: 0 0 28px rgba(34,197,94,.14), inset 0 1px 0 rgba(255,255,255,.09);
}
.scorePill { display:inline-flex; align-items:center; padding:8px 11px; border-radius:999px; background: rgba(34,197,94,.15); border:1px solid rgba(34,197,94,.42); color:#dcfce7; font-size:.72rem; font-weight: 950; text-transform: uppercase; white-space:nowrap; box-shadow:0 0 18px rgba(34,197,94,.08); }
.cardTitle { font-size: 1.05rem; font-weight: 950; letter-spacing:-.02em; text-transform: uppercase; }
.cardSub { margin-top:4px; color:var(--soft); font-size:.83rem; font-weight: 750; }
.teamRow { display:grid; grid-template-columns: 1fr auto 1fr; gap: 10px; align-items:center; margin: 13px 0; padding:10px; border-radius:18px; background:rgba(15,23,42,.40); border:1px solid rgba(148,163,184,.10); }
.teamSide { display:flex; align-items:center; gap:9px; min-width:0; }
.teamSide.home { justify-content:flex-end; text-align:right; }
.teamName { font-weight: 950; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-size:.92rem; }
.vsText { width:34px; height:28px; display:grid; place-items:center; border-radius:999px; border:1px solid rgba(59,130,246,.50); background:rgba(37,99,235,.22); color:#bfdbfe; font-size:.66rem; font-weight:950; box-shadow:0 0 18px rgba(37,99,235,.14); }
.teamLogo { width:38px; height:38px; object-fit:contain; filter: drop-shadow(0 8px 12px rgba(0,0,0,.36)); }
.playMain { display:flex; align-items:center; gap: 12px; margin: 10px 0 0; }
.headshot, .headshotFallback { width:58px; height:58px; flex:0 0 58px; border-radius:999px; object-fit:cover; border:1px solid rgba(125,211,252,.30); background: rgba(255,255,255,.08); box-shadow:0 10px 24px rgba(0,0,0,.24); }
.headshotFallback { display:grid; place-items:center; font-weight:950; color:#dbeafe; background:linear-gradient(135deg, rgba(37,99,235,.36), rgba(15,23,42,.72)); }
.playName { font-size: 1.1rem; font-weight: 950; letter-spacing:-.025em; }
.playDetail { color: var(--soft); font-size:.82rem; font-weight: 750; margin-top: 2px; }
.bubbleGrid { display:grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 8px; margin-top: 13px; }
.miniBubble {
  border:1px solid rgba(148,163,184,.16);
  border-radius: 15px;
  padding: 10px 10px;
  background: rgba(30,41,59,.56);
  min-width:0;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.035);
}
.miniBubble.green { background: linear-gradient(135deg, rgba(34,197,94,.20), rgba(22,163,74,.10)); border-color: rgba(34,197,94,.45); }
.miniLabel { color:#93c5fd; font-size:.58rem; font-weight:950; letter-spacing:.09em; text-transform:uppercase; }
.miniValue { margin-top:5px; color:#f8fafc; font-size:.88rem; font-weight:950; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.marketStack { display:grid; gap:8px; margin-top: 10px; }
.marketBubble { width:100%; border:1px solid rgba(148,163,184,.15); border-radius: 15px; padding: 10px 12px; background: rgba(30,41,59,.50); font-size:.82rem; font-weight: 850; color:#f8fafc; }
.marketBubble.green { background:linear-gradient(135deg, rgba(34,197,94,.18), rgba(22,163,74,.08)); border-color:rgba(34,197,94,.43); color:#dcfce7; }
.pitcherGrid { display:grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; }
.pitcherBox { background: rgba(15,23,42,.44); border:1px solid rgba(148,163,184,.13); border-radius: 19px; padding: 10px; }
.pitcherHeader { display:flex; align-items:center; gap: 10px; margin-bottom: 8px; min-width:0; }
.pitcherLabel { color:#93c5fd; font-weight: 950; font-size:.68rem; letter-spacing:.08em; text-transform:uppercase; }
.pitcherNameSmall { color:#f8fafc; font-weight: 950; font-size:.85rem; line-height:1.12; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width: 150px; }
.pitcherBox .headshot, .pitcherBox .headshotFallback { width:46px; height:46px; flex-basis:46px; font-size:.78rem; }
.pitcherBox .bubbleGrid { grid-template-columns: repeat(2, minmax(0,1fr)); gap: 6px; margin-top: 8px; }
.pitcherBox .miniBubble { padding: 7px 7px; border-radius: 12px; }
.pitcherBox .miniLabel { font-size: .50rem; letter-spacing:.07em; }
.pitcherBox .miniValue { font-size: .74rem; }
.tableWrap { overflow:auto; border:1px solid rgba(148,163,184,.16); border-radius: 22px; background: rgba(15,23,42,.70); box-shadow:0 18px 48px rgba(0,0,0,.20); }
table { width:100%; border-collapse: collapse; min-width: 700px; }
th, td { padding: 13px 14px; border-bottom:1px solid rgba(148,163,184,.11); text-align:left; font-size:.88rem; }
th { color:#93c5fd; font-size:.72rem; text-transform:uppercase; letter-spacing:.09em; }
td { color:#e2e8f0; font-weight:750; }
tr:hover td { background:rgba(56,189,248,.035); }
.chip { display:inline-flex; border-radius:999px; padding:6px 10px; font-size:.7rem; font-weight:950; text-transform:uppercase; }
.chip.green { background:#dcfce7; color:#166534; }
.chip.yellow { background:#fef3c7; color:#92400e; }
.chip.red { background:#fee2e2; color:#991b1b; }
.empty, .error { border:1px dashed rgba(148,163,184,.28); border-radius:22px; padding:28px; text-align:center; color:var(--soft); background:rgba(15,23,42,.52); font-weight:800; }
.error { color:#fecaca; border-color:rgba(239,68,68,.35); }
@media (max-width: 900px) {
  .cards { grid-template-columns: 1fr; }
  .tileGrid { grid-template-columns:1fr; }
}
@media (max-width: 760px) {
  .shell { width: min(100% - 18px, 1120px); padding-top: 12px; }
  .teamRow { grid-template-columns: 1fr auto 1fr; gap: 6px; padding:8px; }
  .teamLogo { width:30px; height:30px; }
  .teamName { font-size:.78rem; }
  .bubbleGrid { grid-template-columns: repeat(2, minmax(0,1fr)); }
  .pitcherGrid { grid-template-columns:1fr; }
  .tabs { overflow-x:auto; justify-content:flex-start; }
  .tabBtn { white-space:nowrap; }
  .logoWrap { width:140px; height:140px; }
  .logo { width:106px; height:106px; }
}
`;

function statusClass(wins: number, losses: number) {
  if (wins > losses) return "green";
  if (wins === losses) return "yellow";
  return "red";
}

function Tile({ label, value, meta, green }: { label: string; value: string; meta: string; green?: boolean }) {
  return (
    <div className={`tile ${green ? "green" : ""}`}>
      <div className="tileLabel">{label}</div>
      <div className="tileValue">{value}</div>
      <div className="tileMeta">{meta}</div>
    </div>
  );
}

function normalizeType(value: string) {
  const text = String(value || "").toUpperCase();
  if (text.includes("STRONG OVER")) return "STRONG OVER";
  if (text.includes("LEAN OVER")) return "LEAN OVER";
  if (/\bOVER\b/.test(text)) return "OVER";
  if (text.includes("STRONG UNDER")) return "STRONG UNDER";
  if (text.includes("LEAN UNDER")) return "LEAN UNDER";
  if (/\bUNDER\b/.test(text)) return "UNDER";
  if (text.includes("ELITE NRFI")) return "ELITE NRFI";
  if (text.includes("STRONG NRFI")) return "STRONG NRFI";
  if (text.includes("LEAN NRFI")) return "LEAN NRFI";
  if (text.includes("YRFI")) return "YRFI";
  if (text === "NRFI" || text.includes(" NRFI")) return "NRFI";
  if (text.includes("A MONEYLINE")) return "A MONEYLINE";
  if (text.includes("B MONEYLINE")) return "B MONEYLINE";
  if (text.includes("NON-EDGE MONEYLINE")) return "NON-EDGE MONEYLINE";
  if (text.includes("PASS")) return "PASS";
  return text.trim();
}

const TEAM_ABBR: Record<string, string> = {
  "Arizona Diamondbacks": "ari", "Atlanta Braves": "atl", "Baltimore Orioles": "bal", "Boston Red Sox": "bos",
  "Chicago Cubs": "chc", "Chicago White Sox": "cws", "Cincinnati Reds": "cin", "Cleveland Guardians": "cle",
  "Colorado Rockies": "col", "Detroit Tigers": "det", "Houston Astros": "hou", "Kansas City Royals": "kc",
  "Los Angeles Angels": "laa", "Los Angeles Dodgers": "lad", "Miami Marlins": "mia", "Milwaukee Brewers": "mil",
  "Minnesota Twins": "min", "New York Mets": "nym", "New York Yankees": "nyy", "Athletics": "ath",
  "Oakland Athletics": "ath", "Philadelphia Phillies": "phi", "Pittsburgh Pirates": "pit", "San Diego Padres": "sd",
  "San Francisco Giants": "sf", "Seattle Mariners": "sea", "St. Louis Cardinals": "stl", "Tampa Bay Rays": "tb",
  "Texas Rangers": "tex", "Toronto Blue Jays": "tor", "Washington Nationals": "wsh",
};
function teamLogoUrl(team: string) {
  const abbr = TEAM_ABBR[team];
  return abbr ? `https://a.espncdn.com/i/teamlogos/mlb/500/${abbr}.png` : "";
}
function cleanPitcherName(summary: string) {
  let text = String(summary || "").trim();
  text = text.replace(/\([^)]*\)/g, "").replace(/\bLine\b.*$/i, "");
  text = text.replace(/\d+(\.\d+)?/g, "").replace(/\s+/g, " ").trim();
  return text;
}
function parseKSummary(summary: string, fallback = "") {
  const raw = String(summary || "").trim();
  const fallbackText = String(fallback || "").trim();

  // Most saved K summaries are like:
  // "Woo, Bryan 6.62 (OVER) Line 5.5"
  // But some PASS rows only have a line like "Gallen, Zac (PASS) 4.5".
  const explicitLine = raw.match(/\bLine\s*([0-9]+(?:\.[0-9]+)?)/i)?.[1]
    || fallbackText.match(/\bLine\s*([0-9]+(?:\.[0-9]+)?)/i)?.[1];

  const beforeGrade = raw.split("(")[0] || raw;
  const projectedMatches = [...beforeGrade.matchAll(/([0-9]+(?:\.[0-9]+)?)/g)].map((m) => m[1]);
  const projected = projectedMatches.length ? projectedMatches[projectedMatches.length - 1] : "";

  // If there is no explicit "Line" label, a number after the grade is almost always the K line.
  const afterGrade = raw.includes(")") ? raw.split(")").slice(1).join(")") : "";
  const afterGradeNumber = afterGrade.match(/([0-9]+(?:\.[0-9]+)?)/)?.[1];
  const fallbackNumber = fallbackText.match(/([0-9]+(?:\.[0-9]+)?)/)?.[1];

  const line = explicitLine || afterGradeNumber || fallbackNumber || "";

  return {
    projected: projected || "—",
    line: line || "—",
  };
}
function extractProjectedK(summary: string, fallback = "") {
  return parseKSummary(summary, fallback).projected;
}
function extractLine(summary: string, fallback = "") {
  return parseKSummary(summary, fallback).line;
}
function formatOdds(value: string | number) {
  const raw = String(value ?? "").trim();
  if (!raw) return "—";
  return raw.replace(/(^|\s)(\d{3,})(?=$|\s)/g, (_m, prefix, num) => `${prefix}+${num}`);
}
function initials(name: string) {
  const parts = String(name || "").replace(",", " ").split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "P";
}
function imageFromRow(row: SheetRow, keys: string[]) {
  for (const key of keys) {
    const val = String(row[key] || "").trim();
    if (val.startsWith("http")) return val;
  }
  return "";
}
function TeamRow({ awayTeam, homeTeam }: { awayTeam: string; homeTeam: string }) {
  const awayLogo = teamLogoUrl(awayTeam);
  const homeLogo = teamLogoUrl(homeTeam);
  return (
    <div className="teamRow">
      <div className="teamSide">
        {awayLogo ? <img className="teamLogo" src={awayLogo} alt={`${awayTeam} logo`} /> : null}
        <div className="teamName">{awayTeam}</div>
      </div>
      <div className="vsText">AT</div>
      <div className="teamSide home">
        <div className="teamName">{homeTeam}</div>
        {homeLogo ? <img className="teamLogo" src={homeLogo} alt={`${homeTeam} logo`} /> : null}
      </div>
    </div>
  );
}
function PitcherPhoto({ url, summary }: { url?: string; summary: string }) {
  const name = cleanPitcherName(summary);
  return url ? <img className="headshot" src={url} alt={`${name} headshot`} /> : <div className="headshotFallback">{initials(name)}</div>;
}
function MiniBubble({ label, value, green }: { label: string; value: string | number; green?: boolean }) {
  return (
    <div className={`miniBubble ${green ? "green" : ""}`}>
      <div className="miniLabel">{label}</div>
      <div className="miniValue">{value || "—"}</div>
    </div>
  );
}
function isKType(type: string) {
  return ["OVER", "UNDER", "LEAN OVER", "LEAN UNDER", "STRONG OVER", "STRONG UNDER"].includes(normalizeType(type));
}
function isMoneylineType(type: string) {
  return normalizeType(type).includes("MONEYLINE");
}
function moneylineGradeLabel(type: string) {
  const t = normalizeType(type);
  if (t === "A MONEYLINE") return "Moneyline A+";
  if (t === "B MONEYLINE") return "Moneyline B+";
  if (t === "NON-EDGE MONEYLINE") return "Moneyline";
  return t.replace("MONEYLINE", "Moneyline");
}
function BestPlayCard({ play, index }: { play: Play; index: number }) {
  const pitcherName = cleanPitcherName(play.play);
  const kPlay = isKType(play.playType);
  const moneylinePlay = isMoneylineType(play.playType);
  const displayTeam = play.playerTeam || play.play;
  return (
    <div className="card green">
      <div className="cardTop">
        <div className="rankBadge">#{index + 1}</div>
        <div className="scorePill">{play.playType} • Score {play.score || "—"}</div>
      </div>
      {play.awayTeam && play.homeTeam ? <TeamRow awayTeam={play.awayTeam} homeTeam={play.homeTeam} /> : <div className="cardSub">{play.game}</div>}
      {kPlay ? (
        <>
          <div className="playMain">
            <PitcherPhoto summary={play.play} url={play.headshotUrl} />
            <div>
              <div className="playName">{pitcherName}</div>
              <div className="playDetail">{play.playerTeam || play.game}</div>
            </div>
          </div>
          <div className="bubbleGrid">
            <MiniBubble label="Line" value={extractLine(play.play, play.oddsLine)} green />
            <MiniBubble label="Projected Ks" value={extractProjectedK(play.play, play.oddsLine)} green />
            <MiniBubble label="Rank Score" value={play.score || "—"} green />
            <MiniBubble label="Bet Type" value={play.playType} green />
          </div>
        </>
      ) : moneylinePlay ? (
        <>
          <div className="playMain">
            {teamLogoUrl(displayTeam) ? <img className="headshot" src={teamLogoUrl(displayTeam)} alt={`${displayTeam} logo`} /> : <div className="headshotFallback">{initials(displayTeam)}</div>}
            <div>
              <div className="playName">{displayTeam}</div>
              <div className="playDetail">{moneylineGradeLabel(play.playType)}</div>
            </div>
          </div>
          <div className="bubbleGrid">
            <MiniBubble label="Bet Type" value={play.playType} green />
            <MiniBubble label="Odds" value={formatOdds(play.oddsLine || "—")} green />
            <MiniBubble label="Moneyline %" value={play.moneylinePct || play.score || "—"} green />
            <MiniBubble label="Rank Score" value={play.score || "—"} green />
          </div>
        </>
      ) : (
        <>
          <div className="cardTitle">{play.playType}</div>
          <div className="cardSub">{play.game}</div>
          <div className="bubbleGrid">
            <MiniBubble label="Bet Type" value={play.playType} green />
            <MiniBubble label="Pick" value={play.play} green />
            <MiniBubble label="Line/Odds" value={formatOdds(play.oddsLine || "—")} green />
            <MiniBubble label="Rank Score" value={play.score || "—"} green />
          </div>
        </>
      )}
    </div>
  );
}
function KBubbleGroup({ summary, score, isGreen }: { summary: string; score: string; isGreen: boolean }) {
  if (!summary) return null;
  return (
    <div className="bubbleGrid">
      <MiniBubble label="Line" value={extractLine(summary)} green={isGreen} />
      <MiniBubble label="Projected Ks" value={extractProjectedK(summary)} green={isGreen} />
      <MiniBubble label="Rank Score" value={score || "—"} green={isGreen} />
      <MiniBubble label="Bet Type" value={normalizeType(summary) || "—"} green={isGreen} />
    </div>
  );
}
function SlateCard({ row, greenSet }: { row: SheetRow; greenSet: Set<string> }) {
  const game = row["Game Label"] || `${row["Away Team"]} at ${row["Home Team"]}`;
  const awayK = row["Away Pitcher K + Grade"] || "";
  const homeK = row["Home Pitcher K + Grade"] || "";
  const awayType = normalizeType(awayK);
  const homeType = normalizeType(homeK);
  const awayGreen = greenSet.has(awayType);
  const homeGreen = greenSet.has(homeType);
  const mlType = normalizeType(row["ML Grade"] || "");
  const nrfiType = normalizeType(row["NRFI Grade"] || "");
  const mlGreen = greenSet.has(mlType);
  const nrfiGreen = greenSet.has(nrfiType);
  const hasGreen = awayGreen || homeGreen || mlGreen || nrfiGreen;
  return (
    <div className={`card ${hasGreen ? "green" : ""}`}>
      <div className="cardTitle">{game}</div>
      <TeamRow awayTeam={row["Away Team"] || ""} homeTeam={row["Home Team"] || ""} />
      <div className="marketStack">
        {row["ML Grade"] ? <div className={`marketBubble ${mlGreen ? "green" : ""}`}>Moneyline: {row["Better ML"] || "—"} • {row["ML Grade"]} • {formatOdds(row["ML Odds"] || "—")}</div> : null}
        {row["NRFI Grade"] ? <div className={`marketBubble ${nrfiGreen ? "green" : ""}`}>NRFI/YRFI: {row["NRFI Grade"]}</div> : null}
      </div>
      <div className="pitcherGrid">
        <div className="pitcherBox">
          <div className="pitcherHeader">
            <PitcherPhoto summary={awayK || "Away Pitcher"} url={imageFromRow(row, ["Away Pitcher Headshot URL", "Away Pitcher Headshot", "Away Pitcher Image URL"])} />
            <div>
              <div className="pitcherLabel">Away Pitcher</div>
              <div className="pitcherNameSmall">{cleanPitcherName(awayK) || "Away Pitcher"}</div>
            </div>
          </div>
          <KBubbleGroup summary={awayK} score={row["Away Pitcher K Score"] || ""} isGreen={awayGreen} />
        </div>
        <div className="pitcherBox">
          <div className="pitcherHeader">
            <PitcherPhoto summary={homeK || "Home Pitcher"} url={imageFromRow(row, ["Home Pitcher Headshot URL", "Home Pitcher Headshot", "Home Pitcher Image URL"])} />
            <div>
              <div className="pitcherLabel">Home Pitcher</div>
              <div className="pitcherNameSmall">{cleanPitcherName(homeK) || "Home Pitcher"}</div>
            </div>
          </div>
          <KBubbleGroup summary={homeK} score={row["Home Pitcher K Score"] || ""} isGreen={homeGreen} />
        </div>
      </div>
    </div>
  );
}
function RecordsTable({ rows }: { rows: Summary[] }) {
  return (
    <div className="tableWrap">
      <table>
        <thead><tr><th>Bet Type</th><th>Status</th><th>Record</th><th>Win %</th><th>Units</th><th>ROI</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.betType}>
              <td>{r.betType}</td>
              <td><span className={`chip ${statusClass(r.wins, r.losses)}`}>{r.status}</span></td>
              <td>{r.wins}-{r.losses}-{r.pushes}</td>
              <td>{r.winPct}%</td>
              <td>{r.unitsWon}u</td>
              <td>{r.roiPct}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Home() {
  const [data, setData] = useState<ApiData | null>(null);
  const [error, setError] = useState("");
  const [active, setActive] = useState<Tab>("Today’s Best Plays");

  useEffect(() => {
    fetch("/api/public-data", { cache: "no-store" })
      .then((res) => res.json())
      .then((json) => json.ok ? setData(json) : setError(json.error || "Could not load public data."))
      .catch((err) => setError(err.message || "Could not load public data."));
  }, []);

  const content = useMemo(() => {
    if (error) return <div className="error">{error}</div>;
    if (!data) return <div className="empty">Loading EZPZ Picks...</div>;
    const greenSet = new Set(data.last7RecordSummary.filter((r) => r.wins > r.losses).map((r) => r.betType));

    if (active === "Today’s Best Plays") return (
      <>
        <div className="sectionHead"><div><h2>Today’s Best Plays</h2><p>Today’s pending tracker bets whose bet type is winning over the last 7 days. Last updated: {data.lastUpdated}</p></div></div>
        {data.bestPlays.length ? <div className="cards">{[...data.bestPlays].sort((a, b) => Number(b.score || 0) - Number(a.score || 0)).map((p, i) => <BestPlayCard key={`${p.game}-${p.play}-${i}`} play={p} index={i} />)}</div> : <div className="empty">No 7-day green best plays saved yet for {data.today}.</div>}
      </>
    );

    if (active === "Full Slate") return (
      <>
        <div className="sectionHead"><div><h2>Full Slate</h2><p>Every saved game for {data.today}. Only green best-play bet types use green bubbles.</p></div></div>
        {data.slateToday.length ? <div className="cards">{data.slateToday.map((row, i) => <SlateCard key={`${row["Game ID"]}-${i}`} row={row} greenSet={greenSet} />)}</div> : <div className="empty">No games saved today yet.</div>}
      </>
    );

    return (
      <>
        <div className="sectionHead"><div><h2>Last 7 Days Records</h2><p>These recent bet-type records decide what appears in Today’s Best Plays.</p></div></div>
        {data.last7RecordSummary.length ? <RecordsTable rows={data.last7RecordSummary} /> : <div className="empty">No completed bets in the last 7 days.</div>}
        <div className="sectionHead"><div><h2>All-Time Records</h2><p>Long-term bet-type performance from your completed tracker.</p></div></div>
        {data.recordSummary.length ? <RecordsTable rows={data.recordSummary} /> : <div className="empty">No completed bets yet.</div>}
      </>
    );
  }, [active, data, error]);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: GLOBAL_CSS }} />
      <main className="shell">
        <section className="hero">
          <div className="logoWrap"><div className="logoFallback">EZ</div><img className="logo" src="/ezpz_logo.png" alt="EZPZ Picks logo" /></div>
          <p className="heroSub">Algorithm-driven MLB betting projections, ranked by your recent green bet-type performance.</p>
        </section>
        {data ? (
          <section className="tileGrid">
            <Tile label="Last 7 Days Green Bets" value={data.tiles.last7Days.record} meta={`${data.tiles.last7Days.winPct}% • ${data.tiles.last7Days.unitsWon}u • ROI ${data.tiles.last7Days.roiPct}%`} green />
            <Tile label="Overall Green Bets" value={data.tiles.overallGreen.record} meta={`${data.tiles.overallGreen.winPct}% • ${data.tiles.overallGreen.unitsWon}u • ROI ${data.tiles.overallGreen.roiPct}%`} green />
            <Tile label="Today’s Best Plays" value={String(data.tiles.bestPlaysToday)} meta="Pending 7-day green plays" green={data.tiles.bestPlaysToday > 0} />
          </section>
        ) : null}
        <nav className="tabs">{TABS.map((tab) => <button key={tab} className={`tabBtn ${active === tab ? "active" : ""}`} onClick={() => setActive(tab)}>{tab}</button>)}</nav>
        {content}
      </main>
    </>
  );
}
