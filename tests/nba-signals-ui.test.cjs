const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript'), React = require('react');
const { renderToStaticMarkup: render } = require('react-dom/server');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, file);
function component(file, overrides = {}, append = '') {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8') + append, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, Date, Intl, console, process, require: name => overrides[name] || (name === './NbaGameLineups' ? lineupComponents : null)
    || (name === './TeamLogoName' ? { TeamLogoName: p => p.team, SelectionWithTeamLogo: p => p.selection, MatchupWithLogos: p => p.game }
      : name.startsWith('../lib/') ? require(path.resolve(__dirname, '..', 'app', name + '.ts')) : require(name)) });
  return exports;
}
const lineupComponents = component('app/NbaGameLineups.tsx');
const football = component('app/FootballSignalsBoard.tsx', {}, '\nexport const testTeamDetail = TeamDetail;');
const markets = component('app/FootballTrendMarketBoard.tsx');
const nba = component('app/NbaPublicSplits.tsx', { './FootballTrendMarketBoard': markets });
const records = component('app/NbaRecords.tsx', { './FootballTrendMarketBoard': markets });
const ezpz = component('app/NbaEzpzPicks.tsx');
const nbaBoard = component('app/NbaBoard.tsx', { 'next/dynamic': { default: loader => String(loader).includes('NbaRecords') ? records.default : () => null },
  './NbaRecords': records, './NbaEzpzPicks': ezpz,
  './TeamLogoName': { MatchupWithLogos: props => props.game } });
const date = '2026-10-22', time = date + 'T23:00:00Z';
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

