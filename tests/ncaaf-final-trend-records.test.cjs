const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { renderToStaticMarkup } = require('react-dom/server');
const load = require('./load-typescript.cjs');
const root = path.join(__dirname, '..');
const policy = load(path.join(root, 'lib/ncaafTrendRecordPolicy.ts'));
const movement = load(path.join(root, 'lib/ncaafEzpzPolicy.ts'));

function moduleWithStubs(file, imports = {}, appended = '') {
  const exports = {};
  const source = fs.readFileSync(path.join(root, file), 'utf8') + appended;
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  }}).outputText;
  vm.runInNewContext(code, { exports, Date, Intl, console, process,
    require: name => imports[name] || (name.startsWith('.') ? {} : require(name)),
  });
  return exports;
}

const weekly = moduleWithStubs('lib/footballWeeklyMarket.ts');
const core = moduleWithStubs('lib/footballPublicDataCore.ts', {
  './footballWeeklyMarket': weekly, './ncaafEzpzPolicy': movement, './ncaafTrendRecordPolicy': policy,
}, '\nexport const recordsTest = { buildNcaafFinalTrendRecordRows, buildFootballEzpzRecordRows };').recordsTest;
const marketBoard = moduleWithStubs('app/FootballTrendMarketBoard.tsx', {
  '../lib/ncaafEzpzPolicy': movement, '../lib/ncaafTrendRecordPolicy': policy,
});
const tile = moduleWithStubs('app/FootballBoard.tsx', {
  '../lib/ncaafEzpzPolicy': movement, '../lib/ncaafTrendRecordPolicy': policy,
}, '\nexport const tileTest = { directTrendRecord, directTrendTypes };').tileTest;

const kickoff = '2026-09-26T19:00:00-04:00';
function finalPlay(overrides = {}) {
  return { date: '2026-09-26', game: 'Army @ Temple', gameKey: 'one', gameTime: kickoff,
    awayTeam: 'Army', homeTeam: 'Temple', market: 'Total', selection: 'Over', selectionTeam: '', side: 'Over',
    line: 52.5, odds: '-110', betsPct: 60, moneyPct: 90, openingLine: 54.5,
    openingBetsPct: 50, openingMoneyPct: 60, snapshotStatus: 'FINAL_PREGAME',
    frozenAt: '2026-09-26T18:45:00-04:00', updatedAt: '2026-09-26T18:45:00-04:00', ...overrides };
}
function score(overrides = {}) {
  return { Date: '2026-09-26', Game: 'Army @ Temple', 'Away Team': 'Army', 'Home Team': 'Temple',
    Market: 'Total', Selection: 'Over', Side: 'Over', Line: '54.5', Result: 'L',
    'Actual Away Runs': '31', 'Actual Home Runs': '22', 'Actual Total': '999', ...overrides };
}
function build(plays, scores = [score()]) { return core.buildNcaafFinalTrendRecordRows(plays, scores); }
function recordHtml(rows, extras = {}) {
  return renderToStaticMarkup(marketBoard.DirectTrendRecords({ rows, sport: 'NCAAF', ...extras }));
}

test('final records accept inclusive T-20 and T-10 but reject stale, LIVE, missed and unknown-time captures', () => {
  for (const frozenAt of ['2026-09-26T18:40:00-04:00', '2026-09-26T18:50:00-04:00']) {
    assert.equal(build([finalPlay({ frozenAt })]).length, 1);
  }
  for (const overrides of [
    { frozenAt: '2026-09-26T18:39:59-04:00' }, { frozenAt: '2026-09-26T18:50:01-04:00' },
    { frozenAt: '2026-09-26T19:05:00-04:00' }, { snapshotStatus: 'LIVE' },
    { snapshotStatus: 'MISSED_LOCK' }, { gameTime: '' }, { frozenAt: '', updatedAt: '' },
  ]) assert.equal(build([finalPlay(overrides)]).length, 0, JSON.stringify(overrides));
});

test('all trend grades use the locked line and final score, ignoring the older cached grade and total', () => {
  const rows = build([finalPlay()]);
  assert.equal(rows[0].Result, 'W'); // 53 beats locked 52.5, despite cached L at 54.5.
  assert.equal(rows[0]['Public Split Line'], '52.5');
  assert.equal(policy.isVerifiedNcaafTrendRecord(rows[0]), true);
  const fau = finalPlay({ awayTeam: 'Florida Atlantic', homeTeam: 'Florida', game: 'Florida Atlantic @ Florida',
    market: 'Spread', selection: 'Florida Atlantic', selectionTeam: 'Florida Atlantic', side: '', line: 25.5, openingLine: 26.5 });
  const wrongSavedWin = score({ Game: fau.game, 'Away Team': fau.awayTeam, 'Home Team': fau.homeTeam,
    Market: 'Spread', Selection: fau.selection, Result: 'W', 'Actual Away Runs': '21', 'Actual Home Runs': '66' });
  assert.equal(build([fau], [wrongSavedWin])[0].Result, 'L');
});

