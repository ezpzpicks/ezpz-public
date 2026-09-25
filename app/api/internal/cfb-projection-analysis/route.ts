import { NextRequest, NextResponse } from "next/server";
import { readSportWorksheet } from "../../../../lib/sportSheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

type Row = Record<string, string>;
type Result = "W" | "L" | "P";

function text(value: unknown) {
  return String(value ?? "").trim();
}
function key(value: unknown) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
function isoDate(value: unknown) {
  const raw = text(value);
  const iso = raw.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const us = raw.match(/(\d{1,2})\/(\d{1,2})\/(20\d{2})/);
  if (!us) return "";
  return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
}
function num(value: unknown): number | null {
  const raw = text(value).replace(/[−–—]/g, "-").replace(/,/g, "");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
function truthy(value: unknown) {
  return ["TRUE", "YES", "1", "Y"].includes(text(value).toUpperCase());
}
function cleanGameId(value: unknown) {
  return text(value).replace(/\.0$/, "");
}
function gameKey(row: Row) {
  const id = cleanGameId(row["Game ID"] || row["Game Key"]);
  if (id) return `id:${id}`;
  const date = isoDate(row.Date || row["Game Date"]);
  return `teams:${date}|${key(row["Away Team"])}|${key(row["Home Team"])}`;
}
function scheduleCompleted(row: Row) {
  return truthy(row.Completed) || (text(row["Away Score"]) !== "" && text(row["Home Score"]) !== "");
}
const FBS_CONFERENCES = new Set([
  "acc", "atlantic coast", "atlantic coast conference",
  "american", "aac", "american athletic", "american athletic conference",
  "big 12", "big 12 conference", "big ten", "big ten conference",
  "conference usa", "c usa", "cusa",
  "mid american", "mid american conference", "mac",
  "mountain west", "mountain west conference", "mwc",
  "pac 12", "pac 12 conference", "pac12",
  "sec", "southeastern", "southeastern conference",
  "sun belt", "sun belt conference",
  "fbs independents", "independent", "independents",
]);
function classification(row: Row): "FBS_ONLY" | "FCS_OR_NON_FBS" {
  const awayClass = key(row["Away Classification"]);
  const homeClass = key(row["Home Classification"]);
  const awayConference = key(row["Away Conference"]);
  const homeConference = key(row["Home Conference"]);
  const explicitFcs = [awayClass, homeClass].some((value) =>
    value.includes("fcs") || value.includes("non fbs")
  );
  if (explicitFcs) return "FCS_OR_NON_FBS";
  const conferencesKnown = Boolean(awayConference && homeConference);
  if (conferencesKnown && (!FBS_CONFERENCES.has(awayConference) || !FBS_CONFERENCES.has(homeConference))) {
    return "FCS_OR_NON_FBS";
  }
  return awayClass === "fbs" && homeClass === "fbs" ? "FBS_ONLY" : "FCS_OR_NON_FBS";
}
function gradeSpread(actualMargin: number, homeSpread: number, side: "HOME" | "AWAY"): Result {
  const homeCover = actualMargin + homeSpread;
  const signed = side === "HOME" ? homeCover : -homeCover;
  return Math.abs(signed) < 1e-9 ? "P" : signed > 0 ? "W" : "L";
}
function gradeTotal(actualTotal: number, line: number, side: "OVER" | "UNDER"): Result {
  const diff = actualTotal - line;
  if (Math.abs(diff) < 1e-9) return "P";
  return side === "OVER" ? (diff > 0 ? "W" : "L") : (diff < 0 ? "W" : "L");
}

type Play = {
  date: string;
  week: string;
  gameId: string;
  game: string;
  away: string;
  home: string;
  classGroup: "FBS_ONLY" | "FCS_OR_NON_FBS";
  modelVersion: string;
  edge: number;
  result: Result;
  side: string;
  line: number;
  projection: number;
  actual: number;
};

const BINS = [
  { label: "15+", min: 15, max: Infinity },
  { label: "10-14.99", min: 10, max: 15 },
  { label: "7.5-9.99", min: 7.5, max: 10 },
  { label: "5-7.49", min: 5, max: 7.5 },
  { label: "2.5-4.99", min: 2.5, max: 5 },
  { label: "0-2.49", min: 0, max: 2.5 },
];
const THRESHOLDS = [15, 10, 7.5, 5, 2.5, 0];

function record(rows: Play[]) {
  const wins = rows.filter((r) => r.result === "W").length;
  const losses = rows.filter((r) => r.result === "L").length;
  const pushes = rows.filter((r) => r.result === "P").length;
  const decisions = wins + losses;
  return {
    record: `${wins}-${losses}-${pushes}`,
    wins,
    losses,
    pushes,
    plays: rows.length,
    decisions,
    winPct: decisions ? Math.round((wins / decisions) * 1000) / 10 : 0,
  };
}
function buckets(rows: Play[]) {
  return BINS.map((bin) => ({
    bucket: bin.label,
    ...record(rows.filter((r) => r.edge >= bin.min && r.edge < bin.max)),
  }));
}
function cumulative(rows: Play[]) {
  return THRESHOLDS.map((threshold) => ({
    threshold: threshold === 0 ? "Any edge" : `>=${threshold}`,
    ...record(rows.filter((r) => r.edge >= threshold)),
  }));
}
function summarize(rows: Play[]) {
  return {
    all: { ...record(rows), buckets: buckets(rows), cumulative: cumulative(rows) },
    fbsOnly: {
      ...record(rows.filter((r) => r.classGroup === "FBS_ONLY")),
      buckets: buckets(rows.filter((r) => r.classGroup === "FBS_ONLY")),
      cumulative: cumulative(rows.filter((r) => r.classGroup === "FBS_ONLY")),
    },
    fcsOrNonFbs: {
      ...record(rows.filter((r) => r.classGroup === "FCS_OR_NON_FBS")),
      buckets: buckets(rows.filter((r) => r.classGroup === "FCS_OR_NON_FBS")),
      cumulative: cumulative(rows.filter((r) => r.classGroup === "FCS_OR_NON_FBS")),
    },
  };
}

export async function GET(request: NextRequest) {
  const from = isoDate(request.nextUrl.searchParams.get("from")) || "2026-08-01";
  const to = isoDate(request.nextUrl.searchParams.get("to")) || "2026-09-24";

  const [slate, schedule] = await Promise.all([
    readSportWorksheet("NCAAF", "daily_slate"),
    readSportWorksheet("NCAAF", "schedule"),
  ]);

  const scheduleById = new Map<string, Row>();
  const scheduleByTeams = new Map<string, Row>();
  for (const row of schedule) {
    const date = isoDate(row["Game Date"] || row.Date);
    if (!date || date < from || date > to || !scheduleCompleted(row)) continue;
    const id = cleanGameId(row["Game ID"] || row["Game Key"]);
    if (id) scheduleById.set(id, row);
    scheduleByTeams.set(`${date}|${key(row["Away Team"])}|${key(row["Home Team"])}`, row);
  }

  const uniqueSlate = new Map<string, Row>();
  for (const row of slate) {
    const date = isoDate(row.Date || row["Game Date"]);
    if (!date || date < from || date > to) continue;
    uniqueSlate.set(gameKey(row), row);
  }

  const spread: Play[] = [];
  const total: Play[] = [];
  let matched = 0;
  let unmatched = 0;
  let missingSpreadData = 0;
  let missingTotalData = 0;

  for (const row of uniqueSlate.values()) {
    const date = isoDate(row.Date || row["Game Date"]);
    const id = cleanGameId(row["Game ID"] || row["Game Key"]);
    const sched = (id && scheduleById.get(id)) ||
      scheduleByTeams.get(`${date}|${key(row["Away Team"])}|${key(row["Home Team"])}`);
    if (!sched) {
      unmatched += 1;
      continue;
    }
    const awayScore = num(sched["Away Score"]);
    const homeScore = num(sched["Home Score"]);
    if (awayScore == null || homeScore == null) {
      unmatched += 1;
      continue;
    }
    matched += 1;
    const classGroup = classification(sched);
    const base = {
      date,
      week: text(row.Week || sched.Week),
      gameId: id || cleanGameId(sched["Game ID"] || sched["Game Key"]),
      game: text(row.Game) || `${text(row["Away Team"])} @ ${text(row["Home Team"])}`,
      away: text(row["Away Team"]),
      home: text(row["Home Team"]),
      classGroup,
      modelVersion: text(row["Model Version"]),
    };

    const projectedMargin = num(row["Projected Margin"]);
    const homeSpread = num(row["Market Home Spread"] ?? row["Home Spread"] ?? row["Opening Home Spread"]);
    if (projectedMargin != null && homeSpread != null) {
      const marketMargin = -homeSpread;
      const diff = projectedMargin - marketMargin;
      if (Math.abs(diff) > 1e-9) {
        const side: "HOME" | "AWAY" = diff > 0 ? "HOME" : "AWAY";
        const actualMargin = homeScore - awayScore;
        spread.push({
          ...base,
          edge: Math.abs(diff),
          result: gradeSpread(actualMargin, homeSpread, side),
          side: side === "HOME" ? text(row["Home Team"]) : text(row["Away Team"]),
          line: side === "HOME" ? homeSpread : -homeSpread,
          projection: projectedMargin,
          actual: actualMargin,
        });
      }
    } else {
      missingSpreadData += 1;
    }

    const projectedTotal = num(row["Projected Total"]);
    const marketTotal = num(row["Market Total"] ?? row.Total ?? row["Opening Total"]);
    if (projectedTotal != null && marketTotal != null) {
      const diff = projectedTotal - marketTotal;
      if (Math.abs(diff) > 1e-9) {
        const side: "OVER" | "UNDER" = diff > 0 ? "OVER" : "UNDER";
        const actualTotal = awayScore + homeScore;
        total.push({
          ...base,
          edge: Math.abs(diff),
          result: gradeTotal(actualTotal, marketTotal, side),
          side,
          line: marketTotal,
          projection: projectedTotal,
          actual: actualTotal,
        });
      }
    } else {
      missingTotalData += 1;
    }
  }

  const byDate = [...new Set([...spread, ...total].map((r) => r.date))].sort().map((date) => ({
    date,
    spread: record(spread.filter((r) => r.date === date)),
    total: record(total.filter((r) => r.date === date)),
  }));

  const topSpreadEdges = [...spread].sort((a, b) => b.edge - a.edge).slice(0, 30);
  const topTotalEdges = [...total].sort((a, b) => b.edge - a.edge).slice(0, 30);

  return NextResponse.json({
    ok: true,
    sport: "NCAAF",
    from,
    to,
    source: "Turso daily_slate joined to completed schedule by Game ID/teams",
    counts: {
      dailySlateRows: slate.length,
      scheduleRows: schedule.length,
      uniqueSlateRowsInRange: uniqueSlate.size,
      matchedCompletedGames: matched,
      unmatchedSlateRows: unmatched,
      missingSpreadData,
      missingTotalData,
      spreadPlays: spread.length,
      totalPlays: total.length,
    },
    spread: summarize(spread),
    total: summarize(total),
    byDate,
    topSpreadEdges,
    topTotalEdges,
  });
}
