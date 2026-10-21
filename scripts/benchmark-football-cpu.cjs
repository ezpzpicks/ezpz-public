// Compare the production catalog with a git revision without contacting services.
// Usage: node scripts/benchmark-football-cpu.cjs [base-ref]
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),ref=process.argv[2]||'HEAD';
const code=file=>fs.readFileSync(path.join(root,file),'utf8');
const original=file=>execFileSync('git',['show',`${ref}:${file}`],{cwd:root,encoding:'utf8'});
const compile=(source,file,imports={})=>{const filename=path.join(root,file),m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));
 const inherited=m.require.bind(m);m.require=id=>Object.hasOwn(imports,id)?imports[id]:inherited(id);
 m._compile(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);return m.exports;};
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
const filename='lib/footballTrendCatalog.ts',storeFile='lib/footballTrendCatalogStore.ts';
const before=compile(original(filename),filename),after=compile(code(filename),filename);
const end=Date.parse('2026-10-24T16:45:00Z'),start=end-1000*300000;
const plays=Array.from({length:8},(_,i)=>[
 ['Spread',`Away ${i}`,-3,-1,60,75],['Spread',`Home ${i}`,3,1,40,25],['Total','Over',48,50,70,60],['Total','Under',48,50,30,40]
].map(([market,side,line,openingLine,betsPct,moneyPct])=>({date:'2026-10-24',game:`Away ${i} @ Home ${i}`,awayTeam:`Away ${i}`,homeTeam:`Home ${i}`,market,side,selection:side,selectionTeam:side,line,openingLine,betsPct,moneyPct,openingBetsPct:betsPct,openingMoneyPct:moneyPct,odds:'-110',openingOdds:'-110',snapshotStatus:'FINAL_PREGAME',gameTime:'2026-10-24T17:00:00Z',frozenAt:new Date(end).toISOString(),openingSnapshotTime:new Date(start).toISOString(),result:'W',movementHistory:Array.from({length:1001},(_,j)=>({snapshotTime:new Date(start+j*300000).toISOString(),line:j<500?openingLine:line,betsPct,moneyPct,odds:'-110'}))}))).flat();
const rows=plays.map(p=>({Date:p.date,Game:p.game,'Game Time':p.gameTime,'Away Team':p.awayTeam,'Home Team':p.homeTeam,Market:p.market,Selection:p.selection,Side:p.side,
 'Public Split Selection':p.selection,'Public Split Line':String(p.line),'Public Split Odds':p.odds,'Public Bets %':String(p.betsPct),'Public Money %':String(p.moneyPct),
 'Opening Public %':String(p.openingBetsPct),'Opening Sharp %':String(p.openingMoneyPct),'Opening Public Split Line':String(p.openingLine),'Opening Public Split Odds':p.openingOdds,
 'Opening Public Split Snapshot Time':p.openingSnapshotTime,'Public Split Snapshot Time':p.frozenAt,'Snapshot Status':p.snapshotStatus,'Record Snapshot Policy':'verified-final-snapshot-v1',
 'Movement History JSON':JSON.stringify(p.movementHistory),Result:'W','Result Updated':'2026-10-24T21:00:00Z'}));
function store(source,catalog){const tables={};const storage={readSportWorksheet:async(_,tab)=>tables[tab]||[],upsertSportRows:async(_,tab,headers,entries,key)=>{
 const saved=new Map((tables[tab]||[]).map(row=>[key(row),row]));for(const row of entries)saved.set(key(row),row);tables[tab]=[...saved.values()];}};
 return compile(source,storeFile,{'./footballTrendCatalog':catalog,'./sportSheets':storage});}
async function measure(label,operation){await operation();const cpu=process.cpuUsage(),start=performance.now();let result;for(let i=0;i<3;i++)result=await operation();const usage=process.cpuUsage(cpu);return{label,cpuMs:(usage.user+usage.system)/1000,wallMs:performance.now()-start,result};}
(async()=>{const a=store(original(storeFile),before),b=store(code(storeFile),after);await a.captureFootballCatalog('NCAAF',[],plays,true);await b.captureFootballCatalog('NCAAF',[],plays,true);
 const old=await measure('before',()=>a.captureFootballCatalog('NCAAF',rows,plays,false));
 const next=await measure('after',()=>b.captureFootballCatalog('NCAAF',rows,plays,false));
 assert.deepEqual(JSON.parse(JSON.stringify(next.result)),JSON.parse(JSON.stringify(old.result)));
 console.log(JSON.stringify({baseRef:ref,games:8,observationsPerSide:1001,runs:3,beforeCpuMs:old.cpuMs,afterCpuMs:next.cpuMs,cpuReductionPct:Math.round((1-next.cpuMs/old.cpuMs)*1000)/10,identicalResults:true},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
