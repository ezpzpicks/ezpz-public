const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const load=require('./load-typescript.cjs'),root=path.resolve(__dirname,'..');
const catalog=load(path.join(root,'lib/footballTrendCatalog.ts'));
const nc=load(path.join(root,'lib/ncaafPublicTrendLeaderboard.ts')),nfl=load(path.join(root,'lib/nflPublicTrendLeaderboard.ts'));
const asArray=x=>JSON.parse(JSON.stringify(x));
function fixture(sport='NFL') {
 const common={date:'2026-10-11',game:'KC @ LV',gameKey:'kc-lv',awayTeam:'KC',homeTeam:'LV',gameTime:'2026-10-11T17:00:00Z',
  snapshotStatus:'FINAL_PREGAME',frozenAt:'2026-10-11T16:45:00Z',updatedAt:'2026-10-11T16:45:00Z',openingSnapshotTime:'2026-10-11T14:00:00Z',odds:'-110',openingOdds:'-110',source:'ScoresAndOdds'};
 return [
  {...common,market:'Spread',selection:'KC',selectionTeam:'KC',side:'',line:-3,openingLine:-1,betsPct:80,moneyPct:95,openingBetsPct:55,openingMoneyPct:65},
  {...common,market:'Spread',selection:'LV',selectionTeam:'LV',side:'',line:3,openingLine:1,betsPct:20,moneyPct:5,openingBetsPct:45,openingMoneyPct:35},
  {...common,market:'Total',selection:'Over',side:'Over',line:45,openingLine:48,betsPct:30,moneyPct:70,openingBetsPct:40,openingMoneyPct:30},
  {...common,market:'Total',selection:'Under',side:'Under',line:45,openingLine:48,betsPct:70,moneyPct:30,openingBetsPct:60,openingMoneyPct:70},
 ];
}
function match(e,id){return e.memberships.find(m=>m.pair===id);}
function rows(plays,won=0){return plays.map((p,i)=>({Date:p.date,Game:p.game,'Game Key':p.gameKey,'Game Time':p.gameTime,'Away Team':p.awayTeam,'Home Team':p.homeTeam,
 Market:p.market,Selection:p.selection,Side:p.side,'Public Split Selection':p.selection,'Public Split Line':String(p.line),'Public Split Odds':p.odds,
 'Public Bets %':String(p.betsPct),'Public Money %':String(p.moneyPct),'Opening Public %':String(p.openingBetsPct),'Opening Sharp %':String(p.openingMoneyPct),
 'Opening Public Split Line':String(p.openingLine),'Opening Public Split Odds':p.openingOdds,'Opening Public Split Snapshot Time':p.openingSnapshotTime,
 'Public Split Snapshot Time':p.frozenAt,'Snapshot Status':'FINAL_PREGAME','Record Snapshot Policy':'verified-final-snapshot-v1',
 'Catalog Context JSON':JSON.stringify(p.catalogContext||{}),'Movement History JSON':JSON.stringify(p.movementHistory||[]),Result:i%2===won?'W':'L','Result Updated':'2026-10-11T21:00:00Z'}));}

