import { NextRequest, NextResponse } from "next/server";
import { ALL_GAME_TRENDS_HEADERS, PUBLIC_SPLIT_HEADERS } from "../../../lib/footballPublicData";
import { readSportWorksheet, type FootballSport } from "../../../lib/sportSheets";

function code(value: unknown) {
  const text = String(value || "").trim().toUpperCase();
  if (["W", "WIN", "WON"].includes(text)) return "W";
  if (["L", "LOSS", "LOST"].includes(text)) return "L";
  if (["P", "PUSH"].includes(text)) return "P";
  return "";
}
function truthy(value: unknown) { return ["TRUE", "YES", "1"].includes(String(value || "").trim().toUpperCase()); }
function detail(row: Record<string, string>) {
  const raw = String(row["Trend Score Details"] || "").trim();
  let parsed: any = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch {}
  return {
    date: row.Date, gameKey: row["Game Key"], game: row.Game, away: row["Away Team"], home: row["Home Team"],
    market: row.Market, selection: row.Selection, side: row.Side, line: row["Public Split Line"] || row.Line,
    trendPlay: row["Trend Play"], tier: row["Trend Tier"], score: row["Trend Score"], result: row.Result,
    publicBets: row["Public Bets %"], publicMoney: row["Public Money %"], splitTime: row["Public Split Snapshot Time"],
    detailsLength: raw.length, snapshotStatus: parsed?.snapshotStatus || "", gradingVersion: parsed?.gradingVersion || "",
    frozenAt: parsed?.frozenAt || "", parsedTier: parsed?.tier || "", parsedScore: parsed?.score ?? "",
    trendSampleSize: parsed?.TrendSampleSize ?? row["Trend Sample Size"] ?? "",
    historySource: parsed?.HistorySource || row["History Source"] || "",
    fallbackReason: parsed?.FallbackReason || row["Fallback Reason"] || "",
    resultSource: row["Result Source"] || "",
    resultFallbackReason: row["Result Fallback Reason"] || "",
    resultMatchKey: row["Result Match Key"] || "",
  };
}

export async function GET(request: NextRequest) {
  const requested = String(request.nextUrl.searchParams.get("sport") || "NCAAF").toUpperCase();
  const sport: FootballSport = requested === "NFL" ? "NFL" : "NCAAF";
  const [trends, tracker, schedule, snapshots] = await Promise.all([
    readSportWorksheet(sport, "all_game_trends", ALL_GAME_TRENDS_HEADERS),
    readSportWorksheet(sport, "bet_tracker"), readSportWorksheet(sport, "schedule"),
    readSportWorksheet(sport, "public_split_snapshots", PUBLIC_SPLIT_HEADERS),
  ]);
  const completedTrends = trends.filter((row) => code(row.Result));
  const qualified = trends.filter((row) => truthy(row["Trend Play"]) && String(row["Trend Tier"] || "").trim() && String(row["Trend Tier"] || "").toUpperCase() !== "PASS");
  const frozen = trends.filter((row) => { const raw=String(row["Trend Score Details"]||"").trim(); if(!raw)return false; try{return JSON.parse(raw)?.snapshotStatus==="FINAL_PREGAME";}catch{return false;} });
  const byDate=[...new Set(trends.map((row)=>String(row.Date||"").trim()).filter(Boolean))].sort().map((date)=>{const rows=trends.filter((row)=>String(row.Date||"").trim()===date);const q=rows.filter((row)=>truthy(row["Trend Play"])&&String(row["Trend Tier"]||"").trim()&&String(row["Trend Tier"]||"").toUpperCase()!=="PASS");return{date,rows:rows.length,qualified:q.length,completed:rows.filter((row)=>code(row.Result)).length,qualifiedCompleted:q.filter((row)=>code(row.Result)).length};});
  return NextResponse.json({
    sport,
    totals:{trendRows:trends.length,completedTrendRows:completedTrends.length,qualifiedTrendRows:qualified.length,qualifiedCompletedTrendRows:qualified.filter((row)=>code(row.Result)).length,pendingQualifiedTrendRows:qualified.filter((row)=>!code(row.Result)).length,frozenTrendRows:frozen.length,rowsWithTrendDetails:trends.filter((r)=>String(r["Trend Score Details"]||"").trim()).length,trackerRows:tracker.length,completedTrackerRows:tracker.filter((row)=>code(row.Result||row.Status)).length,scheduleRows:schedule.length,completedScheduleRows:schedule.filter((row)=>truthy(row.Completed)||(String(row["Away Score"]??"")!==""&&String(row["Home Score"]??"")!=="")).length,snapshotRows:snapshots.length},
    byDate:byDate.slice(-14),
    trendRows:trends.slice(0,40).map(detail),
    snapshots:snapshots.slice(-20).map((row)=>({date:row.Date,game:row.Game,market:row.Market,selection:row.Selection,line:row.Line,odds:row.Odds,snapshotTime:row["Snapshot Time ET"],openingTime:row["Opening Snapshot Time ET"]})),
  });
}
