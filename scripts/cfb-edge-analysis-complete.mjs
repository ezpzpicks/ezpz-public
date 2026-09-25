const URL_NAMES=["TURSO_DATABASE_URL","TURSO_URL","turso_TURSO_DATABASE_URL","DATABASE_URL"];
const TOKEN_NAMES=["TURSO_AUTH_TOKEN","TURSO_DATABASE_AUTH_TOKEN","turso_TURSO_AUTH_TOKEN","TURSO_TOKEN","DATABASE_AUTH_TOKEN"];
const first=(names)=>names.map(n=>String(process.env[n]||"").trim()).find(Boolean)||"";
const endpoint=(v)=>v.startsWith("libsql://")?"https://"+v.slice(9):v;
async function query(sql){
  const raw=first(URL_NAMES),token=first(TOKEN_NAMES);
  if(!raw||!token)throw new Error("Turso env unavailable");
  const res=await fetch(endpoint(raw).replace(/\/$/,"")+"/v2/pipeline",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({requests:[{type:"execute",stmt:{sql,args:[]}},{type:"close"}]})});
  const txt=await res.text(); if(!res.ok)throw new Error(`Turso ${res.status}: ${txt.slice(0,300)}`);
  const json=JSON.parse(txt),result=json.results?.[0]?.response?.result;
  const cols=(result?.cols||[]).map(c=>String(c?.name||""));
  return (result?.rows||[]).map(row=>{const o={};cols.forEach((c,i)=>o[c]=row[i]?.type==="null"?"":String(row[i]?.value??""));return o});
}
function payloadRows(rows){return rows.map(r=>{try{return JSON.parse(r.payload_json||"{}")}catch{return{}}})}
const clean=v=>String(v??"").trim();
const n=v=>{const s=clean(v).replaceAll(",","");if(!s)return null;const x=Number(s);return Number.isFinite(x)?x:null};
const iso=v=>{const s=clean(v);let m=s.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);if(m)return `${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;m=s.match(/(\d{1,2})\/(\d{1,2})\/(20\d{2})/);return m?`${m[3]}-${m[1].padStart(2,"0")}-${m[2].padStart(2,"0")}`:""};
const norm=v=>clean(v).toLowerCase().replace(/[^a-z0-9]+/g,"");
const gid=r=>clean(r["Game ID"]||r["Game Key"]).replace(/\.0$/,"");
const key=r=>{const id=gid(r);return id?`id:${id}`:`t:${iso(r.Date||r["Game Date"])}|${norm(r["Away Team"])}|${norm(r["Home Team"])}`};
const grade=(pickDiff,actualDiff)=>Math.abs(actualDiff)<1e-9?"P":pickDiff*actualDiff>0?"W":"L";
function record(arr,resultField,marginField){let W=0,L=0,P=0,sum=0,m=0;for(const r of arr){const z=r[resultField];if(z==="W")W++;else if(z==="L")L++;else if(z==="P")P++;const mar=r[marginField];if(Number.isFinite(mar)){sum+=mar;m++}}return{n:W+L+P,record:`${W}-${L}-${P}`,winPct:W+L?+(W/(W+L)*100).toFixed(1):0,avgMargin:m?+(sum/m).toFixed(2):null}}
const defs=[["10+",10,null],["7-<10",7,10],["5-<7",5,7],["3-<5",3,5],["<3",0,3]];
const thresholds=[10,7,5,3,0];
function buckets(rows,e,r,m){return defs.map(([label,lo,hi])=>({label,...record(rows.filter(x=>Number.isFinite(x[e])&&x[e]>=lo&&(hi==null||x[e]<hi)),r,m)}))}
function cumulative(rows,e,r,m){return thresholds.map(t=>({edge:t===0?"Any":`>=${t}`,...record(rows.filter(x=>Number.isFinite(x[e])&&x[e]>=t),r,m)}))}
function byWeek(rows,r,m){return ["1","2","3"].map(week=>({week,...record(rows.filter(x=>x.week===week),r,m)}))}
async function espnScoresById(ids){
  const map=new Map();
  for(let i=0;i<ids.length;i+=10){
    const chunk=ids.slice(i,i+10);
    const results=await Promise.all(chunk.map(async id=>{
      try{
        const res=await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=${id}`);
        if(!res.ok)return null;
        const json=await res.json(),comp=json?.header?.competitions?.[0]; if(!comp)return null;
        const competitors=comp.competitors||[];
        const away=competitors.find(c=>c.homeAway==="away"),home=competitors.find(c=>c.homeAway==="home");
        const as=n(away?.score),hs=n(home?.score); if(as==null||hs==null)return null;
        return {id,awayScore:as,homeScore:hs,source:"ESPN_ID"};
      }catch{return null}
    }));
    for(const r of results)if(r)map.set(`id:${r.id}`,r);
  }
  return map;
}
async function espnScores(dates){
  const map=new Map();
  for(const date of dates){
    const token=date.replaceAll("-","");
    try{
      const res=await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${token}&limit=1000`);
      if(!res.ok)continue;
      const json=await res.json();
      for(const ev of json.events||[]){
        const comp=ev?.competitions?.[0]; if(!comp)continue;
        const competitors=comp.competitors||[];
        const away=competitors.find(c=>c.homeAway==="away"),home=competitors.find(c=>c.homeAway==="home");
        const as=n(away?.score),hs=n(home?.score); if(as==null||hs==null)continue;
        const id=clean(ev.id||comp.id); if(id)map.set(`id:${id}`,{awayScore:as,homeScore:hs,source:"ESPN"});
        const awayName=away?.team?.displayName||away?.team?.shortDisplayName||away?.team?.name||"";
        const homeName=home?.team?.displayName||home?.team?.shortDisplayName||home?.team?.name||"";
        map.set(`t:${date}|${norm(awayName)}|${norm(homeName)}`,{awayScore:as,homeScore:hs,source:"ESPN"});
      }
    }catch{}
  }
  return map;
}
try{
 const [slateDb,schedDb,trackerDb]=await Promise.all([
  query("SELECT row_index,payload_json FROM dataset_rows WHERE sport='NCAAF' AND dataset='daily_slate' ORDER BY row_index"),
  query("SELECT row_index,payload_json FROM dataset_rows WHERE sport='NCAAF' AND dataset='schedule' ORDER BY row_index"),
  query("SELECT row_index,payload_json FROM dataset_rows WHERE sport='NCAAF' AND dataset='bet_tracker' ORDER BY row_index")
 ]);
 const slateAll=payloadRows(slateDb).filter(r=>clean(r.Season||"2026")==="2026"&&["1","2","3"].includes(clean(r.Week)));
 const sched=payloadRows(schedDb).filter(r=>clean(r.Season||"2026")==="2026");
 const tracker=payloadRows(trackerDb).filter(r=>clean(r.Season||"2026")==="2026"&&["1","2","3"].includes(clean(r.Week)));
 const dedup=new Map(slateAll.map(r=>[key(r),r]));
 const smap=new Map(sched.map(r=>[key(r),r]));
 const tmap=new Map();
 for(const r of tracker){const as=n(r["Actual Away"]),hs=n(r["Actual Home"]);if(as!=null&&hs!=null)tmap.set(key(r),{awayScore:as,homeScore:hs,source:"TRACKER"})}
 const dates=[...new Set([...dedup.values()].map(r=>iso(r.Date||r["Game Date"])).filter(Boolean))].sort();
 const emap=await espnScores(dates);
 const missingIds=[];
 for(const s of dedup.values()){
   const k=key(s),g=smap.get(k)||{};
   const as=n(g["Away Score"]),hs=n(g["Home Score"]);
   if(as!=null&&hs!=null)continue;
   if(tmap.has(k)||emap.has(k))continue;
   const date=iso(s.Date||g["Game Date"]),tk=`t:${date}|${norm(s["Away Team"]||g["Away Team"])}|${norm(s["Home Team"]||g["Home Team"])}`;
   if(emap.has(tk))continue;
   const id=gid(s); if(id)missingIds.push(id);
 }
 const idmap=await espnScoresById([...new Set(missingIds)]);
 const rows=[]; const sources={SCHEDULE:0,TRACKER:0,ESPN:0,ESPN_ID:0,MISSING:0}; let missingSpread=0,missingTotal=0;
 for(const s of dedup.values()){
  const k=key(s),g=smap.get(k)||{};
  let as=n(g["Away Score"]),hs=n(g["Home Score"]),source="";
  if(as!=null&&hs!=null)source="SCHEDULE";
  else if(tmap.has(k)){({awayScore:as,homeScore:hs,source}=tmap.get(k))}
  else {
    const date=iso(s.Date||g["Game Date"]),tk=`t:${date}|${norm(s["Away Team"]||g["Away Team"])}|${norm(s["Home Team"]||g["Home Team"])}`;
    const e=emap.get(k)||emap.get(tk)||idmap.get(k); if(e){as=e.awayScore;hs=e.homeScore;source=e.source}
  }
  if(as==null||hs==null){sources.MISSING++;continue} sources[source]++;
  const pm=n(s["Projected Margin"]),line=n(s["Market Home Spread"]),pt=n(s["Projected Total"]),tl=n(s["Market Total"]);
  const actualMargin=hs-as,actualTotal=hs+as;
  let spreadEdge=null,spreadResult="",spreadMargin=null;
  if(pm!=null&&line!=null){const md=pm+line,ad=actualMargin+line;spreadEdge=Math.abs(md);if(Math.abs(md)>1e-9){spreadResult=grade(md,ad);spreadMargin=md>0?ad:-ad}}else missingSpread++;
  let totalEdge=null,totalResult="",totalMargin=null;
  if(pt!=null&&tl!=null){const md=pt-tl,ad=actualTotal-tl;totalEdge=Math.abs(md);if(Math.abs(md)>1e-9){totalResult=grade(md,ad);totalMargin=md>0?ad:-ad}}else missingTotal++;
  const ac=clean(g["Away Classification"]).toLowerCase(),hc=clean(g["Home Classification"]).toLowerCase();
  const noteFcs=/FCS\/non-FBS/i.test(clean(s.Notes));
  const fbsOnly=ac==="fbs"&&hc==="fbs"&&!noteFcs;
  rows.push({week:clean(s.Week),date:iso(s.Date),game:clean(s.Game),fbsOnly,noteFcs,spread20Plus:line!=null&&Math.abs(line)>=20,spreadEdge,spreadResult,spreadMargin,totalEdge,totalResult,totalMargin});
 }
 const spreads=rows.filter(r=>r.spreadResult),totals=rows.filter(r=>r.totalResult);
 const groups={
  spreadAll:spreads,
  spreadEligible:spreads.filter(r=>!r.spread20Plus),
  spreadFbs:spreads.filter(r=>r.fbsOnly),
  spreadFbsEligible:spreads.filter(r=>r.fbsOnly&&!r.spread20Plus),
  totalAll:totals,
  totalFbs:totals.filter(r=>r.fbsOnly)
 };
 const summary={counts:{slateRowsWeeks1to3:slateAll.length,uniqueGames:dedup.size,gradedGames:rows.length,sources,missingSpread,missingTotal},dates,weeks:["1","2","3"],spread:{all:{overall:record(groups.spreadAll,"spreadResult","spreadMargin"),buckets:buckets(groups.spreadAll,"spreadEdge","spreadResult","spreadMargin"),cumulative:cumulative(groups.spreadAll,"spreadEdge","spreadResult","spreadMargin"),byWeek:byWeek(groups.spreadAll,"spreadResult","spreadMargin")},eligibleUnder20:{overall:record(groups.spreadEligible,"spreadResult","spreadMargin"),buckets:buckets(groups.spreadEligible,"spreadEdge","spreadResult","spreadMargin"),cumulative:cumulative(groups.spreadEligible,"spreadEdge","spreadResult","spreadMargin"),byWeek:byWeek(groups.spreadEligible,"spreadResult","spreadMargin")},fbsEligible:{overall:record(groups.spreadFbsEligible,"spreadResult","spreadMargin"),buckets:buckets(groups.spreadFbsEligible,"spreadEdge","spreadResult","spreadMargin")}},total:{all:{overall:record(groups.totalAll,"totalResult","totalMargin"),buckets:buckets(groups.totalAll,"totalEdge","totalResult","totalMargin"),cumulative:cumulative(groups.totalAll,"totalEdge","totalResult","totalMargin"),byWeek:byWeek(groups.totalAll,"totalResult","totalMargin")},fbs:{overall:record(groups.totalFbs,"totalResult","totalMargin"),buckets:buckets(groups.totalFbs,"totalEdge","totalResult","totalMargin")}}};
 console.log("CFB_EDGE_COMPLETE="+JSON.stringify(summary));
}catch(err){console.log("CFB_EDGE_COMPLETE_ERROR="+String(err?.stack||err))}
