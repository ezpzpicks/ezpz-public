const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '..');
const trends = load(path.join(root, 'lib/footballTeamTrends.ts'));
const source = load(path.join(root, 'lib/footballTeamSeasonHistory.ts'));
const fixture = require('./fixtures/football-team-season-2026.json');
const now = Date.parse('2026-10-15T11:00:00Z');
const pick = { date: '2026-10-15', game: 'East Carolina @ UAB', gameTime: '2026-10-15T23:30:00Z',
  market: 'Total', selection: 'Over 47.5', line: 47.5, snapshotStatus: 'FINAL_PREGAME' };
const schedule = fixture.games.map(g => g.schedule);
const parsed = fixture.games.map(g => source.parseEspnTeamSeasonGame(g.summary, 'NCAAF', g.schedule, now));
const clone = value => JSON.parse(JSON.stringify(value));

test('exact college identities recognize mascots and aliases without merging distinct schools', () => {
  for (const [a,b] of [['East Carolina Pirates','ECU'], ['App State Mountaineers','Appalachian State'],
    ['North Carolina Central Eagles','NCCU'], ['UL Monroe Warhawks','ULM'], ['UAB Blazers','UAB']]) {
    assert.equal(trends.footballTeamKey(a,'NCAAF'), trends.footballTeamKey(b,'NCAAF'));
  }
  assert.notEqual(trends.footballTeamKey('Ohio Bobcats','NCAAF'), trends.footballTeamKey('Ohio State Buckeyes','NCAAF'));
  assert.notEqual(trends.footballTeamKey('Miami Hurricanes','NCAAF'), trends.footballTeamKey('Miami (OH) RedHawks','NCAAF'));
});

test('all eleven ECU/UAB games grade from real final scores and historical lines, without tracked bets or prices', () => {
  assert.ok(parsed.every(Boolean));
  assert.ok(parsed.every(r => r.Odds === '-110'));
  const history = trends.buildTeamTrendHistory('NCAAF', [], [], schedule, parsed);
  const score = trends.scoreFootballTeamTrends(pick, 'NCAAF', history, now);
  assert.equal(score.teams[0].trackedGames, 5);
  assert.equal(score.teams[1].trackedGames, 6);
  assert.deepEqual(Array.from(score.teams, t => [t.records.betType.record,t.records.venue.record,t.records.recent.record]),
    [['1-4-0','1-1-0','1-4-0'], ['1-5-0','0-3-0','0-5-0']]);
  assert.equal(score.score.toFixed(1), '18.7');
  const under = trends.scoreFootballTeamTrends({ ...pick, selection: 'Under 47.5' }, 'NCAAF', history, now);
  assert.equal(under.score.toFixed(1), '81.3');
});

test('known missing games prevent a partial season from becoming a numeric score', () => {
  const incomplete = parsed.filter(r => r['Game ID'] !== '401862710');
  const history = trends.buildTeamTrendHistory('NCAAF', [], [], schedule, incomplete);
  const score = trends.scoreFootballTeamTrends(pick, 'NCAAF', history, now);
  assert.equal(score.teams[0].seasonGames, 5);
  assert.equal(score.teams[0].missingGames, 1);
  assert.equal(score.score, null);
});

test('closing season lines supersede older model lines and repeated trend observations', () => {
  const game = parsed.find(r => r['Game ID'] === '401856634');
  const tracker = { Date: game.Date, Game: game.Game, 'Bet Type': 'Total', Selection: 'Under 80', Result: 'W' };
  const history = trends.buildTeamTrendHistory('NCAAF', [], [tracker, tracker], schedule, [...parsed, game]);
  const score = trends.scoreFootballTeamTrends(pick, 'NCAAF', history, now);
  assert.equal(score.teams[0].records.betType.record, '1-4-0');
  assert.equal(score.teams[0].trackedGames, 5);
});

test('the parser rejects future/incomplete games, another event, another date and another opponent', () => {
  const fixtureGame = fixture.games[0];
  const unfinished = clone(fixtureGame.summary);
  unfinished.header.competitions[0].status.type.completed = false;
  assert.equal(source.parseEspnTeamSeasonGame(unfinished,'NCAAF',fixtureGame.schedule,now),null);
  assert.equal(source.parseEspnTeamSeasonGame(fixtureGame.summary,'NCAAF',fixtureGame.schedule,Date.parse('2026-07-01')),null);
  for (const changes of [{ 'Game ID':'999999999' }, { 'Game Date':'2026-09-01', Date:'2026-09-01' }, { 'Away Team':'Ohio State' }]) {
    assert.equal(source.parseEspnTeamSeasonGame(fixtureGame.summary,'NCAAF',{ ...fixtureGame.schedule,...changes },now),null);
  }
});

test('home closing spread retains its sign when the favorite is away, and 0 is a valid pick-em line', () => {
  const g = fixture.games[0], payload = clone(g.summary), quote = payload.pickcenter[0];
  quote.spread = -7;
  quote.pointSpread.home.close.line = '+7';
  assert.equal(source.parseEspnTeamSeasonGame(payload,'NCAAF',g.schedule,now)['Home Spread'],'7');
  quote.pointSpread.home.close.line = '0';
  assert.equal(source.parseEspnTeamSeasonGame(payload,'NCAAF',g.schedule,now)['Home Spread'],'0');
});

