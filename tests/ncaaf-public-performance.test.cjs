const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const load = require('./load-typescript.cjs');
const root = path.join(__dirname, '..');
const display = load(path.join(root, 'lib/footballPublicDisplay.ts'));
const weeks = load(path.join(root, 'lib/footballPublicWeeks.ts'));
const policy = load(path.join(root, 'lib/ncaafTrendRecordPolicy.ts'));

test('chart presentation retains endpoints and every change without mutating observations or memberships', () => {
  const points = Array.from({length: 1000}, (_, i) => ({ snapshotTime: String(i),
    line: i < 500 ? 52 : 51.5, odds: '-110', betsPct: 60, moneyPct: 70 }));
  const evaluation = {version:'saved', memberships:[{pair:'test', direction:0}]};
  const raw = {trendPlays:[{movementHistory:points, catalogEvaluation:evaluation}]};
  const compact = display.compactFootballPublicDisplay(raw);
  assert.deepEqual(Array.from(compact.trendPlays[0].movementHistory, p => p.snapshotTime), ['0','499','500','999']);
  assert.equal(compact.trendPlays[0].catalogEvaluation, evaluation);
  assert.equal(raw.trendPlays[0].movementHistory.length,1000);
  const unscored = {trendPlays:[{movementHistory:points}]};
  assert.equal(display.compactFootballPublicDisplay(unscored).trendPlays[0].movementHistory, points);
});

test('weekly display loads only one selected week and still lists the full archive', () => {
  const games = [
    {Date:'2026-10-03',Week:'Week 6'}, {Date:'2026-10-10',Week:'Week 7'},
    {Date:'2026-10-09',Week:'Week 7'}, {Date:'2026-10-17',Week:'Week 8'},
  ];
  const current = weeks.selectFootballPublicWeek(games,'2026-10-11');
  assert.equal(current.selectedWeek,'Week 8');
  assert.deepEqual(Array.from(current.availableWeeks),['Week 6','Week 7','Week 8']);
  assert.deepEqual(Array.from(current.dateKeys),['2026-10-17']);
  assert.deepEqual(Array.from(weeks.selectFootballPublicWeek(games,'2026-10-11','Week 7').dateKeys),['2026-10-09','2026-10-10']);
  assert.equal(weeks.selectFootballPublicWeek(games.slice(0,3),'2026-10-11').selectedWeek,'Week 7');
  assert.equal(weeks.selectFootballPublicWeek(games,'2026-10-11','Week 99').selectedWeek,'Week 8');
  assert.equal(weeks.selectFootballPublicWeek([],'2026-10-11').dateKeys.length,0);
});

test('public NCAAF reads use the verified final ledger and never replay archived charts; audit cache stays separate', async () => {
  const final = {Date:'2026-10-10',Game:'Army @ Temple','Away Team':'Army','Home Team':'Temple',Market:'Total',Selection:'Over',
    'Public Split Line':'50','Public Split Odds':'-110','Actual Away Runs':'30','Actual Home Runs':'25',Result:'W',
    'Record Snapshot Policy':policy.NCAAF_TREND_RECORD_POLICY,'Snapshot Status':'FINAL_PREGAME',
    'Public Split Snapshot Time':'10/10/2026, 6:45:00 PM EDT'};
  const reads = [], writes = [];
  const tables = {all_game_trends:[final], football_catalog_memberships:[final,{...final,'Record Snapshot Policy':''}]};
  const api = {};
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-10-11T22:00:00Z'])); }
    static now() { return Date.parse('2026-10-11T22:00:00Z'); }
  }
  const imports = {
    './ncaafTrendRecordPolicy':policy,
    './ncaafEzpzPolicy':load(path.join(root, 'lib/ncaafEzpzPolicy.ts')),
    './sportSheets': {readSportWorksheet:async (_sport, table) => tables[table] || [],
      sportDatabaseLabel:sport => sport, ensureSportWorksheet:async()=>{},
      upsertSportRows:async()=>writes.push('write')},
    './scoresAndOddsBettingSplits': {SCORES_AND_ODDS_SOURCE:'ScoresAndOdds',
      assessScoresAndOddsMarketCoverage:()=>({ok:true,receivedGames:0,expectedGames:0,missingGames:[],incompleteGames:[]}),
      loadScoresAndOddsConsensus:async()=>{throw new Error('Sunday feed empty')}},
    './footballWeeklyMarket':{readWeeklyFootballMarket:async (_sport, options)=>{
      reads.push(options);
      if(options.finalSnapshotsOnly) throw new Error('archive replay requested');
      return {trendPlays:[]};
    }},
  };
  const source = fs.readFileSync(path.join(root,'lib/footballPublicDataCore.ts'),'utf8');
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports:api,require:id=>imports[id]||{},Date:Clock,Intl,URL,AbortSignal,process:{env:{}},
      console:{warn(){},error(){}}, fetch:async()=>({ok:true,json:async()=>({events:[]})})});
  const result = await api.buildFootballPublicData('NCAAF',{publicDisplay:true});
  assert.equal(result.ok,true);
  assert.equal(result.trendRecordRows.length,1);
  assert.equal(result.trendRecordRows[0],final);
  assert.equal(reads.length,1);
  assert.deepEqual(Array.from(reads[0].dateKeys),['2026-10-11']);
  assert.equal(writes.length,0);
  await assert.rejects(api.buildFootballPublicData('NCAAF'),/archive replay requested/);
});
