const {test}=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), vm=require('node:vm');
const ts=require('typescript'), React=require('react'), {renderToStaticMarkup:render}=require('react-dom/server');
const root=path.resolve(__dirname,'..');
function loader(overrides={}) {
  const cache=new Map();
  function load(file) {
    const full=path.resolve(root,file);
    if(cache.has(full))return cache.get(full);
    if(full.endsWith('.json'))return JSON.parse(fs.readFileSync(full,'utf8'));
    const exports={};cache.set(full,exports);
    const source=ts.transpileModule(fs.readFileSync(full,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
    vm.runInNewContext(source,{exports,Date,Intl,console,require:name=>overrides[name]||(name.startsWith('.')?load(path.relative(root,path.resolve(path.dirname(full),/\.(?:json|tsx?)$/.test(name)?name:name+'.ts'))):require(name))},{filename:full});
    return exports;
  }
  return load;
}
const load=loader(), {settleApprovedManualPick:settle}=load('lib/manualEzpzSettlement.ts');
const now=Date.parse('2035-11-24T05:00:00Z');
const pick={id:'manual_20351123_nfl_401910036_cin',sport:'NFL',date:'2035-11-23',game:'Cincinnati @ Washington',gameTime:'2035-11-23T20:00:00Z',
  market:'Spread',selection:'CIN -6',line:-6,odds:'-110',approvedAt:'2035-11-23T19:00:00Z',approvedBy:'ChatGPT',selectedBy:'Ryan',status:'approved',result:'PENDING'};
const final={sport:'NFL',date:pick.date,gameId:'401910036',gameTime:pick.gameTime,completed:true,status:'STATUS_FINAL',
  away:{name:'Cincinnati Bengals',score:31},home:{name:'Washington Commanders',score:20},observedAt:'2035-11-24T00:00:00Z',source:'ESPN official scoreboard'};
const plain=x=>JSON.parse(JSON.stringify(x));

test('settlement uses the approved side, line and actual recorded price',()=>{
  const result=settle(pick,[final],now);
  assert.equal(result.result,'W');assert.equal(result.netUnits,100/110);
  for(const key of ['id','sport','date','game','gameTime','market','selection','line','odds','approvedAt','selectedBy','approvedBy','status'])assert.equal(result[key],pick[key]);
  assert.deepEqual(plain(result.finalScore),{away:31,home:20});
  assert.equal(result.resultGameId,final.gameId);assert.equal(result.resultSource,final.source);
  assert.equal(settle({...pick,selection:'WAS +6',line:6},[final],now).result,'L');
  assert.equal(settle({...pick,selection:'CIN -11',line:-11},[final],now).result,'P');
  const total={...pick,market:'Total',selection:'Under 51.5',line:51.5,odds:'-115'};
  assert.equal(settle(total,[final],now).netUnits,100/115);
  assert.equal(settle({...total,selection:'Over 51.5'},[final],now).result,'L');
  assert.equal(settle({...pick,market:'Moneyline',selection:'CIN ML',line:null,odds:'+125'},[final],now).netUnits,1.25);
});

test('a reversed neutral-site display does not reverse the approved bet or final score',()=>{
  const result=settle(pick,[{...final,away:final.home,home:final.away}],now);
  assert.equal(result.result,'W');assert.deepEqual(plain(result.finalScore),{away:31,home:20});
});

test('college abbreviations match saved full team names with mascots',()=>{
  for(const [name,full] of [['UConn','UConn Huskies'],['UAB','UAB Blazers'],['UMass','UMass Minutemen'],['FIU','Florida International Panthers']]){
    const approval={...pick,sport:'NCAAM',game:`${name} @ Yale`,selection:`${name} -6.5`,line:-6.5};
    const game={...final,sport:'NCAAM',away:{name:full,score:80},home:{name:'Yale Bulldogs',score:70}};
    assert.equal(settle(approval,[game],now).result,'W',name);
  }
});

test('missing, ambiguous, mismatched and unfinished outcomes stay pending',()=>{
  for(const changes of [
    {completed:false},{status:'STATUS_IN_PROGRESS'},{date:'2035-11-22'},{gameId:'401910037'},
    {away:{...final.away,score:NaN}},{home:{...final.home,score:-1}},
    {observedAt:'2035-11-23T19:59:00Z'},{observedAt:'2035-11-25T00:00:00Z'},
    {source:'Unverified provider'},{home:{name:'Philadelphia Eagles',score:20}},
  ])assert.equal(settle(pick,[{...final,...changes}],now),pick);
  assert.equal(settle(pick,[],now),pick);
  assert.equal(settle(pick,[final,{...final,home:{...final.home,score:50}}],now),pick);
  assert.equal(settle({...pick,line:-5.5},[final],now).result,'PENDING');
  assert.equal(settle({...pick,odds:null},[final],now).result,'PENDING');
  assert.equal(settle({...pick,market:'Player Prop'},[final],now).result,'PENDING');
  assert.equal(settle(pick,[final],Date.parse('2035-11-23T19:30:00Z')),pick);
});

test('an already settled approval cannot be regraded by a later read',()=>{
  const settled={...pick,result:'L',netUnits:-1,resultSource:'Reviewed official result'};
  assert.equal(settle(settled,[final],now),settled);
});

test('settled and void manual picks cannot become eligible for publication',()=>{
  const {normalizeMcpPick}=load('lib/ezpzMcpPicks.ts');
  const {manualPickForMcp}=load('lib/manualEzpzPicks.ts');
  for(const result of ['W','L','P','VOID']){
    const future={...pick,gameTime:'2035-11-25T20:00:00Z',result};
    const normalized=normalizeMcpPick('NFL',manualPickForMcp(future),now);
    assert.equal(normalized.pickCategory,'manual');assert.equal(normalized.eligibleForPosting,false);
  }
});

test('identical teams in a doubleheader require a unique game identity',()=>{
  const noId={...pick,id:'manual_no_game_id'};
  const second={...final,gameId:'401910037'};
  assert.equal(settle(noId,[final,second],now),noId);
  assert.equal(settle(pick,[final,second],now).result,'W');
});

test('new approvals resolve from a bounded, read-only saved schedule and reuse its short cache',async()=>{
  const reads=[];
  const row={Date:pick.date,'Game ID':final.gameId,'Game Time':final.gameTime,Completed:'TRUE',Status:'STATUS_FINAL',
    'Away Team':final.away.name,'Home Team':final.home.name,'Away Score':'31','Home Score':'20','Result Updated':final.observedAt,Source:final.source};
  const read=loader({'./manualEzpzPicks':{getApprovedManualPicks:()=>[pick]},'./tursoStore':{
    readTursoDatasetByDateKeys:async(sport,dataset,dates)=>{reads.push({sport,dataset,dates});return [row];}
  }})('lib/manualEzpzResults.ts').readApprovedManualPickResults;
  assert.equal((await read('NFL',undefined,now))[0].result,'W');
  assert.equal((await read('NFL',undefined,now+1000))[0].result,'W');
  assert.equal(reads.length,1);assert.equal(reads[0].dataset,'schedule');assert.equal(reads[0].sport,'NFL');
  assert.deepEqual([...new Set(reads[0].dates)],['2035-11-23','11/23/2035']);
});

test('results outages preserve approved picks and never manufacture settlements',async()=>{
  const read=loader({'./manualEzpzPicks':{getApprovedManualPicks:()=>[pick]},'./tursoStore':{
    readTursoDatasetByDateKeys:async()=>{throw new Error('unavailable');}
  }})('lib/manualEzpzResults.ts').readApprovedManualPickResults;
  assert.deepEqual(plain(await read('NFL',undefined,now)),[pick]);
});

test('settled and upcoming approvals require no database result reads',async()=>{
  const future={...pick,gameTime:'2035-11-25T20:00:00Z'};
  const done={...pick,result:'W',netUnits:100/110,resultSource:'ESPN official final'};
  const read=loader({'./manualEzpzPicks':{getApprovedManualPicks:()=>[future,done]},'./tursoStore':{
    readTursoDatasetByDateKeys:async()=>{throw new Error('must not read');}
  }})('lib/manualEzpzResults.ts').readApprovedManualPickResults;
  assert.deepEqual(plain(await read('NFL',undefined,now)),[future,done]);
});

test('official record totals include losses and pushes and exclude void stake',()=>{
  const View=loader()('app/ManualEzpzRecords.tsx').OfficialRecordView;
  const rows=['W','L','P','VOID','PENDING'].map((result,index)=>({...pick,id:'manual_case_'+index,result,
    netUnits:result==='W'?100/110:result==='L'?-1:0,finalScore:{away:31,home:20}}));
  const html=render(React.createElement(View,{sport:'NFL',picks:rows}));
  assert.match(html,/1–1–1/);assert.match(html,/-0\.09u/);assert.match(html,/-3\.0%/);
  assert.match(html,/Awaiting result/);assert.match(html,/Final 31–20/);assert.match(html,/1 void/);
});
