const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const load = require('./load-typescript.cjs');
const policy = load(path.join(__dirname,'../lib/ncaafEzpzPolicy.ts'));
const { isPublicSplitEzpzPick } = load(path.join(__dirname,'../lib/ezpzPublicSplitEligibility.ts'));
const recordPolicy = load(path.join(__dirname,'../lib/ncaafTrendRecordPolicy.ts'));
const api = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib/footballPublicDataCore.ts'),'utf8')+'\nexport const regression = { buildFootballEzpzPicks };', {
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText, { exports:api,require:name=>name==='./ncaafEzpzPolicy'?policy:{},Date,Intl,console,setTimeout });
const day='2026-10-08';
const total={date:day,game:'FIU @ NMSU',gameKey:'401',market:'Total',side:'Over',selection:'Over',awayTeam:'FIU',homeTeam:'NMSU',openingLine:55.5,line:54,odds:'-110',betsPct:40,moneyPct:42,snapshotStatus:'LIVE'};
const spread={...total,market:'Spread',side:'',selection:'FIU',selectionTeam:'FIU',openingLine:-1.5,line:-2.5,openingBetsPct:40,betsPct:47,publicMovementPct:7,lineMovementValue:1,lineMovementBasis:'Spread Line'};
function select(plays){return policy.selectNcaafEzpzPicks(api.regression.buildFootballEzpzPicks([],plays,[],[],'NCAAF',day).filter(isPublicSplitEzpzPick));}
test('Total Drop Fade reaches the published card through the production builder and eligibility filter',()=>{
 const picks=select([total]);assert.equal(picks.length,1);assert.equal(picks[0].tier,'Total Drop Fade');assert.equal(picks[0].selection,'Over 54');
});
test('a favorite below 15 qualifies at inclusive 1-point / 7-point movement boundaries',()=>{
 const picks=select([spread]);assert.equal(picks.length,1);assert.equal(picks[0].tier,'Spread Ticket Momentum');
 assert.equal(picks[0].openingBetsPct,40);
 for(const p of [{...spread,line:-2.4},{...spread,betsPct:46.9}])assert.equal(select([p]).length,0);
});
test('either small favorites or ticket growth above 20 qualifies without requiring both',()=>{
 const cases=[
  [{...spread,openingLine:-13.5,line:-14.5},true],
  [{...spread,openingLine:-14,line:-15},false],
  [{...spread,openingLine:3.5,line:2.5,betsPct:60},false],
  [{...spread,openingLine:3.5,line:2.5,betsPct:61},true],
  [{...spread,openingLine:-20.5,line:-21.5,betsPct:61},true],
  [{...spread,openingLine:-14,line:-15,betsPct:60},false],
  [{...spread,openingLine:-14,line:-15,betsPct:61},true],
  [{...spread,openingLine:1,line:0,betsPct:60},false],
  [{...spread,openingLine:1,line:0,betsPct:61},true],
  [{...spread,openingLine:3.5,line:2.5,betsPct:47,publicMovementPct:99},false],
 ];
 for(const [play,expected] of cases)assert.equal(select([play]).length,Number(expected),JSON.stringify(play));
 assert.equal(select([{...spread,openingLine:3,line:2.5,betsPct:61}]).length,0);
 assert.equal(select([{...spread,openingBetsPct:100,betsPct:130}]).length,0);
});
test('old spread labels cannot bypass the either-or subset guard',()=>{
 const old={source:'Trend Play',market:'Spread',date:day,game:spread.game,selection:'FIU -15',odds:'-110',tier:'Spread Ticket Momentum',publicMovePct:50,lineMoveValue:2};
 assert.equal(policy.selectNcaafEzpzPicks([old]).length,0);
 assert.equal(policy.selectNcaafEzpzPicks([{...old,selection:'FIU +2.5',openingBetsPct:40,betsPct:60}]).length,0);
 assert.equal(policy.selectNcaafEzpzPicks([{...old,selection:'FIU +2.5',openingBetsPct:40,betsPct:61}]).length,1);
 assert.equal(policy.selectNcaafEzpzPicks([{...old,selection:'FIU -14.5'}]).length,1);
});
test('one pick per game prioritizes Total Drop Fade and falls back when its price is worse than -150',()=>{
 assert.equal(select([spread,total]).length,1);assert.equal(select([spread,total])[0].tier,'Total Drop Fade');
 assert.equal(select([spread,{...total,odds:'-151'}])[0].tier,'Spread Ticket Momentum');
 assert.equal(select([{...total,odds:'-150'}]).length,1);assert.equal(select([{...total,odds:''}])[0].odds,'-110');
});
test('missing spread and total prices default to -110 without changing a supplied price',()=>{
 for(const play of [total,spread]){
  for(const odds of ['', '  ', null, undefined]){
   const picks=select([{...play,odds}]);assert.equal(picks.length,1);assert.equal(picks[0].odds,'-110');
  }
  assert.equal(select([{...play,odds:'-125'}])[0].odds,'-125');
  assert.equal(select([{...play,odds:'-151'}]).length,0);
 }
 const frozen={...select([total])[0],odds:'',snapshotStatus:'FINAL_PREGAME'};
 assert.equal(policy.selectNcaafEzpzPicks([frozen],true)[0].odds,'-110');
 assert.equal(policy.selectNcaafEzpzPicks([{...frozen,snapshotStatus:'LIVE'}],true).length,0);
 assert.equal(policy.selectNcaafEzpzPicks([{...frozen,market:'Moneyline'}],true).length,0);
});
test('nonqualifying totals, old signals, missing movement inputs and opening placeholders stay out',()=>{
 for(const p of [{...total,side:'Under'},{...total,line:54.1},{...total,openingLine:null},{...spread,openingBetsPct:100},{...spread,openingBetsPct:''},{...spread,openingLine:undefined},{...total,openingLine:54,betsPct:10,moneyPct:34}])assert.equal(select([p]).length,0);
 const legacy={source:'Trend Play',market:'Total',game:total.game,date:day,odds:'-110',tier:'Sharp'};assert.equal(policy.selectNcaafEzpzPicks([legacy]).length,0);
 for(const tier of ['RLM','Public Fade','Money Momentum','Market Move'])assert.equal(policy.selectNcaafEzpzPicks([{...legacy,tier}]).length,0);
 assert.equal(policy.selectNcaafEzpzPicks([{...legacy,source:'Best Play',tier:'Total Drop Fade'}]).length,0);
});

