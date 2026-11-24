const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),ts=require('typescript'),{DatabaseSync}=require('node:sqlite');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const fixture=require('./fixtures/ncaaf-preview-clock-2026-11-24.json');
const adapter=require('../lib/footballMarketProjection.ts'),db=require('../lib/tursoStore.ts');
const now=Date.parse(fixture.asOf),copy=v=>JSON.parse(JSON.stringify(v));
function storage(t){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(`CREATE TABLE dataset_rows(sport TEXT,dataset TEXT,row_index INTEGER,payload_json TEXT,source_hash TEXT,date_key TEXT,game_key TEXT,game TEXT,market TEXT,selection TEXT,result TEXT,snapshot_time TEXT,imported_at TEXT,PRIMARY KEY(sport,dataset,row_index));CREATE TABLE dataset_manifest(sport TEXT,dataset TEXT,source_workbook TEXT,source_worksheet TEXT,headers_json TEXT,row_count INTEGER,imported_at TEXT,source_kind TEXT,PRIMARY KEY(sport,dataset));`);
 const old={read:db.readTursoDatasetByDateKeys,sql:db.runTursoSql,atomic:db.runTursoAtomicSql,invalidate:db.invalidateTursoDatasetReadCache,fetch:global.fetch},queries=[],requests=[];
 const query=sql=>{queries.push(sql);return sqlite.prepare(sql).all().map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,String(v??'')])));};
 db.runTursoSql=async sql=>sql.map(query);db.runTursoAtomicSql=async sql=>{sqlite.exec('BEGIN IMMEDIATE');try{const out=sql.map(query);sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}};
 db.readTursoDatasetByDateKeys=async(s,d,dates)=>sqlite.prepare(`SELECT payload_json FROM dataset_rows WHERE sport=? AND dataset=? AND date_key IN (${dates.map(()=>'?').join(',')})`).all(s,d,...dates).map(r=>JSON.parse(r.payload_json));db.invalidateTursoDatasetReadCache=()=>{};
 const source={payload:copy(fixture.espn),available:true};
 global.fetch=async url=>{requests.push(String(url));return {ok:source.available,json:async()=>source.payload};};
 t.after(()=>{db.readTursoDatasetByDateKeys=old.read;db.runTursoSql=old.sql;db.runTursoAtomicSql=old.atomic;db.invalidateTursoDatasetReadCache=old.invalidate;global.fetch=old.fetch;sqlite.close();});
 const put=(dataset,rows,date='2026-11-24')=>{sqlite.prepare('DELETE FROM dataset_rows WHERE dataset=?').run(dataset);rows.forEach((r,i)=>sqlite.prepare('INSERT INTO dataset_rows(sport,dataset,row_index,payload_json,date_key,game_key) VALUES(?,?,?,?,?,?)').run('NCAAF',dataset,i+1,JSON.stringify(r),date,r['Game ID']||r['Game Key']));};
 put('schedule',fixture.schedule,'');put('game_previews',fixture.previews);put('weekly_market_trends',fixture.weekly);
 return {sqlite,queries,requests,source,put};
}
test('exact November 24 cases: Miami receives live adjustments, Kent waits for missing spread pair',async t=>{
 const {sqlite,requests,queries,put}=storage(t);
 const result=await adapter.refreshFootballMarketProjections('NCAAF',now);
 assert.equal(result.baselineGames,2);assert.equal(result.captured,1);assert.equal(result.waitingForFreshMarket,1);assert.deepEqual(result.errors,[]);
 const rows=sqlite.prepare("SELECT payload_json FROM dataset_rows WHERE dataset='market_projection_updates'").all();
 assert.equal(rows.length,1);const f=JSON.parse(JSON.parse(rows[0].payload_json)['Details JSON']);
 assert.equal(f.gameId,'401866471');assert.equal(f.tipoff,'2026-11-25T00:00:00.000Z');assert.equal(f.market_tracking.baseline.sourceDataset,'game_previews');
 assert.equal(f.market_tracking.final_pregame,false);assert.equal(f.official_pick_eligible,false);
 assert.equal((await adapter.refreshFootballMarketProjections('NCAAF',now)).captured,0);
 assert(requests.every(u=>u.includes('dates=20261124')&&u.includes('groups=80')));
 assert(queries.filter(q=>q.includes("dataset='schedule'")).every(q=>q.includes('game_key IN')&&q.includes('LIMIT 400')));
 const final=Date.parse('2026-11-24T23:45:00Z');
 put('weekly_market_trends',fixture.weekly.map(r=>({...r,'Updated At':new Date(final).toISOString(),'Snapshot Status':'FINAL_PREGAME','Frozen At':new Date(final).toISOString()})));
 const lock=await adapter.refreshFootballMarketProjections('NCAAF',final);
 assert.equal(lock.waitingForBaseline,1);assert.equal(lock.captured,0);
 assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM dataset_rows WHERE market='Final Forecast'").get().n,0);
});
for(const change of ['removed','postponed','canceled','rescheduled','wrong_team','unknown_time','provider_failure','verified_conflict','completed']){
 test(`placeholder repair fails closed: ${change}`,async t=>{
  const {source,put}=storage(t),event=source.payload.events.find(e=>e.id==='401866471');
  if(change==='removed')source.payload.events=source.payload.events.filter(e=>e!==event);
  if(change==='postponed'||change==='canceled')event.competitions[0].status.type.name='STATUS_'+change.toUpperCase();
  if(change==='rescheduled')event.competitions[0].date='2026-11-25T00:30Z';
  if(change==='wrong_team')event.competitions[0].competitors[0].team.shortDisplayName='Other';
  if(change==='unknown_time')event.competitions[0].timeValid=false;
  if(change==='provider_failure')source.available=false;
  if(change==='verified_conflict'||change==='completed')put('schedule',fixture.schedule.map(r=>r['Game ID']==='401866471'?{...r,...(change==='completed'?{Completed:'TRUE'}:{'Game Time':'2026-11-24T19:30:00-05:00'})}:r),'');
  const result=await adapter.refreshFootballMarketProjections('NCAAF',now);
  assert.equal(result.baselineGames,1);assert.equal(result.captured,0);assert.equal(result.waitingForFreshMarket,1);
 });
}
for(const placeholder of ['', '2026-11-24'])test(`recognized missing/date-only clock can be repaired: ${JSON.stringify(placeholder)}`,async t=>{
 const {put}=storage(t);
 put('schedule',fixture.schedule.map(r=>r['Game ID']==='401866471'?{...r,'Game Time':placeholder}:r),'');
 const result=await adapter.refreshFootballMarketProjections('NCAAF',now);
 assert.equal(result.baselineGames,2);assert.equal(result.captured,1);assert.equal(result.waitingForFreshMarket,1);
});
test('source clock on a different Eastern date cannot repair a same-ID schedule',async t=>{
 const {source}=storage(t);source.payload.events.find(e=>e.id==='401866471').competitions[0].date='2026-11-26T00:00Z';
 const result=await adapter.refreshFootballMarketProjections('NCAAF',now);
 assert.equal(result.baselineGames,1);assert.equal(result.captured,0);
});
