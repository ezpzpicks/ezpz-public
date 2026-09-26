import { NextResponse } from "next/server";
import { readSportWorksheet } from "../../../lib/sportSheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

function match(row: Record<string, unknown>) {
  const date = String(row.Date || row["Game Date"] || "");
  return date.includes("2026-09-26") && /missouri state|smu/i.test(
    String(row.Game || "") + " " + String(row["Away Team"] || "") + " " + String(row["Home Team"] || "")
  );
}

export async function GET() {
  const [weekly, snapshots, slate, schedule] = await Promise.all([
    readSportWorksheet("NCAAF", "weekly_market_trends"),
    readSportWorksheet("NCAAF", "public_split_snapshots"),
    readSportWorksheet("NCAAF", "daily_slate"),
    readSportWorksheet("NCAAF", "schedule"),
  ]);
  return NextResponse.json({
    ok: true,
    weekly: weekly.filter(match),
    snapshots: snapshots.filter(match),
    slate: slate.filter(match),
    schedule: schedule.filter(match),
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
