const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Run the actual production functions with network/storage imports replaced.
// No test makes a production write or substitutes the retrieval algorithms.
function load(file, names = [], imports = {}, extra = '', runtime = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8') +
    `\nexport const testFunctions = {${names.join(',')}};\n` + extra;
  const code = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  }}).outputText;
  const exports = {};
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-09-23T00:50:00Z'])); }
    static now() { return Date.parse('2026-09-23T00:50:00Z'); }
  }
  const context = { exports, require: id => imports[id] || {}, Date: Clock,
    console, process, URL, AbortSignal, setTimeout, clearTimeout, ...runtime };
  vm.runInNewContext(code, context, { filename: file });
  return exports;
}
const sao = load('lib/scoresAndOddsBettingSplits.ts');
const clock = load('lib/mlbTrendV2.ts');
const core = load('app/api/public-data-core.ts', [
  'isValidFinalTrackingSnapshot', 'finalPregameDisplayPayloadFromRows',
  'mlbDirectSnapshotHistory', 'persistPublicSplitSnapshotRecords',
  'publicDisplayDraftKingsPayload',
], { '../../lib/scoresAndOddsBettingSplits': sao }, `
let stored: any[] = [];
readWorksheetMatrixWithClient = async () => ({ rows: stored.map(object => ({object})) } as any);
writeWholeWorksheet = async (_s: any, _id: any, _tab: any, _headers: any, rows: any[]) => { stored = rows; };
export function seed(rows: any[]) { stored = rows; }
export function saved() { return stored; }
`);
const daily = load('app/api/mlb-daily-market/route.ts', ['historicalPlay'], {
  '../../../lib/mlbTrendV2': clock,
});
const football = load('lib/footballWeeklyMarket.ts', [
  'marketHistorySummary', 'indexMarketHistoryBySide', 'splitTrendKey',
], { './scoresAndOddsBettingSplits': sao });

const game = { Date: '2026-09-22', 'Game Key': '824302', 'Game Time': '20:40',
  Game: 'Arizona Diamondbacks at Colorado Rockies',
  'Away Team': 'Arizona Diamondbacks', 'Home Team': 'Colorado Rockies' };
function snapshot(time, extras = {}) {
  return { ...game, 'Game Time ET': '20:40', 'Data Type': 'Game Market', Market: 'Total',
    Selection: 'Over 11', Side: 'Over', Line: '11', Odds: '-110',
    'Current Public %': '58', 'Current Sharp %': '67',
    'Snapshot Time ET': `09/22/2026, ${time} EDT`,
    'Match Confidence': 'Scheduled pregame snapshot', Source: 'ScoresAndOdds', ...extras };
}
function marketHtml(label = 'Over', line = 'o7', offer = 'o7.5', odds = '-125') {
  return `<img alt="Astros"><img alt="Mariners"><span>${label} (${line})</span>
    <span>% of Bets</span><span>Under (u7)</span><span>93%</span><span>&nbsp;</span>
    <span>89%</span><span>11%</span><span>% of Money</span>
    <div>Best over</div><span>${offer}</span><span>${odds}</span>
    <div>Best under</div><span>u7</span><span>even</span>`;
}

test('consensus percentages survive while mismatched total prices are withheld', () => {
  const rows = sao.parseScoresAndOddsConsensus(marketHtml(), 'MLB');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].line, 7);
  assert.equal(rows[0].odds, '');
  assert.equal(rows[0].betsPct, 93);
  assert.equal(rows[1].betsPct, 7);
  assert.equal(rows[1].moneyPct, 11);
  assert.equal(rows[1].odds, '+100');
  assert.equal(sao.parseScoresAndOddsConsensus(marketHtml('Over', 'o7', 'o7', '-120'), 'MLB')[0].odds, '-120');
});

test('source parser retains separate same-team game occurrences', () => {
  const rows = sao.parseScoresAndOddsConsensus(marketHtml() + marketHtml(), 'MLB');
  assert.equal(rows.length, 4);
  assert.equal(rows[0].sourceGameOccurrence, 1);
  assert.equal(rows[2].sourceGameOccurrence, 2);
});

test('a 4:15 PM final cannot lock an 8:40 PM game, but a 8:25 PM final can', () => {
  const flag = {'Match Confidence': '15-minute tracking snapshot (live selected-side match)'};
  assert.equal(core.testFunctions.isValidFinalTrackingSnapshot(snapshot('4:15:29 PM', flag), [game]), false);
  assert.equal(core.testFunctions.isValidFinalTrackingSnapshot(snapshot('8:25:18 PM', flag), [game]), true);
});

