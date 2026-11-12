const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, f);
const { attachNcaamMatchupGrades, ncaamMatchupGrade } = require('../lib/ncaamMatchupGrades.ts');
const { settleNcaamForecast } = require('../lib/ncaamMarketCore.ts');
const records = require('../lib/ncaamRecords.ts');
const { ncaamModelFor } = require('../lib/ncaamTrendLeaderboard.ts');
const lockedAt = '2026-11-11T18:37:24.000Z', tipoff = '2026-11-11T20:00:00.000Z';
const published = '2026-11-11T18:37:25.000Z', resultAt = '2026-11-11T23:00:00.000Z';
function fixtures(mode = 'live') {
  const forecast = { recordId:'saved-1', gameId:'401911230', lockedAt, tipoff, modelVersion:'point-model',
    away_team:'Loyola Chicago', home_team:'Air Force', total:158.29, total_edge:-2.21,
    total_pick:'Under 160.5', total_grade:'Research', spread_grade:'Research', market:{total:160.5}, totalResult:'LOSS' };
  const grade = { policy_version:'ncaam-matchup-grades-2026-11-11-v1', policy_sha256:'a'.repeat(64),
    forecast_record_id:forecast.recordId, game_id:forecast.gameId, grade:'B', side:'Over', line:160.5,
    reason:'Very fast team with favorable opposing offense/defense pairing', record_mode:mode,
    published_at:mode === 'live' ? published : resultAt, as_of:lockedAt, tipoff,
    benchmark_observed_at:'2026-11-10T23:04:21Z', market_reference:{observed_at:'2026-11-11T02:37:33Z'},
    directions:{Over:{grade:'B',base_grade:'A',conflicts:[{id:'market-total-headwind',reason:'High total for an Over',levels:1}]}}, z:{} };
  const schedule = { Date:'2026-11-11','Game ID':forecast.gameId,'Game Time':tipoff,
    'Away Team':forecast.away_team,'Home Team':forecast.home_team,'Away Score':'98','Home Score':'102',
    Completed:'TRUE',Status:'STATUS_FINAL','Result Updated':resultAt };
  return {forecast,grade,schedule};
}
const attach = (forecast,grade) => attachNcaamMatchupGrades([forecast],[{'Details JSON':JSON.stringify(grade)}])[0];
test('saved factor side overrides the point lean and settles independently from the numeric projection', () => {
  const {forecast,grade} = fixtures(); const f = attach(forecast,grade);
  assert.equal(f.total_pick,'Over 160.5'); assert.equal(f.total_grade,'B');
  assert.equal(f.numeric_total_pick,'Under 160.5'); assert.equal(f.total_edge,-2.21);
  assert.equal(f.totalResult,'PENDING');
  const result = settleNcaamForecast(f,{game_id:f.gameId,completed:true,status:'STATUS_FINAL',tipoff,
    source:{observed_at:resultAt},away:{name:f.away_team,score:98},home:{name:f.home_team,score:102}},f.gameId,lockedAt);
  assert.equal(result.totalResult,'WIN'); assert.equal(result.numeric_totalResult,'LOSS');
  assert.deepEqual(attachNcaamMatchupGrades([f],[{'Details JSON':JSON.stringify(grade)}])[0].numeric_total_pick,'Under 160.5');
  assert.equal(forecast.total_pick,'Under 160.5');
});
test('grades cannot attach to a different capture, line, game, future benchmark or post-tipoff live publication', () => {
  const {forecast,grade} = fixtures();
  for (const patch of [{forecast_record_id:'other'},{game_id:'other'},{line:161.5},
    {published_at:tipoff},{benchmark_observed_at:tipoff},{market_reference:{observed_at:tipoff}}]) {
    const bad = {...grade,...patch};
    assert.equal(ncaamMatchupGrade({...forecast,matchup_total:bad}),null);
    assert.equal(attach(forecast,bad).total_grade,'Research');
  }
  assert.equal(attachNcaamMatchupGrades([forecast],[{'Details JSON':'null'},{'Details JSON':'{bad'}])[0],forecast);
  assert.equal(attach({...forecast,matchup_total:{bad:true}},grade).total_grade,'B');
});
test('replay results stay outside live records, with one selection per game and A/B direction breakdowns', () => {
  const {forecast,grade,schedule} = fixtures('replay'); const f = attach(forecast,grade), now = Date.parse(resultAt)+1;
  const plays = records.ncaamModelPlays([f,f], [schedule],now);
  assert.equal(plays.length,1); assert.equal(plays[0].recordMode,'replay'); assert.equal(plays[0].result,'W');
  const state = records.updateNcaamModelRecords(undefined,[f,f],[schedule],now,['2026-11-11']);
  const summary = records.summarizeNcaamModelRecords(state,'2026-11-11');
  assert.equal(summary.overall.totalBets,0); assert.equal(summary.history.length,0);
  assert.equal(summary.replay.overall.record,'1-0-0'); assert.equal(summary.replay.history.length,1);
  assert.equal(summary.replay.byType.find(r=>r.label==='B Over').overall.wins,1);
  assert.equal(summary.replay.byType.find(r=>r.label==='B Under').overall.totalBets,0);
  const live = attach(forecast,{...grade,record_mode:'live',published_at:published});
  const next = records.updateNcaamModelRecords(state,[live],[schedule],now,['2026-11-11']);
  const updated = records.summarizeNcaamModelRecords(next,'2026-11-11');
  assert.equal(updated.overall.wins,1); assert.equal(updated.replay.overall.totalBets,0);
});
test('factor signals support the saved side without a numeric edge gate, while replay and worse lines do not vote', () => {
  const {forecast,grade} = fixtures();
  const play = {market:'Total',side:'Over',awayTeam:forecast.away_team,homeTeam:forecast.home_team,gameTime:tipoff,line:160.5,odds:'-110'};
  const f = attach(forecast,grade), asOf = Date.parse(published)+1000;
  assert.equal(ncaamModelFor(play,[f],asOf).active,true);
  assert.equal(ncaamModelFor({...play,line:159.5},[f],asOf).active,true);
  assert.equal(ncaamModelFor({...play,line:161.5},[f],asOf).active,false);
  assert.equal(ncaamModelFor({...play,odds:'-120'},[f],asOf).active,false);
  assert.equal(ncaamModelFor({...play,side:'Under'},[f],asOf).active,false);
  assert.equal(ncaamModelFor(play,[f],Date.parse(lockedAt)).active,false);
  assert.equal(ncaamModelFor(play,[attach(forecast,{...grade,record_mode:'replay',published_at:resultAt})],asOf).active,false);
});
test('Research factor grades do not inherit a numeric A/B grade or count as a model play', () => {
  const {forecast,grade,schedule} = fixtures();
  const f = attach({...forecast,total_grade:'A'},{...grade,side:null,grade:'Research',reason:'Opposing directions have equal grades'});
  assert.equal(f.total_grade,'Research');
  assert.equal(records.ncaamModelPlays([f],[schedule],Date.parse(resultAt)+1).length,0);
});