test('missing market lines stay missing; only the unit price defaults to -110', () => {
  const g = fixture.games[0], payload = clone(g.summary);
  payload.pickcenter = [];
  const row = source.parseEspnTeamSeasonGame(payload,'NCAAF',g.schedule,now);
  assert.equal(row.Odds,'-110');
  assert.equal(row.Total,'');
  assert.equal(row['Home Spread'],'');
});

test('NFL identities and a kickoff after UTC midnight retain the correct Eastern game date', () => {
  const g = fixture.games.find(g => g.schedule['Game ID'] === '401858424');
  const payload = clone(g.summary);
  const competition = payload.header.competitions[0];
  competition.competitors.find(t=>t.homeAway==='away').team.displayName = 'Buffalo Bills';
  competition.competitors.find(t=>t.homeAway==='home').team.displayName = 'Houston Texans';
  const expected = { ...g.schedule, 'Away Team':'BUF', 'Home Team':'HOU' };
  const row = source.parseEspnTeamSeasonGame(payload,'NFL',expected,now);
  assert.equal(row.Date,'2026-09-03');
  assert.equal(row.Game,'Buffalo Bills @ Houston Texans');
});

test('incomplete final scores can fill before kickoff; complete scores and past decisions stay frozen', () => {
  const incompleteHistory = trends.buildTeamTrendHistory('NCAAF', [], [], schedule, parsed.slice(0,1));
  const completeHistory = trends.buildTeamTrendHistory('NCAAF', [], [], schedule, parsed);
  const saved = trends.withFootballTeamTrends(pick,'NCAAF',incompleteHistory,undefined,now);
  assert.equal(saved.teamTrendScore.score,null);
  const filled = trends.withFootballTeamTrends(pick,'NCAAF',completeHistory,saved,now+1000);
  assert.equal(filled.teamTrendScore.score.toFixed(1),'18.7');
  assert.deepEqual(trends.withFootballTeamTrends(pick,'NCAAF',new Map(),filled,now+2000).teamTrendScore,filled.teamTrendScore);
  const legacy = clone(filled); legacy.teamTrendScore.version = 'team-trends-2026-10-15-v1'; legacy.teamTrendScore.score = 32.5;
  assert.equal(trends.withFootballTeamTrends(pick,'NCAAF',completeHistory,legacy,now).teamTrendScore.score.toFixed(1),'18.7');
  assert.equal(trends.withFootballTeamTrends(pick,'NCAAF',completeHistory,legacy,Date.parse('2026-10-16')).teamTrendScore.score,32.5);
});

function refreshWith(fetchImpl, writes) {
  const exports = {};
  const filename = path.join(root,'lib/footballTeamSeasonHistory.ts');
  const code = ts.transpileModule(fs.readFileSync(filename,'utf8'),{ compilerOptions:{ module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code,{ exports,Date,Intl,console,AbortSignal,fetch:fetchImpl,
    require:name => name==='./footballTeamTrends' ? trends : name==='./sportSheets' ? { upsertSportRows:async(...args)=>writes.push(args) } : require(name) });
  return exports;
}

test('snapshot refresh backfills untracked games once, persists them, and skips complete cached history', async () => {
  const writes=[], calls=[];
  const api = refreshWith(async url=>{
    calls.push(url);const id=new URL(url).searchParams.get('event');
    return { ok:true,json:async()=>fixture.games.find(g=>g.schedule['Game ID']===id).summary };
  },writes);
  const finals = schedule.map(r=>({ ...r,Completed:'TRUE','Away Score':r['Away Score']||'12','Home Score':r['Home Score']||'28' }));
  const rows = await api.refreshFootballTeamSeasonHistory('NCAAF',finals,[pick],[],now);
  assert.equal(calls.length,11);
  assert.equal(rows.length,11);
  assert.equal(writes.length,1);
  await api.refreshFootballTeamSeasonHistory('NCAAF',finals,[pick],rows,now+60000);
  assert.equal(calls.length,11);
});

test('a failed history request retains cached records and never fabricates the missing game', async () => {
  const writes=[];
  const api=refreshWith(async()=>({ ok:false,status:503 }),writes);
  const existing=parsed.slice(0,1);
  const finals=schedule.slice(0,2).map(r=>({ ...r,Completed:'TRUE' }));
  const rows=await api.refreshFootballTeamSeasonHistory('NCAAF',finals,[pick],existing,now);
  assert.equal(rows.length,1);
  assert.equal(writes.length,0);
});

test('the bounded refresh prioritizes selected picks ahead of the rest of the weekly board', async () => {
  const calls=[], writes=[];
  const api=refreshWith(async url=>{
    const id=new URL(url).searchParams.get('event');calls.push(id);
    return { ok:true,json:async()=>fixture.games.find(g=>g.schedule['Game ID']===id)?.summary || {} };
  },writes);
  const warm=Array.from({length:30},(_,i)=>({ Date:`2026-09-${String(i+1).padStart(2,'0')}`, 'Game ID':String(499000000+i),
    'Away Team':'Ohio State','Home Team':'Penn State','Away Score':'20','Home Score':'10',Completed:'TRUE' }));
  const finals=schedule.map(r=>({ ...r,Completed:'TRUE','Away Score':r['Away Score']||'12','Home Score':r['Home Score']||'28' }));
  await api.refreshFootballTeamSeasonHistory('NCAAF',[...warm,...finals],[pick,{ date:pick.date,game:'Ohio State @ Penn State' }],[],now);
  assert.equal(calls.length,24);
  assert.ok(finals.every(r=>calls.includes(r['Game ID'])));
});
