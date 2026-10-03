import { NextRequest, NextResponse } from "next/server";
import { readSportWorksheet, type FootballSport } from "../../../lib/sportSheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function textKey(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function GET(request: NextRequest) {
  const requested = String(request.nextUrl.searchParams.get("sport") || "NCAAF").toUpperCase();
  const sport: FootballSport = requested === "NFL" ? "NFL" : "NCAAF";
  const query = textKey(request.nextUrl.searchParams.get("q") || "");
  const date = String(request.nextUrl.searchParams.get("date") || "").trim();
  const [trends, history] = await Promise.all([
    readSportWorksheet(sport, "all_game_trends"),
    readSportWorksheet(sport, "ezpz_pick_history"),
  ]);
  const matches = (row: Record<string, string>) => {
    if (date && String(row.Date || row.date || "") !== date) return false;
    if (!query) return true;
    return textKey([
      row.Game,
      row["Away Team"],
      row["Home Team"],
      row.Selection,
      row.Side,
      row.Market,
      row["Pick Key"],
      row["Details JSON"],
    ].join(" ")).includes(query);
  };
  return NextResponse.json({
    sport,
    query,
    date,
    trends: trends.filter(matches),
    ezpzHistory: history.filter(matches),
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
