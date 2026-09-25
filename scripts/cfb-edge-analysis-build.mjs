const URL_NAMES=["TURSO_DATABASE_URL","TURSO_URL","turso_TURSO_DATABASE_URL","DATABASE_URL"];
const TOKEN_NAMES=["TURSO_AUTH_TOKEN","TURSO_DATABASE_AUTH_TOKEN","turso_TURSO_AUTH_TOKEN","TURSO_TOKEN","DATABASE_AUTH_TOKEN"];
const first=(names)=>names.map(n=>String(process.env[n]||"").trim()).find(Boolean)||"";
const endpoint=(v)=>v.startsWith("libsql://")?"https://"+v.slice(9):v;
const sqlText=(v)=>"'"+String(v).replaceAll("'","''")+"'";
async function query(sql){
  const raw=first(URL_NAMES), token=first(TOKEN_NAMES);
  if(!raw||!token) throw new Error("Turso env unavailable in build");
  const res=await fetch(endpoint(raw).replace(/\/$/,"")+"/v2/pipeline",{
    method:"POST",
    headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},
    body:JSON.stringify({requests:[{type:"execute",stmt:{sql,args:[]}},{type:"close"}]})
  });
  const txt=await res.text();
  if(!res.ok) throw new Error(`Turso ${res.status}: ${txt.slice(0,300)}`);
  const json=JSON.parse(txt), result=json.results?.[0]?.response?.result;
  const cols=(result?.cols||[]).map(c=>String(c?.name||""));
  return (result?.rows||[]).map(row=>{
    const o={}; cols.forEach((c,i)=>o[c]=row[i]?.type==="null"?"":String(row[i]?.value??"")); return o;
  });
}
function payloadRows(rows){return rows.map(r=>{try{return JSON.parse(r.payload_json||"{}")}catch{return{}}});}
function clean(v){return String(v??"").trim()}
function n(v){const s=clean(v).replaceAll(",","");if(!s)return null;const x=Number(s);return Number.isFinite(x)?x:null}
function yes(v){return ["1","true","yes","y","completed","final"].includes(clean(v).toLowerCase())}
function iso(v){const s=clean(v);let m=s.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);if(m)return `${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;m=s.match(/(\d{1,2})\/(\d{1,2})\/(20\d{2})/);return m?`${m[3]}-${m[1].padStart(2,"0")}-${m[2].padStart(2,"0")}`:""}
function norm(v){return clean(v).toLowerCase().replace(/[^a-z0-9]+/g,"")}
function key(r){const id=clean(r["Game ID"]||r["Game Key"]).replace(/\.0$/,"");return id?`id:${id}`:`t:${iso(r.Date||r["Game Date"])}|${norm(r["Away Team"])}|${norm(r["Home Team"])}`}
function grade(signPick,actual){if(Math.abs(actual)<1e-9)return"P";return signPick*actual>0?"W":"L"}
function record(arr,field){let W=0,L=0,P=0,sum=0,m=0;for(const r of arr){const z=r[field];if(z==="W")W++;else if(z==="L")L++;else if(z==="P")P++;const margin=field==="spreadResult"?r.spreadAtsMargin:r.totalMargin;if(Number.isFinite(margin)){sum+=margin;m++}}return{n:W+L+P,record:`${W}-${L}-${P}`,winPct:W+L?+(W/(W+L)*100).toFixed(1):0,avgResultMargin:m?+(sum/m).toFixed(2):null}}
const discreteDefs=[["10+",10,null],["7-<10",7,10],["5-<7",5,7],["3-<5",3,5],["<3",0,3]];
const altDefs=[["12+",12,null],["9-<12",9,12],["6-<9",6,9],["3-<6",3,6],["<3",0,3]];
const thresholds=[12,10,9,7,6,5,3];
function bucket(rows,edgeField,resultField,defs){return defs.map(([label,lo,hi])=>{const a=rows.filter(r=>Number.isFinite(r[edgeField])&&r[edgeField]>=lo&&(hi==null||r[edgeField]<hi));return{label,...record(a,resultField)}})}
function cumulative(rows,edgeField,resultField){return thresholds.map(t=>{const a=rows.filter(r=>Number.isFinite(r[edgeField])&&r[edgeField]>=t);return{edge:`>=${t}`,...record(a,resultField)}})}
function quant(vals){const a=vals.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return{};const q=p=>{const i=(a.length-1)*p,l=Math.floor(i),h=Math.ceil(i);return +(a[l]+(a[h]-a[l])*(i-l)).toFixed(2)};return{n:a.length,min:a[0],p25:q(.25),p50:q(.5),p75:q(.75),p90:q(.9),max:a.at(-1)}}
function byWeek(rows,resultField){const weeks=[...new Set(rows.map(r=>r.week))].sort((a,b)=>Number(a)-Number(b));return weeks.map(week=>({week,...record(rows.filter(r=>r.week===week),resultField)}))}
try{
  const [slateDb,schedDb]=await Promise.all([
    query(`SELECT row_index,payload_json FROM dataset_rows WHERE sport='NCAAF' AND dataset='daily_slate' ORDER BY row_index`),
    query(`SELECT row_index,payload_json FROM dataset_rows WHERE sport='NCAAF' AND dataset='schedule' ORDER BY row_index`)
  ]);
  const slate=payloadRows(slateDb).filter(r=>clean(r.Season||"2026")==="2026");
  const sched=payloadRows(schedDb).filter(r=>clean(r.Season||"2026")==="2026");
  const smap=new Map(sched.map(r=>[key(r),r]));
  const dedup=new Map(slate.map(r=>[key(r),r]));
  const rows=[];
  let unmatched=0,incomplete=0,missingSpread=0,missingTotal=0;
  for(const s of dedup.values()){
    const g=smap.get(key(s)); if(!g){unmatched++;continue}
    const as=n(g["Away Score"]),hs=n(g["Home Score"]);
    const completed=yes(g.Completed)||(as!=null&&hs!=null);
    if(!completed||as==null||hs==null){incomplete++;continue}
    const pm=n(s["Projected Margin"]), line=n(s["Market Home Spread"]),pt=n(s["Projected Total"]),tl=n(s["Market Total"]);
    const actualMargin=hs-as, actualTotal=hs+as;
    let spreadEdge=null,spreadSide="",spreadResult="",spreadAtsMargin=null;
    if(pm!=null&&line!=null){
      const md=pm+line, ad=actualMargin+line;
      spreadEdge=Math.abs(md); spreadSide=md>0?"Home":md<0?"Away":"Push";
      spreadResult=Math.abs(md)<1e-9?"":grade(md,ad);
      spreadAtsMargin=spreadSide==="Home"?ad:spreadSide==="Away"?-ad:0;
    }else missingSpread++;
    let totalEdge=null,totalSide="",totalResult="",totalMargin=null;
    if(pt!=null&&tl!=null){
      const md=pt-tl,ad=actualTotal-tl;
      totalEdge=Math.abs(md);totalSide=md>0?"Over":md<0?"Under":"Push";
      totalResult=Math.abs(md)<1e-9?"":grade(md,ad);
      totalMargin=totalSide==="Over"?ad:totalSide==="Under"?-ad:0;
    }else missingTotal++;
    const ac=clean(g["Away Classification"]).toLowerCase(),hc=clean(g["Home Classification"]).toLowerCase();
    rows.push({
      date:iso(s.Date||g["Game Date"]),week:clean(s.Week||g.Week),game:clean(s.Game)||`${clean(g["Away Team"])} @ ${clean(g["Home Team"])}`,
      fbsOnly:ac==="fbs"&&hc==="fbs",hasFcs:ac==="fcs"||hc==="fcs",
      absSpread:line==null?null:Math.abs(line),spread20Plus:line!=null&&Math.abs(line)>=20,
      projectedMargin:pm,homeSpread:line,spreadEdge,spreadSide,spreadResult,spreadAtsMargin,
      projectedTotal:pt,marketTotal:tl,totalEdge,totalSide,totalResult,totalMargin,actualMargin,actualTotal,
      modelVersion:clean(s["Model Version"]),notes:clean(s.Notes)
    });
  }
  const spreads=rows.filter(r=>r.spreadResult), totals=rows.filter(r=>r.totalResult);
  const fbs=spreads.filter(r=>r.fbsOnly), under20=spreads.filter(r=>!r.spread20Plus), fbsUnder20=spreads.filter(r=>r.fbsOnly&&!r.spread20Plus);
  const totalsFbs=totals.filter(r=>r.fbsOnly);
  const suspectedNonFbs=rows.filter(r=>r.hasFcs||/FCS\/non-FBS/i.test(r.notes));
  const topSpread=[...spreads].sort((a,b)=>b.spreadEdge-a.spreadEdge).slice(0,15).map(r=>({date:r.date,week:r.week,game:r.game,edge:+r.spreadEdge.toFixed(2),line:r.homeSpread,pick:r.spreadSide,result:r.spreadResult,fbsOnly:r.fbsOnly,hasFcs:r.hasFcs,noteFcs:/FCS\/non-FBS/i.test(r.notes)}));
  const topTotal=[...totals].sort((a,b)=>b.totalEdge-a.totalEdge).slice(0,12).map(r=>({date:r.date,week:r.week,game:r.game,edge:+r.totalEdge.toFixed(2),line:r.marketTotal,pick:r.totalSide,result:r.totalResult,fbsOnly:r.fbsOnly,hasFcs:r.hasFcs,noteFcs:/FCS\/non-FBS/i.test(r.notes)}));
  const out={
    counts:{slateRaw:slateDb.length,slate2026:slate.length,uniqueSlate:dedup.size,schedule2026:sched.length,completedMatched:rows.length,unmatched,incomplete,missingSpread,missingTotal},
    dateRange:[rows.map(r=>r.date).sort()[0],rows.map(r=>r.date).sort().at(-1)],weeks:[...new Set(rows.map(r=>r.week))].sort((a,b)=>Number(a)-Number(b)),
    classifications:{fbsOnly:rows.filter(r=>r.fbsOnly).length,storedHasFcs:rows.filter(r=>r.hasFcs).length,noteFlagsNonFbs:suspectedNonFbs.length,marketSpread20Plus:rows.filter(r=>r.spread20Plus).length},
    modelVersions:Object.fromEntries([...new Set(rows.map(r=>r.modelVersion))].map(v=>[v,rows.filter(r=>r.modelVersion===v).length])),
    spread:{
      overall:record(spreads,"spreadResult"),fbsOnly:record(fbs,"spreadResult"),under20:record(under20,"spreadResult"),fbsUnder20:record(fbsUnder20,"spreadResult"),
      quantiles:quant(spreads.map(r=>r.spreadEdge)),discreteAll:bucket(spreads,"spreadEdge","spreadResult",discreteDefs),discreteFbs:bucket(fbs,"spreadEdge","spreadResult",discreteDefs),discreteUnder20:bucket(under20,"spreadEdge","spreadResult",discreteDefs),discreteFbsUnder20:bucket(fbsUnder20,"spreadEdge","spreadResult",discreteDefs),
      altUnder20:bucket(under20,"spreadEdge","spreadResult",altDefs),cumulativeAll:cumulative(spreads,"spreadEdge","spreadResult"),cumulativeUnder20:cumulative(under20,"spreadEdge","spreadResult"),byWeekAll:byWeek(spreads,"spreadResult"),byWeekUnder20:byWeek(under20,"spreadResult"),top:topSpread
    },
    total:{
      overall:record(totals,"totalResult"),fbsOnly:record(totalsFbs,"totalResult"),quantiles:quant(totals.map(r=>r.totalEdge)),
      discreteAll:bucket(totals,"totalEdge","totalResult",discreteDefs),discreteFbs:bucket(totalsFbs,"totalEdge","totalResult",discreteDefs),altAll:bucket(totals,"totalEdge","totalResult",altDefs),cumulativeAll:cumulative(totals,"totalEdge","totalResult"),byWeekAll:byWeek(totals,"totalResult"),top:topTotal
    }
  };
  console.log("CFB_EDGE_ANALYSIS_JSON="+JSON.stringify(out));
}catch(err){
  console.log("CFB_EDGE_ANALYSIS_ERROR="+String(err?.stack||err));
}
