import { NextRequest, NextResponse } from "next/server";
import { readTursoDataset } from "../../../../lib/tursoStore";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function normalizedGameKey(row: Record<string, string>) {
  return String(row["Game Key"] || row["Game ID"] || "").trim().replace(/\.0$/, "");
}

function recentRows(rows: Record<string, string>[], limit = 12) {
  return rows.slice(Math.max(0, rows.length - limit));
}

export async function GET(request: NextRequest) {
  const gameKey = String(request.nextUrl.searchParams.get("gameKey") || "").trim().replace(/\.0$/, "");

  const datasets = [
    "matchup_details_today",
    "game_projection_history",
    "daily_slate",
    "bet_tracker",
    "all_game_trends",
    "pitcher_recent_form",
    "builder_completed",
  ] as const;
  const result: Record<string, Record<string, string>[]> = {};

  await Promise.all(datasets.map(async (dataset) => {
    const rows = await readTursoDataset("MLB", dataset);
    result[dataset] = gameKey
      ? rows.filter((row) => normalizedGameKey(row) === gameKey)
      : recentRows(rows);
  }));

  return NextResponse.json(
    { ok: true, gameKey: gameKey || null, mode: gameKey ? "game" : "recent", datasets: result },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
