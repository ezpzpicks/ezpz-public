import { NextResponse } from "next/server";
import { readWorksheet, SLATE_COLUMNS, TRACKER_COLUMNS } from "../../../lib/googleSheets";
import {
  buildBestPlays,
  buildBetTypeGreenSet,
  cleanPitcherName,
  lastSevenDaysGreenTotals,
  nowEtLabel,
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
    const bestPlays = buildBestPlays(todaySlate, recentGreenSet);

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
