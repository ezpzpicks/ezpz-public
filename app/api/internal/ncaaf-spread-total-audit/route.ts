import { NextResponse } from "next/server";
import { readSportWorksheet } from "../../../../lib/sportSheets";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Row = Record<string, string>;
type Game = {
  date: string; week: number; gameId: string; game: string; away: string; home: string;
  projectedAway: number; projectedHome: number; projectedMargin: number; projectedTotal: number;
  marketHomeSpread: number | null; marketTotal: number | null;
  spreadPick: string; spreadProbability: number | null; spreadEdgeSaved: number | null; spreadGrade: string; spreadConfluence: string;
  totalPick: string; totalProbability: number | null; totalEdgeSaved: number | null; totalGrade: string; totalConfluence: string;
  reliability: number | null; dataConfidence: number | null; personnelConfidence: number | null; weatherAdjustment: number | null;
  modelVersion: string; actualAway: number; actualHome: number; actualMargin: number; actualTotal: number;
};

const txt=(v:unknown)=>String(v??"").trim();
const num=(v:unknown):number|null=>{const n=Number(txt(v));return Number.isFinite(n)?n:null};
const mean=(x:number[])=>x.length?x.reduce((a,b)=>a+b,0)/x.length:null;
const rnd=(x:number|null,d=3)=>x==null?null:Number(x.toFixed(d));
const keyTeam=(s:string)=>s.toUpperCase().replace(/[^A-Z0-9]/g,"");
const dateKey=(s:string)=>txt(s).slice(0,10);
function slateKey(r:Row){const id=txt(r["Game ID"]);return id?`id:${id}`:`${dateKey(r.Date)}|${keyTeam(txt(r["Away Team"]))}|${keyTeam(txt(r["Home Team"]))}`}
function schedKeys(r:Row){const out:string[]=[];const id=txt(r["Game ID"]);if(id)out.push(`id:${id}`);out.push(`${dateKey(r["Game Date"])}|${keyTeam(txt(r["Away Team"]))}|${keyTeam(txt(r["Home Team"]))}`);return out}

function metrics(games:Game[]){
  const me=games.map(g=>g.projectedMargin-g.actualMargin),te=games.map(g=>g.projectedTotal-g.actualTotal);
  const mm=games.filter(g=>g.marketHomeSpread!=null),mt=games.filter(g=>g.marketTotal!=null);
  return {n:games.length,margin:{mae:rnd(mean(me.map(Math.abs))),rmse:rnd(Math.sqrt(mean(me.map(x=>x*x))??0)),bias:rnd(mean(me)),modelMean:rnd(mean(games.map(g=>g.projectedMargin))),actualMean:rnd(mean(games.map(g=>g.actualMargin))),marketMae:rnd(mean(mm.map(g=>Math.abs((-Number(g.marketHomeSpread))-g.actualMargin))))},total:{mae:rnd(mean(te.map(Math.abs))),rmse:rnd(Math.sqrt(mean(te.map(x=>x*x))??0)),bias:rnd(mean(te)),modelMean:rnd(mean(games.map(g=>g.projectedTotal))),actualMean:rnd(mean(games.map(g=>g.actualTotal))),marketMae:rnd(mean(mt.map(g=>Math.abs(Number(g.marketTotal)-g.actualTotal))))}};
}

