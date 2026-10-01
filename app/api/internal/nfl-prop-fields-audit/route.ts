import { NextResponse } from "next/server";
import { readSportWorksheet } from "../../../../lib/sportSheets";

export const runtime = "nodejs";
export const dynamic = "force-static";
export const revalidate = false;

type Row = Record<string, string>;
type Item = {
  date:string; player:string; market:string; side:string; line:number; projection:number; result:string;
  slot:string; roleConfidence:number|null; reliability:number|null; modelVersion:string; tier:string;
  savedAt:string; stressToLine:number|null; oppHigh:number; effHigh:number; maxOppAmp:number|null; maxEffAmp:number|null;
  priorOppErrPct:number|null; priorOppSignedPct:number|null; prior2OppMaePct:number|null;
};
const txt=(v:unknown)=>String(v??"").trim();
const key=(v:unknown)=>txt(v).toLowerCase().replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
const num=(v:unknown)=>{const x=Number(txt(v).replace(/%/g,""));return Number.isFinite(x)?x:null};
const result=(v:unknown)=>{const s=txt(v).toUpperCase();return ["W","WIN","WON"].includes(s)?"W":["L","LOSS","LOST"].includes(s)?"L":["P","PUSH"].includes(s)?"P":""};
function date(v:unknown){const s=txt(v);let m=s.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);if(m)return `${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;m=s.match(/(\d{1,2})\/(\d{1,2})\/(20\d{2})/);return m?`${m[3]}-${m[1].padStart(2,"0")}-${m[2].padStart(2,"0")}`:""}
function details(r:Row){try{return JSON.parse(txt(r["Details JSON"])||"{}") as Record<string,unknown>}catch{return {} as Record<string,unknown>}}
function sideOf(r:Row){const p=key(r.Pick||r.Selection||r.Side);return p.startsWith("over")?"over":p.startsWith("under")?"under":""}
function lineOf(r:Row){return num(r["Market Line"]??r["Prop Line"]??r.Line)}
function exactKey(d:string,p:string,m:string,s:string,l:number|null){return [d,key(p),key(m),key(s),l==null?"":String(l)].join("|")}
function amp(s:string){const lower=s.toLowerCase();const ix=lower.indexOf("variable tiers:");if(ix<0)return {oppHigh:0,effHigh:0,maxOppAmp:null,maxEffAmp:null};const tail=s.slice(ix);const parts=tail.split(/\|\s*efficiency\s*:/i);const opp=(parts[0]||"").replace(/^.*?opportunity\s*:/i,"");const eff=parts[1]||"";const vals=(x:string)=>[...x.matchAll(/Tier\s*\d+@(\d+)%/gi)].map(m=>Number(m[1])).filter(Number.isFinite);const ov=vals(opp),ev=vals(eff);return {oppHigh:ov.filter(v=>v>=150).length,effHigh:ev.filter(v=>v>=150).length,maxOppAmp:ov.length?Math.max(...ov):null,maxEffAmp:ev.length?Math.max(...ev):null}}
function stress(side:string,line:number,proj:number){if(!(line>0&&proj>0))return null;if(side==="over")return Math.max(0,(1-line/proj)*100);if(side==="under")return Math.max(0,(line/proj-1)*100);return null}
function oppFields(r:Row){const m=key(r.Market);if(m==="receiving yards")return {proj:num(r["Projected Targets"]),actual:num(r["Actual Targets"])};if(m==="rushing yards")return {proj:num(r["Projected Player Attempts"]),actual:num(r["Actual Attempts"])};return {proj:null,actual:null}}
function summary(rows:Item[]){const w=rows.filter(r=>r.result==="W").length,l=rows.filter(r=>r.result==="L").length,p=rows.filter(r=>r.result==="P").length;const avg=(f:(r:Item)=>number|null)=>{const a=rows.map(f).filter((x):x is number=>x!=null&&Number.isFinite(x));return a.length?+(a.reduce((x,y)=>x+y,0)/a.length).toFixed(2):null};return {n:rows.length,w,l,p,winPct:w+l?+(100*w/(w+l)).toFixed(1):null,avgRC:avg(r=>r.roleConfidence),avgRel:avg(r=>r.reliability),avgStress:avg(r=>r.stressToLine),avgPriorOppErr:avg(r=>r.priorOppErrPct)}}
function group(rows:Item[],f:(r:Item)=>string){const out:Record<string,ReturnType<typeof summary>>={};for(const k of [...new Set(rows.map(f))].sort())out[k]=summary(rows.filter(r=>f(r)===k));return out}
function cut(rows:Item[],f:(r:Item)=>number|null,vals:number[],op:">="|"<="){return vals.map(v=>({v,...summary(rows.filter(r=>{const x=f(r);return x!=null&&(op===">="?x>=v:x<=v)}))}))}

export async function GET(){
  const [history,projections,tracker]=await Promise.all([
    readSportWorksheet("NFL","ezpz_pick_history") as Promise<Row[]>,
    readSportWorksheet("NFL","prop_projections") as Promise<Row[]>,
    readSportWorksheet("NFL","prop_tracker") as Promise<Row[]>,
  ]);
  const pmap=new Map<string,Row[]>();
  for(const r of projections){const d=date(r.Date||r["Game Date"]),p=txt(r.Player||r["Player Name"]),m=txt(r.Market),s=sideOf(r),l=lineOf(r);const k=exactKey(d,p,m,s,l);(pmap.get(k)||pmap.set(k,[]).get(k)!).push(r)}
  const priorByPlayerMarket=new Map<string,Row[]>();
  for(const r of tracker){if(!result(r.Result||r.Status))continue;const k=[key(r.Player||r["Player Name"]),key(r.Market)].join("|");(priorByPlayerMarket.get(k)||priorByPlayerMarket.set(k,[]).get(k)!).push(r)}
  for(const a of priorByPlayerMarket.values())a.sort((x,y)=>date(y.Date).localeCompare(date(x.Date)));
  const seen=new Set<string>();const items:Item[]=[];let unmatched=0;
  for(const h of history){const d=details(h),market=txt(h["Prop Market"]||d.propMarket),player=txt(h.Player||h["Player Name"]||d.playerName),side=key(h["Prop Side"]||d.propSide),ln=num(h["Prop Line"]||d.propLine),dt=date(h.Date||d.date),res=result(h.Result);if(!market||!player||!side||ln==null||!res)continue;const id=txt(h["Pick Key"])||exactKey(dt,player,market,side,ln);if(seen.has(id))continue;seen.add(id);const candidates=pmap.get(exactKey(dt,player,market,side,ln))||[];const pr=candidates.find(r=>txt(r["Model Version"]).includes("v4.18"))||candidates[0];if(!pr||!txt(pr["Model Version"]).includes("v4.18")){if(candidates.length===0)unmatched++;continue}const proj=num(pr.Projection),line=ln;if(proj==null)continue;const prior=(priorByPlayerMarket.get([key(player),key(market)].join("|"))||[]).filter(r=>date(r.Date)<dt);const priorStats=prior.map(r=>{const o=oppFields(r);if(o.proj==null||o.actual==null||o.proj<=0)return null;return {abs:Math.abs(o.actual-o.proj)/o.proj*100,signed:(o.actual-o.proj)/o.proj*100}}).filter((x):x is {abs:number,signed:number}=>x!=null);const a=amp(txt(pr.Confluence));items.push({date:dt,player,market,side,line,projection:proj,result:res,slot:txt(pr.Slot),roleConfidence:num(pr["Role Confidence"]),reliability:num(pr.Reliability),modelVersion:txt(pr["Model Version"]),tier:txt(d.tier||h.Tier||h["Prop Tier"]||pr.Grade),savedAt:txt(h["Saved At"]),stressToLine:stress(side,line,proj),...a,priorOppErrPct:priorStats[0]?.abs??null,priorOppSignedPct:priorStats[0]?.signed??null,prior2OppMaePct:priorStats.length?+(priorStats.slice(0,2).reduce((s,x)=>s+x.abs,0)/Math.min(2,priorStats.length)).toFixed(2):null})}
  const latestMap=new Map<string,Item>();for(const r of items){const k=[r.date,key(r.player),key(r.market),r.side].join("|");const prev=latestMap.get(k);if(!prev||r.savedAt>prev.savedAt)latestMap.set(k,r)}const latest=[...latestMap.values()];
  const analyze=(rows:Item[])=>{
    const primary=rows.filter(r=>["RB1","WR1"].includes(r.slot)),secondary=rows.filter(r=>["RB2","WR2","WR3"].includes(r.slot)),unders=rows.filter(r=>r.side==="under"),overs=rows.filter(r=>r.side==="over");
    return {overall:summary(rows),bySlot:group(rows,r=>r.slot||"blank"),byMarketSide:group(rows,r=>`${r.market}|${r.side}`),byTier:group(rows,r=>r.tier||"blank"),primary:summary(primary),secondary:summary(secondary),stress:{all:cut(rows,r=>r.stressToLine,[20,25,30,35,40,50,60,75],">="),overs:cut(overs,r=>r.stressToLine,[20,25,30,35,40,50,60],">="),unders:cut(unders,r=>r.stressToLine,[25,35,45,50,60,75,90],">=")},priorOpp:{known:summary(rows.filter(r=>r.priorOppErrPct!=null)),mae1:cut(rows,r=>r.priorOppErrPct,[25,40,50,75,100],"<="),mae2:cut(rows,r=>r.prior2OppMaePct,[25,40,50,75,100],"<="),underPriorOverage:group(unders.filter(r=>r.priorOppSignedPct!=null),r=>{const x=r.priorOppSignedPct!;return x>50?">50%":x>25?"25-50%":x>0?"0-25%":"<=0%"})},amplification:{byMaxOpp:group(rows,r=>r.maxOppAmp==null?"none":String(r.maxOppAmp)),byOppHighCount:group(rows,r=>r.oppHigh>=3?"3+":String(r.oppHigh)),primaryByMaxOpp:group(primary,r=>r.maxOppAmp==null?"none":String(r.maxOppAmp)),secondaryByMaxOpp:group(secondary,r=>r.maxOppAmp==null?"none":String(r.maxOppAmp))},rows:rows.map(r=>({date:r.date,player:r.player,market:r.market,side:r.side,line:r.line,projection:r.projection,result:r.result,slot:r.slot,tier:r.tier,rc:r.roleConfidence,rel:r.reliability,stress:r.stressToLine,oppHigh:r.oppHigh,effHigh:r.effHigh,maxOpp:r.maxOppAmp,maxEff:r.maxEffAmp,priorErr:r.priorOppErrPct,priorSigned:r.priorOppSignedPct,prior2:r.prior2OppMaePct}))}
  };
  const out={ok:true,totals:{history:history.length,projections:projections.length,tracker:tracker.length,v418Saved:items.length,v418Latest:latest.length,unmatched},allSaved:analyze(items),latestOnly:analyze(latest)};
  console.log("NFL_V419_AUDIT "+JSON.stringify(out));
  return NextResponse.json(out);
}
