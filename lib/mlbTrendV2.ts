export type AnyRow = Record<string, any>;

export const MLB_TREND_V2_VERSION = "mlb-trend-v2-ridge-2026-09-07";
export const MLB_TREND_V2_LAUNCH_DATE = "2026-09-08";
export const MLB_TREND_V2_NORMAL_GAP = 10;
export const MLB_TREND_V2_EARLY_GAP = 20;
export const MLB_TREND_V2_DECISION_WINDOW_MINUTES = 5.5;
export const MLB_TREND_V2_MAX_FAVORITE_PRICE = -150;

const FEATURES = [
  "implied", "legacy", "gapPct", "publicMovementPct", "sharpMovementPct", "lineMovementValue",
  "sig_BALANCED_PUBLIC_SHARP_SPLIT", "sig_REVERSE_LINE_MOVEMENT_AGAINST",
  "sig_HEAVY_PUBLIC_SHARP_AGREEMENT", "sig_ADVERSE_LINE_MOVEMENT", "sig_STRONG_SHARP_SUPPORT",
  "sig_STRONG_SHARP_REJECTION", "sig_REVERSE_LINE_MOVEMENT_SUPPORT", "sig_SHARP_REJECTION",
  "sig_SHARP_SUPPORT", "sig_LINE_MOVEMENT_CONFIRMATION", "sig_STRONG_REVERSE_LINE_MOVEMENT_AGAINST",
  "sig_STRONG_REVERSE_LINE_MOVEMENT_SUPPORT", "sig_EXTREME_PUBLIC_SHARP_AGREEMENT",
  "dog_rlm_against", "dog_strong_rlm_against", "under_line_confirm",
] as const;

type FeatureName = (typeof FEATURES)[number];
type Market = "Moneyline" | "Total";
type ModelSpec = { median:number[]; mean:number[]; scale:number[]; coef:number[]; intercept:number };

