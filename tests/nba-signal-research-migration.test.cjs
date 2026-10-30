const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '..');
const research = load(path.join(root, 'lib/signalCombinationResearch.ts'));
const core = load(path.join(root, 'lib/nbaAnalysisCore.ts'));
const trend = load(path.join(root, 'lib/nbaTrendLeaderboard.ts'));
const { NBA_MODEL_RECORD_POLICY } = load(path.join(root, 'lib/nbaRecords.ts'));
const date = '2026-10-29', earlier = '2026-10-28', now = Date.parse('2026-10-30T05:00:00Z');
const iso = value => new Date(value).toISOString();

function savedRow(day, direction, result) {
  const kickoff = Date.parse(day + 'T23:00:00Z');
  const side = { id: day + '|' + direction, date: day, gameKey: day + '|nba|101', game: 'Cleveland Cavaliers @ Philadelphia 76ers',
    awayTeam: 'Cleveland Cavaliers', homeTeam: 'Philadelphia 76ers', gameTime: iso(kickoff),
    market: 'Total', side: direction, selection: direction + ' 220.5', line: 220.5, odds: '-110',
    status: 'FINAL_PREGAME', snapshotAt: iso(kickoff - 15 * 60000), recorded: true,
    signals: [{ key: 'model', active: true, available: true }], signalCount: 1, sourceCount: 1,
    candidate: false, selected: false, mixed: false, combination: 'model',
    result, resultUpdated: iso(kickoff + 3 * 3600000), policyVersion: trend.NBA_SIGNALS_POLICY.version };
  return { Date: day, 'Pick Key': side.id, 'Policy Version': side.policyVersion, Result: result,
    'Result Updated': side.resultUpdated, 'Details JSON': JSON.stringify(side) };
}

test('NBA collector rebuilds side-specific history once from frozen rows, then resumes bounded day reads', async () => {
  const rows = [savedRow(earlier, 'Over', 'W'), savedRow(earlier, 'Under', 'L'), savedRow(date, 'Over', 'W')];
  const originalRows = JSON.stringify(rows), reads = [], writes = [];
  let state = { ...core.emptyNbaAnalysis(date), archiveDates: [earlier, date],
    modelRecords: { version: NBA_MODEL_RECORD_POLICY },
    signalResearch: { version: 'signal-combinations-2026-10-23-v1', days: {} } };
  const imports = {
    './tursoStore': { readTursoDatasetByDateKeys: async (sport, tab, dates) => {
      if (tab === trend.NBA_ANALYSIS_TAB) return [{ 'Details JSON': JSON.stringify(state) }];
      if (tab === trend.NBA_SIGNALS_TAB) { reads.push(Array.from(dates)); return rows.filter(row => dates.includes(row.Date)); }
      return [];
    }, runTursoSql: async () => { throw new Error('Unexpected full-season scan'); } },
    './nbaMarketStore': { saveNbaMarketRows: async (tab, values) => {
      writes.push(tab);
      if (tab === trend.NBA_ANALYSIS_TAB) state = JSON.parse(values[0]['Details JSON']);
    } },
    './nbaForecasts': { readNbaForecasts: async () => [], readNbaForecastHistory: async () => { throw new Error('Unexpected model-history scan'); } },
    './nbaRecords': { NBA_MODEL_RECORD_POLICY, updateNbaModelRecords: previous => previous },
    './ezpzCurrentPicks': { persistEzpzCurrentPicks: async () => {} },
  };
  const api = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'lib/nbaAnalysis.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: api, Date, AbortSignal, console: { info() {} },
    fetch: async () => { throw new Error('Unexpected external history request'); },
    require: name => imports[name] || load(path.resolve(root, 'lib', name + '.ts')) });

  await api.refreshNbaAnalysis(date, [], now);
  assert.deepEqual(reads, [[earlier, date]]);
  assert.equal(state.signalResearch.version, research.SIGNAL_RESEARCH_VERSION);
  const report = research.buildSignalResearchReport('NBA', trend.NBA_SIGNALS_POLICY.version, state.signalResearch.days);
  const over = JSON.parse(rows[0]['Details JSON']), under = JSON.parse(rows[1]['Details JSON']);
  assert.equal(research.signalCombinationRecord(report, over).record, '2-0-0');
  assert.equal(research.signalCombinationRecord(report, under).record, '0-1-0');
  assert.equal(research.signalResearchView(report, 'Total').total.record, '2-1-0');
  await api.refreshNbaAnalysis(date, [], now + 1000);
  assert.deepEqual(reads, [[earlier, date], [date]], 'ordinary refreshes read only the current date');
  const repeated = research.buildSignalResearchReport('NBA', trend.NBA_SIGNALS_POLICY.version, state.signalResearch.days);
  assert.equal(research.signalCombinationRecord(repeated, over).record, '2-0-0', 'repeated refresh does not double count');
  assert.equal(JSON.stringify(rows), originalRows, 'frozen observations stay unchanged');
  assert.equal(writes.filter(tab => tab === trend.NBA_ANALYSIS_TAB).length, 2);
});
