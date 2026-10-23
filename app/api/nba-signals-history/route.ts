import { NextRequest, NextResponse } from "next/server";
import { readTursoDatasetByDateKeys } from "../../../lib/tursoStore";
import { readSavedFootballSignalsForDate } from "../../../lib/footballSignals";
import { NBA_SIGNALS_POLICY, NBA_SIGNALS_TAB } from "../../../lib/nbaTrendLeaderboard";
import { buildSignalResearchDays, buildSignalResearchReport } from "../../../lib/signalCombinationResearch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get("date") || "";
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T12:00:00Z`) : NaN;
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== date) {
    return NextResponse.json({ ok: false, error: "Choose a valid NBA slate date." }, { status: 400 });
  }
  try {
    const rows = await readTursoDatasetByDateKeys("NBA", NBA_SIGNALS_TAB, [date]);
    const sides = readSavedFootballSignalsForDate(rows, date, Date.now(), NBA_SIGNALS_POLICY);
    const research = buildSignalResearchReport("NBA", NBA_SIGNALS_POLICY.version, buildSignalResearchDays(sides, NBA_SIGNALS_POLICY.version));
    return NextResponse.json({ ok: true, sport: "NBA", date, sides, research },
      { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    console.error("NBA Signals archive read failed", { date, error });
    return NextResponse.json({ ok: false, error: "The saved slate could not be loaded. Please try again." }, { status: 503 });
  }
}
