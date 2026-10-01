import { NextResponse } from "next/server";
import { readSportWorksheet } from "../../../../lib/sportSheets";

export const dynamic="force-dynamic";
export const revalidate=0;
type Row=Record<string,string>;
type R={date:string;player:string;slot:string;line:number;projection:number;actual:number;targets:number;actualTargets:number|null;eff:number;role:number;routes:number|null;routePart:number|null;tprr:number|null};
const text=(v:unknown)=>String(v??"").trim();
const num=(v:unknown)=>{const n=Number(text(v));return Number.isFinite(n)?n:null};
const round=(v:number|null,d=2)=>v==null?null:Number(v.toFixed(d));
const mean=(a:number[])=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const key=(r:Row,withLine=false)=>`${text(r.Date)}|${text(r.Player)}|${text(r.Market)}${withLine?`|${text(r["Market Line"])}`:""}`;
const role=(s:unknown)=>{const m=text(s).match(/live role(?:\/injury)? overlay\s+([0-9.]+)x/i);return m?Number(m[1]):1};
function result(r:R,p:number){if(r.actual===r.line)return"P";return p>=r.line?(r.actual>r.line?"W":"L"):(r.actual<r.line?"W":"L")}
function summary(rows:R[],fn:(r:R)=>number){let w=0,l=0,p=0;const ae:number[]=[],te:number[]=[];for(const r of rows){const pr=Math.max(0,fn(r));ae.push(Math.abs(r.actual-pr));const rr=result(r,pr);if(rr==="W")w++;else if(rr==="L")l++;else p++;const nt=r.targets>0?r.targets*(pr/r.projection):r.targets;if(r.actualTargets!=null)te.push(Math.abs(r.actualTargets-nt));}return{n:rows.length,mae:round(mean(ae)),targetMae:round(mean(te)),record:`${w}-${l}-${p}`,winPct:w+l?round(100*w/(w+l),1):null}}

type C={lowCut:number;routeCut:number;tprrCut:number;targetCut:number;alpha:number;cap:number;mode:"route"|"tprr"|"target"|"route+tprr"|"any"};
function qualifies(r:R,c:C){if(!(r.role<c.lowCut))return false;const a=r.routePart!=null&&r.routePart>=c.routeCut;const b=r.tprr!=null&&r.tprr>=c.tprrCut;const d=r.targets>=c.targetCut;if(c.mode==="route")return a;if(c.mode==="tprr")return b;if(c.mode==="target")return d;if(c.mode==="route+tprr")return a&&b;return a||b||d;}
function projection(r:R,c:C){if(!qualifies(r,c)||r.role<=0||r.role>=1||r.targets<=0)return r.projection;const preRole=r.targets/r.role;const restore=Math.min(c.cap,Math.max(0,preRole-r.targets)*c.alpha);const nt=r.targets+restore;return r.projection*(nt/r.targets);}
function grid(train:R[]){const out:{c:C;s:ReturnType<typeof summary>}[]=[];for(const lowCut of [0.8,0.85,0.9,0.95])for(const routeCut of [0.4,0.5,0.6,0.7])for(const tprrCut of [0.08,0.10,0.12,0.14])for(const targetCut of [2.5,3,3.5,4])for(const alpha of [0.25,0.5,0.75,1])for(const cap of [0.5,1,1.5,2])for(const mode of ["route","tprr","target","route+tprr","any"] as const){const c={lowCut,routeCut,tprrCut,targetCut,alpha,cap,mode};const s=summary(train,r=>projection(r,c));out.push({c,s});}out.sort((a,b)=>(a.s.mae??999)-(b.s.mae??999)||(a.s.targetMae??999)-(b.s.targetMae??999));return out;}

export async function GET(){
 const [cal,proj]=await Promise.all([readSportWorksheet("NFL","prop_calibration") as Promise<Row[]>,readSportWorksheet("NFL","prop_projections") as Promise<Row[]>]);
 const exact=new Map<string,Row>(),fallback=new Map<string,Row>();for(const p of proj){if(text(p.Market)!=="Receiving Yards"||text(p.Position)!=="RB")continue;exact.set(key(p,true),p);fallback.set(key(p,false),p)}
 const rows:R[]=[];const seen=new Set<string>();
 for(const c of cal){if(text(c.Market)!=="Receiving Yards"||text(c.Position)!=="RB")continue;const line=num(c["Market Line"]),projection=num(c.Projection),actual=num(c["Actual Result"]),targets=num(c["Projected Opportunity"]),eff=num(c["Projected Efficiency"]);if(line==null||projection==null||actual==null||targets==null||eff==null||line<=0||targets<=0)continue;const dedupe=`${key(c,true)}|${projection}`;if(seen.has(dedupe))continue;seen.add(dedupe);const p=exact.get(key(c,true))||fallback.get(key(c,false))||{};rows.push({date:text(c.Date),player:text(c.Player),slot:text(p.Slot),line,projection,actual,targets,actualTargets:num(c["Actual Opportunity"]),eff,role:role(p.Confluence),routes:num(p["Projected Routes"]),routePart:num(p["Route Participation"]),tprr:num(p["Targets Per Route"])});}
 rows.sort((a,b)=>a.date.localeCompare(b.date)||a.player.localeCompare(b.player));const pre=rows.filter(r=>r.date<"2026-09-27"),holdout=rows.filter(r=>r.date==="2026-09-27");const ranked=grid(pre);const best=ranked[0];
 const simple:C={lowCut:0.9,routeCut:0.5,tprrCut:0.10,targetCut:3,alpha:1,cap:2,mode:"route+tprr"};
 const gibbs=rows.filter(r=>/jahmyr\s+gibbs/i.test(r.player));
 return NextResponse.json({counts:{all:rows.length,pre:pre.length,holdout:holdout.length},fieldCoverage:{routes:rows.filter(r=>r.routes!=null).length,routePart:rows.filter(r=>r.routePart!=null).length,tprr:rows.filter(r=>r.tprr!=null).length},current:{all:summary(rows,r=>r.projection),pre:summary(pre,r=>r.projection),holdout:summary(holdout,r=>r.projection)},selected:{rule:best.c,train:best.s,holdout:summary(holdout,r=>projection(r,best.c)),all:summary(rows,r=>projection(r,best.c))},simple:{rule:simple,train:summary(pre,r=>projection(r,simple)),holdout:summary(holdout,r=>projection(r,simple)),all:summary(rows,r=>projection(r,simple))},top10:ranked.slice(0,10),gibbs:gibbs.map(r=>({date:r.date,line:r.line,current:r.projection,actual:r.actual,targets:r.targets,actualTargets:r.actualTargets,role:r.role,routes:r.routes,routePart:r.routePart,tprr:r.tprr,selectedProjection:round(projection(r,best.c)),simpleProjection:round(projection(r,simple))}))});
}
