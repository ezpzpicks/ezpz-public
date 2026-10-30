const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const api = load(path.join(__dirname,'../lib/ncaafModelResearch.ts'));
const row = { Date:'2026-10-24','Game ID':'123',Game:'LSU @ Auburn','Bet Type':'Spread',Selection:'LSU -7',
  Result:'Win',Units:'0.9091',Grade:'B Spread','Projected Away':'28','Projected Home':'18','Actual Away':'30','Actual Home':'17',
  'Closing Line':'','Closing Line Value':'','Margin Residual':'','Total Residual':'' };
const history = { Date:row.Date,'Game ID':'123','Away Team':'LSU','Home Team':'Auburn',
  'Closing Quote Kind':'EXPLICIT_CLOSE','Closing Home Spread':'8','Closing Total':'47',
  'Closing Provider':'Book','History Checked At':'2026-10-25T02:00:00Z' };

test('spread CLV uses the selected team sign and preserves the frozen pick and profit',()=>{
  const changed=api.ncaafModelResearchPatches([row],[history]);
  assert.equal(changed.length,1);
  assert.equal(changed[0]['Closing Line'],'-8');
  assert.equal(changed[0]['Closing Line Value'],'1');
  assert.equal(changed[0]['Margin Residual'],'-3');
  assert.equal(changed[0]['Total Residual'],'1');
  for(const key of ['Selection','Grade','Result','Units'])assert.equal(changed[0][key],row[key]);
  assert.equal(row['Closing Line'],'');
});
test('home underdogs and pick-em closings retain numeric zero',()=>{
  const h={...row,Selection:'Auburn +7'};
  assert.equal(api.ncaafModelResearchPatches([h],[history])[0]['Closing Line Value'],'-1');
  const p=api.ncaafModelResearchPatches([{...h,Selection:'Auburn +1'}],[{...history,'Closing Home Spread':'0'}])[0];
  assert.equal(p['Closing Line'],'0');assert.equal(p['Closing Line Value'],'1');
});
test('over and under CLV have opposite signs',()=>{
  for(const [side,value]of [['Over','2'],['Under','-2']]){
    const p=api.ncaafModelResearchPatches([{...row,'Bet Type':'Total',Selection:side+' 45'}],[history])[0];
    assert.equal(p['Closing Line'],'47');assert.equal(p['Closing Line Value'],value);
  }
});
test('generic quotes, another date/event/opponent, and missing lines never fill closings',()=>{
  for(const change of [{'Closing Quote Kind':''},{Date:'2026-10-25'},{'Game ID':'999'},{'Away Team':'Alabama'}, {'Closing Home Spread':''}]){
    const p=api.ncaafModelResearchPatches([row],[{...history,...change}])[0];
    assert.equal(p['Closing Line'],'');
  }
});
test('captured closings and existing residuals are immutable and retries cause no writes',()=>{
  const p=api.ncaafModelResearchPatches([row],[history])[0];
  assert.equal(api.ncaafModelResearchPatches([p],[{...history,'Closing Home Spread':'10'}]).length,0);
});
test('blank scores remain missing while an actual zero score produces a residual',()=>{
  const pending={...row,Result:'Pending','Actual Away':'','Actual Home':''};
  assert.equal(api.ncaafModelResearchPatches([pending],[]).length,0);
  const zero=api.ncaafModelResearchPatches([{...row,'Actual Away':'0','Actual Home':'0'}],[])[0];
  assert.equal(zero['Total Residual'],'-46');
});
test('persistence copies only research fields from a derived public row and never creates a bet',()=>{
  const change=api.ncaafModelResearchPatches([{...row,Grade:'No Play',Units:'999'}],[history])[0];
  const writes=api.mergeNcaafResearchPatches([row],[change]);
  assert.equal(writes[0].Grade,'B Spread');assert.equal(writes[0].Units,'0.9091');
  assert.equal(writes[0]['Closing Line Value'],'1');
  assert.equal(api.mergeNcaafResearchPatches([],[change]).length,0);
  const fresh={...row,'Closing Line':'-9','Closing Line Value':'2','Closing Line Source':'manual'};
  const stale=api.mergeNcaafResearchPatches([fresh],[change])[0];
  assert.equal(stale['Closing Line'],'-9');assert.equal(stale['Closing Line Source'],'manual');
  assert.equal(stale['Closing Line Provider'],undefined);
});
test('the ESPN parser distinguishes explicit closes from generic historical reference lines',()=>{
  const parser=load(path.join(__dirname,'../lib/footballTeamSeasonHistory.ts'));
  const fixture=require('./fixtures/football-team-season-2026.json').games[0];
  const payload=JSON.parse(JSON.stringify(fixture.summary));
  const explicit=parser.parseEspnTeamSeasonGame(payload,'NCAAF',fixture.schedule,Date.parse('2026-10-30T12:00:00Z'));
  assert.equal(explicit['Closing Quote Kind'],'EXPLICIT_CLOSE');
  assert.ok(explicit['Closing Home Spread'] !== '');
  for(const quote of payload.pickcenter){ delete quote.pointSpread;delete quote.total; }
  const generic=parser.parseEspnTeamSeasonGame(payload,'NCAAF',fixture.schedule,Date.parse('2026-10-30T12:00:00Z'));
  assert.equal(generic['Closing Quote Kind'],'');assert.equal(generic['Closing Home Spread'],'');
  assert.equal(generic['Closing Total'],'');
});
