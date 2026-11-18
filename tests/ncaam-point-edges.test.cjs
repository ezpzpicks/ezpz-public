const {test}=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');
const load=require('./load-typescript.cjs');
const api=load(path.join(__dirname,'../lib/ncaamPointEdges.ts'));
const totals=load(path.join(__dirname,'../lib/ncaamMatchupGrades.ts'));
const spreads=load(path.join(__dirname,'../lib/ncaamSpreadGrades.ts'));
const source=require('./fixtures/ncaam-point-edge-forecast.json');
const revised=require('./fixtures/ncaam-v08-point-edge-forecast.json');
const progressive=require('./fixtures/ncaam-v09-point-edge-forecast.json');
const offenseV2=require('./fixtures/ncaam-v10-point-edge-forecast.json');
const cappedRebounds=require('./fixtures/ncaam-v11-point-edge-forecast.json');
const percentageRebounds=require('./fixtures/ncaam-v12-point-edge-forecast.json');
const offenseOnly=require('./fixtures/ncaam-v13-point-edge-forecast.json');
const mirroredDefense=require('./fixtures/ncaam-v14-point-edge-forecasts.json');
const clock=Date.parse(source.lockedAt)+60000;
function fixture({homeLine=source.market.home_spread,totalLine=source.market.total,mode='live',odds=-110}={}) {
 const f=structuredClone(source);f.market={...f.market,home_spread:homeLine,total:totalLine,odds};
 for(const market of ['spread','total']) {
  const g=f[`matchup_${market}`],p=f.matchup_projection,t=g.policy.thresholds;
  t.spread_max_market_line=null;
  const gap=market==='spread'?p.margin+homeLine:p.total-totalLine;
  g.edge=Math.abs(gap);g.edge_grade=g.edge>=t[`${market}_a_points`]?'A':g.edge>=t[`${market}_b_points`]?'B':'Research';
  g.projected_side=gap>0?market==='spread'?'home':'Over':gap<0?market==='spread'?'away':'Under':null;
  g.grade=odds<-110?'Research':g.edge_grade;g.eligible=['A','B'].includes(g.grade);g.side=g.eligible?g.projected_side:null;
  g.record_mode=mode;if(mode==='replay')g.published_at='2026-11-15T01:00:00Z';
  if(market==='spread') {
   const sign=g.projected_side==='home'?1:-1;g.home_line=homeLine;g.line=sign*homeLine;g.projected_margin=sign*p.margin;
   g.selection_team=f[`${g.projected_side||'home'}_team`];g.role=g.line<0?'Favorite':g.line>0?'Underdog':'Pickem';
   f.spread_pick=`${g.selection_team} ${g.line>0?'+':''}${g.line}`;
  } else {g.line=totalLine;f.total_pick=`${g.projected_side||'Over'} ${totalLine}`;}
  f[`${market}_grade`]=g.grade;
 }
 return f;
}

test('Python-generated score proof and both point grades pass the existing readers',()=>{
 assert(api.ncaamPointProjection(source));assert(totals.ncaamMatchupGrade(source));assert(spreads.ncaamSpreadGrade(source));
 assert.equal(source.matchup_spread.policy.thresholds.spread_b_points,5);
 assert.equal(source.matchup_total.policy.thresholds.total_b_points,8);
});

test('revised pace proofs and legacy captures remain readable under their own model versions',()=>{
 assert(api.ncaamPointProjection(revised));assert(totals.ncaamMatchupGrade(revised));assert(spreads.ncaamSpreadGrade(revised));
 assert.equal(api.ncaamPointProjection(source).model_version,api.LEGACY_NCAAM_POINT_MODEL);
 assert.equal(api.ncaamPointProjection(revised).model_version,api.ADJUSTED_TEMPO_NCAAM_POINT_MODEL);
 assert.notEqual(source.modelVersion,revised.modelVersion);
 const bad=structuredClone(revised);bad.matchup_projection.possessions+=1;
 assert.equal(api.ncaamPointProjection(bad),null);
 const badRatio=structuredClone(revised);badRatio.matchup_projection.tempo_model.away_ratio+=.1;
 assert.equal(api.ncaamPointProjection(badRatio),null);
 const wrongVersion=structuredClone(revised);wrongVersion.matchup_total.projection_model_version=source.modelVersion;
 assert.equal(totals.ncaamMatchupGrade(wrongVersion),null);
 const badLegacy=structuredClone(source);badLegacy.matchup_projection.possessions+=1;
 assert.equal(api.ncaamPointProjection(badLegacy),null);
});

