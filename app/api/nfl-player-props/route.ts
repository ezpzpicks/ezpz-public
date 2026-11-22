import { NextRequest, NextResponse } from "next/server";
import { readTursoDatasetByDateKeys, withTursoReadCache } from "../../../lib/tursoStore";
import { buildNflPlayerProps, nflPropsDate, validNflPropsDate } from "../../../lib/nflPlayerProps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get("date") || nflPropsDate();
  if (!validNflPropsDate(date)) return NextResponse.json({ ok: false, error: "Choose a valid game date." }, { status: 400 });
  try {
    return await withTursoReadCache(async () => {
      const [locked, previews, slate] = await Promise.all([
        readTursoDatasetByDateKeys("NFL", "prop_projections", [date]),
        readTursoDatasetByDateKeys("NFL", "prop_previews", [date]),
        readTursoDatasetByDateKeys("NFL", "daily_slate", [date]),
      ]);
      const props = buildNflPlayerProps(locked, previews, date, slate);
      return NextResponse.json({ ok: true, date, props }, { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=30" } });
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Saved NFL player props are temporarily unavailable." }, { status: 503 });
  }
}
