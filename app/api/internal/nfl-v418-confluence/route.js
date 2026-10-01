import {NextResponse} from "next/server";
import {readSportWorksheet} from "../../../../lib/sportSheets";
export const dynamic="force-dynamic";
export const revalidate=0;

const t=v=>String(v??"").trim();
const n=v=>{const x=Number(t(v));return Number.isFinite(x)?x:null};
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const median=a=>{const z=[...a].sort((x,y)=>x-y);if(!z.length)return null;const m=Math.floor(z.length/2);return z.length%2?z[m]:(z[m-1]+z[m])/2};
const rx=(s,re)=>{const m=t(s).match(re);return m?Number(m[1]):null};
const role=s=>rx(s,/live role overlay\s+([0-9.]+)x/i);
const slotAdj=s=>{const x=rx(s,/slot matchup[\s\S]*?applied\s+([+-]?[0-9.]+)%/i);return x==null?0:x/100};
const key=r=>`${t(r.Date)}|${t(r.Player)}`;
const prior=x=>x.position==="WR"?8.15:6.15;
const cfg=(le,s)=>({le:+le.toFixed(2),s:+s.toFixed(2)});
const fn=c=>x=>x.baseTargets*((1-c.le)*x.baseEff+c.le*prior(x))*(1+c.s*x.slotAdj);
const pct=x=>x==null?null:+(100*x).toFixed(1);

function met(a,f){if(!a.length)return{n:0,mae:null,medianAE:null,bias:null};const e=a.map(x=>Math.abs(x.actual-f(x)));return{n:a.length,mae:+mean(e).toFixed(3),medianAE:+median(e).toFixed(3),bias:+mean(a.map(x=>f(x)-x.actual)).toFixed(3)}}
function paired(a,f){if(!a.length)return{n:0,wins:0,losses:0,ties:0,winPct:null,meanAdvantage:null};const d=a.map(x=>Math.abs(x.actual-x.line)-Math.abs(x.actual-f(x))),wins=d.filter(x=>x>0).length,ties=d.filter(x=>x===0).length,losses=d.length-wins-ties;return{n:d.length,wins,losses,ties,winPct:pct(wins/Math.max(1,wins+losses)),meanAdvantage:+mean(d).toFixed(3)}}
function rec(a,f,min=16,side="ALL"){let w=0,l=0,p=0;for(const x of a){const y=f(x),g=y-x.line;if(100*Math.abs(g)/x.line<min)continue;if(side==="OVER"&&g<=0)continue;if(side==="UNDER"&&g>=0)continue;const ar=Math.sign(x.actual-x.line),pr=Math.sign(g);if(ar===0)p++;else if(ar===pr)w++;else l++}return{n:w+l+p,w,l,p,winPct:w+l?pct(w/(w+l)):null}}
function bootstrap(a,f,B=4000){if(!a.length)return null;const d=a.map(x=>Math.abs(x.actual-x.line)-Math.abs(x.actual-f(x)));let seed=2166136261>>>0;const vals=[];for(let b=0;b<B;b++){let s=0;for(let i=0;i<d.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;s+=d[seed%d.length]}vals.push(s/d.length)}vals.sort((x,y)=>x-y);const q=p=>vals[Math.max(0,Math.min(vals.length-1,Math.floor(p*(vals.length-1))))];return{mean:+mean(vals).toFixed(3),ci80:[+q(.1).toFixed(3),+q(.9).toFixed(3)],ci90:[+q(.05).toFixed(3),+q(.95).toFixed(3)],probModelBetter:+(100*vals.filter(x=>x>0).length/vals.length).toFixed(1)}}
function summary(a,f){return{candidate:met(a,f),market:met(a,x=>x.line),paired:paired(a,f),bootstrap:bootstrap(a,f),edges:{e16:rec(a,f,16),e20:rec(a,f,20),e25:rec(a,f,25),e30:rec(a,f,30),over16:rec(a,f,16,"OVER"),under16:rec(a,f,16,"UNDER"),over25:rec(a,f,25,"OVER"),under25:rec(a,f,25,"UNDER")}}}
function suite(a,c){return{config:c,...summary(a,fn(c))}}
const grid=()=>{const z=[];for(let i=0;i<=20;i++){const le=i*.05;for(let j=0;j<=12;j++)z.push(cfg(le,j*.25))}return z};
function rank(train,limit=8){return grid().map(c=>{const m=met(train,fn(c));return{config:c,mae:m.mae,bias:m.bias}}).sort((a,b)=>a.mae-b.mae||Math.abs(a.bias)-Math.abs(b.bias)||a.config.le-b.config.le||a.config.s-b.config.s).slice(0,limit)}
function best(train){return rank(train,1)[0]?.config??cfg(0,0)}
function forward(train,test){const c=best(train);return{selected:c,train:met(train,fn(c)),test:suite(test,c),topTrain:rank(train,5)}}

