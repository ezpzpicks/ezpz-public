import { NextRequest, NextResponse } from "next/server";
import { readWeeklyFootballMarket } from "../../../lib/footballWeeklyMarket";
import { rescoreNcaafWeeklyMarket } from "../../../lib/footballTrendRescore";
import type { FootballSport } from "../../../lib/sportSheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const raw = String(request.nextUrl.searchParams.get("sport") || "").toUpperCase();
  if (raw !== "NFL" && raw !== "NCAAF") {
    return NextResponse.json({ ok: false, error: "sport must be NFL or NCAAF" }, { status: 400 });
  }
  try {
    const sport = raw as FootballSport;
    const result = await readWeeklyFootballMarket(sport);
    const scored = await rescoreNcaafWeeklyMarket(sport, result);
    return NextResponse.json(scored, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    console.error("Football weekly market read failed", error);
    return NextResponse.json({ ok: false, sport: raw, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}