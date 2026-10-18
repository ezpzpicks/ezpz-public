const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript'), React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const exportsObject = {};
const source = fs.readFileSync(path.join(root, 'app/FootballSignalsBoard.tsx'), 'utf8') + '\nexport const detailTest = SignalDetail;';
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
  { exports: exportsObject, Date, Intl, console, require: name => name === './TeamLogoName' ? { TeamLogoName: p => p.team } : require(name) });
const keys = ['money', 'move', 'system', 'team', 'model'];
const team = name => ({ team: name, venue: 'Away', role: 'Favorite', opposing: name === 'GB', score: 80, trackedGames: 5, seasonGames: 5, missingGames: 0,
  records: Object.fromEntries([['betType', 'Favorite ATS', 50], ['venue', 'Away ATS', 30], ['recent', 'Last 5 ATS', 20]].map(([k, label, weight]) => [k,
    { label, weight, record: '4-1-0', sample: 5, supportPct: 80, gameKeys: [] }])) });
const side = { id: 'game|Spread|dal', date: '2026-10-18', gameKey: 'game', game: 'DAL @ GB', gameTime: '2026-10-19T00:20:00Z',
  awayTeam: 'DAL', homeTeam: 'GB', market: 'Spread', side: 'dal', selection: 'DAL -1.5', line: -1.5, odds: '-110',
  status: 'LIVE', snapshotAt: '2026-10-18T23:00:00Z', recorded: false, signalCount: 4, sourceCount: 2, candidate: true, selected: true, mixed: false,
  combination: 'money + move + system + team', signals: keys.map((key, i) => ({ key, active: key !== 'model', available: key !== 'model', value: [27, .5, 60, 80, null][i], level: 'Qualifying', reason: 'Existing qualification rules.' })),
  teamTrend: { score: 80, version: 'team-trends-v2', method: 'Raw hit rates', scope: 'Current-season games', capturedAt: '2026-10-18T23:00:00Z',
    teams: [team('DAL'), team('GB')], weights: { betType: 50, venue: 30, recent: 20 } },
  teamGames: [{ team: 'DAL', date: '2026-10-11', opponent: 'BAL', venue: 'Away', line: 2.5, result: 'W' }],
  publicMatches: [1, 2].map(rank => ({ id: 'system' + rank, rank, label: 'Matched system ' + rank, wilsonScore: 60,
    totals: { record: '8-2-0', totalBets: 10, winPct: 80, unitsWon: 5.27, roiPct: 52.7 }, lastSevenTotals: { record: '6-1-0', totalBets: 7 },
    rules: ['Tickets below 45%', 'Market moved toward this side'], selectionDescription: 'Selected spread side' })),
  marketContext: { bets: 33, money: 60, openingBets: 40, openingMoney: 45, openingLine: -1, openingOdds: '-110', publicChange: -7, moneyChange: 15,
    movementBasis: 'Spread Line', movementLabel: 'Line Movement Confirmation', history: [{ snapshotTime: '2026-10-18T23:00:00Z', line: -1.5, odds: '-110', betsPct: 33, moneyPct: 60 }] },
  modelContext: { grade: '', play: '', projection: null, line: null, probability: null, version: '', reason: 'No model run is available.' },
  sosContext: { teams: [], sourceUrl: '', capturedAt: '', gap: null }, result: '' };
const opposite = { ...side, id: 'game|Spread|gb', selection: 'GB +1.5', line: 1.5, side: 'gb', signalCount: 0, selected: false, candidate: false,
  signals: side.signals.map(signal => ({ ...signal, active: false, value: signal.value == null ? null : -signal.value })) };
const board = { sport: 'NFL', today: '2026-10-18', captureAvailable: true, sides: [side, opposite],
  summary: { record: '0-0-0', settled: 0, pending: 0, winPct: null, roiPct: null, netUnits: 0 }, breakdowns: [], history: [] };
const render = node => renderToStaticMarkup(node);

test('the slate starts collapsed; active money shows +27 while the opposite side stays neutral', () => {
  const html = render(React.createElement(exportsObject.default, { board }));
  assert.equal((html.match(/aria-expanded="false"/g) || []).length, 10);
  assert.equal((html.match(/class="fs-signal fs-on"/g) || []).length, 4);
  assert.match(html, /fs-signal-value">\+27/);
  assert.doesNotMatch(html, /fs-signal-value">-27|class="fs-detail"/);
});

test('public expansion lists every matched system with Wilson rank, complete records, exact rules and last-seven-bet evidence', () => {
  const html = render(React.createElement(exportsObject.detailTest, { side, signal: side.signals[2], onClose() {} }));
  assert.match(html, /#1 · Matched system 1/); assert.match(html, /#2 · Matched system 2/);
  for (const text of ['8-2-0', '6-1-0', '52.7%', 'Tickets below 45%', 'Signals contributed', 'one-sided 95%']) assert(html.includes(text), text);
  assert.doesNotMatch(html, /Last 7 days/);
});

test('team expansion shows both teams, all weighted records, included games, missing-data counts and the grade calculation', () => {
  const html = render(React.createElement(exportsObject.detailTest, { side, signal: side.signals[3], onClose() {} }));
  for (const text of ['DAL', 'GB', 'Favorite ATS', 'Away ATS', 'Last 5 ATS', '50% weight', '30% weight', '20% weight', '4-1-0', 'BAL', 'Missing historical lines', 'Final grade calculation']) assert(html.includes(text), text);
});
