import { NextRequest, NextResponse } from "next/server";
import { FOOTBALL_SIGNALS_HEADERS, FOOTBALL_SIGNALS_TAB, readSavedFootballSignalsForDate } from "../../../lib/footballSignals";
import { readSportWorksheetByDateKeys, type FootballSport } from "../../../lib/sportSheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const sport = (request.nextUrl.searchParams.get("sport") || "").toUpperCase();
  const date = request.nextUrl.searchParams.get("date") || "";
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T12:00:00Z`) : NaN;
  if (!["NFL", "NCAAF"].includes(sport) || !Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== date) {
    return NextResponse.json({ ok: false, error: "Choose NFL or NCAAF and a valid slate date." }, { status: 400 });
  }
  try {
    const rows = await readSportWorksheetByDateKeys(sport as FootballSport, FOOTBALL_SIGNALS_TAB, [date], FOOTBALL_SIGNALS_HEADERS);
    return NextResponse.json({ ok: true, sport, date, sides: readSavedFootballSignalsForDate(rows, date) },
      { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    console.error("Football Signals archive read failed", { sport, date, error });
    return NextResponse.json({ ok: false, error: "The saved slate could not be loaded. Please try again." }, { status: 503 });
  }
}