test('Sharp Over and Under qualify at a 25-point gap without requiring opening-line movement',()=>{
 for(const side of ['Over','Under']){
  const picks=select([{...total,side,openingLine:null,betsPct:19,moneyPct:44}]);
  assert.equal(picks.length,1);assert.equal(picks[0].tier,'Sharp');
  assert.equal(picks[0].selection,`${side} 54`);assert.equal(picks[0].gapPct,25);
 }
 for(const overrides of [
  {moneyPct:43.9},{moneyPct:null},{moneyPct:''},{moneyPct:101},{betsPct:null},{betsPct:''},
  {betsPct:-1},{line:null},{line:0},{side:'',selection:''},
  {market:'Spread',selection:'FIU',openingLine:null},
 ])assert.equal(select([{...total,openingLine:null,betsPct:19,moneyPct:44,...overrides}]).length,0,JSON.stringify(overrides));
});

test('Sharp totals are third priority regardless of their score, with the existing price cap',()=>{
 const sharp=select([{...total,side:'Under',betsPct:19,moneyPct:44}])[0];
 assert.equal(sharp.tier,'Sharp');
 const momentum=select([spread])[0];const drop=select([total])[0];
 const ranked=(picks)=>policy.selectNcaafEzpzPicks(picks.map(p=>({...p,score:p.tier==='Sharp'?100:0})));
 assert.equal(ranked([sharp,momentum,drop])[0].tier,'Total Drop Fade');
 assert.equal(ranked([sharp,momentum])[0].tier,'Spread Ticket Momentum');
 assert.equal(ranked([sharp,{...momentum,odds:'-151'}])[0].tier,'Sharp');
 assert.equal(ranked([{...sharp,odds:'-150'}]).length,1);
 assert.equal(ranked([{...sharp,odds:'-151'}]).length,0);
 assert.equal(ranked([{...sharp,odds:''}])[0].odds,'-110');
 assert.equal(ranked([{...sharp,source:'Best Play'}]).length,0);
 assert.equal(policy.selectNcaafEzpzPicks([sharp],true).length,0);
 assert.equal(policy.selectNcaafEzpzPicks([{...sharp,snapshotStatus:'FINAL_PREGAME'}],true).length,1);
 const locked=select([{...total,side:'Under',betsPct:19,moneyPct:44,snapshotStatus:'FINAL_PREGAME',
  frozenAt:'2026-10-08T19:15:00Z',updatedAt:'2026-10-08T19:20:00Z'}])[0];
 assert.equal(locked.lockedAt,'2026-10-08T19:15:00Z');
 assert.equal(select([{...total,betsPct:19,moneyPct:44}])[0].tier,'Total Drop Fade');
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

test('historical ticket growth uses the matching final spread decision and selected side',()=>{
 const historyApi={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib/footballPublicDataHistory.ts'),'utf8')+'\nexports.evidence=ncaafSpreadHistoryEvidence;',{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
 }).outputText,{exports:historyApi,require:name=>name==='./ncaafEzpzPolicy'?policy:{},Date,console});
 const stamp='2026-10-08T19:15:00Z';
 const old={source:'Trend Play',market:'Spread',date:day,game:spread.game,selection:'FIU +2.5',odds:'-110',tier:'Spread Ticket Momentum',betsPct:61,lockedAt:stamp};
 const row={Date:day,Game:spread.game,Market:'Spread',Selection:'FIU','Public Split Line':'2.5','Opening Public %':'40','Public Bets %':'61','Snapshot Status':'FINAL_PREGAME','Public Split Snapshot Time':stamp};
 assert.equal(policy.selectNcaafEzpzPicks([historyApi.evidence(old,[row])]).length,1);
 const frozenRow={...row,'Snapshot Status':'','Trend Score Details':JSON.stringify({snapshotStatus:'FINAL_PREGAME',frozenAt:stamp})};
 assert.equal(policy.selectNcaafEzpzPicks([historyApi.evidence(old,[frozenRow])]).length,1);
 for(const wrong of [{...row,'Snapshot Status':'LIVE'},{...row,'Public Split Line':'3.5'},{...row,'Public Split Snapshot Time':'2026-10-08T19:20:00Z'},{...row,Selection:'NMSU'},{...row,Date:'2026-10-07'}])assert.equal(policy.selectNcaafEzpzPicks([historyApi.evidence(old,[wrong])]).length,0);
});

