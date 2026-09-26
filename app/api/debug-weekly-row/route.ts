import { NextResponse } from "next/server";
import { readSportWorksheet } from "../../../lib/sportSheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

function match(row: Record<string, unknown>) {
  return /missouri state|smu/i.test(
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
  const clean = (row: Record<string, unknown>) => ({
    Date: row.Date,
    Game: row.Game,
    GameTime: row["Game Time"] || row["Game Date"] || row.Time,
    GameId: row["Game ID"] || row["Game Key"],
    Away: row["Away Team"],
    Home: row["Home Team"],
    Market: row.Market,
    Selection: row.Selection,
    Side: row.Side,
    Line: row.Line,
    Odds: row.Odds,
    SpreadOdds: row["Spread Odds"],
    TotalOdds: row["Total Odds"],
    OpeningOdds: row["Opening Odds"],
    OpeningBets: row["Opening Bets %"],
    CurrentBets: row["Current Bets %"],
    SnapshotStatus: row["Snapshot Status"],
    UpdatedAt: row["Updated At"] || row["Snapshot Time ET"],
  });
  return NextResponse.json({
    ok: true,
    weekly: weekly.filter(match).map(clean),
    snapshots: snapshots.filter(match).map(clean),
    slate: slate.filter(match).map(clean),
    schedule: schedule.filter(match).map(clean),
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