test('progressive offense proof adds Michigan eight points and keeps all three model generations readable',()=>{
 for(const f of [source,revised,progressive]) {
  assert(api.ncaamPointProjection(f));assert(totals.ncaamMatchupGrade(f));assert(spreads.ncaamSpreadGrade(f));
 }
 const p=api.ncaamPointProjection(progressive);
 assert.equal(p.model_version,api.INITIAL_OFFENSE_NCAAM_POINT_MODEL);
 assert.equal(p.adjustments.home.offense_bonus.points,8);
 assert.equal(p.adjustments.away.offense_bonus.points,0);
 assert(Math.abs(p.home_points-99.97467996663356)<1e-7);
 assert(Math.abs(p.away_points-70.55830148951375)<1e-7);
 assert(Math.abs(p.total-170.5329814561473)<1e-7);
 assert.equal(api.ncaamPointQuote(progressive,'Total','Over',p.total-10,Date.parse(progressive.lockedAt)+60000).grade,'A');
});

test('missing, inflated and misclassified offense bonuses fail the saved-score proof',()=>{
 const changes=[
  p=>delete p.offense_bonus_policy,
  p=>delete p.adjustments.home.offense_bonus,
  p=>p.offense_bonus_policy.points_by_opponent_defense.below_average=99,
  p=>p.adjustments.home.offense_bonus.points=16,
  p=>p.adjustments.home.offense_bonus.qualified=false,
  p=>p.adjustments.home.offense_bonus.opponent_defense_band='strong',
  p=>p.adjustments.home.offense_bonus.offense_z+=.1,
  p=>p.adjustments.away.offense_bonus.points=8,
 ];
 for(const change of changes){const bad=structuredClone(progressive);change(bad.matchup_projection);assert.equal(api.ncaamPointProjection(bad),null);}
 const doubled=structuredClone(progressive),p=doubled.matchup_projection;
 p.home_points+=8;p.total+=8;p.margin+=8;doubled.total+=8;doubled.fair_home_spread-=8;
 assert.equal(api.ncaamPointProjection(doubled),null);
 const downgraded=structuredClone(progressive);
 downgraded.modelVersion=downgraded.projection_engine=downgraded.matchup_projection.model_version=api.ADJUSTED_TEMPO_NCAAM_POINT_MODEL;
 delete downgraded.matchup_projection.offense_bonus_policy;
 for(const s of ['away','home'])delete downgraded.matchup_projection.adjustments[s].offense_bonus;
 assert.equal(api.ncaamPointProjection(downgraded),null);
});

test('current offense and both rebound generations validate their own saved scoring rules',()=>{
 for(const f of [offenseV2,cappedRebounds,percentageRebounds]) {
  assert(api.isNcaamPointModel(f.modelVersion));
  assert(api.ncaamPointProjection(f),f.modelVersion);
  assert(totals.ncaamMatchupGrade(f),f.modelVersion);
  assert(spreads.ncaamSpreadGrade(f),f.modelVersion);
 }
 assert.equal(api.PERCENTAGE_REBOUND_NCAAM_POINT_MODEL,percentageRebounds.modelVersion);
 assert.equal(offenseV2.matchup_projection.total,cappedRebounds.matchup_projection.total);
 assert.equal(offenseV2.matchup_projection.total,percentageRebounds.matchup_projection.total);
 assert.equal(cappedRebounds.matchup_projection.rebounding_adjustment.home_points,-2);
 assert(Math.abs(percentageRebounds.matchup_projection.rebounding_adjustment.home_points)>13);
 assert.equal(spreads.ncaamSpreadGrade(cappedRebounds).grade,'B');
 assert.equal(spreads.ncaamSpreadGrade(percentageRebounds).grade,'A');
 assert.equal(api.isNcaamPointModel('ncaam-v0.13-unknown'),false);
});

