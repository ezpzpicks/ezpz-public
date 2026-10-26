const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const file=path.join(__dirname,'../lib/scoresAndOddsBettingSplits.ts');
const html=fs.readFileSync(path.join(__dirname,'fixtures/nba-consensus-rollover.html'),'utf8');
function source(fetch){
 const api={};
 class Clock extends Date{constructor(...args){super(...(args.length?args:['2026-10-26T04:05:00Z']));}}
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports:api,Date:Clock,Intl,AbortSignal,fetch,require:()=>({})});return api;
}
test('NBA uses each event kickoff through Eastern rollover even if the page title is yesterday',()=>{
 const rows=source().parseScoresAndOddsConsensus(html,'NBA');
 assert.equal(rows.filter(r=>r.market==='Spread'||r.market==='Total').length,4);
 assert(rows.every(r=>r.date==='2026-10-26'&&r.eventTime==='19:00'));
});
test('NBA requests the explicit game date and retains its source URL provenance',async()=>{
 let called;
 const api=source(async(url,options)=>{called={url,options};return{ok:true,text:async()=>html};});
 const loaded=await api.loadScoresAndOddsConsensus('NBA',{date:'2026-10-26'});
 assert.equal(called.url,'https://www.scoresandodds.com/nba/consensus-picks?date=2026-10-26');
 assert.equal(called.options.cache,'no-store');assert(loaded.splits.every(r=>r.sourceUrl===called.url));
});
test('NCAAF pins the new Sunday-Saturday week instead of accepting the source default',async()=>{
 let called;
 const api=source(async(url)=>{called=url;return{ok:true,text:async()=>'<title>NCAAF</title><p>No games scheduled</p>'};});
 await api.loadScoresAndOddsConsensus('NCAAF');
 assert.equal(called,'https://www.scoresandodds.com/ncaaf/consensus-picks?week=2026-reg-9');
 assert.equal(api.scoresAndOddsNcaafWeek('2026-10-24'),'2026-reg-8');
 assert.equal(api.scoresAndOddsNcaafWeek('2026-10-25'),'2026-reg-9');
});
