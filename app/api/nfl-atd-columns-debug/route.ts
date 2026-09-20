import { NextResponse } from "next/server";
import { readSportWorksheet } from "../../../lib/sportSheets";
export const runtime="nodejs"; export const dynamic="force-dynamic"; export const revalidate=0;
export async function GET(){
 const rows=await readSportWorksheet("NFL","prop_projections");
 const atd=rows.filter((r:any)=>String(r.Date||"")==="2026-09-20"&&String(r.Market||"")==="Anytime TD");
 return NextResponse.json({ok:true,count:atd.length,rows:atd},{headers:{"Cache-Control":"no-store,max-age=0"}});
}