import { NextResponse } from "next/server";
import { readWorksheet, SLATE_COLUMNS, TRACKER_COLUMNS } from "../../../lib/googleSheets";
import {
  buildBetTypeGreenSet,
  cleanPitcherName,
  lastSevenDaysGreenTotals,
  nowEtLabel,
  normalizeBetTypeText,
  overallGreenTotals,
  pendingGreenCount,
  summarizeTracker,
  summarizeTrackerLastSevenDays,
  todayEtString,
  type SheetRow,
} from "../../../lib/metrics";

export const dynamic = "force-dynamic";

type BestPlayOut = {
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

function toFirstLast(name: string) {
  const cleaned = String(name || "").trim();
  if (!cleaned || cleaned.toUpperCase() === "TBD") return "";
  if (!cleaned.includes(",")) return cleaned;
  const [last, first] = cleaned.split(",", 2);
  return `${first.trim()} ${last.trim()}`.trim();
}

async function lookupMlbHeadshot(name: string): Promise<string> {
  const firstLast = toFirstLast(name);
  if (!firstLast) return "";
  try {
    const url = `https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(firstLast)}`;
    const res = await fetch(url, { next: { revalidate: 60 * 60 * 24 } });
    if (!res.ok) return "";
    const json = await res.json();
    const person = Array.isArray(json.people) ? json.people[0] : null;
    const id = person?.id;
    return id
      ? `https://img.mlbstatic.com/mlb-images/image/upload/w_180,q_auto:best/v1/people/${id}/headshot/67/current`
      : "";
  } catch {
    return "";
  }
}

async function addPitcherHeadshots(rows: SheetRow[]) {
  const uniqueNames = new Set<string>();
  for (const row of rows) {
    const awayName = cleanPitcherName(row["Away Pitcher K + Grade"] || "");
    const homeName = cleanPitcherName(row["Home Pitcher K + Grade"] || "");
    if (awayName) uniqueNames.add(awayName);
    if (homeName) uniqueNames.add(homeName);
  }

  const entries = await Promise.all(
    [...uniqueNames].map(async (name) => [name, await lookupMlbHeadshot(name)] as const),
  );
  const headshots = new Map(entries);

  return rows.map((row) => {
    const awayName = cleanPitcherName(row["Away Pitcher K + Grade"] || "");
    const homeName = cleanPitcherName(row["Home Pitcher K + Grade"] || "");
    return {
      ...row,
      "Away Pitcher Headshot URL": row["Away Pitcher Headshot URL"] || headshots.get(awayName) || "",
      "Home Pitcher Headshot URL": row["Home Pitcher Headshot URL"] || headshots.get(homeName) || "",
    };
  });
}

function parseNumber(value: unknown) {
  const text = String(value ?? "").replace("%", "").trim();
  const n = Number(text);
  return Number.isFinite(n) ? n : 0;
}

function isPendingToday(row: SheetRow, today: string) {
  const result = String(row.Result || "").trim().toUpperCase();
  return String(row.Date || "") === today && (!result || result === "PENDING");
}

function compact(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function nameTokens(value: string) {
  return compact(value).split(" ").filter(Boolean);
}

function containsAll(haystack: string, needles: string[]) {
  const h = ` ${compact(haystack)} `;
  return needles.every((token) => h.includes(` ${token} `));
}

function rowGameLabel(row: SheetRow) {
  return row["Game Label"] || `${row["Away Team"]} at ${row["Home Team"]}`;
}

function matchesPitcherSelection(selection: string, summary: string) {
  const clean = cleanPitcherName(summary);
  if (!selection || !clean) return false;
  const sel = nameTokens(selection);
  const pitcher = nameTokens(clean);
  if (!sel.length || !pitcher.length) return false;

  // Exact normalized inclusion catches "Woo, Bryan" vs "Woo, Bryan 6.62 (OVER)".
  if (compact(summary).includes(compact(selection))) return true;
  if (compact(clean).includes(compact(selection)) || compact(selection).includes(compact(clean))) return true;

  // Require at least the last name token to match, and first name if available.
  const selSet = new Set(sel);
  const pitcherSet = new Set(pitcher);
  const overlap = sel.filter((token) => pitcherSet.has(token)).length;
  const reverseOverlap = pitcher.filter((token) => selSet.has(token)).length;
  return overlap >= Math.min(2, sel.length) || reverseOverlap >= Math.min(2, pitcher.length);
}

function findSlateMatch(row: SheetRow, slateRows: SheetRow[]) {
  const selection = String(row.Selection || "").trim();
  const market = String(row.Market || "").trim();
  const type = normalizeBetTypeText(row["Bet Type"]);
  const haystack = `${selection} ${market}`;

  // Best match: tracker market contains both full team names or the saved game label.
  let match = slateRows.find((slate) => {
    const game = rowGameLabel(slate);
    if (compact(market) && compact(game) && compact(market).includes(compact(game))) return true;
    const away = String(slate["Away Team"] || "");
    const home = String(slate["Home Team"] || "");
    return containsAll(haystack, nameTokens(away)) && containsAll(haystack, nameTokens(home));
  });
  if (match) return match;

  // Pitcher props: match by pitcher name only, not first token. This prevents Los Angeles/Chicago mismatches.
  if (["OVER", "UNDER", "LEAN OVER", "LEAN UNDER", "STRONG OVER", "STRONG UNDER"].includes(type)) {
    match = slateRows.find((slate) =>
      matchesPitcherSelection(selection, slate["Away Pitcher K + Grade"] || "") ||
      matchesPitcherSelection(selection, slate["Home Pitcher K + Grade"] || ""),
    );
    if (match) return match;
  }

  // Moneyline: exact team name only.
  match = slateRows.find((slate) => {
    const better = String(slate["Better ML"] || "");
    return compact(selection) === compact(better) || compact(haystack).includes(compact(better));
  });

  return match || null;
}

function extractLineFromTracker(row: SheetRow) {
  const text = `${row["Odds/Line"] || ""} ${row.Market || ""}`;
  const match = text.match(/(?:line\s*)?([0-9]+(?:\.[0-9]+)?)/i);
  return match?.[1] || row["Odds/Line"] || "—";
}

function isPitcherType(type: string) {
  return ["OVER", "UNDER", "LEAN OVER", "LEAN UNDER", "STRONG OVER", "STRONG UNDER"].includes(type);
}

async function buildBestPlaysFromTracker(
  trackerRows: SheetRow[],
  todaySlate: SheetRow[],
  recentGreenSet: Set<string>,
  today: string,
) {
  const todayGreenTracker = trackerRows.filter((row) => {
    const type = normalizeBetTypeText(row["Bet Type"]);
    return isPendingToday(row, today) && type && recentGreenSet.has(type);
  });

  const plays = await Promise.all(todayGreenTracker.map(async (row): Promise<BestPlayOut> => {
    const type = normalizeBetTypeText(row["Bet Type"]);
    const selection = String(row.Selection || "").trim();
    const matchedSlate = findSlateMatch(row, todaySlate);
    const game = matchedSlate ? rowGameLabel(matchedSlate) : String(row.Market || "Today");
    let play = selection || type;
    let score: string | number = row["Model %"] || row["Edge %"] || "—";
    let oddsLine = row["Odds/Line"] || "";
    let headshotUrl = "";
    let playerTeam = "";
    let moneylinePct = "";

    if (isPitcherType(type) && matchedSlate) {
      const awaySummary = String(matchedSlate["Away Pitcher K + Grade"] || "");
      const homeSummary = String(matchedSlate["Home Pitcher K + Grade"] || "");
      if (matchesPitcherSelection(selection, awaySummary)) {
        play = awaySummary;
        score = matchedSlate["Away Pitcher K Score"] || score;
        headshotUrl = matchedSlate["Away Pitcher Headshot URL"] || "";
        playerTeam = matchedSlate["Away Team"] || "";
      } else if (matchesPitcherSelection(selection, homeSummary)) {
        play = homeSummary;
        score = matchedSlate["Home Pitcher K Score"] || score;
        headshotUrl = matchedSlate["Home Pitcher Headshot URL"] || "";
        playerTeam = matchedSlate["Home Team"] || "";
      } else {
        play = `${selection} (${type}) Line ${extractLineFromTracker(row)}`;
      }
    }

    if (isPitcherType(type) && !headshotUrl) {
      headshotUrl = await lookupMlbHeadshot(selection || cleanPitcherName(play));
    }

    if (type.includes("MONEYLINE")) {
      moneylinePct = String(row["Model %"] || "").trim();
      playerTeam = selection;
      score = row["Model %"] || row["Edge %"] || score;
    }

    return {
      playType: type,
      game,
      play,
      oddsLine,
      score,
      isGreen: true,
      awayTeam: matchedSlate?.["Away Team"] || "",
      homeTeam: matchedSlate?.["Home Team"] || "",
      headshotUrl,
      playerTeam,
      moneylinePct,
    };
  }));

  return plays.sort((a, b) => parseNumber(b.score) - parseNumber(a.score));
}

export async function GET() {
  try {
    const [trackerRows, slateRows] = await Promise.all([
      readWorksheet("bet_tracker", TRACKER_COLUMNS),
      readWorksheet("daily_slate", SLATE_COLUMNS),
    ]);

    const today = todayEtString();
    const summary = summarizeTracker(trackerRows);
    const last7Summary = summarizeTrackerLastSevenDays(trackerRows, today);
    const recentGreenSet = buildBetTypeGreenSet(last7Summary);
    const rawTodaySlate = slateRows.filter((row) => String(row.Date) === today);
    const todaySlate = await addPitcherHeadshots(rawTodaySlate);
    const bestPlays = await buildBestPlaysFromTracker(trackerRows, todaySlate, recentGreenSet, today);

    return NextResponse.json({
      ok: true,
      today,
      lastUpdated: nowEtLabel(),
      tiles: {
        last7Days: lastSevenDaysGreenTotals(trackerRows, last7Summary, today),
        overallGreen: overallGreenTotals(trackerRows, summary),
        pendingGreen: pendingGreenCount(trackerRows, last7Summary),
        bestPlaysToday: bestPlays.length,
      },
      bestPlays,
      slateToday: todaySlate,
      recordSummary: summary,
      last7RecordSummary: last7Summary,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
