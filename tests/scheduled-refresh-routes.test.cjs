const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('typescript'),{NextRequest}=require('next/server'),root=path.join(__dirname,'..');
function harness(file){
 let due=false,collections=0,reads=0,commits=0;
 const now=Date.parse('2026-10-24T16:00:00Z');
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const refresh={scheduledMarketRefresh:async()=>{reads++;return{due,intervalMinutes:due?5:30,policy:'30m-until-90m-v1'};},recordScheduledMarketRefresh:async()=>{commits++;}};
 const api={},source=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const imports={
  'next/server':require('next/server'),
  '../../../../lib/scheduledMarketRefresh':refresh,
  '../../../../lib/tursoStore':{withTursoReadCache:fn=>fn()},
  '../../../../lib/footballWeeklyMarket':{syncPostedFootballMarkets:async()=>{collections++;return{ok:true,errors:[]};}},
  '../../../../lib/footballPublicData':{buildFootballPublicData:async()=>{collections++;return{ok:true,today:'2026-10-24'};}},
  '../../../../lib/ezpzCurrentPicks':{persistEzpzCurrentPicks:async()=>{}},
  '../../../../lib/footballResultSettlement':{settlePendingFootballResults:async()=>({})},
  '../../../../lib/ncaafFinalScoreRepair':{repairNcaafFinalScores:async()=>({})},
  '../../../../lib/footballTrendV2Lifecycle':{evaluateFootballTrendV2:async()=>({})},
  '../../../../lib/ezpzHistoricalGrading':{repairHistoricalEzpzGrades:async()=>({})},
  '../../public-data-v2/route':{GET:async()=>{collections++;return Response.json({ok:true,draftKingsPersistence:{status:'SAVED'}});}},
 };
 vm.runInNewContext(source,{exports:api,Date:Clock,Intl,URL,Response,console,setTimeout,process:{env:{CRON_SECRET:'test'}},require:id=>imports[id]||{}});
 return{get:api.GET,due:()=>{due=true;},counts:()=>({collections,reads,commits})};
}
for(const [file,sport] of [
 ['app/api/cron/football-market-discovery/route.ts','NFL'],
 ['app/api/cron/football-public-snapshot/route.ts','NCAAF'],
 ['app/api/cron/mlb-live-data/route.ts','MLB'],
])test(`${sport} ${file} authenticates before the gate, skips expensive work, and records successful collection`,async()=>{
 const h=harness(file),url=`https://example.test/api/cron?sport=${sport}`;
 assert.equal((await h.get(new NextRequest(url))).status,401);
 assert.deepEqual(h.counts(),{collections:0,reads:0,commits:0});
 const request=()=>new NextRequest(url,{headers:{authorization:'Bearer test'}});
 const skipped=await h.get(request());assert.equal((await skipped.json()).skipped,true);
 assert.equal(h.counts().collections,0);assert.equal(h.counts().commits,0);
 h.due();const captured=await h.get(request());assert.equal(captured.status,200);
 assert.equal(h.counts().collections,1);assert.equal(h.counts().commits,1);
});
