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
  favoritePick?: string | boolean;
  favoriteRank?: string | number;
  favoriteTag?: string;
  favoriteNotes?: string;
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
    handpickedLast7?: RecordTotals;
    handpickedOverall?: RecordTotals;
    pendingGreen: number;
    bestPlaysToday: number;
  };
  bestPlays: Play[];
  slateToday: SheetRow[];
  betTrackerRows?: SheetRow[];
  recordSummary: Summary[];
  last7RecordSummary: Summary[];
};

type Tab = "Today’s Best Plays" | "Full Slate" | "Records";

const TABS: Tab[] = ["Today’s Best Plays", "Full Slate", "Records"];
const BEST_PLAY_MIN_ODDS = -145;
const BEST_PLAY_MIN_RANK_SCORE = 60;

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

function isNRFIType(type: unknown) {
  const normalized = normalizeType(type);
  return normalized.includes("NRFI") || normalized === "YRFI";
}

function isLeanNRFIType(type: unknown) {
  return normalizeType(type) === "LEAN NRFI";
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
  if (!raw) return 0;

  // Handle tracker format like "5.5 / -150" by reading only the odds side.
  if (raw.includes("/")) {
    const oddsSide = raw.split("/").slice(1).join("/").trim();
    const signedFromSlash = oddsSide.match(/[+-]\d{3,4}/)?.[0];
    if (signedFromSlash) return Number(signedFromSlash);
    const unsignedFromSlash = oddsSide.match(/\b\d{3}\b/)?.[0];
    if (unsignedFromSlash) return Number(unsignedFromSlash);
  }

  // Prefer signed American odds so dates/lines like 2026 or 5.5 are ignored.
  const signed = raw.match(/[+-]\d{3,4}/)?.[0];
  if (signed) return Number(signed);

  // Only accept unsigned odds when the whole value is exactly 3 digits.
  const exactUnsigned = raw.match(/^\d{3}$/)?.[0];
  if (exactUnsigned) return Number(exactUnsigned);

  return 0;
}

function passesBestPlayOdds(play: Play) {
  const odds = parseAmericanOdds(play.oddsLine || play.altOdds || "");

  // Keep the public Best Plays page tight: any play with a real American odds value
  // must be -145 or better. Plays with no odds remain allowed so NRFI/YRFI rows
  // do not disappear when odds are not saved. ALT badges do NOT bypass this rule.
  return odds === 0 || odds >= BEST_PLAY_MIN_ODDS;
}

function isQualifiedGreenPlay(play: Play) {
  if (isPass(play.playType)) return false;
  if (isNonEdgeMoneyline(play.playType)) return false;

  return play.isGreen === true;
}

function isBestPlay(play: Play) {
  if (!isQualifiedGreenPlay(play)) return false;
  if (isLeanNRFIType(play.playType)) return false;

  // Best Plays must respect the -145 odds limit. ALT can boost rank,
  // but it should not let worse odds through.
  return passesBestPlayOdds(play);
}

function formatOdds(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "—";

  // Pitcher prop tracker cells are stored like "5.5 / -150".
  // The odds bubble should show only the second part.
  if (raw.includes("/")) {
    const oddsSide = raw.split("/").slice(1).join("/").trim();
    const signedFromSlash = oddsSide.match(/[+-]\d{3,4}/)?.[0];
    if (signedFromSlash) return signedFromSlash;
    const unsignedFromSlash = oddsSide.match(/\b\d{3}\b/)?.[0];
    if (unsignedFromSlash) return `+${unsignedFromSlash}`;
  }

  const signed = raw.match(/[+-]\d{3,4}/)?.[0];
  if (signed) return signed;

  const exactUnsigned = raw.match(/^\d{3}$/)?.[0];
  if (exactUnsigned) return `+${exactUnsigned}`;

  return "—";
}

