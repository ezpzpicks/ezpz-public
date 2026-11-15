const {test}=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');
const load=require('./load-typescript.cjs');
const api=load(path.join(__dirname,'../lib/ncaamPointEdges.ts'));
const totals=load(path.join(__dirname,'../lib/ncaamMatchupGrades.ts'));
const spreads=load(path.join(__dirname,'../lib/ncaamSpreadGrades.ts'));
const source=require('./fixtures/ncaam-point-edge-forecast.json');
const revised=require('./fixtures/ncaam-v08-point-edge-forecast.json');
const clock=Date.parse(source.lockedAt)+60000;
function fixture({homeLine=source.market.home_spread,totalLine=source.market.total,mode='live',odds=-110}={}) {
 const f=structuredClone(source);f.market={...f.market,home_spread:homeLine,total:totalLine,odds};
 for(const market of ['spread','total']) {
  const g=f[`matchup_${market}`],p=f.matchup_projection,t=g.policy.thresholds;
  const gap=market==='spread'?p.margin+homeLine:p.total-totalLine;
  g.edge=Math.abs(gap);g.edge_grade=g.edge>=t[`${market}_a_points`]?'A':g.edge>=t[`${market}_b_points`]?'B':'Research';
  g.projected_side=gap>0?market==='spread'?'home':'Over':gap<0?market==='spread'?'away':'Under':null;
  const large=market==='spread'&&Math.abs(homeLine)>=20;
  g.grade=large||odds<-110?'Research':g.edge_grade;g.eligible=['A','B'].includes(g.grade);g.side=g.eligible?g.projected_side:null;
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
 assert.equal(api.ncaamPointProjection(revised).model_version,api.NCAAM_POINT_MODEL);
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

test('price and large-line holds preserve numerical grades without manufacturing probabilities',()=>{
 const f=fixture();
 assert.equal(api.ncaamPointQuote(f,'Total','Over',f.total-10,clock,'-500').active,false);
 const large=fixture({homeLine:-25});assert.equal(large.matchup_spread.edge_grade,'A');
 assert.equal(spreads.ncaamSpreadGrade(large).eligible,false);
 assert.equal(api.ncaamPointQuote(f,'Spread','away',25,clock).active,false);
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
 const a=fixture(),b={...fixture({homeLine:-25,totalLine:source.total+10}),'gameId':'other','recordId':'other'};
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