test('Sharp published history needs the same verified final decision and cannot borrow another side or capture',()=>{
 const historyApi={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib/footballPublicDataHistory.ts'),'utf8')+'\nexports.evidence=ncaafSharpHistoryEvidence;',{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
 }).outputText,{exports:historyApi,require:name=>name==='./ncaafEzpzPolicy'?policy:name==='./ncaafTrendRecordPolicy'?recordPolicy:{},Date,console});
 const stamp='2026-10-08T19:15:00Z';
 const pick={source:'Trend Play',market:'Total',date:day,game:total.game,selection:'Under 54',odds:'-110',tier:'Sharp',
  betsPct:0,moneyPct:100,lockedAt:stamp,snapshotStatus:'FINAL_PREGAME'};
 const row={Date:day,Game:total.game,Market:'Total',Selection:'Under','Public Split Line':'54',
  'Public Bets %':'19','Public Money %':'44','Snapshot Status':'FINAL_PREGAME',
  'Public Split Snapshot Time':stamp,'Record Snapshot Policy':recordPolicy.NCAAF_TREND_RECORD_POLICY};
 const accepted=historyApi.evidence(pick,[row]);
 assert.equal(accepted.betsPct,19);assert.equal(accepted.moneyPct,44);
 assert.equal(policy.selectNcaafEzpzPicks([accepted],true).length,1);
 for(const wrong of [
  {...row,'Record Snapshot Policy':''},{...row,'Snapshot Status':'LIVE'},
  {...row,'Public Split Line':'54.5'},{...row,'Public Split Snapshot Time':'2026-10-08T19:20:00Z'},
  {...row,Selection:'Over'},{...row,Date:'2026-10-07'},{...row,'Public Money %':'43'},
 ])assert.equal(policy.selectNcaafEzpzPicks([historyApi.evidence(pick,[wrong])],true).length,0,JSON.stringify(wrong));
 assert.equal(policy.selectNcaafEzpzPicks([historyApi.evidence({...pick,lockedAt:''},[row])],true).length,0);
});
