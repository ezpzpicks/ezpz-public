const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript'), React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const exportsObject = {};
const fadePanel = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'app/FadeTrialPanel.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText, { exports: fadePanel, require: name => name === './data/selection-fade-replay-2026-11-04.json'
  ? { default: require('../app/data/selection-fade-replay-2026-11-04.json') } : require(name) });
const trial = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'app/SelectionTrial.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText, { exports: trial, require: name => name === './FadeTrialPanel' ? fadePanel : require(name) });
const contextPanel = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'app/MatchupContextPanel.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText, { exports: contextPanel, require });
const source = fs.readFileSync(path.join(root, 'app/FootballSignalsBoard.tsx'), 'utf8') + '\nexport const detailTest = SignalDetail; export const researchTest = CombinationResearch; export const comboTest = CombinationRecord; export const pickTileTest = MatchupCard;';
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
  { exports: exportsObject, Date, Intl, console, require: name => name === './TeamLogoName' ? { TeamLogoName: p => p.team }
    : name === './NbaGameLineups' ? { __esModule: true, default: () => null }
    : name === './SelectionTrial' ? trial
    : name === './MatchupContextPanel' ? contextPanel
    : ['../lib/signalCombinationResearch', '../lib/signalPicks', '../lib/signalMovement', '../lib/situationRules', '../lib/teamTrendScorePolicy'].includes(name) ? require('./load-typescript.cjs')(path.join(root, name.replace('../', '') + '.ts')) : require(name) });
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

test('spread team details explain why neutral opposition does not dilute strong support', () => {
  const updated = { ...side, teamTrend: { ...side.teamTrend, score: 90, aggregation: 'Neutral-relative spread' },
    signals: side.signals.map(signal => signal.key === 'team' ? { ...signal, value: 90 } : signal) };
  const html = render(React.createElement(exportsObject.detailTest, { side: updated,
    signal: updated.signals.find(signal => signal.key === 'team'), onClose: () => {} }));
  assert.match(html, /<strong>90<\/strong>/);
  assert.match(html, /even opponent is neutral/);
  assert.match(html, /Qualifies at 75/);
  const old = render(React.createElement(exportsObject.detailTest, { side,
    signal: side.signals.find(signal => signal.key === 'team'), onClose: () => {} }));
  assert.doesNotMatch(old, /even opponent is neutral/);
});

test('fade replays render their own sport, prices and conservative ROI without becoming historical picks', () => {
  const props = { date: '2026-11-04', decisions: [] };
  const nba = render(React.createElement(fadePanel.default, { ...props, sport: 'NBA' }));
  for (const text of ['Oklahoma City Thunder -3.5', 'San Antonio Spurs -12.5', '-4.18%', '-13.17%', '-4.21%', '-13.21%', 'excluded from prospective records', 'Meets fade rule', 'Informational']) assert(nba.includes(text), text);
  assert.equal((nba.match(/<td data-label="Fade rule">Meets fade rule<\/td>/g) || []).length, 2);
  assert.doesNotMatch(nba, /Ball State/);
  const college = render(React.createElement(fadePanel.default, { ...props, sport: 'NCAAF' }));
  for (const text of ['Ball State +2.5', '-102', '0.10%', '-13.67%', 'Unverified provenance']) assert(college.includes(text), text);
  assert.match(college, /<td data-label="Fade rule">Meets fade rule<\/td>/);
  assert.equal(render(React.createElement(fadePanel.default, { ...props, date: '2026-11-03', sport: 'NBA' })), '');
});

test('official score cards retain frozen combination history while calibration scores stay out of the overview', () => {
  const noSignals = side.signals.map(s => ({ ...s, active: false }));
  const value = { ...side, date: '2026-11-01', signals: noSignals, signalCount: 0, recorded: true, status: 'FINAL_PREGAME',
    comboScore: { score: 70, own: { sideGroup: 'Favorite', combination: '', wins: 14, losses: 6, pushes: 0 },
      opponent: { sideGroup: 'Underdog', combination: 'move', wins: 4, losses: 6, pushes: 0 } } };
  const props = { rows: [value], board: { ...board, sport: 'NCAAF' }, picksOnly: true, date: value.date };
  const html = render(React.createElement(exportsObject.pickTileTest, props));
  for (const text of ['Score 70', 'Combined Signal Record', '14–6–0', '0 signals', 'Final snapshot']) assert(html.includes(text), text);
  assert.doesNotMatch(html, /fs-signal-chip|fs-breakdown|Model grade/);
  const preview = render(React.createElement(exportsObject.pickTileTest, { ...props, board: { ...board, sport: 'NBA' } }));
  assert.doesNotMatch(preview, /Score 70|Calibration in progress/);
});

