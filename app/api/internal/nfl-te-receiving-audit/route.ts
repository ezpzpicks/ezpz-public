import { NextResponse } from "next/server";
import { readSportWorksheet } from "../../../../lib/sportSheets";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Row = Record<string,string>;
type R = {
  date:string; player:string; line:number; projection:number; actual:number; version:string;
  baseTargets:number; baseEff:number; role:number; slotAdj:number;
};

const t=(v:unknown)=>String(v??"").trim();
const n=(v:unknown)=>{const x=Number(t(v));return Number.isFinite(x)?x:null};
const mean=(a:number[])=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const med=(a:number[])=>{if(!a.length)return null;const z=[...a].sort((x,y)=>x-y),m=Math.floor(z.length/2);return z.length%2?z[m]:(z[m-1]+z[m])/2};
const round=(x:number|null,d=3)=>x==null?null:Number(x.toFixed(d));
const pct=(x:number|null)=>x==null?null:Number((100*x).toFixed(1));
const rx=(s:unknown,re:RegExp)=>{const m=t(s).match(re);return m?Number(m[1]):null};
const role=(s:unknown)=>rx(s,/live role(?:\/injury)? overlay\s+([0-9.]+)x/i);
const slotAdj=(s:unknown)=>{const x=rx(s,/slot matchup[\s\S]*?applied\s+([+-]?[0-9.]+)%/i);return x==null?0:x/100};
const key=(r:Row,withLine=false)=>`${t(r.Date)}|${t(r.Player)}|${t(r.Market)}${withLine?`|${t(r["Market Line"])}`:""}`;
const playerKey=(r:Row)=>`${t(r.Date)}|${t(r.Player)}`;

const cfg=(le:number,s:number,p:number)=>({le:Number(le.toFixed(2)),s:Number(s.toFixed(2)),p:Number(p.toFixed(2))});
const candidate=(c:{le:number;s:number;p:number})=>(x:R)=>x.baseTargets*((1-c.le)*x.baseEff+c.le*c.p)*(1+c.s*x.slotAdj);
const current=(x:R)=>x.projection;
const removeRole=(x:R)=>x.projection/x.role;

function metrics(a:R[],f:(x:R)=>number){
  if(!a.length)return{n:0,mae:null,medianAE:null,bias:null};
  const e=a.map(x=>Math.abs(x.actual-f(x)));
  return{n:a.length,mae:round(mean(e)),medianAE:round(med(e)),bias:round(mean(a.map(x=>f(x)-x.actual)))};
}
function rec(a:R[],f:(x:R)=>number,min=16,side="ALL"){
  let w=0,l=0,p=0;
  for(const x of a){
    if(x.line<=0)continue;
    const y=f(x),g=y-x.line;
    if(100*Math.abs(g)/x.line<min)continue;
    if(side==="OVER"&&g<=0)continue;
    if(side==="UNDER"&&g>=0)continue;
    const ar=Math.sign(x.actual-x.line),pr=Math.sign(g);
    if(ar===0)p++; else if(ar===pr)w++; else l++;
  }
  return{n:w+l+p,w,l,p,winPct:w+l?pct(w/(w+l)):null};
}
function suite(a:R[],f:(x:R)=>number){
  return{metrics:metrics(a,f),market:metrics(a.filter(x=>x.line>0),x=>x.line),paired:paired(a,f),edges:{e16:rec(a,f,16),e20:rec(a,f,20),e25:rec(a,f,25),e30:rec(a,f,30),over16:rec(a,f,16,"OVER"),under16:rec(a,f,16,"UNDER")}};
}
function paired(a:R[],f:(x:R)=>number){
  const z=a.filter(x=>x.line>0); if(!z.length)return{n:0,wins:0,losses:0,ties:0,winPct:null,meanAdvantage:null};
  const d=z.map(x=>Math.abs(x.actual-x.line)-Math.abs(x.actual-f(x))); const wins=d.filter(x=>x>0).length,ties=d.filter(x=>x===0).length,losses=d.length-wins-ties;
  return{n:d.length,wins,losses,ties,winPct:pct(wins/Math.max(1,wins+losses)),meanAdvantage:round(mean(d))};
}
function grid(){
  const out:{le:number;s:number;p:number}[]=[];
  for(let i=0;i<=10;i++)for(let j=0;j<=12;j++)for(let k=0;k<=12;k++)out.push(cfg(i*.1,j*.25,6.5+k*.25));
  return out;
}
function rank(a:R[],limit=12){
  if(!a.length)return[];
  return grid().map(c=>({config:c,...metrics(a,candidate(c))})).sort((a,b)=>(a.mae??999)-(b.mae??999)||Math.abs(a.bias??999)-Math.abs(b.bias??999)).slice(0,limit);
}
function best(a:R[]){return rank(a,1)[0]?.config??cfg(0,0,8.15)};
function fixed(a:R[]){
  const defs:Record<string,(x:R)=>number>={
    current,
    removeRole,
    regressionNoSlot:candidate(cfg(0,0,8.15)),
    exactSlot1:candidate(cfg(0,1,8.15)),
    exactSlot2:candidate(cfg(0,2,8.15)),
    exactSlot3:candidate(cfg(0,3,8.15)),
    shrink50NoSlot:candidate(cfg(.5,0,8.15)),
    shrink80NoSlot:candidate(cfg(.8,0,8.15)),
    wr12Formula:candidate(cfg(.8,3,8.15)),
    prior725NoSlot:candidate(cfg(1,0,7.25)),
    prior775NoSlot:candidate(cfg(1,0,7.75)),
    prior815NoSlot:candidate(cfg(1,0,8.15)),
  };
  return Object.fromEntries(Object.entries(defs).map(([k,f])=>[k,suite(a,f)]));
}
function dateCV(a:R[]){
  const dates=[...new Set(a.map(x=>x.date))].sort(),folds:any[]=[];let se=0,sc=0,sm=0,N=0;
  for(const d of dates){
    const tr=a.filter(x=>x.date!==d),te=a.filter(x=>x.date===d); if(!tr.length||!te.length)continue;
    const c=best(tr),f=candidate(c),cm=metrics(te,f),cur=metrics(te,current),mk=metrics(te.filter(x=>x.line>0),x=>x.line);
    folds.push({date:d,n:te.length,selected:c,candidateMAE:cm.mae,currentMAE:cur.mae,marketMAE:mk.mae,record:rec(te,f,0)});
    se+=(cm.mae??0)*te.length;sc+=(cur.mae??0)*te.length;sm+=(mk.mae??0)*te.length;N+=te.length;
  }
  return{dates,folds,aggregate:N?{n:N,candidateMAE:round(se/N),currentMAE:round(sc/N),marketMAE:round(sm/N)}:null};
}

