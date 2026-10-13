const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const load = require('./load-typescript.cjs');
const ncaafPolicy = load(path.join(__dirname, '../lib/ncaafEzpzPolicy.ts'));

const today = '2026-09-30';
const snapshotTime = '09/30/2026, 8:55:00 AM EDT';
const game = {
  Date: today, Game: 'Army @ Temple', 'Game ID': 'test-game',
  'Away Team': 'Army', 'Home Team': 'Temple', 'Game Time': '19:30',
};
const snapshot = {
  ...game, 'Game Time ET': '19:30', Market: 'Total', Selection: 'Over',
  Line: '48.5', Odds: '-110', 'Public Bets %': '58', 'Public Money %': '50',
  'Opening Line': '47.5', 'Opening Public %': '55', 'Opening Sharp %': '49',
  'Snapshot Time ET': snapshotTime, 'Opening Snapshot Time ET': '09/29/2026, 9:00:00 AM EDT',
  Source: 'ScoresAndOdds',
};

function compile(file) {
  return ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
}
const coreCode = compile('lib/footballPublicDataCore.ts');
const sourceCode = compile('lib/scoresAndOddsBettingSplits.ts');
const weeklyCode = compile('lib/footballWeeklyMarket.ts');

// Run the actual public builder on a cold cache. Only external feed/storage
// boundaries are mocked; no test contacts or modifies production services.
function harness(rows = [snapshot]) {
  const error = new TypeError('fetch failed');
  const writes = [];
  const warnings = [];
  const weeklyReads = [];
  let fresh = null;
  let writeError = null;
  let currentTime = Date.parse('2026-09-30T13:30:00Z');
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [currentTime])); }
    static now() { return currentTime; }
  }
  const weeklyPlay = {
    date: today, game: game.Game, gameKey: 'test-game', gameTime: game['Game Time'],
    awayTeam: 'Army', homeTeam: 'Temple', market: 'Total', selection: 'Over', side: 'Over',
    line: 48.5, odds: '-110', betsPct: 58, moneyPct: 50, signals: [],
    updatedAt: snapshotTime, snapshotStatus: 'LIVE',
  };
  const tables = { daily_slate: [game], schedule: [game], public_split_snapshots: rows };
  const sourceExports = {};
  vm.runInNewContext(sourceCode, { exports: sourceExports, require: () => ({}), process, Date: Clock });
  const weeklyExports = {};
  vm.runInNewContext(weeklyCode, { exports: weeklyExports, require: () => ({}), process, Date: Clock, Intl, console });
  const imports = {
    './ncaafEzpzPolicy': ncaafPolicy,
    './sportSheets': {
      readSportWorksheet: async (_sport, table) => tables[table] || [],
      ensureSportWorksheet: async () => {},
      sportDatabaseLabel: sport => sport,
      upsertSportRows: async (sport, table, _headers, rows) => {
        writes.push({ sport, table, rows });
        if (writeError) throw writeError;
      },
    },
    './scoresAndOddsBettingSplits': {
      ...sourceExports,
      loadScoresAndOddsConsensus: async () => {
        if (fresh) return { splits: fresh, errors: [], missingPages: [] };
        throw error;
      },
    },
    './footballWeeklyMarket': {
      ...weeklyExports,
      readWeeklyFootballMarket: async (sport, options) => {
        weeklyReads.push({ sport, options });
        return { trendPlays: [weeklyPlay] };
      },
    },
  };
  const exports = {};
  vm.runInNewContext(coreCode, {
    exports, require: id => imports[id], Date: Clock, Intl, process, URL,
    console: { ...console, warn: (...args) => warnings.push(args), error: (...args) => warnings.push(args) },
    fetch: async () => ({ ok: true, json: async () => ({ events: [] }) }),
  });
  return { ...exports, error, writes, warnings, weeklyReads, weeklyPlay, tables,
    setFresh: rows => { fresh = rows; }, failWrites: () => { writeError = error; },
    setTime: value => { currentTime = Date.parse(value); } };
}