test('Signals and EZPZ cards display the corrected schedule clock in Eastern', () => {
  const corrected = { ...side, recorded: true, status: 'FINAL_PREGAME', snapshotAt: '2026-10-19T00:05:00Z',
    scheduledGameTime: '2026-10-19T01:20:00.000Z' };
  const current = { ...board, sides: [corrected, { ...opposite, scheduledGameTime: corrected.scheduledGameTime }] };
  for (const picksOnly of [false, true]) {
    const html = render(React.createElement(exportsObject.default, { board: current, picksOnly }));
    assert.match(html, /<time dateTime="2026-10-19T01:20:00.000Z">9:20 PM ET<\/time>/);
    assert.doesNotMatch(html, /8:20 PM ET/);
  }
});

test('compact cards label exact side-specific and no-signal combination records', () => {
  const stats = (wins, losses, pushes, pending = 0) => ({ wins, losses, pushes, pending, netUnits: 0, assumedPrices: 0, unknownPrices: 0 });
  const { SIGNAL_RESEARCH_VERSION } = require('./load-typescript.cjs')(path.join(root, 'lib/signalCombinationResearch.ts'));
  const research = { version: SIGNAL_RESEARCH_VERSION, sport: 'NFL', dates: [], forwardFrom: '2026-10-23T22:27:21Z', cells: [
    { market: 'Spread', phase: 'history', sideGroup: 'Favorite', combination: 'money+move+system+team', stats: stats(8, 3, 1) },
    { market: 'Spread', phase: 'forward', sideGroup: 'Favorite', combination: 'money+move+system+team', stats: stats(2, 1, 0, 1) },
    { market: 'Spread', phase: 'forward', sideGroup: 'Underdog', combination: 'money+move+system+team', stats: stats(0, 20, 0) },
    { market: 'Spread', phase: 'forward', sideGroup: 'Underdog', combination: '', stats: stats(5, 9, 0) },
    { market: 'Spread', phase: 'forward', sideGroup: 'Favorite', combination: '', stats: stats(0, 30, 0) },
  ] };
  const html = render(React.createElement(exportsObject.default, { board: { ...board, research } }));
  assert.match(html, /Combined Signal Record<\/span><strong>10-4-1<\/strong>/);
  assert.match(html, /Combined Signal Record<\/span><strong>5-9-0<\/strong>/);
  assert.match(html, /No active signals · Underdog · Spreads · Cumulative saved history/);
  assert.match(html, /Money support \+ Line movement \+ Public trend \+ Team trend · Favorite · Spreads/);
  assert.match(html, /10-4-1 \(wins-losses-pushes\) · 1 pending/);
  const missing = render(React.createElement(exportsObject.default, { board }));
  assert.match(missing, /No settled history/);
  assert.match(missing, /Combined Signal Record<\/span><strong>—<\/strong>/);
});

test('total combo labels use the selected direction and exclude the opposite direction', () => {
  const research = require('./load-typescript.cjs')(path.join(root, 'lib/signalCombinationResearch.ts'));
  const now = Date.parse('2026-10-19T05:00:00Z'), policy = 'ui-total-v1';
  const observations = ['Over', 'Under'].map((direction, i) => ({ ...side, id: direction,
    market: 'Total', side: direction, selection: direction + ' 44.5', line: 44.5, policyVersion: policy,
    recorded: true, status: 'FINAL_PREGAME', snapshotAt: '2026-10-19T00:05:00Z',
    result: i ? 'L' : 'W', resultUpdated: '2026-10-19T04:00:00Z' }));
  const report = research.buildSignalResearchReport('NFL', policy, research.buildSignalResearchDays(observations, policy, now));
  const recordFor = value => render(React.createElement(exportsObject.comboTest, { side: value, report }));
  assert.match(recordFor(observations[0]), /Over · Totals.*<strong>1-0-0<\/strong>/);
  assert.match(recordFor(observations[1]), /Under · Totals.*<strong>0-1-0<\/strong>/);
});

