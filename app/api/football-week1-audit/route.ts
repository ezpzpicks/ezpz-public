import { NextResponse } from "next/server";
import { readSportWorksheet } from "../../../lib/sportSheets";

function isoDate(value: unknown) {
  const raw = String(value || "").trim();
  const iso = raw.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const us = raw.match(/(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?/);
  if (!us) return "";
  const year = us[3] || "2026";
  return `${year}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
}

function inWeek1(row: Record<string, string>) {
  const date = isoDate(row.Date || row["Game Date"] || "");
  return date >= "2026-09-09" && date <= "2026-09-14";
}

function compact(row: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!String(value || "").trim()) continue;
    if (/(date|game|best|play|grade|spread|total|model|project|score|team|result|odds|line|pick|market|week)/i.test(key)) out[key] = value;
  }
  return out;
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
  const propsWeek = props.filter(inWeek1);
  const propTrackerWeek = propTracker.filter(inWeek1);
  const scheduleWeek = schedule.filter(inWeek1);

  return NextResponse.json({
    counts: {
      slate: slateWeek.length,
      tracker: trackerWeek.length,
      props: propsWeek.length,
      propTracker: propTrackerWeek.length,
      schedule: scheduleWeek.length,
    },
    dailySlateKeys: [...new Set(slateWeek.flatMap((row) => Object.keys(row)))],
    dailySlate: slateWeek.map(compact),
    betTracker: trackerWeek,
    propTracker: propTrackerWeek,
    gradedPropProjections: propsWeek.filter((row) => String(row.Grade || row["Model Grade"] || "").trim()).map(compact),
    schedule: scheduleWeek.map(compact),
  });
}
