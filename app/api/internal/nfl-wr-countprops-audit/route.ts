import { NextResponse } from "next/server";
import { readSportWorksheet } from "../../../../lib/sportSheets";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Row = Record<string, string>;
type Market = "Targets" | "Receptions";
type Slot = "WR1" | "WR2";
type Base = {
  date:string; player:string; slot:Slot; market:Market; line:number; projection:number; actual:number;
  targets:number; routes:number; tprr:number; routePart:number; role:number; matchup:number;
  actualTargets:number|null;
};

const text=(v:unknown)=>String(v??"").trim();
const num=(v:unknown)=>{const n=Number(text(v));return Number.isFinite(n)?n:null};
const round=(v:number|null,d=3)=>v==null?null:Number(v.toFixed(d));
const mean=(a:number[])=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const key=(r:Row,market?:string)=>`${text(r.Date)}|${text(r.Player)}|${market??text(r.Market)}`;
const playerKey=(r:Row)=>`${text(r.Date)}|${text(r.Player)}`;
const slotOf=(r:Row):Slot|null=>{const s=text(r.Slot).toUpperCase(); return s==="WR1"||s==="WR2"?s:null};
const role=(s:unknown)=>{
  const z=text(s);
  const m=z.match(/(?:removed\s+)?live role(?:\/injury)? overlay\s+([0-9.]+)x/i);
  return m&&Number(m[1])>0?Number(m[1]):1;
};

function betResult(r:Base,p:number){
  if(!(r.line>0))return "NA";
  if(r.actual===r.line)return "P";
  return p>=r.line?(r.actual>r.line?"W":"L"):(r.actual<r.line?"W":"L");
}
function summarize(rows:Base[],fn:(r:Base)=>number){
  const ae:number[]=[];let w=0,l=0,p=0;
  for(const r of rows){const q=Math.max(0,fn(r));ae.push(Math.abs(r.actual-q));const z=betResult(r,q);if(z==="W")w++;else if(z==="L")l++;else if(z==="P")p++;}
  return {n:rows.length,mae:round(mean(ae)),bias:round(mean(rows.map(r=>fn(r)-r.actual))),marketN:w+l+p,record:`${w}-${l}-${p}`,winPct:w+l?round(100*w/(w+l),1):null};
}

const roleWeights=[0,0.25,0.5,0.75,1];
const routeWeights=[0,0.25,0.5,0.75,1];
function targetCandidate(r:Base,rw:number,tw:number){
  const roleNeutral=r.targets/Math.pow(Math.max(r.role,0.05),rw);
  const routeTargets=r.routes*r.tprr;
  if(!(routeTargets>0))return roleNeutral;
  return Math.max(0,(1-tw)*roleNeutral+tw*routeTargets);
}
function targetGrid(rows:Base[]){
  return roleWeights.flatMap(rw=>routeWeights.map(tw=>({roleRemoval:rw,routeBlend:tw,...summarize(rows,r=>targetCandidate(r,rw,tw))})))
    .sort((a,b)=>(a.mae??999)-(b.mae??999)||Math.abs(a.bias??999)-Math.abs(b.bias??999));
}
function catchPrior(rows:Base[]){
  let rec=0,tar=0;
  for(const r of rows)if(r.market==="Receptions"&&r.actualTargets!=null&&r.actualTargets>0){rec+=r.actual;tar+=r.actualTargets;}
  return tar>0?rec/tar:0.65;
}
function receptionCandidate(r:Base,cfg:{roleRemoval:number;routeBlend:number},catchWeight:number,prior:number){
  const oldRate=r.targets>0?r.projection/r.targets:prior;
  const newRate=(1-catchWeight)*oldRate+catchWeight*prior;
  return targetCandidate(r,cfg.roleRemoval,cfg.routeBlend)*newRate;
}

