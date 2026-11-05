const { test } = require('node:test');
const assert = require('node:assert/strict');
const { api, game, plain } = require('./selection-trial-fixtures.cjs');
const date = '2026-11-04', now = api.trialDayStart(date) + 17.75 * 3600000;

function rejectedModel() {
  const m = api.buildTrialModel('NBA', date, [], now);
  m.models = m.models.map(f => ({ ...f, beta: f.beta.map((_, i) => i === 0 && f.market === 'Spread' ? .3 : 0),
    covariance: f.covariance.map(row => row.map(() => 0)), converged: true, games: 92, dates: 12,
    calibrationGames: 51, calibrationDates: 6, calibrationShrink: 0, outOfTimeBrier: .253,
    marketBrier: .25, status: 'No supported edge yet' }));
  return m;
}
function card(model = rejectedModel(), sides = game(date)) {
  return api.buildTrialDecisions(model, sides, [], now)[0];
}

test('a rejected raw candidate and its exact opposite freeze as paired controls with only one active signal', () => {
  const sides = game(date).map(s => ({ ...s, signals: s.signals.map(z => ({ ...z, active: s.side === 'Home' && z.key === 'system' })) }));
  const d = card(rejectedModel(), sides), p = d.paperComparison;
  assert.equal(d.pickId, null, 'Strict trial still passes');
  assert.equal(p.version, api.OPPOSITE_TRIAL_POLICY.version);
  assert.equal(p.rawPickId, sides[0].id);
  assert.equal(p.oppositePickId, sides[1].id);
  assert(p.rawEstimates.find(e => e.id === p.rawPickId).expectedRoi >= .02);
  assert(p.rawEstimates.find(e => e.id === p.oppositePickId).expectedRoi < 0,
    'Reversal does not pretend the original raw model assigned a profitable probability to the opposite');
  assert.equal(d.estimates.find(e => e.id === p.oppositePickId).probability, .5);
  assert.equal(p.validation.games, 51);
  assert.equal(api.trialRecord([d], 'raw').pending, 1);
  assert.equal(api.trialRecord([d], 'opposite').pending, 1);
});

test('uncertainty alone and an already-accepted candidate do not trigger a reversal', () => {
  const uncertain = rejectedModel();
  uncertain.models.forEach(f => { f.calibrationShrink = 1; f.status = 'Trial estimates available';
    f.covariance = f.covariance.map((row, i) => row.map((_, j) => Number(i === j))); });
  const d = card(uncertain);
  assert.equal(d.pickId, null);
  assert(d.paperComparison.rawPickId);
  assert.equal(d.paperComparison.oppositePickId, null);
  assert.match(d.paperComparison.reason, /uncertainty-only/);
  const accepted = rejectedModel();
  accepted.models.forEach(f => { f.calibrationShrink = 1; f.status = 'Trial estimates available'; });
  const good = card(accepted);
  assert(good.pickId);
  assert.equal(good.paperComparison.oppositePickId, null);
  assert.match(good.paperComparison.reason, /accepts/);
});

test('missing training dates, missing calibration, and failed fits are not evidence to oppose a candidate', () => {
  for (const changes of [{ dates: 3, status: 'Collecting training history' },
    { games: 39, status: 'Collecting training history' }, { converged: false, status: 'Model fit unavailable' },
    { calibrationGames: 0, calibrationDates: 0, status: 'Collecting calibration history' },
    { calibrationDates: 2, status: 'Collecting calibration history' }]) {
    const m = rejectedModel(); m.models.forEach(f => Object.assign(f, changes));
    const p = card(m).paperComparison;
    assert.equal(p.oppositePickId, null, JSON.stringify(changes));
    if (changes.dates || changes.games || changes.converged === false) assert.equal(p.rawPickId, null);
  }
});

test('zero calibration weight only triggers reversal when raw prediction error is worse than baseline', () => {
  for (const value of [null, .249, .25]) {
    const m = rejectedModel(); m.models.forEach(f => f.outOfTimeBrier = value);
    const p = card(m).paperComparison;
    assert(p.rawPickId);
    assert.equal(p.oppositePickId, null);
    assert.match(p.reason, /not worse/);
  }
});

test('only the highest raw candidate is used and reversal stays in its original market', () => {
  const m = rejectedModel(); m.models[1].beta[0] = .5;
  const sides = game(date), d = card(m, sides), p = d.paperComparison;
  assert.equal(p.rawPickId, sides[2].id);
  assert.equal(p.oppositePickId, sides[3].id);
  assert.equal(p.validation.market, 'Total');
  assert.equal(api.trialRecord([d], 'opposite').pending, 1);
});

test('positive raw estimates below +2% pass and the opposing quote has its own price cap', () => {
  const small = rejectedModel(); small.models[0].beta[0] = .13;
  const p = card(small).paperComparison;
  assert.equal(p.rawPickId, null); assert.equal(p.oppositePickId, null);
  const m = rejectedModel(), sides = game(date); m.models[0].beta[0] = .7;
  sides[1].odds = '-160';
  const expensive = card(m, sides).paperComparison;
  assert.equal(expensive.rawPickId, sides[0].id);
  assert.equal(expensive.oppositePickId, null);
  assert.match(expensive.reason, /price limit/);
});

test('paired records use frozen prices, preserve decisions through settlement, and exclude legacy cards', () => {
  const sides = game(date); sides[1].odds = '+150';
  const d = card(rejectedModel(), sides), p = d.paperComparison;
  assert.equal(p.oppositePickId, sides[1].id);
  const settledAt = Date.parse(d.gameTime) + 3 * 3600000;
  const results = sides.map((s, i) => ({ ...s, result: i % 2 ? 'W' : 'L', resultUpdated: new Date(settledAt).toISOString() }));
  const settled = api.settleTrialDecision(d, results, settledAt);
  assert.deepEqual(plain(settled.paperComparison), plain(p));
  assert.equal(api.trialRecord([settled], 'raw').netUnits, -1);
  assert.equal(api.trialRecord([settled], 'opposite').netUnits, 1.5);
  assert.equal(api.trialRecord([settled], 'opposite').roiPct, 150);
  const legacy = { ...settled }; delete legacy.paperComparison;
  assert.equal(api.trialRecord([legacy], 'opposite').settled, 0);
  assert.equal(api.trialRecord([legacy], 'raw').settled, 0);
  assert.equal(api.trialRecord([{ ...settled, paperComparison: { ...p, version: 'unknown' } }], 'opposite').settled, 0);
  assert.equal(api.settleTrialDecision(d, results.map(s => ({ ...s, odds: '-115' })), settledAt), d);
  const push = { ...d, outcomes: Object.fromEntries(d.estimates.map(e => [e.id, { result: 'P', knownAt: new Date(settledAt).toISOString() }])) };
  assert.equal(api.trialRecord([push], 'raw').record, '0-0-1');
  assert.equal(api.trialRecord([push], 'opposite').netUnits, 0);
});
