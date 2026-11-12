import { NextRequest, NextResponse } from "next/server";
import { EZPZ_RESULT_SPORTS, readSavedEzpzResults } from "../../../lib/ezpzSavedResults";
import { getApprovedManualPicks, MANUAL_EZPZ_EFFECTIVE_DATE } from "../../../lib/manualEzpzPicks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const headers = { "Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex" };

export async function GET(request: NextRequest) {
  const sport = String(request.nextUrl.searchParams.get("sport") || "").trim().toUpperCase();
  const date = String(request.nextUrl.searchParams.get("date") || "").trim();
  if (!EZPZ_RESULT_SPORTS.includes(sport as typeof EZPZ_RESULT_SPORTS[number])) {
    return NextResponse.json({ ok: false, error: "Unsupported sport.", supportedSports: EZPZ_RESULT_SPORTS }, { status: 400, headers });
  }
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T12:00:00Z`))
    || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) {
    return NextResponse.json({ ok: false, error: "A valid YYYY-MM-DD game date is required." }, { status: 400, headers });
  }
  try {
    // Official records after the manual-only migration are drawn exclusively
    // from approved rows. Legacy automatic selections remain readable on
    // pre-migration dates without being promoted into the new record.
    const manualPolicy = date >= MANUAL_EZPZ_EFFECTIVE_DATE;
    const picks = manualPolicy
      ? getApprovedManualPicks(sport as typeof EZPZ_RESULT_SPORTS[number], date).map(pick => ({
          ...pick, pickCategory: "manual", pickLabel: "EZPZ PICK",
          result: pick.result || "PENDING", units: pick.netUnits ?? null,
          finalizedAt: pick.approvedAt, snapshotStatus: "FINAL_PREGAME",
        }))
      : await readSavedEzpzResults(sport as typeof EZPZ_RESULT_SPORTS[number], date);
    return NextResponse.json({ ok: true, sport, date, timezone: "America/New_York",
      generatedAt: new Date().toISOString(), source: date >= MANUAL_EZPZ_EFFECTIVE_DATE ? "reviewed-manual-approval-ledger" : "legacy-saved-result-ledgers",
      selectionPolicy: date >= MANUAL_EZPZ_EFFECTIVE_DATE ? "manually-approved-only" : "historical-automatic",
      supportedSports: EZPZ_RESULT_SPORTS,
      pickCount: picks.length, picks }, { headers });
  } catch (error) {
    console.error("EZPZ saved results read failed", error);
    return NextResponse.json({ ok: false, sport, date, error: "Saved results are unavailable; do not treat this as zero picks." }, { status: 503, headers });
  }
}