test('unfinished games and games without a usable completed score never enter records', () => {
  assert.equal(build([finalPlay()], [score({ Result: 'Pending' })]).length, 0);
  assert.equal(build([finalPlay()], [score({ 'Actual Away Runs': '', 'Actual Home Runs': '' })]).length, 0);
  assert.equal(build([finalPlay()], [score({ Date: '2026-09-19' })]).length, 0);
});

test('duplicate storage IDs count one decision and movement is recalculated from the final endpoints', () => {
  const rows = build([finalPlay(), finalPlay({ gameKey: 'alias', lineMovementValue: 200, publicMovementPct: 100 })]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]['Line Movement Value'], '-2');
  assert.equal(rows[0]['Public Change %'], '10');
  assert.match(recordHtml(rows), /Total Drop Fade - Overall/);
  assert.match(recordHtml(rows), /1-0-0/);
});

test('the records table cannot recover stale games from legacy rows, final-label plays or saved pick history', () => {
  const valid = build([finalPlay()]);
  const legacy = { ...valid[0], Date: '2026-09-19', Game: 'Stale @ Old', 'Record Snapshot Policy': '', Result: 'L' };
  const html = recordHtml([...valid, legacy], {
    trendPlays: [finalPlay({ date: '2026-09-19', game: 'Stale @ Old' })],
    aiPickRows: [{ date: '2026-09-19', game: 'Stale @ Old', market: 'Total', selection: 'Over 52.5',
      line: '52.5', odds: '-110', source: 'Trend Play', qualification: 'Total Drop Fade',
      snapshotStatus: 'FINAL_PREGAME', selected: true, result: 'L' }],
  });
  assert.match(html, /Final snapshots only/);
  assert.match(html, /1-0-0/);
  assert.doesNotMatch(html, /1-1-0/);
});

test('Sharp total replay grades only valid final captures at the locked line', () => {
  const under = finalPlay({ side: 'Under', selection: 'Under', line: 54, openingLine: 54, betsPct: 19, moneyPct: 44 });
  const records = core.buildFootballEzpzRecordRows([], [score()], 'NCAAF', [under]);
  assert.equal(records.length, 1);
  assert.equal(records[0].qualification, 'Sharp');
  assert.equal(records[0].selection, 'Under 54');
  assert.equal(records[0].result, 'W');
  assert.equal(records[0].moneyPct, 44);
  for (const override of [{ snapshotStatus: 'LIVE' }, { frozenAt: '2026-09-26T18:30:00-04:00' },
    { moneyPct: 43.9 }, { odds: '-151' }]) {
    assert.equal(core.buildFootballEzpzRecordRows([], [score()], 'NCAAF', [{ ...under, ...override }]).length, 0);
  }
});

test('Sharp tile badges and Over/Under records use separate verified final samples', () => {
  const overWin = finalPlay({ openingLine: 53.5 });
  const overLoss = finalPlay({ game: 'Other @ Teams', awayTeam: 'Other', homeTeam: 'Teams', openingLine: 53.5 });
  const underWin = finalPlay({ game: 'Third @ Game', awayTeam: 'Third', homeTeam: 'Game',
    side: 'Under', selection: 'Under', line: 54, openingLine: 54, betsPct: 19, moneyPct: 44 });
  const rows = build([overWin, overLoss, underWin], [score(),
    score({ Game: overLoss.game, 'Away Team': 'Other', 'Home Team': 'Teams', 'Actual Away Runs': '20', 'Actual Home Runs': '20' }),
    score({ Game: underWin.game, 'Away Team': 'Third', 'Home Team': 'Game' })]);
  const legacy = { ...rows[0], Game: 'Stale @ Old', 'Direct Trend Group Key': 'stale', 'Record Snapshot Policy': '', Result: 'L' };
  assert.deepEqual(Array.from(tile.directTrendTypes({ tier: 'Sharp', qualification: 'Sharp' })), ['Sharp']);
  assert.equal(tile.directTrendRecord([...rows, legacy], 'NCAAF', 'Sharp', 'Over', '2026-10-09').record, '1-1-0');
  assert.equal(tile.directTrendRecord([...rows, legacy], 'NCAAF', 'Sharp', 'Under', '2026-10-09').record, '1-0-0');
});

