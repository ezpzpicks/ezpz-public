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
test('public tile reads use the complete cached season without refreshing external history', async () => {
  const { play, rows } = fixture('NCAAF');
  const games = require('./fixtures/football-team-season-2026.json').games;
  const source = load(path.join(root, 'lib/footballTeamSeasonHistory.ts'));
  const cached = games.map(g => source.parseEspnTeamSeasonGame(g.summary, 'NCAAF', g.schedule, now));
  let refreshCalls = 0;
  const api = withStubs('lib/footballPublicDataHistory.ts', {
    './footballTeamSeasonHistory': { TEAM_SEASON_HISTORY_TAB: 'team_season_history',
      refreshFootballTeamSeasonHistory: async () => { refreshCalls++; return []; } },
    './footballTrendCatalogStore': { captureFootballCatalog: async (_s, rows, plays) => ({ rows, plays, status: {} }) },
    './footballPublicDataLegacy': { buildFootballPublicData: async () => ({ today,
      trendPlays: [{ ...play, game: 'East Carolina @ UAB' }], trendRecordRows: rows,
      teamTrendScheduleRows: games.map(g => g.schedule) }) },
    './sportSheets': { readSportWorksheet: async (_sport, tab) => tab === 'team_season_history' ? cached : [] },
  });
  const response = await api.buildFootballPublicData('NCAAF', { publicDisplay: true });
  assert.equal(response.aiPicks[0].teamTrendScore.score.toFixed(1), '18.7');
  assert.equal(refreshCalls, 0);
  assert.equal(response.teamTrendScheduleRows, undefined);
});
test('a failed test-ledger write leaves the play as a preview without counting an unsaved decision', async () => {
  const { play } = fixture('NFL');
  const api = withStubs('lib/footballPublicDataHistory.ts', {
    './footballTrendCatalogStore': { captureFootballCatalog: async (_s, rows, plays) => ({ rows, plays, status: {} }) },
    './footballPublicDataLegacy': { buildFootballPublicData: async () => ({ today, trendPlays: [play], trendRecordRows: [],
      betTrackerRows: [{ Date: '2026-10-04', Game: 'KC @ LV', 'Bet Type': 'Total', Selection: 'Over 40', Result: 'W' }] }) },
    './sportSheets': { readSportWorksheet: async () => [], upsertSportRows: async () => { throw new Error('test write unavailable'); } },
  });
  const response = await api.buildFootballPublicData('NFL', { persist: true });
  assert.equal(response.teamTrendTestPicks[0].savedAt, '');
  assert.equal(response.teamTrendTestPicks[0].teamTrendScore.mode, 'preview');
  assert.equal(response.teamTrendTestRecordRows.length, 0);
  assert.equal(response.teamTrendTestStatus.pending, 0);
});
for (const sport of ['NFL', 'NCAAF']) {
  test(`${sport} morning locks require a fresh source and survive later line changes`, async () => {
    const { play } = fixture(sport), tables = new Map();
    let stale = true, line = 46.5;
    const api = withStubs('lib/footballPublicDataHistory.ts', {
      './footballTrendCatalogStore': { captureFootballCatalog: async (_s, rows, plays) => ({ rows, plays, status: {} }) },
      './footballPublicDataLegacy': { buildFootballPublicData: async () => ({ today, stale, draftKings: { stale },
        trendPlays: [{ ...play, snapshotStatus: 'LIVE', gameTime: `${today}T23:00:00Z`, line,
          catalogEvaluation: { ...play.catalogEvaluation, memberships: [] } }], trendRecordRows: [],
        betTrackerRows: [{ Date: '2026-10-04', Game: 'KC @ LV', 'Bet Type': 'Total', Selection: 'Over 40', Result: 'W' }] }) },
      './sportSheets': {
        readSportWorksheet: async (_sport, tab) => tables.get(tab) || [],
        upsertSportRows: async (_sport, tab, _headers, rows) => { tables.set(tab, rows.map(r => ({ ...r }))); },
      },
    });
    const preview = await api.buildFootballPublicData(sport, { persist: true });
    assert.equal(preview.teamTrendTestRecordRows.length, 0);
    assert.equal(preview.teamTrendTestPicks[0].savedAt, '');
    stale = false;
    const saved = await api.buildFootballPublicData(sport, { persist: true });
    assert.equal(saved.aiPicks.length, 0);
    assert.equal(saved.teamTrendTestRecordRows.length, 1);
    assert.equal(saved.teamTrendTestPicks[0].selection, 'Over 46.5');
    assert.equal(saved.teamTrendTestPicks[0].snapshotStatus, 'FINAL_PREGAME');
    assert.equal(saved.teamTrendTestPicks[0].capturePolicy, 'team-trend-ready-2026-10-17-v1');
    line = 60; stale = true;
    const reread = await api.buildFootballPublicData(sport, { persist: true });
    assert.equal(reread.teamTrendTestPicks[0].selection, 'Over 46.5');
    assert.equal(reread.teamTrendTestPicks[0].savedAt, saved.teamTrendTestPicks[0].savedAt);
  });

  test(`${sport} team-score-only test plays persist separately without adding an official EZPZ pick`, async () => {
    const { play } = fixture(sport);
    const tables = new Map();
    const pass = { ...play, betsPct: 50, moneyPct: 50, tier: 'Pass',
      catalogEvaluation: { ...play.catalogEvaluation, memberships: [] } };
    const api = withStubs('lib/footballPublicDataHistory.ts', {
      './footballTrendCatalogStore': { captureFootballCatalog: async (_s, rows, plays) => ({ rows, plays, status: {} }) },
      './footballPublicDataLegacy': { buildFootballPublicData: async () => ({ today, trendPlays: [pass], trendRecordRows: [],
        betTrackerRows: [{ Date: '2026-10-04', Game: 'KC @ LV', 'Bet Type': 'Total', Selection: 'Over 40', Result: 'W' }] }) },
      './sportSheets': {
        readSportWorksheet: async (_sport, tab) => tables.get(tab) || [],
        upsertSportRows: async (_sport, tab, _headers, rows) => { tables.set(tab, rows.map(r => ({ ...r }))); },
      },
    });
    const preview = await api.buildFootballPublicData(sport, { publicDisplay: true });
    assert.equal(preview.aiPicks.length, 0);
    assert.equal(preview.teamTrendTestPicks[0].teamTrendScore.score, 100);
    assert.equal(preview.teamTrendTestRecordRows.length, 0);
    assert.equal(tables.size, 0);
    const saved = await api.buildFootballPublicData(sport, { persist: true });
    assert.equal(saved.aiPicks.length, 0);
    assert.equal(saved.aiPickRecordRows.length, 0);
    assert.equal(saved.teamTrendTestRecordRows.length, 1);
    assert.equal(saved.teamTrendTestStatus.pending, 1);
    assert.deepEqual([...tables.keys()], ['team_trend_test_picks']);
    const reread = await api.buildFootballPublicData(sport, { publicDisplay: true });
    assert.equal(reread.teamTrendTestPicks[0].savedAt, saved.teamTrendTestPicks[0].savedAt);
  });
  test(`${sport} team-trend records are persisted with the final pick and remain frozen`, async () => {
    const { play, rows } = fixture(sport);
    let stored = [];
    let priorResult = 'W';
    const api = withStubs('lib/footballPublicDataHistory.ts', {
      './footballTrendCatalogStore': { captureFootballCatalog: async (_s, rows, plays) => ({ rows, plays, status: {} }) },
      './footballPublicDataLegacy': { buildFootballPublicData: async () => ({ today, trendPlays: [play], trendRecordRows: rows,
        betTrackerRows: [{ Date: '2026-10-04', Game: 'KC @ LV', 'Bet Type': 'Total', Selection: 'Over 40', Result: priorResult }] }) },
      './sportSheets': {
        readSportWorksheet: async (_sport, tab) => tab === 'ezpz_pick_history' ? stored : [],
        upsertSportRows: async (_sport, _tab, _headers, rows) => { stored = rows.map(r => ({ ...r })); },
      },
    });
    const first = await api.buildFootballPublicData(sport, { persist: true });
    assert.equal(first.aiPicks[0].teamTrendScore.score, 100);
    const saved = JSON.parse(stored[0]['Details JSON']).teamTrendScore;
    assert.equal(saved.mode, 'locked');
    assert.equal(saved.weights.betType, 50);
    priorResult = 'L';
    const second = await api.buildFootballPublicData(sport, { persist: true });
    assert.equal(second.aiPicks[0].teamTrendScore.score, 100);
    assert.equal(second.aiPickRecordRows[0].teamTrendScore.score, 100);
    assert.deepEqual(JSON.parse(stored[0]['Details JSON']).teamTrendScore, saved);
  });
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
    const api = withStubs('lib/ezpzCurrentPicks.ts', { './ezpzMcpEvents': { captureEzpzFinalPickEvents: async () => ({ delivered: 0 }) }, './tursoStore': {
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