test('the first valid final remains immutable even when another final arrives', async () => {
  const flag = {'Match Confidence': '15-minute tracking snapshot (live selected-side match)'};
  const first = snapshot('8:25:18 PM', flag);
  core.seed([first]);
  await core.testFunctions.persistPublicSplitSnapshotRecords(null, '', [snapshot('8:35:18 PM', {...flag, 'Current Public %':'80'})], false, [game]);
  assert.equal(core.saved()[0]['Current Public %'], '58');
  core.seed([snapshot('4:15:29 PM', flag)]);
  await core.testFunctions.persistPublicSplitSnapshotRecords(null, '', [first], false, [game]);
  assert.equal(core.saved()[0]['Snapshot Time ET'], first['Snapshot Time ET']);
});

test('final display recovers the first lock, or the last real pregame observation', () => {
  const flag = {'Match Confidence': '15-minute tracking snapshot (live selected-side match)'};
  const old = snapshot('4:15:29 PM', flag);
  const first = snapshot('8:25:18 PM', {...flag, 'Current Public %':'79'});
  const later = snapshot('8:35:18 PM', {...flag, 'Current Public %':'80'});
  let result = core.testFunctions.finalPregameDisplayPayloadFromRows([old, later], [game], game.Date, [first]);
  assert.equal(result.splits[0].betsPct, 79);
  assert.equal(result.splits[0].snapshotTime, first['Snapshot Time ET']);
  result = core.testFunctions.finalPregameDisplayPayloadFromRows([old], [game], game.Date, [snapshot('8:20:18 PM'), snapshot('8:35:18 PM'), snapshot('8:45:18 PM')]);
  assert.equal(result.splits[0].snapshotTime, snapshot('8:35:18 PM')['Snapshot Time ET']);
});

test('total histories retain line changes and exclude data after final capture', () => {
  const split = { date: game.Date, eventTime:'20:40', game:game.Game,
    awayTeam:game['Away Team'],homeTeam:game['Home Team'],market:'Total',selection:'Over 11',
    line:11,odds:'-110',betsPct:58,moneyPct:67,snapshotStatus:'FINAL_PREGAME',
    snapshotTime:snapshot('8:25:18 PM')['Snapshot Time ET'] };
  const rows = [snapshot('8:15:18 PM', {Selection:'Over 10.5',Line:'10.5'}),snapshot('8:35:18 PM'),snapshot('8:45:18 PM')];
  const history = core.testFunctions.mlbDirectSnapshotHistory(split, rows, [game]);
  assert.equal(history.length, 2);
  assert.equal(history[0].line, 10.5);
  assert.equal(history[1].snapshotTime, split.snapshotTime);
});

test('doubleheader history rejects ambiguous time-less observations', () => {
  const split = {date:game.Date,eventTime:'13:05',game:game.Game,awayTeam:game['Away Team'],homeTeam:game['Home Team'],market:'Total',selection:'Over 11',line:11,odds:'-110',betsPct:58,moneyPct:67,snapshotStatus:'FINAL_PREGAME',snapshotTime:snapshot('12:50:07 PM')['Snapshot Time ET']};
  const games=[{...game,'Game Time':'13:05'},{...game,'Game Time':'19:05'}];
  const rows=[snapshot('12:45:00 PM',{'Game Time ET':''}),snapshot('4:15:29 PM',{'Game Time ET':'13:05'}),snapshot('12:40:00 PM',{'Game Time ET':'13:05'})];
  const history=core.testFunctions.mlbDirectSnapshotHistory(split,rows,games);
  assert.equal(history.length,2);
  assert.equal(history[0].snapshotTime,snapshot('12:40:00 PM')['Snapshot Time ET']);
});

test('daily history agrees with final state and never restores a missing price', () => {
  const flag = {'Match Confidence':'15-minute tracking snapshot (live selected-side match)'};
  const row = {...game, Market:'Total',Side:'Over','Public Split Odds':'-125'};
  const history=[snapshot('8:15:18 PM',{Selection:'Over 10.5',Line:'10.5'}),snapshot('8:25:18 PM',{...flag,Odds:''}),snapshot('8:35:18 PM',{...flag,'Current Public %':'80'}),snapshot('8:45:18 PM')];
  const play=daily.testFunctions.historicalPlay(row,[],history,[]);
  assert.equal(play.odds,'');
  assert.equal(play.betsPct,58);
  assert.equal(play.snapshotStatus,'FINAL_PREGAME');
  assert.equal(play.movementHistory.length,2);
  assert.equal(play.movementHistory[0].line,10.5);
});

