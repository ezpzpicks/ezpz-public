const {test}=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), vm=require('node:vm');
const ts=require('typescript'), React=require('react'), {renderToStaticMarkup:render}=require('react-dom/server');
const root=path.resolve(__dirname,'..');
function loader(overrides={}, clock=Date) {
  const cache=new Map();
  function load(file) {
    const full=path.resolve(root,file);
    if(cache.has(full))return cache.get(full);
    if(full.endsWith('.json'))return JSON.parse(fs.readFileSync(full,'utf8'));
    const exports={};cache.set(full,exports);
    const source=ts.transpileModule(fs.readFileSync(full,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
    vm.runInNewContext(source,{exports,Date:clock,Intl,console,require:name=>overrides[name]||(name.startsWith('.')?load(path.relative(root,path.resolve(path.dirname(full),/\.(?:json|tsx?)$/.test(name)?name:name+'.ts'))):require(name))},{filename:full});
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

test('settlement uses approved side/line and simulated -110 only for spreads and totals',()=>{
  const result=settle(pick,[final],now);
  assert.equal(result.result,'W');assert.equal(result.netUnits,100/110);
  for(const key of ['id','sport','date','game','gameTime','market','selection','line','odds','approvedAt','selectedBy','approvedBy','status'])assert.equal(result[key],pick[key]);
  assert.deepEqual(plain(result.finalScore),{away:31,home:20});
  assert.equal(result.resultGameId,final.gameId);assert.equal(result.resultSource,final.source);
  assert.equal(settle({...pick,selection:'WAS +6',line:6},[final],now).result,'L');
  assert.equal(settle({...pick,selection:'CIN -11',line:-11},[final],now).result,'P');
  const total={...pick,market:'Total',selection:'Under 51.5',line:51.5,odds:'-115'};
  assert.equal(settle(total,[final],now).netUnits,100/110);
  assert.equal(settle(total,[final],now).odds,"-115");
  assert.equal(settle(total,[final],now).trackingBasis,"standard-simulated");
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
  assert.equal(settle({...pick,odds:null,market:"Moneyline",selection:"CIN ML",line:null},[final],now).result,'PENDING');
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
  assert.deepEqual(plain(await read('NFL',undefined,now)),[plain(load("lib/officialTracking.ts").standardOfficialTracking(pick))]);
});

test('settled and upcoming approvals require no database result reads',async()=>{
  const future={...pick,gameTime:'2035-11-25T20:00:00Z'};
  const done={...pick,result:'W',netUnits:100/110,resultSource:'ESPN official final'};
  const read=loader({'./manualEzpzPicks':{getApprovedManualPicks:()=>[future,done]},'./tursoStore':{
    readTursoDatasetByDateKeys:async()=>{throw new Error('must not read');}
  }})('lib/manualEzpzResults.ts').readApprovedManualPickResults;
  assert.deepEqual(plain(await read('NFL',undefined,now)),[future,done].map(p=>plain(load("lib/officialTracking.ts").standardOfficialTracking(p))));
});

test('official record totals include losses and pushes and exclude void stake',()=>{
  const View=loader()('app/ManualEzpzRecords.tsx').OfficialRecordView;
  const rows=['W','L','P','VOID','PENDING'].map((result,index)=>({...pick,id:'manual_case_'+index,result,
    netUnits:result==='W'?100/110:result==='L'?-1:0,finalScore:{away:31,home:20}}));
  const html=render(React.createElement(View,{sport:'NFL',picks:rows}));
  assert.match(html,/1–1–1/);assert.match(html,/-0\.09u/);assert.match(html,/-3\.0%/);
  assert.match(html,/Awaiting result/);assert.match(html,/Final 31–20/);assert.match(html,/1 void/);
});

test('unpriced official spreads/totals settle W/L/P from verified finals, never an unfinished game',()=>{
  for(const [selection,line,result] of [['CIN -6',-6,'W'],['CIN -12',-12,'L'],['CIN -11',-11,'P']]) {
    const unpriced={...pick,selection,line,odds:null};
    const graded=settle(unpriced,[final],now);
    assert.equal(graded.result,result);assert.equal(graded.odds,null);assert.equal(graded.trackingOdds,-110);
    assert.equal(graded.netUnits,result==='W'?100/110:result==='L'?-1:0);
    assert.equal(settle(unpriced,[{...final,completed:false,status:'STATUS_IN_PROGRESS'}],now),unpriced);
  }
  const belmont={...pick,id:'manual_20261124_ncaam_401928835_total_under_139_5',sport:'NCAAM',date:'2026-11-24',game:'Belmont @ Akron',
    gameTime:'2026-11-24T17:30:00Z',approvedAt:'2026-11-24T17:00:00Z',market:'Total',selection:'Under 139.5',line:139.5,odds:null};
  const confirmed={...final,sport:'NCAAM',date:belmont.date,gameId:'401928835',gameTime:belmont.gameTime,
    away:{name:'Belmont Bruins',score:64},home:{name:'Akron Zips',score:87},observedAt:'2026-11-24T21:50:06.316Z'};
  const result=settle(belmont,[confirmed],Date.parse('2026-11-24T22:00:00Z'));
  assert.equal(result.result,'L');assert.equal(result.netUnits,-1);assert.equal(result.resultGameId,'401928835');
  assert.deepEqual(plain(result.finalScore),{away:64,home:87});assert.equal(result.odds,null);
});

test('historical standard tracking retains quoted prices, recorded units and settlement provenance',()=>{
  const {standardOfficialTracking:track}=load('lib/officialTracking.ts');
  const historical={...pick,odds:'+125',result:'W',netUnits:1.25,units:1.25,resultSource:'Verified historical final',resultUpdated:'2035-11-24T00:00:00Z'};
  const row=track(historical);
  assert.equal(row.netUnits,100/110);assert.equal(row.units,100/110);assert.equal(row.recordedNetUnits,1.25);assert.equal(row.recordedUnits,1.25);
  assert.equal(row.odds,'+125');assert.equal(row.resultSource,historical.resultSource);assert.equal(row.resultUpdated,historical.resultUpdated);
  assert.deepEqual(plain(track(row)),plain(row));assert.equal(historical.netUnits,1.25);
  for(const market of ['Moneyline','Player Prop','Team Total','First Half Spread'])assert.equal(track({...historical,market}).trackingBasis,undefined);
  const View=loader()('app/ManualEzpzRecords.tsx').OfficialRecordView;
  const html=render(React.createElement(View,{sport:'NFL',picks:[row,track({...pick,result:'L',netUnits:-1}),track({...pick,result:'P',netUnits:0})]}));
  assert.match(html,/1–1–1/);assert.match(html,/-0\.09u/);assert.match(html,/-3\.0%/);assert.match(html,/simulated -110, not bookmaker prices/);
});

test('both dated official routes expose only individually approved game markets with league attribution', async () => {
  const day = '2035-11-23';
  const fixtures = ['NBA','NFL','NCAAF'].flatMap(sport =>
    ['Spread','Total','Player Prop'].map(market => ({
      ...pick, sport, market, date: day, id: 'manual_route_' + sport + '_' + market.replace(/ /g,''),
      selectedBy:'ChatGPT', approvedBy:'Ryan', delegation:'ezpz-nba-nfl-ncaaf-2026-11-28',
      game:'Away @ Home', selection:market === 'Spread' ? 'Home -6' : 'Over 41.5', line:market === 'Spread' ? -6 : 41.5,
      approvedAt:'2035-11-23T19:00:00.123456Z'
    })));
  const clock = Date.parse('2035-11-23T19:01:00Z');
  class FixtureDate extends Date { static now() { return clock; } }
  const loadRoutes = loader({'../data/manual-ezpz-picks.json':{picks:fixtures}, './tursoStore':{}}, FixtureDate);
  for (const route of ['ezpz-picks','ezpz-results']) {
    const {GET} = loadRoutes('app/api/' + route + '/route.ts');
    for (const sport of ['NBA','NFL','NCAAF']) {
      const response = await GET({nextUrl:new URL('https://example.invalid/api/'+route+'?sport='+sport+'&date='+day)});
      const body = await response.json();
      assert.equal(response.status,200);
      assert.deepEqual(body.picks.map(p=>p.market).sort(),['Spread','Total']);
      for (const row of body.picks) {
        assert.equal(row.sport,sport);
        assert.equal(row.finalizedAt,fixtures[0].approvedAt);
        assert.equal(row.selectedBy,'ChatGPT');
        assert.equal(row.approvedBy,'Ryan');
        if (route==='ezpz-picks') {
          assert.equal(row.pickType,'Selected by ChatGPT under Ryan’s '+sport+' delegation');
          assert.equal(row.eligibleForPosting,true);
        }
      }
    }
  }
});
