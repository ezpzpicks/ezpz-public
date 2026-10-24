const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, extra = '', imports = {}) {
  const api = {};
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8') + extra;
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  }}).outputText, { exports: api, require: id => imports[id] || {},
    Date, Intl, URL, AbortSignal, process: { env: {} }, console });
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
