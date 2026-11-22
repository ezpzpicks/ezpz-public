const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { mergeNflPendingModelPlays: merge } = require('./load-typescript.cjs')(path.resolve(__dirname, '../lib/nflModelPlayDisplay.ts'));
const now = Date.parse('2026-11-22T17:00:00Z');
const kickoff = '2026-11-23T01:20:00Z';
const game = changes => ({ id: 'game|Spread', game: 'MIN at SF', gameTime: kickoff,
  market: 'Spread', pick: 'SF -3.0', grade: 'B Spread', projection: -7, line: -3, edge: 4,
  builtAt: '2026-11-22T13:00:00Z', quoteObservedAt: '', ...changes });
const prop = changes => ({ id: 'game|player|rushing', gameId: 'game', game: 'MIN at SF', gameTime: kickoff,
  player: 'Aaron Jones Sr.', team: 'MIN', market: 'Rushing Yards', projection: 80, line: 50.5,
  overOdds: -115, underOdds: -105, pick: 'Over 50.5', pickOdds: -115, probability: .7,
  grade: 'Strong', qualified: true, phase: 'early', builtAt: '', quoteObservedAt: '', lineSource: '', ...changes });

test('spreads, totals and props become normal model rows with the original lines and Pending status', () => {
  const rows = merge([], [game(), game({ market: 'Total', pick: 'Under 45', grade: 'Under', projection: 40, line: 45, edge: 5 })], [prop()], [], now);
  assert.equal(rows.length, 3);
  assert.ok(rows.every(row => row.pending && row.gameTime === kickoff));
  assert.deepEqual(Array.from(rows, row => row.role), ['Spread', 'Total', 'Player Prop • Rushing Yards']);
  assert.equal(rows[0].modelProjection, -7);
  assert.equal(rows[0].marketLine, -3);
  assert.equal(rows[0].marketOdds, '-110');
  assert.equal(rows[2].playerName, 'Aaron Jones Sr.');
  assert.equal(rows[2].propSide, 'Over');
  assert.equal(rows[2].propLine, 50.5);
  assert.equal(rows[2].propProjection, 80);
  assert.equal(rows[2].score, .7);
  assert.equal(rows[2].marketOdds, '-115');
});

test('final rows win across abbreviations, quote changes, and changed prop sides', () => {
  const finalSpread = { game: 'Minnesota Vikings @ San Francisco 49ers', role: 'Spread', play: 'MIN +4' };
  const finalProp = { game: 'Minnesota Vikings @ San Francisco 49ers', role: 'Player Prop • Rushing Yards',
    playerName: 'Aaron Jones Sr', propMarket: 'Rushing Yards', propSide: 'Under', propLine: 54.5 };
  const rows = merge([finalSpread, finalProp], [game()], [prop()], [], now);
  assert.equal(rows.length, 2);
  assert.strictEqual(rows[0], finalSpread);
  assert.strictEqual(rows[1], finalProp);
  assert.ok(rows.every(row => !row.pending));
});

test('a finalized nonqualifying game withdraws stale spread and total previews, retaining independent pending props', () => {
  const slate = [{ Game: 'Minnesota Vikings @ San Francisco 49ers', 'Build Phase': 'pregame', 'Spread Grade': 'Non-Edge Spread' }];
  const rows = merge([], [game(), game({ market: 'Total' })], [prop()], slate, now);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].playerName, 'Aaron Jones Sr.');
});

test('kickoff, final prop batches and nonqualifiers remove pending rows', () => {
  assert.equal(merge([], [game()], [prop()], [], Date.parse(kickoff)).length, 0);
  assert.equal(merge([], [], [prop({ qualified: false }), prop({ phase: 'pregame' }), prop({ gameTime: '' })], [], now).length, 0);
  assert.equal(merge([], [], [], [], now).length, 0);
});

test('separate markets and players coexist, while repeated previews are not duplicated', () => {
  const rows = merge([], [game(), game()], [prop(), prop(), prop({ player: 'Other Player' }), prop({ market: 'Receiving Yards' })], [], now);
  assert.equal(rows.length, 4);
});
