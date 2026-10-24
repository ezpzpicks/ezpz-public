const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript'), load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '..');
const market = load(path.join(root, 'lib/nbaMarketCore.ts'));
const records = load(path.join(root, 'lib/nbaRecords.ts'));
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE nba_research_predictions(record_id TEXT,game_id TEXT,model_version TEXT,locked_at TEXT,payload_json TEXT); CREATE TABLE nba_research_results(observation_id TEXT,game_id TEXT,observed_at TEXT,payload_json TEXT);');
const queries = [], api = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'lib/nbaForecasts.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: api, Date, require: name => name === './tursoStore' ? {
  runTursoSql: async sql => sql.map(query => { queries.push(query); return db.prepare(query).all(); }),
} : name === './nbaMarketCore' ? market : require(name) });

const selected = { away_team: 'Denver Nuggets', home_team: 'Oklahoma City Thunder', total: 230, fair_home_spread: -8,
  home_spread_edge: -.5, total_edge: -6.5, spread_pick: 'Denver Nuggets +8.5', spread_grade: 'Pass',
  total_pick: 'Under 236.5', total_grade: 'A', market: { home_spread: -8.5, total: 236.5 } };
function save(id, gameId, tipoff, lockedAt) {
  db.prepare('INSERT INTO nba_research_predictions VALUES(?,?,?,?,?)').run(id, gameId, 'nba-live', lockedAt,
    JSON.stringify({ tipoff, selected, inputs: { automation: { phase: 'pregame' } }, review_method: 'automated' }));
}
save('first', '1', '2026-10-23T01:30:00Z', '2026-10-23T01:07:00Z');
save('second-early', '2', '2026-10-24T01:30:00Z', '2026-10-23T15:00:00Z');
save('second-pregame', '2', '2026-10-24T01:30:00Z', '2026-10-24T01:07:00Z');
const game = { game_id: '1', tipoff: '2026-10-23T01:30:00Z', completed: true, status: 'STATUS_FINAL',
  away: { name: selected.away_team, score: 106 }, home: { name: selected.home_team, score: 114 }, source: { observed_at: '2026-10-23T04:00:00Z' } };
db.prepare('INSERT INTO nba_research_results VALUES(?,?,?,?)').run('result', '1', game.source.observed_at, JSON.stringify({ game }));

test('forecast SQL respects Eastern slate dates, includes late-night locks, grades original prices and reads summary columns only', async () => {
  const day = await api.readNbaForecasts('2026-10-22');
  assert.equal(day.length, 1); assert.equal(day[0].recordId, 'first'); assert.equal(day[0].totalResult, 'WIN');
  assert.equal(day[0].phase, 'pregame');
  const next = await api.readNbaForecasts('2026-10-23');
  assert.equal(next.length, 2);
  const seed = await api.readNbaForecastHistory('2026-10-24');
  assert.equal(seed.length, 3);
  const rows = records.nbaModelPlays(seed, [], Date.parse('2026-10-24T05:00:00Z'));
  assert.equal(rows.length, 2); assert.equal(rows[0].result, 'W'); assert.equal(rows[1].result, '');
  assert(queries.every(query => query.includes('WHERE p.locked_at>=') && !query.includes('SELECT p.payload_json')));
});
