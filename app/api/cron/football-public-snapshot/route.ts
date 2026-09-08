import { NextRequest, NextResponse } from "next/server";
import { buildFootballPublicData } from "../../../../lib/footballPublicData";
import { evaluateFootballTrendV2 } from "../../../../lib/footballTrendV2Lifecycle";
import type { FootballSport } from "../../../../lib/sportSheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 120;

function requestedSport(request: NextRequest): FootballSport | null {
  const sport = String(request.nextUrl.searchParams.get("sport") || "")
    .trim()
    .toUpperCase();
  return sport === "NFL" || sport === "NCAAF" ? sport : null;
}

export async function GET(request: NextRequest) {
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
    const payload = await buildFootballPublicData(sport, {
      forceFresh: true,
      persist: true,
    });
    let trendV2Lifecycle: unknown = null;
    try {
      // evaluateFootballTrendV2 internally throttles itself to one full
      // evaluation per ET date, so frequent market snapshots stay cheap.
      trendV2Lifecycle = await evaluateFootballTrendV2(sport);
    } catch (error) {
      console.warn(`${sport} Trend V2 lifecycle evaluation failed`, error);
      trendV2Lifecycle = {
        sport,
        status: "COLLECTING",
        reason: "Lifecycle evaluation failed; incumbent/legacy scoring was left unchanged.",
      };
    }
    return NextResponse.json({ ...payload, trendV2Lifecycle }, {
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
