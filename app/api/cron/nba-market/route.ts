import { NextRequest, NextResponse } from "next/server";
import { collectNbaMarket } from "../../../../lib/nbaMarket";
import { scheduledMarketRefresh, recordScheduledMarketRefresh } from "../../../../lib/scheduledMarketRefresh";
import { withTursoReadCache } from "../../../../lib/tursoStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function GET(request: NextRequest) {
  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
  const previewDryRun = dryRun && process.env.VERCEL_ENV !== "production";
  const secret = process.env.CRON_SECRET;
  if (!previewDryRun && !secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured." }, { status: 500 });
  if (!previewDryRun && request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  return withTursoReadCache(async () => {
    try {
      const startedAt = Date.now();
      const refresh = dryRun ? null : await scheduledMarketRefresh("NBA", "market", startedAt);
      if (refresh && !refresh.due) return NextResponse.json({ ok: true, sport: "NBA", skipped: true, refresh });
      const result = await collectNbaMarket({ persist: !dryRun, refresh: refresh || undefined });
      if (!dryRun && result.refreshCompleted) await recordScheduledMarketRefresh("NBA", "market", startedAt);
      return NextResponse.json({ ...result, refresh }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      console.error("NBA ScoresAndOdds collection failed", error);
      return NextResponse.json({ ok: false, sport: "NBA", error: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
  });
}
