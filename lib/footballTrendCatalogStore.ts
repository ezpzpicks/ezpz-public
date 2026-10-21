import {
  catalogEventKey, catalogSide, catalogSelectionIdentity, evaluateFootballCatalogGroup, footballCatalog,
  type CatalogEvaluation,
} from './footballTrendCatalog';
import { readSportWorksheet, upsertSportRows, type FootballSport, type SheetRow } from './sportSheets';
import { isVerifiedNcaafTrendRecord } from './ncaafTrendRecordPolicy';

type Side=Record<string,any>;
export const CATALOG_ENTRIES_TAB='football_catalog_memberships';
export const CATALOG_DEFINITIONS_TAB='football_catalog_definitions';
export const CATALOG_ENTRY_HEADERS=[
  'Entry Key','Definition Version','Date','Game Key','Game','Game Time','Away Team','Home Team','Market',
  'Selection','Side','Line','Odds','Public Split Selection','Public Split Line','Public Split Odds',
  'Public Bets %','Public Money %','Opening Public %','Opening Sharp %','Opening Public Split Line',
  'Opening Public Split Odds','Opening Public Split Snapshot Time','Public Split Snapshot Time','Public Split Source',
  'Observed Price Missing','Snapshot Status','Record Snapshot Policy','Catalog Membership JSON','Result','Result Updated',
  'Actual Away Runs','Actual Home Runs','Capture Mode','Public Change %','Sharp Change %','Line Movement Value','Line Movement Basis',
];
const DEFINITION_HEADERS=['Definition Key','Definition Version','Pair ID','Direction','Name','Market','Required Data','Trigger',
  'Status','Entries','Wins','Losses','Pushes','Missing Input Events','Ambiguous Events'];
const result=(x:unknown)=>{const s=String(x||'').toUpperCase();return ['W','WIN','WON'].includes(s)?'W':['L','LOSS','LOST'].includes(s)?'L':['P','PUSH'].includes(s)?'P':'';};
function entryKey(row:Side,sport:string) {
  return [footballCatalog(sport).version,catalogEventKey(row,sport),row.Market || row.market,catalogSelectionIdentity(row,sport)].join('|');
}
function savedMembership(p:Side):CatalogEvaluation|undefined {
  if(!p.Market)return p.catalogEvaluation;
  try{return JSON.parse(p['Catalog Membership JSON']);}catch{return undefined;}
}
function annotate(plays:Side[],sport:string,frozen:ReadonlySet<Side>=new Set()) {
  const groups=new Map<string,Side[]>();
  for(const p of plays){const k=catalogEventKey(p,sport);groups.set(k,[...(groups.get(k)||[]),p]);}
  const evaluated=new Map<Side,CatalogEvaluation>();
  for(const group of groups.values()) {
    // These rows are the collector's immutable saved memberships. Replaying a
    // chartless copy on each visitor request cannot improve their evidence.
    if (group.every(p => (isVerifiedNcaafTrendRecord(p) || frozen.has(p))
      && savedMembership(p)?.version === footballCatalog(sport).version)) {
      for (const p of group) evaluated.set(p, savedMembership(p)!);
      continue;
    }
    // Repeated source aliases must not make a paired market look like four sides.
    const unique=new Map<string,Side>();
    for(const p of group){const s=catalogSide(p);const k=`${s.market}|${catalogSelectionIdentity(s,sport)}`;if(!unique.has(k))unique.set(k,p);}
    const members=[...unique.values()], evaluations=evaluateFootballCatalogGroup(members,sport);
    members.forEach((p,i)=>evaluated.set(p,evaluations[i]));
    for(const p of group){if(evaluated.has(p))continue;const s=catalogSide(p);const same=members.find(x=>{const q=catalogSide(x);return q.market===s.market&&catalogSelectionIdentity(q,sport)===catalogSelectionIdentity(s,sport);});if(same)evaluated.set(p,evaluated.get(same)!);}
  }
  return evaluated;
}
function rowForPlay(p:Side):SheetRow {
  return {Date:String(p.date||''),'Game Key':String(p.gameKey||''),Game:String(p.game||''),'Game Time':String(p.gameTime||''),
    'Away Team':String(p.awayTeam||''),'Home Team':String(p.homeTeam||''),Market:String(p.market||''),
    Selection:String(p.selectionTeam||p.side||p.selection||''),Side:String(p.side||''),Line:String(p.line??''),Odds:String(p.odds||''),
    'Public Split Selection':String(p.selectionTeam||p.side||p.selection||''),'Public Split Line':String(p.line??''),'Public Split Odds':String(p.odds||''),
    'Public Bets %':String(p.betsPct??''),'Public Money %':String(p.moneyPct??''),
    'Opening Public %':String(p.openingBetsPct??''),'Opening Sharp %':String(p.openingMoneyPct??''),
    'Opening Public Split Line':String(p.openingLine??''),'Opening Public Split Odds':String(p.openingOdds||''),
    'Opening Public Split Snapshot Time':String(p.openingSnapshotTime||p.firstTrackedAt||''),
    'Public Split Snapshot Time':String(p.frozenAt||p.updatedAt||''),'Public Split Source':String(p.publicSplitSource||p.marketSource||(p.date<'2026-09-21'?'Retained legacy feed':'ScoresAndOdds')),
    'Observed Price Missing':p.observedPriceMissing||p.oddsSource==='DEFAULT_110'?'TRUE':'FALSE',
    'Snapshot Status':String(p.snapshotStatus||''),'Record Snapshot Policy':'verified-final-snapshot-v1',
    'Public Change %':String(p.publicMovementPct??''),'Sharp Change %':String(p.sharpMovementPct??''),
    'Line Movement Value':String(p.lineMovementValue??''),'Line Movement Basis':String(p.lineMovementBasis||''),
    Result:result(p.result)||'Pending','Result Updated':String(p.resultUpdated||''),
  };
}

