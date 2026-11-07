const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript');
const load = require('./load-typescript.cjs');
const { api: trial, game, plain } = require('./selection-trial-fixtures.cjs');
const root = path.resolve(__dirname, '..');
const context = load(path.join(root, 'lib/matchupContext.ts'));

test('SQL owns a single frozen review and settlement changes outcomes while public reads stay read-only', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE dataset_rows(sport TEXT,dataset TEXT,row_index INTEGER,payload_json TEXT,source_hash TEXT,date_key TEXT,
    game_key TEXT,game TEXT,market TEXT,selection TEXT,result TEXT,snapshot_time TEXT,imported_at TEXT,PRIMARY KEY(sport,dataset,row_index));
    CREATE INDEX idx_dataset_rows_date ON dataset_rows(sport,dataset,date_key);
    CREATE TABLE dataset_manifest(sport TEXT,dataset TEXT,source_workbook TEXT,source_worksheet TEXT,headers_json TEXT,row_count INTEGER,
    imported_at TEXT,source_kind TEXT,PRIMARY KEY(sport,dataset));`);
  const date = '2026-11-04';
  let clock = trial.trialDayStart(date) + 17.75 * 3600000, writes = 0;
  const batches = [];
  class Clock extends Date { static now() { return clock; } }
  const q = value => `'${String(value).replaceAll("'", "''")}'`;
  const io = {
    runTursoSql: async statements => statements.map(sql => db.prepare(sql).all()),
    runTursoAtomicSql: async statements => {
      writes++; batches.push(statements.slice()); db.exec('BEGIN IMMEDIATE');
      try { statements.forEach(sql => db.exec(sql)); db.exec('COMMIT'); }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    readTursoDatasetByDateKeys: async (sport, dataset, dates) => db.prepare(`SELECT payload_json FROM dataset_rows
      WHERE sport=${q(sport)} AND dataset=${q(dataset)} AND date_key IN (${dates.map(q).join(',') || "''"})`).all().map(row => JSON.parse(row.payload_json)),
  };
  function moduleWith(file, imports) {
    const exports = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, { exports, Date: Clock, console, require: name => imports[name]
      || (name.startsWith('.') ? load(path.resolve(root, path.dirname(file), `${name}.ts`)) : require(name)) });
    return exports;
  }
  try {
    const storage = moduleWith('lib/selectionTrialStore.ts', { './tursoStore': io, './selectionTrial': trial });
    const store = moduleWith('lib/matchupContextStore.ts', {
      './tursoStore': io, './selectionTrialStore': storage, './selectionTrial': trial, './matchupContext': context,
      './footballSignals': { signalRecord: rows => {
        const wins = rows.filter(row => row.result === 'W').length, losses = rows.filter(row => row.result === 'L').length;
        return { wins, losses, record: `${wins}-${losses}-0`, settled: wins + losses, pending: rows.length - wins - losses };
      } },
    });
    const model = context.buildContextModel('NBA', date, [], clock);
    model.models.forEach(fit => Object.assign(fit, { status: 'Trial estimates available', calibrationShrink: 1, calibrationGames: 100,
      beta: fit.beta.map((_, i) => fit.market === 'Spread' && i === 0 ? 1 : 0), covariance: fit.covariance.map(row => row.map(() => 0)) }));
    await storage.insertTrialRows('NBA', store.CONTEXT_MODELS_TAB, [{ Date: date, 'Game Key': `model|${context.MATCHUP_CONTEXT_VERSION}`,
      Market: 'Model', Selection: context.MATCHUP_CONTEXT_VERSION, 'Details JSON': JSON.stringify(model) }]);
    const sides = game(date);
    const first = await store.captureMatchupContext('NBA', sides, [], clock);
    assert.equal(first.captured, 1);
    const saved = () => JSON.parse(JSON.parse(db.prepare(`SELECT payload_json FROM dataset_rows WHERE dataset=${q(store.CONTEXT_DECISIONS_TAB)}`).get().payload_json)['Details JSON']);
    const original = saved();
    assert(original.pickId);
    assert.equal(original.cases.length, 4);
    await store.captureMatchupContext('NBA', sides.map(side => ({ ...side, line: side.line + 1 })), [], clock + 1);
    assert.deepEqual(saved(), original);
    clock += 4 * 3600000;
    const settled = sides.map((side, i) => ({ ...side, result: i % 2 ? 'L' : 'W', resultUpdated: new Date(clock).toISOString() }));
    await store.captureMatchupContext('NBA', settled, [], clock);
    const graded = saved();
    const earlierUpdate = batches.at(-1);
    assert.equal(Object.keys(graded.outcomes).length, 4);
    assert.deepEqual({ ...graded, outcomes: {} }, original);
    clock += 60000;
    await store.captureMatchupContext('NBA', settled.map((side, i) => ({ ...side,
      result: i < 2 ? i === 0 ? 'L' : 'W' : side.result, resultUpdated: new Date(clock).toISOString() })), [], clock);
    const corrected = saved();
    assert.equal(corrected.outcomes[original.pickId].result, 'L');
    await io.runTursoAtomicSql(earlierUpdate);
    assert.deepEqual(saved(), corrected, 'A stale concurrent settlement cannot replace a newer correction');
    const before = writes;
    const report = await store.readMatchupContext('NBA', date);
    assert.equal(report.record.record, '0-1-0');
    assert.equal(report.capturedGames, 1);
    assert.equal(writes, before);
    assert.equal((await store.readMatchupContext('NFL', date)).capturedGames, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM dataset_rows WHERE dataset='current_ezpz_picks'").get().n, 0);
    assert.equal(plain(report.today)[0].pickId, original.pickId);
  } finally { db.close(); }
});
