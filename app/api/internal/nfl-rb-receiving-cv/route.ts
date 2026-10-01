import { NextResponse } from "next/server";
import { readSportWorksheet } from "../../../../lib/sportSheets";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Row = Record<string, string>;
type R = {date:string;player:string;slot:string;line:number;projection:number;actual:number;role:number;match:number;eff:number;version:string};
const t=(v:unknown)=>String(v??"").trim();
const n=(v:unknown)=>{const x=Number(t(v));return Number.isFinite(x)?x:null};
const mean=(a:number[])=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const med=(a:number[])=>{if(!a.length)return null;const z=[...a].sort((a,b)=>a-b),m=Math.floor(z.length/2);return z.length%2?z[m]:(z[m-1]+z[m])/2};
const rd=(x:number|null,d=2)=>x==null?null:+x.toFixed(d);
const key=(r:Row)=>`${t(r.Date)}|${t(r.Player)}|${t(r.Market)}`;
function role(c:unknown){const m=t(c).match(/live role(?:\/injury)? overlay\s+([0-9.]+)x/i);return m?Number(m[1]):1}
const variants={
  current:(r:R)=>r.projection,
  noRole:(r:R)=>r.projection/Math.max(.01,r.role),
  noMatchup:(r:R)=>r.projection/Math.max(.01,r.match),
  noRoleNoMatchup:(r:R)=>r.projection/Math.max(.01,r.role*r.match),
  halfRoleHalfMatchup:(r:R)=>r.projection/Math.max(.01,r.role*r.match)*(1+.5*(r.role-1))*(1+.5*(r.match-1)),
  noRoleYptPrior80:(r:R)=>{
    const targets=r.eff>0?r.projection/r.eff:0;
    return (targets/Math.max(.01,r.role))*(.2*r.eff+.8*6.15);
  },
};
function result(r:R,p:number){if(r.actual===r.line)return"P";return p>=r.line?(r.actual>r.line?"W":"L"):(r.actual<r.line?"W":"L")}
function stat(a:R[],fn:(r:R)=>number){let w=0,l=0,p=0;const ae:number[]=[],res:number[]=[];for(const r of a){const y=Math.max(0,fn(r));ae.push(Math.abs(r.actual-y));res.push(r.actual-y);const z=result(r,y);if(z==="W")w++;else if(z==="L")l++;else p++}return{n:a.length,mae:rd(mean(ae)),medianAE:rd(med(ae)),bias:rd(mean(res)),record:`${w}-${l}-${p}`,winPct:w+l?rd(100*w/(w+l),1):null}}
function suite(a:R[]){return Object.fromEntries(Object.entries(variants).map(([k,f])=>[k,stat(a,f)]))}
function best(a:R[]){const z=Object.entries(suite(a)).filter(([k])=>k!=="current").sort((x:any,y:any)=>x[1].mae-y[1].mae);return z[0]?.[0]||"current"}

export async function GET(){
  const [cal,proj]=await Promise.all([readSportWorksheet("NFL","prop_calibration") as Promise<Row[]>,readSportWorksheet("NFL","prop_projections") as Promise<Row[]>]);
  const pm=new Map<string,Row>();for(const p of proj){if(t(p.Market)==="Receiving Yards"&&t(p.Position)==="RB")pm.set(key(p),p)}
  const seen=new Set<string>(),rows:R[]=[];
  for(const c of cal){if(t(c.Market)!=="Receiving Yards"||t(c.Position)!=="RB")continue;const line=n(c["Market Line"]),projection=n(c.Projection),actual=n(c["Actual Result"]);if(line==null||line<=0||projection==null||actual==null)continue;const d=`${key(c)}|${line}|${projection}`;if(seen.has(d))continue;seen.add(d);const p=pm.get(key(c))||{};const eff=n(c["Projected Efficiency"])??n(p.Efficiency)??(n(c["Projected Opportunity"])!>0?projection/(n(c["Projected Opportunity"])||1):6.15);rows.push({date:t(c.Date),player:t(c.Player),slot:t(p.Slot),line,projection,actual,role:role(p.Confluence),match:n(p["Matchup Index"])||1,eff:eff||6.15,version:t(c["Model Version"]||p["Model Version"])})}
  rows.sort((a,b)=>a.date.localeCompare(b.date)||a.player.localeCompare(b.player));
  const dates=[...new Set(rows.map(r=>r.date))].sort();
  const byDate=Object.fromEntries(dates.map(d=>[d,suite(rows.filter(r=>r.date===d))]));
  const pre27=rows.filter(r=>r.date<"2026-09-27"),holdout27=rows.filter(r=>r.date==="2026-09-27");
  const selected=best(pre27);const selectedFn=(variants as any)[selected] as (r:R)=>number;
  const loo=dates.map(d=>{const train=rows.filter(r=>r.date!==d),test=rows.filter(r=>r.date===d),choice=best(train),fn=(variants as any)[choice] as (r:R)=>number;return{date:d,n:test.length,selected:choice,test:stat(test,fn),current:stat(test,variants.current),market:stat(test,r=>r.line)}});
  const agg=(name:"test"|"current"|"market")=>{let n0=0,se=0;for(const f of loo){const s=(f as any)[name];n0+=s.n;se+=s.mae*s.n}return{n:n0,mae:rd(n0?se/n0:null)}};
  return NextResponse.json({counts:{all:rows.length,pre27:pre27.length,holdout27:holdout27.length,RB1:rows.filter(r=>r.slot==="RB1").length,RB2:rows.filter(r=>r.slot==="RB2").length},pre27:{suite:suite(pre27),selected},holdout27:{suite:suite(holdout27),selectedFromPre27:selected,selectedResult:stat(holdout27,selectedFn)},slot:{RB1:suite(rows.filter(r=>r.slot==="RB1")),RB2:suite(rows.filter(r=>r.slot==="RB2"))},roleGroups:{low:suite(rows.filter(r=>r.role<.9)),neutral:suite(rows.filter(r=>r.role>=.9&&r.role<=1.1)),high:suite(rows.filter(r=>r.role>1.1))},byDate,leaveOneDateOut:{folds:loo,aggregate:{selected:agg("test"),current:agg("current"),market:agg("market")}}});
}
