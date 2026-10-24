const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '..');
const trends = load(path.join(root, 'lib/footballTeamTrends.ts'));
const signals = load(path.join(root, 'lib/footballSignals.ts'));
const logoApi = {};
const logoSource = fs.readFileSync(path.join(root, 'app/TeamLogoName.tsx'), 'utf8')
  + '\nexport const logoTest = { findLogo, selectionTeam, directoryValues };';
vm.runInNewContext(ts.transpileModule(logoSource, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText, { exports: logoApi, require: name => name.startsWith('../lib/')
  ? load(path.join(root, name.replace('../', '') + '.ts')) : require(name) });

const aliases = ['Texas A&M', 'Texas aandm', 'TEXAS AANDM', 'Texas A and M', 'Texas A M', 'Texas AM', 'Texas AandM Aggies'];
const aggiesLogo = 'https://a.espncdn.com/i/teamlogos/ncaa/500/245.png';
const texasLogo = 'https://a.espncdn.com/i/teamlogos/ncaa/500/251.png';
const directory = { 'texas a and m': aggiesLogo, 'texas a and m aggies': aggiesLogo, texas: texasLogo };

test('Texas AandM aliases share the Aggies identity and stay distinct from other Texas schools', () => {
  const key = trends.footballTeamKey('Texas A&M', 'NCAAF');
  for (const name of aliases) assert.equal(trends.footballTeamKey(name, 'NCAAF'), key, name);
  for (const name of ['Texas', 'Texas Longhorns', 'Texas State', 'Texas Tech', 'East Texas A&M', 'Texas A&M-Kingsville']) {
    assert.notEqual(trends.footballTeamKey(name, 'NCAAF'), key, name);
  }
});

test('mixed schedule and market spellings produce one Signals matchup with all four lines and matching model/SOS', () => {
  const date = '2026-10-24', gameTime = '2026-10-24T19:30:00Z', now = Date.parse('2026-10-24T06:00:00Z');
  const base = { date, gameTime, game: 'Texas A&M @ Alabama', awayTeam: 'Texas A&M', homeTeam: 'Alabama',
    snapshotStatus: 'LIVE', updatedAt: new Date(now).toISOString(), odds: '-110', betsPct: 45, moneyPct: 50 };
  const marketPlays = [
    { ...base, market: 'Spread', selection: 'Texas A&M', selectionTeam: 'Texas A&M', line: 13.5 },
    { ...base, market: 'Spread', selection: 'Alabama', selectionTeam: 'Alabama', line: -13.5 },
    { ...base, market: 'Total', selection: 'Over', side: 'Over', line: 50.5 },
    { ...base, market: 'Total', selection: 'Under', side: 'Under', line: 50.5 },
  ];
  const { board, changedRows } = signals.buildFootballSignalsState({ sport: 'NCAAF', now, capture: false,
    storedRows: [], history: new Map(), leaderboard: [],
    sos: { season: 2026, fetchedAt: new Date(now - 60000).toISOString(), sourceUrl: 'https://www.warrennolan.com/fbs/2026/sos-elo',
      teams: ['Texas A&M', 'Alabama'].map((team, i) => ({ team, key: trends.footballTeamKey(team, 'NCAAF'), rank: i ? 3 : 40 })) },
    core: { today: date, trendPlays: marketPlays, trendRecordRows: [],
      slateToday: [{ Date: date, 'Away Team': 'Texas AandM', 'Home Team': 'Alabama', 'Game Time': gameTime,
        'Projected Away': '21', 'Projected Home': '31', 'Projected Total': '52', 'Model Version': 'cfb-test' }],
      bestPlays: [{ ...base, awayTeam: 'Texas AandM', role: 'Spread', play: 'Texas aandm +13.5', playType: 'B Spread' }],
    } });
  assert.equal(board.sides.length, 4);
  assert.equal(new Set(board.sides.map(side => side.gameKey)).size, 1);
  assert(board.sides.every(side => side.line != null && side.status === 'LIVE'));
  assert.deepEqual(Array.from(board.sides, side => side.line).sort((a, b) => a - b), [-13.5, 13.5, 50.5, 50.5]);
  const aggies = board.sides.find(side => side.market === 'Spread' && side.line > 0);
  assert.equal(aggies.modelContext.projection, 10);
  assert.equal(aggies.signals.find(signal => signal.key === 'model').active, true);
  assert.equal(aggies.sosContext.teams[0].team, 'Texas A&M');
  assert.equal(changedRows.length, 0);
});

test('logo and selection rendering use the Aggies for every alias and never fall back to the Longhorns', () => {
  logoApi.logoTest.directoryValues.set('NCAAF', directory);
  for (const name of aliases) {
    assert.equal(logoApi.logoTest.findLogo(directory, name), aggiesLogo, name);
    assert.equal(logoApi.logoTest.findLogo({ texas: texasLogo }, name), '', name);
    const html = renderToStaticMarkup(React.createElement(logoApi.TeamLogoName, { sport: 'NCAAF', team: name }));
    assert(html.includes(aggiesLogo), name);
    assert(!html.includes(texasLogo), name);
    assert(html.includes('Texas A&amp;M'), name);
  }
  assert.equal(logoApi.logoTest.findLogo(directory, 'Texas'), texasLogo);
  assert.equal(logoApi.logoTest.selectionTeam('Texas A&M +13.5', 'Texas AandM @ Alabama'), 'Texas AandM');
  const html = renderToStaticMarkup(React.createElement(logoApi.SelectionWithTeamLogo, {
    sport: 'NCAAF', game: 'Texas AandM @ Alabama', selection: 'Texas A&M +13.5',
  }));
  assert(html.includes(aggiesLogo));
});
