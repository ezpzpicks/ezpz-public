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

  // Google Sheets may send dates as YYYY-MM-DD, M/D/YYYY, or M/D/YY.
  // Normalize all of those to the same format as todayET(): M/D/YYYY.
  const isoMatch = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${Number(m)}/${Number(d)}/${y}`;
  }

  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
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
  const match = raw.match(/[+-]?\d+/);
  if (!match) return 0;
  const odds = Number(match[0]);
  return Number.isFinite(odds) && Math.abs(odds) >= 100 ? odds : 0;
}

function unitsFromResult(row: SheetRow) {
  const result = String(row["Result"] || "").toUpperCase().trim();
  const odds = parseAmericanOdds(row["Odds/Line"]);

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
    const date = new Date(row["Date"] || "");
    return !Number.isNaN(date.getTime()) && date >= cutoff && date <= now;
  });
}

function formatMoneylinePct(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "—";
  return raw.includes("%") ? raw : `${raw}%`;
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
  const nrfiScore = Math.max(0, Math.min(100, 50 + (probability - 0.515) * 450));
  return normalizeType(playType) === "YRFI" ? 100 - nrfiScore : nrfiScore;
}

function fallbackNRFIScore(playType: unknown) {
  const type = normalizeType(playType);
  if (type.includes("ELITE")) return 88;
  if (type.includes("STRONG")) return 78;
  if (type.includes("LEAN")) return 68;
  // If the sheet does not provide a true NRFI/YRFI score or probability, do not invent a generic score.
  // This prevents unknown generic NRFI/YRFI plays from clustering at 65/66.
  return 0;
}

function scoreValueFromRaw(value: unknown) {
  const n = toNumber(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 0 && n <= 1 ? n * 100 : n;
}

function calculateNRFIPlayScore(row: SheetRow, playType: unknown) {
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

  for (const key of directKeys) {
    const raw = String(row[key] ?? "").trim();
    if (!raw) continue;
    let score = scoreValueFromRaw(raw);
    if (!score) continue;
    const lowerKey = key.toLowerCase();
    if (normalizeType(playType) === "YRFI" && lowerKey.includes("nrfi") && !lowerKey.includes("yrfi")) {
      score = 100 - score;
    }
    return clampScore(score);
  }

  // Future-proof scan: accept any NRFI/YRFI score-style column without needing an exact header.
  for (const [key, rawValue] of Object.entries(row)) {
    const lowerKey = key.toLowerCase();
    if (!(lowerKey.includes("nrfi") || lowerKey.includes("yrfi") || lowerKey.includes("first inning") || lowerKey.includes("1st inning"))) continue;
    if (!(lowerKey.includes("score") || lowerKey.includes("rank") || lowerKey.includes("model"))) continue;
    if (lowerKey.includes("grade") || lowerKey.includes("odds") || lowerKey.includes("line")) continue;

    let score = scoreValueFromRaw(rawValue);
    if (!score) continue;
    if (normalizeType(playType) === "YRFI" && lowerKey.includes("nrfi") && !lowerKey.includes("yrfi")) {
      score = 100 - score;
    }
    return clampScore(score);
  }

  const probabilityKeys = [
    "NRFI %",
    "NRFI%",
    "NRFI Probability",
    "NRFI Prob",
    "NRFI Model %",
    "NRFI Model",
    "NRFI Projection",
    "NRFI Projected %",
  ];

  let probability = normalizeProbability(firstValue(row, probabilityKeys));

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

  const calculated = calculateNRFIScoreFromProbability(probability, playType);
  return calculated ? clampScore(calculated) : fallbackNRFIScore(playType);
}

function cleanTeamName(value: unknown) {
  return String(value ?? "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\b\d+(?:\.\d+)?%/g, "")
    .replace(/\bMoneyline\b/gi, "")
    .replace(/\bA\+?\b|\bB\+?\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanPitcherName(value: unknown) {
  return String(value ?? "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\bLine\b.*$/i, "")
    .replace(/\d+(?:\.\d+)?/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value: unknown) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function oddsFromLineCell(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  // Keep the whole "5.5 / -150" string so the frontend can show line and odds separately.
  if (/\d+(?:\.\d+)?\s*\/\s*[+-]?\d{3,}/.test(raw)) return raw;
  const signed = raw.match(/[+-]\d{3,}/)?.[0];
  if (signed) return signed;
  return raw;
}

function findTrackerOddsForPitcher(trackerRows: SheetRow[], today: string, game: string, pitcherName: string) {
  const pitcher = normalizeText(pitcherName);
  if (!pitcher) return "";

  for (const row of trackerRows) {
    if (normalizeDate(row["Date"] || row["date"]) !== today) continue;
    const type = normalizeType(row["Bet Type"] || row["Market"] || row["Type"] || "");
    if (!["OVER", "UNDER", "LEAN OVER", "LEAN UNDER", "STRONG OVER", "STRONG UNDER"].includes(type)) continue;

    const rowGame = normalizeText(row["Game"] || row["Game Label"] || row["Matchup"] || "");
    const gameOk = !rowGame || rowGame === normalizeText(game) || normalizeText(game).includes(rowGame) || rowGame.includes(normalizeText(game));
    const haystack = normalizeText([
      row["Play"],
      row["Pick"],
      row["Selection"],
      row["Player"],
      row["Pitcher"],
      row["Name"],
    ].join(" "));

    if (gameOk && haystack.includes(pitcher)) {
      return oddsFromLineCell(firstValue(row, ["Odds/Line", "Odds", "Line", "Prop Odds", "K Odds"]));
    }
  }

  return "";
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
    pitcherName: cleanPitcherName(raw),
    projected: projected || "",
    line: explicitLine || afterGradeNumber || "",
  };
}

function buildBestPlaysFromSlate(rows: SheetRow[], today: string, trackerRows: SheetRow[] = []): Play[] {
  const todaysRows = rows.filter((row) => normalizeDate(row["Date"]) === today);
  const plays: Play[] = [];

  for (const row of todaysRows) {
    const game = row["Game Label"] || `${row["Away Team"] || ""} at ${row["Home Team"] || ""}`.trim();
    const awayTeam = row["Away Team"] || "";
    const homeTeam = row["Home Team"] || "";

    const mlGrade = normalizeType(row["ML Grade"] || "");
    if (MONEYLINE_GRADES.has(mlGrade)) {
      const betterTeam = cleanTeamName(firstValue(row, ["Better ML", "Moneyline Team", "ML Team"]));
      plays.push({
        playType: mlGrade,
        game,
        play: "Moneyline",
        oddsLine: firstValue(row, ["ML Odds", "Moneyline Odds", "Odds", "Odds/Line"]),
        score: toNumber(row["Edge %"]) || toNumber(row["Best Play Score"]) || toNumber(row["Model %"]) || 50,
        isGreen: true,
        awayTeam,
        homeTeam,
        playerTeam: betterTeam,
        moneylinePct: formatMoneylinePct(firstValue(row, ["Model %", "Win %", "Moneyline %", "ML %"])),
      });
    }

    const nrfiGrade = normalizeType(row["NRFI Grade"] || "");
    if (isGreenType(nrfiGrade)) {
      plays.push({
        playType: nrfiGrade,
        game,
        play: nrfiGrade.includes("YRFI") ? "YRFI" : "NRFI",
        oddsLine: firstValue(row, ["NRFI Odds", "YRFI Odds", "First Inning Odds", "NRFI Line/Odds", "Odds/Line"]),
        score: calculateNRFIPlayScore(row, nrfiGrade),
        isGreen: true,
        awayTeam,
        homeTeam,
      });
    }

    const kMarkets = [
      {
        summary: row["Away Pitcher K + Grade"] || "",
        score: row["Away Pitcher K Score"] || "",
        team: awayTeam,
        odds: firstValue(row, ["Away Pitcher K Odds", "Away K Odds", "Away Pitcher Odds", "Away Pitcher Prop Odds", "Away Pitcher Odds/Line"]),
        headshotUrl: firstValue(row, ["Away Pitcher Headshot", "Away Pitcher Headshot URL", "Away Pitcher Image", "Away Pitcher Photo", "Away Headshot"]),
      },
      {
        summary: row["Home Pitcher K + Grade"] || "",
        score: row["Home Pitcher K Score"] || "",
        team: homeTeam,
        odds: firstValue(row, ["Home Pitcher K Odds", "Home K Odds", "Home Pitcher Odds", "Home Pitcher Prop Odds", "Home Pitcher Odds/Line"]),
        headshotUrl: firstValue(row, ["Home Pitcher Headshot", "Home Pitcher Headshot URL", "Home Pitcher Image", "Home Pitcher Photo", "Home Headshot"]),
      },
    ];

    for (const market of kMarkets) {
      const type = normalizeType(market.summary);
      if (!isGreenType(type)) continue;
      const parsed = parseKSummary(market.summary);
      const pitcherName = parsed.pitcherName || cleanPitcherName(market.summary);
      const trackerOdds = findTrackerOddsForPitcher(trackerRows, today, game, pitcherName);
      const odds = oddsFromLineCell(market.odds || trackerOdds || (parsed.line ? `Line ${parsed.line}` : ""));

      plays.push({
        playType: type,
        game,
        play: pitcherName || market.summary,
        oddsLine: odds,
        score: market.score || 50,
        isGreen: true,
        awayTeam,
        homeTeam,
        headshotUrl: market.headshotUrl,
        playerTeam: market.team,
        projectedKs: parsed.projected,
        altLine: parsed.line,
        altOdds: odds,
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

    const slateToday = slateTodayRaw.filter((row) => normalizeDate(row["Date"]) === today);
    const completedTrackerRows = trackerRaw.filter((row) => String(row["Result"] || "").trim());
    const qualifiedTrackerRows = completedTrackerRows.filter((row) => isGreenType(row["Bet Type"] || row["Market"]));
    const last7QualifiedRows = rowsFromLast7Days(qualifiedTrackerRows);
    const pendingGreen = trackerRaw.filter((row) => {
      const result = String(row["Result"] || "").trim();
      return !result && isGreenType(row["Bet Type"] || row["Market"]);
    }).length;

    const bestPlays = buildBestPlaysFromSlate(slateTodayRaw, today, trackerRaw);

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
