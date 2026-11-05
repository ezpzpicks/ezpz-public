const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const load = require('./load-typescript.cjs');
const { api, game, plain } = require('./selection-trial-fixtures.cjs');
const fade = load(path.resolve(__dirname, '../lib/selectionFade.ts'));
const date = '2026-11-04', now = api.trialDayStart(date) + 17.75 * 3600000;
const combination = 'Spread|Favorite|model+money+system>none|grouped';
const sides = () => game(date).map(s => ({ ...s, publicMatches: [{ signal: 'type-a' }, { signal: 'type-b' }] }));
function toy() {
  const m = fade.buildFadeTrialModel('NBA', date, [], now);
  m.baseModel.models.forEach(f => { f.beta = f.beta.map((_, i) => i === 0 && f.market === 'Spread' ? .7 : 0);
    f.covariance = f.covariance.map((row, i) => row.map((_, j) => i === j ? .001 : 0));
    Object.assign(f, { converged: true, games: 144, dates: 12 }); });
  m.models.forEach(f => {
    Object.assign(f, { calibrationGames: 80, calibrationDates: 8, validationGames: 80, validationDates: 8, rawTwoPercentGames: 40 });
    f.samples = Array.from({ length: 80 }, (_, i) => {
      const day = `2026-10-${20 + Math.floor(i / 10)}`;
      return { key: `${day}|${i}`, date: day, knownAt: api.trialDayStart(day) + 23 * 3600000,
        offset: 0, margin: .7, y: 0, rawRoi: .2, sourceWins: false, combination,
        publicTypeIds: ['type-a', 'type-b'] };
    });
  });
  return m;
}
function estimate(m, input = sides(), index = 1) {
  const pair = api.trialPairedMarkets(input, 'NBA', now).values.find(p => p.market === 'Spread');
  return fade.estimateFadeTrial(m, pair, input[index]);
}

test('signed calibration can learn fade, follow, and neutral without simply swapping historical win rates', () => {
  const negative = estimate(toy());
  assert.equal(negative.direction, 'Fade'); assert(negative.calibrationWeight < 0);
  assert(negative.probability > .6 && negative.probability < 1);
  assert(negative.eligible && negative.conservativeRoi >= .02);
  const follow = toy(); follow.models.forEach(f => f.samples.forEach(s => s.y = 1));
  const positive = estimate(follow);
  assert.equal(positive.direction, 'Follow'); assert.equal(positive.eligible, false);
  const neutral = toy(); neutral.models.forEach(f => f.samples.forEach((s, i) => s.y = i % 2));
  assert.equal(estimate(neutral).direction, 'Neutral');
});

test('negative calibration cannot turn parameter uncertainty into extra confidence', () => {
  const stable = estimate(toy());
  const uncertain = toy();
  uncertain.baseModel.models.forEach(f => f.covariance = f.covariance.map((row, i) => row.map((_, j) => Number(i === j))));
  const risky = estimate(uncertain);
  assert.equal(risky.probability, stable.probability);
  assert(risky.conservativeProbability < stable.conservativeProbability);
  assert.equal(risky.eligible, false);
  assert.match(risky.reasons.join(' '), /uncertainty/);
});

test('opposing probabilities complement, while both conservative probabilities include their own downside', () => {
  const m = toy(), input = sides(), a = estimate(m, input, 0), b = estimate(m, input, 1);
  assert(Math.abs(a.probability + b.probability - 1) < 1e-12);
  assert(a.conservativeProbability < a.probability);
  assert(b.conservativeProbability < b.probability);
  assert.equal(a.eligible, false, 'A raw candidate cannot be relabeled as its own fade');
});

test('each fade uses its own saved odds and integer-line push adjustment', () => {
  const input = sides(); input[1].odds = '-102';
  const e = estimate(toy(), input);
  assert(Math.abs(e.expectedRoi - (e.probability * 100 / 102 - (1 - e.probability))) < 1e-12);
  const m = toy(), integer = sides();
  integer[0].line = -4; integer[1].line = 4;
  m.baseModel.models[0].integerPushes = 2; m.baseModel.models[0].integerGames = 10;
  const push = estimate(m, integer);
  assert.equal(push.pushProbability, .05);
  assert(Math.abs(push.expectedRoi - .95 * (push.probability * 100 / 110 - (1 - push.probability))) < 1e-12);
  assert(Math.abs(push.sourceRawRoi - .95 * estimate(toy()).sourceRawRoi) < 1e-12, 'The raw entry threshold also accounts for pushes');
  input[1].odds = '-160'; assert.match(estimate(toy(), input).reasons.join(' '), /Price below/);
});