test('live NBA signals retain the shared five-column controls and collapsed details', () => {
  const html = render(React.createElement(football.default, { board }));
  const nfl = render(React.createElement(football.default, { board: { ...board, sport: 'NFL' } }));
  assert.equal((html.match(/aria-expanded="false"/g) || []).length, 10);
  for (const text of ['NBA Signals', 'Live signals', '3+ signal results', '3+ only', 'Sort by Public bet trends', 'Sort by Team trends', 'Sort by Model edge']) assert(html.includes(text), text);
  assert.match(nfl, /3\+ test results/);
  assert.doesNotMatch(html, /3\+ test results|Saved test play|Prospective testing/);
  assert.doesNotMatch(html, /class="fs-signal fs-on"|class="fs-detail"|Strength of schedule/);
});
test('NBA public market cards retain shared markets and add NBA-only collapsed lineups', () => {
  const groups = [{ game: plays[0].game, plays }];
  const nba = render(React.createElement(markets.FootballTrendMarketBoard, { groups, sport: 'NBA', nbaLeaderboard: [] }));
  const nfl = render(React.createElement(markets.FootballTrendMarketBoard, { groups, sport: 'NFL', nflLeaderboard: [] }));
  assert.match(nba, /class="nbaLineups"/);
  assert.doesNotMatch(nfl, /class="nbaLineups"/);
  assert.doesNotMatch(nba, /<details[^>]*\bopen/);
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
test('a team with no graded history never presents its internal neutral prior as a supporting grade', () => {
  const team = { team: 'Denver Nuggets', score: 50, hasData: false, missingGames: 0,
    records: Object.fromEntries(['betType', 'venue', 'recent'].map(key => [key, { label: key, sample: 0, record: '0-0-0' }])) };
  const html = render(React.createElement(football.testTeamDetail, { side: { market: 'Total', line: 236.5, teamTrend: { score: null, teams: [team] } } }));
  assert.match(html, /Denver Nuggets · Awaiting graded history/);
  assert.match(html, /No matching games/);
  assert.doesNotMatch(html, /supporting grade 50/);
});

const slate = [
  { 'Game ID': 'first', 'Game Time': time, 'Away Team': 'Cleveland Cavaliers', 'Home Team': 'Philadelphia 76ers',
    Completed: 'TRUE', Status: 'STATUS_FINAL', 'Away Score': '106', 'Home Score': '114' },
  { 'Game ID': 'second', 'Game Time': date + 'T23:30:00Z', 'Away Team': 'Denver Nuggets', 'Home Team': 'Oklahoma City Thunder',
    Completed: 'FALSE', Status: 'STATUS_SCHEDULED', 'Away Score': '', 'Home Score': '' },
];
const pregame = { gameId: 'second', modelVersion: 'nba-test', lockedAt: date + 'T23:10:00Z', tipoff: slate[1]['Game Time'], phase: 'pregame',
  away_team: 'Denver Nuggets', home_team: 'Oklahoma City Thunder', away_score: 111.2, home_score: 119.4,
  fair_home_spread: -8.2, home_spread_edge: -.3, total: 230.6, total_edge: -5.9,
  market: { home_spread: -8.5, total: 236.5, as_of: date + 'T23:05:00Z' }, spread_pick: 'Denver Nuggets +8.5', spread_grade: 'Pass',
  total_pick: 'Under 236.5', total_grade: 'A', spreadResult: 'PENDING', totalResult: 'PENDING', availability_mode: 'expected_rotation' };
const early = { ...pregame, lockedAt: date + 'T20:00:00Z', phase: 'early', total_pick: 'Under 237.5', market: { ...pregame.market, total: 237.5 } };
const forecastData = { games: slate, forecasts: [pregame, early], stale: false, splits: [
  { 'Game ID': 'first', Market: 'Spread', Selection: 'Philadelphia 76ers', Line: '-2.5' },
  { 'Game ID': 'first', Market: 'Total', Selection: 'Over', Line: '236.5' },
] };
const renderNba = (tab, data = forecastData) => render(React.createElement(nbaBoard.default, { tab, data }));

test('NBA Full Slate includes scheduled games without a forecast, their actual scores and captured market lines', () => {
  const html = renderNba('Full Slate');
  assert.equal((html.match(/<article /g) || []).length, 2);
  assert(html.indexOf('data-game-id="first"') < html.indexOf('data-game-id="second"'));
  for (const text of ['NBA Full Slate', '2 games', 'Cleveland Cavaliers @ Philadelphia 76ers', 'Final score', '106', '114',
    'No saved model forecast for this matchup.', 'Market home spread · Philadelphia 76ers', '-2.5', 'Denver Nuggets @ Oklahoma City Thunder', 'Under 236.5']) assert(html.includes(text), text);
  assert.equal((html.match(/aria-label="Spread forecast"/g) || []).length, 1);
});
test('NBA model cards keep all comparisons and grades in labeled panels without a wide table', () => {
  const html = renderNba('Today’s Model Plays');
  assert.equal((html.match(/<article /g) || []).length, 1);
  for (const text of ['1 matchup with A/B plays · 2 games on the slate', 'Total forecast', 'Projected score',
    '111.2', '119.4', 'Model total', 'Market total', 'Grade A',
    '5.9 pts', 'Result:', 'PENDING', 'Locked', 'assumed -110', 'Injury availability unchecked']) assert(html.includes(text), text);
  assert.doesNotMatch(html, /<table|nbaScroll|Cleveland Cavaliers|Grade Pass|Spread forecast|Research model/);
});
test('NBA model and Full Slate choose the newest lock regardless of API response order; Records show official summaries', () => {
  for (const forecasts of [[early, pregame], [pregame, early]]) {
    for (const tab of ['Today’s Model Plays', 'Full Slate']) {
      const html = renderNba(tab, { ...forecastData, forecasts });
      assert.match(html, /Pregame refresh/);
      assert.match(html, /Under 236.5/);
      assert.doesNotMatch(html, /Early forecast|Under 237.5/);
    }
  }
  const html = renderNba('Records');
  for (const text of ['NBA Records', 'Model Plays', 'EZPZ Picks', 'Win rate', 'Net units', 'ROI', 'Season', 'Last 7 days', 'not counted twice']) assert(html.includes(text), text);
  assert.doesNotMatch(html, /NBA Model Tracking|Early forecast|Pregame refresh/);
});

test('NBA EZPZ tab has an honest empty state instead of showing model forecasts', () => {
  const html = renderNba('EZPZ Picks');
  assert.match(html, /NBA EZPZ Picks/);
  assert.match(html, /No qualifying NBA EZPZ Picks yet/);
  assert.doesNotMatch(html, /Spread forecast|Total forecast/);
});
test('an unmodeled NBA slate stays complete and never invents a projection, grade or missing market line', () => {
  const html = renderNba('Full Slate', { ...forecastData, forecasts: [], splits: [] });
  assert.equal((html.match(/<article /g) || []).length, 2);
  assert.equal((html.match(/No saved model forecast for this matchup\./g) || []).length, 2);
  assert.equal((html.match(/Not captured/g) || []).length, 4);
  assert.doesNotMatch(html, /Grade |Projected score|Spread forecast|Total forecast/);
  const empty = renderNba('Full Slate', { ...forecastData, games: [], forecasts: [], splits: [] });
  assert.match(empty, /0 games/);
  assert.match(empty, /No NBA games have been collected for this date/);
  assert.doesNotMatch(empty, /<article /);
});
test('RotoWire forecasts identify source-checked availability and distinguish expected from confirmed starters', () => {
  for (const starters_confirmed of [false, true]) {
    const html = renderNba('Today’s Model Plays', { ...forecastData, forecasts: [{ ...pregame, availability_mode: 'rotowire_html', starters_confirmed }] });
    assert.match(html, /RotoWire availability checked/);
    assert(html.includes(starters_confirmed ? 'Starting fives confirmed' : 'Projected starting fives'));
    assert.match(html, /Unresolved statuses remain conditional/);
    assert.doesNotMatch(html, /Injury availability unchecked/);
  }
});
