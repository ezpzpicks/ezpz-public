import { NextRequest, NextResponse } from "next/server";
import { MCP_SPORTS, normalizeMcpPick, type McpSport } from "../../../lib/ezpzMcpPicks";
import { getApprovedManualPicks, manualPickForMcp, MANUAL_EZPZ_EFFECTIVE_DATE } from "../../../lib/manualEzpzPicks";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const headers = { "Cache-Control": "no-store, max-age=0" };

export async function GET(request: NextRequest) {
  const sportValue = String(request.nextUrl.searchParams.get("sport") || "MLB").trim().toUpperCase();
  if (!MCP_SPORTS.includes(sportValue as McpSport)) {
    return NextResponse.json({ ok: false, error: "Unsupported sport.", supportedSports: MCP_SPORTS },
      { status: 400, headers });
  }
  if (request.nextUrl.searchParams.has("prime") || request.nextUrl.searchParams.has("refresh")) {
    return NextResponse.json({ ok: false, error: "Official EZPZ Picks cannot be generated from model or signal snapshots." },
      { status: 400, headers });
  }
  const sport = sportValue as McpSport, date = String(request.nextUrl.searchParams.get("date") || "");
  if (date && !/^20\d{2}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ ok: false, error: "Invalid game date." }, { status: 400, headers });
  }
  const now = Date.now();
  const picks = getApprovedManualPicks(sport, date || undefined, now).map(row => ({
    ...row, ...normalizeMcpPick(sport, manualPickForMcp(row), now),
  }));
  return NextResponse.json({
    ok: true, sport, date: date || null, generatedAt: new Date(now).toISOString(),
    effectiveDate: MANUAL_EZPZ_EFFECTIVE_DATE,
    selectionPolicy: "manually-approved-only",
    source: "reviewed-manual-approval-ledger",
    supportedSports: MCP_SPORTS,
    pickCount: picks.length,
    picks,
  }, { headers });
}