test('overlapping public matches count games once and sparse combinations use the broader estimate', () => {
  const full = estimate(toy());
  assert.equal(full.supportLevel, 'Public types');
  assert.equal(full.support.publicTypeGames, 80, 'Two matched public types are not 160 independent observations');
  const sparse = toy(); sparse.models.forEach(f => f.samples.slice(1).forEach(s => s.combination = 'unrelated'));
  const pooled = estimate(sparse);
  assert.equal(pooled.supportLevel, 'Sport and market');
  assert.equal(pooled.support.combinationGames, 1);
  assert.equal(pooled.support.publicTypeGames, 1);
  const source = sides()[0];
  assert.deepEqual(plain(fade.fadePublicTypeIds({ ...source, publicMatches: [{ signal: 'type-a', totals: { wins: 99999 } }, { signal: 'type-a' }] })), ['type-a']);
});

test('later calibration checks exclude late-known outcomes and their own result', () => {
  const rows = [];
  for (let day = 20; day <= 22; day++) for (let i = 0; i < 10; i++) {
    const d = `2026-10-${day}`;
    rows.push({ key: `${d}|${i}`, date: d, knownAt: api.trialDayStart(d) + 23 * 3600000,
      offset: 0, margin: 1, y: i % 2, rawRoi: .2, sourceWins: Boolean(i % 2), combination: 'toy', publicTypeIds: [] });
  }
  rows[20].knownAt = api.trialDayStart('2026-10-24') + 1;
  rows.push({ key: 'target', date: '2026-10-23', knownAt: api.trialDayStart('2026-10-23') + 23 * 3600000,
    offset: 0, margin: 1, y: 0, rawRoi: .2, sourceWins: false, combination: 'toy', publicTypeIds: [] });
  const before = fade.validateFadeCalibration(rows).find(r => r.key === 'target');
  const altered = rows.map((r, i) => i === 20 || r.key === 'target' ? { ...r, y: 1 } : { ...r });
  const after = fade.validateFadeCalibration(altered).find(r => r.key === 'target');
  assert(before.p > .5, 'The excluded late loss changes the balance of available earlier labels');
  assert.equal(after.p, before.p, 'Unavailable and target outcomes cannot change the target prediction');
});

test('live fade cards share original selection/quote settlement and cannot be attached with a future model', () => {
  const m = toy(), input = sides(), d = api.buildTrialDecisions(m.baseModel, input, [], now)[0];
  const before = JSON.stringify(m), card = fade.buildFadeDecision(m, d, input);
  assert(card.pickId); assert.equal(card.estimates.length, 4);
  assert.equal(JSON.stringify(m), before, 'Inference leaves frozen model data unchanged');
  assert.equal(fade.buildFadeDecision({ ...m, createdAt: new Date(now + 1).toISOString() }, d, input), null);
  const at = Date.parse(d.gameTime) + 3 * 3600000;
  const result = input.map((s, i) => ({ ...s, result: i % 2 ? 'W' : 'L', resultUpdated: new Date(at).toISOString() }));
  const frozen = { ...d, fadeComparison: card }, settled = api.settleTrialDecision(frozen, result, at);
  assert.deepEqual(plain(settled.fadeComparison), plain(card));
  assert.equal(api.trialRecord([settled], 'fade').settled, 1);
  assert.equal(api.trialRecord([d], 'fade').settled, 0, 'Legacy cards never become retrospective fade picks');
});

test('the three published replays reproduce from frozen inputs and ignore target-day results', () => {
  const fixture = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.resolve(__dirname, 'fixtures/selection-fade-replay-2026-11-04.json.gz'))));
  const report = require('../app/data/selection-fade-replay-2026-11-04.json');
  for (const sport of ['NBA', 'NCAAF']) {
    const model = fade.buildFadeTrialModel(sport, date, fixture.history[sport], api.trialDayStart(date));
    const altered = fixture.quotes[sport].map((s, i) => ({ ...s, result: i % 2 ? 'W' : 'L', resultUpdated: new Date(Date.parse(s.gameTime) + 3 * 3600000).toISOString() }));
    const withTargets = fade.buildFadeTrialModel(sport, date, [...fixture.history[sport], ...altered], api.trialDayStart(date));
    assert.equal(withTargets.id, model.id);
    for (const expected of report.results.filter(r => r.sport === sport)) {
      const input = altered.filter(s => s.game === expected.game), at = Math.max(...input.map(s => Date.parse(s.snapshotAt)));
      const pair = api.trialPairedMarkets(input, sport, at).values.find(p => p.market === 'Spread');
      const e = fade.estimateFadeTrial(model, pair, input.find(s => s.selection === expected.selection));
      assert(Math.abs(e.expectedRoi * 100 - expected.expectedRoiPct) < 1e-10);
      assert(Math.abs(e.conservativeRoi * 100 - expected.conservativeRoiPct) < 1e-10);
      assert.equal(e.eligible, expected.qualifies);
    }
  }
});