function edgeRecord(games:Game[],kind:"spread"|"total",threshold:number,sign:"all"|"positive"|"negative"="all"){
  let n=0,wins=0,losses=0,pushes=0;
  for(const g of games){
    if(kind==="spread"){
      if(g.marketHomeSpread==null)continue;const edge=g.projectedMargin+g.marketHomeSpread;if(Math.abs(edge)<threshold)continue;if(sign==="positive"&&edge<=0)continue;if(sign==="negative"&&edge>=0)continue;
      const actualCover=g.actualMargin+g.marketHomeSpread,pickHome=edge>0,signed=pickHome?actualCover:-actualCover;n++;if(Math.abs(signed)<1e-9)pushes++;else if(signed>0)wins++;else losses++;
    }else{
      if(g.marketTotal==null)continue;const edge=g.projectedTotal-g.marketTotal;if(Math.abs(edge)<threshold)continue;if(sign==="positive"&&edge<=0)continue;if(sign==="negative"&&edge>=0)continue;
      const actualEdge=g.actualTotal-g.marketTotal,pickOver=edge>0,signed=pickOver?actualEdge:-actualEdge;n++;if(Math.abs(signed)<1e-9)pushes++;else if(signed>0)wins++;else losses++;
    }
  }
  return {threshold,sign,n,wins,losses,pushes,winRate:rnd(wins+losses?wins/(wins+losses):null)};
}
function group(games:Game[],fn:(g:Game)=>string){const m=new Map<string,Game[]>();for(const g of games){const k=fn(g);if(!m.has(k))m.set(k,[]);m.get(k)!.push(g)}return[...m.entries()].map(([key,rows])=>({key,...metrics(rows)}))}
function gradeRecord(games:Game[],kind:"spread"|"total"){
  const m=new Map<string,Game[]>();for(const g of games){const grade=kind==="spread"?g.spreadGrade:g.totalGrade;if(!grade)continue;if(!m.has(grade))m.set(grade,[]);m.get(grade)!.push(g)}
  return [...m.entries()].map(([grade,rows])=>({grade,record:edgeRecord(rows,kind,0),metrics:metrics(rows)}));
}
function biasCorrection(train:Game[],test:Game[],kind:"margin"|"total"){
  if(!train.length)return null;const errs=train.map(g=>(kind==="margin"?g.projectedMargin-g.actualMargin:g.projectedTotal-g.actualTotal));const correction=-(mean(errs)??0);
  const calc=(rows:Game[])=>({n:rows.length,currentMae:rnd(mean(rows.map(g=>Math.abs((kind==="margin"?g.projectedMargin:g.projectedTotal)-(kind==="margin"?g.actualMargin:g.actualTotal))))),adjustedMae:rnd(mean(rows.map(g=>Math.abs((kind==="margin"?g.projectedMargin:g.projectedTotal)+correction-(kind==="margin"?g.actualMargin:g.actualTotal)))))});
  return {correction:rnd(correction),development:calc(train),holdout:calc(test)};
}
function marketBlend(train:Game[],test:Game[],kind:"margin"|"total"){
  const eligible=(rows:Game[])=>rows.filter(g=>kind==="margin"?g.marketHomeSpread!=null:g.marketTotal!=null);
  let best:any=null;for(let w=0;w<=1.0001;w+=0.05){const e=eligible(train).map(g=>{const model=kind==="margin"?g.projectedMargin:g.projectedTotal,market=kind==="margin"?-Number(g.marketHomeSpread):Number(g.marketTotal),actual=kind==="margin"?g.actualMargin:g.actualTotal;return Math.abs(w*model+(1-w)*market-actual)});const mae=mean(e)??999;if(!best||mae<best.mae)best={modelWeight:rnd(w,2),marketWeight:rnd(1-w,2),mae:rnd(mae)}}
  const evalRows=(rows:Game[])=>{const e=eligible(rows);const errs=e.map(g=>{const model=kind==="margin"?g.projectedMargin:g.projectedTotal,market=kind==="margin"?-Number(g.marketHomeSpread):Number(g.marketTotal),actual=kind==="margin"?g.actualMargin:g.actualTotal;return Math.abs(best.modelWeight*model+best.marketWeight*market-actual)});return{n:e.length,currentModelMae:rnd(mean(e.map(g=>Math.abs((kind==="margin"?g.projectedMargin:g.projectedTotal)-(kind==="margin"?g.actualMargin:g.actualTotal))))),marketMae:rnd(mean(e.map(g=>Math.abs((kind==="margin"?-Number(g.marketHomeSpread):Number(g.marketTotal))-(kind==="margin"?g.actualMargin:g.actualTotal))))),blendMae:rnd(mean(errs))}};
  return {selection:best,development:evalRows(train),holdout:evalRows(test)};
}

