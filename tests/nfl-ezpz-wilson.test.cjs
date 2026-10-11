const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { renderToStaticMarkup } = require('react-dom/server');
const load = require('./load-typescript.cjs');
const root = path.join(__dirname, '..');
const nfl = load(path.join(root, 'lib/nflPublicTrendLeaderboard.ts'));
const wilson = load(path.join(root, 'lib/nflEzpzWilson.ts'));
const policy = load(path.join(root, 'lib/nflEzpzPolicy.ts'));
const records = load(path.join(root, 'lib/nflEzpzRecords.ts'));
const identity = load(path.join(root, 'lib/nflTrendIdentity.ts'));
const ncaa = load(path.join(root, 'lib/ncaafPublicTrendLeaderboard.ts'));
const ncaaPolicy = load(path.join(root, 'lib/ncaafEzpzPolicy.ts'));
const finalPolicy = load(path.join(root, 'lib/ncaafTrendRecordPolicy.ts'));
const eligibility = load(path.join(root, 'lib/ezpzPublicSplitEligibility.ts'));
const today = '2026-10-18';
let clock = Date.parse(`${today}T16:50:00Z`);
class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } }

function moduleWithStubs(file, imports = {}, appended = '', date = Date, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8') + appended, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { exports, Date: date, Intl, console, process, ...globals,
    require: name => imports[name] || (name.startsWith('.') ? {} : require(name)),
  });
  return exports;
}
const weekly = moduleWithStubs('lib/footballWeeklyMarket.ts', {}, '\nexport const timingTest = { resolveNcaafSnapshot };', FixedDate);
const core = moduleWithStubs('lib/footballPublicDataCore.ts', {
  './footballWeeklyMarket': weekly, './ncaafEzpzPolicy': ncaaPolicy, './ncaafTrendRecordPolicy': finalPolicy,
  './nflTrendIdentity': identity,
}, '\nexport const testRecords = buildFootballFinalTrendRecordRows;', FixedDate);
const board = moduleWithStubs('app/FootballTrendMarketBoard.tsx', {
  '../lib/ncaafEzpzPolicy': ncaaPolicy, '../lib/ncaafTrendRecordPolicy': finalPolicy,
  '../lib/ncaafPublicTrendLeaderboard': ncaa, '../lib/nflPublicTrendLeaderboard': nfl,
  './TeamLogoName': { SelectionWithTeamLogo: p => p.selection, TeamLogoName: p => p.team },
});

function row(i, result = 'W', overrides = {}) {
  return { Date: '2026-10-04', Game: `Visitor${i} @ Host${i}`, 'Game Key': `game-${i}`,
    'Game Time': '2026-10-04T17:00:00Z', Market: 'Total', Side: 'Over', Selection: 'Over',
    'Public Split Selection': 'Over', 'Public Split Line': '46.5', 'Public Split Odds': '-110',
    'Public Bets %': '20', 'Public Money %': '50', 'Opening Public %': '20',
    'Snapshot Status': 'FINAL_PREGAME', 'Record Snapshot Policy': finalPolicy.NCAAF_TREND_RECORD_POLICY,
    'Public Split Snapshot Time': '2026-10-04T16:45:00Z',
    Result: result, 'Result Updated': '2026-10-04T21:00:00Z', ...overrides };
}
function history(wins, losses, market = 'Total', prefix = '') {
  return Array.from({ length: wins + losses }, (_, i) => row(`${prefix}${i}`, i < wins ? 'W' : 'L',
    market === 'Spread' ? { Market: 'Spread', Side: '', Selection: 'Visitor', 'Public Split Selection': 'Visitor', 'Public Split Line': '3' } : {}));
}
function play(overrides = {}) {
  return { date: today, game: 'KC @ LV', gameKey: 'kc-lv', gameTime: `${today}T17:00:00Z`,
    awayTeam: 'KC', homeTeam: 'LV', market: 'Total', side: 'Over', selection: 'Over', line: 46.5,
    betsPct: 20, moneyPct: 50, odds: '-110', snapshotStatus: 'FINAL_PREGAME',
    frozenAt: `${today}T16:45:00Z`, updatedAt: `${today}T16:45:00Z`, ...overrides };
}
function select(plays, rows, archived = [], at = clock) { return wilson.selectNflWilsonEzpzPicks(plays, rows, today, at, archived); }

