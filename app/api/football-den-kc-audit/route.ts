import { NextResponse } from "next/server";
import { readSportWorksheet } from "../../../lib/sportSheets";

export async function GET() {
  const schedule = await readSportWorksheet("NFL", "schedule");
  const rows = schedule.filter((row) => {
    const away = String(row["Away Team"] || "").toUpperCase();
    const home = String(row["Home Team"] || "").toUpperCase();
    const date = String(row["Game Date"] || row.Date || "");
    return away === "DEN" && home === "KC" && date.includes("2026-09-14");
  });
  return NextResponse.json(rows.map((row) => ({
    gameDate: row["Game Date"] || row.Date || "",
    week: row.Week || "",
    away: row["Away Team"] || "",
    home: row["Home Team"] || "",
    awayScore: row["Away Score"] || "",
    homeScore: row["Home Score"] || "",
    gameId: row["Game ID"] || "",
    spreadLine: row["Spread Line"] || "",
    totalLine: row["Total Line"] || "",
  })));
}
