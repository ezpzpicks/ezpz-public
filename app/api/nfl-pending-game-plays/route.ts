import { NextRequest, NextResponse } from "next/server";
import { readTursoDatasetByDateKeys, withTursoReadCache } from "../../../lib/tursoStore";
import { nflPropsDate, validNflPropsDate } from "../../../lib/nflPlayerProps";
import { buildNflPendingGames } from "../../../lib/nflPendingGames";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get("date") || nflPropsDate();
  if (!validNflPropsDate(date)) return NextResponse.json({ ok: false, error: "Choose a valid game date." }, { status: 400 });
  try {
    return await withTursoReadCache(async () => {
      const [previews, slate] = await Promise.all([
        readTursoDatasetByDateKeys("NFL", "game_previews", [date]),
        readTursoDatasetByDateKeys("NFL", "daily_slate", [date]),
      ]);
      return NextResponse.json({ ok: true, date, plays: buildNflPendingGames(previews, slate, date) },
        { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=30" } });
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Pending NFL spreads and totals are temporarily unavailable." }, { status: 503 });
  }
}
