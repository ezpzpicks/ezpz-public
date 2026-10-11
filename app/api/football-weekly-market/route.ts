import { NextRequest, NextResponse } from "next/server";
import { readWeeklyFootballMarket } from "../../../lib/footballWeeklyMarket";
import { rescoreNcaafWeeklyMarket } from "../../../lib/footballTrendRescore";
import { applyFootballTrendV2 } from "../../../lib/footballTrendV2Lifecycle";
import type { FootballSport } from "../../../lib/sportSheets";
import { withTursoReadCache } from "../../../lib/tursoStore";
import { readSportWorksheet } from "../../../lib/sportSheets";
import { selectFootballPublicWeek } from "../../../lib/footballPublicWeeks";
import { captureFootballCatalog } from "../../../lib/footballTrendCatalogStore";
import { compactFootballPublicDisplay } from "../../../lib/footballPublicDisplay";

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
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
    const week = sport === "NCAAF"
      ? selectFootballPublicWeek(await readSportWorksheet(sport, "posted_games"), today,
          request.nextUrl.searchParams.get("week") || "")
      : null;
    // NCAAF's background tracker owns raw odds_snapshot hydration and persists
    // the complete movementHistory on weekly_market_trends. Public reads should
    // use that persisted history instead of reloading hundreds of thousands of
    // archive rows on every page refresh.
    const result = await readWeeklyFootballMarket(
      sport,
      week ? { dateKeys: week.dateKeys, hydrateHistory: false } : {},
    );
    const rescored = await rescoreNcaafWeeklyMarket(sport, result);
    const scored = await applyFootballTrendV2(sport, rescored);
    if (week) {
      // Evaluate from complete observations once on the server. Badge rendering
      // can reuse these frozen memberships without replaying charts per tile.
      const catalog = await captureFootballCatalog(sport, [], scored.trendPlays, false);
      return NextResponse.json(compactFootballPublicDisplay({
        ...scored, trendPlays: catalog.plays,
        availableWeeks: week.availableWeeks, selectedWeek: week.selectedWeek,
      }), { headers: { "Cache-Control": "no-store, max-age=0" } });
    }
    return NextResponse.json(scored, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    console.error("Football weekly market read failed", error);
    return NextResponse.json({ ok: false, sport: raw, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return withTursoReadCache(() => readMarket(request));
}