test('football history index preserves movement results with a large slate', () => {
  const split={date:'2026-09-26',game:'Test at Opponent',awayTeam:'Test',homeTeam:'Opponent',market:'Total',side:'Over',selectionTeam:'',line:51.5,odds:'-110',betsPct:65,moneyPct:70};
  const key=football.testFunctions.splitTrendKey(split);
  const gameKey=key.slice(0,key.lastIndexOf('|total|'));
  const rows=Array.from({length:60000},(_,i)=>({'Game Key':`unrelated-${i%200}`,Market:'Total',Side:'Over',Line:'42',Odds:'-110','Bets %':'55','Handle %':'60'}));
  rows.push({'Game Key':gameKey,Market:'Total',Side:'Over',Line:'50',Odds:'-110','Bets %':'55','Handle %':'60'});
  rows.push({'Game Key':gameKey,Market:'Total',Side:'Over',Line:'51.5',Odds:'-110','Bets %':'65','Handle %':'70'});
  const index=football.testFunctions.indexMarketHistoryBySide(rows);
  const original=football.testFunctions.marketHistorySummary(split,rows);
  const indexed=football.testFunctions.marketHistorySummary(split,index.get(key));
  assert.deepEqual(JSON.parse(JSON.stringify(indexed)),JSON.parse(JSON.stringify(original)));
  assert.equal(index.get(key).length,2);
  assert.equal(indexed.lineMoveCount,1);
});

test('MLB history retains unchanged polls, ignores player props, and deduplicates retries', async () => {
  const history=[];
  const historyCore=load('app/api/public-data-core.ts',['appendPublicSplitHistory'],{
    '../../lib/tursoStore':{
      readTursoDatasetByDateKeys:async()=>history,
      appendTursoDataset:async(_sport,_dataset,rows)=>history.push(...rows),
    },
  });
  const append=historyCore.testFunctions.appendPublicSplitHistory;
  const first=snapshot('8:10:00 PM'), second=snapshot('8:15:00 PM');
  assert.equal(await append([first]),1);
  assert.equal(await append([second]),1);
  assert.equal(await append([second]),0);
  assert.equal(await append([snapshot('8:20:00 PM',{'Data Type':'Player Prop'})]),0);
  assert.equal(history.length,2);
  assert.equal(history[0].Line,history[1].Line);
  assert.notEqual(history[0]['Snapshot Time ET'],history[1]['Snapshot Time ET']);
});

function cronFor(persistence) {
  return load('app/api/cron/mlb-live-data/route.ts',['runCron'],{
    'next/server':{
      NextRequest:class {},
      NextResponse:{json:(body,options={})=>({body,status:options.status||200})},
    },
    '../../public-data-v2/route':{GET:async()=>({ok:true,status:200,json:async()=>({ok:true,draftKingsPersistence:persistence})})},
  },'RETRY_DELAYS_MS.splice(0);',{
    process:{env:{CRON_SECRET:'history-test'}},console:{error(){},warn(){},info(){}},
  }).testFunctions.runCron;
}
const cronRequest={url:'https://example.test/api/cron/mlb-live-data',headers:{get:()=> 'Bearer history-test'}};

test('MLB cron rejects a persistence failure even when the data response is HTTP 200', async () => {
  const response=await cronFor({status:'ERROR',historyStatus:'ERROR',error:'History append failed'})(cronRequest);
  assert.equal(response.status,502);
  assert.equal(response.body.ok,false);
  assert.match(response.body.error,/History append failed/);
});

test('MLB cron reports game-history writes separately from player-prop snapshots', async () => {
  const persistence={status:'SAVED',historyStatus:'NO_GAME_MARKETS',historyRowsAppended:0,snapshotGameMarketRows:0,snapshotPlayerPropRows:8};
  const response=await cronFor(persistence)(cronRequest);
  assert.equal(response.status,200);
  assert.equal(response.body.bettingSplitsPersistence.historyRowsAppended,0);
  assert.equal(response.body.bettingSplitsPersistence.snapshotPlayerPropRows,8);
  assert.equal(response.body.bettingSplitsPersistence.historyStatus,'NO_GAME_MARKETS');
});
