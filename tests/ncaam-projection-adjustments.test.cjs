const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('typescript'),React=require('react'),{renderToStaticMarkup:render}=require('react-dom/server');
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},
}).outputText,file);
const {ncaamProjectionAdjustments:adjustments}=require('../lib/ncaamProjectionAdjustments.ts');
const {NCAAM_MARKET_TRACKING_MODEL:modelVersion}=require('../lib/ncaamMarketTrackingPolicy.ts');
const {ncaamModelFor}=require('../lib/ncaamTrendLeaderboard.ts');
const forecast=(spread=2,total=-4)=>({gameId:'one',modelVersion,lockedAt:'2026-11-23T13:30:00Z',tipoff:'2026-11-23T16:00:00Z',
 phase:'pregame',away_team:'Away',home_team:'Home',away_score:67,home_score:79,total:146,fair_home_spread:-12,
 spread_grade:'Ungraded',total_grade:'Ungraded',spread_pick:'Home -10',total_pick:'Under 150',home_spread_edge:2,total_edge:-4,
 market:{home_spread:-10,total:150,source:'ScoresAndOdds',as_of:'2026-11-23T14:30:00Z'},
 market_tracking:{status:'applied',spread_adjustment:spread,total_adjustment:total}});

function loadUi(file) {
 const api={},empty=()=>null;
 const imports={'next/dynamic':()=>empty,'./TeamLogoName':{MatchupWithLogos:p=>p.game},
  './NbaEzpzPicks':{__esModule:true,default:empty},'./NbaGameLineups':{__esModule:true,default:empty,NbaLineupProvider:p=>p.children},
  './NcaamModelDetails':{__esModule:true,default:empty},'./NcaamMatchupGrade':{__esModule:true,default:empty},'./NcaamSpreadGrade':{__esModule:true,default:empty}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,
  target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,{exports:api,Date,Intl,console,
  require:name=>imports[name] || (name.startsWith('.') ? (()=>{const target=path.resolve(path.dirname(file),name);
   return fs.existsSync(target+'.tsx')?loadUi(target+'.tsx'):require(target+'.ts');})() : require(name))});
 return api;
}
const Arrow=loadUi(path.resolve(__dirname,'../app/ProjectionAdjustment.tsx')).default;
const Board=loadUi(path.resolve(__dirname,'../app/NbaBoard.tsx')).default;
const slate=(f,sport='NCAAM')=>render(React.createElement(Board,{tab:'Full Slate',data:{sport,date:'2026-11-23',availableDates:[],
 games:[{'Game ID':'one','Game Time':f.tipoff,'Away Team':'Away','Home Team':'Home',Status:'STATUS_SCHEDULED'}],forecasts:[f],splits:[]}}));

test('spread arrows mirror team strength while score arrows account for the total change',()=>{
 const a=adjustments(forecast());
 assert.deepEqual(a,{homeSpread:2,awaySpread:-2,total:-4,homeScore:-1,awayScore:-3});
 assert.equal(a.homeScore+a.awayScore,a.total);
 assert.equal(a.homeScore-a.awayScore,a.homeSpread);
 const reversed=adjustments(forecast(-4,6));
 assert.equal(reversed.homeSpread,-4);assert.equal(reversed.awaySpread,4);
 assert.equal(reversed.homeScore,1);assert.equal(reversed.awayScore,5);
});
test('legacy, waiting and invalid tracking inputs do not acquire adjustment arrows',()=>{
 for(const f of [undefined,{}, {...forecast(),modelVersion:'ncaam-v0.16'},
  {...forecast(),market_tracking:{status:'waiting_for_history',spread_adjustment:2,total_adjustment:4}},
  forecast(NaN,2),forecast(2,Infinity),forecast(null,2)])assert.equal(adjustments(f),null);
});
test('compact arrows render direction, points and an accessible baseline explanation',()=>{
 const up=render(React.createElement(Arrow,{points:2,label:'Home strength'}));
 assert.match(up,/data-direction="up"/);assert.match(up,/↑ 2\.0 pts/);
 assert.match(up,/Home strength increased by 2\.0 points from baseline/);
 const down=render(React.createElement(Arrow,{points:-1.25}));
 assert.match(down,/data-direction="down"/);assert.match(down,/↓ 1\.3 pts/);
 for(const points of [undefined,null,NaN,Infinity,0,-0,0.049,-0.049])assert.equal(render(React.createElement(Arrow,{points})), '');
});
test('full slate shows the edge side spread, total decrease and true team score changes',()=>{
 const markup=slate(forecast());
 assert.match(markup,/Model spread/);assert.match(markup,/Home strength increased by 2\.0/);
 assert.doesNotMatch(markup,/Model home spread|Model away spread|Market home spread|Away strength/);
 assert.match(markup,/total decreased by 4\.0/);
 assert.match(markup,/Home score decreased by 1\.0/);assert.match(markup,/Away score decreased by 3\.0/);
 assert.equal((markup.match(/class="projectionAdjustment"/g)||[]).length,4);
 const away=slate({...forecast(-2,-2),fair_home_spread:9,home_spread_edge:-1.5,spread_pick:'Away -7.5',market:{...forecast().market,home_spread:7.5}});
 const spread=require('linkedom').parseHTML(away).document.querySelector('[aria-label="Spread forecast"]');
 assert.equal(spread.querySelectorAll('dd')[0].childNodes[0].textContent,'-9');assert.equal(spread.querySelectorAll('dd')[1].textContent,'-7.5');
 assert.equal(spread.querySelectorAll('dd')[2].textContent,'1.5 pts');assert.match(spread.innerHTML,/Away strength increased by 2\.0/);assert.doesNotMatch(spread.innerHTML,/Home strength/);
 const homeDog=slate({...forecast(),fair_home_spread:1.5,spread_pick:'Home +3',market:{...forecast().market,home_spread:3}});
 const dogSpread=require('linkedom').parseHTML(homeDog).document.querySelector('[aria-label="Spread forecast"]');
 assert.equal(dogSpread.querySelectorAll('dd')[0].childNodes[0].textContent,'+1.5');assert.equal(dogSpread.querySelectorAll('dd')[1].textContent,'+3');
 assert.match(dogSpread.innerHTML,/Home strength increased by 2\.0/);
 assert.doesNotMatch(slate({...forecast(),modelVersion:'legacy'}),/class="projectionAdjustment"/);
 assert.doesNotMatch(slate(forecast(),'NBA'),/class="projectionAdjustment"/);
 assert.doesNotMatch(slate(forecast(0,0)),/class="projectionAdjustment"/);
});
test('both spread sides and both total choices retain the correct adjustment in model context',()=>{
 const f=forecast(),asOf=Date.parse(f.lockedAt)+1000;
 for(const [market,side,selectionTeam,expected] of [['Spread','','Home',2],['Spread','','Away',-2],['Total','Over','',-4],['Total','Under','',-4]]) {
  const result=ncaamModelFor({market,side,selectionTeam,awayTeam:'Away',homeTeam:'Home',gameTime:f.tipoff,line:market==='Spread'?-10:150},[f],asOf);
  assert.equal(result.context.projectionAdjustment,expected);
  assert.equal(result.active,false);assert.equal(result.context.grade,'Ungraded');
 }
});