export async function GET(){
  const [cal,proj]=await Promise.all([
    readSportWorksheet("NFL","prop_calibration") as Promise<Row[]>,
    readSportWorksheet("NFL","prop_projections") as Promise<Row[]>,
  ]);

  const exact=new Map<string,Row>(),fallback=new Map<string,Row>(),targets=new Map<string,Row>();
  for(const p of proj){
    if(t(p.Slot)!=="TE1")continue;
    if(t(p.Market)==="Receiving Yards"){
      exact.set(key(p,true),p);fallback.set(key(p,false),p);
    }
    if(t(p.Market)==="Targets")targets.set(playerKey(p),p);
  }

  const reconstructed:R[]=[]; const allCompleted:any[]=[]; const seen=new Set<string>();
  for(const c of cal){
    if(t(c.Market)!=="Receiving Yards")continue;
    const p=exact.get(key(c,true))||fallback.get(key(c,false));
    const slot=t(c.Slot)||t(p?.Slot); if(slot!=="TE1")continue;
    const line=n(c["Market Line"])??0,projection=n(c.Projection),actual=n(c["Actual Result"]); if(projection==null||actual==null)continue;
    const ded=`${key(c,true)}|${projection}`; if(seen.has(ded))continue;seen.add(ded);
    allCompleted.push({date:t(c.Date),player:t(c.Player),position:t(c.Position)||t(p?.Position),line,projection,actual,version:t(c["Model Version"]||p?.["Model Version"])});
    if(!p)continue;
    const tr=targets.get(playerKey(c)),mi=n(p["Matchup Index"]),ro=role(p.Confluence),ft=n(p["Projected Targets"]),fe=n(p.Efficiency);
    if(!tr||mi==null||mi<=0||ro==null||ro<=0||ft==null||fe==null||!t(p.Confluence).includes("slot matchup"))continue;
    const tp=n(tr.Projection),tmi=n(tr["Matchup Index"]); if(tp==null||tmi==null||tmi<=0)continue;
    const roleTargets=tp/tmi,baseTargets=roleTargets/ro,opp=roleTargets>0?ft/roleTargets:1,ef=opp>0?mi/opp:1,baseEff=ef>0?fe/ef:fe;
    reconstructed.push({date:t(c.Date),player:t(c.Player),line,projection,actual,version:t(c["Model Version"]||p["Model Version"]),baseTargets,baseEff,role:ro,slotAdj:slotAdj(p.Confluence)});
  }

  reconstructed.sort((a,b)=>a.date.localeCompare(b.date)||a.player.localeCompare(b.player));
  const pre=reconstructed.filter(x=>x.date<"2026-09-27"),hold=reconstructed.filter(x=>x.date==="2026-09-27"),selected=best(pre),sf=candidate(selected);
  const allCurrent={n:allCompleted.length,mae:round(mean(allCompleted.map(x=>Math.abs(x.actual-x.projection)))),marketN:allCompleted.filter(x=>x.line>0).length,marketMAE:round(mean(allCompleted.filter(x=>x.line>0).map(x=>Math.abs(x.actual-x.line))))};
  const byDate=Object.fromEntries([...new Set(reconstructed.map(x=>x.date))].sort().map(d=>[d,{n:reconstructed.filter(x=>x.date===d).length,current:metrics(reconstructed.filter(x=>x.date===d),current),market:metrics(reconstructed.filter(x=>x.date===d&&x.line>0),x=>x.line)}]));
  return NextResponse.json({
    counts:{allCompleted:allCompleted.length,reconstructed:reconstructed.length,pre:pre.length,holdout:hold.length,dates:Object.fromEntries([...new Set(reconstructed.map(x=>x.date))].map(d=>[d,reconstructed.filter(x=>x.date===d).length]))},
    completedSamples:allCompleted.slice(0,10),
    projectionTE1Count:[...exact.values()].length,
    allCompletedCurrent:allCurrent,
    selectedOnPre:selected,
    fixed:{all:fixed(reconstructed),pre:fixed(pre),holdout:fixed(hold)},
    selected:{pre:suite(pre,sf),holdout:suite(hold,sf),all:suite(reconstructed,sf)},
    topPre:rank(pre,12),topAll:rank(reconstructed,12),dateCV:dateCV(reconstructed),byDate,
    rows:reconstructed.map(x=>({date:x.date,player:x.player,line:x.line,actual:x.actual,current:round(x.projection,2),role:round(x.role,2),baseTargets:round(x.baseTargets,2),baseEff:round(x.baseEff,2),slotAdjPct:pct(x.slotAdj),wr12:round(candidate(cfg(.8,3,8.15))(x),2),selected:round(sf(x),2)})),
  });
}
