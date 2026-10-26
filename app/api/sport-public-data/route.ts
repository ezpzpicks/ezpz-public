import { NextRequest, NextResponse } from "next/server";
import { savedPublicBoardResponse } from "../../../lib/publicBoardSnapshot";
import { readNbaPublicData } from "../../../lib/nbaMarket";
import { nbaDate } from "../../../lib/nbaMarketCore";
import { withTursoReadCache } from "../../../lib/tursoStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const sport = String(request.nextUrl.searchParams.get("sport") || "MLB").trim().toUpperCase();
  if (sport === "MLB" || sport === "NFL" || sport === "NCAAF") return savedPublicBoardResponse(request, sport);
  if (sport === "NBA") {
    try {
      const data = await withTursoReadCache(() => readNbaPublicData(request.nextUrl.searchParams.get("date") || nbaDate()));
      return NextResponse.json(data, { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=30" } });
    } catch {
      return NextResponse.json({ ok: false, sport, error: "The saved NBA board is temporarily unavailable." }, { status: 503 });
    }
  }
  if (sport === "NCAAM") {
    // The preseason display has no live board yet. It must not load MLB's history.
    const empty = { label: "NCAAM", record: "0-0-0", totalBets: 0, winPct: 0, unitsWon: 0, roiPct: 0, wins: 0, losses: 0, pushes: 0 };
    return NextResponse.json({ ok: true, sport, today: nbaDate(), lastUpdated: "", development: true,
      tiles: { last7Days: empty, overallGreen: empty, pendingGreen: 0, bestPlaysToday: 0 },
      bestPlays: [], slateToday: [], betTrackerRows: [], trendPlays: [], aiPicks: [], aiPickRecordRows: [], recordSummary: [], last7RecordSummary: [],
    }, { headers: { "Cache-Control": "public, s-maxage=300" } });
  }
  return NextResponse.json({ ok: false, error: "Choose MLB, NFL, NCAAF, NBA, or NCAAM." }, { status: 400 });
}
