import { NextResponse } from "next/server";
import { readWorksheet } from "../../../lib/mlbStore";
import { readSportWorksheet, type SheetRow } from "../../../lib/sportSheets";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function isoDate(value: unknown) {
  const raw = String(value || "").trim();
  const iso = raw.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const us = raw.match(/(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?/);
  if (!us) return "";
  return `${us[3] || "2026"}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
}

function textKey(value: unknown) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/−/g, "-").replace(/[^a-z0-9+-]+/g, " ").replace(/\s+/g, " ").trim();
}

function resultCode(value: unknown) {
  const key = String(value || "").trim().toUpperCase();
  if (["W", "WIN", "WON"].includes(key)) return "W";
  if (["L", "LOSS", "LOST"].includes(key)) return "L";
  if (["P", "PUSH"].includes(key)) return "P";
  return "";
}

function qualifiedFootballGrade(value: unknown) {
  const grade = textKey(value);
  return Boolean(grade) && !grade.includes("no play") && !grade.includes("non edge") &&
    grade !== "research" && grade !== "projection only" && grade !== "no market line";
}

function trackerKey(row: SheetRow) {
  return [isoDate(row.Date || row["Game Date"] || ""), String(row["Game ID"] || row["Game Key"] || "").trim(),
    textKey(row["Bet Type"] || row.Market), textKey(row.Selection || row.Pick)].join("|");
}

function expectedCfbRows(slate: SheetRow[]) {
  const out: SheetRow[] = [];
  for (const row of slate) {
    const date = isoDate(row.Date || row["Game Date"] || "");
    const id = String(row["Game ID"] || row["Game Key"] || "").trim();
    if (!date || !id) continue;
    const common = { Date: date, "Game ID": id, Game: String(row.Game || "") };
    const sg = String(row["Spread Grade"] || "").trim();
    const sp = String(row["Spread Pick"] || "").trim();
    if (sp && qualifiedFootballGrade(sg)) out.push({ ...common, "Bet Type": "Spread", Selection: sp, Grade: sg });
    const tg = String(row["Total Grade"] || "").trim();
    const tp = String(row["Total Pick"] || "").trim();
    if (tp && qualifiedFootballGrade(tg)) out.push({ ...common, "Bet Type": "Total", Selection: tp, Grade: tg });
  }
  return out;
}

function countsBy(rows: SheetRow[], keyFn: (row: SheetRow) => string) {
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = keyFn(row) || "(blank)";
    map.set(key, (map.get(key) || 0) + 1);
  }
  return Object.fromEntries([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

function recentDateCounts(rows: SheetRow[], since: string) {
  const dates = [...new Set(rows.map((r) => isoDate(r.Date || r["Game Date"] || "")).filter((d) => d && d >= since))].sort();
  return dates.map((date) => {
    const subset = rows.filter((r) => isoDate(r.Date || r["Game Date"] || "") === date);
    return { date, rows: subset.length, graded: subset.filter((r) => resultCode(r.Result || r.Status)).length,
      pending: subset.filter((r) => !resultCode(r.Result || r.Status)).length };
  });
}

export async function GET() {
  const [cfbSlate, cfbTracker, mlbSlate, mlbTracker, mlbTrends] = await Promise.all([
    readSportWorksheet("NCAAF", "daily_slate"),
    readSportWorksheet("NCAAF", "bet_tracker"),
    readWorksheet("daily_slate"),
    readWorksheet("bet_tracker"),
    readWorksheet("all_game_trends"),
  ]);

  const expectedCfb = expectedCfbRows(cfbSlate);
  const cfbTrackerKeys = new Set(cfbTracker.map(trackerKey));
  const cfbMissing = expectedCfb.filter((row) => !cfbTrackerKeys.has(trackerKey(row)));

  const mlbGradeColumns = [...new Set(mlbSlate.flatMap((r) => Object.keys(r)).filter((k) => /grade/i.test(k)))].sort();
  const mlbGradeDistributions = Object.fromEntries(mlbGradeColumns.map((column) => [column,
    countsBy(mlbSlate.filter((r) => String(r[column] || "").trim()), (r) => String(r[column] || "").trim())]));

  const today = "2026-09-15";
  const since = "2026-09-01";
  const completedPastMlb = mlbTracker.filter((r) => {
    const date = isoDate(r.Date || r["Bet Date"] || "");
    return date && date < today;
  });
  const completedPastCfb = cfbTracker.filter((r) => {
    const date = isoDate(r.Date || r["Game Date"] || "");
    return date && date < today;
  });

  return NextResponse.json({
    cfb: {
      slateRows: cfbSlate.length,
      expectedQualifiedRows: expectedCfb.length,
      trackerRows: cfbTracker.length,
      missingTrackerRows: cfbMissing.length,
      missing: cfbMissing.slice(0, 50),
      pastTrackerRows: completedPastCfb.length,
      pastMissingResults: completedPastCfb.filter((r) => !resultCode(r.Result || r.Status)).length,
      pastMissingResultRows: completedPastCfb.filter((r) => !resultCode(r.Result || r.Status)).slice(0, 50),
      byDateExpected: countsBy(expectedCfb, (r) => isoDate(r.Date)),
      byDateTracker: recentDateCounts(cfbTracker, "2026-08-20"),
    },
    mlb: {
      slateRows: mlbSlate.length,
      trackerRows: mlbTracker.length,
      trendRows: mlbTrends.length,
      pastTrackerRows: completedPastMlb.length,
      pastMissingResults: completedPastMlb.filter((r) => !resultCode(r.Result || r.Status)).length,
      pastMissingResultRows: completedPastMlb.filter((r) => !resultCode(r.Result || r.Status)).slice(0, 50).map((r) => ({
        date: isoDate(r.Date || r["Bet Date"] || ""), game: r.Game || r["Game Label"] || "", type: r["Bet Type"] || r.Market || "",
        selection: r.Selection || r.Pick || r.Play || "", result: r.Result || r.Status || "",
      })),
      trackerTypes: countsBy(mlbTracker, (r) => String(r["Bet Type"] || r.Market || "").trim()),
      recentTrackerByDate: recentDateCounts(mlbTracker, since),
      gradeColumns: mlbGradeColumns,
      gradeDistributions: mlbGradeDistributions,
      slateKeys: [...new Set(mlbSlate.flatMap((r) => Object.keys(r)))].sort(),
      trackerKeys: [...new Set(mlbTracker.flatMap((r) => Object.keys(r)))].sort(),
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
