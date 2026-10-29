const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const api = load(path.resolve(__dirname, '../lib/signalCombinationResearch.ts'));
const policy = 'frozen-policy-v1', kickoff = Date.parse('2026-10-24T00:00:00Z'), now = kickoff + 4 * 3600000;
const iso = n => new Date(n).toISOString();
const plain = x => JSON.parse(JSON.stringify(x));
function side(id, keys = ['model', 'system'], changes = {}) {
  return { id, date: '2026-10-23', market: 'Total', line: 50.5, odds: '-110', recorded: true,
    status: 'FINAL_PREGAME', snapshotAt: iso(kickoff - 15 * 60000), gameTime: iso(kickoff), policyVersion: policy,
    signalCount: keys.length, signals: api.RESEARCH_SIGNAL_KEYS.map(key => ({ key, active: keys.includes(key), available: true })),
    result: '', resultUpdated: '', ...changes };
}
function report(sides, at = now) { return api.buildSignalResearchReport('NCAAF', policy, api.buildSignalResearchDays(sides, policy, at)); }
const view = (sides, market = 'Total', phase = 'all') => api.signalResearchView(report(sides), market, phase);
const completed = (result, odds = '-110') => ({ result, odds, resultUpdated: iso(now - 1000) });

test('tile records use the exact active set, including zero and one, with separate markets', () => {
  const values = [side('zero', [], completed('L')), side('one', ['model'], completed('P')),
    side('pair', ['move', 'sos'], completed('W')), side('pending', ['move', 'sos']),
    side('triple', ['move', 'sos', 'money'], completed('L')),
    side('spread', ['move', 'sos'], { ...completed('L'), market: 'Spread', line: -14 }),
    side('earlier', ['move', 'sos'], { ...completed('P'), snapshotAt: '2026-10-23T20:45:00Z', gameTime: '2026-10-23T21:00:00Z' })];
  const research = report(values);
  const lookup = keys => api.signalCombinationRecord(research, 'Total', side('live', keys).signals.reverse());
  assert.equal(lookup([]).record, '0-1-0');
  assert.equal(lookup(['model']).record, '0-0-1');
  const pair = lookup(['sos', 'move']);
  assert.equal(pair.combination, 'move+sos');
  assert.equal(pair.record, '1-0-1');
  assert.equal(pair.pending, 1);
  assert.equal(api.signalCombinationRecord(research, 'Spread', side('live', ['move', 'sos']).signals).record, '0-1-0');
  assert.equal(lookup(['money']).samples, 0);
  assert.equal(api.signalCombinationRecord(undefined, 'Spread', []), null);
});

test('all frozen sides supply baselines and exact two/three-signal cohorts without creating picks', () => {
  const values = [side('zero', []), side('one', ['model']), side('two'), side('three', ['system', 'money', 'model'])];
  const result = view(values);
  assert.deepEqual(plain(result.counts.map(row => row.record.samples)), [1, 1, 1, 1]);
  assert.deepEqual(plain(result.exact.map(row => row.signalCount).sort()), [2, 3]);
  assert.equal(result.exact.find(row => row.signalCount === 2).combination, 'system+model');
  assert.equal(result.individual.find(row => row.key === 'model').record.samples, 3);
  assert.equal(result.total.roiPct, null);
  assert(values.every(value => !Object.hasOwn(value, 'selected')), 'research does not mutate observations or select bets');
});

test('ROI risks one unit at each frozen price, includes pushes and excludes pending outcomes', () => {
  const result = view([side('w1', undefined, completed('W')), side('w2', undefined, completed('W', '+150')),
    side('loss', undefined, completed('L', '-150')), side('push', undefined, completed('P')), side('pending')]);
  assert.equal(result.total.record, '2-1-1');
  assert.equal(result.total.pending, 1); assert.equal(result.total.settled, 4);
  assert.equal(result.total.netUnits, 1.41); assert.equal(result.total.roiPct, 35.23);
  assert.equal(result.total.winPct, 66.67);
});

test('live, missing, invalid, future, outside-window, over-cap, and changed-policy evidence cannot enter research', () => {
  const invalid = [{ recorded: false }, { status: 'LIVE' }, { line: null }, { line: NaN }, { line: -1 },
    { odds: '' }, { odds: '-151' }, { odds: 'Infinity' }, { snapshotAt: iso(now + 1) },
    { snapshotAt: iso(kickoff - 9 * 60000) }, { snapshotAt: iso(kickoff - 21 * 60000) },
    { policyVersion: 'different-policy' }, { policyVersion: undefined }, { signalCount: 3 },
    { signals: [{ key: 'model', active: true, available: false }], signalCount: 1 },
    { signals: [{ key: 'invented', active: true, available: true }], signalCount: 1 }];
  assert.equal(view(invalid.map((change, i) => side(String(i), undefined, change))).total.samples, 0);
});