test('every NCAAF signal uses the verified ledger in the overall table and exact-type last-seven records', () => {
  const over = finalPlay();
  const under = finalPlay({ side: 'Under', selection: 'Under', betsPct: 40, moneyPct: 10, openingBetsPct: 20 });
  const favorite = finalPlay({ game: 'UCLA @ Maryland', awayTeam: 'UCLA', homeTeam: 'Maryland', market: 'Spread',
    selection: 'UCLA', selectionTeam: 'UCLA', side: '', openingLine: -10, line: -11, openingBetsPct: 30, betsPct: 40, moneyPct: 90 });
  const dog = { ...favorite, selection: 'Maryland', selectionTeam: 'Maryland', line: 11, openingLine: 10,
    openingBetsPct: 90, betsPct: 60, moneyPct: 10 };
  const spreadScore = score({ Game: favorite.game, 'Away Team': 'UCLA', 'Home Team': 'Maryland',
    Market: 'Spread', 'Actual Away Runs': '40', 'Actual Home Runs': '14' });
  // Public Fade needs >75 bets and a 55-point money gap on the opposing side.
  const publicSide = finalPlay({ game: 'Public @ Fade', awayTeam: 'Public', homeTeam: 'Fade',
    betsPct: 80, moneyPct: 10, openingBetsPct: 60 });
  const fade = { ...publicSide, side: 'Under', selection: 'Under', betsPct: 20, moneyPct: 90 };
  const rows = build([over, under, favorite, dog, publicSide, fade], [score(), spreadScore,
    score({ Game: publicSide.game, 'Away Team': 'Public', 'Home Team': 'Fade' })]);
  const legacy = rows.map(row => ({ ...row, 'Record Snapshot Policy': '', Result: 'L' }));
  const html = recordHtml([...rows, ...legacy]);
  for (const [signal, betType] of [['RLM', 'Under'], ['Sharp', 'Over'], ['Public Fade', 'Under'],
    ['Total Drop Fade', 'Over'], ['Spread Ticket Momentum', 'Favorite']]) {
    assert.match(html, new RegExp(signal + ' - Overall'));
    const actual = tile.directTrendRecord(rows, 'NCAAF', signal, betType, '2026-10-08');
    const withLegacy = tile.directTrendRecord([...rows, ...legacy], 'NCAAF', signal, betType, '2026-10-08');
    assert.ok(actual.totalBets > 0, signal);
    assert.equal(actual.record, withLegacy.record, signal);
  }
  assert.deepEqual(Array.from(tile.directTrendTypes({ qualification: 'Total Drop Fade' })), ['Total Drop Fade']);
  assert.deepEqual(Array.from(tile.directTrendTypes({ qualification: 'Spread Ticket Momentum' })), ['Spread Ticket Momentum']);
});

test('the production wrapper preserves verified records without overlaying old published pick history', async () => {
  const verified = build([finalPlay()]);
  const legacy = { ...verified[0], 'Record Snapshot Policy': '', Date: '2026-09-19' };
  const data = { trendRecordRows: [...verified, legacy], aiPicks: [],
    aiPickRecordRows: [{ date: '2026-09-19', game: 'Stale @ Old', market: 'Total', source: 'Trend Play',
      qualification: 'Total Drop Fade', selection: 'Over 52.5', result: 'L' }] };
  const publicData = moduleWithStubs('lib/footballPublicData.ts', {
    './footballPublicDataHistory': { buildFootballPublicData: async () => data },
    './sportSheets': { readSportWorksheet: async () => [] }, './ncaafTrendRecordPolicy': policy,
  });
  const response = await publicData.buildFootballPublicData('NCAAF');
  assert.equal(response.trendRecordPolicy, policy.NCAAF_TREND_RECORD_POLICY);
  assert.equal(response.trendRecordRows.length, 1);
  assert.equal(response.trendRecordRows[0].Result, 'W');
});

test('separate RLM totals on the same date remain separate final-snapshot decisions', () => {
  const first = finalPlay();
  const second = finalPlay({ game: 'UCLA @ Maryland', awayTeam: 'UCLA', homeTeam: 'Maryland' });
  const opposite = over => ({ ...over, side: 'Under', selection: 'Under', betsPct: 40, moneyPct: 10 });
  const rows = build([first, opposite(first), second, opposite(second)], [score(),
    score({ Game: second.game, 'Away Team': second.awayTeam, 'Home Team': second.homeTeam })]);
  const html = recordHtml(rows);
  assert.match(html, /RLM - Overall<\/strong><\/td><td[^>]*>0-2-0<\/td>/);
  assert.equal(tile.directTrendRecord(rows, 'NCAAF', 'RLM', 'Under', '2026-10-08').record, '0-2-0');
});
