const { test } = require('node:test');
const assert = require('node:assert/strict');
const { api, game, history, plain } = require('./selection-trial-fixtures.cjs');
const date = '2026-11-04', current = api.trialDayStart(date) + 17.75 * 3600000;
const model = () => api.buildTrialModel('NBA', date, history(), current);

test('Eastern midnight handles both DST changes and rejects invalid dates', () => {
  assert.equal(new Date(api.trialDayStart('2026-11-01')).toISOString(), '2026-11-01T04:00:00.000Z');
  assert.equal(new Date(api.trialDayStart('2026-11-02')).toISOString(), '2026-11-02T05:00:00.000Z');
  assert.equal(new Date(api.trialDayStart('2026-03-08')).toISOString(), '2026-03-08T05:00:00.000Z');
  assert.equal(new Date(api.trialDayStart('2026-03-09')).toISOString(), '2026-03-09T04:00:00.000Z');
  assert.throws(() => api.trialDayStart('2026-02-31'));
});

test('expected profit uses frozen American prices and their vig-adjusted opposing baseline', () => {
  assert.equal(api.trialOdds('-110').profit, 100 / 110);
  assert.equal(api.trialOdds('+150').profit, 1.5);
  for (const invalid of ['', 'NaN', 'Infinity', '99', '0']) assert.equal(api.trialOdds(invalid), null);
  const cold = api.buildTrialModel('NBA', date, [], current);
  const decisions = api.buildTrialDecisions(cold, game(date), [], current);
  const e = decisions[0].estimates[0];
  assert.equal(e.probability, .5);
  assert(Math.abs(e.expectedRoi - (-1 / 22)) < 1e-12);
  assert(e.conservativeRoi < e.expectedRoi);
  assert.equal(decisions[0].pickId, null);
});

test('one market pair is one training game; duplicates and opposing sides cannot inflate support', () => {
  const input = history();
  const a = api.buildTrialModel('NBA', date, input, current);
  const b = api.buildTrialModel('NBA', date, [...input, ...input], current);
  assert.equal(a.models[0].games, 144);
  assert.equal(a.models[1].games, 144);
  assert.equal(a.id, b.id);
  assert.deepEqual(plain(a.models), plain(b.models));
});

test('sports with no SOS capture retain their original five-signal observations without invented votes', () => {
  const input = history().map(s => ({ ...s, signals: s.signals.filter(v => v.key !== 'sos') }));
  const m = api.buildTrialModel('NBA', date, input, current);
  assert.equal(m.models[0].games, 144);
  assert.equal(m.models[1].games, 144);
  assert.equal(m.rejectedSides, 0);
});

test('future dates, unknown result times, and late-known outcomes cannot enter a daily fit', () => {
  const input = history(), expected = model();
  const future = game(date, 99, { result: 'W', resultUpdated: new Date(current + 4 * 3600000).toISOString() });
  const late = game('2026-11-03', 88, { result: 'W', resultUpdated: new Date(api.trialDayStart(date) + 1).toISOString() });
  late.forEach((s, i) => s.result = i % 2 ? 'L' : 'W');
  const unknown = game('2026-11-03', 77, { result: 'W', resultUpdated: '' });
  const ambiguous = game('2026-11-03', 66, { result: 'W', resultUpdated: '2026-11-03T23:00:00' });
  const actual = api.buildTrialModel('NBA', date, [...input, ...future, ...late, ...unknown, ...ambiguous], current);
  assert.equal(actual.id, expected.id);
});

test('strongly correlated evidence and extreme market baselines fit stably without numerical overconfidence', () => {
  const input = history().map(s => ({ ...s, odds: ['Home', 'Over'].includes(s.side) ? '-10000' : '+10000' }));
  const m = api.buildTrialModel('NBA', date, input, current);
  assert(m.models.every(f => f.converged && f.beta.every(Number.isFinite)));
  assert(m.models.every(f => f.covariance.every(row => row.every(Number.isFinite))));
});

test('chronological calibration never trains a fold on labels learned after that fold starts', () => {
  const input = history(), cutoff = api.trialDayStart('2026-10-25');
  const delayed = input.filter(s => s.date === '2026-10-20').map(s => ({ ...s,
    resultUpdated: new Date(cutoff + 1).toISOString() }));
  const changed = input.filter(s => s.date !== '2026-10-20').concat(delayed);
  const normal = model(), lagged = api.buildTrialModel('NBA', date, changed, current);
  assert(lagged.models[0].calibrationGames < normal.models[0].calibrationGames);
  assert.equal(lagged.models[0].games, normal.models[0].games);
});

test('the policy needs separate training and calibration dates; a large single slate is insufficient', () => {
  const m = api.buildTrialModel('NBA', date, history(3, 60), current);
  assert.equal(m.models[0].games, 180);
  assert.equal(m.models[0].status, 'Collecting training history');
  assert.equal(m.models[0].calibrationGames, 0);
  assert.equal(api.buildTrialDecisions(m, game(date), [], current)[0].pickId, null);
});

