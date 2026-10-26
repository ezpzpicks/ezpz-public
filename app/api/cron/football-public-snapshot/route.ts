import { NextRequest, NextResponse } from "next/server";
import { buildFootballPublicData } from "../../../../lib/footballPublicData";
import { settlePendingFootballResults } from "../../../../lib/footballResultSettlement";
import { evaluateFootballTrendV2 } from "../../../../lib/footballTrendV2Lifecycle";
import type { FootballSport } from "../../../../lib/sportSheets";
import { withTursoReadCache } from "../../../../lib/tursoStore";
import { persistEzpzCurrentPicks } from "../../../../lib/ezpzCurrentPicks";
import { repairNcaafFinalScores } from "../../../../lib/ncaafFinalScoreRepair";
import { scheduledMarketRefresh, recordScheduledMarketRefresh } from "../../../../lib/scheduledMarketRefresh";
import { persistPublicBoardSnapshot } from "../../../../lib/publicBoardSnapshot";
import { restoreFootballPublicDisplay } from "../../../../lib/footballPublicDisplay";
import { GET as readWeeklyMarket } from "../../football-weekly-market/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 180;

function requestedSport(request: NextRequest): FootballSport | null {
  const sport = String(request.nextUrl.searchParams.get("sport") || "")
    .trim()
    .toUpperCase();
  return sport === "NFL" || sport === "NCAAF" ? sport : null;
}

async function runCron(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not configured." },
      { status: 500 },
    );
  }

  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const sport = requestedSport(request);
  if (!sport) {
    return NextResponse.json(
      { ok: false, error: "sport must be NFL or NCAAF" },
      { status: 400 },
    );
  }

  try {
    const startedAt = Date.now();
    const refresh = await scheduledMarketRefresh(sport, "public", startedAt);
    if (!refresh.due && request.nextUrl.searchParams.get("force") !== "1") return NextResponse.json({ ok: true, sport, skipped: true, refresh });
    let finalScoreRepair: unknown = null;
    if (sport === "NCAAF") {
      try {
        finalScoreRepair = await repairNcaafFinalScores();
      } catch (error) {
        console.warn("NCAAF schedule final-score repair failed", error);
        finalScoreRepair = {
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    let settlement: unknown = null;
    try {
      settlement = await settlePendingFootballResults(sport, { force: true });
    } catch (error) {
      console.warn(`${sport} final-score settlement failed`, error);
      settlement = {
        sport,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    let payload: Record<string, any>;
    try {
      payload = await buildFootballPublicData(sport, { forceFresh: true, persist: true });
    } catch (error) {
      // Empty/off-day feeds must not prevent the saved display from updating
      // its records and weekly markets. Preserve monitoring's failed status.
      console.warn(`${sport} capture failed; preparing retained public display`, error);
      payload = { ...await buildFootballPublicData(sport, { forceFresh: true, persist: false, publicDisplay: true }),
        stale: true, marketRefreshError: error instanceof Error ? error.message : String(error) };
    }
    payload.refreshPolicy = refresh.policy;
    payload.refreshIntervalMinutes = refresh.intervalMinutes;
    // Keep the lightweight EZPZ Picks notification snapshot independent from
    // live ScoresAndOdds health. The public football payload can still produce
    // the currently displayed picks from retained snapshots/model data even
    // when the live market refresh is rejected as incomplete. Persist those
    // picks first, then let the market-monitoring cron fail loudly below.
    let picksSaved = false;
    try {
      await persistEzpzCurrentPicks(sport, payload);
      picksSaved = true;
    } catch (error) {
      console.error(`${sport} current EZPZ picks snapshot failed`, error);
    }

    // Prepare the complete weekly display in the producer. Opening Model Plays,
    // Full Slate or Public Betting Splits must not replay this work per visitor.
    const weeklyResponse = await readWeeklyMarket(new NextRequest(
      new URL(`/api/football-weekly-market?sport=${sport}&compact=1`, request.url),
    ));
    const weekly = await weeklyResponse.json();
    if (!weeklyResponse.ok || !weekly.ok) throw new Error(`Could not prepare ${sport} weekly display.`);
    payload.footballWeeklyMarket = restoreFootballPublicDisplay(weekly);
    const publicBoard = await persistPublicBoardSnapshot(sport, payload, startedAt);

    const staleDraftKings =
      payload?.stale === true ||
      payload?.draftKings?.stale === true ||
      payload?.draftKings?.displayMode === "STALE_FALLBACK";
    if (staleDraftKings) {
      throw new Error(
        `${sport} ScoresAndOdds refresh used retained/stale data; cron run rejected so monitoring cannot report a false success.`,
      );
    }
    let trendV2Lifecycle: unknown = null;
    try {
      trendV2Lifecycle = await evaluateFootballTrendV2(sport);
    } catch (error) {
      console.warn(`${sport} Trend V2 lifecycle evaluation failed`, error);
      trendV2Lifecycle = {
        sport,
        status: "COLLECTING",
        reason: "Lifecycle evaluation failed; incumbent/legacy scoring was left unchanged.",
      };
    }
    if (picksSaved) await recordScheduledMarketRefresh(sport, "public", startedAt);
    return NextResponse.json(request.nextUrl.searchParams.get("compact") === "1"
      ? { ok: payload.ok, sport, publicBoard, refresh, finalScoreRepair, settlement, trendV2Lifecycle }
      : { ...payload, publicBoard, refresh, finalScoreRepair, settlement, trendV2Lifecycle }, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    console.error(`${sport} football public snapshot failed`, error);
    return NextResponse.json(
      {
        ok: false,
        sport,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  return withTursoReadCache(() => runCron(request));
}
