const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const date = '2026-10-26', now = Date.parse(date + 'T22:46:00Z');
const plain = value => JSON.parse(JSON.stringify(value));
function side(overrides = {}) {
  return { id: 'nba-101|Total|Over', date, gameKey: date + '|nba|101', game: 'CLE @ PHI',
    gameTime: date + 'T23:00:00Z', snapshotAt: date + 'T22:45:00Z', status: 'FINAL_PREGAME', recorded: true,
    market: 'Total', side: 'Over', selection: 'Over 220.5', line: 220.5, odds: '-110', signalCount: 3, sourceCount: 2,
    signals: ['money', 'move', 'model'].map(key => ({ key, active: true, available: true })), result: '', ...overrides };
}
function loader(stubs) {
  const cache = new Map();
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  function load(file) {
    const filename = path.resolve(root, file);
    if (cache.has(filename)) return cache.get(filename);
    const exports = {}; cache.set(filename, exports);
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(source, { exports, Date: Clock, Intl, URL, console: { info() {}, warn() {} },
      require: name => stubs[name] || (name.startsWith('.')
        ? load(path.relative(root, path.resolve(path.dirname(filename), name + '.ts'))) : require(name)) }, { filename });
    return exports;
  }
  return load;
}

test('the existing NBA analysis job hands off its saved board once, carrying cadence and no new collection', async () => {
  const writes = [], payloads = [];
  let rejectSignalWrite = false;
  const captured = side(), board = { sides: [captured], history: [] };
  const load = loader({
    './tursoStore': { readTursoDatasetByDateKeys: async () => [] },
    './nbaMarketStore': { saveNbaMarketRows: async (dataset, rows) => {
      if (rejectSignalWrite && dataset === 'nba_signal_observations') throw new Error('signal save failed');
      writes.push({ dataset, rows });
    } },
    './nbaForecasts': { readNbaForecasts: async () => [], readNbaForecastHistory: async () => [] },
    './nbaRecords': { NBA_MODEL_RECORD_POLICY: 'models', updateNbaModelRecords: previous => previous },
    './nbaAnalysisCore': { NBA_ANALYSIS_VERSION: 'analysis', nbaSeason: () => '2026', mergeNbaTeamHistory: () => [],
      settleNbaTrendRows: () => [], emptyNbaAnalysis: () => ({ version: 'analysis', season: '2026', teamHistory: [],
        archiveDates: [], pendingDates: [], leaderboard: [], tests: {}, modelRecords: { version: 'models' },
        signalResearch: { version: 'research', days: {} } }),
      buildNbaSignals: () => ({ board, stale: false, tests: {}, signalResearch: { version: 'research', days: {} },
        changedRows: [{ Date: date, 'Details JSON': JSON.stringify(captured) }] }) },
    './signalCombinationResearch': { SIGNAL_RESEARCH_VERSION: 'research' },
    './ezpzCurrentPicks': { persistEzpzCurrentPicks: async (sport, payload) => {
      assert.equal(writes.at(-1).dataset, 'nba_analysis_state', 'publish only after observations and analysis are saved');
      payloads.push({ sport, payload });
    } },
  });
  const api = load('lib/nbaAnalysis.ts');
  await api.refreshNbaAnalysis(date, [], now, { policy: '30m-until-90m-v1', intervalMinutes: 30 });
  assert.equal(payloads.length, 1); assert.equal(payloads[0].sport, 'NBA');
  const payload = payloads[0].payload, [pick] = payload.aiPicks;
  assert.equal(payload.refreshPolicy, '30m-until-90m-v1'); assert.equal(payload.refreshIntervalMinutes, 30);
  assert.equal(payload.lastUpdated, '2026-10-26T22:46:00.000Z');
  assert.equal(pick.pickCategory, 'signals'); assert.equal(pick.threshold, 3);
  assert.equal(pick.selection, 'Over 220.5'); assert.equal(pick.lockedAt, captured.snapshotAt);
  assert.deepEqual(plain(pick.signals), captured.signals);
  rejectSignalWrite = true;
  await assert.rejects(api.refreshNbaAnalysis(date, [], now), /signal save failed/);
  assert.equal(payloads.length, 1, 'a failed signal save cannot trigger publication');
});

test('NBA saved-picks API reads only persisted decisions and fails closed for stale/missing snapshots', async () => {
  let snapshot, writes = 0;
  const load = loader({
    '../../../lib/ezpzCurrentPicks': { readEzpzCurrentPicks: async sport => { assert.equal(sport, 'NBA'); return snapshot; },
      persistEzpzCurrentPicks: async () => { writes++; } },
    '../public-data-v2/route': { GET: async () => { throw new Error('reader must not collect'); } },
    'next/server': { NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200, headers: options.headers }) } },
  });
  const pick = load('lib/signalPicks.ts').signalPickForFeed(side(), 'NBA');
  snapshot = { date, updatedAt: new Date(now).toISOString(), picks: [pick] };
  const api = load('app/api/ezpz-picks/route.ts');
  const request = query => ({ nextUrl: new URL('https://example.test/api/ezpz-picks?sport=NBA' + query) });
  const result = await api.GET(request(''));
  assert.equal(result.status, 200); assert.equal(result.body.pickCount, 1);
  assert.equal(result.body.picks[0].pickCategory, 'signals'); assert.equal(result.body.picks[0].pickLabel, 'EZPZ Signal Pick');
  assert.equal(result.body.picks[0].line, 220.5); assert.equal(result.body.picks[0].eligibleForPosting, true);
  assert.equal((await api.GET(request('&prime=1'))).status, 400);
  snapshot.updatedAt = new Date(now - 21 * 60_000).toISOString();
  assert.equal((await api.GET(request(''))).status, 503);
  snapshot = null;
  assert.equal((await api.GET(request(''))).status, 503);
  assert.equal(writes, 0);
});
