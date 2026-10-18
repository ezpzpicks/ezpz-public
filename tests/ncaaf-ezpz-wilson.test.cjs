const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { renderToStaticMarkup } = require('react-dom/server');
const load = require('./load-typescript.cjs');
const root = path.join(__dirname, '..');
const wilson = load(path.join(root, 'lib/ncaafEzpzWilson.ts'));
const policy = load(path.join(root, 'lib/ncaafEzpzPolicy.ts'));
const leaderboard = load(path.join(root, 'lib/ncaafPublicTrendLeaderboard.ts'));
const eligibility = load(path.join(root, 'lib/ezpzPublicSplitEligibility.ts'));
const recordPolicy = load(path.join(root, 'lib/ncaafTrendRecordPolicy.ts'));
const catalog = load(path.join(root, 'lib/footballTrendCatalog.ts'));
function membership(market = 'Total') {
  return { version: catalog.footballCatalog('NCAAF').version,
    memberships: [{ pair: market === 'Spread' ? 'spread-ticket-current-spread' : 'sharp-current-total', direction: 0, filters: [] }],
    missing: [], ambiguous: [] };
}
function signal(market = 'Total') { return catalog.catalogSignals(membership(market), 'NCAAF')[0]; }
const today = '2026-10-13';
const now = Date.parse('2026-10-13T18:50:00Z');

function subtype(name, wins, losses, overrides = {}) {
  return { id: `${name}|over`, signal: name, category: 'Over', label: name,
    totals: { wins, losses, pushes: 0, totalBets: wins + losses, record: `${wins}-${losses}-0`,
      winPct: wins + losses ? wins / (wins + losses) * 100 : 0,
      unitsWon: wins / 1.1 - losses, netUnits: wins / 1.1 - losses, roiPct: 1, ...overrides } };
}

function row(i, result = 'W', overrides = {}) {
  return { 'Catalog Membership JSON': JSON.stringify(membership(overrides.Market)),
    Date: '2026-10-10', Game: `Team ${i} @ Other ${i}`, 'Game Key': `game-${i}`,
    'Direct Trend Group Key': `2026-10-10|Team ${i} @ Other ${i}|Total`,
    'Game Time': '2026-10-10T12:00:00Z', Market: 'Total', Side: 'Over', Selection: 'Over',
    'Public Split Selection': 'Over', 'Public Split Line': '54', 'Public Split Odds': '-110',
    'Public Bets %': '20', 'Public Money %': '50', 'Opening Public %': '20',
    'Snapshot Status': 'FINAL_PREGAME', 'Record Snapshot Policy': 'verified-final-snapshot-v1',
    'Public Split Snapshot Time': '2026-10-10T11:45:00Z',
    Result: result, 'Result Updated': '2026-10-10T16:00:00Z', ...overrides };
}

function sharpHistory(wins = 10, losses = 5, side = 'Over', prefix = '') {
  return Array.from({ length: wins + losses }, (_, i) => row(prefix + side + i, i < wins ? 'W' : 'L', {
    Side: side, Selection: side, 'Public Split Selection': side,
  }));
}

function momentumHistory(wins = 5, losses = 1) {
  return Array.from({ length: wins + losses }, (_, i) => row('momentum' + i, i < wins ? 'W' : 'L', {
    Market: 'Spread', Side: '', Selection: 'Team', 'Public Split Selection': 'Team',
    'Direct Trend Group Key': `momentum-${i}`, 'Public Split Line': '-5.5',
    'Opening Public Split Line': '-4.5', 'Opening Public %': '40',
    'Public Bets %': '47', 'Public Money %': '47',
  }));
}

function play(overrides = {}) {
  return { catalogEvaluation: membership(overrides.market), date: today, game: 'Alpha @ Beta', gameKey: 'alpha-beta', gameTime: `${today}T19:00:00Z`,
    awayTeam: 'Alpha', homeTeam: 'Beta', market: 'Total', side: 'Over', selection: 'Over', line: 54,
    betsPct: 20, moneyPct: 50, odds: '-110', snapshotStatus: 'FINAL_PREGAME',
    frozenAt: `${today}T18:45:00Z`, updatedAt: `${today}T18:45:00Z`, ...overrides };
}

function select(plays, rows, at = now, archived = []) {
  return wilson.selectNcaafWilsonEzpzPicks(plays, rows, today, at, archived);
}