test('rebound proof rejects changed source counts, stale inputs, altered curves and reversed transfers',()=>{
 for(const source of [cappedRebounds,percentageRebounds]) {
  const changes=[
   f=>delete f.matchup_projection.rebounding_adjustment,
   f=>f.away_rating.rebounding.orb++,
   f=>f.away_rating.rebounding.last_game_date=f.away_rating.rebounding.cutoff_date,
   f=>f.away_rating.rebounding.observed_at='2026-01-01T00:00:00Z',
   f=>f.matchup_projection.rebounding_adjustment.inputs.away.orb++,
   f=>f.matchup_projection.adjustments.home.rebounding_points++,
   f=>f.matchup_projection.rebounding_adjustment.home_edge_pp++,
   f=>f.matchup_projection.offense_bonus_policy.points_by_opponent_defense.very_weak=10,
   f=>{
    const p=f.matchup_projection,r=p.rebounding_adjustment;
    for(const side of ['away','home']) {
     p[`${side}_points`]-=2*r[`${side}_points`];
     p.adjustments[side].rebounding_points=r[`${side}_points`]=-r[`${side}_points`];
    }
    p.margin=p.home_points-p.away_points;f.fair_home_spread=-p.margin;
   },
  ];
  if(source===percentageRebounds)changes.push(f=>f.matchup_projection.rebounding_adjustment.boost_fraction_per_edge_pp=.02);
  else changes.push(f=>f.matchup_projection.rebounding_adjustment.max_transfer_points=10);
  for(const change of changes) {
   const bad=structuredClone(source);change(bad);assert.equal(api.ncaamPointProjection(bad),null,change.toString());
  }
 }
});

test('archived offense-only scores preserve offense policy and total grades without applying rebound points',()=>{
 const p=api.ncaamPointProjection(offenseOnly);
 assert(p);assert.equal(p.model_version,api.OFFENSE_ONLY_NCAAM_POINT_MODEL);
 assert(totals.ncaamMatchupGrade(offenseOnly));assert(spreads.ncaamSpreadGrade(offenseOnly));
 assert.equal(p.rebounding_adjustment,undefined);
 assert.equal(p.away_points,offenseV2.matchup_projection.away_points);
 assert.equal(p.home_points,offenseV2.matchup_projection.home_points);
 assert.equal(p.total,percentageRebounds.matchup_projection.total);
 assert.deepEqual(p.offense_bonus_policy,offenseV2.matchup_projection.offense_bonus_policy);
 for(const side of ['away','home'])assert.equal(p.adjustments[side].rebounding_points,undefined);
 for(const field of ['edge','grade','projected_side','projected_total','line'])
  assert.equal(offenseOnly.matchup_total[field],percentageRebounds.matchup_total[field]);
 const mislabeled=structuredClone(percentageRebounds);
 mislabeled.modelVersion=mislabeled.projection_engine=mislabeled.matchup_projection.model_version=api.NCAAM_POINT_MODEL;
 assert.equal(api.ncaamPointProjection(mislabeled),null);
 const added=structuredClone(offenseOnly);added.matchup_projection.adjustments.home.rebounding_points=0;
 assert.equal(api.ncaamPointProjection(added),null);
});

test('mirrored defense reads Python scores and grades with independent deductions on either side',()=>{
 for(const {name,forecast:f,before} of mirroredDefense.cases) {
  const p=api.ncaamPointProjection(f);
  assert(p,name);assert.equal(p.model_version,api.NCAAM_POINT_MODEL);
  assert(totals.ncaamMatchupGrade(f),name);assert(spreads.ncaamSpreadGrade(f),name);
  assert.deepEqual(p.offense_bonus_policy,before.offense_bonus_policy);
  assert.equal(p.possessions,before.possessions);
  let prevented=0;
  for(const side of ['away','home']) {
   const d=p.adjustments[side].opponent_defense_deduction;
   assert(d.points>=0);prevented+=d.points;
   assert.equal(p[`${side}_points`],before[`${side}_points`]-d.points);
   assert.deepEqual(p.adjustments[side].offense_bonus,before.adjustments[side].offense_bonus);
   assert.equal(p.adjustments[side].rebounding_points,undefined);
  }
  assert(Math.abs(p.total-before.total+prevented)<1e-7);
  assert(Math.abs(p.margin-before.margin-p.adjustments.away.opponent_defense_deduction.points
   +p.adjustments.home.opponent_defense_deduction.points)<1e-7);
  assert.equal(p.rebounding_adjustment,undefined);
  if(name==='stacked_maximum') {
   assert.equal(p.adjustments.home.offense_bonus.points,15);
   assert.equal(p.adjustments.away.opponent_defense_deduction.points,15);
   assert(Math.abs(p.margin-before.margin-15)<1e-7);
  } else if(name==='bilateral_elite') {
   assert.equal(prevented,2);assert.equal(p.margin,before.margin);
  } else assert.equal(prevented,0);
 }
});