for (const sport of ['NCAAF', 'NFL']) {
  test(`${sport} cold-cache refresh failure returns saved snapshots and weekly display data`, async () => {
    const h = harness();
    const data = await h.buildFootballPublicData(sport);
    assert.equal(data.ok, true);
    assert.equal(data.sport, sport);
    assert.equal(data.draftKings.stale, true);
    assert.equal(data.draftKings.displayMode, 'STALE_FALLBACK');
    assert.equal(data.draftKings.splits.length, 1);
    assert.equal(data.draftKings.splits[0].line, 48.5);
    assert.equal(data.draftKings.splits[0].betsPct, 58);
    assert.equal(data.draftKings.splits[0].snapshotTime, snapshotTime);
    assert.equal(data.draftKings.splits[0].openingSnapshotTime, snapshot['Opening Snapshot Time ET']);
    assert.equal(data.trendPlays[0], h.weeklyPlay);
    assert.equal(h.weeklyReads.length, 1);
    assert.equal(h.writes.length, 0);
  });
}

test('NCAAF persistence does not turn retained observations into new snapshots', async () => {
  const h = harness();
  await h.buildFootballPublicData('NCAAF', { persist: true });
  assert.equal(h.writes.filter(write => write.table === 'public_split_snapshots').length, 0);
  const trendWrite = h.writes.find(write => write.table === 'all_game_trends');
  const over = trendWrite.rows.find(row => row.Market === 'Total' && row.Selection === 'Over');
  assert.equal(over['Public Split Snapshot Time'], snapshotTime);
});

test('NCAAF public read still loads weekly data when no legacy snapshots match the current slate', async () => {
  const h = harness([
    { ...snapshot, Date: '2026-09-23' },
    { ...snapshot, 'Away Team': 'Alabama', 'Home Team': 'Georgia' },
    { ...snapshot, Source: 'DraftKings' },
    { ...snapshot, 'Public Bets %': '' },
  ]);
  const data = await h.buildFootballPublicData('NCAAF');
  assert.equal(data.ok, true);
  assert.equal(data.draftKings.splits.length, 0);
  assert.equal(data.draftKings.status, 'UNAVAILABLE');
  assert.equal(data.trendPlays[0], h.weeklyPlay);
  assert.equal(h.writes.length, 0);
});

test('NCAAF scheduled capture and NFL still report an outage when no usable snapshots exist', async () => {
  for (const [sport, options] of [['NCAAF', { persist: true }], ['NFL', {}]]) {
    const h = harness([]);
    await assert.rejects(h.buildFootballPublicData(sport, options), error => error === h.error);
    assert.equal(h.writes.length, 0);
  }
});

test('NCAAF public reads can grade pending records without depending on a storage write', async () => {
  const h = harness();
  const completed = { ...game, Date: '2026-09-26', 'Game ID': 'finished-game',
    Completed: 'TRUE', 'Away Score': '30', 'Home Score': '20' };
  h.tables.schedule.push(completed);
  h.tables.bet_tracker = [{ ...completed, 'Bet Type': 'Total', Selection: 'Over 45.5',
    'Odds/Line': '-110', Result: 'Pending' }];
  h.failWrites();
  const data = await h.buildFootballPublicData('NCAAF');
  assert.equal(data.ok, true);
  assert.equal(data.betTrackerRows[0].Result, 'Win');
  assert.equal(h.writes.length, 0);
});

test('NCAAF scheduled capture still saves settled tracker records', async () => {
  const h = harness();
  const completed = { ...game, Date: '2026-09-26', 'Game ID': 'finished-game',
    Completed: 'TRUE', 'Away Score': '30', 'Home Score': '20' };
  h.tables.schedule.push(completed);
  h.tables.bet_tracker = [{ ...completed, 'Bet Type': 'Total', Selection: 'Over 45.5',
    'Odds/Line': '-110', Result: 'Pending' }];
  await h.buildFootballPublicData('NCAAF', { persist: true });
  const write = h.writes.find(write => write.table === 'bet_tracker');
  assert.equal(write.rows[0].Result, 'Win');
});

