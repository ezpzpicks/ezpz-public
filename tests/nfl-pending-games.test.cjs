const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildNflPendingGames: build } = require('./load-typescript.cjs')(path.resolve(__dirname, '../lib/nflPendingGames.ts'));
const date = '2026-11-22', now = Date.parse(date + 'T16:00:00Z'), kickoff = date + 'T23:00:00Z';
const spread = 'nfl-independent-spread-v1-2026-11-22', total = 'nfl-total-tree4-unit-agreement-v1-2026-11-22';
const s = changes => ({ version: spread, ready: true, margin: 7, edge: 4, features: { market_margin: 3, market_total_centered: 0 }, ...changes });
const t = changes => ({ version: total, ready: true, tree_total: 40, regression_total: 43, edge: -5,
  regression_edge: -2, agreement: true, features: { market_total_centered: 0, market_margin: 3 }, ...changes });
const row = changes => ({ Date: date, 'Game ID': 'nflverse', Game: 'MIN at SF', 'Away Team': 'MIN', 'Home Team': 'SF',
  'Game Time': kickoff, 'Build Phase': 'early', 'Build At': date + 'T13:07:00Z', 'Quote Observed At': date + 'T13:05:00Z',
  'Market Home Spread': '-3', 'Market Total': '45', 'Spread Grade': 'B Spread', 'Spread Pick': 'SF -3.0',
  'Total Grade': 'Under', 'Total Pick': 'Under 45.0', 'Spread Model Version': spread, 'Total Model Version': total,
  'Spread Model JSON': JSON.stringify(s()), 'Total Model JSON': JSON.stringify(t()), ...changes });

test('both markets appear as early pending qualifiers with the saved lines and full model gaps', () => {
  const plays = build([row()], [], date, now);
  assert.deepEqual(Array.from(plays, p => [p.market, p.grade, p.projection, p.line, p.edge]),
    [['Spread', 'B Spread', -7, -3, 4], ['Total', 'Under', 40, 45, 5]]);
  assert.equal(plays[0].quoteObservedAt, date + 'T13:05:00Z');
});

test('the exact 3.5/4 thresholds qualify; smaller gaps, A grades and disagreement cannot qualify', () => {
  const boundary = row({ 'Spread Model JSON': JSON.stringify(s({ margin: 6.5, edge: 3.5 })),
    'Total Model JSON': JSON.stringify(t({ tree_total: 41, edge: -4 })) });
  assert.equal(build([boundary], [], date, now).length, 2);
  assert.equal(build([row({ 'Spread Model JSON': JSON.stringify(s({ margin: 6.49, edge: 3.49 })),
    'Total Model JSON': JSON.stringify(t({ tree_total: 41.01, edge: -3.99 })) })], [], date, now).length, 0);
  assert.equal(build([row({ 'Spread Grade': 'A Spread', 'Total Model JSON': JSON.stringify(t({
    agreement: false, regression_total: 46, regression_edge: 1 })) })], [], date, now).length, 0);
});

test('finalization withdraws previews even when the final model no longer qualifies and IDs change', () => {
  const final = { ...row(), 'Game ID': 'espn', Game: 'Minnesota Vikings @ San Francisco 49ers',
    'Build Phase': 'pregame', 'Spread Grade': 'Non-Edge Spread', 'Total Grade': 'Non-Edge Total' };
  assert.equal(build([row()], [final], date, now).length, 0);
});

test('legacy models, malformed evidence and changed paired lines remain excluded', () => {
  assert.equal(build([row({ 'Spread Model Version': 'legacy' })], [], date, now).length, 0);
  assert.equal(build([row({ 'Spread Model JSON': '{', 'Total Model JSON': 'null' })], [], date, now).length, 0);
  assert.equal(build([row({ 'Market Home Spread': '-4', 'Market Total': '46' })], [], date, now).length, 0);
  assert.equal(build([row({ 'Market Total': '46' })], [], date, now).length, 0);
  assert.equal(build([row({ 'Market Home Spread': '-4' })], [], date, now).length, 0);
});

test('started games and other dates cannot remain pending; the latest saved batch wins', () => {
  assert.equal(build([row()], [], date, Date.parse(kickoff)).length, 0);
  assert.equal(build([row({ Date: '2026-11-21' })], [], date, now).length, 0);
  const latest = row({ 'Build At': date + 'T14:00:00Z' });
  const plays = build([latest, row()], [], date, now);
  assert.equal(plays.length, 2); assert.equal(plays[0].builtAt, latest['Build At']);
});