test('NFL uses the same one-sided 95% score, strict >60% gate, positive profit, no sample minimum, and top-20 cap', () => {
  const subtype = (name, wins, losses, netUnits = wins / 1.1 - losses) => ({
    id: name, signal: name, category: 'Over', label: name,
    totals: { wins, losses, netUnits, unitsWon: netUnits, pushes: 100, totalBets: wins + losses + 100 },
  });
  assert.ok(Math.abs(wilson.nflWilsonLowerBound(10, 5) * 100 - 45.517214735) < 1e-6);
  const ranked = wilson.rankNflEzpzSubtypes([subtype('4-1', 4, 1), subtype('10-5', 10, 5),
    subtype('60%', 3, 2), subtype('zero profit', 4, 1, 0), subtype('one bet', 1, 0)]);
  assert.deepEqual(Array.from(ranked, s => s.id), ['10-5', '4-1', 'one bet']);
  assert.equal(wilson.rankNflEzpzSubtypes(Array.from({ length: 1000 }, (_, i) => subtype(`type${i}`, 4, 1))).length, 20);
});

test('the NCAAF Sharp, Public Fade, RLM, total-drop, and spread-ticket predicates apply to NFL unchanged', () => {
  const examples = [
    [play()],
    [play({ openingLine: 48 })],
    [play({ market: 'Spread', side: '', selection: 'KC', line: -3, openingLine: -2,
      openingBetsPct: 40, betsPct: 47, moneyPct: 47 })],
    [play({ betsPct: 20, moneyPct: 20 }), play({ side: 'Under', selection: 'Under', betsPct: 80, moneyPct: 20 })],
    [play({ betsPct: 20, moneyPct: 20 }), play({ side: 'Under', selection: 'Under', betsPct: 60, moneyPct: 60,
      openingBetsPct: 50, publicMovementPct: 10, lineMovementValue: -1.5, lineMovementBasis: 'Total Line' })],
  ];
  for (const plays of examples) assert.deepEqual(Array.from(nfl.nflTrendSignals(plays[0], plays)), Array.from(ncaa.ncaafTrendSignals(plays[0], plays)));
  assert.ok(nfl.nflTrendSignals(examples[3][0], examples[3]).includes('Public Fade'));
  examples[3][1].moneyPct = 30;
  assert.equal(nfl.nflTrendSignals(examples[3][0], examples[3]).includes('Public Fade'), false);
});

test('NFL movement cohorts retain their one-hour observation definition and never become automatic picks', () => {
  const p = play({ openingMoneyPct: 30, lineMovementBasis: 'Total Line', lineMovementValue: 1,
    firstTrackedAt: `${today}T15:45:00Z` });
  assert.deepEqual(Array.from(nfl.nflTrendSignals(p, [p])), ['Sharp', 'Market Move', 'Total Money Momentum', 'Market Move + Total Money Momentum']);
  assert.equal(nfl.nflTrendSignals({ ...p, firstTrackedAt: `${today}T15:45:01Z` }, [p]).includes('Market Move'), false);
  assert.equal(select([p], []).length, 0);
});

test('verified records count one physical NFL game across abbreviations, full names, and reversed matchup labels', () => {
  const a = row('one', 'W', { Game: 'KC @ LV' });
  const b = { ...a, Game: 'Kansas City Chiefs at Las Vegas Raiders', 'Game Key': 'alias' };
  const c = { ...a, Game: 'LV vs KC', 'Game Key': 'reverse' };
  assert.equal(nfl.buildNflTrendSubtypes([a, b, c])[0].totals.record, '1-0-0');
  assert.equal(nfl.buildNflTrendSubtypes([a, { ...a, 'Record Snapshot Policy': '', Game: 'Unknown @ Game' }])[0].totals.totalBets, 1);
});

