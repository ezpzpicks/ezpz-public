import { NextRequest, NextResponse } from "next/server";
import { readNcaamPublicData } from "../../../lib/ncaamMarket";
import { ncaamDate } from "../../../lib/ncaamMarketCore";
import { withTursoReadCache } from "../../../lib/tursoStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  try {
    const data = await withTursoReadCache(() => readNcaamPublicData(request.nextUrl.searchParams.get("date") || ncaamDate()));
    return NextResponse.json(data, { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=30" } });
  } catch (error) {
    return NextResponse.json({ ok: false, sport: "NCAAM", error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
