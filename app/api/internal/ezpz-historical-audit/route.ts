import { NextResponse } from "next/server";
import { readTursoDataset } from "../../../../lib/tursoStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function text(value: unknown) {
  return String(value ?? "").trim();
}
function isoDate(value: unknown) {
  const raw = text(value);
  const iso = raw.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const us = raw.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  return "";
}
function slim(row: Record<string, unknown>) {
  let details: Record<string, unknown> = {};
  try { details = JSON.parse(text(row["Details JSON"]) || "{}"); } catch {}
  return {
    date: isoDate(row.Date || details.date),
    candidateId: text(row["Candidate ID"] || details.candidateId),
    gameKey: text(row["Game Key"] || details.gameKey),
    gameTime: text(row["Game Time"] || details.gameTime),
    game: text(row.Game || details.game),
    awayTeam: text(row["Away Team"] || details.awayTeam),
    homeTeam: text(row["Home Team"] || details.homeTeam),
    market: text(row.Market || details.market),
    play: text(row.Play || details.play),
    selection: text(row.Selection || details.selection),
    line: text(row.Line || details.line),
    odds: text(row.Odds || details.odds),
    selected: text(row.Selected || details.selected),
    result: text(row.Result || details.result),
    units: text(row.Units || details.units),
    snapshotStatus: text(row["Snapshot Status"] || details.snapshotStatus),
    protectionStatus: text(row["Protection Status"] || details.protectionStatus),
    actualAwayRuns: text(row["Actual Away Runs"]),
    actualHomeRuns: text(row["Actual Home Runs"]),
    actualTotal: text(row["Actual Total"]),
  };
}

export async function GET() {
  const dates = new Set(["2026-09-08", "2026-09-12"]);
  const [selectorRows, trendRows, trackerRows] = await Promise.all([
    readTursoDataset("MLB", "ai_pick_selector"),
    readTursoDataset("MLB", "all_game_trends"),
    readTursoDataset("MLB", "bet_tracker"),
  ]);
  const selector = selectorRows.map(slim).filter((row) => dates.has(row.date));
  const trends = trendRows.map(slim).filter((row) => dates.has(row.date));
  const tracker = trackerRows.map(slim).filter((row) => dates.has(row.date));
  return NextResponse.json({
    ok: true,
    counts: { selector: selector.length, trends: trends.length, tracker: tracker.length },
    selector,
    trends,
    tracker,
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
