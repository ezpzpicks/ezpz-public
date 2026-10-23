const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript');
const { NextRequest } = require('next/server');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '..');
const signals = load(path.join(root, 'lib/footballSignals.ts'));
const research = load(path.join(root, 'lib/signalCombinationResearch.ts'));
const date = '2026-10-22', kickoff = Date.parse(date + 'T23:20:00Z');
const iso = n => new Date(n).toISOString();
function route(readRows) {
  const api = {};
  const source = fs.readFileSync(path.join(root, 'app/api/football-signals-history/route.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports: api, console: { error() {} }, require: name => name.endsWith('/sportSheets') ? { readSportWorksheetByDateKeys: readRows }
      : name.endsWith('/footballSignals') ? { ...signals, readSavedFootballSignalsForDate: (rows, day) => signals.readSavedFootballSignalsForDate(rows, day, kickoff + 86400000) }
      : name.endsWith('/signalCombinationResearch') ? research
      : require(name) });
  return query => api.GET(new NextRequest('https://ezpzpicks.com/api/football-signals-history?' + query));
}
function rows() {
  return ['Over', 'Under'].map((selection, i) => ({ Date: date, 'Pick Key': selection, 'Policy Version': signals.FOOTBALL_SIGNALS_VERSION, Result: i ? 'L' : 'W',
    'Result Updated': iso(kickoff + 3 * 3600000),
    'Details JSON': JSON.stringify({ id: selection, date, market: 'Total', selection: selection + ' 44.5', gameTime: iso(kickoff),
      status: 'FINAL_PREGAME', snapshotAt: iso(kickoff - 15 * 60000), odds: '-110',
      signals: [{ key: 'model', active: !i, available: true }], signalCount: i ? 0 : 1, selected: false, line: 44.5 }) }));
}

test('archive requests reject invalid sports and dates before reading storage', async () => {
  let reads = 0;
  const get = route(async () => { reads++; return []; });
  for (const query of ['sport=MLB&date=2026-10-22', 'sport=NFL', 'sport=NFL&date=2026-02-30', 'sport=NFL&date=bad']) {
    assert.equal((await get(query)).status, 400);
  }
  assert.equal(reads, 0);
});

test('archive requests read one sport and date and return saved non-picks with settled results', async () => {
  let requested;
  const get = route(async (...args) => { requested = args; return rows(); });
  const response = await get('sport=nfl&date=' + date);
  assert.equal(response.status, 200);
  assert.equal(requested[0], 'NFL'); assert.equal(requested[1], signals.FOOTBALL_SIGNALS_TAB);
  assert.deepEqual(Array.from(requested[2]), [date]);
  const value = await response.json();
  assert.equal(value.sport, 'NFL'); assert.equal(value.date, date); assert.equal(value.sides.length, 2);
  assert(value.sides.every(side => side.recorded && !side.selected));
  assert.equal(value.sides.find(side => side.id === 'Under').signalCount, 0);
  assert.equal(value.sides.find(side => side.id === 'Under').result, 'L');
  assert.equal(value.sides.find(side => side.id === 'Over').line, 44.5);
  const totals = research.signalResearchView(value.research, 'Total');
  assert.equal(totals.total.settled, 2);
  assert.equal(totals.counts.find(row => row.label === '1').record.record, '1-0-0');
});

test('an unavailable archive is an explicit retryable error rather than an empty slate', async () => {
  const get = route(async () => { throw new Error('private database connection detail'); });
  const response = await get('sport=NCAAF&date=' + date);
  assert.equal(response.status, 503);
  const value = await response.json();
  assert.equal(value.ok, false); assert.match(value.error, /try again/i); assert.doesNotMatch(value.error, /private/);
});
