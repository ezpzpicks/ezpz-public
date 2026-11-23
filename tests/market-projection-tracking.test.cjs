const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),ts=require('typescript'),{DatabaseSync}=require('node:sqlite');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const core=require('../lib/marketProjectionTracking.ts'),policy=require('../lib/marketProjectionPolicy.ts');
const store=require('../lib/marketProjectionStore.ts'),db=require('../lib/tursoStore.ts');
const nbaRecords=require('../lib/nbaRecords.ts'),nbaModel=require('../lib/nbaTrendLeaderboard.ts');
const {buildFootballSignalsState}=require('../lib/footballSignals.ts');
const {buildTeamTrendHistory}=require('../lib/footballTeamTrends.ts');
const date='2035-11-23',clock=Date.parse(date+'T18:00:00Z'),tip=clock+3600000,lock=clock-3600000;
test('frozen cross-sport weights and all 90 approved movement examples retain the same numerical behavior',()=>{
 const config=require('../lib/config/market-projection-tracking.json'),fixture=require('./fixtures/ncaam-market-tracking-flow.json');
 const flow=require('../lib/ncaamMarketFlow.ts'),p=policy.MARKET_PROJECTION_PARAMETERS;
 assert.deepEqual(p,config.parameters);assert.deepEqual(config.sports,['NBA','NFL','NCAAF']);assert.equal(config.grading_status,'ungraded');
 for(const name of Object.keys(p).filter(k=>k!=='flow_policy'))assert.deepEqual(p[name],fixture.parameters[name]);
 for(const c of fixture.cases){const f=flow.ncaamFlowFeatures(c.history,c.asOf,c.tipoff,c.market,p),a=flow.ncaamMarketAdjustment(c.baseline,f,p);
  f.features.forEach((v,i)=>assert(Math.abs(v-c.expected.features[i])<1e-10));assert(Math.abs(a.adjustment-c.expected.adjustment)<1e-8);}
});
const iso=n=>new Date(n).toISOString(),close=(a,b)=>assert(Math.abs(a-b)<1e-8,`${a} != ${b}`);
function activation(sport){return {sport,policy:policy.MARKET_PROJECTION_POLICY,modelVersion:policy.trackingModelVersion(sport),activatedAt:iso(lock+60000),gradingStatus:'ungraded'};}
function native(sport){return sport==='NBA'?{recordId:'native',gameId:'one',modelVersion:'nba-v0.5',lockedAt:iso(lock),tipoff:iso(tip),away_team:'Away',home_team:'Home',away_score:100,home_score:110,total:210,fair_home_spread:-10,
 spread_grade:'A',total_grade:'B',spread_pick:'Home -10',total_pick:'Over 210',market:{home_spread:-10,total:210,source:'ScoresAndOdds',as_of:iso(lock)}}
 :{Date:date,'Game ID':'one','Game Time':iso(tip),'Away Team':'Away','Home Team':'Home',Game:'Away @ Home','Build At':iso(lock),'Build Captured At':iso(lock),'Model Version':sport.toLowerCase()+'-native','Projected Home':'30','Projected Away':'20','Projected Total':'50','Projected Margin':'10','Spread Grade':'A Spread','Total Grade':'Over'};}
