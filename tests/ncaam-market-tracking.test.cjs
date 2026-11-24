const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),child=require('node:child_process');
const ts=require('typescript');
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},
}).outputText,filename);
const flow=require('../lib/ncaamMarketFlow.ts');
const policy=require('../lib/ncaamMarketTrackingPolicy.ts');
const core=require('../lib/ncaamMarketTracking.ts');
const fixture=require('./fixtures/ncaam-market-tracking-flow.json');
const source=require('./fixtures/ncaam-v16-calibrated-spreads.json').cases[0].forecast;
const records=require('../lib/ncaamRecords.ts');
const trends=require('../lib/ncaamTrendLeaderboard.ts');
const store=require('../lib/ncaamMarketTrackingStore.ts');
const db=require('../lib/tursoStore.ts');
const iso=t=>new Date(t).toISOString();
const lock=Date.parse(source.lockedAt),clock=lock+3600_000;
const activation={policy:policy.NCAAM_MARKET_TRACKING.flow_policy,modelVersion:policy.NCAAM_MARKET_TRACKING_MODEL,activatedAt:iso(lock+60_000),gradingStatus:'ungraded'};
const game={Date:'2026-11-14','Game ID':source.gameId,'Game Key':`2026-11-14|ncaam|${source.gameId}`,'Game Time':source.tipoff,'Away Team':source.away_team,'Home Team':source.home_team,Status:'STATUS_SCHEDULED',Source:'ESPN NCAAM schedule; ScoresAndOdds market lines'};
const point=(t,line,bets=50,money=50)=>({snapshotTime:iso(t),line,betsPct:bets,moneyPct:money});
function splitRows({now=clock,spread,total,final=false}={}) {
 spread=spread||[point(lock+120_000,-3),point(clock,-5,60,70)];total=total||[point(lock+120_000,150),point(clock,152,60,70)];
 const rows=[];
 for(const [market,h] of [['Spread',spread],['Total',total]])for(const primary of [true,false]) {
  const history=h.map(p=>primary?p:{...p,line:market==='Spread'?-p.line:p.line,betsPct:p.betsPct==null?null:100-p.betsPct,moneyPct:p.moneyPct==null?null:100-p.moneyPct});
  const p=history.at(-1),selection=market==='Spread'?(primary?source.home_team:source.away_team):(primary?'Over':'Under');
  rows.push({...game,Market:market,Selection:selection,Side:market==='Total'?selection:'',Line:String(p.line),'Current Bets %':p.betsPct==null?'':String(p.betsPct),'Current Handle %':p.moneyPct==null?'':String(p.moneyPct),'Updated At':iso(now),'Frozen At':final?iso(now):'','Snapshot Status':final?'FINAL_PREGAME':'LIVE',Source:'ScoresAndOdds','Market Policy':'ncaam-scoresandodds-2026-11-01-v1','Details JSON':JSON.stringify({policy:'ncaam-scoresandodds-2026-11-01-v1',movementHistory:history})});
 }
 return rows;
}
function candidate({base=source,rows=splitRows(),now=clock,active=activation,capPolicy}={}) {
 const inputs=core.ncaamTrackingInputs(game,rows,now);const digest=store.ncaamTrackingDigest(core.ncaamTrackingFingerprint(base,inputs,capPolicy));
 return core.buildNcaamTrackedForecast(base,inputs,active,now,digest,capPolicy);
}
const close=(actual,expected,label)=>assert(Math.abs(actual-expected)<1e-8,`${label}: ${actual} != ${expected}`);

