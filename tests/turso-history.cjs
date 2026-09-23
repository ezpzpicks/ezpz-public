const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Execute the production SQL against SQLite. Only the HTTP transport is mocked.
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE dataset_rows (
    sport TEXT, dataset TEXT, row_index INTEGER, payload_json TEXT, source_hash TEXT,
    date_key TEXT, game_key TEXT, game TEXT, market TEXT, selection TEXT, result TEXT,
    snapshot_time TEXT, imported_at TEXT, PRIMARY KEY(sport,dataset,row_index));
    CREATE TABLE dataset_manifest (
    sport TEXT, dataset TEXT, source_workbook TEXT, source_worksheet TEXT, headers_json TEXT,
    row_count INTEGER, imported_at TEXT, source_kind TEXT, PRIMARY KEY(sport,dataset));`);
  function execute(sql) {
    const stmt = db.prepare(sql);
    const cols = stmt.columns().map(({name}) => ({name}));
    if (!cols.length) return { cols, rows: [], affected_row_count: Number(stmt.run().changes) };
    const rows = stmt.all().map(row => cols.map(({name}) => row[name] == null
      ? {type:'null'} : {type:typeof row[name] === 'number' ? 'integer' : 'text', value:String(row[name])}));
    return { cols, rows, affected_row_count: 0 };
  }
  function loadStore() {
    const exports = {};
    const source = fs.readFileSync(path.join(__dirname, '../lib/tursoStore.ts'), 'utf8');
    const code = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
    vm.runInNewContext(code, {
      exports, require, console:{info(){}}, AbortSignal,
      process:{env:{TURSO_DATABASE_URL:'https://sqlite.test',TURSO_AUTH_TOKEN:'test'}},
      fetch: async (_url, options) => {
        const results = JSON.parse(options.body).requests.map(request => {
          try {
            if (request.type === 'close') {
              if (db.isTransaction) db.exec('ROLLBACK');
              return {type:'ok',response:{type:'close'}};
            }
            if (request.type === 'sequence') {
              db.exec(request.sql);
              return {type:'ok',response:{type:'sequence'}};
            }
            return {type:'ok',response:{type:'execute',result:execute(request.stmt.sql)}};
          } catch (error) {
            return {type:'error',error:{message:error.message,code:'SQLITE_ERROR'}};
          }
        });
        return {ok:true,text:async()=>JSON.stringify({results})};
      },
    });
    return exports;
  }
  return { db, store:loadStore(), other:loadStore(), failManifest:()=>db.exec(
    "CREATE TRIGGER fail_manifest BEFORE INSERT ON dataset_manifest BEGIN SELECT RAISE(ABORT, 'Injected manifest failure'); END"),
    rows:()=>db.prepare('SELECT row_index,payload_json FROM dataset_rows ORDER BY row_index').all(),
    count:()=>db.prepare('SELECT row_count FROM dataset_manifest').get()?.row_count };
}
const row = stamp => ({Date:'2026-09-23',Game:'A at B',Market:'Total',Selection:'Over',Line:'8.5',
  'Public Bets %':'70','Public Money %':'60','Snapshot Time ET':stamp});

test('concurrent history appends preserve both collection cycles', async () => {
  const f=fixture();
  await Promise.all([
    f.store.appendTursoDataset('MLB','public_split_history',[row('10:30')],['Date']),
    f.other.appendTursoDataset('MLB','public_split_history',[row('10:35')],['Date']),
  ]);
  assert.deepEqual(f.rows().map(x=>JSON.parse(x.payload_json)['Snapshot Time ET']), ['10:30','10:35']);
  assert.equal(f.count(),2);
});

test('a cached history read cannot overwrite another writer or hide its rows', async () => {
  const f=fixture();
  await f.store.withTursoReadCache(async()=>{
    await f.store.readTursoDataset('MLB','public_split_history');
    await f.other.appendTursoDataset('MLB','public_split_history',[row('10:30')],['Date']);
    await f.store.appendTursoDataset('MLB','public_split_history',[row('10:35')],['Date']);
    const seen=await f.store.readTursoDataset('MLB','public_split_history');
    assert.equal(seen.length,2);
  });
  assert.equal(f.rows().length,2);
  assert.equal(f.count(),2);
});

test('chunked appends retain unchanged heartbeats and exact row counts', async () => {
  const f=fixture();
  const rows=Array.from({length:251},(_,i)=>row(String(i)));
  await f.store.appendTursoDataset('NFL','odds_snapshot',rows,['Date']);
  assert.equal(f.rows().length,251);
  assert.equal(f.rows().at(-1).row_index,251);
  assert.equal(f.count(),251);
  await f.store.appendTursoDataset('NFL','odds_snapshot',[row('252')]);
  assert.equal(f.rows().length,252);
  assert.equal(f.db.prepare('SELECT headers_json FROM dataset_manifest').get().headers_json,'["Date"]');
});

test('a failed history transaction rolls back rows and never reports success', async () => {
  const f=fixture();
  await f.store.appendTursoDataset('NCAAF','odds_snapshot',[row('10:30')],['Date']);
  f.failManifest();
  await assert.rejects(f.store.appendTursoDataset('NCAAF','odds_snapshot',[row('10:35')],['Date']),/manifest failure/);
  assert.equal(f.rows().length,1);
  assert.equal(f.count(),1);
});
