import { NextRequest, NextResponse } from "next/server";
import { readSportWorksheet } from "../../../lib/sportSheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

function textKey(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function rowText(row: Record<string, unknown>) {
  return textKey(
    `${row.Game || ""} ${row["Away Team"] || ""} ${row["Home Team"] || ""}`,
  );
}

export async function GET(request: NextRequest) {
  const date = String(request.nextUrl.searchParams.get("date") || "").trim();
  const terms = String(request.nextUrl.searchParams.get("q") || "")
    .split(",")
    .map(textKey)
    .filter(Boolean);

  const match = (row: Record<string, unknown>) => {
    const rowDate = String(row.Date || row["Game Date"] || "");
    if (date && !rowDate.includes(date)) return false;
    const haystack = rowText(row);
    return !terms.length || terms.every((term) => haystack.includes(term));
  };

  const [weekly, snapshots, slate, schedule] = await Promise.all([
    readSportWorksheet("NCAAF", "weekly_market_trends"),
    readSportWorksheet("NCAAF", "public_split_snapshots"),
    readSportWorksheet("NCAAF", "daily_slate"),
    readSportWorksheet("NCAAF", "schedule"),
  ]);

  return NextResponse.json({
    ok: true,
    query: { date, terms },
    weekly: weekly.filter(match),
    snapshots: snapshots.filter(match),
    slate: slate.filter(match),
    schedule: schedule.filter(match),
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
