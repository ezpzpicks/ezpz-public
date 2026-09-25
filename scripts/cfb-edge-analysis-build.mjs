const URL_NAMES=["TURSO_DATABASE_URL","TURSO_URL","turso_TURSO_DATABASE_URL","DATABASE_URL"];
const TOKEN_NAMES=["TURSO_AUTH_TOKEN","TURSO_DATABASE_AUTH_TOKEN","turso_TURSO_AUTH_TOKEN","TURSO_TOKEN","DATABASE_AUTH_TOKEN"];
const first=ns=>ns.map(n=>String(process.env[n]||"").trim()).find(Boolean)||"";
const endpoint=v=>v.startsWith("libsql://")?"https://"+v.slice(9):v;
async function query(sql){
  const raw=first(URL_NAMES),token=first(TOKEN_NAMES); if(!raw||!token) throw new Error("Turso env unavailable");
  const res=await fetch(endpoint(raw).replace(/\/$/,"")+"/v2/pipeline",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({requests:[{type:"execute",stmt:{sql,args:[]}},{type:"close"}]})});
  const txt=await res.text(); if(!res.ok) throw new Error(`Turso ${res.status}: ${txt.slice(0,300)}`);
  const out=JSON.parse(txt).results?.[0]?.response?.result; const cols=(out?.cols||[]).map(c=>String(c?.name||""));
  return (out?.rows||[]).map(row=>Object.fromEntries(cols.map((c,i)=>[c,row[i]?.type==="null"?"":String(row[i]?.value??"")])));
}
const payload=rows=>rows.map(r=>{try{return JSON.parse(r.payload_json||"{}")}catch{return{}}});
const s=v=>String(v??"").trim(), norm=v=>s(v).toLowerCase().replace(/[^a-z0-9]+/g," ");
function n(v){const z=s(v).replace(/[−–—]/g,"-").replace(/,/g,"");if(!z)return null;const x=Number(z);return Number.isFinite(x)?x:null}
function iso(v){const z=s(v);let m=z.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);if(m)return `${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;m=z.match(/(\d{1,2})\/(\d{1,2})\/(20\d{2})/);return m?`${m[3]}-${m[1].padStart(2,"0")}-${m[2].padStart(2,"0")}`:""}
function id(r){return s(r["Game ID"]||r["Game Key"]).replace(/\.0$/,"")}
function key(r){const x=id(r);if(x)return "id:"+x;return `t:${iso(r.Date||r["Game Date"])}|${norm(r["Away Team"])}|${norm(r["Home Team"])}`}
const FBS=new Set(["acc","atlantic coast","atlantic coast conference","american","aac","american athletic","american athletic conference","big 12","big 12 conference","big ten","big ten conference","conference usa","c usa","cusa","mid american","mid american conference","mac","mountain west","mountain west conference","mwc","pac 12","pac 12 conference","pac12","sec","southeastern","southeastern conference","sun belt","sun belt conference","fbs independents","independent","independents"]);
function classGroup(r){
  const ac=norm(r["Away Classification"]),hc=norm(r["Home Classification"]),af=norm(r["Away Conference"]),hf=norm(r["Home Conference"]);
  if([ac,hc].some(x=>x.includes("fcs")||x.includes("non fbs"))) return "FCS_OR_NON_FBS";
  if(af&&hf&&(!FBS.has(af)||!FBS.has(hf))) return "FCS_OR_NON_FBS";
  return ac==="fbs"&&hc==="fbs"?"FBS_ONLY":"FCS_OR_NON_FBS";
}
async function espnByDates(dates){
  const map=new Map();
  await Promise.all(dates.map(async date=>{
    try{
      const res=await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${date.replaceAll("-","")}&limit=500`,{headers:{Accept:"application/json"}});
      if(!res.ok)return; const j=await res.json();
      for(const e of j.events||[]){
        const comp=e.competitions?.[0],cs=comp?.competitors||[]; if(!comp||!e.id)continue;
        const away=cs.find(c=>c.homeAway==="away"),home=cs.find(c=>c.homeAway==="home");
        const completed=Boolean(e.status?.type?.completed||comp.status?.type?.completed);
        const as=n(away?.score),hs=n(home?.score);
        map.set(String(e.id),{completed,awayScore:as,homeScore:hs,date});
      }
    }catch{}
  }));
  return map;
}
function grade(sideSign,actualSign){if(Math.abs(actualSign)<1e-9)return"P";return sideSign*actualSign>0?"W":"L"}
function rec(rows,field){let W=0,L=0,P=0;for(const r of rows){if(r[field]==="W")W++;else if(r[field]==="L")L++;else if(r[field]==="P")P++;}return{plays:W+L+P,record:`${W}-${L}-${P}`,winPct:W+L?+(100*W/(W+L)).toFixed(1):0}}
const BINS=[["15+",15,Infinity],["10-14.99",10,15],["7.5-9.99",7.5,10],["5-7.49",5,7.5],["2.5-4.99",2.5,5],["0-2.49",0,2.5]];
const TH=[15,10,7.5,5,2.5,0];
const buckets=(rows,e,r)=>BINS.map(([bucket,lo,hi])=>({bucket,...rec(rows.filter(x=>x[e]>=lo&&x[e]<hi),r)}));
const cum=(rows,e,r)=>TH.map(t=>({threshold:t?">="+t:"Any edge",...rec(rows.filter(x=>x[e]>=t),r)}));
const summarize=(rows,e,r)=>({record:rec(rows,r),buckets:buckets(rows,e,r),cumulative:cum(rows,e,r)});
try{
  const [slateDb,schedDb]=await Promise.all([
    query("SELECT row_index,payload_json FROM dataset_rows WHERE sport='NCAAF' AND dataset='daily_slate' ORDER BY row_index"),
    query("SELECT row_index,payload_json FROM dataset_rows WHERE sport='NCAAF' AND dataset='schedule' ORDER BY row_index")
  ]);
  const slate=payload(slateDb).filter(r=>s(r.Season||"2026")==="2026");
  const schedule=payload(schedDb).filter(r=>s(r.Season||"2026")==="2026");
  const schedMap=new Map(schedule.map(r=>[key(r),r]));
  const dedup=new Map(slate.map(r=>[key(r),r]));
  const dates=[...new Set([...dedup.values()].map(r=>iso(r.Date||r["Game Date"])).filter(Boolean))];
  const espn=await espnByDates(dates);
  const rows=[]; let scoreFromDb=0,scoreFromEspn=0,incomplete=0,unmatched=0;
  for(const row of dedup.values()){
    const sched=schedMap.get(key(row)); if(!sched){unmatched++;continue}
    let away=n(sched["Away Score"]),home=n(sched["Home Score"]),source="";
    if(away!=null&&home!=null){source="DB";scoreFromDb++}
    else{
      const e=espn.get(id(row)); if(e?.completed&&e.awayScore!=null&&e.homeScore!=null){away=e.awayScore;home=e.homeScore;source="ESPN";scoreFromEspn++}
      else{incomplete++;continue}
    }
    const pm=n(row["Projected Margin"]),hs=n(row["Market Home Spread"]??row["Home Spread"]??row["Opening Home Spread"]);
    const pt=n(row["Projected Total"]),mt=n(row["Market Total"]??row.Total??row["Opening Total"]);
    const actualMargin=home-away,actualTotal=home+away; const cg=classGroup(sched);
    let spreadEdge=null,spreadResult="",spreadSide="";
    if(pm!=null&&hs!=null){const d=pm+hs;if(Math.abs(d)>1e-9){spreadEdge=Math.abs(d);spreadSide=d>0?"HOME":"AWAY";spreadResult=grade(d,actualMargin+hs)}}
    let totalEdge=null,totalResult="",totalSide="";
    if(pt!=null&&mt!=null){const d=pt-mt;if(Math.abs(d)>1e-9){totalEdge=Math.abs(d);totalSide=d>0?"OVER":"UNDER";totalResult=grade(d,actualTotal-mt)}}
    rows.push({date:iso(row.Date||sched["Game Date"]),week:s(row.Week||sched.Week),game:s(row.Game)||`${s(row["Away Team"])} @ ${s(row["Home Team"])}`,gameId:id(row),classGroup:cg,homeSpread:hs,absSpread:hs==null?null:Math.abs(hs),spreadEdge,spreadResult,spreadSide,totalEdge,totalResult,totalSide,marketTotal:mt,scoreSource:source,modelVersion:s(row["Model Version"])});
  }
  rows.sort((a,b)=>a.date.localeCompare(b.date)||a.game.localeCompare(b.game));
  const spreads=rows.filter(r=>r.spreadResult),totals=rows.filter(r=>r.totalResult);
  const spreadUnder20=spreads.filter(r=>r.absSpread<20);
  const spreadFbs=spreads.filter(r=>r.classGroup==="FBS_ONLY"),spreadFbsUnder20=spreadFbs.filter(r=>r.absSpread<20);
  const totalFbs=totals.filter(r=>r.classGroup==="FBS_ONLY");
  const weeks=[...new Set(rows.map(r=>r.week))].sort((a,b)=>Number(a)-Number(b));
  const byWeek=weeks.map(week=>({week,spread:rec(spreads.filter(r=>r.week===week),"spreadResult"),spreadUnder20:rec(spreadUnder20.filter(r=>r.week===week),"spreadResult"),total:rec(totals.filter(r=>r.week===week),"totalResult")}));
  const topSpread=[...spreads].sort((a,b)=>b.spreadEdge-a.spreadEdge).slice(0,20).map(r=>({date:r.date,week:r.week,game:r.game,edge:+r.spreadEdge.toFixed(2),marketSpread:r.homeSpread,class:r.classGroup,result:r.spreadResult}));
  const out={
    counts:{slate:slate.length,uniqueSlate:dedup.size,schedule:schedule.length,gradedGames:rows.length,scoreFromDb,scoreFromEspn,incomplete,unmatched,spreadPlays:spreads.length,totalPlays:totals.length,spreadUnder20:spreadUnder20.length,fbsSpread:spreadFbs.length},
    dateRange:[rows[0]?.date,rows.at(-1)?.date],weeks,
    models:Object.fromEntries([...new Set(rows.map(r=>r.modelVersion))].map(v=>[v,rows.filter(r=>r.modelVersion===v).length])),
    spreadAll:summarize(spreads,"spreadEdge","spreadResult"),
    spreadUnder20:summarize(spreadUnder20,"spreadEdge","spreadResult"),
    spreadFbs:summarize(spreadFbs,"spreadEdge","spreadResult"),
    spreadFbsUnder20:summarize(spreadFbsUnder20,"spreadEdge","spreadResult"),
    totalAll:summarize(totals,"totalEdge","totalResult"),
    totalFbs:summarize(totalFbs,"totalEdge","totalResult"),
    byWeek,topSpread
  };
  console.log("CFB_COUNTS="+JSON.stringify({counts:out.counts,dateRange:out.dateRange,weeks:out.weeks,models:out.models}));
  console.log("CFB_SPREAD_ALL="+JSON.stringify(out.spreadAll));
  console.log("CFB_SPREAD_UNDER20="+JSON.stringify(out.spreadUnder20));
  console.log("CFB_SPREAD_FBS="+JSON.stringify(out.spreadFbs));
  console.log("CFB_SPREAD_FBS_UNDER20="+JSON.stringify(out.spreadFbsUnder20));
  console.log("CFB_TOTAL_ALL="+JSON.stringify(out.totalAll));
  console.log("CFB_TOTAL_FBS="+JSON.stringify(out.totalFbs));
  console.log("CFB_BY_WEEK="+JSON.stringify(out.byWeek));
  console.log("CFB_TOP_SPREAD="+JSON.stringify(out.topSpread));
}catch(err){console.log("CFB_EDGE_ANALYSIS_ERROR="+String(err?.stack||err));}
