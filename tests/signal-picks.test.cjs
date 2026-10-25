const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const api = load(path.resolve(__dirname, '../lib/signalPicks.ts'));
const mcp = load(path.resolve(__dirname, '../lib/ezpzMcpPicks.ts'));
const now = Date.parse('2026-10-25T18:00:00Z');
const keys = ['money', 'move', 'system', 'team', 'model'];
function side(active = ['move', 'model'], overrides = {}) {
  return { id: 'game|Total|Over', date: '2026-10-25', gameKey: '2026-10-25|dolphins|jets', game: 'MIA @ NYJ',
    gameTime: '2026-10-25T17:00:00Z', snapshotAt: '2026-10-25T16:45:00Z', status: 'FINAL_PREGAME', recorded: true,
    market: 'Total', side: 'Over', selection: 'Over 39.5', line: 39.5, odds: '-110', selected: false, candidate: false,
    signals: keys.map(key => ({ key, active: active.includes(key), available: true })), signalCount: active.length,
    sourceCount: 2, combination: active.join(' + '), result: '', resultUpdated: '', ...overrides };
}
test('NFL uses two signals; every other sport keeps three', () => {
  assert.equal(api.signalPickThreshold('NFL'), 2);
  for (const sport of ['NCAAF', 'NBA', 'MLB', 'NCAAM']) {
    assert.equal(api.signalPickThreshold(sport), 3);
    assert.equal(api.selectSignalEzpzPicks([side()], sport, now).length, 0);
    assert.equal(api.selectSignalEzpzPicks([side(['money', 'move', 'model'])], sport, now).length, 1);
  }
  assert.equal(api.selectSignalEzpzPicks([side()], 'NFL', now).length, 1);
});
test('frozen two-signal evidence is reusable without altering its old selected flag or votes', () => {
  const original = side(), before = JSON.stringify(original);
  const picks = api.selectSignalEzpzPicks([original], 'NFL', now);
  assert.equal(picks.length, 1);
  assert.equal(picks[0].selection, 'Over 39.5');
  assert.equal(JSON.stringify(original), before);
});
test('saved result replay uses the stored grade and rejects mismatched observation identities', () => {
  const original = side(undefined, { result: 'L' });
  const row = { Date: original.date, 'Pick Key': original.id, 'Policy Version': 'football-signals-2026-10-18-v1',
    'Details JSON': JSON.stringify(original), Result: 'W', 'Result Updated': '2026-10-25T21:00:00Z' };
  const picks = api.savedSignalPicks([row], 'NFL', original.date);
  assert.equal(picks.length, 1); assert.equal(picks[0].result, 'W'); assert.equal(picks[0].line, 39.5);
  assert.equal(api.savedSignalPicks([{ ...row, 'Pick Key': 'other' }], 'NFL', original.date).length, 0);
});
test('price, independent evidence, and verified final capture protections remain in effect', () => {
  assert.equal(api.selectSignalEzpzPicks([side(['money', 'move'])], 'NFL', now).length, 0);
  for (const change of [{ odds: '-151' }, { line: null }, { line: 0 }, { recorded: false },
    { status: 'MISSED_LOCK' }, { snapshotAt: '2026-10-25T17:01:00Z' }, { snapshotAt: '2026-10-25T16:00:00Z' },
    { signals: keys.map(key => ({ key, active: ['move', 'model'].includes(key), available: key !== 'model' })) }]) {
    assert.equal(api.selectSignalEzpzPicks([side(undefined, change)], 'NFL', now).length, 0, JSON.stringify(change));
  }
  assert.equal(api.selectSignalEzpzPicks([side(undefined, { odds: '-150' })], 'NFL', now).length, 1);
});
test('live previews need a valid future candidate; uncaptured final labels cannot become picks', () => {
  const live = side(undefined, { recorded: false, candidate: true, status: 'LIVE', gameTime: '2026-10-25T20:00:00Z' });
  assert.equal(api.selectSignalEzpzPicks([live], 'NFL', now).length, 1);
  for (const change of [{ candidate: false }, { gameTime: '2026-10-25T17:00:00Z' }, { result: 'W' }, { status: 'FINAL_PREGAME' }]) {
    assert.equal(api.selectSignalEzpzPicks([{ ...live, ...change }], 'NFL', now).length, 0);
  }
});
test('one pick per game uses signal count and never winning results to break ties', () => {
  const a = side(undefined, { result: 'W' }), b = side(undefined, { id: 'spread', market: 'Spread', result: 'L' });
  assert.equal(api.selectSignalEzpzPicks([a, a], 'NFL', now).length, 1);
  assert.equal(api.selectSignalEzpzPicks([a, b], 'NFL', now).length, 0);
  const stronger = side(['money', 'move', 'model'], { ...b, signalCount: 3,
    signals: keys.map(key => ({ key, active: ['money', 'move', 'model'].includes(key), available: true })) });
  const picks = api.selectSignalEzpzPicks([a, stronger], 'NFL', now);
  assert.equal(picks.length, 1); assert.equal(picks[0].id, 'spread');
});
test('posting feed names the signal pair, keeps its frozen quote, and has a separate stable identity', () => {
  const pick = api.signalPickForFeed(side(undefined, { marketContext: { history: ['large'] }, publicMatches: ['large'], teamGames: ['large'] }), 'NFL');
  assert.equal(api.isSignalFeedPick(pick, 'NFL'), true);
  assert.equal(pick.lockedAt, '2026-10-25T16:45:00Z');
  assert.equal(pick.marketContext, undefined);
  const output = mcp.normalizeMcpPick('NFL', pick, Date.parse('2026-10-25T16:46:00Z'));
  assert.equal(output.pickCategory, 'signals'); assert.equal(output.signalCount, 2); assert.equal(output.threshold, 2);
  assert.equal(output.eligibleForPosting, true); assert.equal(output.lastSeven, null);
  assert.match(output.pickType, /Line movement \+ Model edge/);
  assert.notEqual(mcp.stablePickId('NFL', pick), mcp.stablePickId('NFL', { ...pick, pickCategory: 'public_bet_trend' }));
  assert.equal(mcp.normalizeMcpPick('NFL', pick, now).eligibleForPosting, false);
});
