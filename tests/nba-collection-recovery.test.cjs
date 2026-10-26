const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const load=require('./load-typescript.cjs');
const core=load(path.join(__dirname,'../lib/nbaMarketCore.ts'));
const sourceRows=require('./fixtures/nba-consensus-2026-10-22.json');
const schedule={events:[{id:'101',season:{type:2},competitions:[{
 date:'2026-10-22T23:00:00Z',timeValid:true,status:{type:{name:'STATUS_SCHEDULED',state:'pre',completed:false}},
 competitors:[{homeAway:'away',team:{id:'5',displayName:'Cleveland Cavaliers',name:'Cavaliers'}},
  {homeAway:'home',team:{id:'20',displayName:'Philadelphia 76ers',name:'76ers'}}],
}]}]};
function harness(){
 let now=Date.parse('2026-10-22T22:30:00Z'),rows=[],lineupError=false;
 const tables={},requests=[];
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const imports={
  './nbaMarketCore':core,
  './scoresAndOddsBettingSplits':{loadScoresAndOddsConsensus:async(sport,request)=>{requests.push({sport,request});return{splits:rows,url:'https://www.scoresandodds.com/nba/consensus-picks?date=2026-10-22'};}},
  './tursoStore':{readTursoDatasetByDateKeys:async(_,tab)=>tables[tab]||[]},
  './nbaMarketStore':{saveNbaMarketRows:async(tab,values,history)=>{
   const key=r=>core.nbaRowKey(r)+(history?'|'+r['Snapshot Time ET']:'');
   const existing=new Map((tables[tab]||[]).map(r=>[key(r),r]));
   values.forEach(r=>existing.set(key(r),r));tables[tab]=[...existing.values()];
  }},
  './nbaAnalysis':{nbaScheduleRows:games=>games.map(g=>({Date:g.date,'Game ID':g.gameId,'Game Key':`${g.date}|nba|${g.gameId}`,'Game Time':g.tipoff})),refreshNbaAnalysis:async()=>({ok:true})},
  './nbaLineups':{refreshNbaLineups:async()=>{if(lineupError)throw new Error('lineup storage unavailable');return{games:1,changed:0};}},
 };
 const api={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib/nbaMarket.ts'),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
 }).outputText,{exports:api,Date:Clock,Intl,AbortSignal,console:{warn(){}},require:id=>imports[id]||{},
  fetch:async()=>({ok:true,json:async()=>schedule})});
 return{collect:()=>api.collectNbaMarket(),tables,requests,
  recover:()=>{rows=sourceRows;},setTime:value=>{now=Date.parse(value);},failLineups:()=>{lineupError=true;}};
}
test('an unavailable NBA market still saves its verified countdown schedule, without inventing observations',async()=>{
 const h=harness();
 await assert.rejects(h.collect(),/no complete matching/);
 assert.equal(h.tables.schedule.length,1);assert.equal(h.tables.posted_games.length,1);
 assert.equal(h.tables.public_split_snapshots,undefined);
 assert.equal(h.requests[0].request.date,'2026-10-22');
});
test('a recovered source saves real final quartets even if lineup storage fails; later refreshes cannot overwrite locks',async()=>{
 const h=harness();await assert.rejects(h.collect(),/no complete matching/);
 h.recover();h.failLineups();h.setTime('2026-10-22T22:45:00Z');
 const result=await h.collect();assert.equal(result.finalSides,4);assert.equal(result.lineups.ok,false);
 const frozen=JSON.stringify(h.tables.public_split_snapshots);
 assert(h.tables.public_split_snapshots.every(r=>r['Frozen At']==='2026-10-22T22:45:00.000Z'));
 h.setTime('2026-10-22T22:50:00Z');assert.equal((await h.collect()).finalSides,0);
 assert.equal(JSON.stringify(h.tables.public_split_snapshots),frozen);
});