test('90 frozen Python examples match JavaScript features, multipliers and adjusted projections',()=>{
 assert.deepEqual(policy.NCAAM_MARKET_TRACKING,fixture.parameters);
 for(const c of fixture.cases){
  const f=flow.ncaamFlowFeatures(c.history,c.asOf,c.tipoff,c.market),a=flow.ncaamMarketAdjustment(c.baseline,f);
  assert.equal(f.status,c.expected.status,c.name);
  f.features.forEach((v,i)=>close(v,c.expected.features[i],`${c.name} feature ${i}`));
  f.intervals.forEach((v,i)=>close(v.split_strength_multiplier,c.expected.multipliers[i],`${c.name} multiplier ${i}`));
  close(a.adjustment,c.expected.adjustment,c.name);close(a.projection,c.expected.projection,c.name);
 }
});
test('paired observations change both scores once and explicitly defer all A/B grades',()=>{
 const original=JSON.stringify(source),f=candidate();
 assert.equal(JSON.stringify(source),original);
 assert.equal(f.modelVersion,policy.NCAAM_MARKET_TRACKING_MODEL);
 assert.equal(f.spread_grade,'Ungraded');assert.equal(f.total_grade,'Ungraded');assert.equal(f.official_pick_eligible,false);
 assert.equal(f.matchup_total,undefined);assert.equal(f.matchup_spread,undefined);
 close(f.home_score+f.away_score,f.total,'score total');close(f.home_score-f.away_score,-f.fair_home_spread,'score margin');
 assert.equal(f.market_tracking.baseline_forecast_record_id,source.recordId);
 assert(core.validNcaamTrackingForecast(f,source,activation,clock));
});
test('updated snapshots always use the original baseline and freeze the input history',()=>{
 const a=candidate();const rows=splitRows({now:clock+600_000,total:[point(lock+120_000,150),point(clock,152,60,70),point(clock+600_000,153,60,75)]});
 const b=candidate({rows,now:clock+600_000});
 assert.notEqual(a.recordId,b.recordId);assert.equal(b.market_tracking.baseline_total,source.total);
 assert.throws(()=>candidate({base:a}));
 const original=JSON.stringify(a.market_tracking.histories);rows[0].Line='99';assert.equal(JSON.stringify(a.market_tracking.histories),original);
});
test('timestamp-only refreshes are idempotent while a true reversal creates a distinct saved identity',()=>{
 const h=[point(lock+120_000,150),point(clock,152,60,70)];
 const one=core.ncaamTrackingInputs(game,splitRows({total:h}),clock);
 const two=core.ncaamTrackingInputs(game,splitRows({now:clock+300_000,total:h}),clock+300_000);
 assert.equal(store.ncaamTrackingDigest(core.ncaamTrackingFingerprint(source,one)),store.ncaamTrackingDigest(core.ncaamTrackingFingerprint(source,two)));
 const reversal=core.ncaamTrackingInputs(game,splitRows({now:clock+600_000,total:[...h,point(clock+300_000,150),point(clock+600_000,152,60,70)]}),clock+600_000);
 assert.notEqual(store.ncaamTrackingDigest(core.ncaamTrackingFingerprint(source,one)),store.ncaamTrackingDigest(core.ncaamTrackingFingerprint(source,reversal)));
});
test('missing split percentages remain unknown and pure line movement still counts',()=>{
 const h=[point(lock+120_000,150,null,null),point(clock,152,null,null)];
 const f=candidate({rows:splitRows({total:h})});
 assert.equal(f.market_tracking.total_adjustment,2);
 assert.equal(f.market_tracking.histories.Total.at(-1).moneyPct,null);
});
test('missing public splits can use saved same-provider line movements without mixing sources or inventing money',()=>{
 const old={...source,recordId:'earlier-quote',lockedAt:iso(lock-1000),market:{...source.market,as_of:iso(lock-2000),total:source.market.total-2,home_spread:source.market.home_spread+1}};
 const other={...old,recordId:'other-source',market:{...old.market,source:'Other',total:50}};
 const inputs=core.ncaamBaselineTrackingInputs(source,[old,other,source],clock);
 assert.equal(inputs.histories.Total.length,2);assert(inputs.histories.Total.every(p=>p.moneyPct===null && p.betsPct===null));
 const f=core.buildNcaamTrackedForecast(source,inputs,activation,clock,store.ncaamTrackingDigest(core.ncaamTrackingFingerprint(source,inputs)));
 assert.equal(f.market_tracking.total_adjustment,2);assert.equal(f.market_tracking.spread_adjustment,1);
 const single=core.ncaamBaselineTrackingInputs(source,[other,source],clock);assert.equal(single.histories.Total.length,1);
});
test('mismatched, future and post-tipoff observations cannot create a forward snapshot',()=>{
 for(const change of [rows=>rows.pop(),rows=>rows[0]['Home Team']='Other',rows=>rows[0]['Updated At']=iso(clock+1),rows=>rows[0].Line='99']){
  const rows=splitRows();change(rows);assert.throws(()=>candidate({rows}));
 }
 assert.equal(core.ncaamTrackingInputs(game,splitRows(),Date.parse(source.tipoff)),null);
 assert.throws(()=>candidate({now:Date.parse(source.tipoff)}));
});
test('a saved score or grading alteration fails the new forecast proof',()=>{
 const f=candidate();for(const change of [f=>f.total++,f=>f.market_tracking.baseline_margin++,f=>f.spread_grade='A',f=>f.market_tracking.parameters={...f.market_tracking.parameters,spread_cap:99}]){
  const altered=structuredClone(f);change(altered);assert.equal(core.validNcaamTrackingForecast(altered,source,activation,clock),false);
 }
});
test('previous A/B records keep their captured side and price while new snapshots remain outside the ledger',()=>{
 const before=records.ncaamModelPlays([source],[game],clock),f=candidate();assert(before.length>0);
 const afterBase=structuredClone(source);afterBase.recordId+='-after';afterBase.lockedAt=iso(clock+1);afterBase.legacy_grade_eligible=false;
 const oldView={...source,grading_status:'awaiting_market_tracking_grades',market_tracking_effective_at:activation.activatedAt,legacy_grade_eligible:true};
 assert.deepEqual(records.ncaamModelPlays([oldView,f,afterBase],[game],clock+1000),before);
 assert.equal(records.ncaamModelPlays([f],[game],clock).length,0);
});
test('readers choose captured updates and suppress post-activation baseline grades without mutating archives',()=>{
 const original=JSON.stringify(source),f=candidate();
 const post={...source,recordId:source.recordId+'-new',lockedAt:iso(clock+1)};
 const view=core.mergeNcaamTrackingForecasts([source,post],[f],activation,clock+1000);
 assert.equal(JSON.stringify(source),original);assert(view.some(x=>x.recordId===source.recordId));assert(view.some(x=>x.recordId===f.recordId));assert(!view.some(x=>x.recordId===post.recordId));
 const noUpdate=core.mergeNcaamTrackingForecasts([post],[],activation,clock+1000)[0];assert.equal(noUpdate.legacy_grade_eligible,false);assert(policy.ncaamTrackingGradesPending(noUpdate));
 const notActivated=core.mergeNcaamTrackingForecasts([source],[],null,clock);assert.strictEqual(notActivated[0],source);
});
test('pending grading cannot cast a model vote even when the numerical edge is large',()=>{
 const f=candidate(),play={market:'Total',side:'Over',line:100,gameTime:source.tipoff,awayTeam:source.away_team,homeTeam:source.home_team,odds:'-110'};
 const vote=trends.ncaamModelFor(play,[f],clock);assert.equal(vote.active,false);assert.equal(vote.context.grade,'Ungraded');assert(vote.edge>0);
});

