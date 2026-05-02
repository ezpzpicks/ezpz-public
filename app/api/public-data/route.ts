import { NextResponse } from "next/server";
import { readWorksheet, SLATE_COLUMNS, TRACKER_COLUMNS } from "../../../lib/googleSheets";
import {
  buildBestPlays,
  buildBetTypeGreenSet,
  lastSevenDaysGreenTotals,
  nowEtLabel,
  overallGreenTotals,
  pendingGreenCount,
  summarizeTracker,
  todayEtString,
} from "../../../lib/metrics";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [trackerRows, slateRows] = await Promise.all([
      readWorksheet("bet_tracker", TRACKER_COLUMNS),
      readWorksheet("daily_slate", SLATE_COLUMNS),
    ]);

    const today = todayEtString();
    const summary = summarizeTracker(trackerRows);
    const greenSet = buildBetTypeGreenSet(summary);
    const todaySlate = slateRows.filter((row) => String(row.Date) === today);
    const bestPlays = buildBestPlays(todaySlate, greenSet);

    return NextResponse.json({
      ok: true,
      today,
      lastUpdated: nowEtLabel(),
      tiles: {
        last7Days: lastSevenDaysGreenTotals(trackerRows, summary, today),
        overallGreen: overallGreenTotals(trackerRows, summary),
        pendingGreen: pendingGreenCount(trackerRows, summary),
        bestPlaysToday: bestPlays.length,
      },
      bestPlays,
      slateToday: todaySlate,
      recordSummary: summary,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
