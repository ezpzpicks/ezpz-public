import { NextResponse } from "next/server";
import { readSportWorksheet } from "../../../../../lib/sportSheets";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Row = Record<string,string>;
type Hist = {date:string, away:string, home:string, awayPts:number, homePts:number};
type Slate = {date:string, away:string, home:string, oldTotal:number, oldAway:number, oldHome:number, marketTotal:number|null, actualTotal:number};

const t=(v:unknown)=>String(v??"").trim();
const n=(v:unknown)=>{const x=Number(t(v));return Number.isFinite(x)?x:null};
const k=(s:string)=>s.toUpperCase().replace(/[^A-Z0-9]/g,"");
const d=(s:string)=>t(s).slice(0,10);
const mean=(a:number[])=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
const mae=(a:number[])=>mean(a.map(Math.abs));
const rmse=(a:number[])=>a.length?Math.sqrt(a.reduce((s,x)=>s+x*x,0)/a.length):null;
const rnd=(x:number|null,p=3)=>x==null?null:Number(x.toFixed(p));

function schedKey(date:string,away:string,home:string){return `${date}|${k(away)}|${k(home)}`}

function buildRatings(games:Hist[], cutoff:string){
  const prior=games.filter(g=>g.date<cutoff).sort((a,b)=>a.date.localeCompare(b.date));
  const pointRows:{date:string,team:string,opp:string,pts:number,home:boolean}[]=[];
  for(const g of prior){
    pointRows.push({date:g.date,team:g.away,opp:g.home,pts:g.awayPts,home:false});
    pointRows.push({date:g.date,team:g.home,opp:g.away,pts:g.homePts,home:true});
  }
  const base=mean(pointRows.map(x=>x.pts))??27;
  let off=new Map<string,number>(), def=new Map<string,number>();
  const targetMs=new Date(cutoff+"T12:00:00Z").getTime();
  const wt=(date:string)=>Math.pow(0.5, Math.max(0,(targetMs-new Date(date+"T12:00:00Z").getTime())/86400000)/28);
  const homeAdj=1.5;

  for(let iter=0;iter<12;iter++){
    const offVals=new Map<string,{s:number,w:number,c:number}>();
    for(const r of pointRows){
      const w=wt(r.date), loc=r.home?homeAdj:-homeAdj;
      const oppDef=def.get(k(r.opp))??0;
      const val=r.pts-(base-oppDef+loc);
      const z=offVals.get(k(r.team))??{s:0,w:0,c:0}; z.s+=w*val; z.w+=w; z.c++; offVals.set(k(r.team),z);
    }
    const noff=new Map<string,number>();
    for(const [team,z] of offVals){const shrink=z.c/(z.c+2);noff.set(team,shrink*(z.s/Math.max(z.w,1e-9)));}

    const defVals=new Map<string,{s:number,w:number,c:number}>();
    for(const r of pointRows){
      const w=wt(r.date), loc=r.home?homeAdj:-homeAdj;
      const teamOff=noff.get(k(r.team))??0;
      const val=(base+teamOff+loc)-r.pts; // positive = suppresses scoring
      const z=defVals.get(k(r.opp))??{s:0,w:0,c:0}; z.s+=w*val; z.w+=w; z.c++; defVals.set(k(r.opp),z);
    }
    const ndef=new Map<string,number>();
    for(const [team,z] of defVals){const shrink=z.c/(z.c+2);ndef.set(team,shrink*(z.s/Math.max(z.w,1e-9)));}
    off=noff; def=ndef;
  }
  return {base,off,def,homeAdj,priorCount:prior.length};
}

