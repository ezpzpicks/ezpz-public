import { NextRequest, NextResponse } from "next/server";
import { readSavedSlate, readSlateDates, slateDate, type SlateHistorySport } from "../../../lib/slateHistory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const sport = String(request.nextUrl.searchParams.get("sport") || "").toUpperCase();
  const date = request.nextUrl.searchParams.get("date");
  if (!["MLB", "NFL", "NCAAF", "NCAAM"].includes(sport) || (date !== null && (!slateDate(date) || slateDate(date) !== date)))
    return NextResponse.json({ ok: false, error: "Choose a valid sport and slate date." }, { status: 400 });
  try {
    const selectedSport = sport as SlateHistorySport;
    const data = date ? await readSavedSlate(selectedSport, date)
      : { ok: true, sport, availableDates: await readSlateDates(selectedSport) };
    return NextResponse.json(data, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });
  } catch (error) {
    console.error("Saved slate read failed", { sport, date, error });
    return NextResponse.json({ ok: false, error: "Saved projections are temporarily unavailable. Please try again." },
      { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
