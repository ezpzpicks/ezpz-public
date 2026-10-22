const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, file);
const core = require('../lib/nbaMarketCore.ts');
const source = require('../lib/scoresAndOddsBettingSplits.ts');
const store = require('../lib/nbaMarketStore.ts');
const db = require('../lib/tursoStore.ts');
const { marketRefreshDecision } = require('../lib/marketRefreshPolicy.ts');
const NOW = Date.parse('2026-10-22T17:00:00Z');
const rows = require('./fixtures/nba-consensus-2026-10-22.json');
const clone = value => JSON.parse(JSON.stringify(value));
const event = (id, away, home, hour) => ({ id, season: { year: 2027, type: 2 },
  competitions: [{ date: `2026-10-22T${hour}:00:00Z`, timeValid: true,
    status: { type: { name: 'STATUS_SCHEDULED', state: 'pre', completed: false } },
    competitors: [['away',away],['home',home]].map(([homeAway,team]) => ({ homeAway,team })) }] });
const payload = { events: [
  event('101', {id:'5',displayName:'Cleveland Cavaliers',name:'Cavaliers',location:'Cleveland'}, {id:'20',displayName:'Philadelphia 76ers',name:'76ers',location:'Philadelphia'}, '23'),
  event('102', {id:'7',displayName:'Denver Nuggets',name:'Nuggets',location:'Denver'}, {id:'25',displayName:'Oklahoma City Thunder',name:'Thunder',location:'Oklahoma City'}, '22'),
] };
const games = core.normalizeNbaSlate(payload, '2026-10-22');
const bound = core.bindNbaSplits(rows, games, NOW);
assert.equal(bound.rows.length,8);
assert.deepEqual(bound.missing,[]);
assert(bound.rows.every(r=>r.Odds==='-110' && r.Source==='ScoresAndOdds'));
assert.equal(bound.rows.find(r=>r['Game ID']==='101'&&r.Selection==='Philadelphia 76ers').Line,'-2.5');
assert.throws(()=>core.normalizeNbaSlate({events:[payload.events[0],payload.events[0]]},'2026-10-22'),/Duplicate/);
assert.throws(()=>core.normalizeNbaSlate(payload,'2026-10-23'),/date/);
const incomplete=clone(rows); incomplete.splice(incomplete.findIndex(r=>r.side==='Under'),1);
assert.equal(core.bindNbaSplits(incomplete,games,NOW).missing.length,1);
const conflict=clone(rows); conflict.push({...rows.find(r=>r.market==='Spread'),line:999});
assert.equal(core.bindNbaSplits(conflict,games,NOW).missing.length,1);
const inconsistent=clone(rows); inconsistent.find(r=>r.market==='Spread').line=8;
assert.equal(core.bindNbaSplits(inconsistent,games,NOW).missing.length,1);
assert.equal(core.bindNbaSplits(rows.map(r=>({...r,date:'2026-10-23'})),games,NOW).rows.length,0);
const first=core.advanceNbaMarkets(bound.rows,[],NOW);
assert.equal(first.latest.length,8); assert.equal(first.history.length,8); assert.equal(first.finals.length,0);
const second=core.advanceNbaMarkets(bound.rows,first.latest,NOW+30*60_000);
assert.equal(second.latest.length,8); assert.equal(second.history.length,0);
const near=Date.parse('2026-10-22T22:43:00Z');
const oneGame=bound.rows.filter(r=>r['Game ID']==='101');
const frozen=core.advanceNbaMarkets(oneGame,first.latest,near);
assert.equal(frozen.finals.length,4);
assert(frozen.latest.every(r=>r['Snapshot Status']==='FINAL_PREGAME'));
assert.equal(core.advanceNbaMarkets(oneGame.map(r=>({...r,Line:'999'})),frozen.latest,near+5*60_000).latest.length,0);
assert.equal(core.advanceNbaMarkets(oneGame,[],Date.parse('2026-10-22T22:55:00Z')).latest.length,0);
assert.equal(core.nbaDate(Date.parse('2026-11-22T02:00:00Z')),'2026-11-21');
assert.equal(marketRefreshDecision([{kickoff:NOW+120*60_000,date:'2026-10-22',final:false}], '2026-10-22', NOW, NOW-5*60_000).due,false);
assert.equal(marketRefreshDecision([{kickoff:NOW+60*60_000,date:'2026-10-22',final:false}], '2026-10-22', NOW, NOW-5*60_000).due,true);

