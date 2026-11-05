import { NextRequest, NextResponse } from "next/server";
import { readSelectionTrial } from "../../../lib/selectionTrialStore";
import { trialDate, trialDayStart, type TrialSport } from "../../../lib/selectionTrial";
import { withTursoReadCache } from "../../../lib/tursoStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const sport = String(request.nextUrl.searchParams.get("sport") || "").toUpperCase();
  const date = request.nextUrl.searchParams.get("date") || trialDate(Date.now());
  try { trialDayStart(date); } catch { return NextResponse.json({ ok: false, error: "Choose a valid slate date." }, { status: 400 }); }
  if (!["MLB", "NFL", "NCAAF", "NBA", "NCAAM"].includes(sport) || date > trialDate(Date.now())) {
    return NextResponse.json({ ok: false, error: "Choose a supported sport and a current or earlier date." }, { status: 400 });
  }
  try {
    const data = await withTursoReadCache(() => readSelectionTrial(sport as TrialSport, date));
    return NextResponse.json(data, { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=30" } });
  } catch (error) {
    console.error("Selection trial read failed", { sport, date, error });
    return NextResponse.json({ ok: false, error: "The saved selection trial is temporarily unavailable." }, { status: 503 });
  }
}