// Ridge-logistic models fit separately by market on frozen MLB trend rows through 2026-09-06.
// The probability is deliberately a ranking diagnostic, not a calibrated win probability.
const MODELS: Record<Market, ModelSpec> = {
  Moneyline: {
    median:[51.359756097560975,48,0,0,0,-2.05,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    mean:[51.43693583138313,46.65681818181818,-0.0022727272727272726,-0.011363636363636364,0,-1.7413636363636364,0.33181818181818185,0.07727272727272727,0.10681818181818181,0.2409090909090909,0.08181818181818182,0.08181818181818182,0.031818181818181815,0.13636363636363635,0.10909090909090909,0.08863636363636364,0.013636363636363636,0.0022727272727272726,0.03409090909090909,0.056818181818181816,0.006818181818181818,0],
    scale:[8.849479150519283,21.960148800283175,14.618092597816828,9.840655833398756,25.40883883433265,1.8934139331678241,0.4708660914029145,0.2670236935040821,0.30888194808249914,0.4276352427319879,0.27408751693966066,0.27408751693966066,0.1755157688755256,0.34317429251230686,0.31175323999058624,0.28421815332185585,0.11597591656520975,0.04761892463581128,0.181462720712174,0.23149487258481097,0.08229030450105308,1],
    coef:[0.5120348820380767,-0.2315823329051125,0.38332118944177207,0.041175191882176276,0.06475947619698952,-0.24974611514100978,-0.1899310906195467,0.15058564905791544,-0.017688891673767693,0.07545756033910335,-0.3181341575332235,0.2585836332123937,-0.23567727608274325,0.17313939460953384,-0.20369389020074274,0.2293447080071685,-0.05499239564129806,0.2706597353013295,0.06570110197989451,0.20508037367760787,0.4250896051584341,0],
    intercept:0.018967403811706245,
  },
  Total: {
    median:[52.4,50,0,0,0,0.5,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    mean:[52.24043520210538,51.392682926829266,-0.007317073170731708,0.004878048780487805,0,0.20658536585365855,0.24146341463414633,0.13170731707317074,0.026829268292682926,0.15121951219512195,0.2097560975609756,0.2097560975609756,0.13170731707317074,0.10975609756097561,0.0951219512195122,0.15365853658536585,0.014634146341463415,0.014634146341463415,0,0,0,0.1],
    scale:[1.786158222751814,20.098402924585244,20.985650036061546,34.19470755811677,43.69723996418772,1.2145381733070344,0.42797059948945637,0.3381722929256003,0.1615842153663599,0.35826271272153243,0.40713447053395774,0.40713447053395774,0.3381722929256003,0.31258550287747067,0.2933833083454219,0.3606211179615105,0.12008325487893826,0.12008325487893826,1,1,1,0.3],
    coef:[0.17910427512164662,-0.3300900396208455,0.09072966628321893,0.36741774013274997,-0.08896345751352537,-0.12470244328748266,-0.04496966887339274,-0.27852897617361333,0.039843554212927394,-0.05153558530457725,-0.09981904986857477,0.07711846266263551,0.20912942291398393,-0.15133151536146827,0.10519811888044302,-0.15018974429379697,-0.30460404434458843,0.2976094006366115,0,0,0,0.24881776016096493],
    intercept:-0.0006699171832363329,
  },
};

function finiteNumber(value:unknown):number|null { if(value===null||value===undefined||value==="")return null; const n=Number(String(value).replace(/%/g,"").trim()); return Number.isFinite(n)?n:null; }
export function parseAmericanOdds(value:unknown):number { const raw=String(value??"").replace(/[−–—]/g,"-").trim(); const match=raw.match(/[+-]\d{3,4}(?!\d)/)?.[0]||raw.match(/^[+-]?\d{3,4}$/)?.[0]; if(!match)return 0; const odds=Number(match); return Number.isFinite(odds)&&Math.abs(odds)>=100?odds:0; }
function impliedFromOdds(value:unknown):number|null { const odds=parseAmericanOdds(value); if(!odds)return null; return odds>0?(100/(odds+100))*100:(Math.abs(odds)/(Math.abs(odds)+100))*100; }
function clamp(v:number,min:number,max:number){return Math.max(min,Math.min(max,v))}
function sigmoid(v:number){ if(v>=0){const z=Math.exp(-v);return 1/(1+z)} const z=Math.exp(v);return z/(1+z) }
function signalKeys(play:AnyRow){return new Set((Array.isArray(play?.signals)?play.signals:[]).map((s:AnyRow)=>String(s?.signalKey||"").trim()).filter(Boolean))}
function sideGroup(play:AnyRow){return String(play?.sideGroup||"").trim()}

function featureMap(play:AnyRow):Record<FeatureName,number|null>{
  const keys=signalKeys(play);
  const implied=finiteNumber(play?.currentImpliedPct)??finiteNumber(play?.impliedPct)??impliedFromOdds(play?.odds);
  const legacy=finiteNumber(play?.score);
  const dog=sideGroup(play)==="Underdog";
  const under=sideGroup(play)==="Under"||String(play?.side||"")==="Under";
  const values:Partial<Record<FeatureName,number|null>>={
    implied, legacy, gapPct:finiteNumber(play?.gapPct), publicMovementPct:finiteNumber(play?.publicMovementPct), sharpMovementPct:finiteNumber(play?.sharpMovementPct), lineMovementValue:finiteNumber(play?.lineMovementValue),
    dog_rlm_against:dog&&keys.has("REVERSE_LINE_MOVEMENT_AGAINST")?1:0,
    dog_strong_rlm_against:dog&&keys.has("STRONG_REVERSE_LINE_MOVEMENT_AGAINST")?1:0,
    under_line_confirm:under&&keys.has("LINE_MOVEMENT_CONFIRMATION")?1:0,
  };
  for(const key of FEATURES){if(key.startsWith("sig_"))values[key]=keys.has(key.slice(4))?1:0}
  return values as Record<FeatureName,number|null>;
}
function isCoreDataComplete(play:AnyRow,f:Record<FeatureName,number|null>){const core:FeatureName[]=["implied","legacy","gapPct","publicMovementPct","sharpMovementPct"]; return core.every(k=>f[k]!==null&&Number.isFinite(f[k] as number))&&Number(f.legacy||0)>0&&Array.isArray(play?.signals)&&play.signals.length>0&&parseAmericanOdds(play?.odds)!==0}
function predict(play:AnyRow,market:Market){const spec=MODELS[market];const map=featureMap(play);let linear=spec.intercept;FEATURES.forEach((name,i)=>{const raw=map[name];const value=raw===null||!Number.isFinite(raw)?spec.median[i]:raw;linear+=spec.coef[i]*((value-spec.mean[i])/(spec.scale[i]||1))});const probability=sigmoid(linear);const implied=map.implied??impliedFromOdds(play?.odds)??50;return{probability,marketGap:probability*100-implied,implied,dataComplete:isCoreDataComplete(play,map)}}
function v2StrengthScore(gap:number){if(!Number.isFinite(gap))return 0;if(gap<5)return Math.round(clamp(50+gap*2,0,59));if(gap<10)return Math.round(clamp(60+(gap-5)*1.8,60,68));if(gap<20)return Math.round(clamp(69+(gap-10)*1.6,69,84));return Math.round(clamp(85+(gap-20)*0.75,85,100))}
function tierFor(score:number,winner:boolean,eligible:boolean){if(!winner||!eligible||score<60)return"Pass";if(score>=85)return"Elite";if(score>=69)return"Strong";return"Good"}
function normalizeTeam(v:unknown){return String(v||"").toLowerCase().replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim()}
function rowGameKey(play:AnyRow,slate:AnyRow[]){const direct=String(play?.recordGameKey||play?.gameKey||"").trim().replace(/\.0$/,"");if(direct)return direct;const away=normalizeTeam(play?.awayTeam),home=normalizeTeam(play?.homeTeam);const row=slate.find(r=>normalizeTeam(r?.["Away Team"]||r?.awayTeam)===away&&normalizeTeam(r?.["Home Team"]||r?.homeTeam)===home);return String(row?.["Game Key"]||row?.gameKey||"").trim().replace(/\.0$/,"")}
function gameTimeFor(play:AnyRow,slate:AnyRow[]){if(play?.recordGameTime)return String(play.recordGameTime);const key=rowGameKey(play,slate);const row=slate.find(r=>String(r?.["Game Key"]||"").trim().replace(/\.0$/,"")===key);return String(row?.["Game Time"]||row?.["Game Time ET"]||row?.gameTime||"")}
function easternOffsetMs(atMs:number){const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(new Date(atMs));const read=(type:string)=>Number(parts.find(p=>p.type===type)?.value||0);const renderedAsUtc=Date.UTC(read("year"),read("month")-1,read("day"),read("hour"),read("minute"),read("second"));return renderedAsUtc-Math.floor(atMs/1000)*1000}
function easternWallClockToMs(year:number,month:number,day:number,hour:number,minute:number,second=0){const wallAsUtc=Date.UTC(year,month-1,day,hour,minute,second);let utc=wallAsUtc;for(let i=0;i<3;i++){const next=wallAsUtc-easternOffsetMs(utc);if(Math.abs(next-utc)<1000)return next;utc=next}return utc}
export function parseGameStart(dateValue:unknown,timeValue:unknown):number|null {
  const t=String(timeValue||"").trim();
  if(!t)return null;
  if(/^\d{4}-\d{2}-\d{2}[T ]/i.test(t)||/[zZ]$/.test(t)||/[+-]\d{2}:?\d{2}$/.test(t)){const direct=Date.parse(t);if(Number.isFinite(direct))return direct}
  const d=String(dateValue||"").trim();if(!d)return null;
  const dm=d.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)||d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  let year=0,month=0,day=0;
  if(dm&&dm[1]?.length===4){year=Number(dm[1]);month=Number(dm[2]);day=Number(dm[3])}
  else if(dm){month=Number(dm[1]);day=Number(dm[2]);year=Number(dm[3])}
  else {const parsed=Date.parse(d);if(!Number.isFinite(parsed))return null;const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(parsed));const read=(type:string)=>Number(parts.find(p=>p.type===type)?.value||0);year=read("year");month=read("month");day=read("day")}
  const tm=t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?(?:\s*(?:ET|EST|EDT))?$/i);if(!tm)return null;
  let hour=Number(tm[1]);const minute=Number(tm[2]),second=Number(tm[3]||0),meridiem=String(tm[4]||"").toUpperCase();
  if(meridiem){if(hour<1||hour>12)return null;if(meridiem==="AM"&&hour===12)hour=0;if(meridiem==="PM"&&hour!==12)hour+=12}else if(hour>23)return null;
  if(month<1||month>12||day<1||day>31||minute>59||second>59)return null;
  return easternWallClockToMs(year,month,day,hour,minute,second);
}
function pairKey(play:AnyRow,slate:AnyRow[]){const key=rowGameKey(play,slate)||`${normalizeTeam(play?.awayTeam)}|${normalizeTeam(play?.homeTeam)}`;return`${key}|${String(play?.market||"")}`}

