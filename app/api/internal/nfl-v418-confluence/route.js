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

function met(a,f){
  if(!a.length)return{n:0,mae:null,medianAE:null,bias:null};
  const e=a.map(x=>Math.abs(x.actual-f(x)));
  return{n:a.length,mae:+mean(e).toFixed(3),medianAE:+median(e).toFixed(3),bias:+mean(a.map(x=>f(x)-x.actual)).toFixed(3)};
}
function paired(a,f){
  if(!a.length)return{n:0,wins:0,losses:0,ties:0,winPct:null,meanAdvantage:null};
  const d=a.map(x=>Math.abs(x.actual-x.line)-Math.abs(x.actual-f(x)));
  const wins=d.filter(x=>x>0).length,ties=d.filter(x=>x===0).length,losses=d.length-wins-ties;
  return{n:d.length,wins,losses,ties,winPct:pct(wins/Math.max(1,wins+losses)),meanAdvantage:+mean(d).toFixed(3)};
}
function rec(a,f,min=16,side="ALL"){
  let w=0,l=0,p=0;
  for(const x of a){const y=f(x),g=y-x.line;if(100*Math.abs(g)/x.line<min)continue;if(side==="OVER"&&g<=0)continue;if(side==="UNDER"&&g>=0)continue;const ar=Math.sign(x.actual-x.line),pr=Math.sign(g);if(ar===0)p++;else if(ar===pr)w++;else l++}
  return{n:w+l+p,w,l,p,winPct:w+l?pct(w/(w+l)):null};
}
function bootstrap(a,f,B=4000){
  if(!a.length)return null;
  const d=a.map(x=>Math.abs(x.actual-x.line)-Math.abs(x.actual-f(x)));let seed=2166136261>>>0;const vals=[];
  for(let b=0;b<B;b++){let s=0;for(let i=0;i<d.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;s+=d[seed%d.length]}vals.push(s/d.length)}
  vals.sort((x,y)=>x-y);const q=p=>vals[Math.max(0,Math.min(vals.length-1,Math.floor(p*(vals.length-1))))];
  return{mean:+mean(vals).toFixed(3),ci80:[+q(.1).toFixed(3),+q(.9).toFixed(3)],ci90:[+q(.05).toFixed(3),+q(.95).toFixed(3)],probModelBetter:+(100*vals.filter(x=>x>0).length/vals.length).toFixed(1)};
}
function suite(a,c){const f=fn(c);return{config:c,candidate:met(a,f),market:met(a,x=>x.line),paired:paired(a,f),bootstrap:bootstrap(a,f),edges:{e16:rec(a,f,16),e20:rec(a,f,20),e25:rec(a,f,25),over16:rec(a,f,16,"OVER"),under16:rec(a,f,16,"UNDER")}}}
const grid=()=>{const z=[];for(let i=0;i<=20;i++){const le=i*.05;for(let j=0;j<=12;j++)z.push(cfg(le,j*.25))}return z};
function rank(train,limit=8){
  return grid().map(c=>{const m=met(train,fn(c));return{config:c,mae:m.mae,bias:m.bias}}).sort((a,b)=>a.mae-b.mae||Math.abs(a.bias)-Math.abs(b.bias)||a.config.le-b.config.le||a.config.s-b.config.s).slice(0,limit);
}
function best(train){return rank(train,1)[0]?.config??cfg(0,0)}
function dateCounts(a){const o={};for(const x of a)o[x.date]=(o[x.date]||0)+1;return o}
function dateCV(a){
  const dates=[...new Set(a.map(x=>x.date))].sort();if(dates.length<2)return{dates,folds:[],aggregate:null};
  const folds=[];let se=0,sm=0,w=0,l=0,p=0,nr=0;
  for(const d of dates){const train=a.filter(x=>x.date!==d),test=a.filter(x=>x.date===d),c=best(train),f=fn(c),cm=met(test,f),mm=met(test,x=>x.line),rr=rec(test,f,0);folds.push({date:d,n:test.length,selected:c,candidateMAE:cm.mae,marketMAE:mm.mae,delta:+(mm.mae-cm.mae).toFixed(3),record:rr});se+=cm.mae*test.length;sm+=mm.mae*test.length;w+=rr.w;l+=rr.l;p+=rr.p;nr+=test.length}
  return{dates,folds,aggregate:{n:nr,candidateMAE:+(se/nr).toFixed(3),marketMAE:+(sm/nr).toFixed(3),delta:+((sm-se)/nr).toFixed(3),record:{w,l,p,winPct:w+l?pct(w/(w+l)):null}}};
}
function forward(train,test){const c=best(train);return{selected:c,train:met(train,fn(c)),test:suite(test,c),topTrain:rank(train,5)}}

