const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '..');
const catalog = load(path.join(root, 'lib/footballTrendCatalog.ts'));
const defs = load(path.join(root, 'lib/catalog/nflConsolidatedCatalog.ts'));
const grouped = load(path.join(root, 'lib/nflConsolidatedTrends.ts'));
const replay = load(path.join(root, 'lib/nflConsolidatedResearch.ts'));
const research = load(path.join(root, 'lib/signalCombinationResearch.ts'));
const plain = value => JSON.parse(JSON.stringify(value));
function row(i, result = 'W', changes = {}) {
  return { Date: '2026-10-25', Game: `Visitor${i} @ Host${i}`, 'Game Time': '2026-10-25T17:00:00Z',
    'Away Team': `Visitor${i}`, 'Home Team': `Host${i}`, Market: 'Total', Side: 'Over', Selection: 'Over',
    'Public Split Selection': 'Over', 'Public Split Line': '44.5', Line: '44.5', 'Public Split Odds': '-110', Odds: '-110',
    'Snapshot Status': 'FINAL_PREGAME', 'Record Snapshot Policy': 'verified-final-snapshot-v1',
    'Public Split Snapshot Time': '2026-10-25T16:45:00Z', 'Result Updated': '2026-10-25T21:00:00Z', Result: result,
    'Catalog Membership JSON': JSON.stringify({ version: catalog.footballCatalog('NFL').version,
      memberships: [{ pair: 'total-increase-any-total', direction: 0, filters: [] }], missing: [], ambiguous: [] }), ...changes };
}
test('the active NFL catalog has 96 unique types and no incidental subset variants', () => {
  assert.equal(defs.NFL_CONSOLIDATED_TYPES.length, 96);
  assert.equal(new Set(defs.NFL_CONSOLIDATED_TYPES.map(x => x.id)).size, 96);
  assert(defs.NFL_CONSOLIDATED_TYPES.every(x => x.pairs.every(pair => catalog.footballCatalog('NFL').rules.some(rule => rule.id === pair))));
});
test('nested memberships and duplicate rows contribute one game, and different threshold bands pool', () => {
  const memberships = [{ pair: 'total-increase-any-total', direction: 0, filters: ['half-point-quote'] },
    { pair: 'nfl-market-move-hour-total', direction: 0, filters: ['sunday'] }];
  const first = row(1, 'W', { 'Catalog Membership JSON': JSON.stringify({ version: catalog.footballCatalog('NFL').version, memberships }) });
  const types = grouped.buildNflConsolidatedSubtypes([first, { ...first }, row(2, 'L')]);
  const rise = types.find(x => x.signal.includes(':total-rise-0-over'));
  assert.equal(rise.totals.record, '1-1-0');
  assert.equal(rise.totals.totalBets, 2);
});
test('spread aliases deduplicate and selected line-support roles stay separate', () => {
  const membership = JSON.stringify({ version: catalog.footballCatalog('NFL').version,
    memberships: [{ pair: 'spread-any-support-spread', direction: 0, filters: [] }] });
  const dog = row(1, 'W', { Game: 'DAL @ GB', 'Away Team': 'DAL', 'Home Team': 'GB', Market: 'Spread', Side: '',
    Selection: 'DAL', 'Public Split Selection': 'DAL', Line: '3.5', 'Public Split Line': '3.5', 'Catalog Membership JSON': membership });
  const alias = { ...dog, Game: 'Dallas Cowboys at Green Bay Packers', 'Away Team': 'Dallas Cowboys', 'Home Team': 'Green Bay Packers',
    Selection: 'Dallas Cowboys', 'Public Split Selection': 'Dallas Cowboys' };
  const favorite = { ...dog, Selection: 'GB', 'Public Split Selection': 'GB', Line: '-3.5', 'Public Split Line': '-3.5', Result: 'L' };
  const types = grouped.buildNflConsolidatedSubtypes([dog, alias, favorite]);
  assert.equal(types.find(x => x.category === 'Underdog Spread').totals.record, '1-0-0');
  assert.equal(types.find(x => x.category === 'Favorite Spread').totals.record, '0-1-0');
});
test('ranking requires eight decisions, above 60% wins, at least 10% unrounded ROI and excludes identical samples', () => {
  const stats = grouped.buildNflConsolidatedSubtypes(Array.from({ length: 10 }, (_, i) => row(i, i < 7 ? 'W' : 'L')))[0];
  const lowRoi = { ...stats, id: 'low', sampleKey: 'low', totals: { ...stats.totals, netUnits: .9999, roiPct: 10 } };
  const tiny = { ...stats, id: 'tiny', sampleKey: 'tiny', totals: { ...stats.totals, wins: 7, losses: 0, totalBets: 7 } };
  const exact60 = { ...stats, id: '60', sampleKey: '60', totals: { ...stats.totals, wins: 6, losses: 4 } };
  const result = grouped.rankNflConsolidatedSubtypes([stats, { ...stats, id: 'alias' }, lowRoi, tiny, exact60]);
  assert.equal(result.length, 1);
  assert.equal(result[0].totals.record, '7-3-0');
});
test('future settlements, preseason quotes and missing observed prices do not enter the ranking', () => {
  const rows = Array.from({ length: 8 }, (_, i) => row(i));
  const before = Date.parse('2026-10-25T20:00:00Z');
  assert.equal(grouped.buildNflConsolidatedLeaderboard(rows, before).length, 0);
  assert.equal(grouped.buildNflConsolidatedLeaderboard(rows, before + 7200000).length, 1);
  assert.equal(grouped.buildNflConsolidatedSubtypes(rows.map(r => ({ ...r, Date: '2026-08-27' }))).length, 0);
  assert.equal(grouped.buildNflConsolidatedSubtypes(rows.map(r => ({ ...r, Odds: '', 'Public Split Odds': '' }))).length, 0);
  assert.equal(grouped.buildNflConsolidatedSubtypes(rows.map(r => ({ ...r, 'Observed Price Missing': 'TRUE' }))).length, 0);
});
test('combo reclassification changes only the public vote and uses only earlier settlements', () => {
  const history = Array.from({ length: 8 }, (_, i) => row(i));
  const own = row('later', 'W', { Date: '2026-11-01', 'Game Time': '2026-11-01T18:00:00Z',
    'Public Split Snapshot Time': '2026-11-01T17:45:00Z', 'Result Updated': '2026-11-01T22:00:00Z' });
  const side = { id: 'saved', date: own.Date, game: own.Game, gameKey: 'later', market: 'Total', side: 'Over', selection: 'Over 44.5',
    line: 44.5, odds: '-110', status: 'FINAL_PREGAME', snapshotAt: own['Public Split Snapshot Time'], gameTime: own['Game Time'],
    recorded: true, policyVersion: 'football-signals-2026-10-18-v1', signalCount: 1, result: 'W', resultUpdated: own['Result Updated'],
    signals: [{ key: 'model', available: true, active: true }, { key: 'system', available: true, active: false }] };
  const original = JSON.stringify(side), now = Date.parse('2026-11-02T12:00:00Z');
  const result = replay.replayNflConsolidatedSignals([side], [...history, own], [], now);
  assert.equal(JSON.stringify(side), original);
  assert.equal(result.observations.length, 1);
  const changed = result.observations[0];
  assert.equal(changed.signalCount, 2);
  assert.equal(changed.signals.find(s => s.key === 'system').active, true);
  assert.deepEqual(plain(changed.signals.find(s => s.key === 'model')), side.signals[0]);
  assert.equal(changed.publicMatches[0].totals.record, '8-0-0');
  assert.equal(result.status.changedPublicFlags, 1);
  assert.equal(result.status.usesPriorResultsOnly, true);
  const days = research.buildSignalResearchDays(result.observations, defs.NFL_CONSOLIDATED_SIGNAL_POLICY, now);
  assert(Object.values(days).flatMap(day => day.cells).every(cell => cell.phase === 'history'));
  assert.equal(replay.replayNflConsolidatedSignals([side], [{ ...own, 'Public Split Line': '45.5' }], [], now).observations.length, 0);
  const report = research.buildSignalResearchReport('NFL', defs.NFL_CONSOLIDATED_SIGNAL_POLICY, days);
  assert.equal(research.signalCombinationRecord(report, side), null);
  assert.equal(research.signalCombinationRecord(report, changed).record, '1-0-0');
});
