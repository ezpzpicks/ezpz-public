const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript'), React = require('react'), { renderToStaticMarkup: render } = require('react-dom/server');
const load = require('./load-typescript.cjs'), root = path.resolve(__dirname, '..');
const core = load(path.join(root, 'lib/nbaLineupsCore.ts'));
const source = load(path.join(root, 'lib/nbaLineupsSource.ts'));
const html = fs.readFileSync(path.join(__dirname, 'fixtures/nba-lineups-2026-10-24.html'), 'utf8');
const games = [
  { gameId: '401909853', date: '2026-10-24', tipoff: '2026-10-24T22:00:00Z', away: 'Miami Heat', home: 'Charlotte Hornets' },
  { gameId: '401909858', date: '2026-10-24', tipoff: '2026-10-25T00:00:00Z', away: 'San Antonio Spurs', home: 'Dallas Mavericks' },
];
const at = '2026-10-24T21:00:00Z';
const parse = (value = html, observed = at) => source.parseNbaLineupsHtml(value, games[0].date, games, observed);

test('real source cards preserve five starters, positions, injury labels and each team confirmation', () => {
  const rows = parse();
  assert.equal(rows.length, 2);
  assert.equal(core.lineupFinal(rows[0]), true);
  assert.equal(core.lineupFinal(rows[1]), false);
  assert.equal(rows[0].away.starters[0].name, 'Davion Mitchell');
  assert.equal(rows[0].away.starters[0].position, 'PG');
  assert.equal(rows[1].home.starters.find(p => p.name === 'Max Christie').status, 'QUESTIONABLE');
  assert.equal(rows[1].home.injuries.find(p => p.name === 'Kyrie Irving').status, 'DOUBTFUL');
  assert.equal(rows[1].home.injuries.find(p => p.name === 'Cooper Flagg').status, 'OUT');
  assert.equal(rows[1].home.starters.length, 5);
  assert(!rows[1].home.injuries.some(p => p.name === 'Max Christie'));
});

test('Final requires explicit confirmation of both fives, and updates can correct a previously confirmed lineup', () => {
  const [first, projected] = parse();
  const oneTeamFinal = { ...projected, away: { ...projected.away, confirmed: true } };
  assert.equal(core.lineupFinal(oneTeamFinal), false);
  const confirmed = { ...projected, observedAt: '2026-10-24T23:45:00Z', away: { ...projected.away, confirmed: true }, home: { ...projected.home, confirmed: true } };
  const rows = core.mergeNbaLineups([first, projected], [confirmed]);
  assert.equal(core.lineupFinal(core.findNbaLineup(rows, { gameId: projected.gameId })), true);
  const corrected = { ...projected, observedAt: '2026-10-24T23:50:00Z' };
  assert.equal(core.lineupFinal(core.mergeNbaLineups(rows, [corrected])[1]), false);
  assert.equal(core.findNbaLineup(rows, { game: 'Miami Heat @ Charlotte Hornets', date: '2026-10-23' }), undefined);
});

test('wrong dates, ambiguous cards, incomplete fives and conflicting injuries never become Final', () => {
  assert.throws(() => parse(html.replace('October 24, 2026', 'October 23, 2026')), /another slate date/);
  assert.equal(parse(html + html).length, 0);
  assert.equal(parse(html.replace('title="Davion Mitchell"', 'title=""')).length, 1);
  assert.equal(parse(html.replace('>Ques<', '>UNRECOGNIZED<')).length, 1);
  assert.equal(parse(html.replace('>Ques<', '>Out<')).length, 1);
});

test('one stored slate changes only when lineups change, and a failed source retains the last good snapshot', async () => {
  let saved = [], writes = 0, page = html, requests = 0;
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'lib/nbaLineups.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Date, AbortSignal, console: { warn() {} }, fetch: async () => { requests++; return { ok: true, text: async () => page }; },
    require: name => name === './tursoStore' ? { readTursoDatasetByDateKeys: async () => saved }
      : name === './nbaMarketStore' ? { saveNbaMarketRows: async (dataset, rows) => { assert.equal(rows.length, 1); writes++; saved = rows; } }
      : name === './nbaLineupsSource' ? source : name === './nbaLineupsCore' ? core : require(name) });
  const now = Date.parse(at);
  assert.equal((await exports.refreshNbaLineups(games[0].date, games, true, now)).changed, 2);
  assert.equal((await exports.refreshNbaLineups(games[0].date, games, true, now + 300000)).changed, 0);
  assert.equal(writes, 1);
  assert.equal(requests, 2); // one page per slate refresh, never one page per game
  page = html.replaceAll('is-expected', 'is-confirmed').replaceAll('Expected Lineup', 'Confirmed Lineup');
  assert.equal((await exports.refreshNbaLineups(games[0].date, games, true, now + 600000)).changed, 1);
  assert.equal(writes, 2);
  page = '<html>Temporarily unavailable</html>';
  assert.equal((await exports.refreshNbaLineups(games[0].date, games, true, now + 900000)).delayed, true);
  assert.equal(writes, 2);
  assert.equal(core.lineupFinal((await exports.readNbaSavedLineups(games[0].date))[1]), true);
});

const ui = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'app/NbaGameLineups.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText, { exports: ui, Date, Intl, require: name => name === './TeamLogoName' ? { TeamLogoName: p => p.team }
  : name === '../lib/nbaLineupsCore' ? core : require(name) });
test('panels are collapsed by default and show pending/final starters with adjacent injury labels', () => {
  const lineups = parse();
  const final = render(React.createElement(ui.default, { lineups, gameId: games[0].gameId }));
  const pending = render(React.createElement(ui.default, { lineups, gameId: games[1].gameId }));
  assert.doesNotMatch(final + pending, /<details[^>]*\bopen/);
  assert.match(final, /Final/);
  assert.match(pending, /Pending/);
  assert.match(pending, /Projected starting five/);
  assert.match(pending, /Max Christie<\/span><span class="nbaLineupInjury" data-status="QUESTIONABLE">Questionable/);
  assert.match(pending, /Kyrie Irving<\/span><span class="nbaLineupInjury" data-status="DOUBTFUL">Doubtful/);
  assert.match(pending, /Cooper Flagg<\/span><span class="nbaLineupInjury" data-status="OUT">Out/);
  const unavailable = render(React.createElement(ui.default, { lineups, gameId: 'missing' }));
  assert.match(unavailable, /not available yet/);
  assert.doesNotMatch(unavailable, />Final</);
});
