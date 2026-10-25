const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript'), { NextRequest } = require('next/server');
const load = require('./load-typescript.cjs');
const root = path.join(__dirname, '..');
const weeks = load(path.join(root, 'lib/footballPublicWeeks.ts'));
const display = load(path.join(root, 'lib/footballPublicDisplay.ts'));

function route() {
  const calls = [], api = {};
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : ['2026-10-25T16:00:00Z'])); } }
  const games = [{ Date: '2026-10-18', Week: 'Week 6' }, { Date: '2026-10-22', Week: 'Week 7' },
    { Date: '2026-10-25', Week: 'Week 7' }, { Date: '2026-10-26', Week: 'Week 7' }, { Date: '2026-11-01', Week: 'Week 8' }];
  const history = [46, 48, 47, 49].map((line, i) => ({ snapshotTime: String(i), line, odds: '-110', betsPct: 30 + i, moneyPct: 50 + i }));
  const imports = {
    'next/server': require('next/server'),
    '../../../lib/footballWeeklyMarket': { readWeeklyFootballMarket: async (sport, options) => {
      calls.push({ sport, ...options });
      return { ok: true, trendPlays: [{ game: 'KC @ LV', movementHistory: history }], games: [] };
    } },
    '../../../lib/footballTrendRescore': { rescoreNcaafWeeklyMarket: async (_, result) => result },
    '../../../lib/footballTrendV2Lifecycle': { applyFootballTrendV2: async (_, result) => result },
    '../../../lib/tursoStore': { withTursoReadCache: fn => fn() },
    '../../../lib/sportSheets': { readSportWorksheet: async () => games },
    '../../../lib/footballPublicWeeks': weeks,
    '../../../lib/footballTrendCatalogStore': { captureFootballCatalog: async (_, rows, plays) => ({ rows, plays }) },
    '../../../lib/footballPublicDisplay': display,
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'app/api/football-weekly-market/route.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports: api, Date: Clock, Intl, console, require: name => imports[name] });
  return { api, calls };
}

test('NFL and CFB weekly chart requests read only the selected week and preserve intermediate points', async () => {
  for (const sport of ['NFL', 'NCAAF']) for (const requested of ['', 'Week 6', 'Week 8']) {
    const h = route();
    const res = await h.api.GET(new NextRequest(`https://example.test/api/football-weekly-market?sport=${sport}&week=${encodeURIComponent(requested)}&compact=1`));
    assert.equal(res.status, 200);
    const body = display.restoreFootballPublicDisplay(await res.json());
    assert.equal(body.selectedWeek, requested || 'Week 7');
    assert.equal(body.availableWeeks.length, 3);
    assert.deepEqual(Array.from(body.trendPlays[0].movementHistory, p => p.line), [46, 48, 47, 49]);
    assert.deepEqual(Array.from(h.calls[0].dateKeys), requested === 'Week 6' ? ['2026-10-18']
      : requested === 'Week 8' ? ['2026-11-01'] : ['2026-10-22', '2026-10-25', '2026-10-26']);
    assert.equal(h.calls[0].hydrateHistory, sport === 'NFL' ? 'missing' : false);
  }
});
