const {test}=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');
const load=require('./load-typescript.cjs');
const api=load(path.join(__dirname,'../lib/ncaafMatchupFactors.ts'));
const prices=load(path.join(__dirname,'../lib/modelSignalQuote.ts'));
const {fixture,clock}=require('./fixtures/ncaaf-edge-grade.cjs');

test('point grades update at exact boundaries for every market side',()=>{
 const {row}=fixture(api,{margin:4,total:60});
 for(const edge of [3,6,7.999,8,9.999,10,12]){
  const expected=edge>=10?'A':edge>=8?'B':'No Play';
  for(const [market,side,line] of [['Spread','home',edge-4],['Spread','away',edge+4],
    ['Total','Over',60-edge],['Total','Under',60+edge]]){
   const g=api.ncaafMatchupQuoteReview(row,market,line,side,clock);
   assert.equal(g.grade,expected==='No Play'?expected:`${expected} ${market}`);
   assert.equal(g.valid,edge>=8);assert(Math.abs(g.edge-edge)<1e-8);
  }
 }
});
test('previous Research can qualify at a new number and the original side can flip',()=>{
 const {row}=fixture(api,{margin:4,homeLine:-2});
 assert.equal(JSON.parse(row['Matchup Spread JSON']).grade,'Research');
 assert.equal(api.ncaafMatchupQuoteReview(row,'Spread',6,'home',clock).grade,'A Spread');
 assert.equal(api.ncaafMatchupQuoteReview(row,'Spread',14,'away',clock).grade,'A Spread');
 assert.equal(api.ncaafMatchupQuoteReview(row,'Spread',-12,'home',clock).valid,false);
});
test('large spreads and clock/source failures remain ineligible independently of edge grade',()=>{
 const {row,p}=fixture(api,{margin:32});
 const g=api.ncaafMatchupQuoteReview(row,'Spread',-21,'home',clock);
 assert.equal(g.edgeGrade,'A');assert.equal(g.valid,false);
 assert.equal(api.ncaafMatchupQuoteReview(row,'Spread',-4,'other',clock).valid,false);
 assert.equal(api.ncaafMatchupQuoteReview(row,'Spread',-4,'home',Date.parse(p.data_as_of)-1).valid,false);
 assert.equal(api.ncaafMatchupQuoteReview(row,'Spread',-4,'home',Date.parse(p.kickoff)).valid,false);
 assert.equal(api.ncaafMatchupQuoteReview({...row,'Projection Engine':'legacy_fallback'},'Spread',-4,'home',clock).valid,false);
});
test('grade repricing keeps actual odds checks while upgrading/downgrading the numerical tier',()=>{
 const {row}=fixture(api);
 const q={sport:'NCAAF',market:'Spread',side:'home',version:api.NCAAF_PROJECTION_MODEL,policy:api.NCAAF_MATCHUP_POLICY,
  savedLine:-4,line:-6,savedEdge:10,savedGrade:'A Spread',probability:.75,residualSd:18,odds:'-110'};
 function quote(line,odds='-110'){return prices.regradeModelQuote({...q,line,odds,
  matchupValidation:api.ncaafMatchupQuoteReview(row,'Spread',line,'home',clock)});}
 assert.equal(quote(-6).grade,'B Spread');assert.equal(quote(-6).active,true);
 assert.equal(quote(-8).grade,'No Play');assert.equal(quote(-8).active,false);
 assert.equal(quote(-6,'-500').grade,'B Spread');assert.equal(quote(-6,'-500').active,false);
 assert.equal(prices.regradeModelQuote({...q,matchupValidation:undefined}).active,false);
 assert.equal(prices.regradeModelQuote({...q,version:'old',matchupValidation:{valid:true,grade:'A Spread',edge:10}}).active,false);
});
test('Research promotions do not require an old A/B pick or invent a price probability',()=>{
 const {row}=fixture(api,{homeLine:-12});
 const validation=api.ncaafMatchupQuoteReview(row,'Spread',-4,'home',clock);
 const q={sport:'NCAAF',market:'Spread',side:'home',version:api.NCAAF_PROJECTION_MODEL,policy:api.NCAAF_MATCHUP_POLICY,
  savedLine:-12,line:-4,savedEdge:2,savedGrade:'No Play',probability:.55,residualSd:18,odds:'-110',matchupValidation:validation};
 assert.equal(prices.regradeModelQuote(q).grade,'A Spread');assert.equal(prices.regradeModelQuote(q).active,true);
 assert.equal(prices.regradeModelQuote({...q,probability:null,residualSd:null}).active,false);
});
test('confidence flags do not change the numerical point grade; old v4 records stay separate',()=>{
 const {row,spread}=fixture(api);
 row['Matchup Spread JSON']=JSON.stringify({...spread,confidence_flags:['Weather unconfirmed','Personnel incomplete']});
 const g=api.ncaafMatchupQuoteReview(row,'Spread',-4,'home',clock);
 assert.equal(g.grade,'A Spread');assert(g.confidenceFlags.includes('Weather unconfirmed'));
 const record={Date:'2026-11-14','Game ID':'1','Bet Type':'Spread',Grade:'A Spread',Result:'Win','Odds/Line':'-110'};
 assert.equal(api.ncaafMatchupRecordSummary([{...record,'Grading Policy Version':'ncaaf-sp-projection-2026-11-14-v4'}],record.Date).overall.totalBets,0);
 assert.equal(api.ncaafMatchupRecordSummary([{...record,'Grading Policy Version':'ncaaf-sp-edge-2026-11-14-v5'}],record.Date).overall.totalBets,0);
 assert.equal(api.ncaafMatchupRecordSummary([{...record,'Grading Policy Version':api.NCAAF_MATCHUP_POLICY}],record.Date).overall.totalBets,1);
});
test('football signals can requalify and flip a side from a saved Research forecast',()=>{
 const signals=load(path.join(__dirname,'../lib/footballSignals.ts'));
 const {row,p}=fixture(api,{margin:4,homeLine:-2,totalLine:62});
 function board(homeLine){
  const base={date:row.Date,game:row.Game,gameTime:p.kickoff,awayTeam:'Away',homeTeam:'Home',market:'Spread',odds:'-110',
   snapshotStatus:'LIVE',updatedAt:new Date(clock).toISOString(),betsPct:50,moneyPct:50,openingBetsPct:50,openingMoneyPct:50,movementHistory:[]};
  return signals.buildFootballSignalsState({sport:'NCAAF',now:clock,capture:false,storedRows:[],history:new Map(),leaderboard:[],
   core:{today:row.Date,slateToday:[row],trendRecordRows:[],bestPlays:[],trendPlays:[
    {...base,selection:'Home',selectionTeam:'Home',side:'Home',line:homeLine,openingLine:homeLine},
    {...base,selection:'Away',selectionTeam:'Away',side:'Away',line:-homeLine,openingLine:-homeLine}]}}).board;
 }
 let sides=board(6).sides;let home=sides.find(s=>s.side==='home');
 assert.equal(home.modelContext.grade,'A Spread');assert.equal(home.signals.find(s=>s.key==='model').active,true);
 sides=board(-14).sides;const away=sides.find(s=>s.side==='away');
 assert.equal(away.modelContext.grade,'A Spread');assert.equal(away.signals.find(s=>s.key==='model').active,true);
 assert.equal(sides.find(s=>s.side==='home').signals.find(s=>s.key==='model').active,false);
 row['Build Phase']='early';
 assert.equal(board(6).sides.find(s=>s.side==='home').signals.find(s=>s.key==='model').active,false);
 delete row['Build Phase'];row['Build Captured At']=new Date(clock+60000).toISOString();
 assert.equal(board(6).sides.find(s=>s.side==='home').signals.find(s=>s.key==='model').active,false);
});
test('NCAAF Full Slate keeps numerical grades and eligibility with cards directly below the heading',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),React=require('react');
 const {renderToStaticMarkup:render}=require('react-dom/server');
 function component(file){
  const exports={};const source=ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),
   {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(source,{exports,Date,Intl,console,require:name=>name==='./TeamLogoName'
   ?{MatchupWithLogos:p=>p.game,SelectionWithTeamLogo:p=>p.selection}
   :name==='./FootballModelFormBadges'?{default:()=>null}:name==='./NcaafModelDetails'?component('app/NcaafModelDetails.tsx')
   :name.startsWith('../lib/')?load(path.join(__dirname,'../app',name+'.ts')):require(name)});
  return exports;
 }
 const {row,spread}=fixture(api,{margin:32,homeLine:-21});
 row['Spread Grade']='No Play';row['Matchup Spread JSON']=JSON.stringify({...spread,grade:'Research',eligible:false,
  confidence_flags:['Provisional model','20+ point market spread; projection-only','Weather unconfirmed']});
 const html=render(React.createElement(component('app/NcaafModelBoard.tsx').default,{fullSlate:true,rows:[row],groups:[],tracker:[]}));
 const section=html.split('aria-label="Spread forecast"')[1].split('aria-label="Total forecast"')[0];
 assert(section.includes('Grade A'));assert(section.includes('Projection only'));
 const {document}=require('linkedom').parseHTML(html),board=document.querySelector('.ncaafModelBoard');
 assert.equal(board.children[0].querySelector('h2').textContent,'NCAAF Full Slate');
 assert.equal(board.children[1].tagName,'ARTICLE');
 assert(html.includes('Adjusted offense'));assert(html.includes('Adjusted defense'));assert(html.includes('Tempo'));
 for(const text of ['Point-edge grade','Matchup strength is already included','NCAAF play mix','Full Saturday target','Input confidence flags'])assert(!html.includes(text),text);
});

test('archived v5 quotes retain their earlier cutoffs without joining the v6 record',()=>{
 const {row}=fixture(api,{margin:10,total:60,policy:'ncaaf-sp-edge-2026-11-14-v5',a:6,b:3});
 assert(api.ncaafMatchupContext(row));
 assert.equal(api.ncaafMatchupQuoteReview(row,'Spread',-4,'home',clock).grade,'A Spread');
 assert.equal(api.ncaafMatchupQuoteReview(row,'Spread',-6,'home',clock).grade,'B Spread');
 assert.equal(api.ncaafModelPlayMix([row],row.Date).capturedGames,0);
});
