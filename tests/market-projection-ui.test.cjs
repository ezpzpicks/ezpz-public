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
const Nfl=component('app/FootballGameTabs.tsx','\nexports.testCard=FullSlateCard;').testCard;
function tracking(sport){return {policy:policy.MARKET_PROJECTION_POLICY,sport,profile:'balanced',status:'applied',spread_adjustment:2,total_adjustment:-4};}
function row(sport,tracked=true){return {Date:'2035-11-23','Game ID':'one',Game:'Away @ Home','Game Time':'2035-11-23T20:00:00Z','Away Team':'Away','Home Team':'Home',
 'Projected Away':'17','Projected Home':'29','Projected Margin':'12','Projected Total':'46','Spread Pick':'Home -10','Total Pick':'Under 50','Market Home Spread':'-10','Market Total':'50','Spread Edge':'2','Total Edge':'4',
 ...(tracked?{'Market Tracking JSON':JSON.stringify(tracking(sport)),'Market Tracking Grade Status':'ungraded','Spread Grade':'Ungraded','Total Grade':'Ungraded'}:{'Spread Grade':'Research','Total Grade':'Research'})};}
test('NBA forecast card shows score deltas, both spread directions, total delta and an Ungraded badge',()=>{
 const forecast={gameId:'one',modelVersion:policy.trackingModelVersion('NBA'),lockedAt:'2035-11-23T18:00:00Z',tipoff:'2035-11-23T20:00:00Z',phase:'early',away_team:'Away',home_team:'Home',away_score:97,home_score:109,total:206,fair_home_spread:-12,market:{home_spread:-10,total:210},spread_grade:'Ungraded',total_grade:'Ungraded',grading_status:'awaiting_market_tracking_grades',market_tracking:tracking('NBA')};
 const html=render(React.createElement(Nba,{sport:'NBA',forecast}));
 assert.match(html,/Home strength increased by 2\.0/);assert.match(html,/Away strength decreased by 2\.0/);assert.match(html,/total decreased by 4\.0/);
 assert.match(html,/Home score decreased by 1\.0/);assert.match(html,/Away score decreased by 3\.0/);assert.match(html,/>Ungraded</);
});
for(const sport of ['NFL','NCAAF'])test(`${sport} full slate uses the same compact arrows and suppresses inherited probabilities`,()=>{
 const r=row(sport),html=render(sport==='NFL'?React.createElement(Nfl,{row:r,sport}):React.createElement(Ncaaf,{fullSlate:true,rows:[r],groups:[]}));
 assert.match(html,/Home strength increased by 2\.0/);assert.match(html,/Away strength decreased by 2\.0/);assert.match(html,/total decreased by 4\.0/);
 assert.match(html,/Home score decreased by 1\.0/);assert.match(html,/Away score decreased by 3\.0/);assert.match(html,/Ungraded/);
 const older=row(sport,false),legacy=render(sport==='NFL'?React.createElement(Nfl,{row:older,sport}):React.createElement(Ncaaf,{fullSlate:true,rows:[older],groups:[]}));
 assert.doesNotMatch(legacy,/class="projectionAdjustment"/);
});
