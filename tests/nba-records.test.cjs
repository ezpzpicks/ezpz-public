const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const api = load(path.resolve(__dirname, '../lib/nbaRecords.ts'));
const date = '2026-10-23', tipoff = date + 'T23:00:00Z', now = Date.parse('2026-10-24T04:00:00Z');
const forecast = (overrides = {}) => ({ gameId: '1', modelVersion: 'nba-live', tipoff, lockedAt: date + 'T22:30:00Z',
  away_team: 'Cleveland Cavaliers', home_team: 'Philadelphia 76ers', fair_home_spread: -6, home_spread_edge: 2.5,
  total: 229, total_edge: 8.5, spread_pick: 'Philadelphia 76ers -3.5', spread_grade: 'B', total_pick: 'Over 220.5', total_grade: 'A',
  market: { home_spread: -3.5, total: 220.5 }, spreadResult: 'WIN', totalResult: 'LOSS', ...overrides });

test('official records use the latest pre-tipoff run once per game, never a winning early alternative', () => {
  const early = forecast({ phase: 'early', lockedAt: date + 'T15:00:00Z', spreadResult: 'WIN', totalResult: 'WIN' });
  const pregame = forecast({ phase: 'pregame', totalResult: 'LOSS' });
  for (const input of [[early, pregame, early], [pregame, early]]) {
    const plays = api.nbaModelPlays(input, [], now);
    assert.equal(plays.length, 2);
    assert.equal(plays.find(row => row.market === 'Total').result, 'L');
    assert(plays.every(row => row.lockedAt === pregame.lockedAt));
  }
  assert.equal(api.nbaModelPlays([forecast({ lockedAt: tipoff })], [], now).length, 0);
  assert.equal(api.nbaModelPlays([forecast({ lockedAt: '2027-01-01T00:00:00Z' })], [], now).length, 0);
});

test('A/B records exclude Lean, Pass, missing lines and a pick with a mismatched saved market', () => {
  assert.equal(api.nbaModelPlays([forecast({ spread_grade: 'Lean', total_grade: 'Pass' })], [], now).length, 0);
  assert.equal(api.nbaModelPlays([forecast({ market: null })], [], now).length, 0);
  const plays = api.nbaModelPlays([forecast({ spread_pick: 'Philadelphia 76ers -7.5' })], [], now);
  assert.equal(plays.length, 1); assert.equal(plays[0].market, 'Total');
});

test('official final scores settle saved lines including overtime, while missing or mismatched results stay pending', () => {
  const f = forecast({ spreadResult: 'PENDING', totalResult: 'PENDING' });
  const game = { Date: date, 'Game ID': '1', 'Game Time': tipoff, 'Away Team': f.away_team, 'Home Team': f.home_team,
    Completed: 'TRUE', Status: 'STATUS_FINAL', 'Away Score': '110', 'Home Score': '118', 'Result Updated': '2026-10-24T02:00:00Z' };
  const results = api.nbaModelPlays([f], [game], now);
  assert(results.every(row => row.result === 'W'));
  for (const changed of [{ Completed: 'FALSE' }, { 'Home Team': 'Los Angeles Lakers' }, { 'Result Updated': '2027-01-01T00:00:00Z' }, { 'Away Score': '' }]) {
    assert(api.nbaModelPlays([f], [{ ...game, ...changed }], now).every(row => row.result === ''));
  }
});

test('record arithmetic excludes pending plays from ROI and pushes from win rate', () => {
  const totals = api.nbaRecordTotals([{ result: 'W' }, { result: 'W' }, { result: 'L' }, { result: 'P' }, { result: '' }]);
  assert.equal(totals.record, '2-1-1'); assert.equal(totals.pending, 1);
  assert.equal(totals.winPct, 66.67); assert.equal(totals.unitsWon, .82); assert.equal(totals.roiPct, 20.45);
  assert.equal(api.nbaRecordTotals([]).winPct, null); assert.equal(api.nbaRecordTotals([]).roiPct, null);
});

test('daily rollups are idempotent, keep earlier results, and calculate seven Eastern calendar days without rounding drift', () => {
  const first = api.updateNbaModelRecords(undefined, [forecast()], [], now);
  const repeated = api.updateNbaModelRecords(first, [forecast()], [], now, [date]);
  assert.deepEqual(repeated, first);
  const next = api.updateNbaModelRecords(first, [forecast({ gameId: '2', tipoff: '2026-10-24T23:00:00Z', lockedAt: '2026-10-24T14:00:00Z' })], [], now + 86400000, ['2026-10-24']);
  assert.equal(next.recent.length, 4);
  const totals = api.summarizeNbaModelRecords(next, '2026-10-24');
  assert.equal(totals.overall.record, '2-2-0'); assert.equal(totals.overall.unitsWon, -.18);
  assert.equal(totals.byType.find(row => row.label === 'B Spread').overall.record, '2-0-0');
  const later = api.summarizeNbaModelRecords(next, '2026-10-30');
  assert.equal(later.last7Days.record, '1-1-0');
  assert.equal(later.overall.record, '2-2-0');
});

test('EZPZ uses the shared 2+ NBA threshold, deduplicates games and does not break ties by results', () => {
  const base = { id: 'spread', date, game: 'Cleveland Cavaliers @ Philadelphia 76ers', signalCount: 2, result: 'W', odds: '-110' };
  assert.equal(api.nbaEzpzSelections([{ ...base, signalCount: 1 }]).length, 0);
  assert.equal(api.nbaEzpzSelections([base, base]).length, 1);
  assert.equal(api.nbaEzpzSelections([base, { ...base, id: 'total', result: 'L' }]).length, 0);
  const picks = api.nbaEzpzSelections([base, { ...base, id: 'total', signalCount: 4, result: 'L' }]);
  assert.equal(picks.length, 1); assert.equal(picks[0].id, 'total');
});
