const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const load=require('./load-typescript.cjs');
const api=load(path.join(__dirname,'../lib/ncaafMatchupFactors.ts'));
const {fixture}=require('./fixtures/ncaaf-edge-grade.cjs');
const date='2026-11-14';
function row(id,options={}) {return {...fixture(api,options).row,'Game ID':id};}
function spread(id,margin,homeLine) {return row(id,{margin,homeLine,total:60,totalLine:60});}
function total(id,points,line) {return row(id,{margin:0,homeLine:0,total:points,totalLine:line});}

test('play mix reports the actual favorite/dog/over/under imbalance without filling quotas',()=>{
 const rows=[spread('fa1',20,-10),spread('fa2',20,-10),spread('fb1',18,-10),spread('fb2',18,-10),
  spread('fb3',18,-10),spread('db',-2,10),total('oa',70,60),total('ua',40,50),total('ub1',42,50),total('ub2',42,50)];
 const before=JSON.stringify(rows),mix=api.ncaafModelPlayMix(rows,date);
 assert.deepEqual({total:mix.total,A:mix.A,B:mix.B,favorites:mix.favorites,underdogs:mix.underdogs,overs:mix.overs,unders:mix.unders},
  {total:10,A:4,B:6,favorites:5,underdogs:1,overs:1,unders:3});
 assert.equal(mix.capturedGames,10);assert.equal(JSON.stringify(rows),before);
 assert.equal(api.ncaafModelPlayMix([rows[0]],date).total,1);
});

test('one spread and one total count separately; repeated captures use the newest row once',()=>{
 const original=row('same'),newer={...row('same',{homeLine:-8,totalLine:58}),'Build Captured At':'2026-11-14T12:05:00Z'};
 assert.equal(api.ncaafModelPlayMix([original,original],date).total,2);
 for(const rows of [[original,newer],[newer,original]]) {
  const mix=api.ncaafModelPlayMix(rows,date);assert.equal(mix.total,0);assert.equal(mix.games,1);assert.equal(mix.capturedGames,1);
 }
});

test('old policies, missing proof, other dates, and price/large-spread holds cannot inflate current counts',()=>{
 const archived=row('old',{policy:'ncaaf-sp-edge-2026-11-14-v5',a:6,b:3});
 const bad={...row('bad'),'Projection Engine':'legacy_fallback'};
 const other={...row('date'),Date:'2026-11-13'};
 const large=spread('large',32,-21);
 const held=spread('held',20,-10),g=JSON.parse(held['Matchup Spread JSON']);
 held['Spread Grade']='No Play';held['Matchup Spread JSON']=JSON.stringify({...g,grade:'Research',eligible:false});
 const mix=api.ncaafModelPlayMix([archived,bad,other,large,held],date);
 assert.equal(mix.total,0);assert.equal(mix.capturedGames,2);assert.equal(mix.games,4);
});

test('pickems remain visible separately and an empty slate has finite zero counts',()=>{
 const mix=api.ncaafModelPlayMix([spread('pk',10,0)],date);
 assert.equal(mix.pickems,1);assert.equal(mix.favorites,0);assert.equal(mix.underdogs,0);assert.equal(mix.total,1);
 const empty=api.ncaafModelPlayMix([],date);assert(Object.values(empty).every(v=>v===0));
});
