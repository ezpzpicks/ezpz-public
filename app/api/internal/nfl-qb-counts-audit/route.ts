import { NextResponse } from "next/server";
import { readSportWorksheet } from "../../../../lib/sportSheets";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Row = Record<string,string>;
type R = {
  date:string; player:string; gameId:string; team:string; homeAway:string;
  projTeamAttempts:number; projPlayerAttempts:number; actualAttempts:number;
  projCompletions:number; actualCompletions:number; projCompRate:number; actualCompRate:number;
  projDropbacks:number; expectedSacks:number; projection:number; actualYards:number;
  teamSpread:number|null; total:number|null; teamTotal:number|null;
};
const t=(v:unknown)=>String(v??"").trim();
const n=(v:unknown)=>{const x=Number(t(v));return Number.isFinite(x)?x:null};
const mean=(a:number[])=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const med=(a:number[])=>{if(!a.length)return null;const b=[...a].sort((x,y)=>x-y),m=Math.floor(b.length/2);return b.length%2?b[m]:(b[m-1]+b[m])/2};
const round=(v:number|null,d=3)=>v==null?null:Number(v.toFixed(d));
function s(rows:R[],f:(r:R)=>number,a:(r:R)=>number){const e=rows.map(r=>f(r)-a(r)),ae=e.map(x=>Math.abs(x));return{n:rows.length,mae:round(mean(ae)),bias:round(mean(e)),medianAE:round(med(ae)),projectedMean:round(mean(rows.map(f)),2),actualMean:round(mean(rows.map(a)),2)}}
function attemptsSummary(rows:R[],f:(r:R)=>number){return s(rows,f,r=>r.actualAttempts)}
function compSummary(rows:R[],f:(r:R)=>number){return s(rows,f,r=>r.actualCompletions)}
function rateSummary(rows:R[],f:(r:R)=>number){return s(rows,f,r=>r.actualCompRate)}
const scales=Array.from({length:21},(_,i)=>0.85+i*0.015);
const offsets=Array.from({length:17},(_,i)=>-4+i*0.5);
const spreadCoefs=Array.from({length:13},(_,i)=>i*0.05);
const totalCoefs=[-0.10,-0.05,0,0.05,0.10];
function bestScale(rows:R[]){const out:any[]=[];for(const scale of scales)out.push({scale,...attemptsSummary(rows,r=>r.projPlayerAttempts*scale)});return out.sort((a,b)=>(a.mae??999)-(b.mae??999))[0]}
function bestAffine(rows:R[]){const out:any[]=[];for(const scale of scales)for(const offset of offsets)out.push({scale,offset,...attemptsSummary(rows,r=>r.projPlayerAttempts*scale+offset)});return out.sort((a,b)=>(a.mae??999)-(b.mae??999)||Math.abs(a.bias??999)-Math.abs(b.bias??999))[0]}
function scriptPred(r:R,scale:number,spreadCoef:number,totalCoef:number){const sp=r.teamSpread??0,tot=r.total??44;return r.projPlayerAttempts*scale+Math.max(0,sp)*spreadCoef+(tot-44)*totalCoef}
function bestScript(rows:R[]){const out:any[]=[];for(const scale of scales)for(const sc of spreadCoefs)for(const tc of totalCoefs)out.push({scale,spreadCoef:sc,totalCoef:tc,...attemptsSummary(rows,r=>scriptPred(r,scale,sc,tc))});return out.sort((a,b)=>(a.mae??999)-(b.mae??999)||Math.abs(a.bias??999)-Math.abs(b.bias??999))[0]}
function loo(rows:R[]){const dates=[...new Set(rows.map(r=>r.date))].sort();const out:any[]=[];for(const d of dates){const train=rows.filter(r=>r.date!==d),test=rows.filter(r=>r.date===d);const c=bestScript(train);out.push({date:d,n:test.length,current:attemptsSummary(test,r=>r.projPlayerAttempts),candidate:attemptsSummary(test,r=>scriptPred(r,c.scale,c.spreadCoef,c.totalCoef)),config:{scale:round(c.scale,3),spreadCoef:round(c.spreadCoef,3),totalCoef:round(c.totalCoef,3)}})}return out}
function bins(rows:R[],pred:(r:R)=>number){return {
  favorite:attemptsSummary(rows.filter(r=>(r.teamSpread??0)<-2.5),pred),
  close:attemptsSummary(rows.filter(r=>Math.abs(r.teamSpread??0)<=2.5),pred),
  underdog:attemptsSummary(rows.filter(r=>(r.teamSpread??0)>2.5),pred),
  lowTotal:attemptsSummary(rows.filter(r=>(r.total??44)<42),pred),
  midTotal:attemptsSummary(rows.filter(r=>(r.total??44)>=42&&(r.total??44)<=47),pred),
  highTotal:attemptsSummary(rows.filter(r=>(r.total??44)>47),pred),
}}