test('both NFL public tables and badges use the same top-20 list, independent of NCAAF data', () => {
  const list = Array.from({ length: 30 }, (_, i) => ({ id: `type${i}`, signal: i === 0 ? 'Sharp' : `Type ${i}`,
    category: 'Over', label: i === 0 ? 'Sharp - Over' : `Type ${i} - Over`,
    totals: { wins: 30 - i, losses: 1, pushes: 0, record: `${30 - i}-1-0`, totalBets: 31 - i,
      winPct: (30 - i) / (31 - i) * 100, unitsWon: 1, roiPct: 1 } }));
  const html = renderToStaticMarkup(board.DirectTrendRecords({ sport: 'NFL', rows: [], nflLeaderboard: list,
    ncaafLeaderboard: [{ ...list[0], label: 'Wrong sport' }] }));
  assert.equal((html.match(/data-trend-subtype=/g) || []).length, 20);
  assert.match(html, /Top 20 NFL/);
  assert.doesNotMatch(html, /Wrong sport/);
  assert.equal(nfl.visibleNflTrendBadges(play(), [play()], list).length, 1);
  assert.equal(nfl.visibleNflTrendBadges(play(), [play()], [...list.slice(1, 21), list[0]]).length, 0);
  const splitHtml = renderToStaticMarkup(board.FootballTrendMarketBoard({ sport: 'NFL',
    groups: [{ game: 'KC @ LV', plays: [play()] }], nflLeaderboard: list }));
  assert.match(splitHtml, /data-trend-subtype="type0"/);
});

test('rankings use only results settled before the decision and exclude the current game under every NFL alias', () => {
  const known = row('known');
  const late = row('late', 'W', { 'Result Updated': `${today}T18:00:00Z` });
  const unknown = row('unknown', 'W', { 'Result Updated': '' });
  const own = row('own', 'W', { Date: today, Game: 'Kansas City Chiefs at Las Vegas Raiders',
    'Game Time': `${today}T15:00:00Z`, 'Result Updated': `${today}T16:00:00Z` });
  assert.equal(wilson.buildNflEzpzLeaderboard([known, late, unknown, own], clock, play())[0].totals.record, '1-0-0');
});

test('Wilson ordering selects a better-supported NFL spread over the retired combined-total priority', () => {
  const spread = play({ market: 'Spread', side: '', selection: 'KC', selectionTeam: 'KC', line: 3 });
  const total = play({ openingMoneyPct: 30, lineMovementBasis: 'Total Line', lineMovementValue: 1,
    firstTrackedAt: `${today}T14:45:00Z` });
  const picks = select([total, spread], [...history(4, 1), ...history(10, 5, 'Spread', 'spread')]);
  assert.equal(picks.length, 1);
  assert.equal(picks[0].selection, 'KC +3');
  assert.equal(picks[0].trendSubtypeId, 'sharp|underdog spread');
  assert.equal(picks[0].trendRank, 1);
  assert.equal(picks[0].rankingRecord, '10-5-0');
});

test('missing prices default to -110; the -150 cap, final window, and model/prop exclusions match NCAAF', () => {
  const rows = history(4, 1);
  assert.equal(select([play({ odds: '' })], rows)[0].odds, '-110');
  assert.equal(select([play({ odds: '-150' })], rows).length, 1);
  for (const p of [play({ odds: '-151' }), play({ odds: 'invalid' }), play({ source: 'Best Play' }),
    play({ playerName: 'A Player' }), play({ propMarket: 'Receiving Yards' }),
    play({ frozenAt: `${today}T16:39:59Z` }), play({ frozenAt: `${today}T16:50:01Z` }),
    play({ snapshotStatus: 'MISSED_LOCK' }), play({ gameTime: '' })]) assert.equal(select([p], rows).length, 0);
  assert.equal(select([play({ snapshotStatus: 'LIVE' })], rows).length, 1);
  assert.equal(select([play({ snapshotStatus: 'LIVE' })], rows, [], Date.parse(`${today}T17:00:00Z`)).length, 0);
});

