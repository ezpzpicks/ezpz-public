import { NextResponse } from "next/server";
import { readNcaafTotalForward } from "../../../lib/ncaafTotalForwardStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function GET() {
  try {
    return NextResponse.json(await readNcaafTotalForward(), { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } });
  } catch (error) {
    console.error("NCAAF total forward tracker read failed", error);
    return NextResponse.json({ ok: false, error: "Forward test records are temporarily unavailable." }, { status: 503 });
  }
}
