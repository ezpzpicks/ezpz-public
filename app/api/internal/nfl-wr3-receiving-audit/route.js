import {NextResponse} from "next/server";
import {readSportWorksheet} from "../../../../lib/sportSheets";
export const dynamic="force-dynamic";export const revalidate=0;

const t=v=>String(v??"").trim();
const n=v=>{const x=Number(t(v));return Number.isFinite(x)?x:null};
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const median=a=>{const z=[...a].sort((x,y)=>x-y);if(!z.length)return null;const m=Math.floor(z.length/2);return z.length%2?z[m]:(z[m-1]+z[m])/2};
const rx=(s,re)=>{const m=t(s).match(re);return m?Number(m[1]):null};
const role=s=>rx(s,/live role(?:\/injury)? overlay\s+([0-9.]+)x/i);
const slotAdj=s=>{const x=rx(s,/slot matchup[\s\S]*?applied\s+([+-]?[0-9.]+)%/i);return x==null?0:x/100};
const key=r=>`${t(r.Date)}|${t(r.Player)}`;
const pct=x=>x==null?null:+(100*x).toFixed(1);
const round=(x,d=3)=>x==null?null:+x.toFixed(d);
const PRIOR=8.15;

function cfg(le,s){return{le:+le.toFixed(2),s:+s.toFixed(2)}}
function candidate(c){return x=>x.baseTargets*((1-c.le)*x.baseEff+c.le*PRIOR)*(1+c.s*x.slotAdj)}
const current=x=>x.projection;
const noRole=x=>x.role>0?x.projection/x.role:x.projection;
const shrink80=x=>x.baseEff>0?x.projection*((.2*x.baseEff+.8*PRIOR)/x.baseEff):x.projection;
const noRoleShrink80=x=>x.role>0?shrink80(x)/x.role:shrink80(x);

function met(a,f){if(!a.length)return{n:0,mae:null,medianAE:null,bias:null};const e=a.map(x=>Math.abs(x.actual-f(x)));return{n:a.length,mae:round(mean(e)),medianAE:round(median(e)),bias:round(mean(a.map(x=>f(x)-x.actual)))}}
function paired(a,f){if(!a.length)return{n:0,wins:0,losses:0,ties:0,winPct:null,meanAdvantage:null};const d=a.map(x=>Math.abs(x.actual-x.line)-Math.abs(x.actual-f(x))),w=d.filter(x=>x>0).length,p=d.filter(x=>x===0).length,l=d.length-w-p;return{n:d.length,wins:w,losses:l,ties:p,winPct:w+l?pct(w/(w+l)):null,meanAdvantage:round(mean(d))}}
function rec(a,f,min=16,side="ALL"){let w=0,l=0,p=0;for(const x of a){const y=f(x),g=y-x.line;if(100*Math.abs(g)/x.line<min)continue;if(side==="OVER"&&g<=0)continue;if(side==="UNDER"&&g>=0)continue;const ar=Math.sign(x.actual-x.line),pr=Math.sign(g);if(ar===0)p++;else if(ar===pr)w++;else l++}return{n:w+l+p,w,l,p,winPct:w+l?pct(w/(w+l)):null}}
function suite(a,f){return{metrics:met(a,f),market:met(a,x=>x.line),paired:paired(a,f),edges:{e16:rec(a,f,16),e20:rec(a,f,20),e25:rec(a,f,25),e30:rec(a,f,30),over16:rec(a,f,16,"OVER"),under16:rec(a,f,16,"UNDER"),over25:rec(a,f,25,"OVER"),under25:rec(a,f,25,"UNDER")}}}
function grid(){const out=[];for(let i=0;i<=20;i++){const le=i*.05;for(let j=0;j<=12;j++)out.push(cfg(le,j*.25))}return out}
function rank(train,limit=10){return grid().map(c=>{const m=met(train,candidate(c));return{config:c,mae:m.mae,bias:m.bias}}).sort((a,b)=>(a.mae??999)-(b.mae??999)||Math.abs(a.bias??999)-Math.abs(b.bias??999)||a.config.le-b.config.le||a.config.s-b.config.s).slice(0,limit)}
function best(train){return rank(train,1)[0]?.config??cfg(0,0)}
function dateCounts(a){const o={};for(const x of a)o[x.date]=(o[x.date]||0)+1;return o}
function dateCV(a){const dates=[...new Set(a.map(x=>x.date))].sort();if(dates.length<2)return{dates,folds:[],aggregate:null};const folds=[];let err=0,marketErr=0,nr=0,w=0,l=0,p=0;for(const d of dates){const tr=a.filter(x=>x.date!==d),te=a.filter(x=>x.date===d);if(!tr.length||!te.length)continue;const c=best(tr),f=candidate(c),cm=met(te,f),mm=met(te,x=>x.line),rr=rec(te,f,0);folds.push({date:d,n:te.length,selected:c,candidateMAE:cm.mae,marketMAE:mm.mae,currentMAE:met(te,current).mae,record:rr});err+=(cm.mae??0)*te.length;marketErr+=(mm.mae??0)*te.length;nr+=te.length;w+=rr.w;l+=rr.l;p+=rr.p}return{dates,folds,aggregate:nr?{n:nr,candidateMAE:round(err/nr),marketMAE:round(marketErr/nr),record:{w,l,p,winPct:w+l?pct(w/(w+l)):null}}:null}}
function summary(a){const fixed={current,removeRole:noRole,shrink80,removeRolePlusShrink80:noRoleShrink80,exactOnly0:candidate(cfg(0,0)),exactOnly1:candidate(cfg(0,1)),exactOnly2:candidate(cfg(0,2)),exactOnly3:candidate(cfg(0,3)),wr12Formula:candidate(cfg(.8,3)),shrink80NoSlot:candidate(cfg(.8,0)),shrink80Slot1:candidate(cfg(.8,1)),shrink80Slot2:candidate(cfg(.8,2))};const out={};for(const[k,f]of Object.entries(fixed))out[k]=suite(a,f);return out}

