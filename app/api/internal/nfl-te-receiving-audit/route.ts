import { NextResponse } from "next/server";
import { readSportWorksheet } from "../../../../lib/sportSheets";
export const dynamic="force-dynamic";export const revalidate=0;
type Row=Record<string,string>;
type R={date:string;player:string;line:number;rawLine:number;projection:number;actual:number;opp:number|null;eff:number|null;version:string};
const t=(v:unknown)=>String(v??"").trim();
const n=(v:unknown)=>{const x=Number(t(v));return Number.isFinite(x)?x:null};
const mean=(a:number[])=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const med=(a:number[])=>{if(!a.length)return null;const z=[...a].sort((a,b)=>a-b),m=Math.floor(z.length/2);return z.length%2?z[m]:(z[m-1]+z[m])/2};
const round=(x:number|null,d=3)=>x==null?null:Number(x.toFixed(d));
const pct=(x:number|null)=>x==null?null:Number((100*x).toFixed(1));
const normLine=(x:number)=>x>150&&x<1000?x/10:x;
const current=(x:R)=>x.projection;
const cfg=(os:number,le:number,p:number)=>({os:Number(os.toFixed(2)),le:Number(le.toFixed(2)),p:Number(p.toFixed(2))});
const candidate=(c:{os:number;le:number;p:number})=>(x:R)=>{
  if(x.eff==null||x.eff<=0)return x.projection*c.os;
  const shrunk=(1-c.le)*x.eff+c.le*c.p;
  return x.projection*c.os*(shrunk/x.eff);
};
function metrics(a:R[],f:(x:R)=>number){if(!a.length)return{n:0,mae:null,medianAE:null,bias:null};const e=a.map(x=>Math.abs(x.actual-f(x)));return{n:a.length,mae:round(mean(e)),medianAE:round(med(e)),bias:round(mean(a.map(x=>f(x)-x.actual)))}};
function rec(a:R[],f:(x:R)=>number,min=16,side="ALL"){let w=0,l=0,p=0;for(const x of a){if(x.line<=0)continue;const y=f(x),g=y-x.line;if(100*Math.abs(g)/x.line<min)continue;if(side==="OVER"&&g<=0)continue;if(side==="UNDER"&&g>=0)continue;const ar=Math.sign(x.actual-x.line),pr=Math.sign(g);if(ar===0)p++;else if(ar===pr)w++;else l++}return{n:w+l+p,w,l,p,winPct:w+l?pct(w/(w+l)):null}};
function paired(a:R[],f:(x:R)=>number){const z=a.filter(x=>x.line>0);if(!z.length)return{n:0,wins:0,losses:0,ties:0,winPct:null,meanAdvantage:null};const d=z.map(x=>Math.abs(x.actual-x.line)-Math.abs(x.actual-f(x))),wins=d.filter(x=>x>0).length,ties=d.filter(x=>x===0).length,losses=d.length-wins-ties;return{n:d.length,wins,losses,ties,winPct:pct(wins/Math.max(1,wins+losses)),meanAdvantage:round(mean(d))}};
function suite(a:R[],f:(x:R)=>number){return{metrics:metrics(a,f),market:metrics(a.filter(x=>x.line>0),x=>x.line),paired:paired(a,f),edges:{e16:rec(a,f,16),e20:rec(a,f,20),e25:rec(a,f,25),e30:rec(a,f,30),over16:rec(a,f,16,"OVER"),under16:rec(a,f,16,"UNDER")}}};
function grid(){const z:{os:number;le:number;p:number}[]=[];for(let i=0;i<=16;i++)for(let j=0;j<=10;j++)for(let k=0;k<=12;k++)z.push(cfg(.6+i*.05,j*.1,6.5+k*.25));return z}
function rank(a:R[],limit=12){if(!a.length)return[];return grid().map(c=>({config:c,...metrics(a,candidate(c))})).sort((a,b)=>(a.mae??999)-(b.mae??999)||Math.abs(a.bias??999)-Math.abs(b.bias??999)).slice(0,limit)}
function best(a:R[]){return rank(a,1)[0]?.config??cfg(1,0,8.15)};
function fixed(a:R[]){const defs:Record<string,(x:R)=>number>={
  current,
  opp80:candidate(cfg(.8,0,8.15)),opp90:candidate(cfg(.9,0,8.15)),opp95:candidate(cfg(.95,0,8.15)),opp105:candidate(cfg(1.05,0,8.15)),opp110:candidate(cfg(1.1,0,8.15)),
  shrink50_815:candidate(cfg(1,.5,8.15)),shrink80_815:candidate(cfg(1,.8,8.15)),full815:candidate(cfg(1,1,8.15)),
  opp90Shrink50:candidate(cfg(.9,.5,8.15)),opp90Shrink80:candidate(cfg(.9,.8,8.15)),opp95Shrink50:candidate(cfg(.95,.5,8.15))
};return Object.fromEntries(Object.entries(defs).map(([k,f])=>[k,suite(a,f)]))}
function dateCV(a:R[]){const dates=[...new Set(a.map(x=>x.date))].sort(),folds:any[]=[];let se=0,sc=0,sm=0,N=0;for(const d of dates){const tr=a.filter(x=>x.date!==d),te=a.filter(x=>x.date===d);if(!tr.length||!te.length)continue;const c=best(tr),f=candidate(c),cm=metrics(te,f),cur=metrics(te,current),mk=metrics(te.filter(x=>x.line>0),x=>x.line);folds.push({date:d,n:te.length,selected:c,candidateMAE:cm.mae,currentMAE:cur.mae,marketMAE:mk.mae,record:rec(te,f,0)});se+=(cm.mae??0)*te.length;sc+=(cur.mae??0)*te.length;sm+=(mk.mae??0)*te.length;N+=te.length}return{dates,folds,aggregate:N?{n:N,candidateMAE:round(se/N),currentMAE:round(sc/N),marketMAE:round(sm/N)}:null}}
export async function GET(){
 const [cal,tracker]=await Promise.all([readSportWorksheet("NFL","prop_calibration") as Promise<Row[]>,readSportWorksheet("NFL","prop_tracker") as Promise<Row[]>]);
 const rows:R[]=[];const corrected:any[]=[];const seen=new Set<string>();let firstKeys:string[]=[];
 for(const c of cal){if(t(c.Market)!=="Receiving Yards"||t(c.Slot)!=="TE1")continue;if(!firstKeys.length)firstKeys=Object.keys(c);const projection=n(c.Projection),actual=n(c["Actual Result"]),rawLine=n(c["Market Line"]);if(projection==null||actual==null||rawLine==null)continue;const key=`${t(c.Date)}|${t(c.Player)}|${projection}`;if(seen.has(key))continue;seen.add(key);const line=normLine(rawLine);if(line!==rawLine)corrected.push({date:t(c.Date),player:t(c.Player),rawLine,line});const opp=n(c["Projected Opportunity"]??c["Projected Targets"]),eff=n(c["Projected Efficiency"]??c.Efficiency);rows.push({date:t(c.Date),player:t(c.Player),line,rawLine,projection,actual,opp,eff,version:t(c["Model Version"])});}
 rows.sort((a,b)=>a.date.localeCompare(b.date)||a.player.localeCompare(b.player));
 const usable=rows.filter(x=>x.eff!=null&&x.eff>0),pre=usable.filter(x=>x.date<"2026-09-27"),hold=usable.filter(x=>x.date==="2026-09-27"),selected=best(pre),sf=candidate(selected);
 const trackerTE=tracker.filter(r=>t(r.Market)==="Receiving Yards"&&t(r.Slot)==="TE1");
 const byDate=Object.fromEntries([...new Set(usable.map(x=>x.date))].sort().map(d=>{const z=usable.filter(x=>x.date===d);return[d,{n:z.length,current:metrics(z,current),market:metrics(z,x=>x.line)}]}));
 const outliers=[...usable].sort((a,b)=>Math.abs(b.actual-b.projection)-Math.abs(a.actual-a.projection)).slice(0,12).map(x=>({date:x.date,player:x.player,line:x.line,projection:x.projection,actual:x.actual,opp:x.opp,eff:x.eff,error:round(Math.abs(x.actual-x.projection))}));
 return NextResponse.json({counts:{completed:rows.length,usable:usable.length,pre:pre.length,holdout:hold.length,trackerTE1:trackerTE.length,dates:Object.fromEntries([...new Set(usable.map(x=>x.date))].map(d=>[d,usable.filter(x=>x.date===d).length]))},correctedLines:corrected,calibrationKeys:firstKeys,trackerSample:trackerTE.slice(0,4),selectedOnPre:selected,current:{all:suite(usable,current),pre:suite(pre,current),holdout:suite(hold,current)},fixed:{all:fixed(usable),pre:fixed(pre),holdout:fixed(hold)},selected:{pre:suite(pre,sf),holdout:suite(hold,sf),all:suite(usable,sf)},topPre:rank(pre,12),topAll:rank(usable,12),dateCV:dateCV(usable),byDate,outliers});
}
