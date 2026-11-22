const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const api = require('./load-typescript.cjs')(path.resolve(__dirname, '../lib/nflPlayerProps.ts'));
const date = '2026-11-22', kickoff = date + 'T23:00:00Z';
const row = changes => ({ Date: date, 'Game ID': 'game', Game: 'CHI at GB', 'Game Time': kickoff,
  Player: 'Test Player', Team: 'CHI', Market: 'Receptions', Projection: '6', 'Market Line': '3.5',
  'Pick Odds': '-115', 'Over Odds': '-115', 'Under Odds': '-105', Pick: 'Over 3.5', Grade: 'B Prop',
  'Build Phase': 'early', 'Build At': date + 'T13:07:00Z', ...changes });

test('morning graded props are visible as pending with original prices and times', () => {
  const [prop] = api.buildNflPlayerProps([], [row()], date);
  assert.equal(prop.phase, 'early'); assert.equal(prop.qualified, true);
  assert.equal(prop.line, 3.5); assert.equal(prop.pickOdds, -115);
  assert.equal(prop.builtAt, date + 'T13:07:00Z');
  assert.equal(api.upcomingNflProps([prop], Date.parse(date + 'T16:00:00Z'), true).length, 1);
});

test('finalization replaces the entire early game batch, including removed players', () => {
  const early = [row(), row({ Player: 'Removed Player' })];
  const props = api.buildNflPlayerProps([row({ 'Build Phase': 'pregame', 'Market Line': '4.5' })], early, date);
  assert.equal(props.length, 1); assert.equal(props[0].line, 4.5); assert.equal(props[0].phase, 'pregame');
  assert.equal(api.upcomingNflProps(props, Date.parse(date + 'T16:00:00Z'), true).length, 0);
  assert.equal(api.upcomingNflProps(props, Date.parse(date + 'T16:00:00Z')).length, 1);
});

test('upcoming only excludes started, unknown kickoff and ungraded props', () => {
  const props = api.buildNflPlayerProps([], [row(), row({ Player: 'No kickoff', 'Game Time': '' }),
    row({ Player: 'Ungraded', Grade: 'No market line', 'Market Line': '' })], date);
  assert.equal(api.upcomingNflProps(props, Date.parse(kickoff)).length, 0);
  assert.equal(api.upcomingNflProps(props, Date.parse(date + 'T16:00:00Z')).length, 1);
  const missing = props.find(p => p.player === 'Ungraded');
  assert.equal(missing.line, null);
});

test('date partitions and current yardage tiers remain strict', () => {
  const props = api.buildNflPlayerProps([], [row({ Date: '2026-11-21' }), row({ Market: 'Rushing Yards',
    Projection: '70', 'Market Line': '50', 'Probability Edge': '.20', 'Projection Edge': '20' })], date);
  assert.equal(props.length, 1); assert.equal(props[0].grade, 'Regular');
  assert.equal(api.nflPropDisplayGrade(row({ Market: 'Rushing Yards', Projection: '55',
    'Market Line': '50', 'Probability Edge': '.40', 'Projection Edge': '5' })), 'Non-Edge');
  assert.equal(api.nflPropDisplayGrade(row({ Grade: 'Injury hold', Market: 'Rushing Yards',
    Projection: '100', 'Market Line': '50', 'Probability Edge': '.40' })), 'Injury hold');
  assert.equal(api.validNflPropsDate('2026-02-30'), false); assert.equal(api.validNflPropsDate(date), true);
});
