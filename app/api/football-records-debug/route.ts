import { NextRequest, NextResponse } from "next/server";
import { ALL_GAME_TRENDS_HEADERS } from "../../../lib/footballPublicData";
import { readSportWorksheet, type FootballSport } from "../../../lib/sportSheets";

function code(value: unknown) {
  const text = String(value || "").trim().toUpperCase();
  if (["W", "WIN", "WON"].includes(text)) return "W";
  if (["L", "LOSS", "LOST"].includes(text)) return "L";
  if (["P", "PUSH"].includes(text)) return "P";
  return "";
}

function truthy(value: unknown) {
  return ["TRUE", "YES", "1"].includes(String(value || "").trim().toUpperCase());
}

export async function GET(request: NextRequest) {
  const requested = String(request.nextUrl.searchParams.get("sport") || "NCAAF").toUpperCase();
  const sport: FootballSport = requested === "NFL" ? "NFL" : "NCAAF";
  const [trends, tracker, schedule] = await Promise.all([
    readSportWorksheet(sport, "all_game_trends", ALL_GAME_TRENDS_HEADERS),
    readSportWorksheet(sport, "bet_tracker"),
    readSportWorksheet(sport, "schedule"),
  ]);
  const completedTrends = trends.filter((row) => code(row.Result));
  const qualified = trends.filter((row) => truthy(row["Trend Play"]) && String(row["Trend Tier"] || "").trim() && String(row["Trend Tier"] || "").toUpperCase() !== "PASS");
  const qualifiedCompleted = qualified.filter((row) => code(row.Result));
  const pendingQualified = qualified.filter((row) => !code(row.Result));
  const frozen = trends.filter((row) => {
    const raw = String(row["Trend Score Details"] || "").trim();
    if (!raw) return false;
    try { return JSON.parse(raw)?.snapshotStatus === "FINAL_PREGAME"; } catch { return false; }
  });
  const byDate = [...new Set(trends.map((row) => String(row.Date || "").trim()).filter(Boolean))].sort().map((date) => {
    const rows = trends.filter((row) => String(row.Date || "").trim() === date);
    const q = rows.filter((row) => truthy(row["Trend Play"]) && String(row["Trend Tier"] || "").trim() && String(row["Trend Tier"] || "").toUpperCase() !== "PASS");
    return { date, rows: rows.length, qualified: q.length, completed: rows.filter((row) => code(row.Result)).length, qualifiedCompleted: q.filter((row) => code(row.Result)).length };
  });
  return NextResponse.json({
    sport,
    totals: {
      trendRows: trends.length,
      completedTrendRows: completedTrends.length,
      qualifiedTrendRows: qualified.length,
      qualifiedCompletedTrendRows: qualifiedCompleted.length,
      pendingQualifiedTrendRows: pendingQualified.length,
      frozenTrendRows: frozen.length,
      trackerRows: tracker.length,
      completedTrackerRows: tracker.filter((row) => code(row.Result || row.Status)).length,
      scheduleRows: schedule.length,
      completedScheduleRows: schedule.filter((row) => truthy(row.Completed) || (String(row["Away Score"] ?? "") !== "" && String(row["Home Score"] ?? "") !== "")).length,
    },
    byDate: byDate.slice(-14),
    pendingQualified: pendingQualified.slice(0, 20).map((row) => ({
      date: row.Date,
      gameKey: row["Game Key"],
      game: row.Game,
      away: row["Away Team"],
      home: row["Home Team"],
      market: row.Market,
      selection: row.Selection,
      side: row.Side,
      line: row["Public Split Line"] || row.Line,
      tier: row["Trend Tier"],
      result: row.Result,
      snapshot: (() => { try { return JSON.parse(String(row["Trend Score Details"] || "{}"))?.snapshotStatus || ""; } catch { return "invalid"; } })(),
    })),
  });
}
