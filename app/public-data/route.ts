import { NextResponse } from "next/server";

const emptyTotals = {
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

export async function GET() {
  // This placeholder keeps the site buildable if you replace the whole folder.
  // If your old project already had a Google Sheets route, paste that route code here
  // to reconnect live EZPZ data.
  return NextResponse.json({
    ok: true,
    today: new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" }),
    lastUpdated: "No live data route connected yet",
    tiles: {
      last7Days: emptyTotals,
      overallGreen: emptyTotals,
      pendingGreen: 0,
      bestPlaysToday: 0,
    },
    bestPlays: [],
    slateToday: [],
    recordSummary: [],
    last7RecordSummary: [],
  });
}
