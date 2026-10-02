import { NextResponse } from "next/server";
import { readSportWorksheet } from "../../../../lib/sportSheets";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Row = Record<string,string>;
type Game = {
  date:string; week:number; gameId:string; game:string; away:string; home:string; version:string; notes:string;
  projectedMargin:number; projectedTotal:number; actualMargin:number; actualTotal:number;
  marketHomeSpread:number|null; marketTotal:number|null;
  spreadPick:string; spreadProbability:number|null; spreadEdge:number|null; spreadGrade:string; spreadConfluence:number|null;
  totalPick:string; totalProbability:number|null; totalEdge:number|null; totalGrade:string; totalConfluence:number|null;
  reliability:number|null; dataConfidence:number|null; personnelConfidence:number|null;
};
const t=(v:unknown)=>String(v??"").trim();
const n=(v:unknown):number|null=>{const x=Number(t(v));return Number.isFinite(x)?x:null};
const mean=(a:number[])=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
const r=(x:number|null,d=3)=>x==null?null:Number(x.toFixed(d));
const key=(s:string)=>s.toUpperCase().replace(/[^A-Z0-9]/g,"");
const dateKey=(s:string)=>t(s).slice(0,10);
const slateKey=(x:Row)=>t(x["Game ID"])?`id:${t(x["Game ID"])}`:`${dateKey(x.Date)}|${key(t(x["Away Team"]))}|${key(t(x["Home Team"]))}`;
function scheduleKeys(x:Row){const out:string[]=[];if(t(x["Game ID"]))out.push(`id:${t(x["Game ID"])}`);out.push(`${dateKey(x["Game Date"])}|${key(t(x["Away Team"]))}|${key(t(x["Home Team"]))}`);return out}
function pickOutcome(g:Game, kind:"spread"|"total"){
  if(kind==="spread"){
    if(g.marketHomeSpread==null)return "";
    const edge=g.projectedMargin+g.marketHomeSpread;
    const actualCover=g.actualMargin+g.marketHomeSpread;
    const signed=edge>=0?actualCover:-actualCover;
    return Math.abs(signed)<1e-9?"P":signed>0?"W":"L";
  }
  if(g.marketTotal==null)return "";
  const edge=g.projectedTotal-g.marketTotal;
  const actualEdge=g.actualTotal-g.marketTotal;
  const signed=edge>=0?actualEdge:-actualEdge;
  return Math.abs(signed)<1e-9?"P":signed>0?"W":"L";
}
function edgeValue(g:Game,kind:"spread"|"total"){return kind==="spread"?(g.marketHomeSpread==null?null:g.projectedMargin+g.marketHomeSpread):(g.marketTotal==null?null:g.projectedTotal-g.marketTotal)}
function metrics(rows:Game[]){
  const me=rows.map(g=>g.projectedMargin-g.actualMargin), te=rows.map(g=>g.projectedTotal-g.actualTotal);
  const sm=rows.filter(g=>g.marketHomeSpread!=null), tm=rows.filter(g=>g.marketTotal!=null);
  return {n:rows.length,margin:{mae:r(mean(me.map(Math.abs))),bias:r(mean(me)),marketMae:r(mean(sm.map(g=>Math.abs(-Number(g.marketHomeSpread)-g.actualMargin))))},total:{mae:r(mean(te.map(Math.abs))),bias:r(mean(te)),marketMae:r(mean(tm.map(g=>Math.abs(Number(g.marketTotal)-g.actualTotal))))}};
}
function record(rows:Game[],kind:"spread"|"total",test:(g:Game)=>boolean=()=>true){let w=0,l=0,p=0,n0=0;for(const g of rows){if(!test(g))continue;const o=pickOutcome(g,kind);if(!o)continue;n0++;if(o==="W")w++;else if(o==="L")l++;else p++;}return{n:n0,wins:w,losses:l,pushes:p,winRate:r(w+l?w/(w+l):null)}}
function thresholdRows(rows:Game[],kind:"spread"|"total",thresholds:number[]){return thresholds.map(th=>({threshold:th,...record(rows,kind,g=>Math.abs(edgeValue(g,kind)??0)>=th)}))}
function probabilityRows(rows:Game[],kind:"spread"|"total",thresholds:number[]){return thresholds.map(th=>({threshold:th,...record(rows,kind,g=>Number(kind==="spread"?g.spreadProbability:g.totalProbability)>=th)}))}
function groupedRecord(rows:Game[],kind:"spread"|"total",value:(g:Game)=>string){const m=new Map<string,Game[]>();for(const g of rows){const k=value(g)||"(blank)";if(!m.has(k))m.set(k,[]);m.get(k)!.push(g)}return[...m.entries()].map(([group,x])=>({group,...record(x,kind),metrics:metrics(x)}))}
function winnerLoser(rows:Game[],kind:"spread"|"total"){
  const out=(label:"W"|"L")=>{const x=rows.filter(g=>pickOutcome(g,kind)===label);const edge=x.map(g=>Math.abs(edgeValue(g,kind)??0));const prob=x.map(g=>kind==="spread"?g.spreadProbability:g.totalProbability).filter((v):v is number=>v!=null);const rel=x.map(g=>g.reliability).filter((v):v is number=>v!=null);const conf=x.map(g=>kind==="spread"?g.spreadConfluence:g.totalConfluence).filter((v):v is number=>v!=null);return{n:x.length,avgAbsEdge:r(mean(edge)),avgProbability:r(mean(prob)),avgReliability:r(mean(rel)),avgConfluence:r(mean(conf))}};
  return{wins:out("W"),losses:out("L")};
}
function scope(rows:Game[]){
  const spreadTs=[0,2.5,5,7.5,10,12.5,15], totalTs=[0,2.5,4,5,6,7.5,10];
  const probTs=[0.52,0.55,0.57,0.60,0.65,0.70];
  return{
    metrics:metrics(rows),
    spread:{thresholds:thresholdRows(rows,"spread",spreadTs),probabilities:probabilityRows(rows,"spread",probTs),grades:groupedRecord(rows,"spread",g=>g.spreadGrade),confluence:groupedRecord(rows,"spread",g=>g.spreadConfluence==null?"blank":String(g.spreadConfluence)),reliability:groupedRecord(rows,"spread",g=>g.reliability==null?"blank":g.reliability<70?"<70":g.reliability<80?"70-79.9":"80+"),direction:{home:record(rows,"spread",g=>(edgeValue(g,"spread")??0)>0),away:record(rows,"spread",g=>(edgeValue(g,"spread")??0)<0)},winnerLoser:winnerLoser(rows,"spread")},
    total:{thresholds:thresholdRows(rows,"total",totalTs),probabilities:probabilityRows(rows,"total",probTs),grades:groupedRecord(rows,"total",g=>g.totalGrade),confluence:groupedRecord(rows,"total",g=>g.totalConfluence==null?"blank":String(g.totalConfluence)),reliability:groupedRecord(rows,"total",g=>g.reliability==null?"blank":g.reliability<70?"<70":g.reliability<80?"70-79.9":"80+"),direction:{over:record(rows,"total",g=>(edgeValue(g,"total")??0)>0),under:record(rows,"total",g=>(edgeValue(g,"total")??0)<0)},winnerLoser:winnerLoser(rows,"total")}
  };
}
export async function GET(){
  const [slate,schedule]=await Promise.all([readSportWorksheet("NCAAF","daily_slate") as Promise<Row[]>,readSportWorksheet("NCAAF","schedule") as Promise<Row[]>]);
  const actual=new Map<string,{away:number;home:number}>();for(const x of schedule){const a=n(x["Away Score"]),h=n(x["Home Score"]);if(a==null||h==null||(a===0&&h===0))continue;for(const k of scheduleKeys(x))actual.set(k,{away:a,home:h})}
  const dedup=new Map<string,Row>();for(const x of slate)dedup.set(slateKey(x),x);
  const games:Game[]=[];for(const x of dedup.values()){
    const a=actual.get(slateKey(x))||actual.get(`${dateKey(x.Date)}|${key(t(x["Away Team"]))}|${key(t(x["Home Team"]))}`);if(!a)continue;
    const pm=n(x["Projected Margin"]),pt=n(x["Projected Total"]),week=n(x.Week)??0,version=t(x["Model Version"]);if(pm==null||pt==null||week<=0||!version)continue;
    games.push({date:dateKey(x.Date),week,gameId:t(x["Game ID"]),game:t(x.Game),away:t(x["Away Team"]),home:t(x["Home Team"]),version,notes:t(x.Notes),projectedMargin:pm,projectedTotal:pt,actualMargin:a.home-a.away,actualTotal:a.home+a.away,marketHomeSpread:n(x["Market Home Spread"]),marketTotal:n(x["Market Total"]),spreadPick:t(x["Spread Pick"]),spreadProbability:n(x["Spread Probability"]),spreadEdge:n(x["Spread Edge"]),spreadGrade:t(x["Spread Grade"]),spreadConfluence:n(x["Spread Confluence"]),totalPick:t(x["Total Pick"]),totalProbability:n(x["Total Probability"]),totalEdge:n(x["Total Edge"]),totalGrade:t(x["Total Grade"]),totalConfluence:n(x["Total Confluence"]),reliability:n(x.Reliability),dataConfidence:n(x["Data Confidence"]),personnelConfidence:n(x["Personnel Confidence"])});
  }
  games.sort((a,b)=>a.date.localeCompare(b.date)||a.game.localeCompare(b.game));
  const versions=[...new Set(games.map(g=>g.version))];const latestVersion=games.at(-1)?.version||"";const fbs=games.filter(g=>!g.notes.toLowerCase().includes("fcs/non-fbs"));const current=games.filter(g=>g.version===latestVersion);const currentFbs=current.filter(g=>!g.notes.toLowerCase().includes("fcs/non-fbs"));
  return NextResponse.json({source:{slateRows:slate.length,scheduleRows:schedule.length,completedMatched:games.length,fbsMatched:fbs.length,latestVersion,versions:versions.map(v=>({version:v,n:games.filter(g=>g.version===v).length,metrics:metrics(games.filter(g=>g.version===v))}))},all:scope(games),fbsOnly:scope(fbs),currentVersion:scope(current),currentVersionFbsOnly:scope(currentFbs),currentRows:current});
}
