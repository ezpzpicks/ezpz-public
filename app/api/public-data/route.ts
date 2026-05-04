import { NextResponse } from "next/server";
import { readWorksheet } from "../../../lib/googleSheets";

type SheetRow = Record<string, string>;

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

const EMPTY_TOTALS: RecordTotals = {
  label: "",
  record: "0-0-0",
  totalBets: 0,
  winPct: 0,
  unitsWon: 0,
  roiPct: 0,
  wins: 0,
  losses: 0,
  pushes: 0,
};

const MONEYLINE_GRADES = new Set(["A MONEYLINE", "B MONEYLINE"]);
const GREEN_TYPES = new Set([
  "A MONEYLINE",
  "B MONEYLINE",
  "ELITE NRFI",
  "STRONG NRFI",
  "LEAN NRFI",
  "NRFI",
  "YRFI",
  "STRONG OVER",
  "OVER",
  "LEAN OVER",
  "STRONG UNDER",
  "UNDER",
  "LEAN UNDER",
]);

function todayET() {
  return new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" });
}

function nowET() {
  return new Date().toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function normalizeDate(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  // Handles Google Sheets dates stored as YYYY-MM-DD without UTC shifting.
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(raw)) {
    const [y, m, d] = raw.split("-");
    return `${Number(m)}/${Number(d)}/${y}`;
  }

  // Handles M/D/YY and M/D/YYYY.
  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    const [, m, d, y] = slashMatch;
    const fullYear = y.length === 2 ? `20${y}` : y;
    return `${Number(m)}/${Number(d)}/${fullYear}`;
  }

  const date = new Date(raw);
  if (!Number.isNaN(date.getTime())) {
    return date.toLocaleDateString("en-US", { timeZone: "America/New_York" });
  }

  return raw;
}

