const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript');
const { NextRequest } = require('next/server');

function cron(options = {}) {
  const calls = [], saved = [];
  const api = {};
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../app/api/cron/nba-market/route.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const collect = sport => async () => {
    calls.push(sport);
    if (options[`${sport}Error`]) throw new Error('provider unavailable');
    return { ok: true, sport, refreshCompleted: !options.partial };
  };
  const imports = {
    'next/server': require('next/server'),
    '../../../../lib/tursoStore': { withTursoReadCache: fn => fn() },
    '../../../../lib/nbaMarket': { collectNbaMarket: collect('NBA') },
    '../../../../lib/ncaamMarket': { collectNcaamMarket: collect('NCAAM') },
    '../../../../lib/nbaAnalysis': { migrateNbaConsolidation: async () => ({ ok: true }) },
    '../../../../lib/ncaamAnalysis': { migrateNcaamConsolidation: async () => ({ ok: true }) },
    '../../../../lib/nbaMarketCore': { nbaDate: () => '2026-11-02' },
    '../../../../lib/scheduledMarketRefresh': {
      scheduledMarketRefresh: async sport => ({ due: options.skip !== sport, intervalMinutes: 30, policy: '30m-until-90m-v1' }),
      recordScheduledMarketRefresh: async sport => saved.push(sport),
    },
  };
  vm.runInNewContext(source, { exports: api, Date, console: { error() {} }, process: { env: { CRON_SECRET: 'test', VERCEL_ENV: 'production' } },
    require: name => { assert(name in imports, name); return imports[name]; } });
  const request = authorized => new NextRequest('https://example.test/api/cron/nba-market',
    authorized ? { headers: { authorization: 'Bearer test' } } : {});
  return { get: authorized => api.GET(request(authorized)), calls, saved };
}

test('the existing basketball cron collects and saves NCAAM without enabling official selections', async () => {
  const run = cron();
  assert.equal((await run.get(false)).status, 401);
  assert.deepEqual(run.calls, []);
  const response = await run.get(true), body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ncaam.ok, true);
  assert.deepEqual(run.calls, ['NBA', 'NCAAM']);
  assert.deepEqual(run.saved, ['NBA', 'NCAAM']);
});

test('one basketball provider failure cannot skip the other sport and remains visible to cron monitoring', async () => {
  for (const sport of ['NBA', 'NCAAM']) {
    const run = cron({ [`${sport}Error`]: true });
    const response = await run.get(true), body = await response.json();
    assert.equal(response.status, 500);
    assert.equal(body.ok, false);
    assert.deepEqual(run.calls, ['NBA', 'NCAAM']);
    assert.deepEqual(run.saved, [sport === 'NBA' ? 'NCAAM' : 'NBA']);
    assert.equal(body.ncaam.ok, sport !== 'NCAAM');
  }
});

test('NCAAM obeys its independent refresh clock and incomplete saves never advance source freshness', async () => {
  const skipped = cron({ skip: 'NCAAM' });
  assert.equal((await skipped.get(true)).status, 200);
  assert.deepEqual(skipped.calls, ['NBA']);
  assert.deepEqual(skipped.saved, ['NBA']);
  const partial = cron({ partial: true });
  await partial.get(true);
  assert.deepEqual(partial.calls, ['NBA', 'NCAAM']);
  assert.deepEqual(partial.saved, []);
});