export async function GET(){
  const[rows,proj]=await Promise.all([readSportWorksheet("NFL","prop_tracker"),readSportWorksheet("NFL","prop_projections")]);
  const tm=new Map(),a=[];
  for(const r of proj){if(t(r.Market)!=="Targets")continue;const p=n(r.Projection),mi=n(r["Matchup Index"]);if(p!=null&&mi!=null&&mi>0)tm.set(key(r),{p,mi})}
  for(const r of rows){if(t(r.Market)!=="Receiving Yards"||!["RB","WR"].includes(t(r.Position)))continue;const projection=n(r.Projection),line=n(r["Market Line"]),actual=n(r["Actual Result"]),mi=n(r["Matchup Index"]),ro=role(r.Confluence),ft=n(r["Projected Targets"]),fe=n(r.Efficiency),at=n(r["Actual Targets"]),tr=tm.get(key(r)),c=t(r.Confluence);if(projection==null||line==null||line<=0||actual==null||mi==null||mi<=0||ro==null||ro<=0||ft==null||fe==null||at==null||!tr||!c.includes("slot matchup"))continue;const brt=tr.p/tr.mi,bt=brt/ro,opp=brt>0?ft/brt:1,ef=opp>0?mi/opp:1,be=ef>0?fe/ef:fe;a.push({date:t(r.Date),version:t(r["Model Version"]),player:t(r.Player),position:t(r.Position),slot:t(r.Slot),projection,line,actual,baseTargets:bt,baseEff:be,slotAdj:slotAdj(c)})}
  const pre=a.filter(x=>x.date<"2026-09-27"),v=a.filter(x=>x.version.includes("v4.18")),preWR=pre.filter(x=>x.position==="WR"),vWR=v.filter(x=>x.position==="WR");
  const calibrated=fn(cfg(.8,3));
  const current=x=>x.projection;
  const allWR=x=>x.position==="WR"?calibrated(x):current(x);
  const wr12=x=>x.position==="WR"&&["WR1","WR2"].includes(x.slot)?calibrated(x):current(x);
  const wr12Wr3Shrink=x=>x.position!=="WR"?current(x):(["WR1","WR2"].includes(x.slot)?calibrated(x):fn(cfg(.8,0))(x));
  const hybrid={current:summary(v,current),allWR80x3:summary(v,allWR),wr12_80x3_currentRest:summary(v,wr12),wr12_80x3_wr3_80x0_rbCurrent:summary(v,wr12Wr3Shrink)};
  const rowsOut=v.map(x=>({player:x.player,slot:x.slot,position:x.position,line:x.line,actual:x.actual,current:+current(x).toFixed(2),calibrated:+calibrated(x).toFixed(2),guarded:+wr12(x).toFixed(2),currentAE:+Math.abs(x.actual-current(x)).toFixed(2),guardedAE:+Math.abs(x.actual-wr12(x)).toFixed(2),edgePct:+(100*(wr12(x)-x.line)/x.line).toFixed(1)})).sort((a,b)=>b.currentAE-b.guardedAE-(a.currentAE-a.guardedAE));
  return NextResponse.json({counts:{pre:pre.length,v418:v.length,preWR:preWR.length,v418WR:vWR.length},forwardWR:forward(preWR,vWR),hybrid,rows:rowsOut});
}
