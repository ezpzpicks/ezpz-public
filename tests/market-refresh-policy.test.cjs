const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('typescript'),load=require('./load-typescript.cjs'),root=path.join(__dirname,'..');
const policy=load(path.join(root,'lib/marketRefreshPolicy.ts'));
const now=Date.parse('2026-10-24T16:00:00Z'),minute=60000;
const game=lead=>({date:'2026-10-24',kickoff:now+lead*minute,final:false});

function durableGate(tables){
  const storage={readTursoDataset:async(_,tab)=>tables[tab]||[],readTursoDatasetByDateKeys:async(_,tab)=>tables[tab]||[],
    replaceTursoDataset:async(_,tab,rows)=>{tables[tab]=rows;}};
  return()=>{const api={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'lib/scheduledMarketRefresh.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports:api,Date,Intl,console:{info(){}},require:id=>id==='./tursoStore'?storage:id==='./marketRefreshPolicy'?policy:id==='./footballWeeklyMarket'?{nflKickoffIso:(_,time)=>time}:id==='./mlbTrendV2'?{isoDate:x=>x}:{}});return api;};
}

test('quiet slates run every 30 minutes and the 90-minute boundary immediately enables five-minute collection',()=>{
  assert.equal(policy.marketRefreshDecision([game(91)],'2026-10-24',now,now-10*minute).due,false);
  assert.equal(policy.marketRefreshDecision([game(91)],'2026-10-24',now,now-30*minute).due,true);
  const fast=policy.marketRefreshDecision([game(90)],'2026-10-24',now,now-5*minute);
  assert.equal(fast.intervalMinutes,5);assert.equal(fast.due,true);
  assert.equal(policy.marketRefreshDecision([game(15)],'2026-10-24',now,now-5*minute).due,true);
  assert.equal(policy.marketRefreshDecision([game(15)],'2026-10-24',now,now).due,false);
});
test('unknown same-day kickoffs, live games and recovery stay fast; completed games do not keep a slate active',()=>{
  assert.equal(policy.marketRefreshDecision([{...game(0),kickoff:null}],'2026-10-24',now,null).intervalMinutes,5);
  assert.equal(policy.marketRefreshDecision([game(-180)],'2026-10-24',now,null,true).intervalMinutes,5);
  assert.equal(policy.marketRefreshDecision([{...game(-600),live:true}],'2026-10-24',now,null,true).intervalMinutes,5);
  assert.equal(policy.marketRefreshDecision([game(-180)],'2026-10-24',now,null,false).intervalMinutes,30);
  assert.equal(policy.marketRefreshDecision([{...game(-180),final:true}],'2026-10-24',now,null,true).intervalMinutes,30);
  assert.equal(policy.marketRefreshDecision([],'2026-10-24',now,null).due,true);
});
test('only snapshots saved under the slower policy receive a longer quiet-period freshness window',()=>{
  const far={gameTime:new Date(now+120*minute).toISOString()};
  const saved={refreshPolicy:policy.MARKET_REFRESH_POLICY,refreshIntervalMinutes:30,picks:[far]};
  assert.equal(policy.currentPickSnapshotMaxAge(saved,now),35*minute);
  assert.equal(policy.currentPickSnapshotMaxAge({...saved,refreshPolicy:''},now),20*minute);
  assert.equal(policy.currentPickSnapshotMaxAge({...saved,picks:[{gameTime:new Date(now+90*minute).toISOString()}]},now),20*minute);
  assert.equal(policy.currentPickSnapshotMaxAge({...saved,picks:[{gameTime:'unknown'}]},now),20*minute);
  assert.equal(policy.currentPickSnapshotMaxAge({...saved,picks:[{date:'2026-10-24',gameTime:'3:00 PM'}]},now),35*minute);
  assert.equal(policy.currentPickSnapshotMaxAge({...saved,picks:[{date:'2026-10-24',gameTime:'12:30 PM'}]},now),20*minute);
});
test('every cron offset captures a real observation inside the existing final-snapshot window',()=>{
  for(let offset=0;offset<5;offset++)for(let kickoffMinute=0;kickoffMinute<60;kickoffMinute++){
    const kickoff=now+(240+kickoffMinute)*minute,captures=[];let last=null;
    for(let tick=now+offset*minute;tick<kickoff;tick+=5*minute){
      const decision=policy.marketRefreshDecision([{date:'2026-10-24',kickoff,final:false}],'2026-10-24',tick,last);
      if(decision.due){captures.push((kickoff-tick)/minute);last=tick;}
    }
    assert.ok(captures.some(lead=>lead>=10&&lead<=20),`offset ${offset}, kickoff minute ${kickoffMinute}`);
  }
});
test('the durable gate survives cold instances and never treats a failed attempt as success',async()=>{
  const tables={schedule:[{Date:'2026-10-24','Game Time':'2026-10-24T20:00:00Z'}]};
  const make=durableGate(tables);
  const first=make();
  assert.equal((await first.scheduledMarketRefresh('NFL','market',now)).due,true);
  assert.equal((await make().scheduledMarketRefresh('NFL','market',now+5*minute)).due,true);
  await first.recordScheduledMarketRefresh('NFL','market',now);
  assert.equal((await make().scheduledMarketRefresh('NFL','market',now+5*minute)).due,false);
  assert.equal((await make().scheduledMarketRefresh('NFL','market',now+30*minute)).due,true);
  assert.equal((await make().scheduledMarketRefresh('NFL','market',now+150*minute)).intervalMinutes,5);
});

test('public snapshots refresh on the new Eastern game date, then resume their normal cadence',async()=>{
  for(const midnight of ['2026-10-22T04:00:00Z','2026-12-05T05:00:00Z']){
    const tick=Date.parse(midnight)+4*minute,tables={},make=durableGate(tables);
    await make().recordScheduledMarketRefresh('NFL','public',tick-5*minute);
    await make().recordScheduledMarketRefresh('NFL','market',tick-5*minute);
    const rollover=await make().scheduledMarketRefresh('NFL','public',tick);
    assert.equal(rollover.due,true);assert.equal(rollover.reason,'New game date');
    assert.equal(rollover.intervalMinutes,30);
    assert.equal((await make().scheduledMarketRefresh('NFL','market',tick)).due,false);
    await make().recordScheduledMarketRefresh('NFL','public',tick);
    assert.equal((await make().scheduledMarketRefresh('NFL','public',tick+5*minute)).due,false);
  }
});
