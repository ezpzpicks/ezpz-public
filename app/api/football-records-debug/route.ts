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
function textKey(value: unknown) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
function isoDate(value: unknown) {
  const raw = String(value || "").trim();
  const iso = raw.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const us = raw.match(/(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?/);
  if (!us) return "";
  const year = us[3] || String(new Date().getFullYear());
  return `${year}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
}
function nflGrade(row: Record<string, string>) {
  const raw = String(row.Grade || row["Model Grade"] || row["Bet Type"] || row.Tier || "").trim().toUpperCase();
  if (raw === "A" || raw.startsWith("A ")) return "A";
  if (raw === "B" || raw.startsWith("B ")) return "B";
  return "";
}
function propIdentity(row: Record<string, string>) {
  const game = String(row["Game ID"] || row["Game Key"] || row.Game || "").trim();
  const player = textKey(row.Player || row["Player Name"] || "");
  const market = textKey(row.Market || row["Bet Type"] || "");
  return [game, player, market].join("|");
}
function numeric(value: unknown) {
  const n = Number(String(value ?? "").replace(/%/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}
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
  const debugDate = String(request.nextUrl.searchParams.get("date") || "").trim();
  const worksheetNames = sport === "NFL"
    ? ["all_game_trends", "bet_tracker", "schedule", "public_split_snapshots", "prop_projections", "prop_tracker"] as const
    : ["all_game_trends", "bet_tracker", "schedule", "public_split_snapshots"] as const;
  const worksheetRows = await Promise.all(worksheetNames.map((name) => readSportWorksheet(sport, name)));
  const trends = worksheetRows[0];
  const tracker = worksheetRows[1];
  const schedule = worksheetRows[2];
  const snapshots = worksheetRows[3];
  const propProjections = sport === "NFL" ? worksheetRows[4] : [];
  const propTracker = sport === "NFL" ? worksheetRows[5] : [];

  const completedTrends = trends.filter((row) => code(row.Result));
  const qualified = trends.filter((row) => truthy(row["Trend Play"]) && String(row["Trend Tier"] || "").trim() && String(row["Trend Tier"] || "").toUpperCase() !== "PASS");
  const frozen = trends.filter((row) => { const raw=String(row["Trend Score Details"]||"").trim(); if(!raw)return false; try{return JSON.parse(raw)?.snapshotStatus==="FINAL_PREGAME";}catch{return false;} });
  const byDate=[...new Set(trends.map((row)=>String(row.Date||"").trim()).filter(Boolean))].sort().map((date)=>{const rows=trends.filter((row)=>String(row.Date||"").trim()===date);const q=rows.filter((row)=>truthy(row["Trend Play"])&&String(row["Trend Tier"]||"").trim()&&String(row["Trend Tier"]||"").toUpperCase()!=="PASS");return{date,rows:rows.length,qualified:q.length,completed:rows.filter((row)=>code(row.Result)).length,qualifiedCompleted:q.filter((row)=>code(row.Result)).length};});

  let propDiagnostics: any = undefined;
  if (sport === "NFL") {
    const targetDate = debugDate || [...new Set(propProjections.map((row) => isoDate(row.Date || row["Game Date"])).filter(Boolean))].sort().at(-1) || "";
    const dated = propProjections.filter((row) => isoDate(row.Date || row["Game Date"]) === targetDate);
    const graded = dated.filter((row) => Boolean(nflGrade(row)));
    const identityCounts = new Map<string, number>();
    for (const row of graded) {
      const key = propIdentity(row);
      identityCounts.set(key, (identityCounts.get(key) || 0) + 1);
    }
    const byVersion: Record<string, number> = {};
    const byGrade: Record<string, number> = {};
    const byGame: Record<string, { total: number; graded: number }> = {};
    const byMarket: Record<string, { total: number; graded: number; A: number; B: number }> = {};
    const byLineSource: Record<string, { total: number; graded: number }> = {};
    const byPosition: Record<string, { total: number; graded: number }> = {};
    for (const row of dated) {
      const version = String(row["Model Version"] || "(blank)").trim() || "(blank)";
      byVersion[version] = (byVersion[version] || 0) + 1;
      const grade = nflGrade(row) || "ungraded";
      byGrade[grade] = (byGrade[grade] || 0) + 1;
      const game = String(row.Game || row["Game ID"] || "(blank)").trim() || "(blank)";
      byGame[game] ||= { total: 0, graded: 0 };
      byGame[game].total += 1;
      if (nflGrade(row)) byGame[game].graded += 1;
      const market = String(row.Market || "(blank)").trim() || "(blank)";
      byMarket[market] ||= { total: 0, graded: 0, A: 0, B: 0 };
      byMarket[market].total += 1;
      if (nflGrade(row)) {
        byMarket[market].graded += 1;
        byMarket[market][nflGrade(row) as "A" | "B"] += 1;
      }
      const lineSource = String(row["Line Source"] || "(blank)").trim() || "(blank)";
      byLineSource[lineSource] ||= { total: 0, graded: 0 };
      byLineSource[lineSource].total += 1;
      if (nflGrade(row)) byLineSource[lineSource].graded += 1;
      const position = String(row.Position || "(blank)").trim() || "(blank)";
      byPosition[position] ||= { total: 0, graded: 0 };
      byPosition[position].total += 1;
      if (nflGrade(row)) byPosition[position].graded += 1;
    }
    const duplicateIdentities = [...identityCounts.entries()]
      .filter(([, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([key, count]) => ({ key, count }));
    const strongestGraded = [...graded]
      .sort((a, b) => numeric(b["Probability Edge"]) - numeric(a["Probability Edge"]))
      .slice(0, 30)
      .map((row) => ({
        game: row.Game,
        player: row.Player,
        position: row.Position,
        slot: row.Slot,
        market: row.Market,
        pick: row.Pick,
        marketLine: row["Market Line"],
        pickOdds: row["Pick Odds"],
        modelProbability: row["Model Probability"],
        impliedProbability: row["Implied Probability"],
        probabilityEdge: row["Probability Edge"],
        projection: row.Projection,
        projectionEdge: row["Projection Edge"],
        grade: row.Grade,
        reliability: row.Reliability,
        roleConfidence: row["Role Confidence"],
        lineSource: row["Line Source"],
      }));
    propDiagnostics = {
      targetDate,
      totalProjectionRows: propProjections.length,
      datedProjectionRows: dated.length,
      gradedProjectionRows: graded.length,
      uniqueGradedProjectionIdentities: identityCounts.size,
      duplicateExtraRows: graded.length - identityCounts.size,
      duplicateIdentities,
      byVersion,
      byGrade,
      byGame,
      byMarket,
      byLineSource,
      byPosition,
      strongestGraded,
      propTrackerRows: propTracker.length,
    };
  }

  return NextResponse.json({
    sport,
    totals:{trendRows:trends.length,completedTrendRows:completedTrends.length,qualifiedTrendRows:qualified.length,qualifiedCompletedTrendRows:qualified.filter((row)=>code(row.Result)).length,pendingQualifiedTrendRows:qualified.filter((row)=>!code(row.Result)).length,frozenTrendRows:frozen.length,rowsWithTrendDetails:trends.filter((r)=>String(r["Trend Score Details"]||"").trim()).length,trackerRows:tracker.length,completedTrackerRows:tracker.filter((row)=>code(row.Result||row.Status)).length,scheduleRows:schedule.length,completedScheduleRows:schedule.filter((row)=>truthy(row.Completed)||(String(row["Away Score"]??"")!==""&&String(row["Home Score"]??"")!=="")).length,snapshotRows:snapshots.length},
    byDate:byDate.slice(-14),
    propDiagnostics,
    trendRows:trends.slice(0,40).map(detail),
    snapshots:snapshots.slice(-20).map((row)=>({date:row.Date,game:row.Game,market:row.Market,selection:row.Selection,line:row.Line,odds:row.Odds,snapshotTime:row["Snapshot Time ET"],openingTime:row["Opening Snapshot Time ET"]})),
  });
}
