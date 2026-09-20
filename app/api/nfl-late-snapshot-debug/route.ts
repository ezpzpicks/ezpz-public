import { NextResponse } from "next/server";
import { readSportWorksheet } from "../../../lib/sportSheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function toMinutes(value: unknown) {
  const raw=String(value||"");
  const m=raw.match(/(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)/i);
  if(!m) return null;
  let h=Number(m[1])%12; if(m[4].toUpperCase()==="PM") h+=12;
  return h*60+Number(m[2])+Number(m[3])/60;
}

export async function GET() {
  const rows=await readSportWorksheet("NFL","odds_snapshot");
  const games=new Set([
    "LV Raiders @ LA Chargers",
    "JAX Jaguars @ DEN Broncos",
    "SEA Seahawks @ ARI Cardinals",
    "WAS Commanders @ DAL Cowboys",
    "MIA Dolphins @ SF 49ers",
  ]);
  const out=rows.filter((r:any)=>{
    if(String(r.Date||"")!=="2026-09-20") return false;
    if(!games.has(String(r.Game||""))) return false;
    const mins=toMinutes(r["Snapshot Time ET"]);
    return mins!=null && mins>=15*60+45 && mins<=16*60+30;
  }).map((r:any)=>({
    snapshot:r["Snapshot Time ET"], game:r.Game, gameTime:r["Game Time"], market:r.Market,
    selection:r.Selection, side:r.Side, line:r.Line, odds:r.Odds,
    bets:r["Bets %"], handle:r["Handle %"], gap:r["Public Gap %"],
    signature:r["State Signature"]
  }));
  return NextResponse.json({ok:true,count:out.length,rows:out},{headers:{"Cache-Control":"no-store, max-age=0"}});
}