test('NFL wall clocks resolve to the right ET date and final grading uses the actual locked line', () => {
  assert.equal(weekly.nflKickoffIso(today, '1:00 PM'), `${today}T17:00:00.000Z`);
  assert.equal(weekly.nflKickoffIso('2026-11-08', '13:00'), '2026-11-08T18:00:00.000Z');
  assert.equal(weekly.nflKickoffIso(today, ''), '');
  const score = { Date: today, Game: 'Kansas City Chiefs @ Las Vegas Raiders',
    'Away Team': 'Kansas City Chiefs', 'Home Team': 'Las Vegas Raiders',
    Result: 'L', 'Actual Away Runs': '27', 'Actual Home Runs': '21', 'Result Updated': `${today}T20:00:00Z` };
  const rows = core.testRecords([play({ gameTime: '13:00', line: 47.5 }),
    play({ market: 'Spread', side: '', selection: 'KC', selectionTeam: 'KC', line: -5.5, gameTime: '13:00' })], [score], 'NFL');
  assert.equal(rows.length, 2);
  assert.deepEqual(Array.from(rows, r => r.Result), ['W', 'W']);
  assert.equal(rows[0]['Game Time'], `${today}T17:00:00.000Z`);
  assert.equal(rows[0]['Record Snapshot Policy'], finalPolicy.NCAAF_TREND_RECORD_POLICY);
  assert.equal(core.testRecords([play()], [{ ...score, Result: 'Pending' }], 'NFL').length, 0);
  assert.equal(core.testRecords([play({ frozenAt: `${today}T16:00:00Z` })], [score], 'NFL').length, 0);
});

test('the shared capture resolver chooses a real T-15 observation and misses lock when only stale data exists', () => {
  const marketRows = ['16:39:00', '16:44:00', '16:49:00'].map((time, i) => ({ Date: today,
    'Game Key': 'kc-lv', Market: 'Total', Selection: 'Over', Side: 'Over',
    'Snapshot Time ET': `${today}T${time}Z`, 'Bets %': '20', 'Handle %': '50', Line: String(45 + i), Odds: '-110' }));
  const resolved = weekly.timingTest.resolveNcaafSnapshot(play({ snapshotStatus: 'LIVE', signals: [] }), marketRows, []);
  assert.equal(resolved.snapshotStatus, 'FINAL_PREGAME');
  assert.equal(resolved.frozenAt, `${today}T16:44:00Z`);
  assert.equal(resolved.line, 46);
  const missed = weekly.timingTest.resolveNcaafSnapshot(play({ snapshotStatus: 'LIVE' }), marketRows.slice(0, 1), []);
  assert.equal(missed.snapshotStatus, 'MISSED_LOCK');
});