function cleanTeamName(value: unknown) {
  return String(value || "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\b\d+(?:\.\d+)?%/g, "")
    .replace(/\bMoneyline\b/gi, "")
    .replace(/\bA\+?\b|\bB\+?\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function teamLogoUrl(team: string) {
  const cleaned = cleanTeamName(team);
  const abbr = TEAM_ABBR[cleaned] || TEAM_ABBR[String(team || "").trim()];
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

function getProjectedKs(play: Play) {
  return String(play.projectedKs || extractProjectedK(play.play, play.oddsLine) || "—");
}

function getPitcherLine(play: Play) {
  return String(play.altLine || extractLine(play.play, play.oddsLine) || "—");
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

function formatModelPct(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "—") return "—";
  const match = raw.match(/\d+(?:\.\d+)?\s*%?/);
  if (!match) return "—";
  const pct = match[0].replace(/\s/g, "");
  return pct.includes("%") ? pct : `${pct}%`;
}

function getMoneylineModelPct(play: Play, slateRows: SheetRow[]) {
  const direct = formatModelPct(play.moneylinePct);
  if (direct !== "—") return direct;

  const row = findSlateRowForPlay(play, slateRows);
  if (!row) return "—";

  const explicit = formatModelPct(firstValue(row, [
    "Model %",
    "Win %",
    "Moneyline %",
    "ML %",
    "Better ML %",
    "Better Moneyline %",
    "Model Win %",
    "ML Model %",
    "Projected Win %",
    "Win Probability",
    "Moneyline Win %",
    "Better Team Win %",
  ]));

  if (explicit !== "—") return explicit;

  const selectedTeam = cleanTeamName(play.playerTeam || "").toLowerCase();
  let firstPct = "—";

  for (const [key, value] of Object.entries(row)) {
    const lowerKey = key.toLowerCase();
    if (!(lowerKey.includes("%") || lowerKey.includes("probability") || lowerKey.includes("win pct") || lowerKey.includes("winpct"))) continue;
    if (lowerKey.includes("edge") || lowerKey.includes("odds") || lowerKey.includes("grade") || lowerKey.includes("nrfi") || lowerKey.includes("yrfi") || lowerKey.includes("pitcher") || lowerKey.includes("k ")) continue;

    const pct = formatModelPct(value);
    if (pct === "—") continue;

    if (firstPct === "—") firstPct = pct;
    if (selectedTeam && lowerKey.includes(selectedTeam)) return pct;
  }

  return firstPct;
}

function getPlayableOdds(play: Play) {
  const altOdds = formatOdds(play.altOdds || "");
  if (altOdds !== "—" && parseAmericanOdds(altOdds)) return altOdds;

  const odds = formatOdds(play.oddsLine || "");
  return parseAmericanOdds(odds) ? odds : "—";
}

function findSlateRowForPlay(play: Play, rows: SheetRow[]) {
  return rows.find((row) => {
    const game = row["Game Label"] || `${row["Away Team"] || ""} at ${row["Home Team"] || ""}`.trim();
    return game === play.game || (row["Away Team"] === play.awayTeam && row["Home Team"] === play.homeTeam);
  });
}

function imageForBestPlay(play: Play, rows: SheetRow[]) {
  if (play.headshotUrl) return play.headshotUrl;
  if (!isKType(play.playType)) return "";

  const row = findSlateRowForPlay(play, rows);
  if (!row) return "";

  const pitcherName = cleanPitcherName(play.play).toLowerCase();
  const awaySummary = String(row["Away Pitcher K + Grade"] || "");
  const homeSummary = String(row["Home Pitcher K + Grade"] || "");
  const awayName = cleanPitcherName(awaySummary).toLowerCase();
  const homeName = cleanPitcherName(homeSummary).toLowerCase();

  if (pitcherName && (pitcherName === awayName || awayName.includes(pitcherName) || pitcherName.includes(awayName))) {
    return imageFromRow(row, ["Away Pitcher Headshot URL", "Away Pitcher Headshot", "Away Pitcher Image URL"]);
  }

  if (pitcherName && (pitcherName === homeName || homeName.includes(pitcherName) || pitcherName.includes(homeName))) {
    return imageFromRow(row, ["Home Pitcher Headshot URL", "Home Pitcher Headshot", "Home Pitcher Image URL"]);
  }

  return "";
}

function imageFromRow(row: SheetRow, keys: string[]) {
  for (const key of keys) {
    const value = String(row[key] || "").trim();
    if (value.startsWith("http")) return value;
  }

  return "";
}


function firstValue(row: SheetRow | undefined, keys: string[]) {
  if (!row) return "";
  for (const key of keys) {
    const value = String(row[key] ?? "").trim();
    if (value) return value;
  }
  return "";
}

function normalizeProbability(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const n = toNumber(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1 ? n / 100 : n;
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function calculateNRFIScoreFromProbability(probability: number, playType: unknown) {
  if (!probability || !Number.isFinite(probability)) return 0;
  const rawNrfiScore = Math.max(0, Math.min(100, 50 + (probability - 0.515) * 450));
  return normalizeType(playType) === "YRFI" ? 100 - rawNrfiScore : rawNrfiScore;
}

function nrfiScoreFromRow(play: Play, row?: SheetRow) {
  if (!isNRFIType(play.playType)) return 0;

  const directKeys = [
    "NRFI Score",
    "YRFI Score",
    "NRFI/YRFI Score",
    "First Inning Score",
    "1st Inning Score",
    "NRFI Rank Score",
    "YRFI Rank Score",
    "NRFI Model Score",
    "YRFI Model Score",
    "Best Play Score",
  ];

  if (row) {
    for (const key of directKeys) {
      const raw = String(row[key] ?? "").trim();
      if (!raw) continue;
      let score = toNumber(raw);
      if (!score) continue;
      if (score > 0 && score <= 1) score *= 100;
      const lowerKey = key.toLowerCase();
      if (normalizeType(play.playType) === "YRFI" && lowerKey.includes("nrfi") && !lowerKey.includes("yrfi")) score = 100 - score;
      return clampScore(score);
    }

    for (const [key, rawValue] of Object.entries(row)) {
      const lowerKey = key.toLowerCase();
      if (!(lowerKey.includes("nrfi") || lowerKey.includes("yrfi") || lowerKey.includes("first inning") || lowerKey.includes("1st inning"))) continue;
      if (!(lowerKey.includes("score") || lowerKey.includes("rank") || lowerKey.includes("model"))) continue;
      if (lowerKey.includes("grade") || lowerKey.includes("odds") || lowerKey.includes("line")) continue;
      let score = toNumber(rawValue);
      if (!score) continue;
      if (score > 0 && score <= 1) score *= 100;
      if (normalizeType(play.playType) === "YRFI" && lowerKey.includes("nrfi") && !lowerKey.includes("yrfi")) score = 100 - score;
      return clampScore(score);
    }

    let probability = normalizeProbability(firstValue(row, [
      "NRFI %",
      "NRFI%",
      "NRFI Probability",
      "NRFI Prob",
      "NRFI Model %",
      "NRFI Model",
      "NRFI Projection",
      "NRFI Projected %",
    ]));

    if (!probability) {
      for (const [key, rawValue] of Object.entries(row)) {
        const lowerKey = key.toLowerCase();
        if (!lowerKey.includes("nrfi")) continue;
        if (!(lowerKey.includes("%") || lowerKey.includes("prob") || lowerKey.includes("projection"))) continue;
        if (lowerKey.includes("grade") || lowerKey.includes("odds") || lowerKey.includes("line")) continue;
        probability = normalizeProbability(rawValue);
        if (probability) break;
      }
    }

    const calculated = calculateNRFIScoreFromProbability(probability, play.playType);
    if (calculated) return clampScore(calculated);
  }

  // If no real NRFI/YRFI score or probability exists, do not invent a generic 65.
  // Returning 0 keeps unknown generic NRFI/YRFI plays out of Best Plays via the 65+ filter.
  const type = normalizeType(play.playType);
  if (type.includes("ELITE")) return 88;
  if (type.includes("STRONG")) return 78;
  if (type.includes("LEAN")) return 68;
  return 0;
}

function getBaseModelScore(play: Play, slateRows: SheetRow[] = []) {
  const row = findSlateRowForPlay(play, slateRows);
  const nrfiScore = nrfiScoreFromRow(play, row);
  if (nrfiScore) return clampScore(nrfiScore);
  return parseScore(play.score);
}

function getRankScore(play: Play, recentSummary: Summary | null, slateRows: SheetRow[] = []) {
  const baseScore = getBaseModelScore(play, slateRows);
  const form = getFormInfo(recentSummary);
  const hotBoost = form.className === "hot" ? 8 : 0;
  const coldPenalty = form.className === "cold" ? -7 : 0;
  const altBoost = hasAltBadge(play) ? 7 : 0;
  const missingOddsPenalty = isKType(play.playType) && !parseAmericanOdds(play.oddsLine) && !parseAmericanOdds(play.altOdds) ? -2 : 0;
  return clampScore(baseScore + hotBoost + coldPenalty + altBoost + missingOddsPenalty);
}

function passesMinimumScoreFilter(play: Play, recentSummary: Summary | null, slateRows: SheetRow[] = []) {
  const rankScore = getRankScore(play, recentSummary, slateRows);
  const normalizedType = normalizeType(play.playType);

  // Standard Best Plays rule stays at 60+.
  if (rankScore >= BEST_PLAY_MIN_RANK_SCORE) return true;

  // Pitcher prop unders have been one of the strongest tracked categories,
  // so allow UNDER / LEAN UNDER / STRONG UNDER into Best Plays at 45+.
  const isPitcherUnder = isKType(play.playType) && normalizedType.includes("UNDER");
  return isPitcherUnder && rankScore >= 45;
}

function passesColdFilter(play: Play, recentSummary: Summary | null, slateRows: SheetRow[] = []) {
  const form = getFormInfo(recentSummary);
  if (form.className !== "cold") return true;
  if (hasAltBadge(play)) return true;
  return getRankScore(play, recentSummary, slateRows) >= 78;
}

function passesOverallRecordFilter(play: Play, overallRows: Summary[], recentSummary: Summary | null) {
  const type = normalizeType(play.playType);

  const overall = overallRows.find(
    (row) => normalizeType(row.betType) === type
  );

  // If no tracked record exists yet, allow it.
  if (!overall) return true;

  // Losing overall bet types are normally excluded, but can qualify if the
  // last-7 form is Hot.
  if (overall.losses > overall.wins) {
    return getFormInfo(recentSummary).className === "hot";
  }

  return true;
}


function statusClass(wins: number, losses: number) {
  if (wins > losses) return "green";
  if (wins === losses) return "yellow";
  return "red";
}

function isFavoriteValue(value: unknown) {
  // Strict on purpose: only the actual Google Sheets TRUE value should count.
  return String(value ?? "").trim().toLowerCase() === "true";
}

function isHandpickedRecordRow(row: SheetRow) {
  // Active badges still use Favorite Pick only. Historical records can use
  // the permanent Handpicked Record flag, while still counting older rows
  // that only have Favorite Pick = TRUE.
  return (
    isFavoriteValue(row["Handpicked Record"]) ||
    isFavoriteValue(row["Was Handpicked"]) ||
    isFavoriteValue(row["Handpicked"]) ||
    isFavoriteValue(row["Favorite Pick"])
  );
}

function favoriteRankValue(play: Play) {
  const n = toNumber(play.favoriteRank);
  return n > 0 ? n : 999;
}

function favoriteTagValue(play: Play) {
  return String(play.favoriteTag || "").trim().toUpperCase();
}

function favoriteNotesValue(play: Play) {
  return String(play.favoriteNotes || "").trim();
}

function normalizeResult(value: unknown) {
  const text = String(value ?? "").trim().toUpperCase();
  if (["W", "WIN", "WON"].includes(text)) return "WIN";
  if (["L", "LOSS", "LOST"].includes(text)) return "LOSS";
  if (["P", "PUSH", "VOID", "CANCELLED", "CANCELED"].includes(text)) return "PUSH";
  return "";
}

function americanProfitUnits(odds: number) {
  if (!odds) return 0;
  return odds > 0 ? odds / 100 : 100 / Math.abs(odds);
}

function emptyRecord(label: string): RecordTotals {
  return { label, record: "0-0-0", totalBets: 0, winPct: 0, unitsWon: 0, roiPct: 0, wins: 0, losses: 0, pushes: 0 };
}

function parseDateOnly(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const direct = new Date(`${raw}T12:00:00`);
  if (!Number.isNaN(direct.getTime())) return direct;
  const fallback = new Date(raw);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function calculateFavoriteRecord(rows: SheetRow[] | undefined, mode: "all" | "last7" | "today" = "all", today = "") {
  const totals = emptyRecord(mode === "today" ? "Handpicked Plays Today" : mode === "last7" ? "Handpicked Plays Last 7 Days" : "Handpicked Plays");
  if (!rows?.length) return totals;

  const todayDate = parseDateOnly(today);
  const startDate = todayDate ? new Date(todayDate) : null;
  if (startDate) startDate.setDate(startDate.getDate() - 6);

  rows.forEach((row) => {
    if (!isHandpickedRecordRow(row)) return;

    const rowDateText = row.Date || row.date || row["Bet Date"] || "";
    const rowDate = parseDateOnly(rowDateText);
    if (mode === "today" && today && rowDateText !== today) return;
    if (mode === "last7" && startDate && todayDate) {
      if (!rowDate || rowDate < startDate || rowDate > todayDate) return;
    }

    const result = normalizeResult(row.Result);
    if (!result) return;

    const odds = parseAmericanOdds(row["Odds/Line"] || row.Odds || row["ML Odds"] || "");
    totals.totalBets += 1;

    if (result === "WIN") {
      totals.wins += 1;
      totals.unitsWon += americanProfitUnits(odds) || 1;
    } else if (result === "LOSS") {
      totals.losses += 1;
      totals.unitsWon -= 1;
    } else if (result === "PUSH") {
      totals.pushes += 1;
    }
  });

  totals.record = `${totals.wins}-${totals.losses}-${totals.pushes}`;
  const decisions = totals.wins + totals.losses;
  totals.winPct = decisions ? Math.round((totals.wins / decisions) * 1000) / 10 : 0;
  totals.unitsWon = Math.round(totals.unitsWon * 100) / 100;
  totals.roiPct = totals.totalBets ? Math.round((totals.unitsWon / totals.totalBets) * 1000) / 10 : 0;
  return totals;
}

function sameDateText(a: unknown, b: unknown) {
  const aText = String(a ?? "").trim();
  const bText = String(b ?? "").trim();
  if (!aText || !bText) return false;
  const aDate = parseDateOnly(aText);
  const bDate = parseDateOnly(bText);
  if (aDate && bDate) return aDate.toDateString() === bDate.toDateString();
  return aText === bText;
}

function favoriteKeyText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function favoriteDateKey(value: unknown) {
  const parsed = parseDateOnly(value);
  return parsed ? parsed.toDateString() : String(value ?? "").trim();
}

function pitcherNameKey(value: unknown) {
  let raw = String(value ?? "").trim();

  // Remove prop details so only the pitcher name remains.
  raw = raw
    .replace(/\bLine\b.*$/i, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\b\d+(?:\.\d+)?\+?\s*(?:so|k|ks|strikeouts?)?\b.*$/i, "")
    .replace(/\b(?:over|under|strong|lean)\b.*$/i, "")
    .trim();

  // Convert "Last, First" to "First Last" so tracker and play names match.
  if (raw.includes(",")) {
    const [last, first] = raw.split(",", 2);
    raw = `${first || ""} ${last || ""}`.trim();
  }

  return favoriteKeyText(raw);
}

function cleanTrackerPitcherSelection(value: unknown) {
  return pitcherNameKey(value);
}

function favoriteKeyFromTrackerRow(row: SheetRow, today: string) {
  if (!isFavoriteValue(row["Favorite Pick"])) return "";
  if (!sameDateText(row.Date || row.date || row["Bet Date"] || "", today)) return "";

  const dateKey = favoriteDateKey(today);
  const type = normalizeType(row["Bet Type"] || row["Market"] || "");
  const market = favoriteKeyText(row["Market"] || "");
  const selection = row["Selection"] || row["Pick"] || row["Play"] || row["Player"] || "";

  if (isMoneylineType(type) || market === "moneyline") {
    return `ML|${dateKey}|${favoriteKeyText(cleanTeamName(selection))}`;
  }

  if (isKType(type) || market.includes("pitcher strikeout")) {
    return `K|${dateKey}|${cleanTrackerPitcherSelection(selection)}`;
  }

  if (isNRFIType(type) || market.includes("nrfi") || market.includes("yrfi")) {
    const game = row["Game"] || row["Game Label"] || row["Matchup"] || selection;
    return `FI|${dateKey}|${type}|${favoriteKeyText(game)}`;
  }

  return `OTHER|${dateKey}|${type}|${favoriteKeyText(selection)}`;
}

function favoriteKeyFromPlay(play: Play, today: string) {
  const dateKey = favoriteDateKey(today);
  const type = normalizeType(play.playType);

  if (isMoneylineType(type)) {
    return `ML|${dateKey}|${favoriteKeyText(cleanMoneylineTeam(play.playerTeam || play.play))}`;
  }

  if (isKType(type)) {
    return `K|${dateKey}|${pitcherNameKey(cleanPitcherName(play.play))}`;
  }

  if (isNRFIType(type)) {
    return `FI|${dateKey}|${type}|${favoriteKeyText(play.game || play.play)}`;
  }

  return `OTHER|${dateKey}|${type}|${favoriteKeyText(play.play)}`;
}

function buildFavoriteRowMap(rows: SheetRow[] | undefined, today: string) {
  const map = new Map<string, SheetRow>();
  if (!rows?.length || !today) return map;

  rows.forEach((row) => {
    const key = favoriteKeyFromTrackerRow(row, today);
    if (key && !map.has(key)) map.set(key, row);
  });

  return map;
}

function calculateFavoriteCount(rows: SheetRow[] | undefined, today = "") {
  if (!rows?.length) return 0;
  return rows.filter((row) => {
    if (!isFavoriteValue(row["Favorite Pick"])) return false;
    if (!today) return true;
    return sameDateText(row.Date || row.date || row["Bet Date"] || "", today);
  }).length;
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

  if (url) {
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

function BestPlayCard({
  play,
  index,
  recentSummary,
  slateRows,
  handpicked = false,
}: {
  play: Play;
  index: number;
  recentSummary: Summary | null;
  slateRows: SheetRow[];
  handpicked?: boolean;
}) {
  const kPlay = isKType(play.playType);
  const moneylinePlay = isMoneylineType(play.playType);
  const pitcherName = cleanPitcherName(play.play);
  const rawDisplayTeam = play.playerTeam || play.play;
  const displayTeam = moneylinePlay ? cleanMoneylineTeam(rawDisplayTeam) || cleanMoneylineTeam(play.play) || "Moneyline" : rawDisplayTeam;
  const modelPct = moneylinePlay ? getMoneylineModelPct(play, slateRows) : "—";
  const pitcherImage = imageForBestPlay(play, slateRows);
  const rankScore = getRankScore(play, recentSummary, slateRows);
  const topPlay = index < 3;
  const favoriteTag = favoriteTagValue(play);
  const favoriteNotes = favoriteNotesValue(play);

  return (
    <div className={`card green fade-in best ${topPlay ? "top" : ""} ${handpicked ? "handpicked" : ""}`}>
      <div className="cardTop">
        <div className="rankBadge">#{handpicked && favoriteRankValue(play) !== 999 ? favoriteRankValue(play) : index + 1}</div>
        <div className="scorePill">EZPZ Score {rankScore || "—"}</div>
        {handpicked ? <div className="handpickedPill">⭐ HANDPICKED</div> : null}
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
            <div className="projection">{getProjectedKs(play)} Ks</div>
            <div className="grade">{normalizeType(play.playType)}</div>
          </div>

          <div className="divider" />

          <div className="bubbleGrid three">
            <MiniBubble label="Line" value={getPitcherLine(play)} green />
            <MiniBubble label="Odds" value={getPlayableOdds(play)} green />
            <MiniBubble label="Projected Ks" value={getProjectedKs(play)} green />
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
            <MiniBubble label="EZPZ Score" value={rankScore || "—"} green />
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
            <MiniBubble label="EZPZ Score" value={rankScore || "—"} green />
            <MiniBubble label="Bet Type" value={normalizeType(play.playType)} green />
          </div>
        </>
      )}

      {handpicked && favoriteTag ? <div className="favoriteTag">{favoriteTag}</div> : null}
      {handpicked && favoriteNotes ? <div className="favoriteNotes">{favoriteNotes}</div> : null}
      <BadgeRow play={play} recentSummary={recentSummary} />
      <div className="formRow"><FormTag summary={recentSummary} /></div>
      <ConfidenceBar score={rankScore || 50} />
    </div>
  );
}

function KBubbleGroup({ summary, score, isGreen }: { summary: string; score: string; isGreen: boolean }) {
  if (!summary) return null;

  return (
    <div className="bubbleGrid">
      <MiniBubble label="Line" value={extractLine(summary)} green={isGreen} />
      <MiniBubble label="Projected Ks" value={extractProjectedK(summary)} green={isGreen} />
      <MiniBubble label="EZPZ Score" value={score || "—"} green={isGreen} />
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
    const recentByType = new Map<string, Summary>(data.last7RecordSummary.map((row) => [normalizeType(row.betType), row]));

    return data.bestPlays
      .filter((play) => {
        const recentSummary = recentByType.get(normalizeType(play.playType)) || null;
        return (
          isBestPlay(play) &&
          passesColdFilter(play, recentSummary, data.slateToday) &&
          passesMinimumScoreFilter(play, recentSummary, data.slateToday) &&
          passesOverallRecordFilter(play, data.recordSummary, recentSummary)
        );
      })
      .sort((a, b) => {
        const aSummary = recentByType.get(normalizeType(a.playType)) || null;
        const bSummary = recentByType.get(normalizeType(b.playType)) || null;
        const rankDiff = getRankScore(b, bSummary, data.slateToday) - getRankScore(a, aSummary, data.slateToday);
        if (rankDiff !== 0) return rankDiff;

        const hotDiff = Number(getFormInfo(bSummary).className === "hot") - Number(getFormInfo(aSummary).className === "hot");
        if (hotDiff !== 0) return hotDiff;

        const altDiff = Number(hasAltBadge(b)) - Number(hasAltBadge(a));
        if (altDiff !== 0) return altDiff;

        return getBaseModelScore(b, data.slateToday) - getBaseModelScore(a, data.slateToday);
      });
  }, [data]);

  const handpickedPlays = useMemo(() => {
    return bestPlays
      .filter((play) => isFavoriteValue(play.favoritePick))
      .sort((a, b) => favoriteRankValue(a) - favoriteRankValue(b));
  }, [bestPlays]);

  const handpickedLast7 = useMemo(() => {
    const calculated = calculateFavoriteRecord(data?.betTrackerRows, "last7", data?.today);
    return calculated.totalBets > 0 ? calculated : ((data?.tiles as any)?.handpickedLast7 || calculated);
  }, [data]);
  const handpickedOverall = useMemo(() => {
    const calculated = calculateFavoriteRecord(data?.betTrackerRows, "all", data?.today);
    return calculated.totalBets > 0 ? calculated : ((data?.tiles as any)?.handpickedOverall || calculated);
  }, [data]);
  const handpickedTodayCount = useMemo(() => calculateFavoriteCount(data?.betTrackerRows, data?.today), [data]);
  const favoriteRowMap = useMemo(() => buildFavoriteRowMap(data?.betTrackerRows, data?.today || ""), [data]);

  const content = useMemo(() => {
    if (error) return <div className="error">{error}</div>;
    if (!data) return <div className="empty">Loading EZPZ Picks...</div>;

    if (active === "Today’s Best Plays") {
      const recentByType = new Map<string, Summary>(data.last7RecordSummary.map((row) => [normalizeType(row.betType), row]));

      return (
        <>
          <div className="sectionHead">
            <div>
              <h2>Today’s Best Plays</h2>
              <p>Model-qualified pool for {data.today}.</p>
            </div>
          </div>

          {bestPlays.length ? (
            <div className="cards">
              {bestPlays.map((play, index) => {
                const favoriteRow = favoriteRowMap.get(favoriteKeyFromPlay(play, data.today));
                const displayPlay = favoriteRow
                  ? {
                      ...play,
                      favoritePick: "TRUE",
                      favoriteRank: favoriteRow["Favorite Rank"] || "",
                      favoriteTag: favoriteRow["Favorite Tag"] || "",
                      favoriteNotes: favoriteRow["Favorite Notes"] || "",
                    }
                  : { ...play, favoritePick: "", favoriteRank: "", favoriteTag: "", favoriteNotes: "" };

                return (
                  <BestPlayCard
                    key={`${play.game}-${play.play}-${index}`}
                    play={displayPlay}
                    index={index}
                    recentSummary={recentByType.get(normalizeType(play.playType)) || null}
                    slateRows={data.slateToday}
                    handpicked={Boolean(favoriteRow)}
                  />
                );
              })}
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
            label="Handpicked Plays - Last 7 Days"
            value={handpickedLast7.record}
            meta={`${handpickedLast7.winPct}% • ${handpickedLast7.unitsWon}u • ROI ${handpickedLast7.roiPct}%`}
            green={handpickedLast7.totalBets > 0}
          />
          <Tile
            label="Handpicked Plays - Running Total"
            value={handpickedOverall.record}
            meta={`${handpickedOverall.winPct}% • ${handpickedOverall.unitsWon}u • ROI ${handpickedOverall.roiPct}%`}
            green={handpickedOverall.totalBets > 0}
          />
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
  }, [active, bestPlays, handpickedLast7, handpickedOverall, favoriteRowMap, data, error]);

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
            label="Today’s Handpicked"
            value={String(handpickedTodayCount)}
            meta="Your conviction plays"
            green={handpickedTodayCount > 0}
          />
          <Tile
            label="Handpicked - Last 7 Days"
            value={handpickedLast7.record}
            meta={`${handpickedLast7.winPct}% • ${handpickedLast7.unitsWon}u • ROI ${handpickedLast7.roiPct}%`}
            green={handpickedLast7.wins >= handpickedLast7.losses && handpickedLast7.totalBets > 0}
          />
          <Tile
            label="Handpicked - Running Total"
            value={handpickedOverall.record}
            meta={`${handpickedOverall.winPct}% • ${handpickedOverall.unitsWon}u • ROI ${handpickedOverall.roiPct}%`}
            green={handpickedOverall.wins >= handpickedOverall.losses && handpickedOverall.totalBets > 0}
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

      <style jsx global>{`
        .handpicked {
          border-color: rgba(79, 156, 255, 0.95) !important;
          box-shadow: 0 0 0 1px rgba(79, 156, 255, 0.35), 0 18px 55px rgba(37, 99, 235, 0.28) !important;
        }

        .handpickedPill {
          border: 1px solid rgba(79, 156, 255, 0.6);
          background: rgba(37, 99, 235, 0.16);
          color: #bfdbfe;
          border-radius: 999px;
          padding: 6px 10px;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.08em;
          white-space: nowrap;
        }

        .favoriteTag {
          display: inline-flex;
          width: fit-content;
          margin-top: 12px;
          border-radius: 999px;
          padding: 7px 11px;
          background: linear-gradient(135deg, rgba(37, 99, 235, 0.28), rgba(14, 165, 233, 0.14));
          border: 1px solid rgba(125, 211, 252, 0.32);
          color: #dbeafe;
          font-weight: 800;
          font-size: 12px;
          letter-spacing: 0.08em;
        }

        .favoriteNotes {
          margin-top: 10px;
          padding: 10px 12px;
          border-radius: 14px;
          background: rgba(15, 23, 42, 0.5);
          border: 1px solid rgba(148, 163, 184, 0.16);
          color: rgba(226, 232, 240, 0.86);
          font-size: 13px;
          line-height: 1.35;
        }
      `}</style>
    </main>
  );
}
