import { NextRequest, NextResponse } from "next/server";
import { readTursoDatasetByDateKeys } from "../../../lib/tursoStore";
import { readSavedFootballSignalsForDate } from "../../../lib/footballSignals";
import { NCAAM_SIGNALS_POLICY, NCAAM_SIGNALS_TAB } from "../../../lib/ncaamTrendLeaderboard";
import { buildSignalResearchDays, buildSignalResearchReport } from "../../../lib/signalCombinationResearch";


export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get("date") || "";
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T12:00:00Z`) : NaN;
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== date) {
    return NextResponse.json({ ok: false, error: "Choose a valid NCAAM slate date." }, { status: 400 });
  }
  try {
    const [rows, lineups] = await Promise.all([readTursoDatasetByDateKeys("NCAAM", NCAAM_SIGNALS_TAB, [date]), Promise.resolve([])]);
    const sides = readSavedFootballSignalsForDate(rows, date, Date.now(), NCAAM_SIGNALS_POLICY);
    const research = buildSignalResearchReport("NCAAM", NCAAM_SIGNALS_POLICY.version, buildSignalResearchDays(sides, NCAAM_SIGNALS_POLICY.version));
    return NextResponse.json({ ok: true, sport: "NCAAM", date, sides, research, lineups },
      { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    console.error("NCAAM Signals archive read failed", { date, error });
    return NextResponse.json({ ok: false, error: "The saved slate could not be loaded. Please try again." }, { status: 503 });
  }
}
