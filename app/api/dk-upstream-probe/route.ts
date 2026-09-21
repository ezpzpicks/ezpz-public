import { NextRequest, NextResponse } from "next/server";
import { DK_BETTING_SPLITS_URL, fetchDraftKingsBettingSplitsHtml } from "../../../lib/draftKingsBettingSplits";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (process.env.VERCEL_ENV === "production") return NextResponse.json({ error: "Preview only" }, { status: 404 });
  const sport = request.nextUrl.searchParams.get("sport") === "NCAAF" ? "NCAA Football" : "NFL";
  const html = await fetchDraftKingsBettingSplitsHtml({ tb_eg: sport, itm_content: sport, tb_edate: "n30days" });
  return NextResponse.json({
    sport,
    source: DK_BETTING_SPLITS_URL,
    html,
  }, { headers: { "Cache-Control": "no-store" } });
}