test('every catalog direction, subset filter and fixed combination is registered; every split/history/price rule has compiled math',()=>{
 for(const [sport,total] of [['NFL',1058],['NCAAF',1050]]){const c=catalog.footballCatalog(sport);assert.equal(c.rules.length*2,total);assert.equal(c.filters.length,117);assert.equal(c.combinations.length,24);assert.equal(new Set(c.rules.map(r=>r.id)).size,c.rules.length);for(const r of c.rules.filter(r=>['E','H','P','B'].includes(r.data)))assert.ok(r.predicate,r.id);}
});
test('follow and fade attach to exact opposite selections at the same final quote; anchor subsets are shared',()=>{
 const p=fixture(),e=catalog.evaluateFootballCatalogGroup(p,'NFL');
 assert.equal(match(e[3],'total-drop-current-total').direction,0);assert.equal(match(e[2],'total-drop-current-total').direction,1);
 assert.equal(match(e[0],'bd-atleast-80-spread').direction,0);assert.equal(match(e[1],'bd-atleast-80-spread').direction,1);
 assert.deepEqual(asArray(match(e[0],'bd-atleast-80-spread').filters),asArray(match(e[1],'bd-atleast-80-spread').filters));
 assert.ok(match(e[0],'spread-ticket-current-spread'));
 assert.ok(catalog.catalogSignals(e[0],'NFL').length>20);
 assert.ok(catalog.catalogSignals(e[2],'NFL').some(s=>s.includes(':sharp-current-total:0:')));
});
test('bad pairs, missing openers, initial 100% shares and invalid lock times never manufacture signals',()=>{
 for(const change of [{line:44},{frozenAt:'2026-10-11T17:01:00Z'},{betsPct:100}]){const p=fixture();p[2]={...p[2],...change};assert.equal(catalog.evaluateFootballCatalogGroup(p,'NFL')[2].memberships.length,0);}
 const p=fixture();p[0].openingBetsPct=100;p[0].openingLine=undefined;p[0].openingSnapshotTime='';
 const e=catalog.evaluateFootballCatalogGroup(p,'NFL');assert.equal(match(e[0],'spread-ticket-current-spread'),undefined);assert.ok(match(e[0],'bd-atleast-80-spread'));assert.ok(e[0].missing.includes('rlm-current-spread'));
});
test('timed history respects cutoff and staleness tolerance; future quotes cannot affect memberships',()=>{
 const p=fixture();for(const s of p){const sign=s.market==='Total'||s.line<0?1:-1;s.movementHistory=[{snapshotTime:s.openingSnapshotTime,line:s.openingLine,betsPct:s.openingBetsPct,moneyPct:s.openingMoneyPct,odds:'-110'},
 {snapshotTime:'2026-10-11T15:59:00Z',line:s.line+sign*1.5,betsPct:s.betsPct,moneyPct:s.moneyPct,odds:'-110'},
 {snapshotTime:'2026-10-11T17:01:00Z',line:1000,betsPct:100,moneyPct:100,odds:'-110'}];}
 const e=catalog.evaluateFootballCatalogGroup(p,'NFL');assert.ok(match(e[0],'late-line-60-spread'));assert.ok(match(e[3],'late-line-60-total'));
 p[0].movementHistory[1].snapshotTime='2026-10-11T15:49:00Z';const stale=catalog.evaluateFootballCatalogGroup(p,'NFL')[0];assert.equal(match(stale,'late-line-60-spread'),undefined);assert.ok(stale.missing.includes('late-line-60-spread'));
});
test('mismatched opening and history quotes do not supply a movement trigger',()=>{
 const p=fixture();p[1].openingLine=2;
 let e=catalog.evaluateFootballCatalogGroup(p,'NFL');
 assert.equal(match(e[0],'spread-ticket-current-spread'),undefined);
 assert.ok(match(e[0],'bd-atleast-80-spread'));
 const q=fixture();for(const s of q)s.movementHistory=[{snapshotTime:'2026-10-11T15:59:00Z',line:s.market==='Total'?s.line:s.line+(s.line<0?1:-1),betsPct:s.betsPct,moneyPct:s.moneyPct}];
 q[1].movementHistory[0].line=8;
 e=catalog.evaluateFootballCatalogGroup(q,'NFL');
 assert.equal(match(e[0],'late-line-60-spread'),undefined);
 assert.ok(e[0].missing.includes('late-line-60-spread'));
});
test('raw endpoint percentages, hidden losing directions and both mirrors remain in the uncapped graded records',()=>{
 const p=fixture();const full=nfl.buildNflTrendSubtypes([...rows(p),...rows(p)]);assert.ok(full.length>1000);
 const win=full.find(x=>x.signal.includes(':bd-atleast-80-spread:0:')&&x.signal.endsWith(':'));
 const lose=full.find(x=>x.signal.includes(':bd-atleast-80-spread:1:')&&x.signal.endsWith(':'));
 assert.equal(win.totals.record,'1-0-0');assert.equal(lose.totals.record,'0-1-0');
 const visible=nc.rankNcaafPublicTrendSubtypes(full);assert.equal(visible.length,20);assert.ok(!visible.some(x=>x.id===lose.id));
});
test('NFL and NCAAF use only catalog memberships without appending the retired rule set',()=>{
 for(const [sport,api] of [['NFL',nfl],['NCAAF',nc]]){
  const plays=fixture(),evaluations=catalog.evaluateFootballCatalogGroup(plays,sport);
  const signals=sport==='NFL'?api.nflTrendSignals:api.ncaafTrendSignals;
  plays.forEach((play,i)=>assert.deepEqual(asArray(signals(play,plays)),asArray(catalog.catalogSignals(evaluations[i],sport))));
  const subtypes=sport==='NFL'?api.buildNflTrendSubtypes(rows(plays)):api.buildNcaafTrendSubtypes(rows(plays));
  assert.ok(subtypes.length>0);
  assert.ok(subtypes.every(row=>row.signal.startsWith('catalog:')));
 }
});
test('the strict badge gate uses exact W/(W+L), excludes pushes, filters before taking the top 20, and guards stale lists',()=>{
 const plays=fixture(),evaluation=catalog.evaluateFootballCatalogGroup(plays,'NCAAF')[2];
 const signal=catalog.catalogSignals(evaluation,'NCAAF').find(s=>s.endsWith(':sharp-current-total:0:'));
 const row=(id,w,l,p=0)=>({id,signal,category:'Over',label:id,totals:{wins:w,losses:l,pushes:p,winPct:60,totalBets:w+l+p}});
 const list=[row('exactly60',3,2),row('belowButRounded60',2999,2000),row('aboveButRounded60',3001,2000),row('pushOnly',0,0,10),row('good',4,1,100)];
 const ranked=nc.rankNcaafPublicTrendSubtypes(list);assert.deepEqual(Array.from(ranked,x=>x.id),['good','aboveButRounded60']);
 const p={...plays[2],catalogEvaluation:evaluation};assert.equal(nc.visibleNcaafTrendBadges(p,[p],list).length,2);
});
test('context rules wait for actual pre-decision facts rather than inferred weather, injury or model labels',()=>{
 const p=fixture();let e=catalog.evaluateFootballCatalogGroup(p,'NFL');assert.ok(e[2].missing.includes('windy-game-total'));assert.equal(match(e[2],'model-total-edge-3-total'),undefined);
 for(const s of p)s.catalogContext={W:{source:'archived forecast',knownAt:'2026-10-11T16:00:00Z',outdoor:true,windMph:20},I:{source:'archived injury report',knownAt:'2026-10-11T16:00:00Z',teams:{Home:{usualQbDocumented:true,qbStatus:'available'},Away:{usualQbDocumented:true,qbStatus:'out'}}}};
 e=catalog.evaluateFootballCatalogGroup(p,'NFL');assert.ok(match(e[3],'windy-game-total'));assert.ok(match(e[0],'starting-quarterback-out-spread'));
 for(const s of p)s.catalogContext.W.knownAt='2026-10-11T18:00:00Z';assert.equal(match(catalog.evaluateFootballCatalogGroup(p,'NFL')[3],'windy-game-total'),undefined);
});
test('capture persists all definitions and uncapped hidden memberships independently of the 20 badge winners, then settles frozen rows',async()=>{
 const tables={},writes=[];
 const storage={readSportWorksheet:async(_,tab)=>tables[tab]||[],upsertSportRows:async(_,tab,headers,entries,k)=>{writes.push(tab);const m=new Map((tables[tab]||[]).map(r=>[k(r),r]));for(const r of entries)m.set(k(r),r);tables[tab]=[...m.values()];}};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'lib/footballTrendCatalogStore.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Date,Intl,require:name=>name==='./sportSheets'?storage:load(path.join(root,'lib',name+'.ts'))});
 const p=fixture();p.forEach(side=>delete side.source);let result=await exports.captureFootballCatalog('NFL',[],p,true);
 assert.equal(tables.football_catalog_definitions.length,1058);assert.equal(tables.football_catalog_memberships.length,4);assert.ok(result.status.matchedMemberships>20);
 assert.ok(result.plays[0].catalogEvaluation.memberships.every(m=>m.filters.includes('scoresandodds-source')));
 const original=tables.football_catalog_memberships.map(r=>r['Catalog Membership JSON']);
 const settled=rows(p);settled[0]['Public Bets %']='1';await exports.captureFootballCatalog('NFL',settled,[],true);
 assert.deepEqual(tables.football_catalog_memberships.map(r=>r['Catalog Membership JSON']),original);assert.equal(tables.football_catalog_memberships[0].Result,'W');
 assert.equal(tables.football_catalog_memberships[0]['Public Bets %'],'80');
 const count=writes.length;result=await exports.captureFootballCatalog('NFL',[],[],false);assert.equal(writes.length,count);assert.equal(result.rows.length,4);assert.equal(result.status.marketEntries,4);
});
test('saved final memberships avoid chart reevaluation while live quotes are still evaluated',async()=>{
 const tables={};let evaluations=0;
 const storage={readSportWorksheet:async(_,tab)=>tables[tab]||[],upsertSportRows:async(_,tab,headers,entries,k)=>{
  const m=new Map((tables[tab]||[]).map(r=>[k(r),r]));for(const row of entries)m.set(k(row),row);tables[tab]=[...m.values()];}};
 const instrumented={...catalog,evaluateFootballCatalogGroup:(...args)=>{evaluations++;return catalog.evaluateFootballCatalogGroup(...args);}};
 const api={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'lib/footballTrendCatalogStore.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports:api,Date,Intl,require:name=>name==='./sportSheets'?storage:name==='./footballTrendCatalog'?instrumented:load(path.join(root,'lib',name+'.ts'))});
 const plays=fixture();await api.captureFootballCatalog('NFL',[],plays,true);
 const initial=evaluations;assert.ok(initial>0);
 const replay=await api.captureFootballCatalog('NFL',rows(plays),plays,false);
 assert.equal(evaluations,initial);
 assert.equal(replay.rows[0].Result,'W');
 assert.deepEqual(asArray(replay.plays[0].catalogEvaluation),JSON.parse(tables.football_catalog_memberships[0]['Catalog Membership JSON']));
 await api.captureFootballCatalog('NFL',[],plays.map(p=>({...p,snapshotStatus:'LIVE'})),false);
 assert.ok(evaluations>initial);
});
test('scheduled collection records retained final NCAAF memberships when the live feed fails, while read-only failures never write',async()=>{
 const tables={},calls=[],original=new Error('live splits missing');
 const storage={readSportWorksheet:async(_,tab)=>tables[tab]||[],upsertSportRows:async(_,tab,headers,entries)=>{tables[tab]=entries;}};
 const store={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'lib/footballTrendCatalogStore.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:store,Date,Intl,require:name=>name==='./sportSheets'?storage:load(path.join(root,'lib',name+'.ts'))});
 const history={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'lib/footballPublicDataHistory.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:history,Date,Intl,console:{error:()=>{}},require:name=>name==='./footballSos'?{loadFootballSos:async()=>null}:name==='./sportSheets'?storage:name==='./footballTrendCatalogStore'?store:name==='./footballPublicDataLegacy'?{buildFootballPublicData:async(_,options)=>{calls.push(options);if(options.forceFresh===false)return {trendRecordRows:rows(fixture()),trendPlays:[]};throw original;}}:{}});
 await assert.rejects(history.buildFootballPublicData('NCAAF',{persist:true,forceFresh:true}),e=>e===original);
 assert.equal(tables.football_catalog_definitions.length,1050);assert.equal(tables.football_catalog_memberships.length,4);
 assert.deepEqual(asArray(calls),[{persist:true,forceFresh:true},{forceFresh:false,persist:false}]);
 await assert.rejects(history.buildFootballPublicData('NCAAF',{persist:false,forceFresh:true}),e=>e===original);
 assert.equal(calls.length,3);
});
