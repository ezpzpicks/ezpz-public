const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const now = Date.parse('2026-10-30T17:11:00Z');
const kickoff = '2026-10-30T23:00:00Z';
const slate = { Date:'2026-10-30',Season:'2026','Game ID':'401999001','Away Team':'LSU','Home Team':'Auburn',
  'Model Version':'cfb-v2.8.1-five-game-residual-totals-2026-10-07','Market Total':'50','Projected Total':'43',
  'Total Edge':'7','Total Pick':'Under 50','Total Grade':'A Total' };
const schedule = { 'Game ID':slate['Game ID'],'Game Date':slate.Date,'Game Time':kickoff,
  'Away Team':'LSU','Home Team':'Auburn',Completed:'False','Away Score':'','Home Score':'' };
function setup() {
  const db = new DatabaseSync(':memory:');
  const state = { clock:now, writes:0, fail:false };
  const clockSql = sql => sql.replaceAll("datetime('now')",`datetime('${new Date(state.clock).toISOString()}')`);
  const stub = {
    runTursoSql: async statements => statements.map(sql => db.prepare(clockSql(sql)).all().map(row => Object.fromEntries(Object.entries(row).map(([k,v]) => [k,v==null?'':String(v)])))),
    runTursoAtomicSql: async statements => {
      state.writes++;db.exec('BEGIN IMMEDIATE');
      try {
        for(const sql of statements) {
          if(state.fail && sql.startsWith('INSERT OR IGNORE INTO ncaaf_total_forward_predictions'))throw Error('Simulated insert failure');
          db.exec(clockSql(sql));
        }
        db.exec('COMMIT');
      } catch(error) { db.exec('ROLLBACK');throw error; }
    },
  };
  const cache = new Map();
  function load(file) {
    if(cache.has(file))return cache.get(file);
    const exports={};cache.set(file,exports);
    const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    vm.runInNewContext(code,{exports,Date,Intl,console,require:name=>name==='./tursoStore'?stub:name.startsWith('.')?load(path.resolve(path.dirname(file),`${name}.ts`)):require(name)});
    return exports;
  }
  return { db,state,policy:load(path.join(root,'lib/ncaafTotalForwardPolicy.ts')),store:load(path.join(root,'lib/ncaafTotalForwardStore.ts')) };
}

