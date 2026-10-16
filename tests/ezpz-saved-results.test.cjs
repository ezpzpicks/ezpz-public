const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

function harness() {
  const datasets = new Map(), reads = [], cache = new Map();
  let failure = false;
  function load(file) {
    const filename = path.resolve(root, file);
    if (cache.has(filename)) return cache.get(filename);
    const exports = {}; cache.set(filename, exports);
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(source, { exports, Date, Intl, console, URL,
      require: name => name.endsWith('/tursoStore') || name === './tursoStore' ? {
        readTursoDatasetByDateKeys: async (sport, dataset, dates) => {
          reads.push({ sport, dataset, dates });
          if (failure) throw new Error('read unavailable');
          return (datasets.get(`${sport}:${dataset}`) || []).filter(row => dates.includes(row.Date));
        },
      } : name === 'next/server' ? { NextResponse: { json: (body, options) => ({ body, ...options }) } }
        : name.startsWith('.') ? load(path.relative(root, path.resolve(path.dirname(filename), `${name}.ts`))) : require(name),
    }, { filename });
    return exports;
  }
  return { api: load('lib/ezpzSavedResults.ts'), route: load('app/api/ezpz-results/route.ts'), datasets, reads,
    fail: () => { failure = true; } };
}
const date = '2026-10-15';
const publicPick = { date, game: 'Away @ Home', gameTime: `${date}T23:30:00Z`, market: 'Total',
  selection: 'Over 47.5', line: 47.5, source: 'Trend Play', snapshotStatus: 'FINAL_PREGAME',
  lockedAt: `${date}T23:15:00Z`, result: 'W' };
function row(pick, result = pick.result) {
  return { Date: pick.date, Game: pick.game, Market: pick.market, Selection: pick.selection,
    Result: result, 'Result Updated': '2026-10-16T03:00:00Z', 'Details JSON': JSON.stringify(pick) };
}
const plain = value => JSON.parse(JSON.stringify(value));

test('stored grades override captured details; pending never becomes a win', () => {
  const { api } = harness();
  assert.equal(api.savedResultFromRow('NCAAF', row(publicPick, 'L'), 'public_bet_trend').result, 'L');
  const pending = api.savedResultFromRow('NCAAF', row(publicPick, ''), 'public_bet_trend');
  assert.equal(pending.result, null);
  assert.equal(pending.settlementStatus, 'PENDING');
  assert.equal(api.savedResultFromRow('NCAAF', row(publicPick, 'PUSH'), 'public_bet_trend').result, 'P');
});

test('separate categories preserve independent results and exact captured lines', async () => {
  const h = harness();
  const team = { ...publicPick, selection: 'Under 48', line: 48, result: 'L',
    strategyVersion: 'team-trend-test-2026-10-15-v1', threshold: 75,
    savedAt: `${date}T23:15:00Z`, teamTrendScore: { score: 81.3, mode: 'locked' } };
  h.datasets.set('NCAAF:ezpz_pick_history', [row(publicPick), row(publicPick)]);
  h.datasets.set('NCAAF:team_trend_test_picks', [row(team)]);
  const picks = await h.api.readSavedEzpzResults('NCAAF', date);
  assert.equal(picks.length, 2);
  assert.deepEqual(plain(picks.map(p => [p.pickLabel, p.selection, p.result])), [
    ['EZPZ Public Bet Trend', 'Over 47.5', 'W'], ['EZPZ Team Trend', 'Under 48', 'L']]);
  assert.equal(h.reads.length, 2);
  assert.ok(h.reads.every(r => r.dates.length === 1 && r.dates[0] === date));
});

test('previews, model history, props and malformed captures cannot enter trend results', () => {
  const { api } = harness();
  for (const changes of [{ snapshotStatus: 'LIVE' }, { source: 'Model Play' }, { playerName: 'Player' }, { selected: false }]) {
    assert.equal(api.savedResultFromRow('NFL', row({ ...publicPick, ...changes }), 'public_bet_trend'), null);
  }
  assert.equal(api.savedResultFromRow('NFL', { Date: date, 'Details JSON': '{bad' }, 'team_trend'), null);
  const team = { ...publicPick, strategyVersion: 'team-trend-test-2026-10-15-v1', threshold: 75,
    savedAt: `${date}T23:31:00Z`, teamTrendScore: { score: 90, mode: 'locked' } };
  assert.equal(api.savedResultFromRow('NFL', row(team), 'team_trend'), null);
});

test('MLB reads only selected durable daily picks and retains pushes', async () => {
  const h = harness();
  h.datasets.set('MLB:trend_v2_daily_picks', [row({ ...publicPick, candidateId: 'locked-mlb' }, 'P')]);
  const picks = await h.api.readSavedEzpzResults('MLB', date);
  assert.equal(picks.length, 1);
  assert.equal(picks[0].result, 'P');
  assert.equal(h.reads.length, 1);
});

test('read failures and conflicting grades fail closed', async () => {
  const h = harness();
  h.datasets.set('NFL:ezpz_pick_history', [row(publicPick), row(publicPick, 'L')]);
  await assert.rejects(h.api.readSavedEzpzResults('NFL', date), /Conflicting/);
  h.fail();
  await assert.rejects(h.api.readSavedEzpzResults('NFL', date), /unavailable/);
});

test('route validates dates/sports, returns explicit pending and reports unavailable reads', async () => {
  const h = harness();
  const request = query => ({ nextUrl: new URL(`https://example.test/api/ezpz-results?${query}`) });
  assert.equal((await h.route.GET(request('sport=NBA&date=2026-10-15'))).status, 400);
  assert.equal((await h.route.GET(request('sport=NFL&date=2026-02-30'))).status, 400);
  assert.equal(h.reads.length, 0);
  h.datasets.set('NFL:ezpz_pick_history', [row(publicPick, '')]);
  const response = await h.route.GET(request('sport=NFL&date=2026-10-15'));
  assert.equal(response.body.ok, true);
  assert.equal(response.body.picks[0].settlementStatus, 'PENDING');
  assert.match(response.headers['Cache-Control'], /no-store/);
  h.fail();
  assert.equal((await h.route.GET(request('sport=NFL&date=2026-10-15'))).status, 503);
});
