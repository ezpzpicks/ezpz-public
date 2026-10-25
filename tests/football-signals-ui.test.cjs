const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript'), React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const exportsObject = {};
const source = fs.readFileSync(path.join(root, 'app/FootballSignalsBoard.tsx'), 'utf8') + '\nexport const detailTest = SignalDetail; export const researchTest = CombinationResearch;';
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
  { exports: exportsObject, Date, Intl, console, require: name => name === './TeamLogoName' ? { TeamLogoName: p => p.team }
    : name === './NbaGameLineups' ? { __esModule: true, default: () => null }
    : ['../lib/signalCombinationResearch', '../lib/signalPicks'].includes(name) ? require('./load-typescript.cjs')(path.join(root, name.replace('../', '') + '.ts')) : require(name) });
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

test('EZPZ shows only qualifying saved signal tests, with NFL two and NCAAF three', () => {
  const frozen = { ...side, recorded: true, status: 'FINAL_PREGAME', snapshotAt: '2026-10-19T00:05:00Z',
    signalCount: 2, selected: false, candidate: false,
    signals: keys.map(key => ({ key, active: ['move', 'model'].includes(key), available: true, value: 2, level: 'Qualifying' })) };
  const data = { ...board, sides: [frozen, opposite] };
  const html = render(React.createElement(exportsObject.default, { board: data, picksOnly: true }));
  for (const text of ['NFL EZPZ Picks', '2+ signals', 'All plays', '2 signals', 'Saved pregame', 'historical', '2+ signal test results'])
    assert(html.toLowerCase().includes(text.toLowerCase()), text);
  assert.match(html, /DAL/); assert.doesNotMatch(html, /GB \+1\.5/);
  assert.equal((html.match(/aria-expanded="false"/g) || []).length, 5);
  const cfb = render(React.createElement(exportsObject.default, { board: { ...data, sport: 'NCAAF' }, picksOnly: true }));
  assert.match(cfb, /3\+ signals/); assert.match(cfb, /No qualifying NCAAF EZPZ Picks/);
  const missing = render(React.createElement(exportsObject.default, { picksOnly: true, sport: 'NCAAM' }));
  assert.match(missing, /NCAAM EZPZ Picks/); assert.match(missing, /3\+ signals/);
});

test('model details distinguish the regraded current quote from the original Strong play', () => {
  const model = { ...side.signals.find(s => s.key === 'model'), available: true, active: true, value: 2.54, level: 'Over' };
  const changed = { ...side, market: 'Total', side: 'Over', selection: 'Over 43.5', line: 43.5,
    modelContext: { play: 'Over 43.5', grade: 'Over', projection: 46, line: 43.5, probability: .5776,
      regraded: true, originalPlay: 'Over 42.5', originalGrade: 'Strong Over', probabilityEstimated: true,
      reason: 'Re-evaluated the saved forecast at this line and price.' } };
  const html = render(React.createElement(exportsObject.detailTest, { side: changed, signal: model, onClose() {} }));
  assert.match(html, /Evaluated model play/);
  assert.match(html, /Over 43\.5/);
  assert.match(html, /Original model play/);
  assert.match(html, /Over 42\.5/);
  assert.match(html, /Original model grade/);
  assert.match(html, /Strong Over/);
  assert.match(html, /Probability estimate at this line/);
  assert.match(html, /57\.8%/);
});

test('an archived inactive vote does not promise a future reevaluation or rewrite the saved count', () => {
  const historical = { ...side, recorded: true, modelContext: { ...side.modelContext,
    reason: 'The current line is worse than the saved qualifying model line; awaiting model re-evaluation.' } };
  const html = render(React.createElement(exportsObject.detailTest, { side: historical, signal: side.signals.find(s => s.key === 'model'), onClose() {} }));
  assert.match(html, /historical vote is preserved/);
  assert.doesNotMatch(html, /awaiting model re-evaluation/);
  assert.match(html, /Adds no signal/);
});

test('retained line-history details explain support even when opening and current quotes are equal', () => {
  const history = { ...side, marketContext: { ...side.marketContext, openingLine: -1.5, movementBasis: 'Spread Line History' } };
  const html = render(React.createElement(exportsObject.detailTest, { side: history, signal: side.signals.find(s => s.key === 'move'), onClose() {} }));
  assert.match(html, /Most recent recorded move/);
  assert.match(html, /\+0\.5 points/);
  assert.match(html, /returned to its opening number/);
});