function normalizeKey(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function getFirst(row: SheetRow, keys: string[]) {
  for (const key of keys) {
    const value = String(row[key] ?? "").trim();
    if (value) return value;
  }

  const wanted = keys.map(normalizeKey);
  for (const [key, value] of Object.entries(row)) {
    if (wanted.includes(normalizeKey(key))) {
      const text = String(value ?? "").trim();
      if (text) return text;
    }
  }

  return "";
}

function getFirstLoose(row: SheetRow, includesAll: string[], excludes: string[] = []) {
  const includeTokens = includesAll.map(normalizeKey).filter(Boolean);
  const excludeTokens = excludes.map(normalizeKey).filter(Boolean);

  for (const [key, value] of Object.entries(row)) {
    const normalizedKey = normalizeKey(key);
    const matches = includeTokens.every((token) => normalizedKey.includes(token));
    const blocked = excludeTokens.some((token) => normalizedKey.includes(token));
    const text = String(value ?? "").trim();
    if (matches && !blocked && text) return text;
  }

  return "";
}

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

function isGreenType(value: unknown) {
  const type = normalizeType(value);
  return GREEN_TYPES.has(type) && type !== "NON-EDGE MONEYLINE" && type !== "PASS";
}

function toNumber(value: unknown) {
  const n = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function parseScore(value: unknown) {
  const n = toNumber(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 50;
}

function parseAmericanOdds(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;

  // Avoid treating dates/years like 2026 as American odds.
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(raw) || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(raw)) return 0;

  const matches = raw.match(/[+-]\s*\d{3,4}\b|\b\d{3}\b/g) || [];
  for (const item of matches) {
    const odds = Number(item.replace(/\s+/g, ""));
    if (!Number.isFinite(odds)) continue;
    if (Math.abs(odds) >= 100 && Math.abs(odds) <= 999) return odds;
  }

  return 0;
}

function formatAmericanOdds(value: unknown) {
  const odds = parseAmericanOdds(value);
  if (!odds) return "";
  return odds > 0 ? `+${odds}` : String(odds);
}

function unitsFromResult(row: SheetRow) {
  const result = String(row["Result"] || "").toUpperCase().trim();
  const odds = parseAmericanOdds(row["Odds/Line"] || row["Odds"] || row["ML Odds"]);

  if (result.includes("PUSH")) return 0;
  if (result.includes("LOSS") || result === "L") return -1;
  if (!(result.includes("WIN") || result === "W")) return 0;

  if (odds > 0) return odds / 100;
  if (odds < 0) return 100 / Math.abs(odds);
  return 1;
}

function buildSummary(rows: SheetRow[]): Summary[] {
  const map = new Map<string, Summary>();

  for (const row of rows) {
    const type = normalizeType(row["Bet Type"] || row["Market"] || "");
    if (!type || type === "PASS") continue;

    const result = String(row["Result"] || "").toUpperCase().trim();
    if (!result) continue;

    if (!map.has(type)) {
      map.set(type, {
        betType: type,
        status: "EVEN",
        wins: 0,
        losses: 0,
        pushes: 0,
        totalBets: 0,
        winPct: 0,
        unitsWon: 0,
        roiPct: 0,
      });
    }

    const summary = map.get(type)!;
    if (result.includes("WIN") || result === "W") summary.wins += 1;
    else if (result.includes("LOSS") || result === "L") summary.losses += 1;
    else if (result.includes("PUSH") || result === "P") summary.pushes += 1;
    else continue;

    summary.totalBets += 1;
    summary.unitsWon += unitsFromResult(row);
  }

  const summaries = [...map.values()].map((summary) => {
    const decisions = summary.wins + summary.losses;
    const winPct = decisions > 0 ? round1((summary.wins / decisions) * 100) : 0;
    const roiPct = summary.totalBets > 0 ? round1((summary.unitsWon / summary.totalBets) * 100) : 0;
    const unitsWon = round1(summary.unitsWon);
    const status: Summary["status"] = summary.wins > summary.losses ? "WINNING" : summary.wins === summary.losses ? "EVEN" : "LOSING";

    return { ...summary, status, winPct, roiPct, unitsWon };
  });

  return summaries.sort((a, b) => b.winPct - a.winPct || b.totalBets - a.totalBets);
}

function buildTotals(label: string, rows: SheetRow[]): RecordTotals {
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let unitsWon = 0;

  for (const row of rows) {
    const result = String(row["Result"] || "").toUpperCase().trim();
    if (!result) continue;

    if (result.includes("WIN") || result === "W") wins += 1;
    else if (result.includes("LOSS") || result === "L") losses += 1;
    else if (result.includes("PUSH") || result === "P") pushes += 1;
    else continue;

    unitsWon += unitsFromResult(row);
  }

  const totalBets = wins + losses + pushes;
  const decisions = wins + losses;
  const winPct = decisions > 0 ? round1((wins / decisions) * 100) : 0;
  const roiPct = totalBets > 0 ? round1((unitsWon / totalBets) * 100) : 0;

  return {
    label,
    record: `${wins}-${losses}-${pushes}`,
    totalBets,
    winPct,
    unitsWon: round1(unitsWon),
    roiPct,
    wins,
    losses,
    pushes,
  };
}

function rowsFromLast7Days(rows: SheetRow[]) {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(now.getDate() - 7);

  return rows.filter((row) => {
    const normalized = normalizeDate(row["Date"] || row["date"] || "");
    const date = new Date(normalized);
    return !Number.isNaN(date.getTime()) && date >= cutoff && date <= now;
  });
}

function formatMoneylinePct(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "—";
  return raw.includes("%") ? raw : `${raw}%`;
}

function parseKSummary(summary: string) {
  const raw = String(summary || "").trim();
  const explicitLine = raw.match(/\bLine\s*([0-9]+(?:\.[0-9]+)?)/i)?.[1];
  const beforeGrade = raw.split("(")[0] || raw;
  const projectedMatches = [...beforeGrade.matchAll(/([0-9]+(?:\.[0-9]+)?)/g)].map((match) => match[1]);
  const projected = projectedMatches.length ? projectedMatches[projectedMatches.length - 1] : "";
  const afterGrade = raw.includes(")") ? raw.split(")").slice(1).join(")") : "";
  const afterGradeNumber = afterGrade.match(/([0-9]+(?:\.[0-9]+)?)/)?.[1];

  return {
    projected: projected || "",
    line: explicitLine || afterGradeNumber || "",
  };
}

function getPitcherHeadshot(row: SheetRow, side: "Away" | "Home") {
  return getFirst(row, [
    `${side} Pitcher Headshot URL`,
    `${side} Pitcher Headshot`,
    `${side} Pitcher Image URL`,
    `${side} Pitcher Image`,
    `${side} Pitcher Photo URL`,
    `${side} Pitcher Photo`,
    `${side} Headshot URL`,
    `${side} Headshot`,
    `${side} Player Headshot URL`,
    `${side} Player Image URL`,
    `${side} Pitcher MLBAM ID`,
    `${side} Pitcher ID`,
  ]) || getFirstLoose(row, [side, "pitcher", "headshot"]) || getFirstLoose(row, [side, "pitcher", "image"]) || getFirstLoose(row, [side, "pitcher", "photo"]);
}

function getPitcherOdds(row: SheetRow, side: "Away" | "Home") {
  const direct = getFirst(row, [
    `${side} Pitcher K Odds`,
    `${side} Pitcher Odds`,
    `${side} K Odds`,
    `${side} Pitcher Prop Odds`,
    `${side} Pitcher SO Odds`,
    `${side} Pitcher Strikeout Odds`,
    `${side} Pitcher K Line Odds`,
    `${side} Pitcher K + Odds`,
    `${side} Pitcher K + Grade Odds`,
  ]) || getFirstLoose(row, [side, "pitcher", "odds"]) || getFirstLoose(row, [side, "k", "odds"]);

  const directOdds = formatAmericanOdds(direct);
  if (directOdds) return directOdds;

  const summary = getFirst(row, [`${side} Pitcher K + Grade`, `${side} Pitcher K Summary`, `${side} Pitcher K`]);
  const summaryOdds = formatAmericanOdds(summary);
  if (summaryOdds) return summaryOdds;

  return "";
}

function getPitcherSixInning(row: SheetRow, side: "Away" | "Home") {
  return getFirst(row, [
    `${side} Pitcher 6-Inning Ks`,
    `${side} Pitcher 6 Inning Ks`,
    `${side} Pitcher 6-Inning K`,
    `${side} Pitcher 6 Inning K`,
    `${side} 6-Inning Ks`,
    `${side} 6 Inning Ks`,
    `${side} Pitcher Six Inning Ks`,
  ]) || getFirstLoose(row, [side, "6", "inning"]);
}

function getPitcherVolatility(row: SheetRow, side: "Away" | "Home") {
  return getFirst(row, [
    `${side} Pitcher Volatility`,
    `${side} K Volatility`,
    `${side} Pitcher K Volatility`,
    `${side} Volatility`,
  ]) || getFirstLoose(row, [side, "volatility"]);
}

function getPitcherAltLine(row: SheetRow, side: "Away" | "Home") {
  return getFirst(row, [
    `${side} Pitcher Alt Line`,
    `${side} Pitcher K Alt Line`,
    `${side} Alt Line`,
    `${side} K Alt Line`,
  ]) || getFirstLoose(row, [side, "alt", "line"]);
}

function getPitcherAltOdds(row: SheetRow, side: "Away" | "Home") {
  const value = getFirst(row, [
    `${side} Pitcher Alt Odds`,
    `${side} Pitcher K Alt Odds`,
    `${side} Alt Odds`,
    `${side} K Alt Odds`,
  ]) || getFirstLoose(row, [side, "alt", "odds"]);

  return formatAmericanOdds(value) || value;
}

function buildPitcherOddsLine(line: string, odds: string) {
  const parts: string[] = [];
  if (line) parts.push(`Line ${line}`);
  if (odds) parts.push(odds);
  return parts.join(" ");
}

function buildBestPlaysFromSlate(rows: SheetRow[], today: string): Play[] {
  const todaysRows = rows.filter((row) => normalizeDate(row["Date"] || row["date"]) === today);
  const plays: Play[] = [];

  for (const row of todaysRows) {
    const game = row["Game Label"] || `${row["Away Team"] || ""} at ${row["Home Team"] || ""}`.trim();
    const awayTeam = row["Away Team"] || "";
    const homeTeam = row["Home Team"] || "";

    const mlGrade = normalizeType(row["ML Grade"] || "");
    if (MONEYLINE_GRADES.has(mlGrade)) {
      const modelPct = getFirst(row, ["Model %", "Moneyline %", "ML %", "Win %", "Better ML %", "Projected Win %"]);
      plays.push({
        playType: mlGrade,
        game,
        play: "Moneyline",
        oddsLine: getFirst(row, ["ML Odds", "Moneyline Odds", "Odds"]),
        score: toNumber(row["Edge %"]) || toNumber(row["Rank Score"]) || toNumber(row["Best Play Score"]) || toNumber(modelPct) || 50,
        isGreen: true,
        awayTeam,
        homeTeam,
        playerTeam: row["Better ML"] || row["Team"] || "",
        moneylinePct: formatMoneylinePct(modelPct),
      });
    }

    const nrfiGrade = normalizeType(row["NRFI Grade"] || "");
    if (isGreenType(nrfiGrade)) {
      const nrfiOdds = getFirst(row, ["NRFI Odds", "YRFI Odds", "NRFI/YRFI Odds", "First Inning Odds"]);
      plays.push({
        playType: nrfiGrade,
        game,
        play: nrfiGrade.includes("YRFI") ? "YRFI" : "NRFI",
        oddsLine: formatAmericanOdds(nrfiOdds) || nrfiOdds,
        score: toNumber(row["NRFI Score"]) || toNumber(row["First Inning Score"]) || (nrfiGrade.includes("ELITE") ? 88 : nrfiGrade.includes("STRONG") ? 78 : 66),
        isGreen: true,
        awayTeam,
        homeTeam,
      });
    }

    const kMarkets = [
      { side: "Away" as const, summary: row["Away Pitcher K + Grade"] || "", score: row["Away Pitcher K Score"] || "", team: awayTeam },
      { side: "Home" as const, summary: row["Home Pitcher K + Grade"] || "", score: row["Home Pitcher K Score"] || "", team: homeTeam },
    ];

    for (const market of kMarkets) {
      const type = normalizeType(market.summary);
      if (!isGreenType(type)) continue;

      const parsed = parseKSummary(market.summary);
      const odds = getPitcherOdds(row, market.side);
      const sixInningKs = getPitcherSixInning(row, market.side);
      const volatility = getPitcherVolatility(row, market.side);
      const altLine = getPitcherAltLine(row, market.side);
      const altOdds = getPitcherAltOdds(row, market.side);

      plays.push({
        playType: type,
        game,
        play: market.summary,
        oddsLine: buildPitcherOddsLine(parsed.line, odds),
        score: market.score || row[`${market.side} Pitcher Score`] || 50,
        isGreen: true,
        awayTeam,
        homeTeam,
        headshotUrl: getPitcherHeadshot(row, market.side),
        playerTeam: market.team,
        projectedKs: parsed.projected,
        sixInningKs,
        volatility,
        altLine,
        altOdds,
      });
    }
  }

  return plays.sort((a, b) => parseScore(b.score) - parseScore(a.score));
}

export async function GET() {
  try {
    const today = todayET();
    const [slateTodayRaw, trackerRaw] = await Promise.all([
      readWorksheet("daily_slate"),
      readWorksheet("bet_tracker"),
    ]);

    const slateToday = slateTodayRaw.filter((row) => normalizeDate(row["Date"] || row["date"]) === today);
    const completedTrackerRows = trackerRaw.filter((row) => String(row["Result"] || "").trim());
    const qualifiedTrackerRows = completedTrackerRows.filter((row) => isGreenType(row["Bet Type"] || row["Market"]));
    const last7QualifiedRows = rowsFromLast7Days(qualifiedTrackerRows);
    const pendingGreen = trackerRaw.filter((row) => {
      const result = String(row["Result"] || "").trim();
      return !result && isGreenType(row["Bet Type"] || row["Market"]);
    }).length;

    const bestPlays = buildBestPlaysFromSlate(slateTodayRaw, today);

    return NextResponse.json({
      ok: true,
      today,
      lastUpdated: nowET(),
      tiles: {
        last7Days: buildTotals("Qualified Plays - Last 7 Days", last7QualifiedRows),
        overallGreen: buildTotals("Qualified Plays - Running Total", qualifiedTrackerRows),
        pendingGreen,
        bestPlaysToday: bestPlays.length,
      },
      bestPlays,
      slateToday,
      recordSummary: buildSummary(qualifiedTrackerRows),
      last7RecordSummary: buildSummary(last7QualifiedRows),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown public data error";
    return NextResponse.json(
      {
        ok: false,
        error: message,
        today: todayET(),
        lastUpdated: nowET(),
        tiles: {
          last7Days: EMPTY_TOTALS,
          overallGreen: EMPTY_TOTALS,
          pendingGreen: 0,
          bestPlaysToday: 0,
        },
        bestPlays: [],
        slateToday: [],
        recordSummary: [],
        last7RecordSummary: [],
      },
      { status: 500 }
    );
  }
}