const baseline=s=>core.normalizeProjectionBaseline(s,native(s),date,iso(tip));
const point=(t,line,bets=50,money=50)=>({snapshotTime:iso(t),line,betsPct:bets,moneyPct:money});
function rows(sport,{spread,total,at=clock,final=false}={}){
 spread=spread||[point(lock,-10),point(at,-12,60,70)];total=total||[point(lock,sport==='NBA'?210:50),point(at,sport==='NBA'?212:52,60,70)];
 return [['Spread',spread],['Total',total]].flatMap(([market,h])=>[true,false].map(primary=>{
  const history=h.map(p=>primary?p:{...p,line:market==='Spread'?-p.line:p.line,betsPct:p.betsPct==null?null:100-p.betsPct,moneyPct:p.moneyPct==null?null:100-p.moneyPct});
  const p=history.at(-1),selection=market==='Spread'?primary?'Home':'Away':primary?'Over':'Under';
  return {Date:date,'Game ID':'one','Game Time':iso(tip),'Away Team':'Away','Home Team':'Home',Source:'ScoresAndOdds',Market:market,Selection:selection,Side:market==='Total'?selection:'',Line:String(p.line),'Current Bets %':p.betsPct==null?'':String(p.betsPct),'Current Handle %':p.moneyPct==null?'':String(p.moneyPct),'Updated At':iso(at),'Frozen At':final?iso(at):'','Snapshot Status':final?'FINAL_PREGAME':'LIVE','Details JSON':JSON.stringify({movementHistory:history})};
 }));
}
function candidate(sport,options={}){
 const b=options.base||baseline(sport),now=options.now||clock,inputs=core.projectionTrackingInputs(b,options.rows||rows(sport),now),a=options.activation||activation(sport);
 return core.buildMarketTrackedProjection(b,inputs,a,now,store.projectionDigest(core.projectionFingerprint(b,inputs)));
}
for(const sport of ['NBA','NFL','NCAAF']){
 test(`${sport}: approved directional math adjusts scores once and carries no grades`,()=>{
  const b=baseline(sport),original=JSON.stringify(b),f=candidate(sport);
  assert(b);assert.equal(JSON.stringify(b),original);assert.equal(f.spread_grade,'Ungraded');assert.equal(f.total_grade,'Ungraded');assert.equal(f.official_pick_eligible,false);
  close(f.home_score+f.away_score,f.total);close(f.home_score-f.away_score,-f.fair_home_spread);
  assert(core.validMarketTrackedProjection(f,activation(sport),clock));
  assert.equal(store.verifiedMarketProjections([f],activation(sport),clock).length,1);
  assert.equal(core.normalizeProjectionBaseline(sport,f,date,iso(tip)),null);
  const a=policy.projectionAdjustments(f);assert.equal(a.awaySpread,-a.homeSpread);close(a.homeScore+a.awayScore,a.total);
 });
 test(`${sport}: missing splits are neutral, line movement counts, and a flat line damps money`,()=>{
  const line=candidate(sport,{rows:rows(sport,{spread:[point(lock,-10,null,null),point(clock,-12,null,null)],total:[point(lock,50,null,null),point(clock,48,null,null)]})});
  assert.equal(line.market_tracking.spread_adjustment,2);assert.equal(line.market_tracking.total_adjustment,-2);
  const value=(move)=>candidate(sport,{rows:rows(sport,{total:[point(lock,50),point(clock,50+move,50,70)]})}).market_tracking.total_adjustment;
  assert(value(0)>0);assert(value(2)>value(1));assert(value(1)>value(0));
  const adverse=candidate(sport,{rows:rows(sport,{total:[point(lock,50,12,95),point(clock,49,26,66)]})});
  assert(adverse.market_tracking.total_adjustment<0);
 });
 test(`${sport}: incomplete, contradictory, stale, future and post-start quotes cannot publish`,()=>{
  for(const change of [r=>r.pop(),r=>r[0]['Home Team']='Other',r=>r[0].Line='99',r=>r[0]['Updated At']=iso(clock+1),r=>r[0]['Updated At']=iso(clock-91*60000)]){
   const r=rows(sport);change(r);assert.throws(()=>candidate(sport,{rows:r}));
  }
  assert.throws(()=>candidate(sport,{now:tip}));assert.throws(()=>candidate(sport,{activation:{...activation(sport),sport:sport==='NBA'?'NFL':'NBA'}}));
  const f=candidate(sport);for(const mutate of [f=>f.total++,f=>f.spread_grade='A',f=>f.market_tracking.spread_adjustment++,f=>f.market_tracking.parameters={...f.market_tracking.parameters,total_cap:99},f=>f.market_tracking.input_digest='a'.repeat(64)]){
   const bad=structuredClone(f);mutate(bad);assert.equal(store.verifiedMarketProjections([bad],activation(sport),clock).length,0);
  }
 });
}
test('NFL baseline reads independent spread and total precision and refuses an inconsistent score proof',()=>{
 const row={...native('NFL'),'Projected Margin':'9.9','Projected Total':'49.9','Projected Home':'29.9','Projected Away':'20.0',
  'Spread Model JSON':JSON.stringify({ready:true,margin:9.876}),'Total Model JSON':JSON.stringify({ready:true,tree_total:49.912})};
 const b=core.normalizeProjectionBaseline('NFL',row,date,iso(tip));assert(b);assert.equal(-b.fair_home_spread,9.876);assert.equal(b.total,49.912);
 assert.equal(core.normalizeProjectionBaseline('NFL',{...row,'Projected Home':'99'},date,iso(tip)),null);
});
test('unchanged heartbeats keep one identity; a new baseline or reversal has its own captured identity',()=>{
 const b=baseline('NBA'),first=core.projectionTrackingInputs(b,rows('NBA'),clock),r=rows('NBA',{at:clock+300000});
 for(const row of r){const h=JSON.parse(row['Details JSON']).movementHistory;h[1].snapshotTime=iso(clock);row['Details JSON']=JSON.stringify({movementHistory:h});}
 const second=core.projectionTrackingInputs(b,r,clock+300000);
 assert.equal(store.projectionDigest(core.projectionFingerprint(b,first)),store.projectionDigest(core.projectionFingerprint(b,second)));
 const next={...b,recordId:'new-baseline',total:212,home_score:111,away_score:101};
 assert.notEqual(store.projectionDigest(core.projectionFingerprint(b,first)),store.projectionDigest(core.projectionFingerprint(next,first)));
});
test('NBA original A/B records survive while adjusted forecasts and later baselines cannot become recorded bets',()=>{
 const b=native('NBA'),f=candidate('NBA'),a=activation('NBA');
 const old=nbaRecords.nbaModelPlays([b],[],clock);assert.equal(old.length,2);
 const later={...b,recordId:'later',lockedAt:iso(clock+1000)};
 const merged=store.mergeTrackedBasketballForecasts([b,later],[f],a,clock+1000);
 assert.deepEqual(nbaRecords.nbaModelPlays(merged,[],clock+1000),old);
 const play={market:'Total',side:'Over',line:100,gameTime:iso(tip),awayTeam:'Away',homeTeam:'Home'};
 const vote=nbaModel.nbaModelFor(play,merged,clock+1000);assert.equal(vote.active,false);assert.equal(vote.context.grade,'Ungraded');assert(vote.context.projectionAdjustment>0);
});
test('football overlay preserves the original ledger and props and cannot cast a new model vote',async()=>{
 const adapter=require('../lib/footballMarketProjection.ts'),oldRead=store.readMarketProjectionBundle;
 try{for(const sport of ['NFL','NCAAF']){
  const f=candidate(sport),a=activation(sport),r=native(sport),before={today:date,slateToday:[r],bestPlays:[{game:'Away @ Home',role:'Total',play:'Over 50'},
   {game:'Away @ Home',role:'Player Prop',playerName:'Player',play:'Over 50'}],betTrackerRows:[{Selection:'Over 50',Grade:'A',Line:'50'}],tiles:{bestPlaysToday:2}};
  const original=JSON.stringify(before);store.readMarketProjectionBundle=async()=>({activation:a,forecasts:[f]});
  const view=await adapter.applyFootballMarketProjections(sport,before,clock);
  assert.equal(JSON.stringify(before),original);assert.strictEqual(view.betTrackerRows,before.betTrackerRows);
  assert.equal(view.bestPlays.length,1);assert.equal(view.bestPlays[0].playerName,'Player');assert.equal(view.slateToday[0]['Spread Grade'],'Ungraded');
  const plays=rows(sport).map(r=>({date,game:'Away @ Home',gameTime:iso(tip),awayTeam:'Away',homeTeam:'Home',market:r.Market,side:r.Side,selection:r.Selection,selectionTeam:r.Market==='Spread'?r.Selection:'',line:Number(r.Line),odds:'-110',betsPct:Number(r['Current Bets %']),moneyPct:Number(r['Current Handle %']),updatedAt:iso(clock),snapshotStatus:'LIVE',movementHistory:[]}));
  const result=buildFootballSignalsState({sport,core:{...view,trendPlays:plays,trendRecordRows:[]},history:buildTeamTrendHistory(sport,[],[],[]),storedRows:[],now:clock,capture:false,leaderboard:[]});
  assert.equal(result.board.sides.length,4);
  for(const side of result.board.sides){assert.equal(side.signals.find(s=>s.key==='model').active,false);assert.equal(side.modelContext.grade,'Ungraded');}
  const total=result.board.sides.find(s=>s.market==='Total');assert.equal(total.modelContext.projection,f.total);assert.equal(total.modelContext.projectionAdjustment,f.market_tracking.total_adjustment);
  const early=buildFootballSignalsState({sport,core:{...view,trendPlays:plays,trendRecordRows:[]},history:buildTeamTrendHistory(sport,[],[],[]),storedRows:[],now:lock+30000,capture:false,leaderboard:[]});
  assert.equal(early.board.sides.find(s=>s.market==='Total').modelContext.projection,50);
 }}finally{store.readMarketProjectionBundle=oldRead;}
});
test('insert-only collector isolates sports, dedupes refreshes, saves material changes and freezes before play',async()=>{
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(`CREATE TABLE dataset_rows(sport TEXT,dataset TEXT,row_index INTEGER,payload_json TEXT,source_hash TEXT,date_key TEXT,game_key TEXT,game TEXT,market TEXT,selection TEXT,result TEXT,snapshot_time TEXT,imported_at TEXT,PRIMARY KEY(sport,dataset,row_index));CREATE TABLE dataset_manifest(sport TEXT,dataset TEXT,source_workbook TEXT,source_worksheet TEXT,headers_json TEXT,row_count INTEGER,imported_at TEXT,source_kind TEXT,PRIMARY KEY(sport,dataset));`);
 const old={read:db.readTursoDatasetByDateKeys,sql:db.runTursoSql,atomic:db.runTursoAtomicSql,invalidate:db.invalidateTursoDatasetReadCache},calls=[];
 const query=sql=>{calls.push(sql);return sqlite.prepare(sql).all().map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,String(v??'')])));};
 db.runTursoSql=async sql=>sql.map(query);db.runTursoAtomicSql=async sql=>{sqlite.exec('BEGIN IMMEDIATE');try{const out=sql.map(query);sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}};
 db.readTursoDatasetByDateKeys=async(s,d,dates)=>sqlite.prepare(`SELECT payload_json FROM dataset_rows WHERE sport=? AND dataset=? AND date_key IN (${dates.map(()=>'?').join(',')})`).all(s,d,...dates).map(r=>JSON.parse(r.payload_json));db.invalidateTursoDatasetReadCache=()=>{};
 try{
  const snapshots=[];
  for(const sport of ['NBA','NFL','NCAAF']){
   const b=baseline(sport),one=await store.refreshMarketProjections(sport,[b],rows(sport),[date],clock);
   assert.equal(one.captured,1);assert.deepEqual(one.errors,[]);
   assert.equal((await store.refreshMarketProjections(sport,[b],rows(sport),[date],clock)).captured,0);
   const later=clock+300000,r=rows(sport,{at:later,total:[point(lock,50),point(clock,52,60,70),point(later,51,55,60)]});
   assert.equal((await store.refreshMarketProjections(sport,[b],r,[date],later)).captured,1);
   const final=tip-15*60000;
   assert.equal((await store.refreshMarketProjections(sport,[b],rows(sport,{at:final,final:true}),[date],final)).captured,1);
   const before=sqlite.prepare('SELECT payload_json FROM dataset_rows WHERE sport=? ORDER BY dataset,row_index').all(sport);
   const finalRow=JSON.parse(sqlite.prepare("SELECT payload_json FROM dataset_rows WHERE sport=? AND dataset='market_projection_updates' AND market='Final Forecast'").get(sport).payload_json);
   await store.appendMarketProjectionRows(sport,policy.MARKET_PROJECTION_UPDATES,[{...finalRow,Market:'Forecast',Selection:'concurrent-late-update','Snapshot Time ET':iso(final+60000),'Updated At':iso(final+60000)}]);
   assert.deepEqual(sqlite.prepare('SELECT payload_json FROM dataset_rows WHERE sport=? ORDER BY dataset,row_index').all(sport),before,'an in-flight live writer cannot overtake a frozen projection');
   assert.equal((await store.refreshMarketProjections(sport,[b],rows(sport,{at:final+60000}),[date],final+60000)).captured,0);
   assert.equal((await store.refreshMarketProjections(sport,[b],rows(sport),[date],tip+1000)).captured,0);
   assert.deepEqual(sqlite.prepare('SELECT payload_json FROM dataset_rows WHERE sport=? ORDER BY dataset,row_index').all(sport),before);
   snapshots.push(...await store.readMarketProjectionUpdates(sport,[date]));
  }
  assert.equal(snapshots.length,3);assert.equal(new Set(snapshots.map(f=>f.sport)).size,3);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM dataset_rows WHERE dataset='market_projection_updates'").get().n,9);
  assert(calls.every(sql=>!/^UPDATE|^DELETE/.test(sql)));
 }finally{db.readTursoDatasetByDateKeys=old.read;db.runTursoSql=old.sql;db.runTursoAtomicSql=old.atomic;db.invalidateTursoDatasetReadCache=old.invalidate;sqlite.close();}
});

module.exports={baseline,native,rows,candidate,activation,clock,tip,date};
