const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { evaluateSignalMovement } = require('./load-typescript.cjs')(path.resolve(__dirname, '../lib/signalMovement.ts'));

test('selected-side point movement is correct for favorites, dogs, Over and Under', () => {
  for (const [market, side, openingLine, line, expected] of [
    ['Spread', 'DAL', -4, -4.5, .5], ['Spread', 'PHI', 4, 4.5, -.5],
    ['Spread', 'DAL', 1, -.5, 1.5], ['Total', 'Over', 220, 221, 1], ['Total', 'Under', 220, 221, -1],
    ['Total', 'Under', 221, 220, 1], ['Spread', 'DAL', 0, -.5, .5],
  ]) {
    const move = evaluateSignalMovement({ market, side, openingLine, line });
    assert.equal(move.value, expected); assert.equal(move.active, expected >= .5);
  }
});

test('flat, insufficient and missing line movement cannot gain a vote from odds or null coercion', () => {
  for (const line of [4, 3.75, null, '']) {
    const move = evaluateSignalMovement({ market: 'Spread', side: 'DAL', openingLine: 4, line,
      openingOdds: '+120', odds: '-140', retainedBasis: 'Implied Probability', retainedValue: 16.2, retainedLabel: 'Line Movement Confirmation' });
    assert.equal(move.active, false);
    assert.equal(move.available, line != null && line !== '');
  }
});

test('only retained point movement at a returned opening line is eligible history evidence', () => {
  const input = { market: 'Spread', side: 'DAL', openingLine: -4.5, line: -4.5,
    retainedBasis: 'Spread Line History', retainedValue: .5, retainedLabel: 'Line Movement Confirmation' };
  assert.equal(evaluateSignalMovement(input).active, true);
  assert.equal(evaluateSignalMovement(input).usesHistory, true);
  assert.equal(evaluateSignalMovement({ ...input, retainedBasis: 'Implied Probability' }).active, false);
  assert.equal(evaluateSignalMovement({ ...input, line: -4 }).active, false, 'an adverse net move cannot be replaced by favorable history');
});