test('probabilities are coherent across opposing sides and complete cards emit at most one pick', () => {
  const m = model(), sides = game(date);
  const result = api.buildTrialDecisions(m, sides, [sides[0].id], current);
  assert.equal(result.length, 1); assert.equal(result[0].estimates.length, 4);
  assert(result[0].pickId, 'Synthetic stable advantage earns a trial pick');
  assert.equal(result[0].incumbentId, sides[0].id);
  for (const market of ['Spread', 'Total']) {
    const estimates = result[0].estimates.filter(e => e.market === market);
    assert(Math.abs(estimates[0].probability + estimates[1].probability - 1) < 1e-12);
    assert(estimates.every(e => e.conservativeProbability < e.probability));
  }
  assert(result[0].estimates.find(e => e.id === result[0].pickId).conservativeRoi >= .02);
});

test('missing pairs, future models, backup quotes, replayed flags and conflicts cannot create decisions', () => {
  const m = model();
  assert.equal(api.buildTrialDecisions(m, game(date).slice(0, 2), [], current).length, 0);
  assert.equal(api.buildTrialDecisions({ ...m, createdAt: new Date(current + 1).toISOString() }, game(date), [], current).length, 0);
  for (const change of [{ lineSource: { name: 'Covers' } }, { researchOrigin: 'replay' }, { recorded: false }, { status: 'LIVE' },
    { snapshotAt: new Date(current + 1).toISOString() }, { odds: '' }, { line: 3.25 }, { signals: [null] }]) {
    const sides = game(date); Object.assign(sides[0], change);
    assert.equal(api.buildTrialDecisions(m, sides, [], current).length, 0, JSON.stringify(change));
  }
  const sides = game(date);
  assert.equal(api.buildTrialDecisions(m, [...sides, { ...sides[0], odds: '-115' }], [], current).length, 0);
  assert.equal(api.buildTrialDecisions(m, sides, [], current + 6 * 60000).length, 0, 'Cannot backfill after final window');
  assert.equal(api.buildTrialDecisions(m, sides, [], current + 60 * 60000).length, 0, 'Cannot backfill after tipoff');
});

test('settlement preserves the selected card, rejects changed quotes and ignores future or pregame labels', () => {
  const sides = game(date), decision = api.buildTrialDecisions(model(), sides, [sides[0].id], current)[0];
  const before = JSON.stringify(decision), settledAt = Date.parse(sides[0].gameTime) + 3 * 3600000;
  const outcomes = sides.map((s, i) => ({ ...s, result: i % 2 ? 'L' : 'W', resultUpdated: new Date(settledAt).toISOString() }));
  assert.equal(api.settleTrialDecision(decision, outcomes, settledAt - 1), decision);
  const settled = api.settleTrialDecision(decision, outcomes, settledAt);
  assert.equal(Object.keys(settled.outcomes).length, 4);
  assert.equal(JSON.stringify(decision), before, 'No mutation of original frozen object');
  assert.deepEqual(plain({ ...settled, outcomes: {} }), plain(decision));
  assert.equal(api.settleTrialDecision(decision, outcomes.map(s => ({ ...s, odds: '-115' })), settledAt), decision);
  assert.equal(api.settleTrialDecision(decision, outcomes.map(s => ({ ...s, resultUpdated: s.snapshotAt })), settledAt), decision);
  const record = api.trialRecord([settled], 'trial');
  assert.equal(record.settled, 1); assert.equal(record.assumedPrices, 1);
  assert.equal(record.pending, 0);
});

test('ROI excludes pending and includes pushes; original prices set the exact profit', () => {
  const sides = game(date), d = api.buildTrialDecisions(model(), sides, [], current)[0], id = d.pickId;
  const pick = d.estimates.find(e => e.id === id); pick.odds = '+150';
  const won = { ...d, outcomes: { [id]: { result: 'W', knownAt: '2026-11-05T02:00:00Z' } } };
  const lost = { ...d, outcomes: { [id]: { result: 'L', knownAt: '2026-11-05T02:00:00Z' } } };
  const push = { ...d, outcomes: { [id]: { result: 'P', knownAt: '2026-11-05T02:00:00Z' } } };
  const result = api.trialRecord([won, lost, push, d], 'trial');
  assert.equal(result.record, '1-1-1'); assert.equal(result.pending, 1);
  assert.equal(result.netUnits, .5); assert(Math.abs(result.roiPct - 100 / 6) < 1e-12);
});

test('all five sports retain separate model identity and MLB requires moneyline/total pairs', () => {
  for (const sport of ['MLB', 'NFL', 'NCAAF', 'NBA', 'NCAAM']) {
    const m = api.buildTrialModel(sport, date, [], current);
    assert.equal(m.sport, sport); assert(m.id.includes(`|${sport}|`));
    assert.deepEqual(plain(m.models.map(r => r.market)), sport === 'MLB' ? ['Moneyline', 'Total'] : ['Spread', 'Total']);
  }
});
