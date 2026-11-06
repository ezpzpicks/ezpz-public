import { NextRequest, NextResponse } from "next/server";
import { nbaDate } from "../../../lib/nbaMarketCore";
import { SITUATION_START_DATE, type SituationSport } from "../../../lib/situationRules";
import { readSituationPolicy } from "../../../lib/situationStore";

export const dynamic = "force-dynamic";
const sports: SituationSport[] = ["NFL", "NBA", "NCAAM"];

export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get("date") || nbaDate();
  const stamp = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T12:00:00Z`) : NaN;
  if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== date) {
    return NextResponse.json({ ok: false, error: "Choose a valid slate date." }, { status: 400 });
  }
  try {
    const reviews = await Promise.all(sports.map(async sport => ({ sport,
      policy: date >= SITUATION_START_DATE ? await readSituationPolicy(sport, date) ?? null : null })));
    return NextResponse.json({ ok: true, date, effectiveDate: SITUATION_START_DATE, reviews }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("EZPZ play-type review read failed", { date, error });
    return NextResponse.json({ ok: false, error: "Saved play-type reviews are unavailable." }, { status: 503 });
  }
}