test('scheduled NFL collection saves the newest live observation once and freezes its real in-window quote', async () => {
  const tables = { schedule: [{ Date: today, 'Away Team': 'KC', 'Home Team': 'LV', 'Game Time': '13:00' }],
    daily_slate: [], all_game_trends: [], posted_games: [], weekly_market_trends: [], odds_snapshot: [] };
  const writes = [];
  const storage = {
    ensureSportWorksheet: async () => {}, readSportWorksheet: async (_sport, tab) => tables[tab] || [],
    readSportWorksheetByDateKeys: async (_sport, tab) => tables[tab] || [],
    writeSportWorksheet: async (_sport, tab, _headers, rows) => { tables[tab] = rows; },
    appendSportRows: async (_sport, tab, _headers, rows) => { tables[tab] = [...(tables[tab] || []), ...rows]; },
    upsertSportRows: async (_sport, tab, _headers, rows, key) => {
      writes.push({ tab, count: rows.length });
      const merged = new Map((tables[tab] || []).map(r => [key(r), r]));
      for (const row of rows) merged.set(key(row), row);
      tables[tab] = [...merged.values()];
    },
  };
  let feed = [];
  const collector = moduleWithStubs('lib/footballWeeklyMarket.ts', {
    './sportSheets': storage, './scoresAndOddsBettingSplits': { SCORES_AND_ODDS_SOURCE: 'ScoresAndOdds' },
  }, '\nloadPostedSplits = async () => ({ splits: testFeed(), errors: [] });\nexport const rowTest = weeklyRow;',
  FixedDate, { testFeed: () => feed });
  const initial = play({ gameKey: `${today}|kc|lv`, gameTime: '13:00', snapshotStatus: 'LIVE',
    updatedAt: `${today}T14:00:00Z`, frozenAt: undefined, sideGroup: 'Over', signals: [],
    score: 50, baseScore: 50, tier: 'Pass', firstTrackedAt: `${today}T14:00:00Z`,
    movementHistory: [{ snapshotTime: `${today}T14:00:00Z`, line: 46.5, odds: '-110', betsPct: 20, moneyPct: 50 }] });
  tables.weekly_market_trends = [collector.rowTest(initial)];
  feed = [{ ...initial, eventTime: '13:00', line: 47.5, warningKey: '', warning: '', warningTone: 'neutral', warningNegative: false }];
  clock = Date.parse(`${today}T16:30:00Z`);
  await collector.syncPostedFootballMarkets('NFL');
  let stored = JSON.parse(tables.weekly_market_trends[0]['Details JSON']);
  assert.equal(stored.line, 47.5);
  assert.equal(stored.snapshotStatus, 'LIVE');
  assert.equal(writes.filter(w => w.tab === 'weekly_market_trends').at(-1).count, 1);
  clock = Date.parse(`${today}T16:46:00Z`);
  feed[0].line = 48.5;
  await collector.syncPostedFootballMarkets('NFL');
  stored = JSON.parse(tables.weekly_market_trends[0]['Details JSON']);
  assert.equal(stored.line, 48.5);
  assert.equal(stored.snapshotStatus, 'LIVE');
  clock = Date.parse(`${today}T16:50:00Z`);
  feed[0].line = 50;
  await collector.syncPostedFootballMarkets('NFL');
  stored = JSON.parse(tables.weekly_market_trends[0]['Details JSON']);
  assert.equal(stored.line, 48.5);
  assert.equal(stored.snapshotStatus, 'FINAL_PREGAME');
  assert.equal(Date.parse(stored.frozenAt), Date.parse(`${today}T16:46:00Z`));
  assert.equal(collector.isValidNflFinalSnapshot(stored), true);
  clock = Date.parse(`${today}T16:50:00Z`);
});

test('locked NFL picks and supporting records remain after the subtype falls below 60%', () => {
  const saved = select([play()], history(4, 1))[0];
  assert.equal(wilson.isNflWilsonArchivedPick(saved), true);
  const retained = select([], history(1, 6), [saved])[0];
  assert.equal(retained.rankingRecord, '4-1-0');
  assert.equal(retained.wilsonScore, saved.wilsonScore);
  assert.equal(select([play({ game: 'BUF @ NYJ' })], history(1, 6)).length, 0);
  assert.equal(wilson.isNflWilsonArchivedPick({ ...saved, wilsonScore: 99 }), false);
  assert.equal(records.buildNflEzpzRecords([{ ...saved, result: 'L' }], today).overall.record, '0-1-0');
});

