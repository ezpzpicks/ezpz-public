const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript'), { NextRequest } = require('next/server');
const root = path.join(__dirname, '..');

function route() {
  const calls = [], api = {};
  const imports = {
    'next/server': require('next/server'),
    '../sport-public-data/route': { GET: async request => {
      calls.push('saved'); return Response.json({ ok: true, sport: request.nextUrl.searchParams.get('sport') || 'MLB', saved: true });
    } },
    '../public-data-core': { buildPublicDataResponse: async () => { calls.push('capture'); return Response.json({ ok: true }); } },
    '../../../lib/ezpzHistoricalGrading': { repairHistoricalEzpzGrades: async () => { calls.push('repair'); } },
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'app/api/public-data-v2/route.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports: api, Response, Date, console, process: { env: { CRON_SECRET: 'test-secret' } },
    require: id => imports[id] || {},
  });
  return { ...api, calls };
}

test('legacy page reads and manual refresh use saved boards without entering capture or grading', async () => {
  for (const sport of ['MLB', 'NFL', 'NCAAF', 'NCAAM', 'NBA']) for (const refresh of ['', '&refresh=1']) {
    const h = route();
    const response = await h.GET(new NextRequest(`https://example.test/api/public-data-v2?sport=${sport}${refresh}`));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).saved, true);
    assert.deepEqual(h.calls, ['saved']);
  }
});

test('every scheduled entry point authenticates before repair, collection or publication', async () => {
  for (const query of ['scheduled=1', 'tracking=v2', 'tracking=15m']) {
    const h = route();
    assert.equal((await h.GET(new NextRequest(`https://example.test/api/public-data-v2?sport=MLB&${query}`))).status, 401);
    assert.deepEqual(h.calls, []);
  }
  const h = route();
  const response = await h.GET(new NextRequest('https://example.test/api/public-data-v2?sport=NFL&scheduled=1',
    { headers: { authorization: 'Bearer test-secret' } }));
  assert.equal(response.status, 200);
  assert.deepEqual(h.calls, ['capture']);
});
