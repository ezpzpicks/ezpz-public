import { NextRequest, NextResponse } from "next/server";
import { collectNcaamMarket } from "../../../../lib/ncaamMarket";
import { collectNbaMarket } from "../../../../lib/nbaMarket";
import { scheduledMarketRefresh, recordScheduledMarketRefresh } from "../../../../lib/scheduledMarketRefresh";
import { withTursoReadCache } from "../../../../lib/tursoStore";
import { migrateNbaConsolidation } from "../../../../lib/nbaAnalysis";
import { migrateNcaamConsolidation } from "../../../../lib/ncaamAnalysis";
import { nbaDate } from "../../../../lib/nbaMarketCore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function GET(request: NextRequest) {
  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
  const previewDryRun = dryRun && process.env.VERCEL_ENV !== "production";
  const secret = process.env.CRON_SECRET;
  if (!previewDryRun && !secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured." }, { status: 500 });
  if (!previewDryRun && request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (request.nextUrl.searchParams.get("consolidate") === "1") {
    if (dryRun || !secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ ok: false, error: "An authenticated producer is required." }, { status: 401 });
    const date = nbaDate(), results = await Promise.allSettled([migrateNbaConsolidation(date), migrateNcaamConsolidation(date)]);
    const sports = results.map((result, i) => result.status === "fulfilled" ? result.value : { ok: false, sport: i ? "NCAAM" : "NBA", error: result.reason instanceof Error ? result.reason.message : String(result.reason) });
    const ok = sports.every(result => result.ok);
    return NextResponse.json({ ok, sports }, { status: ok ? 200 : 500, headers: { "Cache-Control": "no-store" } });
  }
  const collectCollege = () => withTursoReadCache(async () => {
    try {
      const startedAt = Date.now();
      const refresh = dryRun ? null : await scheduledMarketRefresh("NCAAM", "market", startedAt);
      if (refresh && !refresh.due) return { ok: true, sport: "NCAAM", skipped: true, refresh };
      const result = await collectNcaamMarket({ persist: !dryRun, refresh: refresh || undefined });
      if (!dryRun && result.refreshCompleted) await recordScheduledMarketRefresh("NCAAM", "market", startedAt);
      return { ...result, refresh };
    } catch (error) {
      console.error("NCAAM scheduled collection failed", error);
      return { ok: false, sport: "NCAAM", error: error instanceof Error ? error.message : String(error) };
    }
  });
  const nba = await withTursoReadCache(async () => {
    try {
      const startedAt = Date.now();
      const refresh = dryRun ? null : await scheduledMarketRefresh("NBA", "market", startedAt);
      if (refresh && !refresh.due) return { ok: true, sport: "NBA", skipped: true, refresh };
      const result = await collectNbaMarket({ persist: !dryRun, refresh: refresh || undefined });
      if (!dryRun && result.refreshCompleted) await recordScheduledMarketRefresh("NBA", "market", startedAt);
      return { ...result, refresh };
    } catch (error) {
      console.error("NBA ScoresAndOdds collection failed", error);
      return { ok: false, sport: "NBA", error: error instanceof Error ? error.message : String(error) };
    }
  });
  // Existing NBA collection keeps priority; either failure remains isolated.
  const ncaam = await collectCollege();
  const ok = nba.ok && ncaam.ok;
  return NextResponse.json({ ...nba, ok, ncaam }, { status: ok ? 200 : 500, headers: { "Cache-Control": "no-store" } });
}
