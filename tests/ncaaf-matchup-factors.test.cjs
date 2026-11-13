const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const api = load(path.join(__dirname, '../lib/ncaafMatchupFactors.ts'));
const policy = api.NCAAF_MATCHUP_POLICY;
function fixture() {
  const f = { away:{team:'Away',offense:35,defense:31,tempo:13}, home:{team:'Home',offense:29,defense:28,tempo:12.5},
    season:2026, observed_at:'2026-11-13T12:00:00Z', population_sha256:'a'.repeat(64),
    source:'Bill Connelly SP+ via CFB Update', source_url:'https://pay.cfbupdate.com/sp-ratings',
    pace_source:'SportsDataverse play-by-play', pace_through_week:11,
    national:{offense:{mean:27,sd:7,teams:138},defense:{mean:27,sd:7,teams:138},tempo:{mean:12,sd:1,teams:138}} };
  const g = {grade:'B',reason:'Matchup support',as_of:'2026-11-13T12:01:00Z',published_at:'2026-11-13T12:01:00Z',
    kickoff:'2026-11-14T01:00:00Z',policy_version:policy,policy_sha256:'b'.repeat(64),source_population_sha256:'a'.repeat(64),record_mode:'live',status:'provisional'};
  return { row:{Season:'2026','Away Team':'Away','Home Team':'Home','Grading Policy Version':policy,
    'Matchup Factors JSON':JSON.stringify(f),'Matchup Spread JSON':JSON.stringify(g),'Matchup Total JSON':JSON.stringify(g)}, f,g };
}
test('only captured published SP+ factors with the same teams, season and pregame source identity display',()=>{
  const {row,f,g}=fixture();assert.equal(api.ncaafMatchupContext(row).factors.away.offense,35);
  for(const patch of [{season:2025},{away:{...f.away,team:'Other'}},{source_url:'https://example.com'},
    {observed_at:'2026-11-14T02:00:00Z'},{observed_at:'2026-10-01T12:00:00Z'},
    {national:{...f.national,tempo:{mean:12,sd:0,teams:138}}},{national:{...f.national,tempo:{mean:12,sd:1,teams:80}}}])
    assert.equal(api.ncaafMatchupContext({...row,'Matchup Factors JSON':JSON.stringify({...f,...patch})}),null);
  for(const patch of [{as_of:g.kickoff},{source_population_sha256:'c'.repeat(64)},{record_mode:'replay'},
    {as_of:'2026-11-13T12:01:00'},{policy_version:'old'}])
    assert.equal(api.ncaafMatchupContext({...row,'Matchup Total JSON':JSON.stringify({...g,...patch})}),null);
  assert.equal(api.ncaafMatchupContext({...row,'Grading Policy Version':''}),null);
  assert.equal(api.ncaafMatchupContext({...row,'Matchup Factors JSON':'null'}),null);
  const aliases={...f,away:{...f.away,team:'Louisiana Monroe'}};
  assert(api.ncaafMatchupContext({...row,'Away Team':'UL Monroe','Matchup Factors JSON':JSON.stringify(aliases)}));
});
test('new policy records exclude legacy outcomes, pending decisions, duplicates and invalid prices',()=>{
  const base={Date:'2026-11-13','Game ID':'1','Bet Type':'Total',Selection:'Over 54',Grade:'A Total',Result:'Win','Odds/Line':'-110','Grading Policy Version':policy};
  const legacy={...base,'Game ID':'2','Grading Policy Version':'',Result:'Loss'};
  const rows=[base,base,legacy,{...base,'Game ID':'3',Result:'Pending'},
    {...base,'Game ID':'4','Bet Type':'Spread',Grade:'B Spread',Result:'Loss'},
    {...base,'Game ID':'5',Result:'Push'}, {...base,'Game ID':'6','Odds/Line':'1'}];
  const result=api.ncaafMatchupRecordSummary(rows,'2026-11-13');
  assert.equal(result.overall.record,'1-1-1');assert.equal(result.overall.totalBets,3);assert.equal(result.overall.unitsWon,-.09);
  assert.equal(result.last7Days.record,'1-1-1');assert.equal(legacy.Result,'Loss');
  assert.equal(api.ncaafMatchupRecordSummary(rows,'2026-11-21').last7Days.totalBets,0);
  assert.equal(api.ncaafMatchupRecordSummary([legacy],'2026-11-13').overall.totalBets,0);
});