export async function GET(){
  const [cal,proj]=await Promise.all([
    readSportWorksheet("NFL","prop_calibration") as Promise<Row[]>,
    readSportWorksheet("NFL","prop_projections") as Promise<Row[]>,
  ]);

  const projMap=new Map<string,Row>();
  const playerSlot=new Map<string,Slot>();
  const recvMap=new Map<string,Row>();
  for(const p of proj){
    if(text(p.Position)!=="WR")continue;
    const s=slotOf(p); if(s)playerSlot.set(playerKey(p),s);
    projMap.set(key(p),p);
    if(text(p.Market)==="Receiving Yards")recvMap.set(playerKey(p),p);
  }
  const actualTargets=new Map<string,number>();
  for(const c of cal){
    if(text(c.Position)!=="WR"||text(c.Market)!=="Targets")continue;
    const a=num(c["Actual Result"]);if(a!=null)actualTargets.set(playerKey(c),a);
  }

  const rows:Base[]=[];const seen=new Set<string>();
  for(const c of cal){
    const market=text(c.Market) as Market;
    if(text(c.Position)!=="WR"||(market!=="Targets"&&market!=="Receptions"))continue;
    const p=projMap.get(key(c))||{};
    const recv=recvMap.get(playerKey(c))||{};
    const slot=slotOf(c)||slotOf(p)||slotOf(recv)||playerSlot.get(playerKey(c))||null;
    if(slot!=="WR1"&&slot!=="WR2")continue;
    const projection=num(c.Projection),actual=num(c["Actual Result"]),line=num(c["Market Line"])??0;
    if(projection==null||actual==null)continue;
    const targets=num(p["Projected Targets"])??(market==="Targets"?projection:num(recv["Projected Targets"]));
    const routes=num(p["Projected Routes"])??num(recv["Projected Routes"]);
    const tprr=num(p["Targets Per Route"])??num(recv["Targets Per Route"]);
    const routePart=num(p["Route Participation"])??num(recv["Route Participation"]);
    if(targets==null||targets<=0||routes==null||routes<=0||tprr==null||tprr<=0||routePart==null)continue;
    const d=`${key(c)}|${projection}`;if(seen.has(d))continue;seen.add(d);
    const roleValue=role(p.Confluence||recv.Confluence);
    const matchup=num(p["Matchup Index"])??1;
    const at=market==="Targets"?actual:(num(c["Actual Opportunity"])??actualTargets.get(playerKey(c))??null);
    rows.push({date:text(c.Date),player:text(c.Player),slot,market,line,projection,actual,targets,routes,tprr,routePart,role:roleValue,matchup:matchup&&matchup>0?matchup:1,actualTargets:at});
  }
  rows.sort((a,b)=>a.date.localeCompare(b.date)||a.slot.localeCompare(b.slot)||a.player.localeCompare(b.player)||a.market.localeCompare(b.market));
  const pre=rows.filter(r=>r.date<"2026-09-27"),hold=rows.filter(r=>r.date==="2026-09-27");
  const out:any={counts:{all:rows.length,pre:pre.length,holdout:hold.length},slots:{}};

  for(const slot of ["WR1","WR2"] as Slot[]){
    const allS=rows.filter(r=>r.slot===slot),preS=pre.filter(r=>r.slot===slot),holdS=hold.filter(r=>r.slot===slot);
    const tAll=allS.filter(r=>r.market==="Targets"),tPre=preS.filter(r=>r.market==="Targets"),tHold=holdS.filter(r=>r.market==="Targets");
    const rAll=allS.filter(r=>r.market==="Receptions"),rPre=preS.filter(r=>r.market==="Receptions"),rHold=holdS.filter(r=>r.market==="Receptions");
    const grid=targetGrid(tPre);
    const best=grid[0]??{roleRemoval:0,routeBlend:0};
    const cfg={roleRemoval:best.roleRemoval,routeBlend:best.routeBlend};
    const prior=catchPrior(rPre);
    const catchWeights=[0,0.25,0.5,0.75,1];
    const catchGrid=catchWeights.map(cw=>({catchWeight:cw,train:summarize(rPre,r=>receptionCandidate(r,cfg,cw,prior)),holdout:summarize(rHold,r=>receptionCandidate(r,cfg,cw,prior)),all:summarize(rAll,r=>receptionCandidate(r,cfg,cw,prior))}));
    const bestCatch=[...catchGrid].sort((a,b)=>(a.train.mae??999)-(b.train.mae??999))[0];
    out.slots[slot]={
      counts:{all:allS.length,pre:preS.length,holdout:holdS.length,targets:tAll.length,receptions:rAll.length},
      targets:{
        current:{train:summarize(tPre,r=>r.projection),holdout:summarize(tHold,r=>r.projection),all:summarize(tAll,r=>r.projection)},
        noRole:{train:summarize(tPre,r=>r.targets/r.role),holdout:summarize(tHold,r=>r.targets/r.role),all:summarize(tAll,r=>r.targets/r.role)},
        routeOnly:{train:summarize(tPre,r=>r.routes*r.tprr),holdout:summarize(tHold,r=>r.routes*r.tprr),all:summarize(tAll,r=>r.routes*r.tprr)},
        selectedOnTrain:{config:cfg,train:summarize(tPre,r=>targetCandidate(r,cfg.roleRemoval,cfg.routeBlend)),holdout:summarize(tHold,r=>targetCandidate(r,cfg.roleRemoval,cfg.routeBlend)),all:summarize(tAll,r=>targetCandidate(r,cfg.roleRemoval,cfg.routeBlend))},
        topGrid:grid.slice(0,8),
      },
      receptions:{
        empiricalCatchRatePrior:round(prior,4),
        current:{train:summarize(rPre,r=>r.projection),holdout:summarize(rHold,r=>r.projection),all:summarize(rAll,r=>r.projection)},
        targetFixOnly:{train:summarize(rPre,r=>receptionCandidate(r,cfg,0,prior)),holdout:summarize(rHold,r=>receptionCandidate(r,cfg,0,prior)),all:summarize(rAll,r=>receptionCandidate(r,cfg,0,prior))},
        catchRateGrid:catchGrid,
        selectedOnTrain:bestCatch,
      },
      examples:allS.filter(r=>r.date==="2026-09-27").map(r=>({player:r.player,market:r.market,line:r.line,current:round(r.projection),actual:r.actual,targets:round(r.targets),routeTargets:round(r.routes*r.tprr),role:round(r.role,2),matchup:round(r.matchup,3),selectedTarget:round(targetCandidate(r,cfg.roleRemoval,cfg.routeBlend)),selectedProjection:round(r.market==="Targets"?targetCandidate(r,cfg.roleRemoval,cfg.routeBlend):receptionCandidate(r,cfg,bestCatch?.catchWeight??0,prior))})),
    };
  }
  return NextResponse.json(out);
}