test('collector activation and every material update are insert-only; duplicate ticks and final/in-game revisions do not rewrite captures',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ncaam-tracking-')),file=path.join(dir,'store.sqlite');
 const python=process.env.CODEX_PRIMARY_RUNTIME_PYTHON||'python3';
 const invoke=(mode,input)=>JSON.parse(child.execFileSync(python,['-c',`
import sys,json,sqlite3
conn=sqlite3.connect(sys.argv[1]);conn.row_factory=sqlite3.Row
mode=sys.argv[2];payload=json.load(sys.stdin)
conn.execute('CREATE TABLE IF NOT EXISTS dataset_rows (sport TEXT,dataset TEXT,row_index INTEGER,payload_json TEXT,source_hash TEXT,date_key TEXT,game_key TEXT,game TEXT,market TEXT,selection TEXT,result TEXT,snapshot_time TEXT,imported_at TEXT,PRIMARY KEY(sport,dataset,row_index))')
conn.execute('CREATE TABLE IF NOT EXISTS dataset_manifest (sport TEXT,dataset TEXT,source_workbook TEXT,source_worksheet TEXT,headers_json TEXT,row_count INTEGER,imported_at TEXT,source_kind TEXT,PRIMARY KEY(sport,dataset))')
if mode=='write':
 conn.execute('BEGIN IMMEDIATE')
 for sql in payload:conn.execute(sql)
 conn.commit();print('null')
elif mode=='query':
 print(json.dumps([[dict(row) for row in conn.execute(sql)] for sql in payload]))
else:
 rows=conn.execute('SELECT payload_json FROM dataset_rows WHERE sport=? AND dataset=? AND date_key IN ('+','.join('?' for _ in payload[2])+')',[payload[0],payload[1],*payload[2]])
 print(json.dumps([json.loads(r[0]) for r in rows]))
`,file,mode],{input:JSON.stringify(input),encoding:'utf8'}));
 const old={read:db.readTursoDatasetByDateKeys,sql:db.runTursoSql,write:db.runTursoAtomicSql,invalidate:db.invalidateTursoDatasetReadCache};let invalidated=0;
 db.readTursoDatasetByDateKeys=async(...args)=>invoke('read',args);db.runTursoSql=async statements=>invoke('query',statements);db.runTursoAtomicSql=async statements=>invoke('write',statements);db.invalidateTursoDatasetReadCache=()=>invalidated++;
 const row=f=>({Date:game.Date,'Game Key':game['Game Key'],Market:'Forecast',Selection:f.recordId,'Updated At':f.lockedAt,'Details JSON':JSON.stringify(f)});
 const replaceSplits=async rows=>{
  await db.runTursoAtomicSql([`DELETE FROM dataset_rows WHERE dataset='weekly_market_trends'`]);
  await store.appendNcaamTrackingRows('weekly_market_trends',rows);
 };
 try{
  await store.appendNcaamTrackingRows('ncaam_model_forecasts',[row(source)]);
  await replaceSplits(splitRows());
  const first=await store.refreshNcaamMarketTracking(game.Date,[game],clock);assert.equal(first.captured,1);assert.deepEqual(first.errors,[]);
  const activated=await store.readNcaamTrackingActivation();assert.equal(activated.activatedAt,iso(clock));
  const original=await db.readTursoDatasetByDateKeys('NCAAM',policy.NCAAM_TRACKING_FORECAST_TAB,[game.Date]);assert.equal(original.length,1);
  await replaceSplits(splitRows({now:clock+300_000}));
  const duplicate=await store.refreshNcaamMarketTracking(game.Date,[game],clock+300_000);assert.equal(duplicate.captured,0);
  const t=clock+600_000;
  await replaceSplits(splitRows({now:t,total:[point(lock+120_000,150),point(clock,152,60,70),point(t,153,60,75)]}));
  const changed=await store.refreshNcaamMarketTracking(game.Date,[game],t);assert.equal(changed.captured,1);
  await replaceSplits([]);
  const stale=await store.refreshNcaamMarketTracking(game.Date,[game],clock+2*3600_000);
  assert.equal(stale.captured,0);assert.equal(stale.waitingForFreshMarket,1);assert.deepEqual(stale.errors,[],'old backup quotes wait without failing the source refresh');
  const finalTime=Date.parse(source.tipoff)-15*60_000;
  await replaceSplits(splitRows({now:finalTime,final:true}));
  const final=await store.refreshNcaamMarketTracking(game.Date,[game],finalTime);assert.equal(final.captured,1);
  await replaceSplits(splitRows({now:finalTime+300_000,final:true}));
  assert.equal((await store.refreshNcaamMarketTracking(game.Date,[game],finalTime+300_000)).captured,0);
  assert.equal((await store.refreshNcaamMarketTracking(game.Date,[game],Date.parse(source.tipoff)+1)).captured,0);
  const captures=await db.readTursoDatasetByDateKeys('NCAAM',policy.NCAAM_TRACKING_FORECAST_TAB,[game.Date]);assert.equal(captures.length,3);
  assert.equal((await store.readNcaamTrackingLatestRows(game.Date)).length,1,'ordinary reads keep one latest update while the full audit history remains saved');
  assert.equal(captures[0]['Details JSON'],original[0]['Details JSON']);
  const reused={...original[0],'Details JSON':'changed'};await store.appendNcaamTrackingRows(policy.NCAAM_TRACKING_FORECAST_TAB,[reused]);
  assert.equal((await db.readTursoDatasetByDateKeys('NCAAM',policy.NCAAM_TRACKING_FORECAST_TAB,[game.Date]))[0]['Details JSON'],original[0]['Details JSON']);
  assert.equal((await store.readNcaamTrackingActivation()).activatedAt,iso(clock));assert(invalidated>0);
 }finally{db.readTursoDatasetByDateKeys=old.read;db.runTursoSql=old.sql;db.runTursoAtomicSql=old.write;db.invalidateTursoDatasetReadCache=old.invalidate;fs.rmSync(dir,{recursive:true,force:true});}
});

