import { NextRequest, NextResponse } from "next/server";
import { readBetMgmFootballMarket } from "../../../lib/footballBetMgmMarket";
import type { FootballSport } from "../../../lib/sportSheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const raw = String(request.nextUrl.searchParams.get("sport") || "NFL").toUpperCase();
  if (raw !== "NFL") {
    return NextResponse.json(
      { ok: false, error: "BetMGM pilot collection is currently enabled for NFL only." },
      { status: 400 },
    );
  }
  try {
    const result = await readBetMgmFootballMarket(raw as FootballSport);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    console.error("BetMGM football market read failed", error);
    return NextResponse.json(
      { ok: false, sport: raw, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