const historyDependencies = {
  './ezpzMcpPicks': load(path.join(root, 'lib/ezpzMcpPicks.ts')),
  './footballTeamTrends': load(path.join(root, 'lib/footballTeamTrends.ts')),
  './footballTeamTrendPlays': load(path.join(root, 'lib/footballTeamTrendPlays.ts')),
  './footballTeamSeasonHistory': load(path.join(root, 'lib/footballTeamSeasonHistory.ts')),
  './footballSignals': load(path.join(root, 'lib/footballSignals.ts')),
  './footballSos': { loadFootballSos: async () => null },
  './FootballTeamTrendScore': { default: () => null },
  './TeamTrendTestPlays': { default: () => null },
};

function moduleWithStubs(file, imports = {}, appended = '', date = Date) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8') + appended, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { exports, Date: date, Intl, console, process,
    require: name => imports[name] || historyDependencies[name] || (name.startsWith('.') ? {} : require(name)),
  });
  return exports;
}

test('the fixed one-sided 95% Wilson setting gives 10-5 a slight edge over 4-1', () => {
  assert.ok(Math.abs(wilson.ncaafWilsonLowerBound(10, 5) * 100 - 45.517214735) < 1e-6);
  assert.ok(Math.abs(wilson.ncaafWilsonLowerBound(4, 1) * 100 - 43.529255342) < 1e-6);
  const ranked = wilson.rankNcaafEzpzSubtypes([subtype('4-1', 4, 1), subtype('10-5', 10, 5)]);
  assert.deepEqual(Array.from(ranked, r => r.signal), ['10-5', '4-1']);
  assert.equal(wilson.ncaafWilsonLowerBound(0, 0), 0);
  assert.equal(wilson.ncaafWilsonLowerBound(-1, 3), 0);
});

test('actual win rate is strictly above 60%, ROI is positive, and no minimum sample is imposed', () => {
  const rows = [subtype('exactly 60', 3, 2), subtype('1-0', 1, 0),
    subtype('zero profit', 4, 1, { netUnits: 0 }), subtype('loss', 4, 1, { netUnits: -0.01 }),
    subtype('push only', 0, 0, { pushes: 100 }),
    subtype('tiny profit', 4, 1, { unitsWon: 0, roiPct: 0, netUnits: 0.00001 }),
    subtype('rounded 60', 600001, 399999)];
  const ranked = wilson.rankNcaafEzpzSubtypes(rows);
  assert.deepEqual(new Set(Array.from(ranked, r => r.signal)), new Set(['1-0', 'tiny profit', 'rounded 60']));
  assert.ok(ranked.find(r => r.signal === '1-0').wilsonScore < 60);
});

test('pushes do not strengthen the score, ties are stable, and only the best 20 subtypes qualify', () => {
  const a = subtype('A', 10, 5), b = subtype('B', 10, 5, { pushes: 100, totalBets: 115 });
  const tied = wilson.rankNcaafEzpzSubtypes([b, a]);
  assert.equal(tied[0].wilsonScore, tied[1].wilsonScore);
  assert.equal(tied[0].signal, 'A');
  const rows = Array.from({ length: 1000 }, (_, i) => subtype(`Small ${i}`, 1, 0));
  const before = JSON.stringify(rows);
  const ranked = wilson.rankNcaafEzpzSubtypes([...rows, subtype('Strong', 20, 10)]);
  assert.equal(ranked.length, 20);
  assert.equal(ranked[0].signal, 'Strong');
  assert.equal(JSON.stringify(rows), before);
});

test('the EZPZ builder uses the full catalog before a public top-20 cap could hide a reliable subtype', () => {
  const all = [...Array.from({ length: 25 }, (_, i) => subtype(`Small ${i}`, 1, 0)), subtype('Large', 20, 10)];
  const isolated = moduleWithStubs('lib/ncaafEzpzWilson.ts', {
    './ncaafEzpzPolicy': policy, './ncaafPublicTrendLeaderboard': { ...leaderboard, buildNcaafTrendSubtypes: () => all },
  });
  const ranked = isolated.buildNcaafEzpzLeaderboard([], now);
  assert.equal(ranked.length, 20);
  assert.equal(ranked[0].signal, 'Large');
});