test('missing, reversed, duplicated and misclassified defense deductions fail score validation',()=>{
 const source=mirroredDefense.cases[0].forecast;
 const changes=[
  p=>delete p.defense_deduction_policy,
  p=>p.defense_deduction_policy.qualifying_defense_z=-1,
  p=>p.defense_deduction_policy.points_by_opponent_offense.very_weak=30,
  p=>delete p.adjustments.away.opponent_defense_deduction,
  p=>p.adjustments.away.opponent_defense_deduction.points=-15,
  p=>p.adjustments.away.opponent_defense_deduction.points=30,
  p=>p.adjustments.away.opponent_defense_deduction.qualified=false,
  p=>p.adjustments.away.opponent_defense_deduction.defense_z+=.1,
  p=>p.adjustments.away.opponent_defense_deduction.opponent_offense_z+=.1,
  p=>p.adjustments.away.opponent_defense_deduction.opponent_offense_band='strong',
  p=>p.adjustments.home.opponent_defense_deduction.points=5,
  p=>p.adjustments.home.rebounding_points=0,
 ];
 for(const change of changes) {
  const bad=structuredClone(source);change(bad.matchup_projection);
  assert.equal(api.ncaamPointProjection(bad),null,change.toString());
 }
 const duplicate=structuredClone(source),p=duplicate.matchup_projection;
 p.away_points-=15;p.total-=15;p.margin+=15;duplicate.total-=15;duplicate.fair_home_spread-=15;
 assert.equal(api.ncaamPointProjection(duplicate),null);
 const historical=structuredClone(source);
 historical.modelVersion=historical.projection_engine=historical.matchup_projection.model_version=api.OFFENSE_ONLY_NCAAM_POINT_MODEL;
 assert.equal(api.ncaamPointProjection(historical),null);
 const contaminated=structuredClone(offenseOnly);
 contaminated.matchup_projection.defense_deduction_policy=source.matchup_projection.defense_deduction_policy;
 assert.equal(api.ncaamPointProjection(contaminated),null);
});

test('separate saved grade rows restore current model plays and keep only the latest forecast',()=>{
 const records=load(path.join(__dirname,'../lib/ncaamRecords.ts'));
 const raw=[cappedRebounds,percentageRebounds].map((f,i)=>{
  const copy=structuredClone(f);copy.lockedAt=f.lockedAt;
  delete copy.matchup_spread;delete copy.matchup_total;
  copy.spread_grade=copy.total_grade='Research';return copy;
 });
 const gradeRows=market=>[cappedRebounds,percentageRebounds].map(f=>({'Details JSON':JSON.stringify(f[`matchup_${market}`])}));
 const attached=spreads.attachNcaamSpreadGrades(totals.attachNcaamMatchupGrades(raw,gradeRows('total')),gradeRows('spread'));
 const plays=records.ncaamModelPlays(attached,[],Date.parse(percentageRebounds.lockedAt)+1000);
 assert.equal(plays.length,1);assert.equal(plays[0].market,'Spread');assert.equal(plays[0].grade,'A');
 assert.equal(plays[0].selection,percentageRebounds.spread_pick);
});

test('spread and total quotes use their own exact boundaries for both sides',()=>{
 const f=fixture(),p=f.matchup_projection;
 for(const market of ['Spread','Total'])for(const edge of [4.999,5,6.999,7,7.999,8,9.999,10,12]) {
  const a=market==='Spread'?7:10,b=market==='Spread'?5:8,expected=edge>=a?'A':edge>=b?'B':'Research';
  for(const side of market==='Spread'?['home','away']:['Over','Under']) {
   const line=market==='Spread'?edge+(side==='home'?-p.margin:p.margin):p.total+(side==='Over'?-edge:edge);
   const q=api.ncaamPointQuote(f,market,side,line,clock);
   assert.equal(q.grade,expected,`${market} ${side} ${edge}`);assert.equal(q.active,expected!=='Research');
  }
 }
});

