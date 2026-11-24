import { NextRequest, NextResponse } from "next/server";
import { readSavedSlate, slateDate } from "../../../lib/slateHistory";
import { verifiedNflDisplayFinals } from "../../../lib/slateDisplayFinals";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
/** Read-only Full Slate display lookup. No settlement, model builds, or persistence. */
export async function GET(request: NextRequest) {
  const sport = request.nextUrl.searchParams.get("sport"), date = request.nextUrl.searchParams.get("date") || "";
  if (sport !== "NFL" || !date || slateDate(date) !== date) return NextResponse.json({ok:false,finals:[]},{status:400});
  try {
    const saved = await readSavedSlate("NFL", date);
    const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${date.replace(/-/g, "")}&limit=1000`;
    const response = await fetch(url, {headers:{Accept:"application/json"},cache:"no-store",signal:AbortSignal.timeout(8000)});
    if (!response.ok) throw new Error("Final source unavailable");
    const finals = verifiedNflDisplayFinals(saved.slateToday, date, await response.json());
    return NextResponse.json({ok:true,sport,date,finals},{headers:{"Cache-Control":"public, s-maxage=300, stale-while-revalidate=600"}});
  } catch {
    return NextResponse.json({ok:false,sport,date,finals:[]},{status:503,headers:{"Cache-Control":"no-store"}});
  }
}
