import { NextResponse } from "next/server";
import { readSportWorksheet } from "../../../../lib/sportSheets";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Row = Record<string,string>;
type Game={date:string;week:number;game:string;away:string;home:string;version:string;notes:string;spreadGrade:string;totalGrade:string;spreadConfluence:number;totalConfluence:number;reliability:number|null;dataConfidence:number|null;personnelConfidence:number|null;marketHomeSpread:number|null;marketTotal:number|null;projectedMargin:number;projectedTotal:number;actualMargin:number;actualTotal:number};
const txt=(v:unknown)=>String(v??"").trim();
const num=(v:unknown):number|null=>{const n=Number(txt(v));return Number.isFinite(n)?n:null};
const key=(s:string)=>s.toUpperCase().replace(/[^A-Z0-9]/g,"");
const dk=(s:string)=>txt(s).slice(0,10);
function slateKey(r:Row){const id=txt(r["Game ID"]);return id?`id:${id}`:`${dk(r.Date)}|${key(txt(r["Away Team"]))}|${key(txt(r["Home Team"]))}`}
function schedKeys(r:Row){const out:string[]=[];const id=txt(r["Game ID"]);if(id)out.push(`id:${id}`);out.push(`${dk(r["Game Date"])}|${key(txt(r["Away Team"]))}|${key(txt(r["Home Team"]))}`);return out}
function spreadResult(g:Game){if(g.marketHomeSpread==null)return null;const edge=g.projectedMargin+g.marketHomeSpread;const cover=g.actualMargin+g.marketHomeSpread;const signed=edge>0?cover:-cover;return signed===0?"P":signed>0?"W":"L"}
function totalResult(g:Game){if(g.marketTotal==null)return null;const edge=g.projectedTotal-g.marketTotal;const actual=g.actualTotal-g.marketTotal;const signed=edge>0?actual:-actual;return signed===0?"P":signed>0?"W":"L"}
function record(rows:Game[],kind:"spread"|"total") {let w=0,l=0,p=0;for(const g of rows){const r=kind==="spread"?spreadResult(g):totalResult(g);if(r==="W")w++;else if(r==="L")l++;else if(r==="P")p++;}return {n:w+l+p,w,l,p,winRate:w+l?Number((w/(w+l)).toFixed(3)):null};}
function by<T extends string|number>(rows:Game[],fn:(g:Game)=>T,kind:"spread"|"total"){const m=new Map<T,Game[]>();for(const g of rows){const k=fn(g);if(!m.has(k))m.set(k,[]);m.get(k)!.push(g)}return [...m.entries()].map(([k,v])=>({key:k,...record(v,kind)}));}
function fcsLike(g:Game){const s=g.notes.toLowerCase();return s.includes("fcs/non-fbs")||s.includes("non-fbs opponent")||s.includes("fcs opponent");}

export async function GET(){
 const [slate,schedule]=await Promise.all([readSportWorksheet("NCAAF","daily_slate") as Promise<Row[]>,readSportWorksheet("NCAAF","schedule") as Promise<Row[]>]);
 const actual=new Map<string,{away:number;home:number}>();for(const r of schedule){const a=num(r["Away Score"]),h=num(r["Home Score"]);if(a==null||h==null||(a===0&&h===0))continue;for(const k of schedKeys(r))actual.set(k,{away:a,home:h});}
 const dedup=new Map<string,Row>();for(const r of slate)dedup.set(slateKey(r),r);
 const games:Game[]=[];for(const r of dedup.values()){const a=actual.get(slateKey(r))||actual.get(`${dk(r.Date)}|${key(txt(r["Away Team"]))}|${key(txt(r["Home Team"]))}`);if(!a)continue;const pm=num(r["Projected Margin"]),pt=num(r["Projected Total"]);if(pm==null||pt==null)continue;games.push({date:dk(r.Date),week:num(r.Week)??0,game:txt(r.Game),away:txt(r["Away Team"]),home:txt(r["Home Team"]),version:txt(r["Model Version"]),notes:txt(r.Notes),spreadGrade:txt(r["Spread Grade"]),totalGrade:txt(r["Total Grade"]),spreadConfluence:num(r["Spread Confluence"])??0,totalConfluence:num(r["Total Confluence"])??0,reliability:num(r.Reliability),dataConfidence:num(r["Data Confidence"]),personnelConfidence:num(r["Personnel Confidence"]),marketHomeSpread:num(r["Market Home Spread"]),marketTotal:num(r["Market Total"]),projectedMargin:pm,projectedTotal:pt,actualMargin:a.home-a.away,actualTotal:a.home+a.away});}
 const latest="cfb-v2.5-stabilized-spread-edge-2026-09-25";const current=games.filter(g=>g.version===latest);const fbs=current.filter(g=>!fcsLike(g));const fcs=current.filter(fcsLike);
 const summarize=(rows:Game[])=>({n:rows.length,spreadGrades:by(rows,g=>g.spreadGrade||"blank","spread"),totalGrades:by(rows,g=>g.totalGrade||"blank","total"),spreadConfluence:by(rows,g=>g.spreadConfluence,"spread"),totalConfluence:by(rows,g=>g.totalConfluence,"total"),reliabilityBands:[{band:"<70",...record(rows.filter(g=>(g.reliability??999)<70),"spread")},{band:"70-79.9",...record(rows.filter(g=>(g.reliability??999)>=70&&(g.reliability??999)<80),"spread")},{band:"80+",...record(rows.filter(g=>(g.reliability??-1)>=80),"spread")}],aSpreadRows:rows.filter(g=>g.spreadGrade==="A Spread").map(g=>({game:g.game,result:spreadResult(g),edge:Number(Math.abs(g.projectedMargin+(g.marketHomeSpread??0)).toFixed(2)),confluence:g.spreadConfluence,reliability:g.reliability,fcsLike:fcsLike(g)})),aTotalRows:rows.filter(g=>g.totalGrade==="A Total").map(g=>({game:g.game,result:totalResult(g),edge:Number(Math.abs(g.projectedTotal-(g.marketTotal??0)).toFixed(2)),confluence:g.totalConfluence,reliability:g.reliability,fcsLike:fcsLike(g)}))});
 return NextResponse.json({latestVersion:latest,allCurrent:summarize(current),fbsOnly:summarize(fbs),fcsLike:summarize(fcs)});
}
