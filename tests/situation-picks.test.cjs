const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '..');
const rules = load(path.join(root, 'lib/situationRules.ts'));
const signals = load(path.join(root, 'lib/footballSignals.ts'));
const feed = load(path.join(root, 'lib/signalPicks.ts'));
const mcp = load(path.join(root, 'lib/ezpzMcpPicks.ts'));
const date = rules.SITUATION_START_DATE;
const now = Date.parse(`${date}T18:45:00Z`), iso = stamp => new Date(stamp).toISOString();
const plain = value => JSON.parse(JSON.stringify(value));

function state(sport, patches = {}) {
  const [away, home] = sport === 'NFL' ? ['DAL', 'GB'] : sport === 'NCAAF' ? ['Virginia Tech', 'SMU']
    : sport === 'NBA' ? ['Dallas Mavericks', 'Houston Rockets'] : ['Duke', 'Kansas'];
  const base = { date, game: `${away} @ ${home}`, awayTeam: away, homeTeam: home, gameTime: iso(now + 900000), odds: '-110',
    snapshotStatus: 'FINAL_PREGAME', frozenAt: iso(now), updatedAt: iso(now), firstTrackedAt: iso(now - 13 * 3600000), movementHistory: [] };
  const markets = [
    { market: 'Spread', side: away, selectionTeam: away, selection: away, line: 2.5, openingLine: 3.5, betsPct: 25, moneyPct: 25, openingBetsPct: 17, openingMoneyPct: 30 },
    { market: 'Spread', side: home, selectionTeam: home, selection: home, line: -2.5, openingLine: -3.5, betsPct: 75, moneyPct: 75, openingBetsPct: 83, openingMoneyPct: 70 },
    { market: 'Total', side: 'Over', selection: 'Over', line: 45.5, openingLine: 45, betsPct: 52, moneyPct: 45, openingBetsPct: 50, openingMoneyPct: 40 },
    { market: 'Total', side: 'Under', selection: 'Under', line: 45.5, openingLine: 45, betsPct: 48, moneyPct: 55, openingBetsPct: 50, openingMoneyPct: 60 },
  ];
  if (sport === 'NCAAF') {
    markets[0].openingLine = markets[0].line;
    markets[1].openingLine = markets[1].line;
    markets[2].moneyPct = 67;
    markets[3].moneyPct = 33;
  }
  return signals.buildFootballSignalsState({ sport, now, capture: true, storedRows: [], history: new Map(), leaderboard: [],
    core: { today: date, trendPlays: markets.map((market, index) => ({ ...base, ...market, ...patches[index] })) } });
}

test('each sport uses its own priority rules and only sends a saved final choice to the official feed', () => {
  const expected = { NFL: 'nfl-spread-fade-70', NCAAF: 'ncaaf-home-unchanged-spread', NBA: 'nba-spread-60-60', NCAAM: 'ncaam-under-balanced-tickets' };
  for (const sport of Object.keys(expected)) {
    const { board, changedRows } = state(sport);
    assert.equal(changedRows.length, 4);
    assert.equal(feed.selectSignalEzpzPicks(board.sides, sport, now).length, 0, 'observation alone is not an official pick');
    const policy = rules.reviewSituationRules(sport, date, now, undefined, []);
    const [pick, other] = rules.situationWinners(board.sides, policy, now);
    assert.equal(other, undefined);
    assert.equal(pick.situationRuleId, expected[sport]);
    assert.equal(pick.odds, '-110'); assert.equal(pick.oddsAssumed, true);
    const result = feed.signalPickForFeed(pick, sport);
    assert(feed.isSignalFeedPick(result, sport, now));
    assert.equal(result.selectionMethod, 'situation_rule');
    const normalized = mcp.normalizeMcpPick(sport, result, now);
    assert.equal(normalized.pickLabel, 'EZPZ Signal Pick');
    assert.equal(normalized.eligibleForPosting, true);
    assert.equal(normalized.ruleId, expected[sport]);
    assert.equal(rules.situationWinners(board.sides, policy, now + 900000).length, 0);
  }
});

test('NCAAF needs a valid opener for its home spread and falls through to its money-gap total', () => {
  const policy = rules.reviewSituationRules('NCAAF', date, now, undefined, []);
  const moved = state('NCAAF', { 0: { openingLine: 3 }, 1: { openingLine: -3 } });
  assert.equal(rules.situationWinners(moved.board.sides, policy, now)[0].situationRuleId, 'ncaaf-total-money-gap-15');
  const recent = state('NCAAF', { 1: { firstTrackedAt: iso(now - 3600000) } });
  assert.equal(rules.situationWinners(recent.board.sides, policy, now)[0].situationRuleId, 'ncaaf-total-money-gap-15');
  const original = { snapshotTime: iso(now), line: -2.5, betsPct: 75, moneyPct: 75, odds: '-125' };
  const observed = state('NCAAF', { 1: { odds: '-125', movementHistory: [original] } });
  const [home] = rules.situationWinners(observed.board.sides, policy, now);
  assert.equal(home.selection, 'SMU -2.5');
  assert.equal(home.odds, '-125');
  assert.equal(home.oddsAssumed, false);
  assert.equal(feed.signalSelectorVersion('NCAAF', '2026-11-05'), 'combo-ezpz-ncaaf-2026-11-01-v1');
});

