import { NextResponse } from "next/server";
import { readSportWorksheet } from "../../../lib/sportSheets";
export const runtime="nodejs"; export const dynamic="force-dynamic"; export const revalidate=0;
export async function GET(){
 const rows=await readSportWorksheet("NFL","prop_projections");
 const atd=rows.filter((r:any)=>String(r.Date||"")==="2026-09-20"&&String(r.Market||"")==="Anytime TD");
 const sample=atd.slice(0,3);
 return NextResponse.json({ok:true,count:atd.length,keys:Array.from(new Set(atd.flatMap((r:any)=>Object.keys(r)))),sample},{headers:{"Cache-Control":"no-store,max-age=0"}});
}