export async function GET(){
  const[rows,proj]=await Promise.all([readSportWorksheet("NFL","prop_tracker"),readSportWorksheet("NFL","prop_projections")]);
  const tm=new Map(),a=[];
  for(const r of proj){if(t(r.Market)!=="Targets"||t(r.Position)!=="WR")continue;const p=n(r.Projection),mi=n(r["Matchup Index"]);if(p!=null&&mi!=null&&mi>0)tm.set(key(r),{p,mi})}
  for(const r of rows){
    if(t(r.Market)!=="Receiving Yards"||t(r.Position)!=="WR"||t(r.Slot)!=="WR3")continue;
    const projection=n(r.Projection),line=n(r["Market Line"]),actual=n(r["Actual Result"]),mi=n(r["Matchup Index"]),ro=role(r.Confluence),ft=n(r["Projected Targets"]),fe=n(r.Efficiency),at=n(r["Actual Targets"]),tr=tm.get(key(r)),c=t(r.Confluence);
    if(projection==null||line==null||line<=0||actual==null||mi==null||mi<=0||ro==null||ro<=0||ft==null||fe==null||at==null||!tr||!c.includes("slot matchup"))continue;
    const roleTargets=tr.p/tr.mi;
    const baseTargets=roleTargets/ro;
    const oppFactor=roleTargets>0?ft/roleTargets:1;
    const effFactor=oppFactor>0?mi/oppFactor:1;
    const baseEff=effFactor>0?fe/effFactor:fe;
    a.push({date:t(r.Date),version:t(r["Model Version"]),player:t(r.Player),team:t(r.Team),line,actual,projection,role:ro,finalTargets:ft,actualTargets:at,finalEff:fe,baseTargets,baseEff,oppFactor,effFactor,slotAdj:slotAdj(c)});
  }
  a.sort((x,y)=>x.date.localeCompare(y.date)||x.player.localeCompare(y.player));
  const pre=a.filter(x=>x.date<"2026-09-27"),hold=a.filter(x=>x.date==="2026-09-27"),v418=a.filter(x=>x.version.includes("v4.18"));
  const selected=best(pre),selectedFn=candidate(selected);
  const examples=[...a].sort((x,y)=>Math.abs(y.actual-y.projection)-Math.abs(x.actual-x.projection)).slice(0,12).map(x=>({date:x.date,player:x.player,line:x.line,actual:x.actual,current:round(x.projection,2),role:x.role,baseTargets:round(x.baseTargets,2),baseEff:round(x.baseEff,2),slotAdj:pct(x.slotAdj),removeRole:round(noRole(x),2),wr12Formula:round(candidate(cfg(.8,3))(x),2),selected:round(selectedFn(x),2)}));
  return NextResponse.json({
    counts:{all:a.length,pre:pre.length,holdout:hold.length,v418:v418.length,dates:dateCounts(a)},
    selectedOnPre:selected,
    current:{all:suite(a,current),pre:suite(pre,current),holdout:suite(hold,current)},
    fixed:{all:summary(a),pre:summary(pre),holdout:summary(hold)},
    selected:{pre:suite(pre,selectedFn),holdout:suite(hold,selectedFn),all:suite(a,selectedFn)},
    topPre:rank(pre,12),
    topAll:rank(a,12),
    dateCV:dateCV(a),
    examples
  });
}
