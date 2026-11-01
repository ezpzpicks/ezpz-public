import { NextRequest, NextResponse } from "next/server";
import { savedPublicBoardResponse } from "../../../lib/publicBoardSnapshot";
import { readNcaamPublicData } from "../../../lib/ncaamMarket";
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
    try {
      const data = await withTursoReadCache(() => readNcaamPublicData(request.nextUrl.searchParams.get("date") || nbaDate()));
      return NextResponse.json(data, { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=30" } });
    } catch {
      return NextResponse.json({ ok: false, sport, error: "The saved NCAAM board is temporarily unavailable." }, { status: 503 });
    }
  }
  return NextResponse.json({ ok: false, error: "Choose MLB, NFL, NCAAF, NBA, or NCAAM." }, { status: 400 });
}
