import { NextRequest, NextResponse } from "next/server";
import { dateET, isOfficialSport, readApprovedPicks, OFFICIAL_SPORTS, MANUAL_EZPZ_START } from "../../../lib/manualOfficialPicks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
const headers = { "Cache-Control": "no-store, max-age=0" };

export async function GET(request: NextRequest) {
  const sport = String(request.nextUrl.searchParams.get("sport") || "").toUpperCase();
  const date = request.nextUrl.searchParams.get("date") || dateET(Date.now());
  if (!isOfficialSport(sport)) return NextResponse.json({ ok: false, error: "Unsupported sport", supportedSports: OFFICIAL_SPORTS }, { status: 400, headers });
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(date) || dateET(`${date}T12:00:00Z`) !== date) {
    return NextResponse.json({ ok: false, error: "Use a valid YYYY-MM-DD date." }, { status: 400, headers });
  }
  const picks = readApprovedPicks({ sport, date });
  return NextResponse.json({ ok: true, sport, date, effectiveDate: MANUAL_EZPZ_START,
    source: "manual-chatgpt-muse-approval", pickCount: picks.length, picks }, { headers });
}