export async function GET(){
  const [slateRows,schedRows]=await Promise.all([
    readSportWorksheet("NCAAF","daily_slate") as Promise<Row[]>,
    readSportWorksheet("NCAAF","schedule") as Promise<Row[]>
  ]);

  const actual=new Map<string,{away:number,home:number}>();
  const hist:Hist[]=[];
  for(const r of schedRows){
    const date=d(r["Game Date"]), away=t(r["Away Team"]), home=t(r["Home Team"]);
    const ap=n(r["Away Score"]), hp=n(r["Home Score"]);
    if(!date||!away||!home||ap==null||hp==null||(ap===0&&hp===0)) continue;
    actual.set(schedKey(date,away,home),{away:ap,home:hp});
    hist.push({date,away,home,awayPts:ap,homePts:hp});
  }

  const targets:Slate[]=[];
  const seen=new Set<string>();
  for(const r of slateRows){
    const date=d(r.Date);
    if(date!=="2026-10-02"&&date!=="2026-10-03") continue;
    const away=t(r["Away Team"]), home=t(r["Home Team"]);
    const key=schedKey(date,away,home); if(seen.has(key)) continue; seen.add(key);
    const a=actual.get(key); if(!a) continue;
    const oldTotal=n(r["Projected Total"]), oldAway=n(r["Projected Away"]), oldHome=n(r["Projected Home"]);
    if(oldTotal==null||oldAway==null||oldHome==null) continue;
    targets.push({date,away,home,oldTotal,oldAway,oldHome,marketTotal:n(r["Market Total"]),actualTotal:a.away+a.home});
  }

  const rows=targets.map(g=>{
    const rr=buildRatings(hist,g.date);
    const awayOff=rr.off.get(k(g.away))??0, homeOff=rr.off.get(k(g.home))??0;
    const awayDef=rr.def.get(k(g.away))??0, homeDef=rr.def.get(k(g.home))??0;
    const newAway=rr.base+awayOff-homeDef-rr.homeAdj;
    const newHome=rr.base+homeOff-awayDef+rr.homeAdj;
    const rawTotal=newAway+newHome;

    // Preserve the existing model's pace/personnel/weather layer by applying only the
    // schedule-quality mismatch correction implied by the residual model.
    const neutralOld=((g.oldAway+g.oldHome) || g.oldTotal);
    const correction=rawTotal-(2*rr.base);
    const hybridTotal=neutralOld+correction;

    const market=g.marketTotal;
    const pick=market==null?null:(hybridTotal>market?"Over":"Under");
    const won=market==null?null:(pick==="Over"?g.actualTotal>market:g.actualTotal<market);
    return {
      date:g.date,game:`${g.away} @ ${g.home}`,actual:g.actualTotal,market,
      old:g.oldTotal,newRaw:rnd(rawTotal),newHybrid:rnd(hybridTotal),correction:rnd(correction),
      oldError:rnd(g.oldTotal-g.actualTotal),newError:rnd(hybridTotal-g.actualTotal),
      pick,won,
      components:{awayOff:rnd(awayOff),homeOff:rnd(homeOff),awayDef:rnd(awayDef),homeDef:rnd(homeDef),leagueBase:rnd(rr.base)}
    };
  });

  const oldErr=rows.map(x=>Number(x.old)-x.actual), newErr=rows.map(x=>Number(x.newHybrid)-x.actual);
  const betRows=rows.filter(x=>x.market!=null && x.won!=null);
  const edges=[0,2,3,4,5,6].map(th=>{
    const q=betRows.filter(x=>Math.abs(Number(x.newHybrid)-Number(x.market))>=th);
    const w=q.filter(x=>x.won).length;
    return {threshold:th,n:q.length,wins:w,losses:q.length-w,winRate:q.length?rnd(w/q.length):null};
  });

  return NextResponse.json({
    methodology:{
      targetDates:["2026-10-02","2026-10-03"],
      noLookahead:true,
      residualUnit:"each prior team-game separately",
      opponentAdjustment:"iterative offense/defense residuals from prior games only",
      recencyHalfLifeDays:28,
      sampleShrinkage:"n/(n+2)",
      locationPointsPerTeam:1.5,
      hybrid:"existing pace/personnel/weather projection + schedule-mismatch residual correction"
    },
    summary:{
      n:rows.length,
      old:{mae:rnd(mae(oldErr)),rmse:rnd(rmse(oldErr)),bias:rnd(mean(oldErr))},
      new:{mae:rnd(mae(newErr)),rmse:rnd(rmse(newErr)),bias:rnd(mean(newErr))},
      delta:{mae:rnd((mae(newErr)??0)-(mae(oldErr)??0)),bias:rnd((mean(newErr)??0)-(mean(oldErr)??0))}
    },
    edgeRecords:edges,
    rows
  });
}
