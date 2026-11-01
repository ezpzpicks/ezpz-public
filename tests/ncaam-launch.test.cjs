const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, f);
const market = require('../lib/ncaamMarketCore.ts');
const analysis = require('../lib/ncaamAnalysisCore.ts');
const sos = require('../lib/ncaamSos.ts');
const picks = require('../lib/signalPicks.ts');
const source = require('../lib/scoresAndOddsBettingSplits.ts');
const catalogs = require('../lib/footballTrendCatalog.ts');
const records = require('../lib/ncaamRecords.ts');
const tipoff = Date.parse('2026-11-01T14:30:00Z'), lock = tipoff - 15 * 60000;
const iso = n => new Date(n).toISOString();
const payload = { events: [{ id: '401920982', season: { year: 2027, type: 2 }, competitions: [{
  date: iso(tipoff), timeValid: true, neutralSite: true,
  status: { type: { name: 'STATUS_SCHEDULED', state: 'pre', completed: false } },
  competitors: [{ homeAway: 'away', team: { id: '87', displayName: 'Notre Dame Fighting Irish', location: 'Notre Dame', abbreviation: 'ND' } },
    { homeAway: 'home', team: { id: '222', displayName: 'Villanova Wildcats', location: 'Villanova', abbreviation: 'VILL' } }],
}] }] };
function fixtures() {
  const games = market.normalizeNcaamSlate(payload, '2026-11-01');
  const splits = [['Spread','Notre Dame',3,40,60], ['Spread','Villanova',-3,60,40], ['Total','Over',145,60,45], ['Total','Under',145,40,55]]
    .map(([kind,selection,line,betsPct,moneyPct]) => ({ date:'2026-11-01', eventTime:iso(tipoff), awayTeam:'Notre Dame', homeTeam:'Villanova',
      market:kind, selection, selectionTeam:selection, side:kind==='Total'?selection:'', line,betsPct,moneyPct,sourceUrl:'https://example.test' }));
  return { games, rows:market.bindNcaamSplits(splits,games,lock).rows, splits };
}
test('NCAAM uses the verified DST tipoff, neutral court, current-season teams and dated SAO URL', () => {
  const {games,rows}=fixtures();
  assert.equal(games[0].neutralSite,true); assert.equal(games[0].season,2027);
  assert.equal(rows.length,4); assert(rows.every(r=>r['Game Time']===iso(tipoff)&&r['Game Key'].includes('|ncaam|')));
  assert.equal(new Date(games[0].tipoff).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit'}),'9:30 AM');
  assert.equal(source.scoresAndOddsConsensusUrl('NCAAB',{date:'2026-11-01'}),'https://www.scoresandodds.com/ncaab/consensus-picks?date=2026-11-01');
  assert.throws(()=>market.normalizeNcaamSlate({events:[payload.events[0],payload.events[0]]},'2026-11-01'),/Duplicate/);
  const exhibition=structuredClone(payload);exhibition.events[0].season.type=1;
  assert.deepEqual(market.normalizeNcaamSlate(exhibition,'2026-11-01'),[]);
});
test('only complete, consistent four-side markets can freeze and later observations cannot replace finals', () => {
  const {games,splits,rows}=fixtures();
  assert.equal(market.bindNcaamSplits(splits.slice(0,3),games,lock).rows.length,0);
  assert.equal(market.bindNcaamSplits([...splits,{...splits[0],line:99}],games,lock).rows.length,0);
  const reversed=splits.map(s=>({...s,awayTeam:s.homeTeam,homeTeam:s.awayTeam}));
  assert.equal(market.bindNcaamSplits(reversed,games,lock).rows.length,4);
  assert.equal(market.bindNcaamSplits(reversed,[{...games[0],neutralSite:false}],lock).rows.length,0);
  const saved=market.advanceNcaamMarkets(rows,[],lock);
  assert.equal(saved.finals.length,4);
  assert.equal(market.advanceNcaamMarkets(rows,saved.latest,lock+60000).latest.length,0);
  assert.equal(market.advanceNcaamMarkets(rows,[],tipoff-9*60000).finals.length,0);
});
test('NCAAM captures its own combo evidence without importing another sport threshold or promoting research forecasts', () => {
  const {rows}=fixtures(); const frozen=market.advanceNcaamMarkets(rows,[],lock).latest;
  const games=[{Date:'2026-11-01','Game ID':'401920982','Game Key':'2026-11-01|ncaam|401920982','Game Time':iso(tipoff),'Away Team':'Notre Dame Fighting Irish','Home Team':'Villanova Wildcats',Status:'STATUS_SCHEDULED'}];
  const result=analysis.buildNcaamSignals({date:'2026-11-01',games,splits:frozen,forecasts:[],storedRows:[],state:analysis.emptyNcaamAnalysis('2026-11-01'),now:lock,capture:true});
  assert.equal(result.board.sport,'NCAAM'); assert.equal(result.board.sides.length,4);
  assert.equal(result.changedRows.length,4);
  const uncovered={...games[0],'Game ID':'999','Game Key':'2026-11-01|ncaam|999','Away Team':'Other Away','Home Team':'Other Home','Game Time':iso(tipoff+8*3600000)};
  const partial=analysis.buildNcaamSignals({date:'2026-11-01',games:[...games,uncovered],splits:frozen,forecasts:[],storedRows:[],state:analysis.emptyNcaamAnalysis('2026-11-01'),now:lock,capture:true});
  assert.equal(partial.stale,true); assert.equal(partial.changedRows.length,4);
  const incomplete=analysis.buildNcaamSignals({date:'2026-11-01',games,splits:frozen.slice(0,3),forecasts:[],storedRows:[],state:analysis.emptyNcaamAnalysis('2026-11-01'),now:lock,capture:true});
  assert.equal(incomplete.changedRows.length,0);
  assert(result.board.sides.every(s=>s.comboScore?.sport==='NCAAM'&&s.comboScore.score===50));
  assert.deepEqual(picks.selectSignalEzpzPicks(result.board.sides,'NCAAM',lock),[]);
  assert.equal(picks.comboPickPolicy('NCAAM','2026-11-01'),null);
  assert.equal(records.ncaamModelPlays([{gameId:'401920982',tipoff:iso(tipoff),lockedAt:iso(lock),away_team:'Notre Dame',home_team:'Villanova',spread_grade:'Research',total_grade:'Research'}],games,lock).length,0);
  const config=catalogs.footballCatalog('NCAAM');assert.match(config.version,/ncaam-/);
  assert(config.rules.every(r=>['E','H','P'].includes(r.data)));
});
test('Warren Nolan basketball keeps team ELO separate from RPI SOS and refuses future snapshots', () => {
  const elo='<table><tr><th>Team Record ELO Rank ELO Delta</th></tr>'+Array.from({length:300},(_,i)=>`<tr><td>College ${i}</td><td>0-0</td><td>${1500-i}</td><td>${i+1}</td><td></td></tr>`).join('')+'</table>';
  const rpi='<table><tr><th>Team SOS Rank Opp Record Opp Win Percent</th></tr>'+Array.from({length:300},(_,i)=>`<tr><td>College ${i}</td><td>0.0000</td><td>1</td><td>0-0</td><td>0.0000</td></tr>`).join('')+'</table>';
  const snapshot=sos.parseNcaamWarrenNolan(elo,rpi,2027,iso(lock));
  assert.equal(snapshot.teams.length,300); assert.equal(snapshot.teams[0].elo,1500);
  assert.match(snapshot.sourceUrl,/basketball\/2027\/sos-rpi/);
  assert.equal(sos.ncaamSosForTeam(snapshot,'College 0 Wildcats',lock).opponentRecord,'0-0');
  assert.equal(sos.ncaamSosForTeam(snapshot,'College 0',lock-1),null);
  assert.throws(()=>sos.parseNcaamWarrenNolan('<html>challenge</html>',rpi,2027,iso(lock)),/unavailable/);
});
test('active NCAAM signals are captured and settled while official EZPZ selections stay on hold', () => {
  const {games,splits}=fixtures();
  const observed=splits.map(row=>({...row,moneyPct:row.market==='Spread'?(row.selection==='Notre Dame'?75:25):row.moneyPct}));
  const frozen=market.advanceNcaamMarkets(market.bindNcaamSplits(observed,games,lock).rows,[],lock).latest;
  const schedule=frozen.slice(0,1).map(row=>({...row,Status:'STATUS_SCHEDULED',Completed:'FALSE'}));
  const state=analysis.emptyNcaamAnalysis('2026-11-01');
  const captured=analysis.buildNcaamSignals({date:'2026-11-01',games:schedule,splits:frozen,forecasts:[],storedRows:[],state,now:lock,capture:true});
  assert.equal(captured.changedRows.length,4);
  assert(captured.board.sides.some(side=>side.signals.some(signal=>signal.key==='money'&&signal.active)));
  assert(captured.board.sides.every(side=>side.recorded&&!side.selected));
  const completed=schedule.map(row=>({...row,Status:'STATUS_FINAL',Completed:'TRUE','Away Score':'70','Home Score':'75','Result Updated':iso(tipoff+2*3600000)}));
  const settled=analysis.buildNcaamSignals({date:'2026-11-01',games:completed,splits:frozen,forecasts:[],storedRows:captured.changedRows,
    state:{...state,signalResearch:captured.signalResearch},now:tipoff+3*3600000,capture:true});
  assert.equal(settled.changedRows.length,4);
  assert(settled.board.sides.every(side=>['W','L','P'].includes(side.result)&&!side.selected));
  assert(Object.keys(settled.signalResearch.days).includes('2026-11-01'));
  assert.deepEqual(picks.selectSignalEzpzPicks(settled.board.sides,'NCAAM',tipoff+3*3600000),[]);
});
test('saved NCAAM trend records require the original final-window quartet and an official matching result', () => {
  const {rows}=fixtures();const frozen=market.advanceNcaamMarkets(rows,[],lock).latest;
  const final={...frozen[0],Source:'ESPN NCAAM schedule; ScoresAndOdds market lines',Status:'STATUS_FINAL',Completed:'TRUE','Away Score':'70','Home Score':'75','Result Updated':iso(tipoff+2*3600000)};
  const settled=analysis.settleNcaamTrendRows(frozen,[final],tipoff+3*3600000);
  assert.equal(settled.length,4);assert(settled.every(r=>r.Sport==='NCAAM'));
  assert.equal(analysis.settleNcaamTrendRows(frozen.slice(1),[final],tipoff+3*3600000).length,0);
  assert.equal(analysis.settleNcaamTrendRows(frozen,[{...final,'Game ID':'999'}],tipoff+3*3600000).length,0);
});