// Execute the actual Hrana-bound SQL against SQLite, including rollback,
// identity metadata, incremental updates and isolation from another sport.
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nba-market-test-'));
const dbPath=path.join(dir,'db.sqlite');
const bridge=String.raw`
import json,sqlite3,sys
p=json.load(sys.stdin); c=sqlite3.connect(sys.argv[1]); out=[]
try:
 for r in p['requests']:
  if r['type']=='close': out.append({'type':'ok','response':{'type':'close'}}); continue
  if r['type']=='sequence':
   c.executescript(r['sql']); out.append({'type':'ok','response':{'type':'sequence','result':{}}}); continue
  cur=c.execute(r['stmt']['sql']); cols=[{'name':x[0]} for x in cur.description or []]
  rows=[[{'type':'null'} if x is None else {'type':'text','value':str(x)} for x in row] for row in cur.fetchall()]
  out.append({'type':'ok','response':{'type':'execute','result':{'cols':cols,'rows':rows,'affected_row_count':max(0,cur.rowcount)}}})
 c.commit()
except Exception as e:
 c.rollback(); out.append({'type':'error','error':str(e)})
finally: c.close()
print(json.dumps({'results':out}))
`;
const send=sql=>JSON.parse(execFileSync('python',['-c',bridge,dbPath],{input:JSON.stringify({requests:[{type:'sequence',sql}]}),encoding:'utf8'}));
send(`CREATE TABLE dataset_rows(sport TEXT,dataset TEXT,row_index INTEGER,payload_json TEXT,source_hash TEXT,date_key TEXT,game_key TEXT,game TEXT,market TEXT,selection TEXT,result TEXT,snapshot_time TEXT,imported_at TEXT,PRIMARY KEY(sport,dataset,row_index));
CREATE INDEX idx_dataset_rows_date ON dataset_rows(sport,dataset,date_key);
CREATE TABLE dataset_manifest(sport TEXT,dataset TEXT,source_workbook TEXT,source_worksheet TEXT,headers_json TEXT,row_count INTEGER,imported_at TEXT,source_kind TEXT,PRIMARY KEY(sport,dataset));
INSERT INTO dataset_rows VALUES('NFL','weekly_market_trends',1,'{"Date":"2026-10-22","kept":"yes"}','','2026-10-22','','','','','','','');`);
process.env.TURSO_DATABASE_URL='https://nba-sqlite-test.invalid';
process.env.TURSO_AUTH_TOKEN='synthetic-test-token';
let writeRequests=0;
global.fetch=async (_url,options)=>{
  const input=JSON.parse(options.body);
  if(input.requests.some(r=>r.type==='sequence')) writeRequests++;
  const output=execFileSync('python',['-c',bridge,dbPath],{input:options.body,encoding:'utf8'});
  return {ok:true,status:200,text:async()=>output};
};
(async()=>{
  await store.saveNbaMarketRows('weekly_market_trends',first.latest);
  assert.equal((await db.readTursoDatasetByDateKeys('NBA','weekly_market_trends',['2026-10-22'])).length,8);
  const writes=writeRequests;
  await store.saveNbaMarketRows('weekly_market_trends',first.latest);
  assert.equal(writeRequests,writes,'unchanged rows must not write even the manifest');
  await store.saveNbaMarketRows('odds_snapshot',first.history,true);
  await store.saveNbaMarketRows('odds_snapshot',first.history,true);
  assert.equal((await db.readTursoDatasetByDateKeys('NBA','odds_snapshot',['2026-10-22'])).length,8);
  await store.saveNbaMarketRows('weekly_market_trends',frozen.latest);
  const after=await db.readTursoDatasetByDateKeys('NBA','weekly_market_trends',['2026-10-22']);
  assert.equal(after.length,8);
  assert.equal(after.filter(r=>r['Snapshot Status']==='FINAL_PREGAME').length,4);
  assert.equal((await db.readTursoDatasetByDateKeys('NFL','weekly_market_trends',['2026-10-22']))[0].kept,'yes');
  await assert.rejects(()=>db.runTursoAtomicSql(["DELETE FROM dataset_rows WHERE sport='NBA'",'INVALID SQL']),/statement failed/);
  assert.equal((await db.readTursoDatasetByDateKeys('NBA','weekly_market_trends',['2026-10-22'])).length,8,'failed stream must roll back');
  const {readNbaPublicData}=require('../lib/nbaMarket.ts');
  const publicData=await readNbaPublicData('2026-10-22');
  assert.equal(publicData.nbaMarket.splits.length,8);
  assert.equal(publicData.nbaMarket.forecasts.length,0);
  assert.equal(publicData.bestPlays.length,0);
  console.log('NBA market source, refresh, final locks, SQLite isolation/idempotence and public-read checks passed');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>fs.rmSync(dir,{recursive:true,force:true}));