export async function GET(){
  const tracker=await readSportWorksheet("NFL","prop_tracker") as Row[];
  const slate=await readSportWorksheet("NFL","daily_slate") as Row[];
  const slateMap=new Map<string,Row>();
  for(const x of slate){const gid=t(x["Game ID"]);if(gid)slateMap.set(gid,x)}
  const rows:R[]=[];const seen=new Set<string>();
  for(const x of tracker){
    if(t(x.Position)!=="QB"||t(x.Market)!=="Passing Yards")continue;
    const date=t(x.Date),player=t(x.Player),gameId=t(x["Game ID"]),team=t(x.Team),homeAway=t(x["Home/Away"]);
    const projTeamAttempts=n(x["Projected Pass Attempts"]),projPlayerAttempts=n(x["Projected Player Attempts"]),actualAttempts=n(x["Actual Attempts"]),projCompletions=n(x["Projected Completions"]),actualCompletions=n(x["Actual Completions"]),projDropbacks=n(x["Projected Dropbacks"]),expectedSacks=n(x["Expected Sacks"]),projection=n(x.Projection),actualYards=n(x["Actual Result"]);
    if(projTeamAttempts==null||projPlayerAttempts==null||actualAttempts==null||actualAttempts<=0||projCompletions==null||actualCompletions==null||projDropbacks==null||expectedSacks==null||projection==null||actualYards==null)continue;
    const key=`${date}|${player}|${projection}|${actualYards}`;if(seen.has(key))continue;seen.add(key);
    const g=slateMap.get(gameId);let teamSpread:number|null=null,total:number|null=null,teamTotal:number|null=null;
    if(g){const hs=n(g["Market Home Spread"]),mt=n(g["Market Total"]);if(hs!=null)teamSpread=homeAway.toLowerCase().startsWith("h")?hs:-hs;if(mt!=null){total=mt;if(hs!=null)teamTotal=homeAway.toLowerCase().startsWith("h")?mt/2-hs/2:mt/2+hs/2}}
    const projCompRate=projPlayerAttempts>0?projCompletions/projPlayerAttempts:0,actualCompRate=actualAttempts>0?actualCompletions/actualAttempts:0;
    rows.push({date,player,gameId,team,homeAway,projTeamAttempts,projPlayerAttempts,actualAttempts,projCompletions,actualCompletions,projCompRate,actualCompRate,projDropbacks,expectedSacks,projection,actualYards,teamSpread,total,teamTotal});
  }
  rows.sort((a,b)=>a.date.localeCompare(b.date)||a.player.localeCompare(b.player));
  const pre=rows.filter(r=>r.date<"2026-09-27"),hold=rows.filter(r=>r.date==="2026-09-27"),full=rows.filter(r=>r.actualAttempts>=15);
  const bs=bestScale(pre),ba=bestAffine(pre),bsc=bestScript(pre);
  const applyScript=(r:R)=>scriptPred(r,bsc.scale,bsc.spreadCoef,bsc.totalCoef);
  const compFromAttempt=(r:R)=>applyScript(r)*r.projCompRate;
  const oracleAttemptComp=(r:R)=>r.actualAttempts*r.projCompRate;
  const oracleRateComp=(r:R)=>r.projPlayerAttempts*r.actualCompRate;
  const byDate=[...new Set(rows.map(r=>r.date))].sort().map(date=>{const a=rows.filter(r=>r.date===date);return{date,attempts:attemptsSummary(a,r=>r.projPlayerAttempts),teamAttempts:attemptsSummary(a,r=>r.projTeamAttempts),candidate:attemptsSummary(a,applyScript),completions:compSummary(a,r=>r.projCompletions),compRate:rateSummary(a,r=>r.projCompRate)}});
  const topAttemptMisses=[...rows].sort((a,b)=>Math.abs(b.projPlayerAttempts-b.actualAttempts)-Math.abs(a.projPlayerAttempts-a.actualAttempts)).slice(0,15).map(r=>({date:r.date,player:r.player,team:r.team,teamSpread:r.teamSpread,total:r.total,projTeamAttempts:round(r.projTeamAttempts,2),projPlayerAttempts:round(r.projPlayerAttempts,2),actualAttempts:r.actualAttempts,error:round(r.projPlayerAttempts-r.actualAttempts,2),projDropbacks:round(r.projDropbacks,2),expectedSacks:round(r.expectedSacks,2),dropbackIdentity:round(r.projDropbacks-r.expectedSacks-r.projTeamAttempts,3),candidate:round(applyScript(r),2)}));
  return NextResponse.json({
    counts:{all:rows.length,pre:pre.length,holdout:hold.length,fullGameLike:full.length,withScript:rows.filter(r=>r.teamSpread!=null&&r.total!=null).length},
    identity:{teamVsPlayer:round(mean(rows.map(r=>Math.abs(r.projTeamAttempts-r.projPlayerAttempts)))),dropbacksMinusSacksVsTeamAttempts:round(mean(rows.map(r=>Math.abs((r.projDropbacks-r.expectedSacks)-r.projTeamAttempts))))},
    attempts:{current:{pre:attemptsSummary(pre,r=>r.projPlayerAttempts),holdout:attemptsSummary(hold,r=>r.projPlayerAttempts),all:attemptsSummary(rows,r=>r.projPlayerAttempts),fullGameLike:attemptsSummary(full,r=>r.projPlayerAttempts)},teamField:{pre:attemptsSummary(pre,r=>r.projTeamAttempts),holdout:attemptsSummary(hold,r=>r.projTeamAttempts),all:attemptsSummary(rows,r=>r.projTeamAttempts)},trainSelected:{scale:{config:{...bs,scale:round(bs.scale,3)},holdout:attemptsSummary(hold,r=>r.projPlayerAttempts*bs.scale),all:attemptsSummary(rows,r=>r.projPlayerAttempts*bs.scale)},affine:{config:{...ba,scale:round(ba.scale,3)},holdout:attemptsSummary(hold,r=>r.projPlayerAttempts*ba.scale+ba.offset),all:attemptsSummary(rows,r=>r.projPlayerAttempts*ba.scale+ba.offset)},script:{config:{...bsc,scale:round(bsc.scale,3),spreadCoef:round(bsc.spreadCoef,3),totalCoef:round(bsc.totalCoef,3)},holdout:attemptsSummary(hold,applyScript),all:attemptsSummary(rows,applyScript),fullGameLike:attemptsSummary(full,applyScript)}},binsCurrent:bins(rows,r=>r.projPlayerAttempts),binsCandidate:bins(rows,applyScript),leaveOneDateOut:loo(pre)},
    completions:{current:{pre:compSummary(pre,r=>r.projCompletions),holdout:compSummary(hold,r=>r.projCompletions),all:compSummary(rows,r=>r.projCompletions)},rate:{pre:rateSummary(pre,r=>r.projCompRate),holdout:rateSummary(hold,r=>r.projCompRate),all:rateSummary(rows,r=>r.projCompRate)},oracles:{actualAttempts:{pre:compSummary(pre,oracleAttemptComp),holdout:compSummary(hold,oracleAttemptComp),all:compSummary(rows,oracleAttemptComp)},actualRate:{pre:compSummary(pre,oracleRateComp),holdout:compSummary(hold,oracleRateComp),all:compSummary(rows,oracleRateComp)}},withAttemptCandidate:{pre:compSummary(pre,compFromAttempt),holdout:compSummary(hold,compFromAttempt),all:compSummary(rows,compFromAttempt)}},
    byDate,topAttemptMisses
  });
}