test('unavailable inactive signals do not count as matches, and future/pre-game results stay pending', () => {
  const value = side('available', ['model']);
  value.signals.find(signal => signal.key === 'team').available = false;
  assert.equal(view([value]).counts.find(row => row.label === '1').record.samples, 1);
  const result = view([side('future', undefined, { result: 'W', resultUpdated: iso(now + 1) }),
    side('early', undefined, { result: 'W', resultUpdated: iso(kickoff - 1) }), side('undated', undefined, { result: 'W' })]);
  assert.equal(result.total.pending, 3); assert.equal(result.total.settled, 0); assert.equal(result.total.roiPct, null);
});

test('research retains historical and forward phases separately at the captured decision time', () => {
  const cutoff = Date.parse(api.SIGNAL_RESEARCH_FORWARD_AT);
  const values = [-1, 0].map((delta, i) => side(String(i), undefined, {
    snapshotAt: iso(cutoff + delta), gameTime: iso(cutoff + delta + 15 * 60000) }));
  assert.equal(view(values, 'Total', 'history').total.samples, 1);
  assert.equal(view(values, 'Total', 'forward').total.samples, 1);
  assert.equal(view(values).total.samples, 2);
});

test('spread/total comparisons are separate and exact pairs exclude triples', () => {
  const result = report([side('total-pair'), side('total-triple', ['money', 'model', 'system']), side('spread', ['model'], { market: 'Spread', line: -3 })]);
  const total = api.signalResearchView(result, 'Total'), spread = api.signalResearchView(result, 'Spread');
  assert.equal(total.total.samples, 2); assert.equal(spread.total.samples, 1);
  assert.equal(total.exact.find(row => row.signalCount === 2).record.samples, 1);
  assert.equal(total.individual.find(row => row.key === 'model').record.samples, 2);
});

test('duplicate settlement updates count once; conflicting original decisions are excluded', () => {
  const original = side('same'), settled = { ...original, ...completed('W') };
  assert.equal(view([original, settled, settled]).total.samples, 1);
  assert.equal(view([settled, original]).total.record, '1-0-0');
  assert.equal(view([{ ...original, result: 'W' }, settled]).total.record, '1-0-0');
  assert.equal(view([settled, { ...settled, result: 'L', resultUpdated: iso(now + 1) }]).total.record, '1-0-0');
  assert.equal(view([original, { ...settled, line: 51.5 }]).total.samples, 0);
  assert.equal(view([original, { ...settled, odds: '-120' }]).total.samples, 0);
});

test('daily replacement is idempotent and a later result correction replaces rather than appends', () => {
  const value = side('a'), days = api.buildSignalResearchDays([value], policy, now);
  Object.assign(days, api.buildSignalResearchDays([{ ...value, ...completed('W') }], policy, now));
  Object.assign(days, api.buildSignalResearchDays([{ ...value, ...completed('W') }], policy, now));
  let result = api.signalResearchView(api.buildSignalResearchReport('NBA', policy, days), 'Total');
  assert.equal(result.total.samples, 1); assert.equal(result.total.record, '1-0-0');
  Object.assign(days, api.buildSignalResearchDays([{ ...value, ...completed('L') }], policy, now));
  result = api.signalResearchView(api.buildSignalResearchReport('NBA', policy, days), 'Total');
  assert.equal(result.total.samples, 1); assert.equal(result.total.record, '0-1-0'); assert.equal(result.total.netUnits, -1);
});

test('assumed and unknown price provenance stay visible; old rollup policies cannot mix with current rules', () => {
  const values = [side('assumed', undefined, { oddsAssumed: true }), side('unknown'), side('observed', undefined, { oddsAssumed: false })];
  const days = api.buildSignalResearchDays(values, policy, now);
  days.old = { ...days['2026-10-23'], policyVersion: 'old-rules' };
  const result = api.signalResearchView(api.buildSignalResearchReport('NFL', policy, days), 'Total');
  assert.equal(result.total.samples, 3); assert.equal(result.total.assumedPrices, 1); assert.equal(result.total.unknownPrices, 1);
});