test('the verified ledger counts each game once and keeps Over and Under records separate', () => {
  const rows = [...sharpHistory(10, 5), ...sharpHistory(4, 1, 'Under')];
  rows.push({ ...rows[0], 'Direct Trend Group Key': 'duplicate storage group', 'Game Key': 'alias' });
  const ranked = wilson.buildNcaafEzpzLeaderboard(rows, now);
  assert.equal(ranked[0].id, `${signal()}|over`);
  assert.equal(ranked[0].totals.record, '10-5-0');
  assert.equal(ranked[1].totals.record, '4-1-0');
  assert.equal(leaderboard.buildNcaafTrendSubtypes(rows).find(r => r.id === `${signal()}|over`).totals.totalBets, 15);
});

test('rankings exclude later settlements, missing availability timestamps, early grades, and unverified rows', () => {
  const base = sharpHistory(3, 2);
  const future = row('future', 'W', { 'Result Updated': `${today}T20:00:00Z` });
  const invalid = [row('missing', 'W', { 'Result Updated': '' }),
    row('early', 'W', { 'Result Updated': '2026-10-10T11:00:00Z' }),
    row('legacy', 'W', { 'Record Snapshot Policy': '' })];
  assert.equal(wilson.buildNcaafEzpzLeaderboard([...base, future, ...invalid], now).length, 0);
  assert.equal(wilson.buildNcaafEzpzLeaderboard([...base, future], Date.parse(`${today}T21:00:00Z`))[0].totals.record, '4-2-0');
  const self = row('own', 'W', { Date: today, Game: 'Alpha @ Beta', 'Game Time': '', 'Result Updated': `${today}T18:00:00Z` });
  assert.equal(select([play()], [...base, self]).length, 0);
});

test('one pick per game follows Wilson strength instead of automatic Sharp or Total Drop Fade priority', () => {
  const spread = play({ market: 'Spread', selection: 'Alpha', selectionTeam: 'Alpha', side: '',
    line: -5.5, openingLine: -4.5, openingBetsPct: 40, betsPct: 47, moneyPct: 47 });
  const picks = select([play({ openingLine: 56 }), spread], [...sharpHistory(4, 1), ...momentumHistory()]);
  assert.equal(picks.length, 1);
  assert.equal(picks[0].trendSubtypeId, `${signal('Spread')}|favorite spread`);
  assert.equal(picks[0].selection, 'Alpha -5.5');
  assert.equal(picks[0].rankingRecord, '5-1-0');
  assert.equal(picks[0].rankingLastSeven.record, '5-1-0');
  assert.equal(eligibility.isPublicSplitEzpzPick(picks[0]), true);
});

test('RLM can become EZPZ using its own graded subtype; an opposite side from another game cannot qualify it', () => {
  const records = [];
  for (let i = 0; i < 5; i++) {
    const selected = row('rlm' + i, i < 4 ? 'W' : 'L', { Market: 'Spread', Side: '', Selection: 'Alpha',
      'Public Split Selection': 'Alpha', 'Direct Trend Group Key': `rlm-${i}`,
      'Public Split Line': '-4.5', 'Public Bets %': '45', 'Public Money %': '45',
      'Opening Public Split Line': '-2.5', 'Opening Public %': '60', 'Opening Sharp %': '60',
      'Opening Public Split Snapshot Time': '2026-10-10T10:00:00Z', 'Catalog Membership JSON': '' });
    const opposite = { ...selected, Selection: 'Beta', 'Public Split Selection': 'Beta',
      Result: i < 4 ? 'L' : 'W', 'Public Split Line': '4.5', 'Public Bets %': '55', 'Public Money %': '55',
      'Opening Public %': '40', 'Opening Sharp %': '40', 'Opening Public Split Line': '2.5',
      'Public Change %': '15', 'Line Movement Basis': 'Spread Line', 'Line Movement Value': '-2' };
    records.push(selected, opposite);
  }
  const a = play({ market: 'Spread', side: '', selection: 'Alpha', selectionTeam: 'Alpha', line: -4.5, betsPct: 45, moneyPct: 45,
    openingLine: -2.5, openingBetsPct: 60, openingMoneyPct: 60,
    openingSnapshotTime: `${today}T17:00:00Z`, catalogEvaluation: undefined });
  const b = { ...a, selection: 'Beta', selectionTeam: 'Beta', line: 4.5, betsPct: 55, moneyPct: 55,
    openingBetsPct: 40, openingMoneyPct: 40, openingLine: 2.5,
    publicMovementPct: 15, lineMovementValue: -2, lineMovementBasis: 'Spread Line' };
  const chosen = select([a, b], records)[0];
  assert.equal(chosen.selection, 'Alpha -4.5');
  assert.equal(chosen.rankingRecord, '4-1-0');
  assert.equal(leaderboard.buildNcaafTrendSubtypes(records).find(s => s.signal.endsWith(':rlm-current-spread:0:')).totals.record, '4-1-0');
  assert.equal(select([a, { ...b, game: 'Different @ Game' }], records).length, 0);
});

