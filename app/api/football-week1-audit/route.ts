import { NextResponse } from "next/server";
import { readSportWorksheet } from "../../../lib/sportSheets";

type Row = Record<string, string>;

function isoDate(value: unknown) {
  const raw = String(value || "").trim();
  const iso = raw.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const us = raw.match(/(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?/);
  if (!us) return "";
  return `${us[3] || "2026"}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
}

function inWeek1(row: Row) {
  const date = isoDate(row.Date || row["Game Date"] || "");
  return date >= "2026-09-09" && date <= "2026-09-14";
}

function resultCode(value: unknown) {
  const key = String(value || "").trim().toUpperCase();
  if (["W", "WIN", "WON"].includes(key)) return "W";
  if (["L", "LOSS", "LOST"].includes(key)) return "L";
  if (["P", "PUSH"].includes(key)) return "P";
  return "";
}

function trackerView(row: Row) {
  return {
    date: isoDate(row.Date || row["Game Date"] || ""),
    week: row.Week || "",
    game: row.Game || row["Game Key"] || row["Game ID"] || "",
    betType: row["Bet Type"] || row.Market || "",
    selection: row.Selection || row.Pick || row.Side || "",
    oddsLine: row["Odds/Line"] || row.Odds || row["Pick Odds"] || "",
    grade: row.Grade || row["Model Grade"] || "",
    result: row.Result || row.Status || "",
    units: row.Units || "",
    projectedAway: row["Projected Away"] || "",
    projectedHome: row["Projected Home"] || "",
    actualAway: row["Actual Away"] || "",
    actualHome: row["Actual Home"] || "",
  };
}

function propView(row: Row) {
  return {
    date: isoDate(row.Date || row["Game Date"] || ""),
    game: row.Game || row["Game Key"] || "",
    player: row.Player || row["Player Name"] || "",
    market: row.Market || row["Bet Type"] || "",
    pick: row.Pick || row.Selection || row.Side || "",
    line: row["Market Line"] || row.Line || row["Prop Line"] || "",
    odds: row["Pick Odds"] || row.Odds || "",
    grade: row.Grade || row["Model Grade"] || "",
    result: row.Result || row.Status || "",
    units: row.Units || "",
  };
}

function slateView(row: Row) {
  const interesting = Object.entries(row).filter(([key, value]) =>
    String(value || "").trim() && /(date|week|game|team|best|model.*play|play.*model|grade|spread|total|projection|score|odds|line)/i.test(key)
  );
  return Object.fromEntries(interesting);
}

function hasPlayMarker(row: Row) {
  return Object.entries(row).some(([key, value]) => {
    const v = String(value || "").trim();
    if (!v) return false;
    return /(best|model.*play|play.*model|grade)/i.test(key) && !["FALSE", "NO", "0", "PASS"].includes(v.toUpperCase());
  });
}

export async function GET() {
  const [slate, tracker, props, propTracker, schedule] = await Promise.all([
    readSportWorksheet("NFL", "daily_slate"),
    readSportWorksheet("NFL", "bet_tracker"),
    readSportWorksheet("NFL", "prop_projections"),
    readSportWorksheet("NFL", "prop_tracker"),
    readSportWorksheet("NFL", "schedule"),
  ]);

  const slateWeek = slate.filter(inWeek1);
  const trackerWeek = tracker.filter(inWeek1);
  const propTrackerWeek = propTracker.filter(inWeek1);
  const gradedPropsWeek = props.filter(inWeek1).filter((row) => String(row.Grade || row["Model Grade"] || "").trim());
  const scheduleWeek = schedule.filter(inWeek1);
  const modelSlateRows = slateWeek.filter(hasPlayMarker);
  const lastNightGameRows = trackerWeek.filter((row) => /DEN|KC|Denver|Kansas City/i.test(String(row.Game || "")));

  const byDate = [...new Set(trackerWeek.map((row) => isoDate(row.Date || row["Game Date"] || "")))].filter(Boolean).sort().map((date) => {
    const rows = trackerWeek.filter((row) => isoDate(row.Date || row["Game Date"] || "") === date);
    return { date, total: rows.length, graded: rows.filter((row) => resultCode(row.Result || row.Status)).length, missingResult: rows.filter((row) => !resultCode(row.Result || row.Status)).length };
  });

  return NextResponse.json({
    counts: {
      dailySlateWeek: slateWeek.length,
      dailySlateRowsWithPlayMarker: modelSlateRows.length,
      gameTrackerWeek: trackerWeek.length,
      gameTrackerGraded: trackerWeek.filter((row) => resultCode(row.Result || row.Status)).length,
      gameTrackerMissingResult: trackerWeek.filter((row) => !resultCode(row.Result || row.Status)).length,
      propTrackerWeek: propTrackerWeek.length,
      propTrackerGraded: propTrackerWeek.filter((row) => resultCode(row.Result || row.Status)).length,
      propTrackerMissingResult: propTrackerWeek.filter((row) => !resultCode(row.Result || row.Status)).length,
      gradedPropProjectionRows: gradedPropsWeek.length,
      scheduleWeek: scheduleWeek.length,
    },
    byDate,
    lastNightGameTracker: lastNightGameRows.map(trackerView),
    gameTrackerWeek: trackerWeek.map(trackerView),
    propTrackerMissingResults: propTrackerWeek.filter((row) => !resultCode(row.Result || row.Status)).map(propView),
    dailySlatePlayRows: modelSlateRows.map(slateView),
    dailySlateKeys: [...new Set(slateWeek.flatMap((row) => Object.keys(row)))],
  });
}
