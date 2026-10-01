import { NextResponse } from "next/server";
import { readSportWorksheet } from "../../../../lib/sportSheets";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Row = Record<string,string>;
type R = {
  date:string; player:string; projection:number; line:number; actual:number;
  attempts:number; actualAttempts:number; ypa:number; actualYpa:number;
  matchup:number; version:string; confluence:string;
};
const t=(v:unknown)=>String(v??"").trim();
const n=(v:unknown)=>{const x=Number(t(v));return Number.isFinite(x)?x:null};
const mean=(a:number[])=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const round=(v:number|null,d=3)=>v==null?null:Number(v.toFixed(d));
const normLine=(x:number)=>{let v=x;while(v>600)v/=10;return v};
function bet(r:R,p:number){if(!(r.line>0))return"NA";if(r.actual===r.line)return"P";return p>=r.line?(r.actual>r.line?"W":"L"):(r.actual<r.line?"W":"L")}
function summary(rows:R[],f:(r:R)=>number){const ae:number[]=[];let w=0,l=0,p=0;for(const r of rows){const q=Math.max(0,f(r));ae.push(Math.abs(r.actual-q));const z=bet(r,q);if(z==="W")w++;else if(z==="L")l++;else if(z==="P")p++;}return{n:rows.length,mae:round(mean(ae)),bias:round(mean(rows.map(r=>f(r)-r.actual))),marketN:w+l+p,record:`${w}-${l}-${p}`,winPct:w+l?round(100*w/(w+l),1):null}}
function compSummary(rows:R[],field:"attempts"|"ypa"){const actual=field==="attempts"?"actualAttempts":"actualYpa";const errs=rows.map(r=>Math.abs(r[field]-r[actual]));return{n:rows.length,mae:round(mean(errs)),bias:round(mean(rows.map(r=>r[field]-r[actual]))),projectedMean:round(mean(rows.map(r=>r[field])),2),actualMean:round(mean(rows.map(r=>r[actual])),2)}}
const scales=Array.from({length:25},(_,i)=>0.70+i*0.025);
const matchupWeights=[0,0.25,0.5,0.75,1];
function product(r:R,os=1,es=1){return r.attempts*os*r.ypa*es}
function bestScale(rows:R[],which:"opp"|"eff"){return scales.map(s=>({scale:round(s,3),...summary(rows,r=>which==="opp"?product(r,s,1):product(r,1,s))})).sort((a,b)=>(a.mae??999)-(b.mae??999))[0]}
function bestJoint(rows:R[]){const out:any[]=[];for(const os of scales)for(const es of scales)out.push({oppScale:round(os,3),effScale:round(es,3),...summary(rows,r=>product(r,os,es))});return out.sort((a,b)=>(a.mae??999)-(b.mae??999)||Math.abs(a.bias??999)-Math.abs(b.bias??999))[0]}
function matchupCand(r:R,w:number){return r.matchup>0?r.projection/Math.pow(r.matchup,w):r.projection}
function matchupGrid(rows:R[]){return matchupWeights.map(w=>({neutralization:w,...summary(rows,r=>matchupCand(r,w))})).sort((a,b)=>(a.mae??999)-(b.mae??999))}
function pctEdgeRec(rows:R[],f:(r:R)=>number,min=16){let w=0,l=0,p=0;for(const r of rows){if(!(r.line>0))continue;const q=f(r),edge=100*Math.abs(q-r.line)/r.line;if(edge<min)continue;const z=bet(r,q);if(z==="W")w++;else if(z==="L")l++;else if(z==="P")p++;}return{n:w+l+p,w,l,p,winPct:w+l?round(100*w/(w+l),1):null}}

