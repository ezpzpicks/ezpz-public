const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('typescript'),React=require('react'),{renderToStaticMarkup:render}=require('react-dom/server');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const policy=require('../lib/marketProjectionPolicy.ts');
const root=path.resolve(__dirname,'..'),empty=()=>null;
function component(file,append=''){
 const api={},overrides={
  'next/dynamic':{default:()=>empty},'./TeamLogoName':{MatchupWithLogos:p=>p.game,SelectionWithTeamLogo:p=>p.selection,TeamLogoName:p=>p.team},
  './NbaEzpzPicks':{default:empty},'./NbaGameLineups':{default:empty,NbaLineupProvider:p=>p.children},'./NcaamModelDetails':{default:empty},
  './NcaamMatchupGrade':{default:empty},'./NcaamSpreadGrade':{default:empty},'./FootballModelFormBadges':{default:empty},'./NcaafModelDetails':{default:empty},
 };
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8')+append,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
  {exports:api,Date,Intl,console,require:n=>overrides[n]||(n.startsWith('.')?(()=>{const p=path.resolve(path.dirname(path.join(root,file)),n);return fs.existsSync(p+'.tsx')?component(path.relative(root,p+'.tsx')):require(p+'.ts');})():require(n))});
 return api;
}
const Nba=component('app/NbaBoard.tsx','\nexports.testCard=ForecastCard;').testCard;
const Ncaaf=component('app/NcaafModelBoard.tsx').default;
const Mlb=component('app/MlbSlateCard.tsx');
function tracking(sport){return {policy:policy.MARKET_PROJECTION_POLICY,sport,profile:'balanced',status:'applied',spread_adjustment:2,total_adjustment:-4};}
function row(sport,tracked=true){return {Date:'2035-11-23','Game ID':'one',Game:'Away @ Home','Game Time':'2035-11-23T20:00:00Z','Away Team':'Away','Home Team':'Home',
 'Spread Probability':'0.95','Total Probability':'0.94','Projected Away':'17','Projected Home':'29','Projected Margin':'12','Projected Total':'46','Spread Pick':'Home -10','Total Pick':'Under 50','Market Home Spread':'-10','Market Total':'50','Spread Edge':'2','Total Edge':'4',
 ...(tracked?{'Market Tracking JSON':JSON.stringify(tracking(sport)),'Market Tracking Grade Status':'ungraded','Spread Grade':'Ungraded','Total Grade':'Ungraded'}:{'Spread Grade':'Research','Total Grade':'Research'})};}
test('NBA forecast card shows score deltas, both spread directions, total delta and an Ungraded badge',()=>{
 const forecast={gameId:'one',modelVersion:policy.trackingModelVersion('NBA'),lockedAt:'2035-11-23T18:00:00Z',tipoff:'2035-11-23T20:00:00Z',phase:'early',away_team:'Away',home_team:'Home',away_score:97,home_score:109,total:206,fair_home_spread:-12,market:{home_spread:-10,total:210},spread_grade:'Ungraded',total_grade:'Ungraded',grading_status:'awaiting_market_tracking_grades',market_tracking:tracking('NBA')};
 const html=render(React.createElement(Nba,{sport:'NBA',forecast}));
 assert.match(html,/Home strength increased by 2\.0/);assert.match(html,/Away strength decreased by 2\.0/);assert.match(html,/total decreased by 4\.0/);
 assert.match(html,/Home score decreased by 1\.0/);assert.match(html,/Away score decreased by 3\.0/);assert.match(html,/>Ungraded</);
});
for(const sport of ['NFL','NCAAF'])test(`${sport} full slate uses the same compact arrows and suppresses inherited probabilities`,()=>{
 const r=row(sport),html=render(React.createElement(Ncaaf,{sport,fullSlate:true,rows:[r],groups:[]}));
 assert.match(html,/Home strength increased by 2\.0/);assert.match(html,/Away strength decreased by 2\.0/);assert.match(html,/total decreased by 4\.0/);
 assert.match(html,/Home score decreased by 1\.0/);assert.match(html,/Away score decreased by 3\.0/);assert.match(html,/Ungraded/);
 assert.doesNotMatch(html,/Model probability|95\.0%|94\.0%/);
 const {document}=require('linkedom').parseHTML(html),board=document.querySelector('.nbaBoard');
 assert.equal(board.children[0].textContent,`${sport} Full Slate`);assert.equal(board.children[1].tagName,'ARTICLE');
 assert.equal(board.querySelectorAll('.nbaMarketCard').length,2);
 const older=row(sport,false),legacy=render(React.createElement(Ncaaf,{sport,fullSlate:true,rows:[older],groups:[]}));
 assert.doesNotMatch(legacy,/class="projectionAdjustment"/);
});

test('MLB uses the same always-visible cards and market panels without inventing team projections',()=>{
 const r={'Game ID':'dh-2','Game Label':'Away at Home','Away Team':'Away','Home Team':'Home','Total Runs Projection':'8.4'};
 const market=React.createElement(Mlb.MlbMarketPanel,{title:'Game Total',grade:'B TOTAL',isGreen:true,metrics:[{label:'Projection',value:'8.4'},{label:'Line',value:'8.5'}]},React.createElement('span',null,'Saved splits'));
 const html=render(React.createElement(Mlb.default,{row:r,time:'7:10 PM',modelBuilt:true,markets:market},React.createElement('div',{className:'pitcherGrid'},'Starter and bulk pitcher information')));
 const {document}=require('linkedom').parseHTML(html);
 assert.equal(document.querySelector('article.nbaCard').getAttribute('data-game-id'),'dh-2');
 assert.equal(document.querySelectorAll('details').length,0);assert.equal(document.querySelectorAll('.nbaMarketCard').length,1);
 assert.equal(document.querySelector('time').textContent,'7:10 PM ET');
 assert.match(html,/8.4/);assert.match(html,/8.5/);assert.match(html,/Saved splits/);assert.match(html,/Starter and bulk pitcher information/);
 assert.doesNotMatch(html,/Projected score/);
 const captured=render(React.createElement(Mlb.default,{row:{...r,'Away Runs Projection':'3.6','Home Runs Projection':'4.8'},time:'',modelBuilt:true,markets:market}));
 assert.match(captured,/Projected score/);assert.match(captured,/>3.6</);assert.match(captured,/>4.8</);
 const scheduled=render(React.createElement(Mlb.default,{row:r,time:'',modelBuilt:false,markets:null}));
 assert.match(scheduled,/No saved model forecast/);assert.match(scheduled,/Time unavailable/);
});

test('NFL Full Slate routes to open forecast cards while Model Plays keeps expanding tiles',()=>{
 const Board=component('app/FootballGameTabs.tsx').default,r=row('NFL');
 const data={today:r.Date,slateToday:[r],bestPlays:[],footballWeeklyMarket:{games:[],splits:[]}};
 const html=render(React.createElement(Board,{sport:'NFL',tab:'Full Slate',data}));
 const {document}=require('linkedom').parseHTML(html);
 assert.equal(document.querySelectorAll('.nbaCard').length,1);
 assert.equal(document.querySelectorAll('.fgtGame').length,0);
 const plays=render(React.createElement(Board,{sport:'NFL',tab:'Today’s Model Plays',data:{...data,bestPlays:[{game:r.Game,gameTime:r['Game Time'],role:'Player Prop',playType:'B Prop',play:'Player Over 50',playerName:'Player',propMarket:'Receiving Yards',propSide:'Over',propLine:50}]}}));
 assert.match(plays,/fgtModelGame/);assert.match(plays,/<details/);
});
