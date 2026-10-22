const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript'), React = require('react');
const { renderToStaticMarkup: render } = require('react-dom/server');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, file);
function component(file, overrides = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, Date, Intl, console, process, require: name => overrides[name]
    || (name === './TeamLogoName' ? { TeamLogoName: p => p.team, SelectionWithTeamLogo: p => p.selection }
      : name.startsWith('../lib/') ? require(path.resolve(__dirname, '..', 'app', name + '.ts')) : require(name)) });
  return exports;
}
const football = component('app/FootballSignalsBoard.tsx');
const markets = component('app/FootballTrendMarketBoard.tsx');
const nba = component('app/NbaPublicSplits.tsx', { './FootballTrendMarketBoard': markets });
const date = '2026-11-10', time = date + 'T23:00:00Z';
const keys = ['money', 'move', 'system', 'team', 'model'];
const side = name => ({ id: name, date, gameKey: 'nba-game', game: 'Cleveland Cavaliers @ Philadelphia 76ers', gameTime: time,
  market: 'Spread', side: name, selection: name + ' +3.5', line: 3.5, odds: '-110', signals: keys.map(key => ({ key, active: false,
    available: false, value: null, level: 'Unavailable', reason: 'Awaiting NBA history.' })), signalCount: 0, selected: false,
  mixed: false, recorded: false, status: 'LIVE', snapshotAt: date + 'T20:00:00Z', modelContext: { grade: '' } });
const board = { sport: 'NBA', today: date, captureAvailable: true, sides: [side('Cleveland Cavaliers'), side('Philadelphia 76ers')],
  summary: { record: '0-0-0', settled: 0, pending: 0, winPct: null, roiPct: null, netUnits: 0 }, breakdowns: [], history: [] };
const plays = ['Cleveland Cavaliers', 'Philadelphia 76ers'].map((name, i) => ({ date, gameKey: 'nba-game', game: board.sides[0].game,
  gameTime: time, awayTeam: 'Cleveland Cavaliers', homeTeam: 'Philadelphia 76ers', market: 'Spread', selection: name,
  selectionTeam: name, side: '', line: i ? -3.5 : 3.5, odds: '-110', betsPct: 50, moneyPct: 50, updatedAt: date + 'T20:00:00Z',
  snapshotStatus: 'LIVE', movementHistory: [] }));

test('NBA signals use exactly NFL’s five-column markup, 3+ controls and collapsed details', () => {
  const html = render(React.createElement(football.default, { board }));
  const nfl = render(React.createElement(football.default, { board: { ...board, sport: 'NFL' } }));
  assert.equal(html.replaceAll('NBA', 'NFL'), nfl);
  assert.equal((html.match(/aria-expanded="false"/g) || []).length, 10);
  for (const text of ['NBA Signals', '3+ test', '3+ only', 'Sort by Public bet trends', 'Sort by Team trends', 'Sort by Model edge']) assert(html.includes(text), text);
  assert.doesNotMatch(html, /class="fs-signal fs-on"|class="fs-detail"|Strength of schedule/);
});
test('NBA public market cards have identical NFL markup when neither has qualified trends', () => {
  const groups = [{ game: plays[0].game, plays }];
  const nba = render(React.createElement(markets.FootballTrendMarketBoard, { groups, sport: 'NBA', nbaLeaderboard: [] }));
  const nfl = render(React.createElement(markets.FootballTrendMarketBoard, { groups, sport: 'NFL', nflLeaderboard: [] }));
  assert.equal(nba, nfl);
  for (const cls of ['dkTrendGame', 'dkTrendMarketBoard', 'dkTrendBarTrack', 'dkMovementDropdown']) assert(nba.includes(cls), cls);
  assert.doesNotMatch(nba, /directTrendBadge/);
});
test('NBA splits show the shared glossary, game counter, daily selector and honest empty Wilson records', () => {
  const html = render(React.createElement(nba.default, { data: { date, games: [{ Date: date }], trendPlays: plays,
    availableDates: ['2026-11-09', date], leaderboard: [], stale: false } }));
  for (const text of ['Bet Trend Glossary', '1 games', 'View NBA market slate', 'Top 20 NBA Sub Bet Types', 'One-sided 95% Wilson ranking',
    'No sub bet types currently exceed 60% wins from verified final snapshots.']) assert(html.includes(text), text);
  assert.doesNotMatch(html, /<tbody><tr class="recordPerformanceRow/);
});
