import { NextResponse } from "next/server";
import { readSportWorksheet } from "../../../lib/sportSheets";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function isoDate(value: unknown) {
  const text = String(value ?? "").trim();
  return text.match(/\d{4}-\d{2}-\d{2}/)?.[0] || text;
}

export async function GET() {
  const [props, propTracker, slate] = await Promise.all([
    readSportWorksheet("NFL", "prop_projections"),
    readSportWorksheet("NFL", "prop_tracker"),
    readSportWorksheet("NFL", "daily_slate"),
  ]);
  const today = "2026-09-14";
  const todayProps = props.filter((row) => isoDate(row.Date || row["Game Date"]) === today);
  const graded = todayProps.filter((row) => ["a prop", "b prop"].includes(String(row.Grade || "").trim().toLowerCase()));
  const todayTracked = propTracker.filter((row) => isoDate(row.Date || row["Game Date"]) === today);
  const todaySlate = slate.filter((row) => isoDate(row.Date || row["Game Date"]) === today);
  return NextResponse.json({
    propCount: props.length,
    todayPropCount: todayProps.length,
    gradedCount: graded.length,
    propTrackerCount: propTracker.length,
    todayTrackedCount: todayTracked.length,
    slateCount: slate.length,
    todaySlateCount: todaySlate.length,
    tracked: todayTracked.map((row) => ({Date: row.Date, Grade: row.Grade, GameID: row["Game ID"], Game: row.Game, Player: row.Player, Market: row.Market, Selection: row.Selection, Result: row.Result, keys: Object.keys(row)})),
    todaySlate: todaySlate.map((row) => ({Date: row.Date, GameID: row["Game ID"], Game: row.Game, Away: row["Away Team"], Home: row["Home Team"]})),
  });
}
