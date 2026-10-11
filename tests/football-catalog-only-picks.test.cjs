const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '..');
const today = '2026-10-18';
const now = Date.parse(`${today}T16:50:00Z`);
class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
function withStubs(file, imports) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, Date: FixedDate, Intl, console, process,
    require: name => imports[name] || (name.startsWith('.') ? load(path.resolve(root, path.dirname(file), `${name}.ts`)) : require(name)),
  });
  return exports;
}
const catalog = load(path.join(root, 'lib/footballTrendCatalog.ts'));
function fixture(sport) {
  const evaluation = { version: catalog.footballCatalog(sport).version,
    memberships: [{ pair: 'sharp-current-total', direction: 0, filters: [] }], missing: [], ambiguous: [] };
  const play = { date: today, game: 'KC @ LV', market: 'Total', side: 'Over', selection: 'Over', line: 46.5,
    gameTime: `${today}T17:00:00Z`, snapshotStatus: 'FINAL_PREGAME', frozenAt: `${today}T16:45:00Z`,
    updatedAt: `${today}T16:45:00Z`, betsPct: 20, moneyPct: 50, odds: '-110', catalogEvaluation: evaluation };
  const rows = Array.from({ length: 5 }, (_, i) => ({ Date: '2026-10-04', Game: `Visitor ${i} @ Host ${i}`,
    Market: 'Total', Selection: 'Over', Side: 'Over', 'Public Split Line': '46.5', 'Public Split Odds': '-110',
    'Public Bets %': '20', 'Public Money %': '50', 'Game Time': '2026-10-04T17:00:00Z',
    'Snapshot Status': 'FINAL_PREGAME', 'Record Snapshot Policy': 'verified-final-snapshot-v1',
    'Public Split Snapshot Time': '2026-10-04T16:45:00Z', 'Catalog Membership JSON': JSON.stringify(evaluation),
    Result: i < 4 ? 'W' : 'L', 'Result Updated': '2026-10-04T21:00:00Z' }));
  return { play, rows };
}
function historyRow(pick) {
  return { Date: pick.date, Game: pick.game, Market: pick.market, Selection: pick.selection,
    Odds: pick.odds, Source: pick.source, 'Snapshot Status': pick.snapshotStatus,
    'Pick Key': `${pick.date}|${pick.game}`, Result: pick.result || '', 'Details JSON': JSON.stringify(pick) };
}
for (const sport of ['NFL', 'NCAAF']) {
  test(`${sport} current picks exclude old locked rules while keeping archived results`, async () => {
    const { play, rows } = fixture(sport);
    const legacy = { date: today, game: 'PHI @ JAX', market: 'Total', selection: 'Over 48', odds: '-110',
      source: 'Trend Play', tier: sport === 'NFL' ? 'Market Move' : 'Total Drop Fade', snapshotStatus: 'FINAL_PREGAME' };
    const previous = { ...legacy, date: '2026-10-05', game: 'ATL @ NO', result: 'L' };
    const stored = [historyRow(legacy), historyRow(previous)];
    const api = withStubs('lib/footballPublicDataHistory.ts', {
      './footballTrendCatalogStore': { captureFootballCatalog: async (_s, rows, plays) => ({ rows, plays, status: {} }) },
      './footballPublicDataLegacy': { buildFootballPublicData: async () => ({ today, trendPlays: [play], trendRecordRows: rows }) },
      './sportSheets': { readSportWorksheet: async () => stored },
    });
    const response = await api.buildFootballPublicData(sport);
    assert.deepEqual(Array.from(response.aiPicks, pick => pick.game), [play.game]);
    assert.ok(response.aiPicks.every(pick => pick.trendSubtypeId.startsWith('catalog:')));
    assert.equal(response.aiPickRecordRows.find(pick => pick.game === previous.game).result, 'L');
    assert.equal(stored.length, 2);
  });
  test(`${sport} a saved broad-rule Wilson pick cannot bypass catalog-only selection`, () => {
    const { play, rows } = fixture(sport);
    const wilson = load(path.join(root, sport === 'NFL' ? 'lib/nflEzpzWilson.ts' : 'lib/ncaafEzpzWilson.ts'));
    const select = sport === 'NFL' ? wilson.selectNflWilsonEzpzPicks : wilson.selectNcaafWilsonEzpzPicks;
    const saved = select([play], rows, today, now)[0];
    assert.ok(saved);
    const retired = { ...saved, trendSubtypeId: 'sharp|over', tier: 'Sharp - Over' };
    assert.deepEqual(Array.from(select([], rows, today, now, [retired])), []);
    assert.equal(select([], [], today, now, [saved])[0].rankingRecord, '4-1-0');
  });
  test(`${sport} the persisted pick feed drops old entries immediately and retains catalog previews`, async () => {
    const { play, rows } = fixture(sport);
    const wilson = load(path.join(root, sport === 'NFL' ? 'lib/nflEzpzWilson.ts' : 'lib/ncaafEzpzWilson.ts'));
    const select = sport === 'NFL' ? wilson.selectNflWilsonEzpzPicks : wilson.selectNcaafWilsonEzpzPicks;
    const current = { ...select([play], rows, today, now)[0], snapshotStatus: 'LIVE' };
    const broad = { ...current, trendSubtypeId: 'sharp|over' };
    const legacy = { ...current, selectorVersion: undefined, trendSubtypeId: undefined, tier: 'Market Move' };
    let stored = [{ Kind: 'META', Date: today, 'Updated At': new Date(now).toISOString(), 'Pick Count': '3' },
      ...[legacy, broad, current].map(pick => ({ Kind: 'PICK', 'Details JSON': JSON.stringify(pick) }))];
    const api = withStubs('lib/ezpzCurrentPicks.ts', { './tursoStore': {
      readTursoDataset: async () => stored,
      replaceTursoDataset: async (_sport, _dataset, rows) => { stored = rows; },
    } });
    const snapshot = await api.readEzpzCurrentPicks(sport);
    assert.equal(snapshot.pickCount, 1);
    assert.equal(snapshot.picks[0].trendSubtypeId, current.trendSubtypeId);
    await api.persistEzpzCurrentPicks(sport, { today, aiPicks: [legacy, broad, current] });
    assert.equal(stored[0]['Pick Count'], '1');
    assert.equal(stored.length, 2);
    await api.persistEzpzCurrentPicks('MLB', { today, aiPicks: [legacy] });
    assert.equal((await api.readEzpzCurrentPicks('MLB')).pickCount, 1);
  });
}