export async function GET(){
  const[rows,proj]=await Promise.all([readSportWorksheet("NFL","prop_tracker"),readSportWorksheet("NFL","prop_projections")]);
  const tm=new Map(),a=[];
  for(const r of proj){if(t(r.Market)!=="Targets")continue;const p=n(r.Projection),mi=n(r["Matchup Index"]);if(p!=null&&mi!=null&&mi>0)tm.set(key(r),{p,mi})}
  for(const r of rows){
    if(t(r.Market)!=="Receiving Yards"||!["RB","WR"].includes(t(r.Position)))continue;
    const projection=n(r.Projection),line=n(r["Market Line"]),actual=n(r["Actual Result"]),mi=n(r["Matchup Index"]),ro=role(r.Confluence),ft=n(r["Projected Targets"]),fe=n(r.Efficiency),at=n(r["Actual Targets"]),tr=tm.get(key(r)),c=t(r.Confluence);
    if(projection==null||line==null||line<=0||actual==null||mi==null||mi<=0||ro==null||ro<=0||ft==null||fe==null||at==null||!tr||!c.includes("slot matchup"))continue;
    const brt=tr.p/tr.mi,bt=brt/ro,opp=brt>0?ft/brt:1,ef=opp>0?mi/opp:1,be=ef>0?fe/ef:fe;
    a.push({date:t(r.Date),version:t(r["Model Version"]),player:t(r.Player),position:t(r.Position),slot:t(r.Slot),line,actual,baseTargets:bt,baseEff:be,slotAdj:slotAdj(c)});
  }
  const pre=a.filter(x=>x.date<"2026-09-27"),v=a.filter(x=>x.version.includes("v4.18")),preWR=pre.filter(x=>x.position==="WR"),vWR=v.filter(x=>x.position==="WR"),allWR=a.filter(x=>x.position==="WR");
  const fixed={neutral:cfg(0,0),eff75Only:cfg(.75,0),slot2Only:cfg(0,2),stable75x2:cfg(.75,2),stable80x2:cfg(.8,2),priorJoint80x3:cfg(.8,3),aggressive100x25:cfg(1,2.5)};
  const fixedOut={};for(const[name,c]of Object.entries(fixed))fixedOut[name]={pre:suite(pre,c),v418:suite(v,c),all:suite(a,c)};
  return NextResponse.json({counts:{all:a.length,pre:pre.length,v418:v.length,allWR:allWR.length,preWR:preWR.length,v418WR:vWR.length},dates:{all:dateCounts(a),pre:dateCounts(pre),v418:dateCounts(v)},fixed:fixedOut,grid:{preTop:rank(pre,8),v418Top:rank(v,8),allTop:rank(a,8),preWRTop:rank(preWR,8),v418WRTop:rank(vWR,8),allWRTop:rank(allWR,8)},forward:{preToV418:forward(pre,v),preWRToV418WR:forward(preWR,vWR)},dateCV:{all:dateCV(a),allWR:dateCV(allWR),v418:dateCV(v),v418WR:dateCV(vWR)}});
}