export type V2TrendPlay=AnyRow&{legacyScore:number;legacyTier:string;v2Score:number;v2Tier:string;v2Probability:number;v2MarketGap:number;v2ImpliedProbability:number;v2DataComplete:boolean;v2Direction:boolean;v2LegacyAgreement:boolean;v2DailyEligible:boolean;v2DailyRank:number|null;v2GameKey:string;v2GameTime:string;v2ModelVersion:string};

export function scoreTrendBoardV2(trendPlays:AnyRow[],slateRows:AnyRow[]):V2TrendPlay[]{
  const initial=trendPlays.filter(p=>p?.market==="Moneyline"||p?.market==="Total").map(play=>{const market=play.market as Market;const legacyScore=Number(play?.score||0),legacyTier=String(play?.tier||"Pass"),result=predict(play,market),odds=parseAmericanOdds(play?.odds);return{...play,legacyScore,legacyTier,v2Probability:result.probability*100,v2MarketGap:result.marketGap,v2ImpliedProbability:result.implied,v2DataComplete:result.dataComplete,v2Direction:false,v2LegacyAgreement:false,v2DailyEligible:false,v2DailyRank:null,v2GameKey:rowGameKey(play,slateRows),v2GameTime:gameTimeFor(play,slateRows),v2ModelVersion:MLB_TREND_V2_VERSION,v2PlayablePrice:odds>0||odds>=MLB_TREND_V2_MAX_FAVORITE_PRICE} as AnyRow});
  const groups=new Map<string,AnyRow[]>();for(const play of initial){const key=pairKey(play,slateRows),group=groups.get(key)||[];group.push(play);groups.set(key,group)}
  const resolved:V2TrendPlay[]=[];
  for(const group of groups.values()){
    const directionWinner=[...group].sort((a,b)=>Number(b.v2MarketGap)-Number(a.v2MarketGap)||Number(b.v2Probability)-Number(a.v2Probability))[0];
    const legacyWinner=[...group].sort((a,b)=>Number(b.legacyScore)-Number(a.legacyScore))[0];
    for(const play of group){const winner=Boolean(directionWinner&&play===directionWinner&&group.length>=2);const agreement=Boolean(winner&&legacyWinner&&play===legacyWinner);const market=play.market as Market;const directionEligible=winner&&play.v2DataComplete&&play.v2PlayablePrice&&(market==="Total"||agreement);const rawScore=v2StrengthScore(Number(play.v2MarketGap));const finalScore=winner?rawScore:Math.min(59,rawScore);const v2Tier=tierFor(finalScore,winner,directionEligible);resolved.push({...play,score:finalScore,tier:v2Tier,v2Score:finalScore,v2Tier,v2Direction:winner,v2LegacyAgreement:agreement,v2DailyEligible:directionEligible} as unknown as V2TrendPlay)}
  }
  const ranked=resolved.filter(p=>p.v2Direction&&p.v2DailyEligible).sort((a,b)=>b.v2MarketGap-a.v2MarketGap);const rank=new Map(ranked.map((p,i)=>[`${p.v2GameKey}|${p.market}`,i+1]));return resolved.map(p=>({...p,v2DailyRank:p.v2Direction?rank.get(`${p.v2GameKey}|${p.market}`)||null:null}));
}