test('line changes can promote Research, downgrade A, and switch the qualifying side',()=>{
 const f=fixture({homeLine:2-source.matchup_projection.margin}),p=f.matchup_projection;
 assert.equal(f.matchup_spread.grade,'Research');
 assert.equal(api.ncaamPointQuote(f,'Spread','home',7-p.margin,clock).grade,'A');
 assert.equal(api.ncaamPointQuote(f,'Spread','home',5-p.margin,clock).grade,'B');
 assert.equal(api.ncaamPointQuote(f,'Spread','away',7+p.margin,clock).grade,'A');
 assert.equal(api.ncaamPointQuote(f,'Total','Under',p.total+10,clock).grade,'A');
 const trend=load(path.join(__dirname,'../lib/ncaamTrendLeaderboard.ts'));
 const play={awayTeam:f.away_team,homeTeam:f.home_team,market:'Spread',selectionTeam:'Away',line:7+p.margin,odds:'-110',gameTime:f.tipoff};
 const result=trend.ncaamModelFor(play,[f],clock);assert.equal(result.active,true);assert.equal(result.context.grade,'A');
});

test('large spreads qualify by edge while price holds remain in force',()=>{
 const f=fixture();
 assert.equal(api.ncaamPointQuote(f,'Total','Over',f.total-10,clock,'-500').active,false);
 for(const homeLine of [-35.5,-25,-20,20,25,35.5]) {
  const large=fixture({homeLine}),g=spreads.ncaamSpreadGrade(large);
  assert.equal(g.grade,'A');assert.equal(g.eligible,true);
  const quote=api.ncaamPointQuote(large,'Spread',g.projected_side,g.line,clock);
  assert.equal(quote.active,true);assert.equal(quote.grade,'A');
  assert.equal(spreads.ncaamSpreadQuote(g,g.line).grade,'A');
  for(const line of [NaN,Infinity,-Infinity])assert.equal(spreads.ncaamSpreadQuote(g,line).grade,'Research');
  assert.equal(api.ncaamPointQuote(large,'Spread',g.projected_side,g.line,clock,'-500').active,false);
 }
 assert.equal(spreads.ncaamSpreadGrade(progressive).eligible,false,'archived held grades stay readable');
 assert.equal(api.ncaamPointQuote(f,'Spread','away',25,clock).active,true);
 const flags=structuredClone(f);flags.matchup_total.confidence_flags.push('Weather unconfirmed');
 assert.equal(api.ncaamPointQuote(flags,'Total','Over',f.total-10,clock).grade,'A');
});

test('missing proof, legacy grades, clocks and retrospective publication cannot create live signals',()=>{
 const f=fixture();
 assert.equal(api.ncaamPointProjection({...f,projection_engine:'legacy'}),null);
 assert.equal(api.ncaamPointProjection({...f,total:f.total+1}),null);
 assert.equal(api.ncaamPointGrade({...f,matchup_total:{...f.matchup_total,policy_version:'ncaam-matchup-grades-old'}},'Total'),null);
 assert.equal(api.ncaamPointQuote(f,'Total','Over',f.total-10,Date.parse(f.lockedAt)-1).active,false);
 assert.equal(api.ncaamPointQuote(f,'Total','Over',f.total-10,Date.parse(f.tipoff)).active,false);
 assert.equal(api.ncaamPointQuote(fixture({mode:'replay'}),'Total','Over',f.total-10,clock).active,false);
});

