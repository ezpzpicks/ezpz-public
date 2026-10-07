import { NextResponse } from "next/server";
import { readSportWorksheet } from "../../../../lib/sportSheets";

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
  const counts=new Map<string,number>();
  for(const r of pointRows) counts.set(k(r.team),(counts.get(k(r.team))??0)+1);
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
  return {base,off,def,homeAdj,priorCount:prior.length,counts};
}

export async function GET(){
  const [slateRows,schedRows]=await Promise.all([
    readSportWorksheet("NCAAF","daily_slate") as Promise<Row[]>,
    readSportWorksheet("NCAAF","schedule") as Promise<Row[]>
  ]);

  const actualById=new Map<string,{date:string,away:string,home:string,awayPts:number,homePts:number}>();
  const actualByKey=new Map<string,{date:string,away:string,home:string,awayPts:number,homePts:number}>();
  const hist:Hist[]=[];
  for(const r of schedRows){
    const date=d(r["Game Date"]), away=t(r["Away Team"]), home=t(r["Home Team"]);
    const ap=n(r["Away Score"]), hp=n(r["Home Score"]), id=t(r["Game ID"]);
    if(!date||!away||!home||ap==null||hp==null||(ap===0&&hp===0)) continue;
    const rec={date,away,home,awayPts:ap,homePts:hp};
    if(id) actualById.set(id,rec);
    actualByKey.set(schedKey(date,away,home),rec);
    hist.push({date,away,home,awayPts:ap,homePts:hp});
  }

  const targets:Slate[]=[];
  const seen=new Set<string>();
  for(const r of slateRows){
    const date=d(r.Date);
    if(date<"2026-09-12"||date>"2026-10-03") continue;
    const slateAway=t(r["Away Team"]), slateHome=t(r["Home Team"]), id=t(r["Game ID"]);
    const a=(id?actualById.get(id):undefined) ?? actualByKey.get(schedKey(date,slateAway,slateHome));
    if(!a) continue;
    const dedupKey=id||schedKey(date,a.away,a.home); if(seen.has(dedupKey)) continue; seen.add(dedupKey);
    const oldTotal=n(r["Projected Total"]), oldAway=n(r["Projected Away"]), oldHome=n(r["Projected Home"]);
    if(oldTotal==null||oldAway==null||oldHome==null) continue;
    targets.push({date:a.date,away:a.away,home:a.home,oldTotal,oldAway,oldHome,marketTotal:n(r["Market Total"]),actualTotal:a.awayPts+a.homePts});
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
    const awayGames=rr.counts.get(k(g.away))??0, homeGames=rr.counts.get(k(g.home))??0;
    const matchupGames=Math.min(awayGames,homeGames);

    const market=g.marketTotal;
    const pick=market==null?null:(hybridTotal>market?"Over":"Under");
    const won=market==null?null:(pick==="Over"?g.actualTotal>market:g.actualTotal<market);
    return {
      date:g.date,game:`${g.away} @ ${g.home}`,actual:g.actualTotal,market,
      old:g.oldTotal,newRaw:rnd(rawTotal),newHybrid:rnd(hybridTotal),correction:rnd(correction),
      oldError:rnd(g.oldTotal-g.actualTotal),newError:rnd(hybridTotal-g.actualTotal),
      pick,won,
      components:{awayOff:rnd(awayOff),homeOff:rnd(homeOff),awayDef:rnd(awayDef),homeDef:rnd(homeDef),leagueBase:rnd(rr.base),awayGames,homeGames,matchupGames}
    };
  });

  const oldErr=rows.map(x=>Number(x.old)-x.actual), newErr=rows.map(x=>Number(x.newHybrid)-x.actual);
  const betRows=rows.filter(x=>x.market!=null && x.won!=null);
  const edges=[0,2,3,4,5,6].map(th=>{
    const q=betRows.filter(x=>Math.abs(Number(x.newHybrid)-Number(x.market))>=th);
    const w=q.filter(x=>x.won).length;
    return {threshold:th,n:q.length,wins:w,losses:q.length-w,winRate:q.length?rnd(w/q.length):null};
  });

  type Variant={name:string,alpha:number,cap:number|null,sampleK:number|null};
  const variants:Variant[]=[{name:"baseline",alpha:1,cap:null,sampleK:null}];
  for(const alpha of [0.35,0.5,0.65,0.75,0.85,1]){
    for(const cap of [4,6,8,10,12]) variants.push({name:`a${alpha}-cap${cap}`,alpha,cap,sampleK:null});
  }
  for(const sampleK of [1,2,3,4]){
    for(const alpha of [0.65,0.8,1]){
      for(const cap of [6,8,10,12]) variants.push({name:`k${sampleK}-a${alpha}-cap${cap}`,alpha,cap,sampleK});
    }
  }
  const evalVariant=(v:Variant)=>{
    const vr=rows.map(x=>{
      const games=x.components.matchupGames as number;
      const sampleW=v.sampleK==null?1:(games/(games+v.sampleK));
      let adj=Number(x.correction)*v.alpha*sampleW;
      if(v.cap!=null) adj=Math.max(-v.cap,Math.min(v.cap,adj));
      const proj=Number(x.old)+adj;
      const err=proj-x.actual;
      const market=x.market==null?null:Number(x.market);
      const pick=market==null?null:(proj>market?"Over":"Under");
      const won=market==null?null:(pick==="Over"?x.actual>market:x.actual<market);
      return {...x,proj,err,adj,pick,won};
    });
    const errs=vr.map(x=>x.err);
    const edgeRecords=[0,2,3,4,5,6].map(th=>{
      const q=vr.filter(x=>x.market!=null&&x.won!=null&&Math.abs(x.proj-Number(x.market))>=th);
      const w=q.filter(x=>x.won).length;
      return {threshold:th,n:q.length,wins:w,losses:q.length-w,winRate:q.length?rnd(w/q.length):null};
    });
    return {variant:v,mae:rnd(mae(errs)),rmse:rnd(rmse(errs)),bias:rnd(mean(errs)),edgeRecords};
  };
  const tuning=variants.map(evalVariant).sort((a,b)=>(a.mae??999)-(b.mae??999));

  return NextResponse.json({
    methodology:{
      targetDates:["2026-09-12 through 2026-10-03"],
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
    tuning:{bestByMae:tuning.slice(0,15),all:tuning},
    rows
  });
}
