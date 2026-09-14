import { NextResponse } from "next/server";
import { readSportWorksheet } from "../../../lib/sportSheets";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function isoDate(value: unknown) {
  const text = String(value ?? "").trim();
  const match = text.match(/\d{4}-\d{2}-\d{2}/);
  return match?.[0] || text;
}

export async function GET() {
  const [props, slate] = await Promise.all([
    readSportWorksheet("NFL", "prop_projections"),
    readSportWorksheet("NFL", "daily_slate"),
  ]);
  const today = "2026-09-14";
  const todayProps = props.filter((row) => isoDate(row.Date || row["Game Date"]) === today);
  const graded = todayProps.filter((row) => ["a prop", "b prop"].includes(String(row.Grade || "").trim().toLowerCase()));
  const todaySlate = slate.filter((row) => isoDate(row.Date || row["Game Date"]) === today);
  const sample = graded.slice(0, 20).map((row) => ({
    Date: row.Date,
    GameDate: row["Game Date"],
    Grade: row.Grade,
    GameID: row["Game ID"],
    GameKey: row["Game Key"],
    Game: row.Game,
    Team: row.Team,
    Opponent: row.Opponent,
    Player: row.Player,
    Market: row.Market,
    PropType: row["Prop Type"],
    Line: row.Line,
    keys: Object.keys(row),
  }));
  return NextResponse.json({
    propCount: props.length,
    todayPropCount: todayProps.length,
    gradedCount: graded.length,
    slateCount: slate.length,
    todaySlateCount: todaySlate.length,
    todaySlate: todaySlate.map((row) => ({ Date: row.Date, GameID: row["Game ID"], Game: row.Game, Away: row["Away Team"], Home: row["Home Team"] })),
    sample,
  });
}
