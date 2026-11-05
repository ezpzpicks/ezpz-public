const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const { mlbTrialSides } = load(path.resolve(__dirname, '../lib/selectionTrialMlb.ts'));
const { api } = require('./selection-trial-fixtures.cjs');

test('MLB takes original quotes and raw strengths, never old probability/ranking or absent model votes', () => {
  const date = '2026-11-04';
  const raw = { gameKey: '123', game: 'Away @ Home', gameTime: '2026-11-05T00:00:00Z',
    frozenAt: '11/04/2026, 6:45:00 PM EST', snapshotStatus: 'FINAL_PREGAME', market: 'Total', side: 'Over',
    line: 8.5, openingLine: 8, odds: '-110', betsPct: 30, moneyPct: 65, score: 99, estimatedProbability: 99,
    signals: [{ signalType: 'Public Split', score: 100 }] };
  const over = mlbTrialSides([raw], date)[0];
  assert.equal(over.snapshotAt, '2026-11-04T23:45:00.000Z');
  assert.equal(over.signals.find(s => s.key === 'money').value, 35);
  assert.equal(over.signals.find(s => s.key === 'move').value, .5);
  assert.equal(over.signals.find(s => s.key === 'model').available, false);
  assert.equal(over.signals.find(s => s.key === 'system').available, false);
  assert.equal(over.estimatedProbability, undefined);
  const under = { ...raw, side: 'Under', betsPct: 70, moneyPct: 35 };
  const money = ['Away', 'Home'].map((side, i) => ({ ...raw, market: 'Moneyline', selectionTeam: side, odds: i ? '+120' : '-130', line: null }));
  const sides = mlbTrialSides([raw, under, ...money], date), now = Date.parse('2026-11-04T23:45:00Z');
  const model = api.buildTrialModel('MLB', date, [], now);
  const result = api.buildTrialDecisions(model, sides, [], now);
  assert.equal(result.length, 1); assert.equal(result[0].pickId, null);
  assert.equal(mlbTrialSides([{ ...raw, frozenAt: '11/04/2026, 5:45:00 PM EST' }], date).length, 0);
});