test('EZPZ shows only qualifying saved signal tests, with NFL two and NCAAF three', () => {
  const frozen = { ...side, recorded: true, status: 'FINAL_PREGAME', snapshotAt: '2026-10-19T00:05:00Z',
    signalCount: 2, selected: false, candidate: false,
    signals: keys.map(key => ({ key, active: ['move', 'model'].includes(key), available: true, value: 2, level: 'Qualifying' })) };
  const data = { ...board, sides: [frozen, opposite] };
  const html = render(React.createElement(exportsObject.default, { board: data, picksOnly: true }));
  for (const text of ['NFL EZPZ Picks', '2+ signals', 'All plays', '2 signals', 'Final snapshot', 'Historical tests'])
    assert(html.toLowerCase().includes(text.toLowerCase()), text);
  assert.match(html, /DAL/); assert.doesNotMatch(html, /GB \+1\.5/);
  assert.equal((html.match(/class="fs-details-toggle"/g) || []).length, 1);
  assert.match(html, /aria-label="DAL -1.5 EZPZ Pick"/);
  assert.match(html, /fs-signal-chip">Line/);
  assert.match(html, /fs-signal-chip">Model/);
  assert.doesNotMatch(html, /Sort games by signal|Inactive or unavailable|class="fs-signals"|Money support. Qualifying/);
  const cfb = render(React.createElement(exportsObject.default, { board: { ...data, sport: 'NCAAF' }, picksOnly: true }));
  assert.match(cfb, /3\+ signals/); assert.match(cfb, /No qualifying NCAAF EZPZ Picks/);
  const missing = render(React.createElement(exportsObject.default, { picksOnly: true, sport: 'NCAAM' }));
  assert.match(missing, /NCAAM EZPZ Picks/); assert.match(missing, /No qualifying NCAAM EZPZ Picks yet/);
  assert.doesNotMatch(missing, /3\+ signals/);
});

test('compact picks show frozen results and the new policy waits for the final snapshot', () => {
  const total = { ...side, market: 'Total', side: 'Over', selection: 'Over 43.5', line: 43.5, recorded: true,
    status: 'FINAL_PREGAME', snapshotAt: '2026-10-19T00:05:00Z', result: 'W', signalCount: 2,
    signals: keys.map(key => ({ key, active: ['money', 'team'].includes(key), available: true, value: key === 'money' ? 27 : 80, level: 'Qualifying' })) };
  const frozen = render(React.createElement(exportsObject.default, { board: { ...board, sides: [total] }, picksOnly: true }));
  for (const text of ['Over 43.5 EZPZ Pick', '-110', 'Won', 'Final snapshot', 'Combined Signal Record']) assert(frozen.includes(text), text);
  assert.doesNotMatch(frozen, /fs-breakdown|fs-detail-inline/);
  const now = Date.now(), tip = new Date(now + 3_600_000).toISOString(), date = '2026-11-06';
  const live = { ...total, date, recorded: false, status: 'LIVE', gameTime: tip, snapshotAt: new Date(now).toISOString(), result: '' };
  const preview = render(React.createElement(exportsObject.default, { board: { ...board, today: date, sides: [live] }, picksOnly: true }));
  assert.match(preview, /No NFL play type currently qualifies/);
  assert.doesNotMatch(preview, /Live preview/);
  assert.doesNotMatch(preview, /Final snapshot|Won/);
});

test('EZPZ play-type cards distinguish pending previews from saved final picks', () => {
  const rules = require('./load-typescript.cjs')(path.join(root, 'lib/situationRules.ts'));
  const now = Date.now(), date = '2026-11-07', gameTime = new Date(now + 3_600_000).toISOString();
  const live = [side, opposite].map((value, i) => ({ ...value, date, gameTime, snapshotAt: new Date(now).toISOString(),
    marketContext: { ...value.marketContext, openingLine: value.line, bets: i ? 75 : 25, money: i ? 75 : 25,
      openingBets: i ? 75 : 25, openingMoney: i ? 75 : 25, openingAt: new Date(now - 13 * 3_600_000).toISOString(), history: [] } }));
  const data = { ...board, today: date, sport: 'NCAAF', sides: live,
    situationPolicy: rules.reviewSituationRules('NCAAF', date, now, undefined, []) };
  const html = render(React.createElement(exportsObject.default, { board: data, picksOnly: true }));
  for (const text of ['Pending · awaiting final snapshot', 'Home spread matches its opener', 'GB +1.5 EZPZ Pick',
    'Only locked picks enter official records or posts']) assert(html.includes(text), text);
  assert.doesNotMatch(html, /Final snapshot|Combined Signal Record/);
  const [pending] = rules.situationPreviews(live, data.situationPolicy, now);
  const frozen = { ...pending, situationPending: undefined, recorded: true, status: 'FINAL_PREGAME',
    gameTime: new Date(now + 900_000).toISOString() };
  const finalHtml = render(React.createElement(exportsObject.pickTileTest, { rows: [frozen], board: data, picksOnly: true, date }));
  assert.match(finalHtml, /Final snapshot/);
  assert.doesNotMatch(finalHtml, /Pending · awaiting final snapshot/);
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
  assert.match(html, /\+0\.5/);
  assert.match(html, />points</);
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

test('matchup evidence starts collapsed and only active signal badges appear in the overview', () => {
  const html = render(React.createElement(exportsObject.default, { board }));
  assert.equal((html.match(/class="fs-details-toggle" aria-expanded="false"/g) || []).length, 1);
  assert.equal((html.match(/class="fs-signal-chip"/g) || []).length, 4);
  assert.doesNotMatch(html, /fs-breakdown|fs-detail-inline|fs-sorters|fs-search-row/);
  assert.match(html, /aria-label="Sort games"/);
  assert.match(html, /Filters/);
});

test('saved Covers model lines are identified separately from public betting and final snapshots', () => {
  const savedInput = { ...side, status: 'UNAVAILABLE', recorded: false,
    lineSource: { name: 'Covers', capturedAt: '2026-10-18T13:06:30Z', url: 'https://www.covers.com/sport/football/ncaaf/matchup/378342' } };
  const html = render(React.createElement(exportsObject.default, { board: { ...board, sport: 'NCAAF', sides: [savedInput] } }));
  for (const label of ['Saved Covers line', '9:06 AM ET', '−110 assumed', 'Public betting splits unavailable']) assert(html.includes(label), label);
  assert.doesNotMatch(html, /Saved pregame ·|Live preview ·|Awaiting market data/);
});

test('NCAAM fallback cards render their ESPN source, spread and price', () => {
  const savedInput = { ...side, status: 'UNAVAILABLE', recorded: false, selected: false,
    lineSource: { name: 'ESPN', capturedAt: '2026-10-18T13:06:30Z', url: 'https://www.espn.com/' } };
  const html = render(React.createElement(exportsObject.default, { board: { ...board, sport: 'NCAAM', sides: [savedInput] } }));
  for (const label of ['Saved ESPN line', '-1.5', '-110', '−110 assumed', 'Public betting splits unavailable']) assert(html.includes(label), label);
  assert.doesNotMatch(html, /Saved Covers line|Line pending|Awaiting market data/);
});

test('public summary keeps every matched trend and its key performance records', () => {
  const html = render(React.createElement(exportsObject.detailTest, { side, signal: side.signals[2], onClose() {} }));
  assert.match(html, /#1 · Matched system 1/); assert.match(html, /#2 · Matched system 2/);
  for (const text of ['8-2-0', '6-1-0', '52.7%', 'top 20 Wilson-ranked', 'one public signal', 'Adds 1 signal']) assert(html.includes(text), text);
  assert.doesNotMatch(html, /Last 7 days|Exact qualifying conditions|Tickets below 45%|Inputs used for these matches|Contribution to the 3\+ test/);
});

test('team summary keeps both teams and the three relevant records without the game-by-game audit', () => {
  const html = render(React.createElement(exportsObject.detailTest, { side, signal: side.signals[3], onClose() {} }));
  for (const text of ['DAL', 'GB', 'Favorite ATS', 'Away ATS', 'Last 5 ATS', '80 out of 100', 'Qualifies at 75', '4-1-0']) assert(html.includes(text), text);
  assert.doesNotMatch(html, /ATS losses support|50% bet type|then both grades/);
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
  for (const text of ['Awaiting complete history', 'Available records are shown below', 'DAL', 'GB', '4-1-0', 'Partial grade', 'missing for 1 season game', 'Adds no signal']) assert(html.includes(text), text);
});

test('a positive money gap is green below threshold without claiming a qualifying signal', () => {
  const money = { ...side.signals[0], value: 11, active: false, level: 'Inactive' };
  const html = render(React.createElement(exportsObject.detailTest, { side: { ...side, marketContext: { ...side.marketContext, bets: 57, money: 68 } }, signal: money, onClose() {} }));
  for (const text of ['fs-tone-positive', '+11', '57%', '68%', 'Below +15', 'Adds no signal']) assert(html.includes(text), text);
  assert.doesNotMatch(html, /percentage points|fs-state-active/);
});

test('movement details show lines and points even when the old feed selected an odds change', () => {
  const moved = { ...side, line: -4.5, marketContext: { ...side.marketContext, openingLine: -4.5,
    openingOdds: '-109', movementBasis: 'Implied Probability' }, odds: '+104' };
  for (const available of [true, false]) {
    const move = { ...side.signals[1], value: available ? 0 : null, available, active: false, level: 'Inactive' };
    const html = render(React.createElement(exportsObject.detailTest, { side: moved, signal: move, onClose() {} }));
    for (const text of ['Opening line', 'Current line', '-4.5', 'points', 'Line unchanged', 'No signal']) assert(html.includes(text), text);
    assert.doesNotMatch(html, /\bpp\b|percentage points|Opening odds|Current odds|-109|\+104|Unavailable/);
  }
});

test('saved dates stay in the slate selector when no games from those weeks are in the main response', () => {
  const html = render(React.createElement(exportsObject.default, { board: { ...board, today: '2026-11-05', sides: [], archiveDates: ['2026-10-18', '2026-10-22'] } }));
  assert.match(html, /option value="2026-10-18"/);
  assert.match(html, /option value="2026-10-22"/);
  assert.match(html, /option value="2026-11-05" selected/);
});