test('NCAAF resumes fresh data after the feed recovers', async () => {
  const h = harness();
  await h.buildFootballPublicData('NCAAF');
  h.setFresh([{
    date: today, eventTime: '19:30', game: game.Game,
    awayTeam: 'Army', homeTeam: 'Temple', market: 'Total', selection: 'Over',
    selectionTeam: '', side: 'Over', line: 49.5, odds: '-110', betsPct: 61, moneyPct: 52,
  }]);
  const data = await h.buildFootballPublicData('NCAAF', { forceFresh: true });
  assert.equal(data.draftKings.stale, false);
  assert.equal(data.draftKings.displayMode, 'LIVE');
  assert.equal(data.draftKings.splits[0].line, 49.5);
  assert.equal(data.draftKings.splits[0].betsPct, 61);
});

function pairedFeed() {
  return ['Over', 'Under'].map(side => ({
    date: today, eventTime: '19:30', game: game.Game, awayTeam: 'Army', homeTeam: 'Temple',
    market: 'Total', selection: side, selectionTeam: '', side,
    line: 48.5, odds: '-110', betsPct: side === 'Over' ? 58 : 42, moneyPct: side === 'Over' ? 50 : 50,
  }));
}

test('NFL final game crossing the 15-minute cutoff remains verified through kickoff', async () => {
  for (const [at, expected] of [
    ['2026-09-30T23:14:00Z', 1],
    ['2026-09-30T23:15:00Z', 0],
    ['2026-09-30T23:20:00Z', 0],
    ['2026-09-30T23:30:00Z', 0],
  ]) {
    const h = harness(); h.setTime(at); h.setFresh(pairedFeed());
    const data = await h.buildFootballPublicData('NFL', { forceFresh: true });
    assert.equal(data.draftKings.stale, false, at);
    assert.equal(data.draftKings.coverage.ok, true, at);
    assert.equal(data.draftKings.coverage.expectedGames, expected, at);
    assert.equal(data.draftKings.coverage.receivedGames, 1, at);
  }
});

test('NFL empty expected coverage does not excuse an absent schedule or unknown kickoff', async () => {
  const absent = harness([]); absent.setFresh(pairedFeed());
  absent.tables.daily_slate = []; absent.tables.schedule = [];
  await assert.rejects(absent.buildFootballPublicData('NFL'), /slate rejected/);
  const unknown = harness(); unknown.setTime('2026-09-30T23:20:00Z'); unknown.setFresh(pairedFeed());
  unknown.tables.daily_slate = [{ ...game, 'Game Time': '' }];
  unknown.tables.schedule = [{ ...game, 'Game Time': '' }];
  const data = await unknown.buildFootballPublicData('NFL');
  assert.equal(data.draftKings.stale, true);
  assert.equal(data.draftKings.coverage.ok, false);
});

test('NFL still rejects missing or incomplete active games before the cutoff', async () => {
  const incomplete = harness(); incomplete.setTime('2026-09-30T23:14:00Z');
  incomplete.setFresh(pairedFeed().slice(0, 1));
  const partial = await incomplete.buildFootballPublicData('NFL');
  assert.equal(partial.draftKings.stale, true);
  assert.ok(partial.draftKings.errors.some(error => error.includes('incomplete')));
  const missing = harness(); missing.setTime('2026-09-30T23:20:00Z'); missing.setFresh(pairedFeed());
  missing.tables.schedule.push({ ...game, 'Game ID': 'missing-game', 'Away Team': 'Other', 'Game Time': '20:00' });
  const missingData = await missing.buildFootballPublicData('NFL');
  assert.equal(missingData.draftKings.stale, true);
  assert.ok(missingData.draftKings.coverage.missingGames.includes('Other @ Temple'));
});