test('A-total fade flips only direction, keeps exact line, and saves its paired original control',()=>{
  const {policy}=setup();const a=policy.totalForwardGame(slate,schedule,now);
  assert.equal(a.predictions.length,2);
  assert.equal(a.predictions[0].strategy,'a_total_fade');assert.equal(a.predictions[0].selection,'Over 50');
  assert.equal(a.predictions[1].selection,'Under 50');
  assert.ok(a.predictions.every(p=>p.odds===-110 && p.stakeUnits===1 && p.priceBasis==='ASSUMED_MINUS_110' && p.official===false && p.eligibleForPosting===false));
  assert.equal(a.capturedAt,new Date(now).toISOString());assert.equal(slate['Total Pick'],'Under 50');
});
test('B totals follow their original side at a gap of 3 to below 6',()=>{
  const {policy}=setup();
  for(const edge of [3,5.99]) {
    const a=policy.totalForwardGame({...slate,'Total Grade':'B Total','Total Pick':'Over 50','Projected Total':String(50+edge),'Total Edge':String(edge)},schedule,now);
    assert.equal(a.predictions.length,1);assert.equal(a.predictions[0].selection,'Over 50');assert.equal(a.predictions[0].strategy,'b_total_original');
  }
  const none=policy.totalForwardGame({...slate,'Total Grade':'No Play','Projected Total':'48','Total Edge':'2'},schedule,now);
  assert.equal(none.predictions.length,0);
});
test('only A grades at a positive 6+ point edge qualify for the fade',()=>{
  const {policy}=setup();
  assert.equal(policy.totalForwardGame({...slate,'Projected Total':'44','Total Edge':'6'},schedule,now).predictions.length,2);
  assert.equal(policy.totalForwardGame({...slate,'Projected Total':'44.01','Total Edge':'5.99'},schedule,now).predictions.length,0);
  const over=policy.totalForwardGame({...slate,'Projected Total':'58','Total Edge':'8','Total Pick':'Over 50'},schedule,now);
  assert.equal(over.predictions[0].selection,'Under 50');
});
test('reject past, kickoff-time, missing/ambiguous timezone, changed model, mismatched date/id/team and invalid prices/lines',()=>{
  const {policy}=setup();
  assert.equal(policy.totalForwardGame(slate,schedule,Date.parse(kickoff)),null);
  assert.equal(policy.totalForwardGame(slate,schedule,Date.parse('2026-10-29T12:00:00Z')),null);
  for(const fields of [{'Game Time':''},{'Game Time':'2026-10-30T23:00:00'},{Completed:'True'},{'Game ID':'401999002'},{'Game Date':'2026-10-31'},{'Home Team':'Alabama'}])assert.equal(policy.totalForwardGame(slate,{...schedule,...fields},now),null);
  for(const fields of [{'Model Version':'new'},{'Market Total':''},{'Total Pick':'Under 49.5'},{'Total Edge':'100'},{Season:'2025'}])assert.equal(policy.totalForwardGame({...slate,...fields},schedule,now),null);
});
test('late UTC kickoffs match the Eastern game date',()=>{
  const {policy}=setup();
  const a=policy.totalForwardGame(slate,{...schedule,'Game Time':'2026-10-31T02:30:00Z'},now);
  assert.equal(a.date,'2026-10-30');
});
test('blank scores and incomplete/cancelled games cannot become wins; pushes are neutral',()=>{
  const {policy}=setup(),g=policy.totalForwardGame(slate,schedule,now),p=g.predictions[0],after=Date.parse('2026-10-31T04:00:00Z');
  for(const fields of [{Completed:'False','Away Score':'30','Home Score':'27'},{Completed:'True','Away Score':'','Home Score':''},{Completed:'True','Away Score':'0','Home Score':'0'},{Completed:'True','Away Score':'27','Home Score':'23','Game ID':'401999002'}])assert.equal(policy.settleTotalForward(g,p,{...schedule,...fields},after),null);
  const push=policy.settleTotalForward(g,p,{...schedule,Completed:'True','Away Score':'27','Home Score':'23'},after);
  assert.equal(push.result,'P');assert.equal(push.units,0);
  assert.equal(policy.settleTotalForward(g,p,{...schedule,Completed:'True',Status:'Cancelled','Away Score':'27','Home Score':'23'},after),null);
});
test('read-only empty tracker creates no tables and adds no historical wins',async()=>{
  const {store,state,db}=setup();const r=await store.readNcaafTotalForward();
  assert.equal(r.initialized,false);assert.equal(state.writes,0);assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'ncaaf_total_forward_%'").all().length,0);
});
test('SQL captures once, freezes line/grade/control and repeated cycles perform no writes',async()=>{
  const {store,state,db}=setup();
  const first=await store.captureNcaafTotalForward([slate],[schedule],now);assert.equal(first.capturedGames,1);
  const before=db.prepare('SELECT payload_json FROM ncaaf_total_forward_games').get().payload_json;
  const writes=state.writes;
  await store.captureNcaafTotalForward([{...slate,'Market Total':'51','Total Pick':'Under 51','Projected Total':'44'}],[schedule],now+60000);
  assert.equal(state.writes,writes);assert.equal(db.prepare('SELECT payload_json FROM ncaaf_total_forward_games').get().payload_json,before);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ncaaf_total_forward_predictions').get().n,2);
  const r=await store.readNcaafTotalForward();assert.equal(r.strategies.find(r=>r.strategy==='a_total_fade').record,'0-0-0');
  assert.equal(r.strategies.find(r=>r.strategy==='a_total_fade').pending,1);assert.equal(r.strategies.find(r=>r.strategy==='a_total_fade').roiPct,null);
});
test('a first No Play observation cannot be backfilled into a later A decision',async()=>{
  const {store,db}=setup();
  await store.captureNcaafTotalForward([{...slate,'Total Grade':'No Play','Projected Total':'48','Total Edge':'2'}],[schedule],now);
  await store.captureNcaafTotalForward([slate],[schedule],now+60000);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ncaaf_total_forward_predictions').get().n,0);
});
test('database clock prevents a delayed request from capturing after kickoff',async()=>{
  const {store,state,db}=setup();state.clock=Date.parse(kickoff);
  const r=await store.captureNcaafTotalForward([slate],[schedule],now);
  assert.equal(r.capturedGames,0);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ncaaf_total_forward_games').get().n,0);
});
test('capture transaction rolls back both forecasts when an insert fails',async()=>{
  const {store,state,db}=setup();state.fail=true;
  await assert.rejects(store.captureNcaafTotalForward([slate],[schedule],now),/Simulated insert failure/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ncaaf_total_forward_games').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ncaaf_total_forward_predictions').get().n,0);
});
test('settlement updates results only, uses unit risk, and never combines fade/control records',async()=>{
  const {store,state,db}=setup();await store.captureNcaafTotalForward([slate],[schedule],now);
  const original=db.prepare('SELECT payload_json FROM ncaaf_total_forward_games').get().payload_json;
  const prediction=db.prepare("SELECT payload_json FROM ncaaf_total_forward_predictions WHERE strategy='a_total_fade'").get().payload_json;
  const after=Date.parse('2026-10-31T04:00:00Z');state.clock=after;
  const final={...schedule,Completed:'True','Away Score':'30','Home Score':'27'};
  const settled=await store.captureNcaafTotalForward([], [final],after);assert.equal(settled.settledPredictions,2);
  const r=await store.readNcaafTotalForward(),fade=r.strategies.find(r=>r.strategy==='a_total_fade'),control=r.strategies.find(r=>r.strategy==='a_total_original_control');
  assert.equal(fade.record,'1-0-0');assert.ok(Math.abs(fade.units-100/110)<.0001);assert.equal(control.record,'0-1-0');assert.equal(control.units,-1);
  assert.equal('overall' in r,false);assert.equal(db.prepare('SELECT payload_json FROM ncaaf_total_forward_games').get().payload_json,original);
  assert.equal(db.prepare("SELECT payload_json FROM ncaaf_total_forward_predictions WHERE strategy='a_total_fade'").get().payload_json,prediction);
  const writes=state.writes;await store.captureNcaafTotalForward([], [final],after+60000);assert.equal(state.writes,writes);
});
test('SQL payloads preserve apostrophes and do not modify official model tables',async()=>{
  const {store,db}=setup();db.exec("CREATE TABLE official_test (selection TEXT,grade TEXT,result TEXT); INSERT INTO official_test VALUES ('Under 50','A Total','Pending')");
  const s={...slate,'Away Team':"St John's"},g={...schedule,'Away Team':"St John's"};
  await store.captureNcaafTotalForward([s],[g],now);
  const r=await store.readNcaafTotalForward();assert.equal(r.recent[0].game,"St John's @ Auburn");
  assert.equal(db.prepare('SELECT selection FROM official_test').get().selection,'Under 50');
});
test('changed policy parameters cannot be captured under the existing policy identity',()=>{
  const {store,policy}=setup(),g=policy.totalForwardGame(slate,schedule,now);
  assert.throws(()=>store.totalForwardCaptureSql({...g,parameterHash:'changed'}),/Unexpected NCAAF forward policy/);
});
test('the existing settlement job captures NCAAF research with its loaded frames and leaves NFL separate',async()=>{
  const api={},calls=[],writes=[];
  const source=ts.transpileModule(fs.readFileSync(path.join(root,'lib/footballResultSettlement.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(source,{exports:api,Date,Intl,console,require:name=>name==='./sportSheets'?{
    readSportWorksheet:async(_sport,tab)=>tab==='daily_slate'?[{...slate,'Total Grade':'No Play'}]:tab==='schedule'?[schedule]:[],
    upsertSportRows:async(...args)=>writes.push(args),
  }:name==='./ncaafTotalForwardStore'?{captureNcaafTotalForward:async(...args)=>calls.push(args)}:require(name)});
  await api.settlePendingFootballResults('NCAAF',{force:true});
  await api.settlePendingFootballResults('NFL',{force:true});
  assert.equal(calls.length,1);assert.equal(calls[0][0][0]['Game ID'],slate['Game ID']);
  assert.equal(calls[0][1][0]['Game Time'],kickoff);assert.equal(writes.length,0);
});
