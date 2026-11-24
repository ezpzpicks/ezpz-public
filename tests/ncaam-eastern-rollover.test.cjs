const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript');
const load = require('./load-typescript.cjs');
const root = path.join(__dirname, '..');
const readModule = (file, imports = {}) => {
  const exports = {};
  const output = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(output, {exports, Date, Intl, URL, AbortSignal, console: {warn(){}, error(){}},
    require: id => imports[id] || {}});
  return exports;
};
const core = load(path.join(root,'lib/ncaamMarketCore.ts'));
const {bucketNcaamEspnSchedule,createNcaamEspnScheduleReader} =
  readModule('lib/ncaamEspnSchedule.ts', {'./ncaamMarketCore': core});
const first = '2026-11-24', second = '2026-11-25';
const now = Date.parse('2026-11-24T12:00:00Z');
const game = (id, date, completed = false) => {
  const status = {type: {state: completed ? 'post' : 'pre', name: completed ? 'STATUS_FINAL' : 'STATUS_SCHEDULED', completed}};
  return {id, season: {year: 2027, type: 2}, timeValid: true, competitions: [{date, status, neutralSite: true, competitors:[
    {homeAway:'away', team:{id:'2250', displayName:'Gonzaga Bulldogs'}, score:completed ? '96' : undefined},
    {homeAway:'home', team:{id:'2306', displayName:'Kansas State Wildcats'}, score:completed ? '90' : undefined},
  ]}]};
};
const normal = game('401927398','2026-11-24T15:00:00Z'), rollover = game('401909800','2026-11-25T05:30:00Z');
const wrap = events => ({events});
const parseDate = url => new URL(url).searchParams.get('dates').replace(/^(\d{4})(\d\d)(\d\d)$/,'$1-$2-$3');
const makeReader = (boards, calls = []) => createNcaamEspnScheduleReader(async url => {
  const date = parseDate(url); calls.push(date);
  return boards[date] == null ? {ok:false,status:503} : {ok:true,json:async()=>wrap(boards[date])};
});
test('provider slate buckets a midnight Eastern game without rejecting the valid current day', () => {
  assert.throws(() => core.normalizeNcaamSlate(wrap([normal, rollover]), first), /Eastern date/);
  const days = bucketNcaamEspnSchedule(wrap([normal, rollover]), first);
  assert.equal(days.get(first)[0].gameId, normal.id);
  assert.equal(days.get(second)[0].gameId, rollover.id);
  assert.equal(days.get(second)[0].date, second);
  assert.throws(() => bucketNcaamEspnSchedule(wrap([normal, {...rollover,id:'not-an-id'}]),first), /identity/);
  assert.throws(() => bucketNcaamEspnSchedule(wrap([normal,normal]),first), /Duplicate/);
  assert.throws(() => bucketNcaamEspnSchedule(wrap([game('1','2026-11-26T14:00:00Z')]),first), /outside/);
});
test('next Eastern slate recovers omitted game, dedupes agreement, protects finals, rejects conflicts', async () => {
  const calls=[];
  const boards = {[first]:[normal,rollover],[second]:[],'2026-11-23':[]};
  const read = makeReader(boards,calls);
  assert.equal((await read(first)).following[0].gameId, rollover.id);
  assert.equal((await read(second)).games[0].gameId, rollover.id);
  assert.equal(calls.filter(d=>d===first).length,1);
  const previousFinal = game(rollover.id,'2026-11-25T05:30:00Z',true);
  const duplicated = await makeReader({[first]:[previousFinal],[second]:[rollover]})(second);
  assert.equal(duplicated.games.length,1);
  assert.equal(duplicated.games[0].status,'STATUS_FINAL');
  await assert.rejects(()=>makeReader({[first]:[rollover],[second]:[game(rollover.id,'2026-11-25T06:30:00Z')]})(second), /Conflicting/);
  await assert.rejects(()=>makeReader({[first]:[rollover],[second]:[game(rollover.id,'2026-11-24T20:30:00Z')]})(second), /Conflicting/);
  const unrelatedEarlier = game(normal.id,'2026-11-24T14:00:00Z');
  const unrelatedLater = game(normal.id,'2026-11-24T15:30:00Z');
  const unaffected = await makeReader({[first]:[unrelatedEarlier,rollover],[second]:[unrelatedLater]})(second);
  assert.equal(unaffected.games[0].gameId,rollover.id);
});
test('persisted entry point recovers prior pending schedule even if current provider is down', async () => {
  const final = game('401920721','2026-11-24T03:00:00Z',true);
  const reader = makeReader({'2026-11-23':[final],'2026-11-22':[]});
  const writes=[];
  const stores = {saveNcaamMarketRows:async(dataset,rows)=>{writes.push({dataset,rows});}};
  const pendingState = {version:'v',season:'2026',teamHistory:[],leaderboard:[],pendingDates:['2026-11-23'],archiveDates:[],tests:{}};
  const turso = {readTursoDatasetByDateKeys:async(_sport,dataset)=>dataset==='analysis'?[{'Details JSON':JSON.stringify(pendingState)}]:[]};
  const analysis = readModule('lib/ncaamAnalysis.ts',{
    './ncaamAnalysisCore':{ncaamSeason:()=> '2026',NCAAM_ANALYSIS_VERSION:'v'},
    './ncaamTrendLeaderboard':{NCAAM_ANALYSIS_TAB:'analysis'},
    './ncaamMarketStore': stores, './tursoStore':turso,
  });
  const market = readModule('lib/ncaamMarket.ts',{
    './ncaamMarketCore':core,'./ncaamAnalysis':analysis,
    './ncaamEspnSchedule':{createNcaamEspnScheduleReader:()=>reader},
  });
  await assert.rejects(()=>market.collectNcaamMarket({persist:false,now}), /2026-11-24: 503/);
  assert.equal(writes.length,0);
  await assert.rejects(()=>market.collectNcaamMarket({persist:true,now}), /2026-11-24: 503/);
  assert.equal(writes.length,1);
  assert.equal(writes[0].dataset,'schedule');
  assert.equal(writes[0].rows[0].Date,'2026-11-23');
  assert.equal(writes[0].rows[0].Status,'STATUS_FINAL');
  assert.equal(writes[0].rows[0]['Away Score'],'96');
});

test('schedule and posted-game storage never let stale status regress a saved final', async () => {
  const final = {Date:'2026-11-23','Game Key':'2026-11-23|ncaam|123','Game ID':'123',Status:'STATUS_FINAL',Completed:'TRUE',
    'Away Score':'96','Home Score':'90'};
  const stale = {...final,Status:'STATUS_SCHEDULED',Completed:'FALSE','Away Score':'','Home Score':''};
  const commits=[];
  let existing=[final];
  const store=readModule('lib/ncaamMarketStore.ts',{
    './ncaamMarketCore':core,
    './tursoStore':{readTursoDatasetByDateKeys:async()=>existing,runTursoAtomicSql:async sql=>commits.push(sql),
      invalidateTursoDatasetReadCache(){}},
  });
  for (const dataset of ['schedule','posted_games']) await store.saveNcaamMarketRows(dataset,[stale]);
  assert.equal(commits.length,0);
  existing=[];
  await store.saveNcaamMarketRows('schedule',[stale]);
  assert.match(commits[0][1], /AND NOT .*STATUS_FINAL.*TRUE/);
  existing=[stale];
  await store.saveNcaamMarketRows('schedule',[final]);
  assert.doesNotMatch(commits[1][1], /AND NOT/);
});