test('combination research shows exact pairs, counts, overlapping baselines and honest price provenance', () => {
  const research = require('./load-typescript.cjs')(path.join(root, 'lib/signalCombinationResearch.ts'));
  const policy = 'ui-research-v1', now = Date.parse('2026-10-19T05:00:00Z');
  const observation = { ...side, id: 'pair', policyVersion: policy, market: 'Total', line: 44.5, recorded: true,
    status: 'FINAL_PREGAME', snapshotAt: '2026-10-19T00:05:00Z', oddsAssumed: true,
    signalCount: 2, signals: keys.map(key => ({ key, active: ['model', 'team'].includes(key), available: true })),
    result: 'W', resultUpdated: '2026-10-19T04:00:00Z' };
  const report = research.buildSignalResearchReport('NFL', policy, research.buildSignalResearchDays([observation], policy, now));
  const html = render(React.createElement(exportsObject.researchTest, { report, market: 'Total' }));
  for (const text of ['Signal combination research', 'Research period', 'Earlier history', 'Forward test', '2 signals',
    'Team trend + Model', '1-0-0', '+0.9u', '90.9%', 'Individual signal baselines', 'samples overlap',
    'not a one-pick-per-game betting card', 'assumed prices', 'does not automatically qualify']) assert(html.includes(text), text);
  const empty = render(React.createElement(exportsObject.researchTest, { report, market: 'Spread' }));
  assert.match(empty, /No observations/); assert.match(empty, /No saved two-signal/); assert.doesNotMatch(empty, /90\.9%/);
});

test('the slate starts collapsed; active money shows +27 while the opposite side stays neutral', () => {
  const html = render(React.createElement(exportsObject.default, { board }));
  assert.equal((html.match(/aria-expanded="false"/g) || []).length, 10);
  assert.equal((html.match(/class="fs-signal fs-on"/g) || []).length, 4);
  assert.match(html, /fs-signal-value">\+27/);
  assert.doesNotMatch(html, /fs-signal-value">-27|class="fs-detail"/);
});

test('public summary keeps every matched trend and its key performance records', () => {
  const html = render(React.createElement(exportsObject.detailTest, { side, signal: side.signals[2], onClose() {} }));
  assert.match(html, /#1 · Matched system 1/); assert.match(html, /#2 · Matched system 2/);
  for (const text of ['8-2-0', '6-1-0', '52.7%', 'top 20 Wilson-ranked', 'one public signal', 'Adds 1 signal']) assert(html.includes(text), text);
  assert.doesNotMatch(html, /Last 7 days|Exact qualifying conditions|Tickets below 45%|Inputs used for these matches|Contribution to the 3\+ test/);
});

test('team summary keeps both teams and the three relevant records without the game-by-game audit', () => {
  const html = render(React.createElement(exportsObject.detailTest, { side, signal: side.signals[3], onClose() {} }));
  for (const text of ['DAL', 'GB', 'Favorite ATS', 'Away ATS', 'Last 5 ATS', '80 out of 100', 'Qualifies at 75', '4-1-0', 'ATS losses support this play']) assert(html.includes(text), text);
  assert.doesNotMatch(html, /BAL|Games behind these records|Final grade calculation|Evidence captured|Weight version/);
});

test('team details show available ATS records without inventing a grade when the spread is missing', () => {
  const pending = { ...side, line: null, selection: 'DAL', teamTrend: { ...side.teamTrend, score: null,
    teams: side.teamTrend.teams.map(team => ({ ...team, role: null,
      records: { ...team.records, betType: { ...team.records.betType, label: 'Overall ATS' } } })) } };
  const signal = { ...side.signals[3], available: false, active: false, value: null, level: 'Unavailable' };
  const html = render(React.createElement(exportsObject.detailTest, { side: pending, signal, onClose() {} }));
  for (const text of ['Awaiting spread', 'DAL', 'GB', 'Overall ATS', 'Away ATS', 'Last 5 ATS', '4-1-0', 'grade await the line', 'Adds no signal']) assert(html.includes(text), text);
  assert.doesNotMatch(html, /supporting grade|80 out of 100|Team records are awaiting/);
});

test('incomplete totals history stays visible with an explicit pending combined grade', () => {
  const incomplete = { ...side, market: 'Total', side: 'Under', selection: 'Under 44.5', teamTrend: { ...side.teamTrend, score: null,
    teams: side.teamTrend.teams.map((team, i) => ({ ...team, missingGames: i ? 0 : 1, seasonGames: i ? 5 : 6 })) } };
  const signal = { ...side.signals[3], available: false, active: false, value: null, level: 'Unavailable' };
  const html = render(React.createElement(exportsObject.detailTest, { side: incomplete, signal, onClose() {} }));
  for (const text of ['Awaiting complete history', 'Available records are shown below', 'DAL', 'GB', '4-1-0', 'partial grade', 'missing for 1 season game', 'Adds no signal']) assert(html.includes(text), text);
});

test('saved dates stay in the slate selector when no games from those weeks are in the main response', () => {
  const html = render(React.createElement(exportsObject.default, { board: { ...board, today: '2026-11-05', sides: [], archiveDates: ['2026-10-18', '2026-10-22'] } }));
  assert.match(html, /option value="2026-10-18"/);
  assert.match(html, /option value="2026-10-22"/);
  assert.match(html, /option value="2026-11-05" selected/);
});