export async function GET(){
  const tracker=await readSportWorksheet("NFL","prop_tracker") as Row[];
  const rows:R[]=[];const seen=new Set<string>();
  for(const x of tracker){
    if(t(x.Position)!=="QB"||t(x.Market)!=="Passing Yards")continue;
    const projection=n(x.Projection),actual=n(x["Actual Result"]),attempts=n(x["Projected Pass Attempts"]),actualAttempts=n(x["Actual Attempts"]),ypa=n(x.Efficiency),mi=n(x["Matchup Index"])??1;
    if(projection==null||actual==null||attempts==null||attempts<=0||actualAttempts==null||actualAttempts<=0||ypa==null||ypa<=0)continue;
    const actualYpa=actual/actualAttempts;if(!(actualYpa>0))continue;
    const line0=n(x["Market Line"])??0,line=line0>0?normLine(line0):0;
    const key=`${t(x.Date)}|${t(x.Player)}|${projection}|${actual}`;if(seen.has(key))continue;seen.add(key);
    rows.push({date:t(x.Date),player:t(x.Player),projection,line,actual,attempts,actualAttempts,ypa,actualYpa,matchup:mi>0?mi:1,version:t(x["Model Version"]),confluence:t(x.Confluence)});
  }
  rows.sort((a,b)=>a.date.localeCompare(b.date)||a.player.localeCompare(b.player));
  const pre=rows.filter(r=>r.date<"2026-09-27"),hold=rows.filter(r=>r.date==="2026-09-27");
  const market=(a:R[])=>summary(a,r=>r.line>0?r.line:r.projection);
  const recon=(a:R[])=>({projectionVsProduct:round(mean(a.map(r=>Math.abs(r.projection-product(r))))),ratioMean:round(mean(a.map(r=>product(r)>0?r.projection/product(r):1)),4)});
  const opp=bestScale(pre,"opp"),eff=bestScale(pre,"eff"),joint=bestJoint(pre),mg=matchupGrid(pre),mw=mg[0]?.neutralization??0;
  const byDate=[...new Set(rows.map(r=>r.date))].sort().map(date=>{const a=rows.filter(r=>r.date===date);return{date,current:summary(a,r=>r.projection),market:market(a),attempts:compSummary(a,"attempts"),ypa:compSummary(a,"ypa"),noMatchup:summary(a,r=>matchupCand(r,1))}});
  const bands={
    negative:rows.filter(r=>r.matchup<0.95),neutral:rows.filter(r=>r.matchup>=0.95&&r.matchup<=1.05),positive:rows.filter(r=>r.matchup>1.05)
  };
  const topMisses=[...rows].sort((a,b)=>Math.abs(b.actual-b.projection)-Math.abs(a.actual-a.projection)).slice(0,15).map(r=>({date:r.date,player:r.player,line:r.line,current:round(r.projection,2),actual:r.actual,error:round(r.projection-r.actual,2),attempts:round(r.attempts,2),actualAttempts:r.actualAttempts,ypa:round(r.ypa,3),actualYpa:round(r.actualYpa,3),matchup:round(r.matchup,3),noMatchup:round(matchupCand(r,1),2)}));
  return NextResponse.json({
    counts:{all:rows.length,pre:pre.length,holdout:hold.length,marketAll:rows.filter(r=>r.line>0).length},
    reconstruction:{pre:recon(pre),holdout:recon(hold),all:recon(rows)},
    current:{pre:summary(pre,r=>r.projection),holdout:summary(hold,r=>r.projection),all:summary(rows,r=>r.projection)},
    market:{pre:market(pre),holdout:market(hold),all:market(rows)},
    components:{attempts:{pre:compSummary(pre,"attempts"),holdout:compSummary(hold,"attempts"),all:compSummary(rows,"attempts")},ypa:{pre:compSummary(pre,"ypa"),holdout:compSummary(hold,"ypa"),all:compSummary(rows,"ypa")},oracle:{actualAttempts:{pre:summary(pre,r=>r.actualAttempts*r.ypa),holdout:summary(hold,r=>r.actualAttempts*r.ypa)},actualYpa:{pre:summary(pre,r=>r.attempts*r.actualYpa),holdout:summary(hold,r=>r.attempts*r.actualYpa)}}},
    trainSelected:{opportunity:{config:opp,holdout:summary(hold,r=>product(r,opp?.scale??1,1)),all:summary(rows,r=>product(r,opp?.scale??1,1))},efficiency:{config:eff,holdout:summary(hold,r=>product(r,1,eff?.scale??1)),all:summary(rows,r=>product(r,1,eff?.scale??1))},joint:{config:joint,holdout:summary(hold,r=>product(r,joint?.oppScale??1,joint?.effScale??1)),all:summary(rows,r=>product(r,joint?.oppScale??1,joint?.effScale??1))}},
    matchup:{trainGrid:mg,selectedOnTrain:{neutralization:mw,pre:summary(pre,r=>matchupCand(r,mw)),holdout:summary(hold,r=>matchupCand(r,mw)),all:summary(rows,r=>matchupCand(r,mw))},noMatchup:{pre:summary(pre,r=>matchupCand(r,1)),holdout:summary(hold,r=>matchupCand(r,1)),all:summary(rows,r=>matchupCand(r,1))},bands:{negative:summary(bands.negative,r=>r.projection),neutral:summary(bands.neutral,r=>r.projection),positive:summary(bands.positive,r=>r.projection)}},
    edgeRecords:{current:{e16:pctEdgeRec(rows,r=>r.projection,16),e25:pctEdgeRec(rows,r=>r.projection,25),e30:pctEdgeRec(rows,r=>r.projection,30)},selectedMatchup:{e16:pctEdgeRec(rows,r=>matchupCand(r,mw),16),e25:pctEdgeRec(rows,r=>matchupCand(r,mw),25),e30:pctEdgeRec(rows,r=>matchupCand(r,mw),30)}},
    byDate,topMisses
  });
}
