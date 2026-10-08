const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const load = require('./load-typescript.cjs');
const policy = load(path.join(__dirname,'../lib/ncaafEzpzPolicy.ts'));
const { isPublicSplitEzpzPick } = load(path.join(__dirname,'../lib/ezpzPublicSplitEligibility.ts'));
const api = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib/footballPublicDataCore.ts'),'utf8')+'\nexport const regression = { buildFootballEzpzPicks };', {
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText, { exports:api,require:name=>name==='./ncaafEzpzPolicy'?policy:{},Date,Intl,console,setTimeout });
const day='2026-10-08';
const total={date:day,game:'FIU @ NMSU',gameKey:'401',market:'Total',side:'Over',selection:'Over',awayTeam:'FIU',homeTeam:'NMSU',openingLine:55.5,line:54,odds:'-110',betsPct:40,moneyPct:42,snapshotStatus:'LIVE'};
const spread={...total,market:'Spread',side:'',selection:'FIU',selectionTeam:'FIU',openingLine:3.5,line:2.5,openingBetsPct:40,betsPct:47,publicMovementPct:7,lineMovementValue:1,lineMovementBasis:'Spread Line'};
function select(plays){return policy.selectNcaafEzpzPicks(api.regression.buildFootballEzpzPicks([],plays,[],[],'NCAAF',day).filter(isPublicSplitEzpzPick));}
test('Total Drop Fade reaches the published card through the production builder and eligibility filter',()=>{
 const picks=select([total]);assert.equal(picks.length,1);assert.equal(picks[0].tier,'Total Drop Fade');assert.equal(picks[0].selection,'Over 54');
});
test('Spread Ticket Momentum qualifies at inclusive 1-point / 7-point boundaries',()=>{
 const picks=select([spread]);assert.equal(picks.length,1);assert.equal(picks[0].tier,'Spread Ticket Momentum');
 for(const p of [{...spread,line:2.6},{...spread,betsPct:46.9}])assert.equal(select([p]).length,0);
});
test('one pick per game prioritizes Total Drop Fade and falls back when its price is worse than -150',()=>{
 assert.equal(select([spread,total]).length,1);assert.equal(select([spread,total])[0].tier,'Total Drop Fade');
 assert.equal(select([spread,{...total,odds:'-151'}])[0].tier,'Spread Ticket Momentum');
 assert.equal(select([{...total,odds:'-150'}]).length,1);assert.equal(select([{...total,odds:''}]).length,0);
});
test('Under, old signals, missing inputs and 100-percent opening placeholders cannot qualify',()=>{
 for(const p of [{...total,side:'Under'},{...total,line:54.1},{...total,openingLine:null},{...spread,openingBetsPct:100},{...spread,openingBetsPct:''},{...spread,openingLine:undefined},{...total,openingLine:54,betsPct:10,moneyPct:60}])assert.equal(select([p]).length,0);
 const legacy={source:'Trend Play',market:'Total',game:total.game,date:day,odds:'-110',tier:'Sharp'};assert.equal(policy.selectNcaafEzpzPicks([legacy]).length,0);
});
test('LIVE candidates stay out of official records; final candidates remain eligible',()=>{
 const live=select([total])[0];assert.equal(policy.selectNcaafEzpzPicks([live],true).length,0);
 assert.equal(policy.selectNcaafEzpzPicks([{...live,snapshotStatus:'FINAL_PREGAME'}],true).length,1);
});

test("the NCAAF API keeps today's public-split pick without a saved model slate", async()=>{
 const result={};
 const fixture={today:day,slateToday:[],bestPlays:[],aiPicks:[{...select([total])[0],date:day},{...select([total])[0],date:'2026-10-09'}]};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../app/api/ncaaf-public-data/route.ts'),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
 }).outputText,{exports:result,require:name=>name==='next/server'?require(name):name.endsWith('footballPublicData')?{buildFootballPublicData:async()=>fixture}:{},Date,console});
 const response=await result.GET({nextUrl:{searchParams:new URLSearchParams()}});
 const body=await response.json();assert.equal(body.aiPicks.length,1);assert.equal(body.aiPicks[0].tier,'Total Drop Fade');
});
