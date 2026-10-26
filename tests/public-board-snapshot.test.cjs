const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript');
const { NextRequest } = require('next/server');
const { gunzipSync } = require('node:zlib');
const root = path.join(__dirname, '..');
const display = require('./load-typescript.cjs')(path.join(root, 'lib/footballPublicDisplay.ts'));

function harness() {
  let now = Date.parse('2026-10-25T16:00:00Z');
  const db = new DatabaseSync(':memory:'), calls = [], api = {};
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const runTursoSql = async statements => statements.map(sql => {
    calls.push(sql);
    return db.prepare(sql).all().map(row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, String(v)])));
  });
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'lib/publicBoardSnapshot.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports: api, Buffer, Uint8Array, Date: Clock, Intl, console: { info() {}, error() {} },
    require: id => id === './tursoStore' ? { runTursoSql } : id === './footballPublicDisplay' ? display : require(id),
  });
  return { ...api, calls, db, now: () => now, advance: ms => { now += ms; } };
}
function fixture(sport) {
  const history = [42.5, 43.5, 42, 44].map((line, i) => ({ snapshotTime: `2026-10-25T${12 + i}:00:00Z`, line, odds: '-110', betsPct: 50 + i, moneyPct: 70 + i }));
  const evaluation = { version: 'catalog-v1', memberships: [{ pair: 'market-money', direction: 1, filters: ['sharp25', 'rlm'] }], missing: [], ambiguous: [] };
  const trend = { game: 'Away @ Home', movementHistory: history, catalogEvaluation: evaluation };
  return { ok: true, sport, today: '2026-10-25', lastUpdated: '10/25/2026, 12:00:00 PM EDT', refreshIntervalMinutes: 5,
    tiles: { overallGreen: { record: '100-70-2' } }, bestPlays: [{ game: 'Away @ Home', play: 'Over 42.5', grade: 'A' }],
    slateToday: [{ Game: 'Away @ Home', Date: '2026-10-25' }],
    betTrackerRows: [{ Date: '2026-08-01', Result: 'W' }], trendRecordRows: [{ ...trend, Result: 'L' }],
    aiPickRecordRows: [{ date: '2026-09-15', result: 'W', snapshotStatus: 'FINAL_PREGAME', odds: '-110' }],
    trendPlays: [trend], aiPicks: [{ selection: 'Over 42.5', triggeredSignals: ['Money Support', 'Model Grade'] }],
    recordSummary: [{ betType: 'Strong Over', record: '40-25' }],
    footballSignals: { sides: [{ selection: 'Over', signalCount: 2, marketContext: { history } }] },
    ...(sport !== 'MLB' ? { footballWeeklyMarket: { ok: true, selectedWeek: 'Week 7', availableWeeks: ['Week 6', 'Week 7', 'Week 8'],
      games: [{ Game: 'Next Away @ Next Home', Week: 'Week 8' }], trendPlays: [trend] } } : {}),
  };
}
const req = (sport, suffix = '', headers = {}) => new NextRequest(`https://example.test/api/sport-public-data?sport=${sport}${suffix}`, { headers });

test('saved boards preserve every tab, historical records, signal evidence, weekly games and intermediate charts', async () => {
  for (const sport of ['MLB', 'NFL', 'NCAAF']) {
    const h = harness(), original = fixture(sport);
    await h.persistPublicBoardSnapshot(sport, original, h.now());
    const before = h.calls.length;
    const response = await h.savedPublicBoardResponse(req(sport), sport);
    assert.equal(response.status, 200);
    const restored = display.restoreFootballPublicDisplay(await response.json());
    const { publicBoard, ...data } = restored;
    assert.deepEqual(JSON.parse(JSON.stringify(data)), original);
    assert.equal(publicBoard.version, 'saved-public-board-v1');
    assert.equal(response.headers.get('x-ezpz-board-stale'), 'false');
    assert.equal(h.calls.length - before, 1);
    assert.match(h.calls.at(-1), /^SELECT .* WHERE sport=/);
    await h.savedPublicBoardResponse(req(sport), sport);
    assert.equal(h.calls.length - before, 1, 'warm visits reuse the one-row read');
    const row = h.db.prepare('SELECT body_bytes,compressed_bytes FROM public_board_snapshots WHERE sport=?').get(sport);
    assert.ok(row.compressed_bytes < row.body_bytes);
  }
});

test('public reads never initialize storage or fall back to collectors, including refresh=1', async () => {
  const h = harness();
  const response = await h.savedPublicBoardResponse(req('NFL', '&refresh=1'), 'NFL');
  assert.equal(response.status, 503);
  assert.equal((await response.json()).pending, true);
  assert.equal(h.calls.length, 1);
  assert.match(h.calls[0], /^SELECT /);
});

test('bad builds and late-finishing older producers cannot replace a valid board', async () => {
  const h = harness();
  await assert.rejects(h.persistPublicBoardSnapshot('NFL', { ok: false }, h.now()), /incomplete/);
  assert.equal(h.calls.length, 0);
  const original = fixture('NFL');
  await h.persistPublicBoardSnapshot('NFL', original, h.now());
  await h.persistPublicBoardSnapshot('NFL', { ...original, bestPlays: [] }, h.now() - 60_000);
  const restored = display.restoreFootballPublicDisplay(await (await h.savedPublicBoardResponse(req('NFL'), 'NFL')).json());
  assert.deepEqual(restored.bestPlays, original.bestPlays);
});

test('aged and prior-date snapshots are explicitly stale without changing their source date or grades', async () => {
  const h = harness();
  await h.persistPublicBoardSnapshot('NFL', fixture('NFL'), h.now());
  h.advance(24 * 60 * 60_000);
  const response = await h.savedPublicBoardResponse(req('NFL'), 'NFL');
  assert.equal(response.headers.get('x-ezpz-board-stale'), 'true');
  const body = await response.json();
  assert.equal(body.today, '2026-10-25');
  assert.equal(body.aiPickRecordRows[0].result, 'W');
});

test('gzip responses reuse producer compression and inspection stays small', async () => {
  const h = harness();
  await h.persistPublicBoardSnapshot('NFL', fixture('NFL'), h.now());
  const response = await h.savedPublicBoardResponse(req('NFL', '', { 'accept-encoding': 'gzip, br' }), 'NFL');
  assert.equal(response.headers.get('content-encoding'), 'gzip');
  const body = JSON.parse(gunzipSync(Buffer.from(await response.arrayBuffer())).toString());
  assert.equal(body.bestPlays[0].play, 'Over 42.5');
  const inspection = await h.savedPublicBoardResponse(req('NFL', '&inspect=1'), 'NFL');
  const summary = await inspection.json();
  assert.equal(summary.sport, 'NFL');
  assert.equal(summary.ok, true);
  assert.ok(!('bestPlays' in summary));
});
