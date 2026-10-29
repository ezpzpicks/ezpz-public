const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript'), { NextRequest } = require('next/server');
const root = path.join(__dirname, '..');
const load = require('./load-typescript.cjs');
const teams = load(path.join(root, 'lib/footballTeamTrends.ts'));
const date = '2026-10-25';
const json = value => JSON.parse(JSON.stringify(value));
function harness() {
  const db = new DatabaseSync(':memory:'), calls = [], core = {}, route = {};
  db.exec('CREATE TABLE dataset_rows(sport TEXT,dataset TEXT,date_key TEXT,payload_json TEXT); CREATE INDEX idx_dataset_rows_date ON dataset_rows(sport,dataset,date_key)');
  const store = {
    runTursoSql: async statements => statements.map(sql => { calls.push(sql); return db.prepare(sql).all(); }),
    readTursoDatasetByDateKeys: async (sport, dataset, keys) => {
      calls.push({ sport, dataset, keys });
      return db.prepare(`SELECT payload_json FROM dataset_rows WHERE sport=? AND dataset=? AND date_key IN (${keys.map(() => '?').join(',')})`)
        .all(sport, dataset, ...keys).map(row => JSON.parse(row.payload_json));
    },
  };
  function compile(file, exports, imports) {
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, { exports, Date, Intl, console, require: name => imports[name] || require(name) });
  }
  compile('lib/slateHistory.ts', core, { './tursoStore': store, './footballTeamTrends': teams });
  compile('app/api/slate-history/route.ts', route, { '../../../lib/slateHistory': core });
  return { ...core, ...route, calls, db, add(sport, dataset, day, row) {
    db.prepare('INSERT INTO dataset_rows VALUES(?,?,?,?)').run(sport, dataset, day, JSON.stringify(row));
  } };
}
const request = (sport, selected) => new NextRequest(`https://example.test/api/slate-history?sport=${sport}${selected === undefined ? '' : '&date=' + encodeURIComponent(selected)}`);

test('date dropdown discovery is sport scoped, normalized, newest first, and reads only the date index', async () => {
  const h = harness();
  for (const [sport, dataset, day] of [['NFL','daily_slate','10/25/2026'], ['NFL','schedule','2026-10-25'], ['NFL','daily_slate','2026-10-18'],
    ['NCAAF','daily_slate','2026-10-24'], ['MLB','daily_slate','2026-10-23'], ['NFL','daily_slate','2026-02-30']]) h.add(sport,dataset,day,{});
  const response = await h.GET(request('NFL'));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).availableDates, [date,'2026-10-18']);
  assert.equal(h.calls.length, 2);
  for (const sql of h.calls) {
    assert.match(sql, /^SELECT DISTINCT date_key/);
    assert.match(sql, /INDEXED BY idx_dataset_rows_date/);
    assert.doesNotMatch(sql, /payload_json/);
    const plan = h.db.prepare('EXPLAIN QUERY PLAN ' + sql).all().map(row => row.detail).join(' ');
    assert.match(plan, /COVERING INDEX idx_dataset_rows_date/);
  }
});

