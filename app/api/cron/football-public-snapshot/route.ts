import { NextRequest, NextResponse } from "next/server";
import { buildFootballPublicData } from "../../../../lib/footballPublicData";
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
    return NextResponse.json(payload, {
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
