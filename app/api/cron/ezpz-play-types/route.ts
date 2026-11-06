import { NextRequest, NextResponse } from "next/server";
import { nbaDate } from "../../../../lib/nbaMarketCore";
import { SITUATION_SPORTS } from "../../../../lib/situationRules";
import { reviewSituations } from "../../../../lib/situationStore";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const now = Date.now(), date = nbaDate(now);
  // Sequential initialization lets the first sport create the tables before
  // the other sports attempt to read their own rule history.
  const reviews = [];
  for (const sport of SITUATION_SPORTS) {
    try {
      const policy = await reviewSituations(sport, date, now);
      reviews.push({ sport, ok: true, active: policy?.rules.filter(rule => rule.active).map(rule => rule.id) || [] });
    } catch (error) {
      console.error("EZPZ daily play-type review failed", { sport, date, error });
      reviews.push({ sport, ok: false });
    }
  }
  const ok = reviews.every(review => review.ok);
  return NextResponse.json({ ok, date, reviews }, { status: ok ? 200 : 500, headers: { "Cache-Control": "no-store" } });
}
