const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, file);
const catalog = require('../lib/footballTrendCatalog.ts');
const defs = require('../lib/catalog/consolidatedSportCatalog.ts');
const grouped = require('../lib/consolidatedSportTrends.ts');
const replay = require('../lib/consolidatedSportResearch.ts');
const research = require('../lib/signalCombinationResearch.ts');
const basketball = require('../lib/basketballConsolidation.ts');
const nba = require('../lib/nbaAnalysisCore.ts');
const ncaam = require('../lib/ncaamAnalysisCore.ts');
function row(sport, i, result = 'W', extra = {}) {
  return { Date: '2026-11-01', Game: `Visitor${i} @ Host${i}`, 'Away Team': `Visitor${i}`, 'Home Team': `Host${i}`,
    'Game Time': '2026-11-01T18:00:00Z', Market: 'Total', Selection: 'Over', Side: 'Over',
    'Public Split Selection': 'Over', Line: '44.5', 'Public Split Line': '44.5', Odds: '-110', 'Public Split Odds': '-110',
    'Record Snapshot Policy': 'verified-final-snapshot-v1', 'Snapshot Status': 'FINAL_PREGAME',
    'Public Split Snapshot Time': '2026-11-01T17:45:00Z', Result: result, 'Result Updated': '2026-11-01T21:00:00Z',
    ...(sport !== 'NCAAF' ? { Sport: sport, [`${sport} Record Policy`]: `${sport.toLowerCase()}-verified-final-v1`,
      'Market Policy': sport === 'NBA' ? 'nba-scoresandodds-v1' : 'ncaam-scoresandodds-2026-11-01-v1', 'Observed Price Missing': 'TRUE' } : {}),
    'Catalog Membership JSON': JSON.stringify({ version: catalog.footballCatalog(sport).version,
      memberships: [{ pair: 'total-increase-any-total', direction: 0, filters: ['half-point-quote', 'sunday'] }], missing: [], ambiguous: [] }), ...extra };
}
test('each other sport has 96 supported types, distinct identities and no missing source family', () => {
  const signals = new Set();
  for (const sport of ['NCAAF', 'NBA', 'NCAAM']) {
    const types = defs.consolidatedTypes(sport), sources = new Set(catalog.footballCatalog(sport).rules.map(rule => rule.id));
    assert.equal(types.length, 96);
    assert(types.every(type => type.pairs.length && type.pairs.every(pair => sources.has(pair))));
    for (const type of types) signals.add(defs.consolidatedSignal(sport, type.id));
  }
  assert.equal(signals.size, 288);
});
test('source sport, frozen catalog and basketball price policy prevent cross-sport borrowing', () => {
  const rows = Array.from({ length: 10 }, (_, i) => row('NBA', i, i < 7 ? 'W' : 'L'));
  assert.equal(grouped.buildConsolidatedLeaderboard('NBA', rows, Date.parse('2026-11-02T12:00:00Z')).length, 1);
  assert.equal(grouped.buildConsolidatedSubtypes('NCAAM', rows).length, 0);
  assert.equal(grouped.buildConsolidatedSubtypes('NCAAF', rows).length, 0);
  assert.equal(grouped.buildConsolidatedSubtypes('NBA', rows.map(r => ({ ...r, 'Market Policy': 'unverified' }))).length, 0);
  assert.equal(grouped.buildConsolidatedSubtypes('NBA', rows.map(r => ({ ...r, 'Public Split Odds': '-105' }))).length, 0);
  const stats = grouped.buildConsolidatedSubtypes('NBA', rows)[0];
  assert.equal(stats.assumedPriceBets, 10);
  assert.equal(stats.totals.record, '7-3-0');
  assert.equal(stats.totals.roiPct, 33.6);
});
test('deduplication and minimum sample/ROI gates do not manufacture qualifiers for a new sport', () => {
  const one = row('NCAAM', 1);
  assert.equal(grouped.buildConsolidatedSubtypes('NCAAM', [one, { ...one }])[0].totals.totalBets, 1);
  assert.equal(grouped.buildConsolidatedLeaderboard('NCAAM', [one], Date.parse('2026-11-02T12:00:00Z')).length, 0);
  assert.equal(grouped.buildConsolidatedLeaderboard('NBA', Array.from({ length: 7 }, (_, i) => row('NBA', i)), Date.parse('2026-11-02T12:00:00Z')).length, 0);
  assert.equal(grouped.buildConsolidatedSubtypes('NCAAF', [row('NCAAF', 1, 'W', { Date: '2026-08-29' })]).length, 1);
  assert.equal(grouped.buildConsolidatedLeaderboard('NBA', Array.from({ length: 8 }, (_, i) => row('NBA', i)), Date.parse('2026-11-01T20:00:00Z')).length, 0);
});
test('basketball replay uses original inputs and prior outcomes, while daily aggregation stays idempotent', () => {
  const sport = 'NBA', now = Date.parse('2026-11-03T12:00:00Z'), oldPolicy = 'nba-signals-2026-10-22-v1';
  const rows = Array.from({ length: 8 }, (_, i) => row(sport, i));
  const own = row(sport, 'later', 'W', { Date: '2026-11-02', 'Game Time': '2026-11-02T18:00:00Z',
    'Public Split Snapshot Time': '2026-11-02T17:45:00Z', 'Result Updated': '2026-11-02T22:00:00Z' });
  const side = { id: 'old', date: own.Date, game: own.Game, gameKey: 'later', market: 'Total', side: 'Over', selection: 'Over 44.5',
    line: 44.5, odds: '-110', status: 'FINAL_PREGAME', snapshotAt: own['Public Split Snapshot Time'], gameTime: own['Game Time'],
    recorded: true, policyVersion: oldPolicy, signalCount: 1, result: '', resultUpdated: '',
    signals: [{ key: 'model', active: true, available: true }, { key: 'system', active: false, available: true }] };
  const original = JSON.stringify(side), result = replay.replayConsolidatedSignals(sport, [side], [...rows, own], [], now);
  assert.equal(JSON.stringify(side), original);
  assert.equal(result.observations[0].signals[1].active, true);
  assert.equal(result.observations[0].signals[0].active, true);
  assert.equal(result.observations[0].publicMatches[0].totals.record, '8-0-0');
  assert.equal(result.observations[0].result, 'W');
  const seeded = basketball.updateBasketballConsolidation(sport, {}, [...rows, own], [side], [], now, oldPolicy);
  const again = basketball.updateBasketballConsolidation(sport, seeded, [...rows, own], [side], [], now, oldPolicy);
  assert.deepEqual(again.consolidationReplay.days, seeded.consolidationReplay.days);
  const forward = { ...result.observations[0], id: 'new', researchOrigin: undefined, result: 'L', signalCount: 2 };
  const captured = research.buildSignalResearchDays([forward], defs.consolidatedSignalPolicy(sport), now);
  const combined = research.mergeSignalResearchDays(defs.consolidatedSignalPolicy(sport), seeded.consolidationReplay.days, captured);
  const report = research.buildSignalResearchReport(sport, defs.consolidatedSignalPolicy(sport), combined);
  assert.equal(research.signalCombinationRecord(report, forward).record, '1-1-0');
  assert.equal(new Set(report.cells.map(cell => cell.phase)).size, 2);
  assert.equal(research.signalCombinationRecord(report, side), null);
});
test('basketball current views retain replay and captured days as separate sources', () => {
  const day = '2026-11-02', now = Date.parse('2026-11-02T17:45:00Z');
  for (const [sport, core, factory] of [['NBA', nba, nba.emptyNbaAnalysis], ['NCAAM', ncaam, ncaam.emptyNcaamAnalysis]]) {
    const state = factory(day), policy = defs.consolidatedSignalPolicy(sport);
    state.consolidation = defs.consolidationMetadata(sport);
    state.consolidationReplay = { version: defs.consolidatedVersion(sport), status: { version: defs.consolidatedVersion(sport), replayedObservations: 1, changedPublicFlags: 1, excludedObservations: 0, usesPriorResultsOnly: true },
      days: { [day]: { version: research.SIGNAL_RESEARCH_VERSION, policyVersion: policy, date: day, cells: [{ market: 'Total', phase: 'history', combination: 'system', sideGroup: 'Over', stats: { wins: 1, losses: 0, pushes: 0, pending: 0, netUnits: 1/1.1, assumedPrices: 1, unknownPrices: 0 } }] } } };
    const result = (sport === 'NBA' ? core.buildNbaSignals : core.buildNcaamSignals)({ date: day, games: [], splits: [], forecasts: [], storedRows: [], state, now, capture: false });
    assert.equal(result.board.research.policyVersion, policy);
    assert.equal(result.board.research.cells[0].stats.wins, 1);
    assert.equal(result.board.research.reclassification.replayedObservations, 1);
  }
});
test('the saved-evidence migration requires authentication even through preview dry-run bypasses', async () => {
  const { NextRequest } = require('next/server');
  const route = require('../app/api/cron/nba-market/route.ts');
  const originalEnv = process.env.VERCEL_ENV, originalSecret = process.env.CRON_SECRET;
  try {
    process.env.VERCEL_ENV = 'preview'; process.env.CRON_SECRET = 'fixture-only-secret';
    const dry = await route.GET(new NextRequest('https://example.com/api/cron/nba-market?dryRun=1&consolidate=1'));
    assert.equal(dry.status, 401);
    const ordinary = await route.GET(new NextRequest('https://example.com/api/cron/nba-market?consolidate=1'));
    assert.equal(ordinary.status, 401);
  } finally {
    if (originalEnv === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = originalEnv;
    if (originalSecret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = originalSecret;
  }
});