export type DailyLockDecision={play:V2TrendPlay;threshold:number;earlyPremium:boolean;minutesToStart:number};
export function chooseDailyTrendLock(scored:V2TrendPlay[],slateRows:AnyRow[],nowMs=Date.now()):DailyLockDecision|null{
  const slateStarts=slateRows.map(r=>({key:String(r?.["Game Key"]||"").trim().replace(/\.0$/,""),start:parseGameStart(r?.Date,r?.["Game Time"]||r?.["Game Time ET"])})).filter(x=>x.start!==null) as Array<{key:string;start:number}>;
  const candidates=scored.filter(p=>p.v2Direction&&p.v2DailyEligible).map(play=>{const start=parseGameStart(play.recordDate||play.Date,play.v2GameTime);const minutes=start==null?null:(start-nowMs)/60000;if(start==null||minutes==null||minutes<=0||minutes>MLB_TREND_V2_DECISION_WINDOW_MINUTES)return null;const later=slateStarts.some(x=>x.start>start+60000);const threshold=later?MLB_TREND_V2_EARLY_GAP:MLB_TREND_V2_NORMAL_GAP;if(play.v2MarketGap<threshold)return null;return{play,threshold,earlyPremium:later,minutesToStart:minutes}}).filter((x):x is DailyLockDecision=>Boolean(x)).sort((a,b)=>b.play.v2MarketGap-a.play.v2MarketGap);return candidates[0]||null;
}

export function isoDate(value:unknown){const raw=String(value||"").trim();const iso=raw.match(/^(\d{4})-(\d{2})-(\d{2})/);if(iso)return`${iso[1]}-${iso[2]}-${iso[3]}`;const slash=raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);if(slash)return`${slash[3]}-${String(Number(slash[1])).padStart(2,"0")}-${String(Number(slash[2])).padStart(2,"0")}`;const dt=new Date(raw);if(Number.isNaN(dt.getTime()))return raw;const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(dt);const get=(type:string)=>parts.find(p=>p.type===type)?.value||"";return`${get("year")}-${get("month")}-${get("day")}`}
export function nowET(){return new Date().toLocaleString("en-US",{timeZone:"America/New_York",month:"2-digit",day:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:true})}
export function resultProfit(result:string,oddsValue:unknown){const code=String(result||"").trim().toUpperCase();if(code==="P"||code.includes("PUSH"))return 0;if(code==="L"||code.includes("LOSS"))return-1;if(!(code==="W"||code.includes("WIN")))return 0;const odds=parseAmericanOdds(oddsValue);if(odds>0)return odds/100;if(odds<0)return 100/Math.abs(odds);return 1}
