import { NextRequest, NextResponse } from "next/server";
import { GET as readSavedBoard } from "../../sport-public-data/route";
import { restoreFootballPublicDisplay } from "../../../../lib/footballPublicDisplay";
import { captureMatchupContext } from "../../../../lib/matchupContextStore";
import { trialDate } from "../../../../lib/selectionTrial";
import type { ContextSport } from "../../../../lib/matchupContext";
import { withTursoReadCache } from "../../../../lib/tursoStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Refresh reviews from saved inputs without waiting for another provider collection. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const sport = String(request.nextUrl.searchParams.get("sport") || "").toUpperCase();
  if (!["NFL", "NCAAF", "NBA", "NCAAM"].includes(sport)) {
    return NextResponse.json({ ok: false, error: "Choose a supported review sport." }, { status: 400 });
  }
  return withTursoReadCache(async () => {
    try {
      const date = trialDate(Date.now());
      // No incoming encoding/inspect parameters: the saved reader returns plain JSON.
      const response = await readSavedBoard(new NextRequest(new URL(`/api/sport-public-data?sport=${sport}&date=${date}`, request.url)));
      if (!response.ok) throw new Error("The saved market board is unavailable.");
      const data = restoreFootballPublicDisplay(await response.json());
      const market = sport === "NBA" ? data.nbaMarket : sport === "NCAAM" ? data.ncaamMarket : null;
      const board = market?.signals || data.footballSignals;
      const stale = response.headers.get("X-EZPZ-Board-Stale") === "true" || market?.stale === true || data.stale === true;
      if (!board || board.today !== date || !board.captureAvailable || stale) {
        return NextResponse.json({ ok: true, sport, skipped: true, reason: "Waiting for a current saved market board." });
      }
      const review = await captureMatchupContext(sport as ContextSport, board.sides,
        board.sides.filter((side: { selected: boolean }) => side.selected).map((side: { id: string }) => side.id));
      return NextResponse.json({ ok: true, sport, date, review }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      console.error("Saved-board matchup review refresh failed", { sport, error });
      return NextResponse.json({ ok: false, sport, error: "The saved-board review could not be refreshed." }, { status: 503 });
    }
  });
}
