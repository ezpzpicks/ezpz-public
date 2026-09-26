import { NextRequest, NextResponse } from "next/server";
import { readWeeklyFootballMarket } from "../../../lib/footballWeeklyMarket";
import { rescoreNcaafWeeklyMarket } from "../../../lib/footballTrendRescore";
import { applyFootballTrendV2 } from "../../../lib/footballTrendV2Lifecycle";
import type { FootballSport } from "../../../lib/sportSheets";
import { withTursoReadCache } from "../../../lib/tursoStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 180;

async function readMarket(request: NextRequest) {
  const raw = String(request.nextUrl.searchParams.get("sport") || "").toUpperCase();
  if (raw !== "NFL" && raw !== "NCAAF") {
    return NextResponse.json({ ok: false, error: "sport must be NFL or NCAAF" }, { status: 400 });
  }
  try {
    const sport = raw as FootballSport;
    // NCAAF's background tracker owns raw odds_snapshot hydration and persists
    // the complete movementHistory on weekly_market_trends. Public reads should
    // use that persisted history instead of reloading hundreds of thousands of
    // archive rows on every page refresh.
    const result = await readWeeklyFootballMarket(
      sport,
      sport === "NCAAF" ? { hydrateHistory: false } : {},
    );
    const rescored = await rescoreNcaafWeeklyMarket(sport, result);
    const scored = await applyFootballTrendV2(sport, rescored);
    return NextResponse.json(scored, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    console.error("Football weekly market read failed", error);
    return NextResponse.json({ ok: false, sport: raw, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return withTursoReadCache(() => readMarket(request));
}
