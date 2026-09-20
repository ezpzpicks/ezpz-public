import { NextResponse } from "next/server";
import { readSportWorksheet } from "../../../lib/sportSheets";
export const runtime="nodejs"; export const dynamic="force-dynamic"; export const revalidate=0;
export async function GET(){
 const rows=await readSportWorksheet("NFL","prop_projections");
 const out=rows.filter((r:any)=>String(r.Date||"")==="2026-09-20"&&String(r.Market||"")==="Anytime TD"&&/MarShawn Lloyd/i.test(String(r.Player||"")));
 return NextResponse.json({ok:true,count:out.length,rows:out},{headers:{"Cache-Control":"no-store,max-age=0"}});
}