const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const load=require('./load-typescript.cjs');
const api=load(path.resolve(__dirname,'../lib/ncaamPointEdges.ts'));
const spreads=load(path.resolve(__dirname,'../lib/ncaamSpreadGrades.ts'));
const totals=load(path.resolve(__dirname,'../lib/ncaamMatchupGrades.ts'));
const records=load(path.resolve(__dirname,'../lib/ncaamRecords.ts'));
const fixture=require('./fixtures/ncaam-v16-calibrated-spreads.json');

test('native Python calibrated margins, court/personnel offsets and unchanged totals validate',()=>{
  for(const {forecast:f,before} of fixture.cases){
    const p=api.ncaamPointProjection(f);
    assert(p);assert.equal(p.model_version,api.NCAAM_POINT_MODEL);
    const c=p.market_models.spread.calibration;
    const expected=.8308142655650089*(before.margin-c.home_court_points-c.player_margin)+c.home_court_points+c.player_margin;
    assert.equal(p.margin,expected);assert.equal(p.total,before.total);
    assert(Math.abs(p.home_points+p.away_points-p.total)<1e-9);
    assert(Math.abs(p.home_points-p.away_points-p.margin)<1e-9);
    assert(spreads.ncaamSpreadGrade(f));assert(totals.ncaamMatchupGrade(f));
    assert.equal(f.matchup_total.grade,'A');
    assert.equal(f.matchup_spread.grade,f.gameId==='elite_7_research'?'Research':'B');
  }
});

test('both quote paths allow only 5-inclusive to 7-exclusive, for either selected side',()=>{
  for(const {forecast:f} of fixture.cases.slice(0,2)){
    const g=spreads.ncaamSpreadGrade(f),side=g.projected_side;
    const team=side==='home'?'home':'away';
    const margin=(side==='home'?1:-1)*f.matchup_projection.margin;
    const asOf=Date.parse(f.lockedAt)+1000;
    for(const [edge,grade] of [[4.999,'Research'],[5,'B'],[6.999,'B'],[7,'Research'],[20,'Research']]){
      const line=edge-margin;
      const quote=api.ncaamPointQuote(f,'Spread',team,line,asOf);
      assert.equal(quote.grade,grade,`${f.gameId} edge ${edge}`);
      assert.equal(quote.active,grade==='B');
      assert.equal(spreads.ncaamSpreadQuote(g,line).grade,grade);
    }
    const atSix=6-margin;
    assert.equal(api.ncaamPointQuote(f,'Spread',team,atSix,asOf,'-120').active,false);
    assert.equal(api.ncaamPointQuote(f,'Spread',team,atSix,Date.parse(f.tipoff)).active,false);
  }
});

test('saved A-sized disagreements remain Research and cannot become eligible by changing the grade',()=>{
  const f=structuredClone(fixture.cases[2].forecast);
  assert.equal(f.matchup_spread.edge_grade,'A');
  assert.equal(f.matchup_spread.eligible,false);
  assert.equal(records.ncaamModelPlays([f]).filter(p=>p.market==='Spread').length,0);
  const staleDisplay=structuredClone(f);staleDisplay.spread_grade='A';
  assert.equal(records.ncaamModelPlays([staleDisplay]).filter(p=>p.market==='Spread').length,0);
  const margin=f.matchup_projection.margin;
  assert.equal(api.ncaamPointQuote(f,'Spread','home',6-margin,Date.parse(f.lockedAt)+1000).grade,'B');
  f.matchup_spread.grade='A';f.matchup_spread.eligible=true;f.matchup_spread.side=f.matchup_spread.projected_side;
  assert.equal(spreads.ncaamSpreadGrade(f),null);
});

test('missing, changed or double-applied calibration evidence is rejected',()=>{
  const changes=[
    p=>delete p.market_models.spread.calibration,
    p=>p.market_models.spread.calibration.parameters.scale=1,
    p=>p.market_models.spread.calibration.parameters.training_through='2026-11-21',
    p=>p.market_models.spread.calibration.source_model_version=api.INDEPENDENT_NCAAM_POINT_MODEL,
    p=>p.market_models.spread.calibration.source_margin+=1,
    p=>p.market_models.spread.calibration.home_court_points+=1,
    p=>p.market_models.spread.calibration.player_margin+=1,
    p=>p.market_models.spread.calibration.neutral_margin+=1,
    p=>p.market_models.spread.model_version=api.MIRRORED_DEFENSE_NCAAM_POINT_MODEL,
    p=>p.market_models.total.total+=1,
  ];
  for(const change of changes){
    const f=structuredClone(fixture.cases[1].forecast);change(f.matchup_projection);
    assert.equal(api.ncaamPointProjection(f),null,change.toString());
    assert.equal(spreads.ncaamSpreadGrade(f),null);
    assert.equal(totals.ncaamMatchupGrade(f),null);
  }
});

test('a widened or missing B-only policy cannot qualify a saved grade or current quote',()=>{
  for(const change of [g=>delete g.policy.spread_selection,g=>g.policy.spread_selection.maximum_point_edge_exclusive=8]){
    const f=structuredClone(fixture.cases[0].forecast);change(f.matchup_spread);
    assert.equal(spreads.ncaamSpreadGrade(f),null);
    assert.equal(spreads.ncaamSpreadQuote(f.matchup_spread,f.matchup_spread.line).grade,'Research');
    assert.equal(api.ncaamPointQuote(f,'Spread','home',f.matchup_spread.line,Date.parse(f.lockedAt)+1000).active,false);
  }
});

test('records retain each archived policy and reject any replacement captured after tipoff',()=>{
  const archived=require('./fixtures/ncaam-v15-independent-markets.json').cases[0].forecast;
  const before=structuredClone(archived);
  assert(api.ncaamPointProjection(archived));
  assert.equal(api.ncaamPointProjection(archived).model_version,api.INDEPENDENT_NCAAM_POINT_MODEL);
  const late={...fixture.cases[0].forecast,gameId:archived.gameId,tipoff:archived.tipoff,lockedAt:archived.tipoff};
  const chosen=records.latestNcaamForecasts([archived,late]);
  assert.equal(chosen.length,1);assert.equal(chosen[0].recordId,archived.recordId);
  const borrowed=structuredClone(archived);
  borrowed.matchup_spread.policy.spread_selection=fixture.cases[0].forecast.matchup_spread.policy.spread_selection;
  assert.equal(spreads.ncaamSpreadGrade(borrowed),null);
  assert.deepEqual(archived,before);
});
