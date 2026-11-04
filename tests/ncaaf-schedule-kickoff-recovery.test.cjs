const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, extra = '', imports = {}, globals = {}) {
  const api = {};
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8') + extra;
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  }}).outputText, { exports: api, require: id => imports[id] || {},
    Date, Intl, URL, AbortSignal, process: { env: {} }, console, ...globals });
  return api;
}
const weekly = load('lib/footballWeeklyMarket.ts');
const core = load('lib/footballPublicDataCore.ts', `
  exports.reconcile = reconcileNcaafScheduleKickoffs;
  exports.mergeSlate = mergeFootballTrackingSlate;
`, { './footballWeeklyMarket': weekly });
const row = { 'Game Date': '2026-10-24', 'Game Time': '2026-10-24T00:00:00-04:00',
  'Game ID': '401858274', 'Away Team': 'Pittsburgh', 'Home Team': 'Miami' };
const market = { date: '2026-10-24', gameTime: '2026-10-24T16:00:00Z',
  awayTeam: 'Pitt', homeTeam: 'Miami' };

test('noon market clock replaces midnight before model and schedule merge', () => {
  const corrected = core.reconcile([row], [market]);
  const slate = core.mergeSlate([{ ...row, Date: '2026-10-24', 'Projected Away': '16',
    'Projected Home': '39' }], corrected, 'NCAAF', '2026-10-24');
  assert.equal(slate.length, 1);
  assert.equal(slate[0]['Game Time'], '2026-10-24T16:00:00.000Z');
  assert.equal(slate[0]['Projected Home'], '39');
  assert.equal(slate[0]['Game ID'], row['Game ID']);
  assert.equal(row['Game Time'], '2026-10-24T00:00:00-04:00');
});

test('verified non-midnight schedule times retain authority', () => {
  const verified = { ...row, 'Game Time': '2026-10-24T15:30:00-04:00' };
  assert.equal(core.reconcile([verified], [market])[0], verified);
});

test('inconsistent, cross-day and unknown source clocks cannot repair a schedule', () => {
  for (const markets of [[market, { ...market, gameTime: '2026-10-24T17:00:00Z' }],
    [{ ...market, gameTime: '2026-10-25T16:00:00Z' }],
    [{ ...market, gameTime: 'TBD' }], [{ ...market, date: '2026-10-25' }]]) {
    assert.equal(core.reconcile([row], markets)[0], row);
  }
});

test('Texas A&M uses its own clock and cannot match Texas', () => {
  const schedules = [{ ...row, 'Away Team': 'Texas AandM', 'Home Team': 'Alabama' },
    { ...row, 'Away Team': 'Texas', 'Home Team': 'Alabama' }];
  const corrected = core.reconcile(schedules, [{ ...market, awayTeam: 'Texas A&M',
    homeTeam: 'Alabama', gameTime: '2026-10-24T19:30:00Z' }]);
  assert.equal(corrected[0]['Game Time'], '2026-10-24T19:30:00.000Z');
  assert.equal(corrected[1], schedules[1]);
});

