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
function typeKey(value: unknown) { return String(value || "").trim().toUpperCase().replace(/\s+/g, " "); }
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

const MLB_CURRENT_GREEN = new Set([
  "A MONEYLINE", "B MONEYLINE", "ELITE NRFI", "ELITE YRFI",
  "STRONG OVER", "OVER", "LEAN OVER", "STRONG UNDER", "UNDER", "LEAN UNDER",
]);
const MLB_K_TYPES = new Set(["STRONG OVER", "OVER", "LEAN OVER", "STRONG UNDER", "UNDER", "LEAN UNDER"]);
const K_COLUMNS = ["Away Pitcher K + Grade", "Home Pitcher K + Grade", "Away Bulk Pitcher K + Grade", "Home Bulk Pitcher K + Grade"];

type ExpectedMlb = { date: string; gameKey: string; game: string; type: string; selection: string; source: string };
function pitcherName(summary: string) {
  const beforeProjection = summary.match(/^(.+?)\s+-?\d+(?:\.\d+)?\s*\(/)?.[1];
  return String(beforeProjection || "").trim();
}
function kGrade(summary: string) { return typeKey(summary.match(/\(([^)]+)\)/)?.[1] || ""); }
function expectedMlbRows(slate: SheetRow[]) {
  const rows: ExpectedMlb[] = [];
  for (const row of slate) {
    const date = isoDate(row.Date || "");
    const gameKey = String(row["Game Key"] || row["Game ID"] || "").trim().replace(/\.0$/, "");
    const game = String(row["Game Label"] || row.Game || "").trim();
    if (!date || !gameKey) continue;
    const mlType = typeKey(row["ML Grade"]);
    if (mlType === "A MONEYLINE" || mlType === "B MONEYLINE") {
      rows.push({ date, gameKey, game, type: mlType, selection: String(row["Better ML"] || "").trim(), source: "ML Grade" });
    }
    const firstType = typeKey(row["NRFI Grade"]);
    if (firstType === "ELITE NRFI" || firstType === "ELITE YRFI") {
      rows.push({ date, gameKey, game, type: firstType, selection: game, source: "NRFI Grade" });
    }
    const totalType = typeKey(row["Total Runs Grade"]);
    if (totalType === "TOTAL OVER" || totalType === "TOTAL UNDER") {
      rows.push({ date, gameKey, game, type: totalType, selection: game, source: "Total Runs Grade" });
    }
    for (const column of K_COLUMNS) {
      const summary = String(row[column] || "").trim();
      if (!summary) continue;
      const grade = kGrade(summary);
      if (!MLB_K_TYPES.has(grade)) continue;
      const player = pitcherName(summary);
      rows.push({ date, gameKey, game, type: grade, selection: `${player} ${grade}`.trim(), source: column });
    }
  }
  return rows;
}
function mlbGroupKey(row: { date: string; gameKey: string; type: string }) { return `${row.date}|${row.gameKey}|${typeKey(row.type)}`; }
function trackerMlbShape(row: SheetRow) {
  return {
    date: isoDate(row.Date || row["Bet Date"] || ""),
    gameKey: String(row["Game Key"] || row["Game ID"] || "").trim().replace(/\.0$/, ""),
    type: typeKey(row["Bet Type"] || row.Market),
    selection: String(row.Selection || row.Pick || row.Play || "").trim(),
    result: String(row.Result || row.Status || "").trim(),
  };
}
function countMap<T>(rows: T[], keyFor: (row: T) => string) {
  const map = new Map<string, number>();
  for (const row of rows) { const key = keyFor(row); if (key) map.set(key, (map.get(key) || 0) + 1); }
  return map;
}
function countsBy(rows: SheetRow[], keyFn: (row: SheetRow) => string) {
  const map = new Map<string, number>();
  for (const row of rows) { const key = keyFn(row) || "(blank)"; map.set(key, (map.get(key) || 0) + 1); }
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
  const [cfbSlate, cfbTracker, mlbSlate, mlbTracker] = await Promise.all([
    readSportWorksheet("NCAAF", "daily_slate"), readSportWorksheet("NCAAF", "bet_tracker"),
    readWorksheet("daily_slate"), readWorksheet("bet_tracker"),
  ]);
  const expectedCfb = expectedCfbRows(cfbSlate);
  const cfbTrackerKeys = new Set(cfbTracker.map(trackerKey));
  const cfbMissing = expectedCfb.filter((row) => !cfbTrackerKeys.has(trackerKey(row)));

  const expectedMlb = expectedMlbRows(mlbSlate);
  const trackerMlb = mlbTracker.map(trackerMlbShape);
  const expectedCounts = countMap(expectedMlb, mlbGroupKey);
  const trackerCounts = countMap(trackerMlb, mlbGroupKey);
  const deficits = [...expectedCounts.entries()].flatMap(([key, expected]) => {
    const tracked = trackerCounts.get(key) || 0;
    if (tracked >= expected) return [];
    const sample = expectedMlb.find((r) => mlbGroupKey(r) === key)!;
    return [{ ...sample, expected, tracked, missing: expected - tracked }];
  }).sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type) || a.gameKey.localeCompare(b.gameKey));
  const since = "2026-09-01";
  const today = "2026-09-15";
  const recentDeficits = deficits.filter((r) => r.date >= since);
  const pastMlb = mlbTracker.filter((r) => { const d = isoDate(r.Date || r["Bet Date"] || ""); return d && d < today; });
  const pastCfb = cfbTracker.filter((r) => { const d = isoDate(r.Date || r["Game Date"] || ""); return d && d < today; });

  return NextResponse.json({
    cfb: { slateRows: cfbSlate.length, expectedQualifiedRows: expectedCfb.length, trackerRows: cfbTracker.length,
      missingTrackerRows: cfbMissing.length, missing: cfbMissing.slice(0, 50), pastTrackerRows: pastCfb.length,
      pastMissingResults: pastCfb.filter((r) => !resultCode(r.Result || r.Status)).length,
      byDateExpected: countsBy(expectedCfb, (r) => isoDate(r.Date)), byDateTracker: recentDateCounts(cfbTracker, "2026-08-20") },
    mlb: {
      slateRows: mlbSlate.length, trackerRows: mlbTracker.length, expectedRecognizedPlayRows: expectedMlb.length,
      sourceVsTrackerDeficitGroups: deficits.length, sourceVsTrackerMissingRows: deficits.reduce((n, r) => n + r.missing, 0),
      recentDeficitGroups: recentDeficits, allDeficitGroups: deficits.slice(0, 100),
      expectedByType: Object.fromEntries([...countMap(expectedMlb, (r) => r.type).entries()].sort()),
      trackerByType: countsBy(mlbTracker, (r) => typeKey(r["Bet Type"] || r.Market)),
      pastTrackerRows: pastMlb.length, pastMissingResults: pastMlb.filter((r) => !resultCode(r.Result || r.Status)).length,
      pastMissingResultRows: pastMlb.filter((r) => !resultCode(r.Result || r.Status)).map((r) => trackerMlbShape(r)),
      recentTrackerByDate: recentDateCounts(mlbTracker, since),
      currentGreenTypes: [...MLB_CURRENT_GREEN],
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