test('final snapshots accept T-20 through T-10; prices, models, started LIVE games and missed locks are guarded', () => {
  const history = sharpHistory(4, 1);
  for (const minutes of [10, 20]) {
    const capture = new Date(Date.parse(play().gameTime) - minutes * 60_000).toISOString();
    assert.equal(select([play({ frozenAt: capture, updatedAt: capture })], history).length, 1);
  }
  for (const overrides of [{ frozenAt: `${today}T18:39:59Z` }, { frozenAt: `${today}T18:50:01Z` },
    { frozenAt: '', updatedAt: '' }, { gameTime: '' }, { snapshotStatus: 'MISSED_LOCK' },
    { source: 'Best Play' }, { market: 'Moneyline' }, { playerName: 'A Player' }, { propMarket: 'Passing' }, { odds: '-151' }]) {
    assert.equal(select([play(overrides)], history).length, 0, JSON.stringify(overrides));
  }
  assert.equal(select([play({ odds: '-150' })], history).length, 1);
  assert.equal(select([play({ odds: '' })], history)[0].odds, '-110');
  assert.equal(select([play({ snapshotStatus: 'LIVE' })], history).length, 1);
  assert.equal(select([play({ snapshotStatus: 'LIVE' })], history, Date.parse(`${today}T19:01:00Z`)).length, 0);
  assert.equal(select([play({ date: '2026-10-10', frozenAt: '2026-10-10T18:45:00Z' })], history).length, 0);
});

test('a posted final pick retains its captured rank and record after the trend falls below 60%', () => {
  const records = sharpHistory(4, 1);
  const original = select([play()], records)[0];
  assert.equal(wilson.isNcaafWilsonArchivedPick(original), true);
  const later = [...records, row('late-loss-1', 'L', { 'Result Updated': `${today}T21:00:00Z` }),
    row('late-loss-2', 'L', { 'Result Updated': `${today}T21:01:00Z` })];
  const after = Date.parse(`${today}T22:00:00Z`);
  assert.equal(wilson.buildNcaafEzpzLeaderboard(later, after).length, 0);
  const kept = select([], later, after, [original])[0];
  assert.equal(kept.rankingRecord, '4-1-0');
  assert.equal(kept.wilsonScore, original.wilsonScore);
  for (const change of [{ wilsonScore: 100 }, { rankingWins: 3, rankingLosses: 2 },
    { rankingNetUnits: 0 }, { trendRank: 21 }, { snapshotStatus: 'LIVE' }, { rankingAsOf: `${today}T22:00:00Z` }]) {
    assert.equal(wilson.isNcaafWilsonArchivedPick({ ...original, ...change }), false);
  }
});

