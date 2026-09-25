import { NextResponse } from "next/server";
import { readSportWorksheet, type SheetRow } from "../../../../lib/sportSheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 120;

function num(value: unknown): number | null {
  const n = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}
function text(value: unknown) { return String(value ?? "").trim(); }
function truthy(value: unknown) {
  return ["1","true","yes","y","completed","final"].includes(text(value).toLowerCase());
}
function isoDate(value: unknown) {
  const raw = text(value);
  const m = raw.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;
  const us = raw.match(/(\d{1,2})\/(\d{1,2})\/(20\d{2})/);
  return us ? `${us[3]}-${us[1].padStart(2,"0")}-${us[2].padStart(2,"0")}` : "";
}
function key(row: SheetRow) {
  const id = text(row["Game ID"] || row["Game Key"]).replace(/\.0$/, "");
  if (id) return `id:${id}`;
  const date = isoDate(row.Date || row["Game Date"]);
  const away = text(row["Away Team"]).toLowerCase().replace(/[^a-z0-9]+/g,"");
  const home = text(row["Home Team"]).toLowerCase().replace(/[^a-z0-9]+/g,"");
  return `teams:${date}|${away}|${home}`;
}
function result(signPick: number, signActual: number) {
  if (Math.abs(signActual) < 1e-9) return "P";
  return signPick * signActual > 0 ? "W" : "L";
}

export async function GET() {
  const [slateRaw, scheduleRaw] = await Promise.all([
    readSportWorksheet("NCAAF", "daily_slate"),
    readSportWorksheet("NCAAF", "schedule"),
  ]);

  const schedule = scheduleRaw.filter((r) => text(r.Season || "2026") === "2026");
  const scheduleByKey = new Map<string, SheetRow>();
  for (const r of schedule) scheduleByKey.set(key(r), r);

  const slate2026 = slateRaw.filter((r) => text(r.Season || "2026") === "2026");
  const dedup = new Map<string, SheetRow>();
  const duplicateCounts = new Map<string, number>();
  for (const r of slate2026) {
    const k = key(r);
    duplicateCounts.set(k, (duplicateCounts.get(k) || 0) + 1);
    dedup.set(k, r);
  }

  const rows: any[] = [];
  let unmatched = 0;
  let incomplete = 0;

  for (const slate of dedup.values()) {
    const sched = scheduleByKey.get(key(slate));
    if (!sched) { unmatched += 1; continue; }
    const awayScore = num(sched["Away Score"]);
    const homeScore = num(sched["Home Score"]);
    const completed = truthy(sched.Completed) || (awayScore != null && homeScore != null);
    if (!completed || awayScore == null || homeScore == null) { incomplete += 1; continue; }

    const projectedMargin = num(slate["Projected Margin"]);
    const homeSpread = num(slate["Market Home Spread"]);
    const projectedTotal = num(slate["Projected Total"]);
    const marketTotal = num(slate["Market Total"]);
    const actualMargin = homeScore - awayScore;
    const actualTotal = homeScore + awayScore;

    let spreadEdge: number | null = null;
    let spreadResult = "";
    let spreadSide = "";
    let spreadAtsMargin: number | null = null;
    if (projectedMargin != null && homeSpread != null && Math.abs(projectedMargin + homeSpread) > 1e-9) {
      const modelCover = projectedMargin + homeSpread;
      const actualCover = actualMargin + homeSpread;
      spreadEdge = Math.abs(modelCover);
      spreadSide = modelCover > 0 ? "Home" : "Away";
      spreadResult = result(modelCover, actualCover);
      spreadAtsMargin = spreadSide === "Home" ? actualCover : -actualCover;
    }

    let totalEdge: number | null = null;
    let totalResult = "";
    let totalSide = "";
    let totalMargin: number | null = null;
    if (projectedTotal != null && marketTotal != null && Math.abs(projectedTotal - marketTotal) > 1e-9) {
      const modelDiff = projectedTotal - marketTotal;
      const actualDiff = actualTotal - marketTotal;
      totalEdge = Math.abs(modelDiff);
      totalSide = modelDiff > 0 ? "Over" : "Under";
      totalResult = result(modelDiff, actualDiff);
      totalMargin = totalSide === "Over" ? actualDiff : -actualDiff;
    }

    const awayClass = text(sched["Away Classification"]).toLowerCase();
    const homeClass = text(sched["Home Classification"]).toLowerCase();
    rows.push({
      date: isoDate(slate.Date || sched["Game Date"]),
      week: text(slate.Week || sched.Week),
      gameId: text(slate["Game ID"] || sched["Game ID"]).replace(/\.0$/, ""),
      game: text(slate.Game) || `${text(sched["Away Team"])} @ ${text(sched["Home Team"])}`,
      awayTeam: text(sched["Away Team"]),
      homeTeam: text(sched["Home Team"]),
      awayClass,
      homeClass,
      fbsOnly: awayClass === "fbs" && homeClass === "fbs",
      hasFcs: awayClass === "fcs" || homeClass === "fcs",
      projectedMargin,
      homeSpread,
      spreadEdge,
      spreadSide,
      spreadResult,
      spreadAtsMargin,
      projectedTotal,
      marketTotal,
      totalEdge,
      totalSide,
      totalResult,
      totalMargin,
      awayScore,
      homeScore,
      modelVersion: text(slate["Model Version"]),
      absMarketSpread: homeSpread == null ? null : Math.abs(homeSpread),
      spread20Plus: homeSpread == null ? false : Math.abs(homeSpread) >= 20,
    });
  }

  rows.sort((a,b) => a.date.localeCompare(b.date) || Number(a.week || 0)-Number(b.week || 0) || a.game.localeCompare(b.game));
  return NextResponse.json({
    ok: true,
    counts: {
      slateRaw: slateRaw.length,
      slate2026: slate2026.length,
      uniqueSlate2026: dedup.size,
      duplicateKeys: [...duplicateCounts.values()].filter((n) => n > 1).length,
      schedule2026: schedule.length,
      matchedCompleted: rows.length,
      unmatched,
      incomplete,
    },
    weeks: [...new Set(rows.map((r) => r.week))].sort((a,b) => Number(a)-Number(b)),
    dates: [...new Set(rows.map((r) => r.date))].sort(),
    rows,
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
