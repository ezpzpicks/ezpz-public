import { NextResponse } from "next/server";
import { readSportWorksheet } from "../../../lib/sportSheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const rows = await readSportWorksheet("NFL","prop_projections");
  const atd = rows.filter((r:any)=>
    String(r.Date||"")==="2026-09-20" &&
    String(r.Market||"")==="Anytime TD"
  );
  const out = atd.filter((r:any)=>/Derrick Henry/i.test(String(r.Player||"")));
  const odds = atd.map((r:any)=>Number(r["Over Odds"])).filter((x:number)=>Number.isFinite(x));
  return NextResponse.json({
    ok:true,
    count:out.length,
    rows:out,
    atdCount:atd.length,
    negativeOddsCount:odds.filter((x:number)=>x<0).length,
    positiveOddsCount:odds.filter((x:number)=>x>0).length,
    negativeExamples:atd.filter((r:any)=>Number(r["Over Odds"])<0).slice(0,20).map((r:any)=>({player:r.Player,odds:r["Over Odds"],game:r.Game}))
  },{headers:{"Cache-Control":"no-store,max-age=0"}});
}
