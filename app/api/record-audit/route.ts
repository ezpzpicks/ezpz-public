import { NextRequest, NextResponse } from "next/server";
import {
  canonicalPublishedDirectTrendPicks,
  overlayPublishedDirectTrendRows,
} from "../../../lib/footballDirectTrendLedger";
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

function resultCode(value: unknown) {
  const key = String(value || "").trim().toUpperCase();
  if (["W", "WIN", "WON"].includes(key)) return "W";
  if (["L", "LOSS", "LOST"].includes(key)) return "L";
  if (["P", "PUSH"].includes(key)) return "P";
  return "";
}

function parseHistoryPick(row: Record<string, string>) {
  let details: Record<string, any> = {};
  try {
    const parsed = JSON.parse(String(row["Details JSON"] || "{}"));
    if (parsed && typeof parsed === "object") details = parsed;
  } catch {}
  return {
    ...details,
    date: String(row.Date || details.date || ""),
    game: String(row.Game || details.game || ""),
    market: String(row.Market || details.market || ""),
    selection: String(row.Selection || details.selection || ""),
    odds: String(row.Odds || details.odds || ""),
    source: String(row.Source || details.source || ""),
    snapshotStatus: String(row["Snapshot Status"] || details.snapshotStatus || ""),
    result: resultCode(row.Result || details.result),
    resultUpdated: String(row["Result Updated"] || details.resultUpdated || ""),
    savedAt: String(row["Saved At"] || ""),
  };
}

function signalNames(pick: Record<string, any>) {
  const key = textKey(`${pick.tier || ""} ${pick.trendTier || ""} ${pick.qualification || ""}`);
  return [
    key.includes("rlm") ? "RLM" : "",
    key.includes("public fade") ? "Public Fade" : "",
    key.includes("sharp") ? "Sharp" : "",
  ].filter(Boolean);
}

function compactPick(pick: Record<string, any>) {
  return {
    date: pick.date,
    game: pick.game,
    market: pick.market,
    selection: pick.selection,
    line: pick.line,
    odds: pick.odds,
    signals: signalNames(pick),
    snapshotStatus: pick.snapshotStatus,
    result: pick.result,
    updatedAt: pick.updatedAt,
    lockedAt: pick.lockedAt,
    savedAt: pick.savedAt,
  };
}

function summaryForSignal(picks: Record<string, any>[], signal: string, beforeDate: string) {
  const rows = picks
    .filter((pick) => signalNames(pick).includes(signal))
    .filter((pick) => resultCode(pick.result))
    .filter((pick) => !beforeDate || String(pick.date || "") < beforeDate)
    .sort((a, b) => {
      const byDate = String(b.date || "").localeCompare(String(a.date || ""));
      if (byDate) return byDate;
      const bTime = Date.parse(String(b.lockedAt || b.updatedAt || b.savedAt || "")) || 0;
      const aTime = Date.parse(String(a.lockedAt || a.updatedAt || a.savedAt || "")) || 0;
      return bTime - aTime;
    })
    .slice(0, 7);
  let wins = 0, losses = 0, pushes = 0;
  for (const row of rows) {
    const result = resultCode(row.result);
    if (result === "W") wins += 1;
    else if (result === "L") losses += 1;
    else if (result === "P") pushes += 1;
  }
  return {
    record: `${wins}-${losses}-${pushes}`,
    rows: rows.map(compactPick),
  };
}

export async function GET(request: NextRequest) {
  const requested = String(request.nextUrl.searchParams.get("sport") || "NCAAF").toUpperCase();
  const sport: FootballSport = requested === "NFL" ? "NFL" : "NCAAF";
  const query = textKey(request.nextUrl.searchParams.get("q") || "");
  const date = String(request.nextUrl.searchParams.get("date") || "").trim();
  const signal = String(request.nextUrl.searchParams.get("signal") || "RLM").trim();
  const beforeDate = String(request.nextUrl.searchParams.get("before") || "").trim();
  const [trends, history] = await Promise.all([
    readSportWorksheet(sport, "all_game_trends"),
    readSportWorksheet(sport, "ezpz_pick_history"),
  ]);
  const historyPicks = history.map(parseHistoryPick);
  const canonical = canonicalPublishedDirectTrendPicks(historyPicks);
  const overlaid = overlayPublishedDirectTrendRows(trends, historyPicks, sport);
  const matches = (row: Record<string, any>) => {
    if (date && String(row.Date || row.date || "") !== date) return false;
    if (!query) return true;
    return textKey([
      row.Game || row.game,
      row["Away Team"],
      row["Home Team"],
      row.Selection || row.selection,
      row.Side,
      row.Market || row.market,
      row["Pick Key"],
      row.qualification,
      row.tier,
    ].join(" ")).includes(query);
  };
  return NextResponse.json({
    sport,
    query,
    date,
    canonicalMatches: canonical.filter(matches).map(compactPick),
    overlayMatches: overlaid.filter(matches).map((row) => ({
      date: row.Date,
      game: row.Game,
      gameKey: row["Game Key"],
      market: row.Market,
      selection: row.Selection,
      side: row.Side,
      line: row["Public Split Line"] || row.Line,
      bets: row["Public Bets %"],
      money: row["Public Money %"],
      openingBets: row["Opening Public %"],
      publicMove: row["Public Change %"],
      lineBasis: row["Line Movement Basis"],
      lineMove: row["Line Movement Value"],
      trendTier: row["Trend Tier"],
      result: row.Result,
      resultSource: row["Result Source"],
    })),
    signalSummary: summaryForSignal(canonical, signal, beforeDate),
  }, { headers: { "Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex" } });
}
