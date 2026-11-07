const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript'), { NextRequest, NextResponse } = require('next/server');
const root = path.resolve(__dirname, '..');
const { api: trial } = require('./selection-trial-fixtures.cjs');
function harness(sport, stale = false) {
  const reads = [], captures = [], exports = {};
  const date = trial.trialDate(Date.now());
  const board = { today: date, captureAvailable: true, sides: [{ id: 'a', selected: true }, { id: 'b', selected: false }] };
  const data = sport === 'NBA' ? { nbaMarket: { signals: board, stale } }
    : sport === 'NCAAM' ? { ncaamMarket: { signals: board, stale } } : { footballSignals: board };
  const imports = {
    'next/server': { NextRequest, NextResponse },
    '../../sport-public-data/route': { GET: async request => { reads.push(request); return NextResponse.json(data,
      { headers: { 'X-EZPZ-Board-Stale': String(stale) } }); } },
    '../../../../lib/footballPublicDisplay': { restoreFootballPublicDisplay: data => data },
    '../../../../lib/matchupContextStore': { captureMatchupContext: async (...args) => { captures.push(args); return { captured: 0, pending: 1 }; } },
    '../../../../lib/selectionTrial': trial,
    '../../../../lib/tursoStore': { withTursoReadCache: fn => fn() },
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'app/api/cron/matchup-context/route.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Date, URL, console, process: { env: { CRON_SECRET: 'test' } }, require: name => {
    if (!imports[name]) throw new Error(`Unexpected dependency: ${name}`);
    return imports[name];
  } });
  return { get: exports.GET, reads, captures, board };
}
test('saved-board refresh authenticates first and handles all four sports without a provider collector', async () => {
  for (const sport of ['NFL', 'NCAAF', 'NBA', 'NCAAM']) {
    const h = harness(sport), url = `https://example.test/api/cron/matchup-context?sport=${sport}`;
    assert.equal((await h.get(new NextRequest(url))).status, 401);
    assert.equal(h.reads.length, 0);
    const response = await h.get(new NextRequest(url + '&inspect=1', { headers: { authorization: 'Bearer test', 'accept-encoding': 'gzip' } }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).review.pending, 1);
    assert.equal(h.captures.length, 1);
    assert.equal(h.captures[0][0], sport);
    assert.deepEqual(h.captures[0][1], h.board.sides);
    assert.deepEqual(Array.from(h.captures[0][2]), ['a']);
    assert.equal(h.reads[0].headers.get('accept-encoding'), null);
    assert.equal(h.reads[0].nextUrl.searchParams.get('inspect'), null);
  }
});
test('saved-board refresh skips stale boards and rejects unsupported sports', async () => {
  const h = harness('NBA', true);
  const request = sport => new NextRequest(`https://example.test/api/cron/matchup-context?sport=${sport}`, { headers: { authorization: 'Bearer test' } });
  assert.equal((await (await h.get(request('NBA'))).json()).skipped, true);
  assert.equal(h.captures.length, 0);
  assert.equal((await h.get(request('MLB'))).status, 400);
  assert.equal(h.reads.length, 1);
});
