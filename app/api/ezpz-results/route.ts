import { NextRequest, NextResponse } from "next/server";
import { EZPZ_RESULT_SPORTS, readSavedEzpzResults } from "../../../lib/ezpzSavedResults";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const headers = { "Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex" };

export async function GET(request: NextRequest) {
  const sport = String(request.nextUrl.searchParams.get("sport") || "").trim().toUpperCase();
  const date = String(request.nextUrl.searchParams.get("date") || "").trim();
  if (!EZPZ_RESULT_SPORTS.includes(sport as typeof EZPZ_RESULT_SPORTS[number])) {
    return NextResponse.json({ ok: false, error: "Unsupported sport.", supportedSports: EZPZ_RESULT_SPORTS }, { status: 400, headers });
  }
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T12:00:00Z`))
    || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) {
    return NextResponse.json({ ok: false, error: "A valid YYYY-MM-DD game date is required." }, { status: 400, headers });
  }
  try {
    const picks = await readSavedEzpzResults(sport as typeof EZPZ_RESULT_SPORTS[number], date);
    return NextResponse.json({ ok: true, sport, date, timezone: "America/New_York",
      generatedAt: new Date().toISOString(), source: "saved-result-ledgers", supportedSports: EZPZ_RESULT_SPORTS,
      pickCount: picks.length, picks }, { headers });
  } catch (error) {
    console.error("EZPZ saved results read failed", error);
    return NextResponse.json({ ok: false, sport, date, error: "Saved results are unavailable; do not treat this as zero picks." }, { status: 503, headers });
  }
}