test('new records exclude old policies and keep replay outcomes separate',()=>{
 const records=load(path.join(__dirname,'../lib/ncaamRecords.ts')),f=fixture();
 const old={...structuredClone(f),gameId:'legacy',recordId:'legacy',modelVersion:'ncaam-v0.6-team-home-court-2026-11-03'};
 delete old.matchup_total;delete old.matchup_spread;
 const now=Date.parse(f.tipoff)+3600000,schedule=[f,old].map(x=>({'Game ID':x.gameId,'Game Time':x.tipoff,
  'Away Team':x.away_team,'Home Team':x.home_team,'Away Score':'70','Home Score':'80',Completed:'TRUE',Status:'STATUS_FINAL','Result Updated':new Date(now).toISOString()}));
 const state=records.updateNcaamModelRecords(undefined,[f,f,old],schedule,now,['2026-11-14'],true);
 const summary=records.summarizeNcaamModelRecords(state,'2026-11-14');
 assert.equal(summary.overall.totalBets,2);assert.equal(summary.history.length,2);
 assert.equal(summary.policy,records.NCAAM_POINT_MODEL_RECORD_POLICY);
 const replay=fixture({mode:'replay'}),r=records.summarizeNcaamModelRecords(
  records.updateNcaamModelRecords(undefined,[replay],schedule,now,['2026-11-14'],true),'2026-11-14');
 assert.equal(r.overall.totalBets,0);assert.equal(r.replay.overall.totalBets,2);
});

test('play mix counts each eligible market once and preserves an uneven slate',()=>{
 const a=fixture(),b={...fixture({homeLine:-source.matchup_projection.margin,totalLine:source.total+10}),'gameId':'other','recordId':'other'};
 b.matchup_total.forecast_record_id=b.recordId;b.matchup_total.game_id=b.gameId;
 b.matchup_spread.forecast_record_id=b.recordId;b.matchup_spread.game_id=b.gameId;
 const mix=api.ncaamPointPlayMix([a,a,b]);
 assert.deepEqual({total:mix.total,favorites:mix.favorites,underdogs:mix.underdogs,overs:mix.overs,unders:mix.unders},
  {total:3,favorites:0,underdogs:1,overs:1,unders:1});
 assert.equal(api.ncaamPointPlayMix([fixture({mode:'replay'})]).total,0);
 const revised={...fixture(),lockedAt:'2026-11-14T12:05:00Z',tipoff:'2026-11-14T23:30:00Z'};
 assert.equal(api.ncaamPointPlayMix([a,revised]).total,0,'a revised game time cannot retain an older qualifying capture');
});

test('basketball slates go straight from the heading to forecast cards and retain numeric edges',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),React=require('react');
 const {renderToStaticMarkup}=require('react-dom/server');
 function component(file) {
  const exports={};let code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),
   {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  if(file==='app/NbaBoard.tsx')code+='\nexports.testSlate=ModelSlate;';
  vm.runInNewContext(code,{exports,Date,Intl,console,require:name=>name==='next/dynamic'?{default:()=>()=>null}
   :name==='./TeamLogoName'?{MatchupWithLogos:p=>p.game}:name==='./NbaGameLineups'?{default:()=>null}
   :name==='./NbaEzpzPicks'?{default:()=>null}:name.startsWith('./Ncaam')?component(`app/${name.slice(2)}.tsx`)
   :name.startsWith('../lib/')?load(path.join(__dirname,'../app',name+'.ts')):require(name)});
  return exports;
 }
 const f=fixture();
 for(const sport of ['NCAAM','NBA'])for(const tab of ['Full Slate','Today’s Model Plays']) {
  const html=renderToStaticMarkup(React.createElement(component('app/NbaBoard.tsx').testSlate,
   {tab,data:{sport,forecasts:[f],games:[{'Game ID':f.gameId,'Game Time':f.tipoff}],splits:[],stale:true}}));
  const {document}=require('linkedom').parseHTML(html),board=document.querySelector('.nbaBoard');
  assert.equal(board.children[0].querySelector('h2').textContent,`${sport} ${tab==='Full Slate'?'Full Slate':'Model Plays'}`);
  assert.equal(board.children[1].tagName,'ARTICLE');
  assert.equal(board.querySelectorAll(':scope > article').length,1);
  for(const text of ['Play mix','Spread tiers','Point-edge grade','Confidence flags','Matchup strength is already included','Saved forecasts remain visible'])assert(!html.includes(text),text);
  assert(html.includes('<dt>Edge</dt>'));assert(!html.includes('<dt>Point-model lean</dt>'));
  assert(html.includes('Projected score'));assert(html.includes(f.spread_pick));assert(html.includes(f.total_pick));
 }
});
