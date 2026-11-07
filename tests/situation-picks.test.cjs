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

function contextPair(market, kind) {
  const pair = state('NCAAF').board.sides.filter(side => side.market === market);
  const record = (wins, losses) => ({ wins, losses, pushes: 0, sample: wins + losses, winPct: 100 * wins / (wins + losses) });
  pair.forEach(side => {
    side.teamTrend = { asOfDate: date, capturedAt: iso(now), score: 50,
      teams: [side.awayTeam, side.homeTeam].map((team, i) => ({ team, opposing: market === 'Spread' && i !== 0,
        hasData: true, missingGames: 0, records: { recent: record(2, 3), venue: record(2, 3), betType: record(2, 3) } })) };
  });
  const selected = pair.find(side => market === 'Spread' ? side.line > 0 : side.side === (kind === 'team' ? 'Under' : 'Over'));
  const other = pair.find(side => side !== selected);
  if (kind === 'market' || kind === 'team') {
    Object.assign(other.signals.find(signal => signal.key === 'model'), { available: true, active: true });
    selected.teamTrend.score = kind === 'team' ? 70 : 40;
    other.teamTrend.score = 100 - selected.teamTrend.score;
  }
  if (kind === 'market') {
    selected.marketContext.bets = 25; selected.marketContext.money = 30;
    other.marketContext.bets = 75; other.marketContext.money = 70;
  }
  if (kind === 'team') selected.teamTrend.teams.forEach(team => { team.records.recent = record(4, 1); });
  if (kind === 'spread' || kind === 'sos') {
    const own = selected.teamTrend.teams.find(team => !team.opposing);
    own.records.recent = record(4, 1);
    if (kind === 'spread') {
      selected.marketContext.openingLine = selected.line + 0.5;
      other.marketContext.openingLine = other.line - 0.5;
      own.records.betType = record(4, 2);
      other.modelContext = { ...other.modelContext, version: 'cfb-v2.8.1-test', projection: other.line - 4,
        reason: 'No existing qualifying model play on this side.' };
    } else {
      own.records.venue = record(3, 1);
      selected.sosContext = { ...selected.sosContext, gap: 50, capturedAt: iso(now - 3600000) };
    }
  }
  return { pair, selected, other };
}

function contextRuleIds(example) {
  const quotes = rules.situationMarketQuotes(example.pair, 'NCAAF', now);
  return quotes[example.pair.indexOf(example.selected)]?.ruleIds || [];
}

test('NCAAF context rules recognize independent team, schedule and market cases and begin on watch', () => {
  const examples = [['Total', 'market', 'ncaaf-total-market-conflict'], ['Total', 'team', 'ncaaf-total-team-model-fade'],
    ['Spread', 'spread', 'ncaaf-spread-team-model-fade'], ['Spread', 'sos', 'ncaaf-underdog-sos-team-form']];
  const policy = rules.reviewSituationRules('NCAAF', date, now, undefined, []);
  for (const [market, kind, id] of examples) {
    assert(contextRuleIds(contextPair(market, kind)).includes(id), id);
    assert.equal(policy.rules.find(rule => rule.id === id).active, false);
  }
  const buyback = contextPair('Spread', 'spread');
  buyback.selected.marketContext.openingLine = buyback.selected.line;
  buyback.selected.marketContext.movement = { usesHistory: true, active: true, value: 0.5 };
  assert(contextRuleIds(buyback).includes('ncaaf-spread-team-model-fade'));
  buyback.selected.marketContext.movement.usesHistory = false;
  assert(!contextRuleIds(buyback).includes('ncaaf-spread-team-model-fade'));
});

test('NCAAF context rules require the saved evidence and reject weak, future or incomplete support', () => {
  const cases = [
    ['Total', 'market', example => { example.other.marketContext.bets = 69; example.selected.marketContext.bets = 31; }],
    ['Total', 'market', example => { example.other.signals.find(signal => signal.key === 'model').active = false; }],
    ['Total', 'market', example => { Object.assign(example.selected.signals.find(signal => signal.key === 'model'), { available: true, active: true }); }],
    ['Total', 'market', example => { example.other.teamTrend.score = 54; }],
    ['Total', 'market', example => { example.selected.marketContext.openingLine = example.selected.line; }],
    ['Total', 'team', example => { example.selected.teamTrend.teams[1].records.recent.wins = 3; }],
    ['Total', 'team', example => { example.selected.teamTrend.teams[1].missingGames = 1; }],
    ['Spread', 'spread', example => { example.other.modelContext.reason = 'Morning model preview only.'; }],
    ['Spread', 'spread', example => { example.other.modelContext.projection = example.other.line - 2; }],
    ['Spread', 'sos', example => { example.selected.sosContext.gap = 49; }],
    ['Spread', 'sos', example => { example.selected.sosContext.capturedAt = iso(now + 1); }],
    ['Spread', 'sos', example => { example.selected.teamTrend.capturedAt = iso(now + 1); }],
    ['Spread', 'sos', example => { example.selected.teamTrend = null; }],
  ];
  const ids = { market: 'ncaaf-total-market-conflict', team: 'ncaaf-total-team-model-fade',
    spread: 'ncaaf-spread-team-model-fade', sos: 'ncaaf-underdog-sos-team-form' };
  for (const [market, kind, mutate] of cases) {
    const example = contextPair(market, kind); mutate(example);
    assert(!contextRuleIds(example).includes(ids[kind]), `${kind} accepted invalid evidence`);
  }
});

test('a promoted NCAAF ATS context has priority when the same game also has a conflicting total case', () => {
  const spread = contextPair('Spread', 'spread'), total = contextPair('Total', 'market');
  const sides = [spread, total].flatMap(example => {
    const quotes = rules.situationMarketQuotes(example.pair, 'NCAAF', now);
    return example.pair.map((side, i) => ({ ...side, situationQuote: quotes[i] }));
  });
  const policy = rules.reviewSituationRules('NCAAF', date, now, undefined, []);
  policy.rules = policy.rules.map(rule => ({ ...rule,
    active: ['ncaaf-spread-team-model-fade', 'ncaaf-total-market-conflict'].includes(rule.id) }));
  const picks = rules.situationWinners(sides, policy, now);
  assert.equal(picks.length, 1);
  assert.equal(picks[0].id, spread.selected.id);
});

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
  assert.equal(next.rules.find(rule => rule.id === first.situationRuleId).decided, 1);
  assert.equal(next.rules.find(rule => rule.id === first.situationRuleId).netUnits, 0.91);
  db.close();
});