test('final pricing respects verified NFL odds and conflicts in the paired capture', () => {
  const raw = odds => ({ snapshotTime: iso(now), line: 2.5, betsPct: 25, moneyPct: 25, odds });
  const policy = rules.reviewSituationRules('NFL', date, now, undefined, []);
  const actual = state('NFL', { 0: { odds: '-125', movementHistory: [raw('-125')] } });
  const [pick] = rules.situationWinners(actual.board.sides, policy, now);
  assert.equal(pick.odds, '-125'); assert.equal(pick.oddsAssumed, false);
  const missing = state('NFL', { 0: { odds: '-110', movementHistory: [raw('')] } });
  assert.equal(rules.situationWinners(missing.board.sides, policy, now)[0].oddsAssumed, true);
  const expensive = state('NFL', { 0: { odds: '-155', movementHistory: [raw('-155')] } });
  assert.equal(rules.situationWinners(expensive.board.sides, policy, now)[0].situationRuleId, 'nfl-over-total-rise');
  const conflict = state('NFL', { 0: { odds: '-125', movementHistory: [raw('-125'), raw('-120')] } });
  assert.equal(rules.situationWinners(conflict.board.sides, policy, now).length, 0);
  const rescheduled = actual.board.sides.map(side => ({ ...side, scheduledGameTime: iso(now + 3600000) }));
  assert.equal(rules.situationWinners(rescheduled, policy, now).length, 0);
});

test('the daily review needs fresh, profitable slates and pauses after two losing groups', () => {
  const policy = rules.reviewSituationRules('NCAAM', date, now, undefined, []);
  const reviewDate = '2026-11-10';
  const results = id => Array.from({ length: 20 }, (_, i) => ({ date: `2026-11-0${6 + Math.floor(i / 5)}`,
    gameKey: `game${i}`, snapshotAt: iso(now + i * 1000), result: i % 5 < 3 ? 'W' : 'L',
    quote: { odds: '-110', assumed: true, ruleIds: [id] } }));
  const watch = results(policy.rules[1].id), active = results(policy.rules[0].id).map(row => ({ ...row, result: 'L' }));
  const check = rows => rules.reviewSituationRules('NCAAM', reviewDate, now, policy, rows);
  assert.equal(check(watch.slice(1)).rules[1].active, false);
  assert.equal(check(watch.map(row => ({ ...row, officialRuleId: policy.rules[0].id }))).rules[1].active, false);
  const next = check([...watch, ...active]);
  assert.equal(next.rules[0].change, 'paused'); assert.equal(next.rules[1].change, 'promoted');
  const tomorrow = rules.reviewSituationRules('NCAAM', '2026-11-11', now, next, [...watch, ...active]);
  assert.equal(tomorrow.rules[0].decided, 0); assert.equal(tomorrow.rules[1].decided, 0);
});

test('SQLite owns each NCAAF game decision, requires saved evidence and settles the exact frozen quote', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE dataset_rows(sport TEXT,dataset TEXT,date_key TEXT,row_index INTEGER,result TEXT,payload_json TEXT);
    CREATE INDEX idx_dataset_rows_date ON dataset_rows(sport,dataset,date_key);`);
  const insert = db.prepare(`INSERT INTO dataset_rows VALUES ('NCAAF','football_signal_observations',?,?,?,?)`);
  let current = now, writes = 0;
  class Clock extends Date { static now() { return current; } }
  const store = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'lib/situationStore.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: store, Date: Clock, require: name => name === './footballSignals' ? signals : name === './situationRules' ? rules : {
    runTursoSql: async statements => statements.map(sql => db.prepare(sql).all()),
    runTursoAtomicSql: async statements => { writes++; db.exec('BEGIN IMMEDIATE');
      try { for (const sql of statements) db.exec(sql); db.exec('COMMIT'); }
      catch (error) { db.exec('ROLLBACK'); throw error; } },
  } });
  const { board, changedRows } = state('NCAAF');
  assert.equal((await store.attachSituationBoard(board, 'NCAAF')).summary.pending, 0);
  assert.equal(writes, 0);
  assert.equal((await store.attachSituationBoard(board, 'NCAAF', true)).summary.pending, 0, 'only durable observations can qualify');
  changedRows.forEach((row, i) => insert.run(row.Date, i, '', JSON.stringify(row)));
  const locked = await store.attachSituationBoard(board, 'NCAAF', true);
  const first = (await store.readSituationPicks('NCAAF', date))[0];
  assert.equal(locked.summary.pending, 1); assert.equal(first.line, -2.5);
  const totalOnly = { ...board, sides: board.sides.map(s => s.market === 'Spread' ? { ...s, situationQuote: { ...s.situationQuote, ruleIds: [] } } : s) };
  await store.attachSituationBoard(totalOnly, 'NCAAF', true);
  assert.deepEqual(plain(await store.readSituationPicks('NCAAF', date)), [plain(first)]);
  current += 4 * 3600000;
  const raw = changedRows.find(row => row['Pick Key'] === first.id);
  insert.run(date, 30, 'L', JSON.stringify({ ...raw, Line: '3.5', Result: 'L', 'Result Updated': iso(current) }));
  await store.attachSituationBoard(board, 'NCAAF', true);
  assert.equal((await store.readSituationPicks('NCAAF', date))[0].result, '');
  insert.run(date, 31, 'W', JSON.stringify({ ...raw, Result: 'W', 'Result Updated': iso(current) }));
  const graded = await store.attachSituationBoard(board, 'NCAAF', true);
  assert.equal(graded.summary.record, '1-0-0');
  assert.equal((await store.readSituationPicks('NCAAF', date))[0].result, 'W');
  assert.equal((await store.readSituationPicks('NFL', date)).length, 0);
  current += 86400000;
  const next = await store.reviewSituations('NCAAF', '2026-11-07', current);
  assert.equal(next.rules[0].decided, 1);
  assert.equal(next.rules[0].netUnits, 0.91);
  db.close();
});