export async function captureFootballCatalog(sport:FootballSport,rows:SheetRow[],plays:Side[],persist=false) {
  const config=footballCatalog(sport);
  const existing=await readSportWorksheet(sport,CATALOG_ENTRIES_TAB,CATALOG_ENTRY_HEADERS);
  const saved=new Map(existing.map(r=>[r['Entry Key'],r]));
  const frozen=new Set<Side>();
  const savedEvaluation=(p:Side)=>{
    const row=saved.get(entryKey(p,sport));
    if(!row || row['Definition Version']!==config.version || !isVerifiedNcaafTrendRecord(row))return null;
    try {const e=JSON.parse(row['Catalog Membership JSON']);return e?.version===config.version?e:null;}catch{return null;}
  };
  const verified=rows.filter(isVerifiedNcaafTrendRecord).map(row=>{
    const e=savedEvaluation(row);
    return e?{...row,'Catalog Membership JSON':JSON.stringify(e)}:row;
  });
  // The collector's feed policy is explicit and separate from a pick's
  // workflow source ("Trend Play"). Keep this same source on live and final
  // memberships so source-cohort subsets cannot change at settlement.
  const sourcedPlays=plays.map(p=>{
    const next:Side={...p,publicSplitSource:p.publicSplitSource||p.marketSource||(p.date<'2026-09-21'?'Retained legacy feed':'ScoresAndOdds')};
    const e=p.snapshotStatus==='FINAL_PREGAME'?savedEvaluation(p):null;
    if(e){next.catalogEvaluation=e;frozen.add(next);}
    return next;
  });
  const rowEvaluations=annotate(verified,sport),playEvaluations=annotate(sourcedPlays,sport,frozen);
  const annotatedRows=verified.map(row=>{
    const next:SheetRow={...row,'Catalog Membership JSON':JSON.stringify(rowEvaluations.get(row))};
    // The raw quote archive remains in weekly_market_trends. Memberships include
    // the exact version and refer to that immutable O/D/history by game+side.
    delete next['Movement History JSON'];
    return next;
  });
  const annotatedPlays:Side[]=sourcedPlays.map(p=>({...p,catalogEvaluation:playEvaluations.get(p)}));
  const entries=new Map<string,SheetRow>();
  for(const row of annotatedRows){const k=entryKey(row,sport);entries.set(k,{...row,'Entry Key':k,'Definition Version':config.version,'Capture Mode':String(row.Date)<='2026-10-10'?'HISTORICAL_REPLAY':'FORWARD'});}
  for(const p of annotatedPlays) {
    if(p.snapshotStatus!=='FINAL_PREGAME' || p.catalogEvaluation?.invalid)continue;
    const row=rowForPlay(p),k=entryKey(row,sport);
    if(!entries.has(k))entries.set(k,{...row,'Entry Key':k,'Definition Version':config.version,'Catalog Membership JSON':JSON.stringify(p.catalogEvaluation),'Capture Mode':p.date<='2026-10-10'?'HISTORICAL_REPLAY':'FORWARD'});
  }
  let persistedEntries=0;
  {
    for(const [k,row] of entries) {
      const previous=saved.get(k);
      // Freeze admitted memberships independently of later visibility or picks.
      // Only settlement fields may change for an existing captured quote.
      if(previous)entries.set(k,{...previous,...(result(row.Result)?{
        Result:row.Result,'Result Updated':row['Result Updated'],
        'Actual Away Runs':row['Actual Away Runs'],'Actual Home Runs':row['Actual Home Runs'],
      }:{} )});
    }
    for (const row of existing) if (!entries.has(row['Entry Key']) && row['Definition Version'] === config.version) entries.set(row['Entry Key'], row);
    if (persist) {
      await upsertSportRows(sport,CATALOG_ENTRIES_TAB,CATALOG_ENTRY_HEADERS,[...entries.values()],r=>r['Entry Key']);
      persistedEntries=entries.size;
    }
  }
  const stats=new Map<string,{entries:number,w:number,l:number,p:number,missing:Set<string>,ambiguous:Set<string>}>();
  for(const rule of config.rules)for(let dir=0;dir<2;dir++)stats.set(`${rule.id}|${dir}`,{entries:0,w:0,l:0,p:0,missing:new Set(),ambiguous:new Set()});
  for(const row of entries.values()) {
    let e:CatalogEvaluation;try{e=JSON.parse(row['Catalog Membership JSON']);}catch{continue;}
    const event=catalogEventKey(row,sport);
    for(const m of e.memberships||[]){const s=stats.get(`${m.pair}|${m.direction}`);if(!s)continue;s.entries++;const r=result(row.Result);if(r==='W')s.w++;else if(r==='L')s.l++;else if(r==='P')s.p++;}
    for(const id of e.missing||[])for(let dir=0;dir<2;dir++)stats.get(`${id}|${dir}`)?.missing.add(event);
    for(const id of e.ambiguous||[])for(let dir=0;dir<2;dir++)stats.get(`${id}|${dir}`)?.ambiguous.add(event);
  }
  const definitions=config.rules.flatMap(rule=>rule.names.map((name,dir)=>{
    const s=stats.get(`${rule.id}|${dir}`)!;
    return {'Definition Key':`${config.version}|${rule.id}|${dir}`,'Definition Version':config.version,
      'Pair ID':rule.id,Direction:String(dir),Name:name,Market:rule.market,'Required Data':rule.data,Trigger:rule.trigger,
      Status:s.entries?'TRACKING':s.missing.size?'WAITING_FOR_INPUTS':s.ambiguous.size?'AMBIGUOUS':'NO_MATCHES',
      Entries:String(s.entries),Wins:String(s.w),Losses:String(s.l),Pushes:String(s.p),
      'Missing Input Events':String(s.missing.size),'Ambiguous Events':String(s.ambiguous.size)};
  }));
  if(persist)await upsertSportRows(sport,CATALOG_DEFINITIONS_TAB,DEFINITION_HEADERS,definitions,r=>r['Definition Key']);
  const frozenRows:SheetRow[]=annotatedRows.map(row=>entries.get(entryKey(row,sport)) || row);
  const frozenKeys=new Set(frozenRows.map(row=>entryKey(row,sport)));
  for(const row of entries.values()) if(result(row.Result) && !frozenKeys.has(row['Entry Key'])) {
    frozenRows.push(row);
    frozenKeys.add(row['Entry Key']);
  }
  const frozenPlays=annotatedPlays.map(p=>{const saved=entries.get(entryKey(p,sport));return saved && p.snapshotStatus==='FINAL_PREGAME'?{...p,catalogEvaluation:JSON.parse(saved['Catalog Membership JSON'])}:p;});
  return {rows:frozenRows,plays:frozenPlays,status:{version:config.version,registeredDirections:config.rules.length*2,
    subsetFilters:config.filters.length,combinedDefinitions:config.combinations.length*2,
    trackingDirections:definitions.filter(d=>d.Status==='TRACKING').length,
    waitingForInputs:definitions.filter(d=>d.Status==='WAITING_FOR_INPUTS').length,
    matchedMemberships:[...stats.values()].reduce((n,s)=>n+s.entries,0),
    gradedMemberships:[...stats.values()].reduce((n,s)=>n+s.w+s.l+s.p,0),
    marketEntries:entries.size,persistedEntries,fullCatalogEvaluated:true,publicLimit:20,publicWinPctExclusiveMinimum:60}};
}
