const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {ncaamSpreadGrade,ncaamSpreadQuote,attachNcaamSpreadGrades}=require('../lib/ncaamSpreadGrades.ts');
const {ncaamModelFor}=require('../lib/ncaamTrendLeaderboard.ts');
const records=require('../lib/ncaamRecords.ts');
const lockedAt='2026-11-12T12:00:00Z',tipoff='2026-11-12T20:00:00Z',published='2026-11-12T12:00:01Z',resultAt='2026-11-12T23:00:00Z';
const policy={edge_window:{minimum_inclusive:1,maximum_exclusive:4},A_profiles:[
  {id:'defense-supported',minimum_edge:2,picked_defense_z_maximum:-1,maximum_opposing_matchup_tempo_z_exclusive:1},
  {id:'three-factor-confluence',minimum_edge:3}],B_profile:{minimum_edge:1}};
function fixture(dog=false,mode='live'){
  const f={recordId:'capture-1',gameId:'1',modelVersion:'point-model',lockedAt,tipoff,away_team:'Away',home_team:'Home',
    fair_home_spread:dog?-3.5:-7.5,home_spread_edge:dog?-2:2,spread_grade:'Research',spread_pick:dog?'Away +5.5':'Home -5.5',
    total:150,total_grade:'Research',market:{home_spread:-5.5,total:151.5,as_of:lockedAt},spreadResult:'PENDING'};
  const g={policy_version:'ncaam-spread-grades-2026-11-12-v1',policy_sha256:'a'.repeat(64),policy,
    forecast_record_id:f.recordId,game_id:f.gameId,as_of:lockedAt,tipoff,published_at:mode==='live'?published:resultAt,record_mode:mode,
    grade:'A',side:dog?'away':'home',projected_side:dog?'away':'home',selection_team:dog?'Away':'Home',
    line:dog?5.5:-5.5,home_line:-5.5,fair_home_spread:f.fair_home_spread,projected_margin:dog?-3.5:7.5,edge:2,
    role:dog?'Underdog':'Favorite',reason:'Strong national defense with projection support',offense_advantage:2,defense_advantage:7,
    picked_defense_z:-1,mean_tempo_z:0,tempo_support_z:0,benchmark_observed_at:'2026-11-12T11:00:00Z'};
  return {f,g};
}
const attach=(f,g)=>attachNcaamSpreadGrades([f],[{'Details JSON':JSON.stringify(g)}])[0];
test('a losing underdog is graded on covering the spread, with exact cover-edge boundaries',()=>{
  const {f,g}=fixture(true),saved=attach(f,g);
  assert.equal(saved.spread_grade,'A');assert.equal(saved.spread_pick,'Away +5.5');assert(g.projected_margin<0);
  for(const [edge,expected] of [[.99,'Research'],[1,'B'],[1.99,'B'],[2,'A'],[3.99,'A'],[4,'Research']])
    assert.equal(ncaamSpreadQuote(g,edge-g.projected_margin).grade,expected);
  assert.equal(f.spread_grade,'Research');
});
test('malformed annotations, different source captures, changed paired lines and post-tip publications cannot attach',()=>{
  const {f,g}=fixture();
  for(const patch of [{forecast_record_id:'other'},{game_id:'other'},{side:'away'},{selection_team:'Away'},{edge:3},
    {line:-4.5},{home_line:-4.5},{fair_home_spread:-8.5},{published_at:tipoff},{benchmark_observed_at:tipoff},
    {policy:null},{policy:{...policy,A_profiles:null}},{policy:{...policy,B_profile:null}},{policy_version:17}]){
    assert.equal(ncaamSpreadGrade({...f,matchup_spread:{...g,...patch}}),null,JSON.stringify(patch));
    assert.equal(attach(f,{...g,...patch}).spread_grade,'Research');
  }
  assert.equal(attachNcaamSpreadGrades([f],[{'Details JSON':'null'},{'Details JSON':'{bad'}])[0],f);
});
test('national defense, opposite tempo directions and three-factor confluence change grades as specified',()=>{
  const {g}=fixture();
  assert.equal(ncaamSpreadQuote({...g,mean_tempo_z:-1},g.line).grade,'B');
  assert.equal(ncaamSpreadQuote({...g,mean_tempo_z:-.999},g.line).grade,'A');
  const dog=fixture(true).g;
  assert.equal(ncaamSpreadQuote({...dog,mean_tempo_z:1},dog.line).grade,'B');
  assert.equal(ncaamSpreadQuote({...dog,mean_tempo_z:.999},dog.line).grade,'A');
  const c={...g,picked_defense_z:-.6,mean_tempo_z:.1};
  assert.equal(ncaamSpreadQuote(c,-4.5).grade,'A');assert.equal(ncaamSpreadQuote(c,-4.51).grade,'B');
  assert.equal(ncaamSpreadQuote({...c,offense_advantage:0},-4.5).grade,'B');
});
test('current signal quotes regrade both directions and stop at the upper edge cap',()=>{
  const {f,g}=fixture(),saved=attach(f,g),asOf=Date.parse(published)+1000;
  const p={market:'Spread',selectionTeam:'Home',awayTeam:'Away',homeTeam:'Home',gameTime:tipoff,line:-5.5,odds:'-110'};
  const signal=patch=>ncaamModelFor({...p,...patch},[saved],asOf);
  assert.equal(signal({}).active,true);
  assert.equal(signal({line:-6.5}).context.grade,'B');assert.equal(signal({line:-6.5}).active,true);
  assert.equal(signal({line:-6.51}).active,false);assert.equal(signal({line:-3.5}).active,false);
  assert.equal(signal({line:-4.5}).active,true);assert.equal(signal({line:-4.5}).context.regraded,true);
  assert.equal(signal({selectionTeam:'Away',line:5.5}).active,false);assert.equal(signal({odds:'-120'}).active,false);
  assert.equal(ncaamModelFor(p,[saved],Date.parse(lockedAt)).active,false);
  const replay=attach(f,{...g,record_mode:'replay',published_at:resultAt});
  assert.equal(ncaamModelFor(p,[replay],Date.parse(resultAt)+1).active,false);
});
test('a Research annotation supersedes prior A without granting a signal after repricing',()=>{
  const {f,g}=fixture(),research={...g,side:null,grade:'Research',published_at:'2026-11-12T12:01:00Z',policy_sha256:'b'.repeat(64)};
  const saved=attach({...f,matchup_spread:g},research);
  assert.equal(saved.spread_grade,'Research');assert.equal(saved.recordId,f.recordId);
  assert.equal(records.ncaamModelPlays([saved],[],Date.parse(published)+120000).length,0);
  assert.equal(ncaamModelFor({market:'Spread',selectionTeam:'Home',awayTeam:'Away',homeTeam:'Home',gameTime:tipoff,line:-5.5,odds:'-110'},[saved],Date.parse(published)+120000).active,false);
});
test('one settled spread per game is counted in grade and favorite/dog subtotals, with replay isolated',()=>{
  const {f,g}=fixture(true),saved=attach(f,g),now=Date.parse(resultAt)+1;
  const schedule={'Game ID':'1','Game Time':tipoff,'Away Team':'Away','Home Team':'Home','Away Score':'78','Home Score':'82',Completed:'TRUE',Status:'STATUS_FINAL','Result Updated':resultAt};
  const state=records.updateNcaamModelRecords(undefined,[saved,saved],[schedule],now,['2026-11-12']);
  const summary=records.summarizeNcaamModelRecords(state,'2026-11-12');
  assert.equal(summary.overall.record,'1-0-0');assert.equal(summary.history.length,1);assert.equal(summary.history[0].spreadRole,'Underdog');
  assert.equal(summary.byType.find(r=>r.label==='A Spread').overall.wins,1);
  assert.equal(summary.byType.find(r=>r.label==='A Underdog Spread').overall.wins,1);
  assert.equal(summary.byType.find(r=>r.label==='A Favorite Spread').overall.totalBets,0);
  const replay=attach(f,{...g,record_mode:'replay',published_at:resultAt});
  const replaySummary=records.summarizeNcaamModelRecords(records.updateNcaamModelRecords(undefined,[replay],[schedule],now,['2026-11-12']),'2026-11-12');
  assert.equal(replaySummary.overall.totalBets,0);assert.equal(replaySummary.replay.overall.record,'1-0-0');
});
