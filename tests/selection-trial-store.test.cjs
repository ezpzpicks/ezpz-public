const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { spawnSync } = require('node:child_process');
const { api, game, history, plain } = require('./selection-trial-fixtures.cjs');

test('actual SQL freezes once, merges outcomes only, isolates sports, and serves a read-only comparison', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ezpz-trial-')), db = path.join(temp, 'trial.sqlite');
  let clock = api.trialDayStart('2026-11-04') + 17.75 * 3600000;
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } }
  function sql(statements, atomic = false) {
    const script = `import sqlite3,json,sys
d=json.load(sys.stdin)
c=sqlite3.connect(d['db']);c.row_factory=sqlite3.Row
if d['atomic']:c.execute('BEGIN IMMEDIATE')
out=[]
for s in d['statements']:
 r=c.execute(s);out.append([dict(x) for x in r.fetchall()])
c.commit();print(json.dumps(out))`;
    const result = spawnSync('python', ['-c', script], { input: JSON.stringify({ db, statements, atomic }), encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr);
    return JSON.parse(result.stdout);
  }
  try {
    sql([`CREATE TABLE dataset_rows (sport TEXT,dataset TEXT,row_index INTEGER,payload_json TEXT,source_hash TEXT,date_key TEXT,game_key TEXT,game TEXT,market TEXT,selection TEXT,result TEXT,snapshot_time TEXT,imported_at TEXT,PRIMARY KEY(sport,dataset,row_index))`,
      `CREATE INDEX idx_dataset_rows_date ON dataset_rows(sport,dataset,date_key)`,
      `CREATE TABLE dataset_manifest (sport TEXT,dataset TEXT,source_workbook TEXT,source_worksheet TEXT,headers_json TEXT,row_count INTEGER,imported_at TEXT,source_kind TEXT,PRIMARY KEY(sport,dataset))`]);
    const quote = value => `'${String(value).replaceAll("'", "''")}'`;
    function row(side) { return { Date: side.date, 'Pick Key': side.id, 'Policy Version': side.policyVersion, Result: side.result,
      'Result Updated': side.resultUpdated, 'Details JSON': JSON.stringify(side) }; }
    sql(history().map((s, i) => `INSERT INTO dataset_rows(sport,dataset,row_index,payload_json,date_key) VALUES ('NBA','nba_signal_observations',${i + 1},${quote(JSON.stringify(row(s)))},${quote(s.date)})`), true);
    const calls = [];
    const store = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../lib/selectionTrialStore.ts'), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, { exports: store, Date: Clock,
      require: name => name === './selectionTrial' ? api : name === './tursoStore' ? {
        readTursoDatasetByDateKeys: async (sport, tab, dates) => {
          calls.push(['read', sport, tab]);
          return sql([`SELECT payload_json FROM dataset_rows WHERE sport=${quote(sport)} AND dataset=${quote(tab)} AND date_key IN (${dates.map(quote).join(',') || "''"})`])[0].map(r => JSON.parse(r.payload_json));
        },
        runTursoSql: async statements => { calls.push(['sql-read', ...statements]); return sql(statements); },
        runTursoAtomicSql: async statements => { calls.push(['write', ...statements]); return sql(statements, true); },
      } : require(name),
    });
    const sides = game('2026-11-04');
    const first = await store.captureSelectionTrial('NBA', sides, [sides[0].id], clock);
    assert.equal(first.captured, 1);
    const sourceReads = () => calls.filter(c => c[0] === 'sql-read' && c.some(x => typeof x === 'string' && x.includes("dataset='nba_signal_observations'"))).length;
    const initialSourceReads = sourceReads();
    const all = () => sql(["SELECT payload_json FROM dataset_rows WHERE dataset='selection_trial_decisions'"])[0].map(r => JSON.parse(r.payload_json));
    const original = JSON.parse(all()[0]['Details JSON']);
    const changed = sides.map(s => s.market === 'Total' ? { ...s, line: 221.5, selection: s.selection.replace('220.5', '221.5') } : s);
    const repeat = await store.captureSelectionTrial('NBA', changed, [sides[1].id], clock + 1000);
    assert.equal(repeat.captured, 0); assert.equal(all().length, 1);
    assert.deepEqual(JSON.parse(all()[0]['Details JSON']), original);
    assert.equal(sourceReads(), initialSourceReads, 'A daily model is fitted once, not on each tick');
    clock += 4 * 3600000;
    const settled = sides.map((s, i) => ({ ...s, result: i % 2 ? 'L' : 'W', resultUpdated: new Date(clock).toISOString() }));
    await store.captureSelectionTrial('NBA', settled, [], clock);
    const savedRow = all()[0], saved = JSON.parse(savedRow['Details JSON']);
    assert.equal(typeof savedRow['Details JSON'], 'string', 'SQLite preserves the established Details JSON contract');
    assert.equal(savedRow.Result, 'SETTLED');
    assert.equal(Object.keys(saved.outcomes).length, 4);
    assert.deepEqual({ ...saved, outcomes: {} }, original, 'SQL cannot rewrite the quote, pick or model');
    const writes = calls.filter(c => c[0] === 'write').length;
    const report = await store.readSelectionTrial('NBA', '2026-11-04');
    assert.equal(report.capturedGames, 1); assert.equal(report.trial.settled, 1); assert.equal(report.comparison.settled, 1);
    assert.equal(report.paperTrial.capturedGames, 1);
    assert.equal(report.paperTrial.raw.settled, 1);
    assert.equal(report.paperTrial.reversalGames, 0);
    assert.equal(report.paperTrial.matchedRaw.settled, 0);
    assert.equal(report.paperTrial.opposite.settled, 0);
    assert.deepEqual(saved.paperComparison, original.paperComparison, 'SQL settlement cannot rewrite paper selections');
    assert.equal(calls.filter(c => c[0] === 'write').length, writes, 'Public report is read only');
    const college = await store.readSelectionTrial('NCAAM', '2026-11-04');
    assert.equal(college.capturedGames, 0); assert.equal(college.available, false);
    assert.equal(sql(["SELECT COUNT(*) n FROM dataset_rows WHERE dataset='current_ezpz_picks'"])[0][0].n, 0);
    // Football postseason in January must retain the preceding fall's original observations.
    sql(history().map((source, i) => {
      const side = { ...source, policyVersion: 'football-signals-nfl-grouped-test-v1' };
      return `INSERT INTO dataset_rows(sport,dataset,row_index,payload_json,date_key) VALUES ('NFL','football_signal_observations',${i + 1},${quote(JSON.stringify(row(side)))},${quote(side.date)})`;
    }), true);
    clock = api.trialDayStart('2027-01-03') + 17.75 * 3600000;
    await store.captureSelectionTrial('NFL', [], [], clock);
    const postseason = await store.readSelectionTrial('NFL', '2027-01-03');
    assert.equal(postseason.model.models[0].games, 144);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('raw adapters reject replayed/foreign policy rows and retain original quote flags', () => {
  const filename = path.resolve(__dirname, '../lib/selectionTrialStore.ts'), store = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: store, require: name => name === './selectionTrial' ? api : {} });
  const side = game('2026-11-04')[0];
  const row = { Date: side.date, 'Pick Key': side.id, 'Policy Version': side.policyVersion, 'Details JSON': JSON.stringify(side), Result: 'W', 'Result Updated': '2026-11-05T02:00:00Z' };
  assert.equal(store.trialSidesFromRows('NBA', [row]).length, 1);
  assert.equal(store.trialSidesFromRows('NCAAM', [row]).length, 0);
  assert.equal(store.trialSidesFromRows('NBA', [{ ...row, 'Details JSON': JSON.stringify({ ...side, researchOrigin: 'replay' }) }]).length, 0);
  assert.deepEqual(plain(store.trialSidesFromRows('NBA', [row])[0].signals), plain(side.signals));
});