test('ESPN school names replace the stale Buffalo–Miami kickoff before final signal capture', async () => {
  const date = '2026-11-03', kickoff = '2026-11-04T01:00:00.000Z';
  const now = Date.parse('2026-11-04T00:45:00.000Z');
  const saved = { Date: date, 'Game Date': date, 'Game ID': '401866454',
    'Away Team': 'Buffalo', 'Home Team': 'Miami (OH)', 'Game Time': '2026-11-04T00:00:00.000Z' };
  const scoreboard = { events: [{ id: '401866454', date: kickoff, competitions: [{ date: kickoff,
    competitors: [
      { homeAway: 'away', team: { displayName: 'Buffalo Bulls', shortDisplayName: 'Buffalo' } },
      { homeAway: 'home', team: { displayName: 'Miami (OH) RedHawks', shortDisplayName: 'Miami OH' } },
    ],
  }] }] };
  const source = load('lib/footballPublicDataCore.ts', `
    exports.loadSchedule = loadFootballWeekSchedule;
    exports.mergeSchedule = mergeFootballSchedules;
    exports.mergeSlate = mergeFootballTrackingSlate;
  `, { './footballWeeklyMarket': weekly }, {
    fetch: async () => ({ ok: true, json: async () => scoreboard }),
  });
  const live = await source.loadSchedule('NCAAF', date, date);
  assert.equal(live[0]['Away Team'], 'Buffalo');
  assert.equal(live[0]['Home Team'], 'Miami OH');
  const schedule = source.mergeSchedule([saved], live, 'NCAAF');
  assert.equal(schedule.length, 1, 'a mascot-bearing ESPN game must not leave a duplicate stale row');
  assert.equal(weekly.nflKickoffIso(date, schedule[0]['Game Time']), kickoff);
  const slate = source.mergeSlate([saved], schedule, 'NCAAF', date);
  assert.equal(slate.length, 1);
  assert.equal(weekly.nflKickoffIso(date, slate[0]['Game Time']), kickoff);
  assert.equal(saved['Game Time'], '2026-11-04T00:00:00.000Z');

  const read = require('./load-typescript.cjs');
  const signals = read(path.join(__dirname, '../lib/footballSignals.ts'));
  const picks = read(path.join(__dirname, '../lib/signalPicks.ts'));
  const research = read(path.join(__dirname, '../lib/signalCombinationResearch.ts'));
  const catalog = read(path.join(__dirname, '../lib/catalog/consolidatedSportCatalog.ts'));
  const policy = catalog.consolidatedSignalPolicy('NCAAF');
  const cell = (sideGroup, combination, wins, losses) => ({ market: 'Spread', sideGroup, combination, phase: 'history',
    stats: { wins, losses, pushes: 0, pending: 0, netUnits: 0, assumedPrices: 0, unknownPrices: 0 } });
  const trendPlays = [
    { market: 'Spread', selection: 'Buffalo', selectionTeam: 'Buffalo', line: 6.5, openingLine: 7 },
    { market: 'Spread', selection: 'Miami OH', selectionTeam: 'Miami OH', line: -6.5, openingLine: -6.5 },
    { market: 'Total', selection: 'Over', side: 'Over', line: 45.5, openingLine: 45.5 },
    { market: 'Total', selection: 'Under', side: 'Under', line: 45.5, openingLine: 45.5 },
  ].map(play => ({ ...play, date, game: 'Buffalo @ Miami OH', gameTime: kickoff, awayTeam: 'Buffalo', homeTeam: 'Miami OH',
    odds: '-110', betsPct: 50, moneyPct: 50, snapshotStatus: 'FINAL_PREGAME',
    frozenAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() }));
  const input = { sport: 'NCAAF', now, capture: true, storedRows: [], history: new Map(), leaderboard: [],
    researchDays: { '2026-10-31': { version: research.SIGNAL_RESEARCH_VERSION, policyVersion: policy, date: '2026-10-31',
      cells: [cell('Favorite', '', 14, 6), cell('Underdog', 'move', 4, 6)] } },
    core: { today: date, trendPlays, slateToday: [], trendRecordRows: [], teamTrendScheduleRows: [saved] } };
  assert.equal(signals.buildFootballSignalsState(input).changedRows.length, 0, 'the stale 7 p.m. clock reproduces the missed capture');
  const fixed = signals.buildFootballSignalsState({ ...input, core: { ...input.core, teamTrendScheduleRows: schedule } });
  assert.equal(fixed.changedRows.length, 4, 'both opposing market pairs are saved at the real final window');
  const selected = picks.selectSignalEzpzPicks(fixed.board.sides, 'NCAAF', now);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].selection, 'Miami OH -6.5');
  assert.equal(selected[0].comboScore.score, 70);
  assert.equal(fixed.board.summary.pending, 1);
});
