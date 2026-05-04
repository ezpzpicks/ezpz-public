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
  projectedKs?: string | number;
  sixInningKs?: string | number;
  volatility?: string;
  altLine?: string | number;
  altOdds?: string | number;
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
const BEST_PLAY_MIN_ODDS = -145;

const TEAM_ABBR: Record<string, string> = {
  "Arizona Diamondbacks": "ari",
  "Atlanta Braves": "atl",
  "Baltimore Orioles": "bal",
  "Boston Red Sox": "bos",
  "Chicago Cubs": "chc",
  "Chicago White Sox": "cws",
  "Cincinnati Reds": "cin",
  "Cleveland Guardians": "cle",
  "Colorado Rockies": "col",
  "Detroit Tigers": "det",
  "Houston Astros": "hou",
  "Kansas City Royals": "kc",
  "Los Angeles Angels": "laa",
  "Los Angeles Dodgers": "lad",
  "Miami Marlins": "mia",
  "Milwaukee Brewers": "mil",
  "Minnesota Twins": "min",
  "New York Mets": "nym",
  "New York Yankees": "nyy",
  Athletics: "ath",
  "Oakland Athletics": "ath",
  "Philadelphia Phillies": "phi",
  "Pittsburgh Pirates": "pit",
  "San Diego Padres": "sd",
  "San Francisco Giants": "sf",
  "Seattle Mariners": "sea",
  "St. Louis Cardinals": "stl",
  "Tampa Bay Rays": "tb",
  "Texas Rangers": "tex",
  "Toronto Blue Jays": "tor",
  "Washington Nationals": "wsh",
  "D-backs": "ari",
  Braves: "atl",
  Orioles: "bal",
  "Red Sox": "bos",
  Cubs: "chc",
  "White Sox": "cws",
  Reds: "cin",
  Guardians: "cle",
  Rockies: "col",
  Tigers: "det",
  Astros: "hou",
  Royals: "kc",
  Angels: "laa",
  Dodgers: "lad",
  Marlins: "mia",
  Brewers: "mil",
  Twins: "min",
  Mets: "nym",
  Yankees: "nyy",
  Phillies: "phi",
  Pirates: "pit",
  Padres: "sd",
  Giants: "sf",
  Mariners: "sea",
  Cardinals: "stl",
  Rays: "tb",
  Rangers: "tex",
  "Blue Jays": "tor",
  Nationals: "wsh",
};

function normalizeType(value: unknown) {
  const text = String(value || "").toUpperCase().trim();

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

  return text;
}

function isKType(type: unknown) {
  return ["OVER", "UNDER", "LEAN OVER", "LEAN UNDER", "STRONG OVER", "STRONG UNDER"].includes(normalizeType(type));
}

function isMoneylineType(type: unknown) {
  return normalizeType(type).includes("MONEYLINE");
}

function isNonEdgeMoneyline(type: unknown) {
  return normalizeType(type) === "NON-EDGE MONEYLINE";
}

function isPass(type: unknown) {
  return normalizeType(type) === "PASS";
}

function toNumber(value: unknown) {
  const n = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parseScore(value: unknown) {
  const n = toNumber(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 50;
}

function parseAmericanOdds(value: unknown) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/[+-]?\d+/);
  if (!match) return 0;

  const odds = Number(match[0]);
  return Number.isFinite(odds) && Math.abs(odds) >= 100 ? odds : 0;
}

function passesBestPlayOdds(play: Play) {
  const odds = parseAmericanOdds(play.oddsLine);

  // If odds are missing from the sheet, do not accidentally hide the play.
  // Any available odds worse than -145 are excluded from Best Plays.
  return odds === 0 || odds >= BEST_PLAY_MIN_ODDS;
}

function isQualifiedGreenPlay(play: Play) {
  if (isPass(play.playType)) return false;
  if (isNonEdgeMoneyline(play.playType)) return false;

  return play.isGreen === true;
}

function isBestPlay(play: Play) {
  if (!isQualifiedGreenPlay(play)) return false;

  // Normal Best Plays must be -145 or better.
  // Pitcher props can still qualify at worse odds only when they trigger the strict ALT badge logic.
  return passesBestPlayOdds(play) || hasAltBadge(play);
}

function formatOdds(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "—";

  return raw.replace(/(^|\s)(\d{3,})(?=$|\s)/g, (_match, prefix, num) => `${prefix}+${num}`);
}