test('the NFL API freezes the original decision, grades it later, and preserves posted legacy results', async () => {
  clock = Date.parse(`${today}T16:50:00Z`);
  const spread = play({ market: 'Spread', side: '', selection: 'KC', selectionTeam: 'KC', line: 3 });
  const legacy = { date: '2026-10-05', game: 'ATL @ NO', market: 'Total', selection: 'Under 47.5',
    source: 'Trend Play', tier: 'Market Move', odds: '-110', snapshotStatus: 'FINAL_PREGAME', result: 'L' };
  let stored = [{ Date: legacy.date, 'Pick Key': 'legacy', Game: legacy.game, Market: legacy.market,
    Selection: legacy.selection, Source: legacy.source, Odds: legacy.odds, 'Snapshot Status': legacy.snapshotStatus,
    Result: 'L', 'Details JSON': JSON.stringify(legacy) }];
  const data = { today, trendPlays: [spread], trendRecordRows: history(4, 1, 'Spread'), aiPicks: [], aiSelectorStatus: {} };
  const api = moduleWithStubs('lib/footballPublicDataHistory.ts', {
    './ncaafEzpzPolicy': ncaaPolicy, './ncaafTrendRecordPolicy': finalPolicy,
    './nflEzpzPolicy': policy, './nflEzpzWilson': wilson, './nflEzpzRecords': records, './nflTrendIdentity': identity,
    './ezpzPublicSplitEligibility': eligibility, './footballPublicDataLegacy': { buildFootballPublicData: async () => data },
    './sportSheets': { readSportWorksheet: async () => stored,
      upsertSportRows: async (_sport, _tab, _headers, rows) => {
        const merged = new Map(stored.map(r => [r['Pick Key'], r]));
        for (const r of rows) merged.set(r['Pick Key'], r);
        stored = [...merged.values()];
      } },
  }, '', FixedDate);
  const first = await api.buildFootballPublicData('NFL', { persist: true });
  assert.equal(first.aiPicks.length, 1);
  assert.equal(first.aiSelectorStatus.selectorVersion, policy.NFL_EZPZ_POLICY_VERSION);
  const saved = stored.find(r => r.Game === spread.game);
  const details = JSON.parse(saved['Details JSON']);
  assert.equal(details.rankingRecord, '4-1-0');
  assert.equal(details.rankingLastSeven.record, '4-1-0');
  data.trendPlays = [];
  data.trendRecordRows = [...history(1, 6, 'Spread'), row('current', 'L', { Date: today, Game: spread.game,
    Market: 'Spread', Selection: 'KC', Side: '', 'Public Split Selection': 'KC', 'Public Split Line': '3',
    'Game Time': spread.gameTime, 'Result Updated': `${today}T20:00:00Z` })];
  clock = Date.parse(`${today}T21:00:00Z`);
  const next = await api.buildFootballPublicData('NFL', { persist: true });
  assert.equal(next.aiPicks[0].result, 'L');
  assert.equal(next.aiPicks[0].wilsonScore, details.wilsonScore);
  assert.equal(next.aiPickRecordRows.find(p => p.game === legacy.game).result, 'L');
  assert.equal(stored.find(r => r.Game === spread.game)['Saved At'], saved['Saved At']);
  clock = Date.parse(`${today}T16:50:00Z`);
});

test('NFL previews stay out of official history until final; the card displays its captured score and last seven', () => {
  const saved = select([play()], history(4, 1))[0];
  const tile = moduleWithStubs('app/FootballBoard.tsx', {
    '../lib/ncaafEzpzPolicy': ncaaPolicy, '../lib/ncaafTrendRecordPolicy': finalPolicy,
    '../lib/nflEzpzPolicy': policy, '../lib/ezpzPublicSplitEligibility': eligibility,
    './TeamLogoName': { TeamLogoName: p => p.team, MatchupWithLogos: p => p.game, SelectionWithTeamLogo: p => p.selection },
  }, '\nexport const cardTest = HistoryPickCard;');
  const html = renderToStaticMarkup(tile.cardTest({ pick: saved, sport: 'NFL', viewingToday: true,
    data: { today, trendRecordRows: history(0, 7) } }));
  assert.match(html, /Wilson ranking/);
  assert.match(html, /43\.5/);
  assert.match(html, /L7 4-1-0/);
  assert.doesNotMatch(html, /L7 0-7-0/);
  assert.equal(records.buildNflEzpzRecords([{ ...saved, snapshotStatus: 'LIVE', result: 'W' }], today).history.length, 0);
});