test('NCAAM saves a same-input capped comparator only for uncapped rows and replays historical and rollback rows',()=>{
 const rows=splitRows({spread:[point(lock+120_000,-3,null,null),point(clock,-11,null,null)],total:[point(lock+120_000,150,null,null),point(clock,159,null,null)]});
 const a=candidate({rows}), b=candidate({rows,capPolicy:'uncapped-v1'}),r=candidate({rows,capPolicy:'rollback-capped-v1'});
 assert.deepEqual([a.market_tracking.spread_adjustment,a.market_tracking.total_adjustment],[4,6]);
 assert.deepEqual([b.market_tracking.spread_adjustment,b.market_tracking.total_adjustment],[8,9]);
 assert.deepEqual([r.market_tracking.spread_adjustment,r.market_tracking.total_adjustment],[4,6]);
 assert.deepEqual(b.market_tracking.capped_comparator,{spread_adjustment:4,total_adjustment:6,projected_home_margin:-a.fair_home_spread,projected_total:a.total});
 assert.equal(new Set([a.recordId,b.recordId,r.recordId]).size,3);
 for(const f of [a,b,r])assert(core.validNcaamTrackingForecast(f,source,activation,clock));
 const corrupt=structuredClone(b);corrupt.market_tracking.capped_comparator.projected_total++;
 assert.equal(core.validNcaamTrackingForecast(corrupt,source,activation,clock),false);
 assert.equal(b.spread_grade,'Ungraded');assert.equal(b.official_pick_eligible,false);
});