function cleanTeamName(value: unknown) {
  return String(value || "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\b\d+(?:\.\d+)?%/g, "")
    .replace(/\bMoneyline\b/gi, "")
    .replace(/\bA\+?\b|\bB\+?\b/gi, "")
    .replace(/[()[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function teamLogoUrl(team: string) {
  const cleaned = cleanTeamName(team);
  const abbr = TEAM_ABBR[cleaned] || TEAM_ABBR[team];
  return abbr ? `https://a.espncdn.com/i/teamlogos/mlb/500/${abbr}.png` : "";
}

function initials(name: string) {
  const parts = String(name || "").replace(",", " ").split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "P";
}

function cleanPitcherName(summary: string) {
  return String(summary || "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\bLine\b.*$/i, "")
    .replace(/\d+(\.\d+)?/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseKSummary(summary: string, fallback = "") {
  const raw = String(summary || "").trim();
  const fallbackText = String(fallback || "").trim();

  const explicitLine =
    raw.match(/\bLine\s*([0-9]+(?:\.[0-9]+)?)/i)?.[1] ||
    fallbackText.match(/\bLine\s*([0-9]+(?:\.[0-9]+)?)/i)?.[1];

  const beforeGrade = raw.split("(")[0] || raw;
  const projectedMatches = [...beforeGrade.matchAll(/([0-9]+(?:\.[0-9]+)?)/g)].map((match) => match[1]);
  const projected = projectedMatches.length ? projectedMatches[projectedMatches.length - 1] : "";

  const afterGrade = raw.includes(")") ? raw.split(")").slice(1).join(")") : "";
  const afterGradeNumber = afterGrade.match(/([0-9]+(?:\.[0-9]+)?)/)?.[1];
  const fallbackNumber = fallbackText.match(/([0-9]+(?:\.[0-9]+)?)/)?.[1];

  return {
    projected: projected || "—",
    line: explicitLine || afterGradeNumber || fallbackNumber || "—",
  };
}

function extractProjectedK(summary: string, fallback = "") {
  return parseKSummary(summary, fallback).projected;
}

function extractLine(summary: string, fallback = "") {
  return parseKSummary(summary, fallback).line;
}

function getRecentSummary(playType: string, rows: Summary[]) {
  const type = normalizeType(playType);
  return rows.find((row) => normalizeType(row.betType) === type) || null;
}

function getFormInfo(summary: Summary | null) {
  if (!summary || summary.totalBets < 3) {
    return { label: "Neutral", icon: "➖", className: "neutral", detail: "small 7-day sample" };
  }

  if (summary.wins > summary.losses && summary.winPct >= 58) {
    return { label: "Hot", icon: "🔥", className: "hot", detail: `${summary.wins}-${summary.losses}-${summary.pushes} last 7` };
  }

  if (summary.winPct < 45) {
    return { label: "Cold", icon: "❄️", className: "cold", detail: `${summary.wins}-${summary.losses}-${summary.pushes} last 7` };
  }

  return { label: "Neutral", icon: "➖", className: "neutral", detail: `${summary.wins}-${summary.losses}-${summary.pushes} last 7` };
}

function hasAltBadge(play: Play) {
  if (!isKType(play.playType)) return false;

  const expectedKs = toNumber(play.projectedKs) || toNumber(extractProjectedK(play.play, play.oddsLine));
  const line = toNumber(extractLine(play.play, play.oddsLine));
  const sixInningKs = toNumber(play.sixInningKs);
  const score = parseScore(play.score);
  const volatility = String(play.volatility || "").toLowerCase();
  const type = normalizeType(play.playType);

  if (!expectedKs || !line || !sixInningKs) return false;
  if (volatility === "high") return false;

  const overAlt = type.includes("OVER") && expectedKs >= line + 1 && sixInningKs >= line + 0.5;
  const underAlt = type.includes("UNDER") && expectedKs <= line - 1 && sixInningKs <= line - 0.5;

  return (overAlt || underAlt) && score >= 75;
}

function moneylineGradeLabel(type: string) {
  const normalized = normalizeType(type);
  if (normalized === "A MONEYLINE") return "Moneyline A+";
  if (normalized === "B MONEYLINE") return "Moneyline B+";
  if (normalized === "NON-EDGE MONEYLINE") return "Moneyline";

  return normalized.replace("MONEYLINE", "Moneyline");
}

function cleanMoneylineTeam(value: unknown) {
  return cleanTeamName(value);
}

function firstValue(row: SheetRow | undefined, keys: string[]) {
  if (!row) return "";
  for (const key of keys) {
    const value = String(row[key] || "").trim();
    if (value) return value;
  }
  return "";
}

function firstValueByKeyMatch(row: SheetRow | undefined, include: string[], exclude: string[] = []) {
  if (!row) return "";
  const includeLower = include.map((item) => item.toLowerCase());
  const excludeLower = exclude.map((item) => item.toLowerCase());

  for (const [key, value] of Object.entries(row)) {
    const keyLower = key.toLowerCase();
    const raw = String(value || "").trim();
    if (!raw) continue;
    if (includeLower.every((item) => keyLower.includes(item)) && !excludeLower.some((item) => keyLower.includes(item))) {
      return raw;
    }
  }

  return "";
}

function firstUrlByKeyMatch(row: SheetRow | undefined, include: string[], exclude: string[] = []) {
  if (!row) return "";
  const includeLower = include.map((item) => item.toLowerCase());
  const excludeLower = exclude.map((item) => item.toLowerCase());

  for (const [key, value] of Object.entries(row)) {
    const keyLower = key.toLowerCase();
    const raw = String(value || "").trim();
    if (!raw.startsWith("http")) continue;
    if (includeLower.every((item) => keyLower.includes(item)) && !excludeLower.some((item) => keyLower.includes(item))) {
      return raw;
    }
  }

  return "";
}

function firstOddsByKeyMatch(row: SheetRow | undefined, include: string[], exclude: string[] = []) {
  const raw = firstValueByKeyMatch(row, include, exclude);
  const odds = formatOdds(raw);
  return odds !== "—" && parseAmericanOdds(odds) ? odds : "";
}

function formatModelPct(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "—";
  const match = raw.match(/\d+(?:\.\d+)?\s*%?/);
  if (!match) return "—";
  const pct = match[0].replace(/\s/g, "");
  return pct.includes("%") ? pct : `${pct}%`;
}

function getPlayableOdds(play: Play, slateRows: SheetRow[] = []) {
  const directValues = [play.altOdds, play.oddsLine];
  for (const value of directValues) {
    const odds = formatOdds(value || "");
    if (odds !== "—" && parseAmericanOdds(odds)) return odds;
  }

  const row = findSlateRowForPlay(play, slateRows);
  if (!row || !isKType(play.playType)) return "—";

  const side = pitcherSideForPlay(play, row);
  const sideTitle = side === "away" ? "Away" : side === "home" ? "Home" : "";

  const directKeys = sideTitle
    ? [
        `${sideTitle} Pitcher K Odds`,
        `${sideTitle} K Odds`,
        `${sideTitle} Pitcher Odds`,
        `${sideTitle} Pitcher Prop Odds`,
        `${sideTitle} Pitcher Odds/Line`,
        `${sideTitle} Pitcher K Odds/Line`,
        `${sideTitle} SO Odds`,
        `${sideTitle} Strikeout Odds`,
        `${sideTitle} Strikeouts Odds`,
        `${sideTitle} Prop Odds`,
      ]
    : ["Pitcher K Odds", "K Odds", "Prop Odds", "Odds/Line", "Odds"];

  const directOdds = formatOdds(firstValue(row, directKeys));
  if (directOdds !== "—" && parseAmericanOdds(directOdds)) return directOdds;

  if (side) {
    const sideOdds =
      firstOddsByKeyMatch(row, [side, "pitcher", "odds"], ["moneyline", "ml", "nrfi", "yrfi"]) ||
      firstOddsByKeyMatch(row, [side, "k", "odds"], ["moneyline", "ml", "nrfi", "yrfi"]) ||
      firstOddsByKeyMatch(row, [side, "strikeout", "odds"], ["moneyline", "ml", "nrfi", "yrfi"]);
    if (sideOdds) return sideOdds;
  }

  const genericOdds =
    firstOddsByKeyMatch(row, ["pitcher", "odds"], ["moneyline", "ml", "nrfi", "yrfi"]) ||
    firstOddsByKeyMatch(row, ["k", "odds"], ["moneyline", "ml", "nrfi", "yrfi"]) ||
    firstOddsByKeyMatch(row, ["strikeout", "odds"], ["moneyline", "ml", "nrfi", "yrfi"]);

  return genericOdds || "—";
}

function findSlateRowForPlay(play: Play, rows: SheetRow[]) {
  return rows.find((row) => {
    const game = row["Game Label"] || `${row["Away Team"] || ""} at ${row["Home Team"] || ""}`.trim();
    return game === play.game || (row["Away Team"] === play.awayTeam && row["Home Team"] === play.homeTeam);
  });
}
function getModelPctForMoneyline(play: Play, slateRows: SheetRow[]) {
  const direct = formatModelPct(play.moneylinePct);
  if (direct !== "—") return direct;

  const row = findSlateRowForPlay(play, slateRows);
  if (!row) return "—";

  const pickedTeam = cleanTeamName(play.playerTeam || play.play);
  const away = cleanTeamName(row["Away Team"]);
  const home = cleanTeamName(row["Home Team"]);

  const generic = formatModelPct(firstValue(row, ["Model %", "Better ML %", "Better Moneyline %", "Moneyline %", "ML %", "Win %", "Win%", "Moneyline Model %"]));
  if (generic !== "—") return generic;

  if (pickedTeam && away && pickedTeam.toLowerCase() === away.toLowerCase()) {
    return formatModelPct(firstValue(row, ["Away Model %", "Away ML %", "Away Win %", "Away Moneyline %"]));
  }

  if (pickedTeam && home && pickedTeam.toLowerCase() === home.toLowerCase()) {
    return formatModelPct(firstValue(row, ["Home Model %", "Home ML %", "Home Win %", "Home Moneyline %"]));
  }

  return "—";
}

function whyThisPlay(play: Play, recentSummary: Summary | null, slateRows: SheetRow[]) {
  const type = normalizeType(play.playType);
  const score = Math.round(parseScore(play.score));
  const row = findSlateRowForPlay(play, slateRows);

  if (isMoneylineType(play.playType)) {
    const modelPct = getModelPctForMoneyline(play, slateRows);
    const odds = formatOdds(play.oddsLine || firstValue(row, ["ML Odds", "Moneyline Odds", "Odds", "Odds/Line"]));
    return `Model likes this moneyline side with a ${modelPct} win projection, ${odds} odds, and a ${score}/100 rank score. The grade is ${moneylineGradeLabel(type)}, so it qualified as a green moneyline play.`;
  }

  if (isKType(play.playType)) {
    const projected = play.projectedKs || extractProjectedK(play.play, play.oddsLine);
    const line = play.altLine || extractLine(play.play, play.oddsLine);
    const odds = getPlayableOdds(play, slateRows);
    return `Pitcher prop qualified as ${type}. The model projection is ${projected} Ks against a line of ${line}, with ${odds} odds and a ${score}/100 rank score. That means the projection is far enough from the line to flag it as a playable edge.`;
  }

  const formText = recentSummary ? ` Recent ${type} results are ${recentSummary.wins}-${recentSummary.losses}-${recentSummary.pushes} over the last 7 days.` : "";
  return `${type} qualified as a green first-inning play with a ${score}/100 rank score.${formText}`;
}

function WhyDropdown({ play, recentSummary, slateRows }: { play: Play; recentSummary: Summary | null; slateRows: SheetRow[] }) {
  return (
    <details className="whyBox">
      <summary>Why this play?</summary>
      <p>{whyThisPlay(play, recentSummary, slateRows)}</p>
    </details>
  );
}


function personTokens(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z\s,]/g, " ")
    .replace(/,/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function pitcherNameMatches(a: string, b: string) {
  const aTokens = personTokens(a);
  const bTokens = personTokens(b);
  if (!aTokens.length || !bTokens.length) return false;
  const aJoined = aTokens.join(" ");
  const bJoined = bTokens.join(" ");
  const aLast = aTokens[aTokens.length - 1];
  const bLast = bTokens[bTokens.length - 1];
  const aFirst = aTokens[0];
  const bFirst = bTokens[0];
  return aJoined === bJoined || aJoined.includes(bJoined) || bJoined.includes(aJoined) || aLast === bLast || (aLast === bFirst && aFirst === bLast);
}

function imageForBestPlay(play: Play, rows: SheetRow[]) {
  const direct = String(play.headshotUrl || "").trim();
  if (direct.startsWith("http")) return direct;
  if (!isKType(play.playType)) return "";

  const row = findSlateRowForPlay(play, rows);
  if (!row) return "";

  const side = pitcherSideForPlay(play, row);
  const sideTitle = side === "away" ? "Away" : side === "home" ? "Home" : "";

  if (sideTitle) {
    const directImage = imageFromRow(row, [
      `${sideTitle} Pitcher Headshot URL`,
      `${sideTitle} Pitcher Headshot`,
      `${sideTitle} Pitcher Image URL`,
      `${sideTitle} Pitcher Image`,
      `${sideTitle} Pitcher Photo URL`,
      `${sideTitle} Pitcher Photo`,
      `${sideTitle} Headshot URL`,
      `${sideTitle} Headshot`,
      `${sideTitle} Player Image URL`,
      `${sideTitle} Player Image`,
      `${sideTitle} Player Photo`,
    ]);
    if (directImage) return directImage;

    const matchedImage =
      firstUrlByKeyMatch(row, [side, "pitcher", "headshot"]) ||
      firstUrlByKeyMatch(row, [side, "pitcher", "image"]) ||
      firstUrlByKeyMatch(row, [side, "pitcher", "photo"]) ||
      firstUrlByKeyMatch(row, [side, "headshot"]) ||
      firstUrlByKeyMatch(row, [side, "image"]);
    if (matchedImage) return matchedImage;
  }

  return (
    firstUrlByKeyMatch(row, ["pitcher", "headshot"]) ||
    firstUrlByKeyMatch(row, ["pitcher", "image"]) ||
    firstUrlByKeyMatch(row, ["pitcher", "photo"]) ||
    ""
  );
}

function imageFromRow(row: SheetRow, keys: string[]) {
  for (const key of keys) {
    const value = String(row[key] || "").trim();
    if (value.startsWith("http")) return value;
  }

  return "";
}

function pitcherSideForPlay(play: Play, row: SheetRow | undefined) {
  if (!row || !isKType(play.playType)) return "";

  const pitcherName = cleanPitcherName(play.play).toLowerCase();
  const awaySummary = String(row["Away Pitcher K + Grade"] || row["Away Pitcher"] || "");
  const homeSummary = String(row["Home Pitcher K + Grade"] || row["Home Pitcher"] || "");
  const awayName = cleanPitcherName(awaySummary).toLowerCase();
  const homeName = cleanPitcherName(homeSummary).toLowerCase();

  if (pitcherNameMatches(pitcherName, awayName)) return "away";
  if (pitcherNameMatches(pitcherName, homeName)) return "home";

  const playerTeam = cleanTeamName(play.playerTeam || "").toLowerCase();
  const awayTeam = cleanTeamName(row["Away Team"] || "").toLowerCase();
  const homeTeam = cleanTeamName(row["Home Team"] || "").toLowerCase();
  if (playerTeam && awayTeam && playerTeam === awayTeam) return "away";
  if (playerTeam && homeTeam && playerTeam === homeTeam) return "home";

  return "";
}

function statusClass(wins: number, losses: number) {
  if (wins > losses) return "green";
  if (wins === losses) return "yellow";
  return "red";
}

function slateMoneylinePassesBestPlayRules(row: SheetRow) {
  const grade = normalizeType(row["ML Grade"] || "");
  if (grade === "NON-EDGE MONEYLINE" || grade === "PASS") return false;

  const odds = row["ML Odds"] || row["Moneyline Odds"] || row["Odds"] || "";
  return passesBestPlayOdds({ oddsLine: odds } as Play);
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

function TeamRow({ awayTeam, homeTeam }: { awayTeam: string; homeTeam: string }) {
  const cleanAway = cleanTeamName(awayTeam);
  const cleanHome = cleanTeamName(homeTeam);
  const awayLogo = teamLogoUrl(cleanAway);
  const homeLogo = teamLogoUrl(cleanHome);

  return (
    <div className="teamRow">
      <div className="teamSide">
        {awayLogo ? <img className="teamLogo" src={awayLogo} alt={`${cleanAway} logo`} /> : null}
        <div className="teamName">{cleanAway}</div>
      </div>

      <div className="vsText">AT</div>

      <div className="teamSide home">
        <div className="teamName">{cleanHome}</div>
        {homeLogo ? <img className="teamLogo" src={homeLogo} alt={`${cleanHome} logo`} /> : null}
      </div>
    </div>
  );
}

function PitcherPhoto({ url, summary }: { url?: string; summary: string }) {
  const name = cleanPitcherName(summary);

  if (url && String(url).startsWith("http")) {
    return <img className="headshot" src={url} alt={`${name} headshot`} />;
  }

  return <div className="headshotFallback">{initials(name)}</div>;
}

function MiniBubble({ label, value, green }: { label: string; value: string | number; green?: boolean }) {
  return (
    <div className={`miniBubble ${green ? "green" : ""}`}>
      <div className="miniLabel">{label}</div>
      <div className="miniValue">{value || "—"}</div>
    </div>
  );
}

function FormTag({ summary }: { summary: Summary | null }) {
  const form = getFormInfo(summary);

  return (
    <div className={`formPill ${form.className}`}>
      {form.icon} {form.label} <span style={{ opacity: 0.72 }}>• {form.detail}</span>
    </div>
  );
}

function ConfidenceBar({ score }: { score: string | number }) {
  const pct = parseScore(score);

  return (
    <div className="confidenceWrap">
      <div className="confidenceTop">
        <span>Model Confidence</span>
        <span>{Math.round(pct)}%</span>
      </div>
      <div className="confidenceBar">
        <div className="confidenceFill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function BadgeRow({ play, recentSummary }: { play: Play; recentSummary: Summary | null }) {
  const form = getFormInfo(recentSummary);
  const showHot = form.className === "hot";
  const showCold = form.className === "cold";
  const showAlt = hasAltBadge(play);

  if (!showHot && !showCold && !showAlt) return null;

  return (
    <div className="badges">
      {showHot ? <span className="badge hot">🔥 Hot</span> : null}
      {showCold ? <span className="badge cold">❄️ Cold</span> : null}
      {showAlt ? <span className="badge alt">⭐ ALT</span> : null}
    </div>
  );
}

function BestPlayCard({ play, index, recentSummary, slateRows }: { play: Play; index: number; recentSummary: Summary | null; slateRows: SheetRow[] }) {
  const kPlay = isKType(play.playType);
  const moneylinePlay = isMoneylineType(play.playType);
  const pitcherName = cleanPitcherName(play.play);
  const rawDisplayTeam = play.playerTeam || play.play;
  const displayTeam = moneylinePlay ? cleanMoneylineTeam(rawDisplayTeam) || cleanMoneylineTeam(play.play) || "Moneyline" : rawDisplayTeam;
  const modelPct = getModelPctForMoneyline(play, slateRows);
  const pitcherImage = imageForBestPlay(play, slateRows);
  const topPlay = index < 3;

  return (
    <div className={`card green fade-in best ${topPlay ? "top" : ""}`}>
      <div className="cardTop">
        <div className="rankBadge">#{index + 1}</div>
        <div className="scorePill">Score {play.score || "—"}</div>
      </div>

      {play.awayTeam && play.homeTeam ? (
        <TeamRow awayTeam={play.awayTeam} homeTeam={play.homeTeam} />
      ) : (
        <div className="cardSub">{play.game}</div>
      )}

      {kPlay ? (
        <>
          <div className="playMain">
            <PitcherPhoto summary={play.play} url={pitcherImage} />
            <div>
              <div className="playName">{pitcherName}</div>
              <div className="playDetail">{play.playerTeam || play.game}</div>
            </div>
          </div>

          <div className="projectionBlock">
            <div className="projection">{play.projectedKs || extractProjectedK(play.play, play.oddsLine)} Ks</div>
            <div className="grade">{normalizeType(play.playType)}</div>
          </div>

          <div className="divider" />

          <div className="bubbleGrid three">
            <MiniBubble label="Line" value={play.altLine || extractLine(play.play, play.oddsLine)} green />
            <MiniBubble label="Odds" value={getPlayableOdds(play, slateRows)} green />
            <MiniBubble label="Projected Ks" value={play.projectedKs || extractProjectedK(play.play, play.oddsLine)} green />
          </div>
        </>
      ) : moneylinePlay ? (
        <>
          <div className="playMain">
            {teamLogoUrl(displayTeam) ? (
              <img className="headshot" src={teamLogoUrl(displayTeam)} alt={`${displayTeam} logo`} />
            ) : (
              <div className="headshotFallback">{initials(displayTeam)}</div>
            )}
            <div>
              <div className="playName">{displayTeam}</div>
              <div className="playDetail">{moneylineGradeLabel(play.playType)}</div>
            </div>
          </div>

          <div className="projectionBlock">
            <div className="projection">Moneyline</div>
            <div className="grade">{moneylineGradeLabel(play.playType)}</div>
          </div>

          <div className="divider" />

          <div className="bubbleGrid">
            <MiniBubble label="Odds" value={formatOdds(play.oddsLine || "—")} green />
            <MiniBubble label="Model %" value={modelPct} green />
            <MiniBubble label="Rank Score" value={play.score || "—"} green />
            <MiniBubble label="Bet Type" value={normalizeType(play.playType)} green />
          </div>
        </>
      ) : (
        <>
          <div className="cardTitle">{normalizeType(play.playType)}</div>
          <div className="cardSub">{play.game}</div>

          <div className="projectionBlock">
            <div className="projection">{play.play}</div>
            <div className="grade">{normalizeType(play.playType)}</div>
          </div>

          <div className="divider" />

          <div className="bubbleGrid three">
            <MiniBubble label="Pick" value={play.play} green />
            <MiniBubble label="Rank Score" value={play.score || "—"} green />
            <MiniBubble label="Bet Type" value={normalizeType(play.playType)} green />
          </div>
        </>
      )}

      <WhyDropdown play={play} recentSummary={recentSummary} slateRows={slateRows} />
      <BadgeRow play={play} recentSummary={recentSummary} />
      <div className="formRow"><FormTag summary={recentSummary} /></div>
      <ConfidenceBar score={play.score || 50} />
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

function SlateCard({ row }: { row: SheetRow }) {
  const game = row["Game Label"] || `${row["Away Team"]} at ${row["Home Team"]}`;
  const awayK = row["Away Pitcher K + Grade"] || "";
  const homeK = row["Home Pitcher K + Grade"] || "";
  const awayGreen = !isPass(awayK) && !isNonEdgeMoneyline(awayK);
  const homeGreen = !isPass(homeK) && !isNonEdgeMoneyline(homeK);
  const mlType = normalizeType(row["ML Grade"] || "");
  const nrfiType = normalizeType(row["NRFI Grade"] || "");
  const mlGreen = mlType !== "" && mlType !== "PASS" && mlType !== "NON-EDGE MONEYLINE" && slateMoneylinePassesBestPlayRules(row);
  const nrfiGreen = nrfiType !== "" && nrfiType !== "PASS";
  const hasGreen = awayGreen || homeGreen || mlGreen || nrfiGreen;

  return (
    <div className={`card ${hasGreen ? "green" : ""}`}>
      <div className="cardTitle">{game}</div>
      {hasGreen ? <div className="slateGreenCallout">Qualified play active</div> : null}

      <TeamRow awayTeam={row["Away Team"] || ""} homeTeam={row["Home Team"] || ""} />

      <div className="marketStack">
        {row["ML Grade"] ? (
          <div className={`marketBubble ${mlGreen ? "green" : ""}`}>
            Moneyline: {row["Better ML"] || "—"} • {row["ML Grade"]} • {formatOdds(row["ML Odds"] || "—")}
          </div>
        ) : null}

        {row["NRFI Grade"] ? (
          <div className={`marketBubble ${nrfiGreen ? "green" : ""}`}>NRFI/YRFI: {row["NRFI Grade"]}</div>
        ) : null}
      </div>

      <div className="pitcherGrid">
        <PitcherSlateBox
          label="Away Pitcher"
          summary={awayK}
          score={row["Away Pitcher K Score"] || ""}
          isGreen={awayGreen}
          imageUrl={imageFromRow(row, ["Away Pitcher Headshot URL", "Away Pitcher Headshot", "Away Pitcher Image URL"])}
        />
        <PitcherSlateBox
          label="Home Pitcher"
          summary={homeK}
          score={row["Home Pitcher K Score"] || ""}
          isGreen={homeGreen}
          imageUrl={imageFromRow(row, ["Home Pitcher Headshot URL", "Home Pitcher Headshot", "Home Pitcher Image URL"])}
        />
      </div>
    </div>
  );
}

function PitcherSlateBox({
  label,
  summary,
  score,
  isGreen,
  imageUrl,
}: {
  label: string;
  summary: string;
  score: string;
  isGreen: boolean;
  imageUrl: string;
}) {
  return (
    <div className="pitcherBox">
      <div className="pitcherHeader">
        <PitcherPhoto summary={summary || label} url={imageUrl} />
        <div>
          <div className="pitcherLabel">{label}</div>
          <div className="pitcherNameSmall">{cleanPitcherName(summary) || label}</div>
        </div>
      </div>
      <KBubbleGroup summary={summary} score={score} isGreen={isGreen} />
    </div>
  );
}

function RecordsTable({ rows }: { rows: Summary[] }) {
  return (
    <div className="tableWrap">
      <table>
        <thead>
          <tr>
            <th>Bet Type</th>
            <th>Status</th>
            <th>Record</th>
            <th>Win %</th>
            <th>Units</th>
            <th>ROI</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.betType}>
              <td>{row.betType}</td>
              <td><span className={`chip ${statusClass(row.wins, row.losses)}`}>{row.status}</span></td>
              <td>{row.wins}-{row.losses}-{row.pushes}</td>
              <td>{row.winPct}%</td>
              <td>{row.unitsWon}u</td>
              <td>{row.roiPct}%</td>
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
      .then((json) => (json.ok ? setData(json) : setError(json.error || "Could not load public data.")))
      .catch((err) => setError(err.message || "Could not load public data."));
  }, []);

  const bestPlays = useMemo(() => {
    if (!data) return [];
    return data.bestPlays
      .filter(isBestPlay)
      .sort((a, b) => parseScore(b.score) - parseScore(a.score));
  }, [data]);

  const content = useMemo(() => {
    if (error) return <div className="error">{error}</div>;
    if (!data) return <div className="empty">Loading EZPZ Picks...</div>;

    if (active === "Today’s Best Plays") {
      const recentByType = new Map(data.last7RecordSummary.map((row) => [normalizeType(row.betType), row]));

      return (
        <>
          <div className="sectionHead">
            <div>
              <h2>Today’s Best Plays</h2>
              <p>Last updated: {data.lastUpdated}</p>
            </div>
          </div>

          {bestPlays.length ? (
            <div className="cards">
              {bestPlays.map((play, index) => (
                <BestPlayCard
                  key={`${play.game}-${play.play}-${index}`}
                  play={play}
                  index={index}
                  recentSummary={recentByType.get(normalizeType(play.playType)) || null}
                  slateRows={data.slateToday}
                />
              ))}
            </div>
          ) : (
            <div className="empty">No qualified Best Plays saved yet for {data.today}.</div>
          )}
        </>
      );
    }

    if (active === "Full Slate") {
      return (
        <>
          <div className="sectionHead">
            <div>
              <h2>Full Slate</h2>
              <p>Every saved game for {data.today}. Green highlights show qualified plays only.</p>
            </div>
          </div>

          {data.slateToday.length ? (
            <div className="cards">
              {data.slateToday.map((row, index) => (
                <SlateCard key={`${row["Game ID"]}-${index}`} row={row} />
              ))}
            </div>
          ) : (
            <div className="empty">No games saved today yet.</div>
          )}
        </>
      );
    }

    return (
      <>
        <div className="sectionHead">
          <div>
            <h2>All Qualified Plays</h2>
            <p>All qualified green plays are tracked here. Non-edge moneylines are kept out of public green totals.</p>
          </div>
        </div>

        <div className="qualifiedGrid">
          <Tile
            label="Qualified Plays - Last 7 Days"
            value={data.tiles.last7Days.record}
            meta={`${data.tiles.last7Days.winPct}% • ${data.tiles.last7Days.unitsWon}u • ROI ${data.tiles.last7Days.roiPct}%`}
            green
          />
          <Tile
            label="Qualified Plays - Running Total"
            value={data.tiles.overallGreen.record}
            meta={`${data.tiles.overallGreen.winPct}% • ${data.tiles.overallGreen.unitsWon}u • ROI ${data.tiles.overallGreen.roiPct}%`}
            green
          />
        </div>

        <div className="sectionHead">
          <div>
            <h2>Last 7 Days Records</h2>
            <p>Recent bet-type performance powers the Hot / Cold tags on Best Plays.</p>
          </div>
        </div>
        {data.last7RecordSummary.length ? <RecordsTable rows={data.last7RecordSummary} /> : <div className="empty">No completed bets in the last 7 days.</div>}

        <div className="sectionHead">
          <div>
            <h2>All-Time Records</h2>
            <p>Long-term bet-type performance from your completed tracker.</p>
          </div>
        </div>
        {data.recordSummary.length ? <RecordsTable rows={data.recordSummary} /> : <div className="empty">No completed bets yet.</div>}
      </>
    );
  }, [active, bestPlays, data, error]);

  return (
    <main className="shell">
      <section className="hero">
        <div className="logoWrap">
          <div className="logoFallback">EZ</div>
          <img className="logo" src="/ezpz_logo.png" alt="EZPZ Picks logo" />
        </div>
        <p className="heroSub">Algorithm-driven MLB betting projections ranked by model edge, confidence, and long-term bet-type performance.</p>
      </section>

      {data ? (
        <section className="tileGrid">
          <Tile
            label="Best Plays - Last 7 Days"
            value={data.tiles.last7Days.record}
            meta={`${data.tiles.last7Days.winPct}% • ${data.tiles.last7Days.unitsWon}u • ROI ${data.tiles.last7Days.roiPct}%`}
            green
          />
          <Tile
            label="Best Plays - Running Total"
            value={data.tiles.overallGreen.record}
            meta={`${data.tiles.overallGreen.winPct}% • ${data.tiles.overallGreen.unitsWon}u • ROI ${data.tiles.overallGreen.roiPct}%`}
            green
          />
          <Tile
            label="Today’s Best Plays"
            value={String(bestPlays.length)}
            meta="Pending Best Plays"
            green={bestPlays.length > 0}
          />
        </section>
      ) : null}

      <nav className="tabs">
        {TABS.map((tab) => (
          <button key={tab} className={`tabBtn ${active === tab ? "active" : ""}`} onClick={() => setActive(tab)}>
            {tab}
          </button>
        ))}
      </nav>

      {content}
    </main>
  );
}
