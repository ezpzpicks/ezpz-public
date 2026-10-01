import { NextResponse } from "next/server";
import { readSportWorksheet } from "../../../../lib/sportSheets";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Row = Record<string,string>;
const text=(v:unknown)=>String(v??"").trim();

export async function GET(){
  const rows=await readSportWorksheet("NFL","prop_projections") as Row[];
  const rb=rows.filter(r=>text(r.Market)==="Receiving Yards"&&text(r.Position)==="RB");
  const gibbs=rb.filter(r=>/jahmyr\s+gibbs/i.test(text(r.Player)));
  const keys=[...new Set(rb.flatMap(r=>Object.keys(r)))].sort();
  const targetKeys=keys.filter(k=>/target|route|share|tprr|opportun|efficien|role|snap|recep|matchup|slot/i.test(k));
  const simplify=(r:Row)=>Object.fromEntries(Object.entries(r).filter(([k,v])=>targetKeys.includes(k)&&text(v)!==""));
  return NextResponse.json({count:rb.length,targetKeys,gibbs:gibbs.map(r=>({Date:r.Date,Player:r.Player,MarketLine:r["Market Line"],Projection:r.Projection,ModelVersion:r["Model Version"],...simplify(r)})),samples:rb.slice(0,5).map(simplify)});
}
