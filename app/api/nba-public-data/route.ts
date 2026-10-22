import { NextRequest, NextResponse } from "next/server";
import { readNbaPublicData } from "../../../lib/nbaMarket";
import { nbaDate } from "../../../lib/nbaMarketCore";
import { withTursoReadCache } from "../../../lib/tursoStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  try {
    const data = await withTursoReadCache(() => readNbaPublicData(request.nextUrl.searchParams.get("date") || nbaDate()));
    return NextResponse.json(data, { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=30" } });
  } catch (error) {
    return NextResponse.json({ ok: false, sport: "NBA", error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
