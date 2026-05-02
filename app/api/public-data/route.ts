import { NextResponse } from "next/server";
import { readWorksheet, SLATE_COLUMNS, TRACKER_COLUMNS } from "../../../lib/googleSheets";
import {
  buildBestPlays,
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

function guessGameFromSlate(selection: string, slateRows: SheetRow[]) {
  const needle = String(selection || "").toLowerCase();
  const match = slateRows.find((row) => {
    const fields = [
      row["Better ML"],
      row["Away Pitcher K + Grade"],
      row["Home Pitcher K + Grade"],
      row["NRFI Grade"],
      row["Away Team"],
      row["Home Team"],
    ].join(" ").toLowerCase();
    return needle && fields.includes(needle.split(" ")[0] || needle);
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

async function buildBestPlaysFromTracker(trackerRows: SheetRow[], todaySlate: SheetRow[], recentGreenSet: Set<string>, today: string) {
  const todayGreenTracker = trackerRows.filter((row) => {
    const type = normalizeBetTypeText(row["Bet Type"]);
    return isPendingToday(row, today) && type && recentGreenSet.has(type);
  });

  return Promise.all(todayGreenTracker.map(async (row) => {
    const type = normalizeBetTypeText(row["Bet Type"]);
    const selection = String(row.Selection || "").trim();
    const matchedSlate = guessGameFromSlate(selection, todaySlate);
    const game = matchedSlate ? (matchedSlate["Game Label"] || `${matchedSlate["Away Team"]} at ${matchedSlate["Home Team"]}`) : String(row.Market || "Today");
    let play = selection || type;
    let score: string | number = row["Model %"] || row["Edge %"] || "—";
    let oddsLine = row["Odds/Line"] || "";
    let headshotUrl = "";

    if (isPitcherType(type) && matchedSlate) {
      const awaySummary = String(matchedSlate["Away Pitcher K + Grade"] || "");
      const homeSummary = String(matchedSlate["Home Pitcher K + Grade"] || "");
      const selLower = selection.toLowerCase();
      if (awaySummary.toLowerCase().includes(selLower.split(" ")[0] || selLower)) {
        play = awaySummary;
        score = matchedSlate["Away Pitcher K Score"] || score;
        headshotUrl = matchedSlate["Away Pitcher Headshot URL"] || "";
      } else if (homeSummary.toLowerCase().includes(selLower.split(" ")[0] || selLower)) {
        play = homeSummary;
        score = matchedSlate["Home Pitcher K Score"] || score;
        headshotUrl = matchedSlate["Home Pitcher Headshot URL"] || "";
      } else {
        play = `${selection} (${type}) Line ${extractLineFromTracker(row)}`;
      }
    }

    if (isPitcherType(type) && !headshotUrl) {
      headshotUrl = await lookupMlbHeadshot(selection || cleanPitcherName(play));
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
    };
  })).then((plays) => plays.sort((a, b) => parseNumber(b.score) - parseNumber(a.score)));
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