test('historical football slates retain stored projections, missing forecasts, official kickoff and saved grades', async () => {
  const h = harness();
  h.add('NFL','schedule',date,{ Date:date,'Game ID':'official','Away Team':'NY Giants','Home Team':'LA Rams','Game Time': date+'T20:25:00Z' });
  h.add('NFL','schedule',date,{ Date:date,'Game ID':'no-model','Away Team':'Miami Dolphins','Home Team':'Buffalo Bills' });
  h.add('NFL','daily_slate',date,{ Date:date,'Game ID':'old-id','Away Team':'New York Giants','Home Team':'Los Angeles Rams','Game Time':'wrong-time',Reliability:'82' });
  h.add('NFL','bet_tracker',date,{ Date:date,Game:'New York Giants @ Los Angeles Rams','Projected Away':'21.4','Projected Home':'27.8','Bet Type':'Total',Grade:'A',Selection:'Over 45.5','Model Probability':'0.64' });
  h.add('NFL','daily_slate','2026-10-29',{ Date:'2026-10-29','Away Team':'Today','Home Team':'Only','Projected Away':'99' });
  h.add('NCAAF','daily_slate',date,{ Date:date,'Away Team':'Wrong sport','Home Team':'Only','Projected Away':'99' });
  const response = await h.GET(request('NFL',date)), data = await response.json();
  assert.equal(response.status,200);
  assert.equal(data.today,date);
  assert.equal(data.historicalSlate,true);
  assert.equal(data.slateToday.length,2);
  const row = data.slateToday.find(row => row['Game ID'] === 'official');
  assert.equal(row['Game Time'],date+'T20:25:00Z');
  assert.equal(row['Projected Away'],'21.4');
  assert.equal(row['Projected Home'],'27.8');
  assert.equal(row['Projected Total'],'49.2');
  assert.equal(row['Total Grade'],'A');
  assert.equal(row['Total Pick'],'Over 45.5');
  assert.equal(row.Reliability,'82');
  assert.equal(data.slateToday[1]['Projected Away'],undefined);
  assert.deepEqual(data.footballWeeklyMarket.games,data.slateToday);
  assert.deepEqual(data.footballWeeklyMarket.splits,[]);
  assert.deepEqual(h.calls.map(call => call.dataset).sort(), ['bet_tracker','daily_slate','schedule']);
  for (const call of h.calls) { assert.equal(call.sport,'NFL'); assert(call.keys.includes(date)); assert(!call.keys.includes('2026-10-29')); }
});

test('MLB history supports older US date keys and preserves doubleheader projections', async () => {
  const h = harness();
  for (const id of ['game-one','game-two']) h.add('MLB','daily_slate','10/25/2026',{ Date:'10/25/2026','Game ID':id,'Away Team':'Away','Home Team':'Home','Projected Away Runs':id === 'game-one' ? '3.2' : '4.8' });
  const data = await (await h.GET(request('MLB',date))).json();
  assert.equal(data.slateToday.length,2);
  assert.deepEqual(data.slateToday.map(row => row['Projected Away Runs']),['3.2','4.8']);
  assert.equal(h.calls.length,1);
  assert.equal(h.calls[0].dataset,'daily_slate');
});

test('invalid dates and sports are rejected before storage; empty dates never fall back to today', async () => {
  const h = harness();
  for (const [sport,day] of [['NBA',date],['INVALID',date],['NFL','2026-02-30'],['NFL',"2026-10-25' OR 1=1"],['NFL','']])
    assert.equal((await h.GET(request(sport,day))).status,400);
  assert.equal(h.calls.length,0);
  const empty = await (await h.GET(request('NCAAF','2026-10-01'))).json();
  assert.deepEqual(empty.slateToday,[]);
  assert.equal(empty.today,'2026-10-01');
});

test('saved college model values are preserved while official names and game time stay attached', () => {
  const h = harness();
  const schedule = [{ Date:date,'Away Team':'Texas A&M','Home Team':'Florida','Game ID':'official','Game Time':'7:00 PM' }];
  const models = [{ Date:date,'Away Team':'Texas AM Aggies','Home Team':'Florida Gators','Projected Away':'32.1','Projected Home':'24.2','Spread Grade':'B','Total Pick':'Over 52.5' }];
  const rows = json(h.mergeSavedSlate('NCAAF',date,models,schedule,[]));
  assert.equal(rows.length,1);
  assert.equal(rows[0]['Game Time'],'7:00 PM');
  assert.equal(rows[0]['Projected Away'],'32.1');
  assert.equal(rows[0]['Spread Grade'],'B');
  assert.equal(rows[0]['Total Pick'],'Over 52.5');
});