test('the production history layer selects, persists and grades the Wilson pick while preserving older posted history', async () => {
  let clock = now;
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } }
  const legacy = { date: '2026-10-09', game: 'Old @ Posted', market: 'Total', selection: 'Over 51.5',
    odds: '-110', source: 'Trend Play', tier: 'Total Drop Fade', qualification: 'Total Drop Fade',
    snapshotStatus: 'FINAL_PREGAME', result: 'L' };
  let stored = [{ Date: legacy.date, 'Pick Key': 'old-posted', Game: legacy.game, Market: legacy.market,
    Selection: legacy.selection, Odds: legacy.odds, Source: legacy.source, 'Snapshot Status': legacy.snapshotStatus,
    Result: legacy.result, 'Details JSON': JSON.stringify(legacy), 'Saved At': '2026-10-09T18:45:00Z' }];
  const spread = play({ market: 'Spread', selection: 'Alpha', selectionTeam: 'Alpha', side: '', line: -5.5,
    openingLine: -4.5, openingBetsPct: 40, betsPct: 47, moneyPct: 47 });
  const core = { today, aiPicks: [{ ...play(), source: 'Trend Play', tier: 'Sharp' }],
    trendPlays: [play(), spread], trendRecordRows: [...sharpHistory(4, 1), ...momentumHistory()], aiSelectorStatus: {} };
  const api = moduleWithStubs('lib/footballPublicDataHistory.ts', {
    './ncaafEzpzPolicy': policy, './ncaafEzpzWilson': wilson, './ncaafTrendRecordPolicy': recordPolicy,
    './nflEzpzPolicy': load(path.join(root, 'lib/nflEzpzPolicy.ts')),
    './footballTrendCatalogStore': { captureFootballCatalog: async (_s, rows, plays) => ({ rows, plays, status: {} }) },
    './footballPublicDataLegacy': { buildFootballPublicData: async () => core },
    './ezpzPublicSplitEligibility': eligibility,
    './sportSheets': { readSportWorksheet: async () => stored,
      upsertSportRows: async (_sport, _tab, _headers, rows) => {
        const merged = new Map(stored.map(r => [r['Pick Key'], r]));
        for (const r of rows) merged.set(r['Pick Key'], r);
        stored = [...merged.values()];
      } },
  }, '', FixedDate);
  const response = await api.buildFootballPublicData('NCAAF', { persist: true });
  assert.equal(response.aiPicks[0].trendSubtypeId, `${signal('Spread')}|favorite spread`);
  assert.equal(response.aiSelectorStatus.selectorVersion, policy.NCAAF_EZPZ_POLICY_VERSION);
  assert.equal(response.aiPickRecordRows.find(p => p.game === legacy.game).result, 'L');
  const saved = stored.find(r => r.Game === spread.game);
  const details = JSON.parse(saved['Details JSON']);
  assert.equal(details.rankingRecord, '5-1-0');
  assert.equal(details.rankingLastSeven.record, '5-1-0');
  assert.equal(wilson.isNcaafWilsonArchivedPick(details), true);
  core.trendPlays = [];
  core.trendRecordRows = [...sharpHistory(1, 6), ...momentumHistory(1, 6), row('current-result', 'L', {
    Date: today, Game: spread.game, Market: 'Spread', Selection: 'Alpha', Side: '',
    'Public Split Selection': 'Alpha', 'Public Split Line': '-5.5',
    'Game Time': spread.gameTime, 'Public Split Snapshot Time': spread.frozenAt,
    'Result Updated': `${today}T21:00:00Z`,
  })];
  clock = Date.parse(`${today}T22:00:00Z`);
  const next = await api.buildFootballPublicData('NCAAF', { persist: true });
  assert.equal(next.aiPicks[0].wilsonScore, details.wilsonScore);
  assert.equal(next.aiPicks[0].result, 'L');
  assert.equal(next.aiPickRecordRows.find(p => p.game === spread.game).result, 'L');
  assert.equal(next.aiPickRecordRows.find(p => p.game === spread.game).rankingRecord, '5-1-0');
  assert.equal(stored.find(r => r.Game === spread.game)['Saved At'], saved['Saved At']);
});

test('the EZPZ card displays the saved Wilson evidence and last-seven record; records count actual saved picks', () => {
  const original = select([play()], sharpHistory(4, 1))[0];
  const tiles = moduleWithStubs('app/FootballBoard.tsx', {
    '../lib/footballTrendCatalog': load(path.join(root,'lib/footballTrendCatalog.ts')),
  '../lib/ncaafEzpzPolicy': policy, '../lib/ncaafTrendRecordPolicy': recordPolicy,
    '../lib/ezpzPublicSplitEligibility': eligibility,
    './TeamLogoName': { TeamLogoName: p => p.team, MatchupWithLogos: p => p.game, SelectionWithTeamLogo: p => p.selection },
  }, '\nexport const cardTest = HistoryPickCard;');
  const html = renderToStaticMarkup(tiles.cardTest({ pick: original, sport: 'NCAAF', viewingToday: true,
    data: { today, trendRecordRows: sharpHistory(0, 7) } }));
  assert.match(html, /Wilson ranking/);
  assert.match(html, /43\.5/);
  assert.match(html, /L7 4-1-0/);
  assert.doesNotMatch(html, /L7 0-7-0/);
  const records = moduleWithStubs('app/FootballBoardLegacy.tsx', {
    '../lib/ezpzPublicSplitEligibility': eligibility,
  }, '\nexport const recordsTest = footballEzpzHistoryRows;');
  const rows = records.recordsTest({ ncaafEzpzTrendLeaderboard: [],
    aiPickRecordRows: [{ ...original, result: 'L' }, { ...original, result: 'L' }],
    betTrackerRows: [row('unposted-model', 'W')], trendRecordRows: sharpHistory(100, 0) }, 'NCAAF');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Result, 'L');
});