export async function GET(){
  const [slate,schedule]=await Promise.all([readSportWorksheet("NCAAF","daily_slate") as Promise<Row[]>,readSportWorksheet("NCAAF","schedule") as Promise<Row[]>]);
  const actualMap=new Map<string,{away:number;home:number}>();
  for(const r of schedule){const a=num(r["Away Score"]),h=num(r["Home Score"]);if(a==null||h==null||(a===0&&h===0))continue;for(const k of schedKeys(r))actualMap.set(k,{away:a,home:h})}
  const dedup=new Map<string,Row>();for(const r of slate)dedup.set(slateKey(r),r);
  const games:Game[]=[];let rejected=0;
  for(const r of dedup.values()){
    const actual=actualMap.get(slateKey(r))||actualMap.get(`${dateKey(r.Date)}|${keyTeam(txt(r["Away Team"]))}|${keyTeam(txt(r["Home Team"]))}`);if(!actual)continue;
    const pa=num(r["Projected Away"]),ph=num(r["Projected Home"]),pm=num(r["Projected Margin"]),pt=num(r["Projected Total"]),week=num(r.Week)??0,version=txt(r["Model Version"]);
    if(pa==null||ph==null||pm==null||pt==null||pa<=0||ph<=0||pt<20||week<=0||!version){rejected++;continue}
    games.push({date:dateKey(r.Date),week,gameId:txt(r["Game ID"]),game:txt(r.Game),away:txt(r["Away Team"]),home:txt(r["Home Team"]),projectedAway:pa,projectedHome:ph,projectedMargin:pm,projectedTotal:pt,marketHomeSpread:num(r["Market Home Spread"]),marketTotal:num(r["Market Total"]),spreadPick:txt(r["Spread Pick"]),spreadProbability:num(r["Spread Probability"]),spreadEdgeSaved:num(r["Spread Edge"]),spreadGrade:txt(r["Spread Grade"]),spreadConfluence:txt(r["Spread Confluence"]),totalPick:txt(r["Total Pick"]),totalProbability:num(r["Total Probability"]),totalEdgeSaved:num(r["Total Edge"]),totalGrade:txt(r["Total Grade"]),totalConfluence:txt(r["Total Confluence"]),reliability:num(r.Reliability),dataConfidence:num(r["Data Confidence"]),personnelConfidence:num(r["Personnel Confidence"]),weatherAdjustment:num(r["Weather Adjustment"]),modelVersion:version,actualAway:actual.away,actualHome:actual.home,actualMargin:actual.home-actual.away,actualTotal:actual.home+actual.away});
  }
  games.sort((a,b)=>a.date.localeCompare(b.date)||a.game.localeCompare(b.game));const dates=[...new Set(games.map(g=>g.date))].sort(),holdoutDate=dates.at(-1)??"",pre=games.filter(g=>g.date<holdoutDate),hold=games.filter(g=>g.date===holdoutDate);
  const versions:Record<string,number>={};for(const g of games)versions[g.modelVersion]=(versions[g.modelVersion]??0)+1;
  const spreadTs=[0,1,1.5,2,2.5,3,3.5,4,5,6,7],totalTs=[0,1,1.75,2,2.5,3,3.5,4,5,6,7];
  return NextResponse.json({source:{slateRows:slate.length,scheduleRows:schedule.length,dedupedSlate:dedup.size,rejectedInvalidCompleted:rejected,completedMatched:games.length,dates,holdoutDate,versions},overall:metrics(games),development:metrics(pre),holdout:metrics(hold),byDate:group(games,g=>g.date),byWeek:group(games,g=>String(g.week)),bands:{homeFavorite:metrics(games.filter(g=>g.marketHomeSpread!=null&&Number(g.marketHomeSpread)<0)),homeDog:metrics(games.filter(g=>g.marketHomeSpread!=null&&Number(g.marketHomeSpread)>0)),marketTotal47Plus:metrics(games.filter(g=>g.marketTotal!=null&&Number(g.marketTotal)>=47)),marketTotal42OrLess:metrics(games.filter(g=>g.marketTotal!=null&&Number(g.marketTotal)<=42))},spread:{all:spreadTs.map(x=>edgeRecord(games,"spread",x)),development:[0,1.5,2.5,3.5,5].map(x=>edgeRecord(pre,"spread",x)),holdout:[0,1.5,2.5,3.5,5].map(x=>edgeRecord(hold,"spread",x)),homeSide:[0,1.5,2.5,3.5].map(x=>edgeRecord(games,"spread",x,"positive")),awaySide:[0,1.5,2.5,3.5].map(x=>edgeRecord(games,"spread",x,"negative")),grades:gradeRecord(games,"spread")},total:{all:totalTs.map(x=>edgeRecord(games,"total",x)),development:[0,1.75,3,4,5].map(x=>edgeRecord(pre,"total",x)),holdout:[0,1.75,3,4,5].map(x=>edgeRecord(hold,"total",x)),overs:[0,1.75,3,4].map(x=>edgeRecord(games,"total",x,"positive")),unders:[0,1.75,3,4].map(x=>edgeRecord(games,"total",x,"negative")),grades:gradeRecord(games,"total")},developmentCalibrations:{marginBias:biasCorrection(pre,hold,"margin"),totalBias:biasCorrection(pre,hold,"total"),marginMarketBlend:marketBlend(pre,hold,"margin"),totalMarketBlend:marketBlend(pre,hold,"total")},holdoutRows:hold});
}
