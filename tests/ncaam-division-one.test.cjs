const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript');
const vm = require('node:vm');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, f);
const membership = require('../lib/ncaamDivisionOne.ts');
const market = require('../lib/ncaamMarketCore.ts');
const analysis = require('../lib/ncaamAnalysisCore.ts');
const { membership: roster } = require('../data/ncaamDivisionOneTeams.ts');
const date = '2026-11-02', tipoff = '2026-11-02T23:00:00Z', now = Date.parse(tipoff) - 15 * 60000;
function event(id, awayId = '87', homeId = '222') {
  return { id, season: { year: 2027, type: 2 }, competitions: [{ date: tipoff, timeValid: true, neutralSite: true,
    status: { type: { name: 'STATUS_SCHEDULED', state: 'pre', completed: false } },
    competitors: [
      { homeAway: 'away', team: { id: awayId, displayName: 'Notre Dame Fighting Irish', location: 'Notre Dame' } },
      { homeAway: 'home', team: { id: homeId, displayName: 'Villanova Wildcats', location: 'Villanova' } },
    ] }] };
}

test('the verified 365-team group includes transitioning D1 members and excludes Hartford', () => {
  assert.equal(roster.teams.length, 365);
  assert.equal(new Set(roster.teams.map(t => t.id)).size, 365);
  for (const id of ['87', '222', '88', '2511', '2815']) assert(membership.ncaamDivisionOneMatchup(id, '2', 2027));
  assert.equal(membership.ncaamDivisionOneMatchup('42', '87', 2027), false);
  assert.equal(membership.ncaamDivisionOneMatchup('87', '42', 2027), false);
  assert.equal(membership.ncaamDivisionOneMatchup('87', '87', 2027), false);
  assert.equal(membership.ncaamDivisionOneMatchup('87', '222', 2028), false, 'another season requires its own verified roster');
});

test('both ESPN team IDs must be D1 even when excluded teams have a familiar name or betting market', () => {
  const payload = { events: [event('1'), event('2', '42'), event('3', '87', '42'), event('4', '999999')] };
  const games = market.normalizeNcaamSlate(payload, date);
  assert.deepEqual(games.map(g => g.gameId), ['1']);
  const allExcluded = market.normalizeNcaamSlate({ events: payload.events.slice(1) }, date);
  assert.deepEqual(allExcluded, []);
  assert.deepEqual(market.bindNcaamSplits([], allExcluded, now).missing, [], 'excluded games are not missing markets');
});

test('saved schedules use the same ID membership and season rule without fetching providers', () => {
  const row = { Date: date, Season: '2027', 'Away Team ID': '87', 'Home Team ID': '222' };
  assert.deepEqual(membership.ncaamDivisionOneSchedule([row, { ...row, 'Away Team ID': '42' }]), [row]);
  assert.equal(membership.ncaamDivisionOneSchedule([{ ...row, Season: '' }]).length, 1);
  assert.equal(membership.ncaamDivisionOneSchedule([{ ...row, Date: '2027-11-02', Season: '' }]).length, 0);
  assert.equal(membership.ncaamDivisionOneSchedule([{ ...row, 'Away Team ID': '' }]).length, 0);
});

test('orphaned split rows and saved signals cannot reintroduce a filtered schedule game', () => {
  const games = [{ Date: date, 'Game Key': `${date}|ncaam|1`, 'Game ID': '1', 'Game Time': tipoff,
    'Away Team': 'Notre Dame Fighting Irish', 'Home Team': 'Villanova Wildcats', Status: 'STATUS_SCHEDULED' }];
  const rows = ['Spread', 'Total'].flatMap(Market => [0, 1].map(i => ({ ...games[0], Market,
    Selection: Market === 'Total' ? (i ? 'Under' : 'Over') : games[0][i ? 'Home Team' : 'Away Team'],
    Line: Market === 'Total' ? '145' : i ? '-3' : '3', Odds: '-110',
    'Snapshot Status': 'FINAL_PREGAME', 'Updated At': new Date(now).toISOString(), 'Frozen At': new Date(now).toISOString(),
    'Current Bets %': '50', 'Current Handle %': '50', 'Opening Bets %': '50', 'Opening Handle %': '50' })));
  const input = { date, games, splits: rows, storedRows: [], forecasts: [], state: analysis.emptyNcaamAnalysis(date), now, capture: true };
  const original = analysis.buildNcaamSignals(input);
  assert.equal(original.board.sides.length, 4);
  assert.equal(original.changedRows.length, 4);
  const excluded = analysis.buildNcaamSignals({ ...input, games: [], storedRows: original.changedRows });
  assert.equal(excluded.board.sides.length, 0);
  assert.equal(excluded.changedRows.length, 0);
  assert.equal(excluded.plays.length, 0);
});

test('a saved non-D1 game cannot trigger the five-minute collection countdown', async () => {
  const rows = [
    { Date: date, 'Away Team ID': '42', 'Home Team ID': '87', 'Game Time': new Date(now + 30 * 60000).toISOString() },
    { Date: date, 'Away Team ID': '87', 'Home Team ID': '222', 'Game Time': new Date(now + 240 * 60000).toISOString() },
  ];
  const api = {}, imports = {
    './tursoStore': { readTursoDataset: async () => [], readTursoDatasetByDateKeys: async (_, tab) => tab === 'schedule' ? rows : [], replaceTursoDataset: async () => {} },
    './mlbTrendV2': { isoDate: value => value },
    './footballWeeklyMarket': {},
    './marketRefreshPolicy': require('../lib/marketRefreshPolicy.ts'),
    './ncaamDivisionOne': membership,
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../lib/scheduledMarketRefresh.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: api, Date, Intl, console: { info() {} }, require: name => imports[name] });
  assert.equal((await api.scheduledMarketRefresh('NCAAM', 'market', now)).intervalMinutes, 30);
  rows[1]['Game Time'] = new Date(now + 30 * 60000).toISOString();
  assert.equal((await api.scheduledMarketRefresh('NCAAM', 'market', now)).intervalMinutes, 5);
});
