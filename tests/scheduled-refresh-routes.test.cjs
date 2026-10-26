const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('typescript'),{NextRequest}=require('next/server'),root=path.join(__dirname,'..');
function harness(file,options={}){
 let due=false,collections=0,reads=0,commits=0,publications=0;
 let now=Date.parse('2026-10-24T16:00:00Z');
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const refresh={scheduledMarketRefresh:async(...args)=>{reads++;return options.refresh?options.refresh.scheduledMarketRefresh(...args):{due,intervalMinutes:due?5:30,policy:'30m-until-90m-v1'};},recordScheduledMarketRefresh:async(...args)=>{commits++;if(options.refresh)await options.refresh.recordScheduledMarketRefresh(...args);}};
 const api={},source=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const imports={
  'next/server':require('next/server'),
  '../../../../lib/scheduledMarketRefresh':refresh,
  '../../../../lib/tursoStore':{withTursoReadCache:fn=>fn()},
  '../../../../lib/footballWeeklyMarket':{
   syncPostedFootballMarkets:async()=>{collections++;if(options.error)throw options.error;return options.result||{ok:true,refreshCompleted:true,errors:[]};},
   inspectPostedFootballMarkets:async()=>{collections++;return{ok:true,dryRun:true,errors:[]};},
  },
  '../../../../lib/footballPublicData':{buildFootballPublicData:async(_,opts)=>{collections++;if(options.captureError&&opts.persist)throw options.captureError;return{ok:true,today:'2026-10-24'};}},
  '../../../../lib/ezpzCurrentPicks':{persistEzpzCurrentPicks:async()=>{}},
  '../../../../lib/publicBoardSnapshot':{persistPublicBoardSnapshot:async()=>{publications++;return{saved:true};}},
  '../../../../lib/footballPublicDisplay':{restoreFootballPublicDisplay:value=>value},
  '../../football-weekly-market/route':{GET:async()=>Response.json({ok:true,games:[],trendPlays:[]})},
  '../../../../lib/footballResultSettlement':{settlePendingFootballResults:async()=>({})},
  '../../../../lib/ncaafFinalScoreRepair':{repairNcaafFinalScores:async()=>({})},
  '../../../../lib/footballTrendV2Lifecycle':{evaluateFootballTrendV2:async()=>({})},
  '../../../../lib/ezpzHistoricalGrading':{repairHistoricalEzpzGrades:async()=>({})},
  '../../public-data-v2/route':{GET:async()=>{collections++;return Response.json({ok:true,draftKingsPersistence:{status:'SAVED'}});}},
 };
 vm.runInNewContext(source,{exports:api,Date:Clock,Intl,URL,Response,console:{info(){},error(){},warn(){}},setTimeout,process:{env:{CRON_SECRET:'test',VERCEL_ENV:'production'}},require:id=>imports[id]||{}});
 return{get:api.GET,due:()=>{due=true;},setTime:time=>{now=Date.parse(time);},publications:()=>publications,counts:()=>({collections,reads,commits})};
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

const marketRoute='app/api/cron/football-market-discovery/route.ts';
test('a failed off-day feed still publishes the retained board and does not report collection success',async()=>{
 const h=harness('app/api/cron/football-public-snapshot/route.ts',{captureError:new Error('empty live slate')});
 h.due();
 const response=await h.get(new NextRequest('https://example.test/api/cron?sport=NCAAF',{headers:{authorization:'Bearer test'}}));
 assert.equal(response.status,500);
 assert.equal(h.publications(),1);
 assert.equal(h.counts().commits,0);
 assert.equal(h.counts().collections,2);
});
const marketRequest=(suffix='')=>new NextRequest(`https://example.test/api/cron?sport=NCAAF${suffix}`,{headers:{authorization:'Bearer test'}});
test('a saved refresh with feed warnings persists the clock and skips the next cold instance',async()=>{
 const tables={posted_games:[{Date:'2026-10-24','Game Time':'2026-10-24T20:00:00Z'}]};
 const policy=require('./load-typescript.cjs')(path.join(root,'lib/marketRefreshPolicy.ts'));
 const storage={readTursoDataset:async(_,tab)=>tables[tab]||[],readTursoDatasetByDateKeys:async(_,tab)=>tables[tab]||[],replaceTursoDataset:async(_,tab,rows)=>{tables[tab]=rows;}};
 const makeRefresh=()=>{const api={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'lib/scheduledMarketRefresh.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports:api,Date,Intl,console:{info(){}},require:id=>id==='./tursoStore'?storage:id==='./marketRefreshPolicy'?policy:id==='./footballWeeklyMarket'?{nflKickoffIso:(_,time)=>time}:id==='./mlbTrendV2'?{isoDate:x=>x}:{}});return api;};
 const result={ok:true,refreshCompleted:true,errors:['ScoresAndOdds returned 200 parsed market sides; 166 matched the schedule before validation.']};
 const first=harness(marketRoute,{refresh:makeRefresh(),result});
 assert.equal((await first.get(marketRequest())).status,200);
 assert.equal(tables.refresh_state_market[0]['Updated At'],'2026-10-24T16:00:00.000Z');
 const cold=harness(marketRoute,{refresh:makeRefresh(),result});cold.setTime('2026-10-24T16:05:00Z');
 assert.equal((await(await cold.get(marketRequest())).json()).skipped,true);
 assert.deepEqual(cold.counts(),{collections:0,reads:1,commits:0});
 cold.setTime('2026-10-24T16:30:00Z');
 assert.equal((await(await cold.get(marketRequest())).json()).refreshCompleted,true);
 assert.equal(tables.refresh_state_market[0]['Updated At'],'2026-10-24T16:30:00.000Z');
});
test('incomplete saves, thrown failures and dry runs never record successful collection',async()=>{
 for(const options of [{result:{ok:true,refreshCompleted:false,errors:['Market history append failed: unavailable']}},{error:new Error('database unavailable')}]){
  const h=harness(marketRoute,options);h.due();
  await h.get(marketRequest());await h.get(marketRequest());
  assert.deepEqual(h.counts(),{collections:2,reads:2,commits:0});
 }
 const dry=harness(marketRoute);dry.due();
 assert.equal((await(await dry.get(marketRequest('&dryRun=1'))).json()).dryRun,true);
 assert.deepEqual(dry.counts(),{collections:1,reads:0,commits:0});
});
