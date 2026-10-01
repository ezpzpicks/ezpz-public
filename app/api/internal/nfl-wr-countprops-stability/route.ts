import { NextResponse } from "next/server";
import { readSportWorksheet } from "../../../../lib/sportSheets";
export const dynamic="force-dynamic"; export const revalidate=0;
type Row=Record<string,string>; type M="Targets"|"Receptions";
type R={date:string;player:string;market:M;projection:number;actual:number;targets:number;role:number};
const t=(v:unknown)=>String(v??"").trim();
const n=(v:unknown)=>{const x=Number(t(v));return Number.isFinite(x)?x:null};
const k=(r:Row,m?:string)=>`${t(r.Date)}|${t(r.Player)}|${m??t(r.Market)}`;
const pk=(r:Row)=>`${t(r.Date)}|${t(r.Player)}`;
const roleMaybe=(v:unknown)=>{const m=t(v).match(/(?:removed\s+)?live role(?:\/injury)? overlay\s+([0-9.]+)x/i);return m&&Number(m[1])>0?Number(m[1]):null};
const mae=(a:R[],f:(r:R)=>number)=>a.length?Number((a.reduce((s,r)=>s+Math.abs(r.actual-f(r)),0)/a.length).toFixed(3)):null;
const bias=(a:R[],f:(r:R)=>number)=>a.length?Number((a.reduce((s,r)=>s+f(r)-r.actual,0)/a.length).toFixed(3)):null;
const candidateTarget=(r:R)=>r.targets/Math.sqrt(Math.max(r.role,0.05));
const candidate=(r:R)=>r.market==="Targets"?candidateTarget(r):r.projection*(candidateTarget(r)/r.targets);
const summary=(a:R[])=>({n:a.length,currentMAE:mae(a,r=>r.projection),candidateMAE:mae(a,candidate),delta:a.length?Number(((mae(a,r=>r.projection)??0)-(mae(a,candidate)??0)).toFixed(3)):null,currentBias:bias(a,r=>r.projection),candidateBias:bias(a,candidate)});
export async function GET(){
 const [cal,proj]=await Promise.all([readSportWorksheet("NFL","prop_calibration") as Promise<Row[]>,readSportWorksheet("NFL","prop_projections") as Promise<Row[]>]);
 const pm=new Map<string,Row>(),rm=new Map<string,Row>(),slot=new Map<string,string>();
 for(const p of proj){if(t(p.Position)!=="WR")continue;pm.set(k(p),p);if(t(p.Slot))slot.set(pk(p),t(p.Slot).toUpperCase());if(t(p.Market)==="Receiving Yards")rm.set(pk(p),p);}
 const rows:R[]=[];const seen=new Set<string>();
 for(const c of cal){const market=t(c.Market) as M;if(t(c.Position)!=="WR"||(market!=="Targets"&&market!=="Receptions"))continue;const p=pm.get(k(c))||{},recv=rm.get(pk(c))||{};const s=(t(c.Slot)||t(p.Slot)||t(recv.Slot)||slot.get(pk(c))||"").toUpperCase();if(s!=="WR2")continue;const projection=n(c.Projection),actual=n(c["Actual Result"]);if(projection==null||actual==null)continue;const targets=n(p["Projected Targets"])??(market==="Targets"?projection:n(recv["Projected Targets"]));if(targets==null||targets<=0)continue;const d=`${k(c)}|${projection}`;if(seen.has(d))continue;seen.add(d);const ro=roleMaybe(p.Confluence)??roleMaybe(recv.Confluence)??1;rows.push({date:t(c.Date),player:t(c.Player),market,projection,actual,targets,role:ro});}
 const dates=[...new Set(rows.map(r=>r.date))].sort();
 const byDate=dates.map(date=>{const a=rows.filter(r=>r.date===date),ta=a.filter(r=>r.market==="Targets"),ra=a.filter(r=>r.market==="Receptions");return{date,all:summary(a),targets:summary(ta),receptions:summary(ra)};});
 const pre=rows.filter(r=>r.date<"2026-09-27"),hold=rows.filter(r=>r.date==="2026-09-27");
 const bands={suppressive:rows.filter(r=>r.role<0.9),neutral:rows.filter(r=>r.role>=0.9&&r.role<=1.1),boosting:rows.filter(r=>r.role>1.1)};
 return NextResponse.json({rule:"WR2 target *= role^-0.5; Receptions scaled by same target factor; catch rate unchanged",counts:{all:rows.length,pre:pre.length,holdout:hold.length},pre:{all:summary(pre),targets:summary(pre.filter(r=>r.market==="Targets")),receptions:summary(pre.filter(r=>r.market==="Receptions"))},holdout:{all:summary(hold),targets:summary(hold.filter(r=>r.market==="Targets")),receptions:summary(hold.filter(r=>r.market==="Receptions"))},bands:{suppressive:summary(bands.suppressive),neutral:summary(bands.neutral),boosting:summary(bands.boosting)},byDate});
}
