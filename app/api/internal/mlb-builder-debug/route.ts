import { NextRequest, NextResponse } from "next/server";
import { readTursoDataset } from "../../../../../lib/tursoStore";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const gameKey = String(request.nextUrl.searchParams.get("gameKey") || "").trim().replace(/\.0$/, "");
  if (!gameKey) {
    return NextResponse.json({ ok: false, error: "gameKey is required" }, { status: 400 });
  }
  const rows = await readTursoDataset("MLB", "matchup_details_today");
  const match = [...rows].reverse().find((row) => String(row["Game Key"] || "").trim().replace(/\.0$/, "") === gameKey);
  return NextResponse.json(
    { ok: Boolean(match), gameKey, row: match || null },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
