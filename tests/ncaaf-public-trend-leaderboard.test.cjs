const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { renderToStaticMarkup } = require('react-dom/server');
const load = require('./load-typescript.cjs');
const root = path.join(__dirname, '..');
const leaderboard = load(path.join(root, 'lib/ncaafPublicTrendLeaderboard.ts'));

function subtype(signal, wins, losses, category = 'Over', pushes = 0) {
  return { id: leaderboard.ncaafTrendSubtypeId(signal, category), signal, category,
    label: `${signal} - ${category}`, totals: {
      wins, losses, pushes, totalBets: wins + losses + pushes,
      record: `${wins}-${losses}-${pushes}`, winPct: wins + losses ? Math.round(wins / (wins + losses) * 1000) / 10 : 0,
      unitsWon: 0, roiPct: 0,
    } };
}

function verifiedRow(game, result, overrides = {}) {
  return { Date: '2026-10-10', Game: game, 'Game Key': game,
    'Direct Trend Group Key': `2026-10-10|${game}|Total`, Market: 'Total', Side: 'Over', Selection: 'Over',
    'Public Split Line': '52.5', 'Public Split Odds': '-110', 'Public Bets %': '30', 'Public Money %': '60',
    'Snapshot Status': 'FINAL_PREGAME', 'Record Snapshot Policy': 'verified-final-snapshot-v1',
    'Public Split Snapshot Time': '2026-10-10T11:45:00-04:00', Result: result, ...overrides };
}

function moduleWithStubs(file, imports = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { exports, Date, Intl, console, process,
    require: name => imports[name] || (name.startsWith('.') ? {} : require(name)),
  });
  return exports;
}
const board = moduleWithStubs('app/FootballTrendMarketBoard.tsx', {
  '../lib/ncaafEzpzPolicy': load(path.join(root, 'lib/ncaafEzpzPolicy.ts')),
  '../lib/ncaafTrendRecordPolicy': load(path.join(root, 'lib/ncaafTrendRecordPolicy.ts')),
  '../lib/ncaafPublicTrendLeaderboard': leaderboard,
  './TeamLogoName': { SelectionWithTeamLogo: props => props.selection, TeamLogoName: props => props.team },
});

test('the public list ranks exact win rates, then decisions, then stable IDs, with no 50-bet minimum', () => {
  const rows = [subtype('B', 2, 1), subtype('A', 2, 1), subtype('Large', 20, 10), subtype('Small', 1, 0),
    subtype('Push only', 0, 0, 'Over', 100), subtype('Ungraded', 0, 0),
    subtype('Rounded higher', 501, 500), subtype('Rounded lower', 1, 1)];
  const before = JSON.stringify(rows);
  const ranked = leaderboard.rankNcaafPublicTrendSubtypes(rows);
  assert.deepEqual(Array.from(ranked, row => row.signal), ['Small', 'Large', 'A', 'B', 'Rounded higher', 'Rounded lower']);
  assert.equal(JSON.stringify(rows), before);
});

test('verified subtype records remain separate by side; pushes and duplicate storage do not inflate win percentage', () => {
  const first = verifiedRow('One @ Game', 'W');
  const rows = [first, { ...first, 'Game Key': 'alias' }, verifiedRow('Two @ Game', 'L'),
    verifiedRow('Three @ Game', 'P'), verifiedRow('Four @ Game', 'Pending'),
    verifiedRow('Legacy @ Game', 'L', { 'Record Snapshot Policy': '' }),
    verifiedRow('Under @ Game', 'W', { Side: 'Under', Selection: 'Under' })];
  const ranked = leaderboard.buildNcaafPublicTrendLeaderboard(rows);
  const over = ranked.find(row => row.id === 'sharp|over');
  const under = ranked.find(row => row.id === 'sharp|under');
  assert.equal(over.totals.record, '1-1-1');
  assert.equal(over.totals.winPct, 50);
  assert.equal(under.totals.record, '1-0-0');
  assert.equal(over.totals.unitsWon, -0.09);
  assert.equal(leaderboard.buildNcaafPublicTrendLeaderboard([verifiedRow('Push @ Game', 'P')]).length, 0);
});

test('both records consumers and the market badges honor the same twentieth-place boundary', () => {
  const winners = Array.from({ length: 20 }, (_, i) => subtype(`Tracked ${i}`, 20 - i, 0));
  const sharp = subtype('Sharp', 1, 1);
  const all = [sharp, ...winners, subtype('Sharp', 0, 1, 'Under')];
  const publicRows = leaderboard.rankNcaafPublicTrendSubtypes(all);
  assert.equal(publicRows.length, 20);
  const recordsHtml = renderToStaticMarkup(board.DirectTrendRecords({ rows: [], sport: 'NCAAF', ncaafLeaderboard: all }));
  assert.equal((recordsHtml.match(/data-trend-subtype=/g) || []).length, 20);
  assert.doesNotMatch(recordsHtml, /Sharp - Over|Sharp - Under|Overall/);
  const play = { game: 'One @ Game', gameKey: 'one', market: 'Total', side: 'Over', selection: 'Over',
    line: 52.5, odds: '-110', betsPct: 30, moneyPct: 60 };
  const hiddenHtml = renderToStaticMarkup(board.FootballTrendMarketBoard({
    groups: [{ game: play.game, plays: [play] }], sport: 'NCAAF', ncaafLeaderboard: all,
  }));
  assert.doesNotMatch(hiddenHtml, /data-trend-subtype=|dkSignalCount|directTrendBadge sharp/);
  assert.match(hiddenHtml, /One|52.5/); // The split market remains visible.

  const promoted = [subtype('Sharp', 30, 0), ...winners];
  const shownHtml = renderToStaticMarkup(board.FootballTrendMarketBoard({
    groups: [{ game: play.game, plays: [play] }], sport: 'NCAAF', ncaafLeaderboard: promoted,
  }));
  assert.match(shownHtml, /data-trend-subtype="sharp\|over"/);
  assert.match(shownHtml, /dkSignalCount/);
  assert.deepEqual(Array.from(leaderboard.visibleNcaafTrendBadges(play, [play], [subtype('Sharp', 10, 0, 'Under')])), []);
});

test('changing the viewed market week does not rerank badges from that week; the all-time list is shared', () => {
  const rows = [verifiedRow('Old @ Game', 'W', { Date: '2026-09-26' }), verifiedRow('New @ Game', 'L')];
  const allTime = leaderboard.buildNcaafPublicTrendLeaderboard(rows);
  const oldPlay = { market: 'Total', side: 'Over', selection: 'Over', line: 52.5, betsPct: 30, moneyPct: 60 };
  assert.equal(leaderboard.visibleNcaafTrendBadges(oldPlay, [oldPlay], allTime)[0].totals.record, '1-1-0');
});

test('NFL record and badge behavior does not depend on the NCAAF leaderboard', () => {
  const row = verifiedRow('One @ Game', 'W');
  const html = renderToStaticMarkup(board.DirectTrendRecords({ rows: [row], sport: 'NFL' }));
  assert.match(html, /Sharp - Overall/);
  assert.doesNotMatch(html, /Top 20 NCAAF/);
  const play = { game: 'One @ Game', gameKey: 'one', market: 'Total', side: 'Over', selection: 'Over',
    line: 52.5, odds: '-110', betsPct: 30, moneyPct: 60 };
  const splits = renderToStaticMarkup(board.FootballTrendMarketBoard({ groups: [{ game: play.game, plays: [play] }], sport: 'NFL' }));
  assert.match(splits, /directTrendBadge sharp/);
});
