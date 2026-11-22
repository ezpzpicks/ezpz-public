const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const load=require('./load-typescript.cjs');
const api=load(path.join(__dirname,'../lib/ncaamPointEdges.ts'));
const totals=load(path.join(__dirname,'../lib/ncaamMatchupGrades.ts'));
const spreads=load(path.join(__dirname,'../lib/ncaamSpreadGrades.ts'));
const fixture=require('./fixtures/ncaam-v15-independent-markets.json');

test('Python-generated independent totals and spread margins validate under the new version',()=>{
 for(const {forecast:f,before} of fixture.cases){
  const p=api.ncaamPointProjection(f);
  assert(p);assert.equal(p.model_version,api.INDEPENDENT_NCAAM_POINT_MODEL);
  assert(totals.ncaamMatchupGrade(f));assert(spreads.ncaamSpreadGrade(f));
  assert.equal(p.margin,before.margin);
  assert(Math.abs(p.home_points+p.away_points-p.total)<1e-9);
  assert(Math.abs(p.home_points-p.away_points-p.margin)<1e-9);
  assert.equal(p.market_models.total.offense_extras_applied,false);
  assert.equal(p.market_models.total.defense_extras_applied,false);
  assert.equal(p.market_models.spread.model_version,api.MIRRORED_DEFENSE_NCAAM_POINT_MODEL);
 }
});

test('missing, spliced, altered or double-applied market proofs fail validation',()=>{
 const changes=[
  f=>delete f.matchup_projection.market_models,
  f=>f.matchup_projection.market_models.total.offense_extras_applied=true,
  f=>f.matchup_projection.market_models.total.defense_extras_applied=true,
  f=>f.matchup_projection.market_models.spread.model_version=api.ADJUSTED_TEMPO_NCAAM_POINT_MODEL,
  f=>f.matchup_projection.market_models.total.regulation_total+=5,
  f=>f.matchup_projection.market_models.spread.margin+=1,
  f=>f.matchup_projection.market_models.total.overtime.expected_extra_total_points*=2,
  f=>f.matchup_projection.market_models.total.overtime.parameters.intercept=0,
  f=>f.matchup_projection.market_models.total.overtime.parameters.training_through='2026-11-21',
  f=>{const p=f.matchup_projection;p.margin+=2;p.home_points+=1;p.away_points-=1;f.fair_home_spread=-p.margin;},
  f=>{const p=f.matchup_projection;p.total+=2;p.home_points+=1;p.away_points+=1;f.total=p.total;},
 ];
 for(const change of changes){
  const f=structuredClone(fixture.cases[0].forecast);change(f);
  assert.equal(api.ncaamPointProjection(f),null,change.toString());
  assert.equal(totals.ncaamMatchupGrade(f),null);
  assert.equal(spreads.ncaamSpreadGrade(f),null);
 }
});

test('old version cannot inherit independent model fields and new totals cannot borrow an old grade proof',()=>{
 const archived=require('./fixtures/ncaam-v14-point-edge-forecasts.json').cases[0].forecast;
 assert(api.ncaamPointProjection(archived));
 const old=structuredClone(archived);
 old.matchup_projection.market_models=fixture.cases[0].forecast.matchup_projection.market_models;
 assert.equal(api.ncaamPointProjection(old),null);
 const current=structuredClone(fixture.cases[0].forecast);
 current.matchup_total=archived.matchup_total;
 assert.equal(totals.ncaamMatchupGrade(current),null);
});