test('a qualifying catalog public-follow pick survives persistence, the EZPZ tab and saved history', async () => {
  // WKU at Sam Houston's Oct 14 signal used this catalog name, which the
  // retired Sharp/RLM whitelist incorrectly rejected after Wilson selection.
  const evaluated = { version: catalog.footballCatalog('NCAAF').version,
    memberships: [{ pair: 'bd-band-65-total', direction: 0, filters: ['monday-through-friday'] }],
    missing: [], ambiguous: [] };
  const records = Array.from({ length: 5 }, (_, i) => row('public-follow-' + i, 'W', {
    'Catalog Membership JSON': JSON.stringify(evaluated),
  }));
  records.push(row('public-follow-weekend', 'L', {
    'Catalog Membership JSON': JSON.stringify({ ...evaluated,
      memberships: [{ pair: 'bd-band-65-total', direction: 0, filters: [] }] }),
  }));
  const original = select([play({ catalogEvaluation: evaluated })], records)[0];
  assert.match(original.tier, /Moderate Public Follow \+ Monday through Friday/);
  assert.equal(original.rankingRecord, '5-0-0');
  assert.equal(eligibility.isPublicSplitEzpzPick(original), true);
  for (const change of [{ source: 'Best Play' }, { playerName: 'Player' },
    { propMarket: 'Passing Yards' }, { market: 'Moneyline' },
    { selectorVersion: 'retired-selector' }, { trendSubtypeId: 'catalog:unknown:rule:0:|over' },
    { trendSubtypeId: original.trendSubtypeId.replace('bd-band-65-total', 'unknown-rule') },
    { trendSubtypeId: original.trendSubtypeId.replace('monday-through-friday', 'unknown-filter') },
    { trendSubtypeId: original.trendSubtypeId.replace('|over', '|favorite spread') }]) {
    assert.equal(eligibility.isPublicSplitEzpzPick({ ...original, ...change }), false, JSON.stringify(change));
  }
  const policyImports = {
    './ncaafEzpzPolicy': policy,
    './nflEzpzPolicy': load(path.join(root, 'lib/nflEzpzPolicy.ts')),
    './ezpzPublicSplitEligibility': eligibility,
  };
  let stored = [];
  const current = moduleWithStubs('lib/ezpzCurrentPicks.ts', {
    ...policyImports,
    './tursoStore': { replaceTursoDataset: async (_s, _d, rows) => { stored = rows; },
      readTursoDataset: async () => stored },
    './ezpzMcpEvents': { captureEzpzFinalPickEvents: async () => ({}) },
  });
  await current.persistEzpzCurrentPicks('NCAAF', { today, aiPicks: [original] });
  const saved = await current.readEzpzCurrentPicks('NCAAF');
  assert.equal(saved.pickCount, 1);
  assert.equal(saved.picks[0].trendSubtypeId, original.trendSubtypeId);
  assert.equal(saved.picks[0].rankingLastSeven.record, '5-0-0');
  const board = moduleWithStubs('app/FootballBoard.tsx', {
    '../lib/footballTrendCatalog': catalog,
    '../lib/ncaafEzpzPolicy': policy, '../lib/ncaafTrendRecordPolicy': recordPolicy,
    '../lib/ezpzPublicSplitEligibility': eligibility,
    './TeamLogoName': { TeamLogoName: p => p.team, MatchupWithLogos: p => p.game,
      SelectionWithTeamLogo: p => p.selection },
  });
  const html = renderToStaticMarkup(require('react').createElement(board.default,
    { sport: 'NCAAF', tab: 'EZPZ Picks', data: { today, aiPicks: saved.picks } }));
  assert.match(html, /Over 54/);
  assert.match(html, /L7 5-0-0/);
  assert.doesNotMatch(html, /No NCAAF EZPZ Picks right now/);
  const history = moduleWithStubs('app/FootballBoardLegacy.tsx', {
    '../lib/ezpzPublicSplitEligibility': eligibility,
  }, '\nexport const recordsTest = footballEzpzHistoryRows;');
  assert.equal(history.recordsTest({ ncaafEzpzTrendLeaderboard: [],
    aiPickRecordRows: [{ ...original, result: 'W' }] }, 'NCAAF').length, 1);
});
