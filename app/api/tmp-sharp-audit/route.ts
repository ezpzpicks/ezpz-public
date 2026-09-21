import { NextResponse } from "next/server";
import { readSportWorksheet } from "../../../../lib/sportSheets";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Row = Record<string,string>;

function isoDate(value: unknown) {
  const raw=String(value||"").trim();
  const m=raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  if(m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d=new Date(raw);
  return Number.isFinite(d.getTime())?d.toISOString().slice(0,10):"";
}
function resultCode(value: unknown) {
  const v=String(value||"").trim().toUpperCase();
  if(["W","WIN","WON"].includes(v)) return "W";
  if(["L","LOSS","LOST"].includes(v)) return "L";
  if(["P","PUSH"].includes(v)) return "P";
  return "";
}
function oddsNum(value: unknown) {
  const m=String(value||"").replace(/−/g,"-").match(/[+-]?\d{3,4}/);
  const n=m?Number(m[0]):-110;
  return Number.isFinite(n)?n:-110;
}
function profitUnits(odds:number){return odds>0?odds/100:odds<0?100/Math.abs(odds):1}
function summary(rows: Row[]) {
  let w=0,l=0,p=0,u=0;
  for(const r of rows){
    const rc=resultCode(r.Result||r.Status);
    if(!rc) continue;
    if(rc==="W"){w++;u+=profitUnits(oddsNum(r["Public Split Odds"]||r.Odds||r["Odds/Line"]))}
    else if(rc==="L"){l++;u-=1}
    else p++;
  }
  const total=w+l+p,dec=w+l;
  return {record:`${w}-${l}-${p}`,bets:total,winPct:dec?Math.round(w/dec*1000)/10:0,units:Math.round(u*100)/100,roiPct:total?Math.round(u/total*1000)/10:0};
}

export async function GET() {
  const rows=await readSportWorksheet("NCAAF","all_game_trends");
  const start="2026-09-07", end="2026-09-20";
  const settled=rows.filter((r)=>{
    const d=isoDate(r.Date);
    return d>=start&&d<=end&&Boolean(resultCode(r.Result||r.Status));
  }).map((r)=>({
    ...r,
    _date:isoDate(r.Date),
    _bets:Number(r["Public Bets %"]||r["Current Public %"]),
    _money:Number(r["Public Money %"]||r["Current Sharp %"]),
  })).filter((r)=>Number.isFinite(r._bets)&&Number.isFinite(r._money));

  const thresholds=[15,20,25,30,35,40,45,50];
  const results=thresholds.map((threshold)=>{
    const q=settled.filter((r)=>r._money-r._bets>=threshold);
    const spread=q.filter((r)=>String(r.Market||"").toLowerCase().includes("spread"));
    const total=q.filter((r)=>String(r.Market||"").toLowerCase().includes("total"));
    return {threshold,overall:summary(q),spread:summary(spread),total:summary(total)};
  });

  const byWeek=[
    {label:"Week ending 2026-09-13",from:"2026-09-07",to:"2026-09-13"},
    {label:"Week ending 2026-09-20",from:"2026-09-14",to:"2026-09-20"},
  ].map((w)=>({
    ...w,
    thresholds:[20,25,30,35].map((threshold)=>{
      const q=settled.filter((r)=>r._date>=w.from&&r._date<=w.to&&r._money-r._bets>=threshold);
      return {threshold,...summary(q)};
    }),
  }));

  const examples=settled
    .filter((r)=>r._money-r._bets>=20)
    .sort((a,b)=>(b._money-b._bets)-(a._money-a._bets))
    .slice(0,80)
    .map((r)=>({
      date:r._date,game:r.Game,market:r.Market,selection:r.Selection||r.Side,
      bets:r._bets,money:r._money,diff:Math.round((r._money-r._bets)*10)/10,
      odds:r["Public Split Odds"]||r.Odds||r["Odds/Line"],result:r.Result
    }));

  return NextResponse.json({ok:true,start,end,settledRows:summary(settled),results,byWeek,examples});
}
