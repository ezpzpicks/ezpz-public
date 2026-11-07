import { NextRequest, NextResponse } from "next/server";
import { readMatchupContext } from "../../../lib/matchupContextStore";
import { trialDate, trialDayStart } from "../../../lib/selectionTrial";
import type { ContextSport } from "../../../lib/matchupContext";
import { withTursoReadCache } from "../../../lib/tursoStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const sport = String(request.nextUrl.searchParams.get("sport") || "").toUpperCase();
  const date = request.nextUrl.searchParams.get("date") || trialDate(Date.now());
  try { trialDayStart(date); }
  catch { return NextResponse.json({ ok: false, error: "Choose a valid slate date." }, { status: 400 }); }
  if (!["NFL", "NCAAF", "NBA", "NCAAM"].includes(sport) || date > trialDate(Date.now())) {
    return NextResponse.json({ ok: false, error: "Choose a supported sport and a current or earlier date." }, { status: 400 });
  }
  try {
    const data = await withTursoReadCache(() => readMatchupContext(sport as ContextSport, date));
    return NextResponse.json(data, { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=30" } });
  } catch (error) {
    console.error("Matchup context read failed", { sport, date, error });
    return NextResponse.json({ ok: false, error: "The saved matchup review is temporarily unavailable." }, { status: 503 });
  }
}
