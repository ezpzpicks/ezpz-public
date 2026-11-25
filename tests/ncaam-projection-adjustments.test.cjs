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

const { ncaamReversedTotalView } = require('../lib/ncaamTotalDisplay.ts');
const nov25 = overrides => ({...forecast(),tipoff:'2026-11-25T05:00:00Z',total:146,
 market_tracking:{...forecast().market_tracking,baseline_total:150},...overrides});
test('experimental total reverses and doubles the saved delta without changing spread or stored forecast',()=>{
 const f=nov25(),copy=JSON.stringify(f),v=ncaamReversedTotalView(f);
 assert.deepEqual(v,{total:158,edge:8,awayScore:73,homeScore:85,pick:'Over 150',
  adjustments:{homeSpread:2,awaySpread:-2,total:8,homeScore:5,awayScore:3}});
 assert.equal(v.homeScore-v.awayScore,12);
 assert.equal(JSON.stringify(f),copy);
 const positive=nov25({total:154,market_tracking:{...f.market_tracking,total_adjustment:4}});
 assert.equal(ncaamReversedTotalView(positive).pick,'Under 150');
 const zero=nov25({total:150,market_tracking:{...f.market_tracking,total_adjustment:0}});
 assert.equal(ncaamReversedTotalView(zero).pick,'No total edge');
});
test('excludes prior Eastern date, missing or inconsistent data and invalid scores',()=>{
 const f=nov25();
 for (const row of [nov25({tipoff:'2026-11-25T04:59:59.999Z'}),nov25({modelVersion:'legacy'}),
  nov25({total:147}),nov25({market:null}),nov25({tipoff:'bad'}),nov25({fair_home_spread:-160}),
  nov25({market_tracking:{...f.market_tracking,status:'waiting_for_history'}})]) assert.equal(ncaamReversedTotalView(row),null);
});
test('Projections shows reversed total and arrows while keeping the saved spread; NBA is unchanged',()=>{
 const f=nov25(), {parseHTML}=require('linkedom');
 const html=slate(f), {document}=parseHTML(html);
 const total=document.querySelector('[aria-label="Total forecast"]');
 assert.equal(total.querySelector('.nbaSelection').textContent,'Over 150');
 assert.doesNotMatch(total.textContent,/experimental/i);assert.match(total.textContent,/Reversed 2× market adjustment/);
 assert.match(total.querySelector('dd').textContent,/158\.0/);
 assert.match(total.innerHTML,/total increased by 8\.0/);
 const spread=document.querySelector('[aria-label="Spread forecast"]');
 assert.equal(spread.outerHTML,parseHTML(slate(forecast())).document.querySelector('[aria-label="Spread forecast"]').outerHTML);
 assert.doesNotMatch(slate(f,'NBA'),/Experimental total/);
});
test('mobile and expanded canonical projections render the legacy bridge result without a second inversion',()=>{
 const legacy=nov25(), view=ncaamReversedTotalView(legacy);
 const current={...legacy,modelVersion:require('../lib/ncaamMarketTrackingPolicy.ts').NCAAM_REVERSED_TOTAL_MODEL,
  total:view.total,total_edge:view.edge,total_pick:view.pick,home_score:view.homeScore,away_score:view.awayScore,
  market_tracking:{...legacy.market_tracking,total_adjustment:view.adjustments.total}};
 assert.deepEqual(ncaamReversedTotalView(current),view);
 assert.equal(slate(current),slate(legacy));
});

test('November spread bridge turns a home lean into the away lean, keeps the total and bypasses canonical rows',()=>{
 const {ncaamSpreadDisplay}=require('../lib/ncaamTotalDisplay.ts');
 const {NCAAM_REVERSED_SPREAD_MODEL}=require('../lib/ncaamMarketTrackingPolicy.ts');
 const old=nov25();old.market_tracking={...old.market_tracking,baseline_margin:10};
 const json=JSON.stringify(old),v=ncaamSpreadDisplay(old),display=ncaamReversedTotalView(v);
 assert.equal(v.fair_home_spread,-6);assert.equal(v.spread_pick,'Away +10');assert.equal(v.home_spread_edge,-4);
 assert.equal(display.total,158);assert.equal(display.homeScore-display.awayScore,6);
 assert.equal(display.adjustments.awaySpread,4);assert.equal(JSON.stringify(old),json);
 assert.equal(ncaamSpreadDisplay({...old,tipoff:'2026-11-24T20:00:00Z'}).fair_home_spread,old.fair_home_spread);
 const canonical={...v,modelVersion:NCAAM_REVERSED_SPREAD_MODEL,total:158,total_edge:8,total_pick:'Over 150',
   away_score:display.awayScore,home_score:display.homeScore,market_tracking:{...v.market_tracking,total_adjustment:8}};
 assert.strictEqual(ncaamSpreadDisplay(canonical),canonical);
 assert.equal(slate(old),slate(canonical));
 assert.match(slate(old),/Away strength increased by 4\.0/);
});
