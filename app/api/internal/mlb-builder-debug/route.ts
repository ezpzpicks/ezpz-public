import { NextRequest, NextResponse } from "next/server";
import { readTursoDataset } from "../../../../lib/tursoStore";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function normalizedGameKey(row: Record<string, string>) {
  return String(row["Game Key"] || row["Game ID"] || "").trim().replace(/\.0$/, "");
}

export async function GET(request: NextRequest) {
  const gameKey = String(request.nextUrl.searchParams.get("gameKey") || "").trim().replace(/\.0$/, "");
  if (!gameKey) {
    return NextResponse.json({ ok: false, error: "gameKey is required" }, { status: 400 });
  }

  const datasets = [
    "matchup_details_today",
    "game_projection_history",
    "daily_slate",
    "bet_tracker",
    "builder_completed",
  ] as const;
  const result: Record<string, Record<string, string>[]> = {};

  await Promise.all(datasets.map(async (dataset) => {
    const rows = await readTursoDataset("MLB", dataset);
    result[dataset] = rows.filter((row) => normalizedGameKey(row) === gameKey);
  }));

  return NextResponse.json(
    { ok: true, gameKey, datasets: result },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
