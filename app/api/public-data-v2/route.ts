import { NextRequest, NextResponse } from "next/server";
import { GET as legacyGET } from "../public-data/route";
import {
  AnyRow, DailyLockDecision, MLB_TREND_V2_DECISION_WINDOW_MINUTES,
  MLB_TREND_V2_EARLY_GAP, MLB_TREND_V2_LAUNCH_DATE, MLB_TREND_V2_MAX_DAILY_PICKS,
  MLB_TREND_V2_NORMAL_GAP, MLB_TREND_V2_VERSION, V2TrendPlay,
  chooseDailyTrendLock, isoDate, nowET, parseGameStart, resultProfit,
  scoreTrendBoardV2, slateThresholdForStart,
} from "../../../lib/mlbTrendV2";
import { appendV2Rows, readV2Tab, replaceV2DailyRows } from "../../../lib/mlbTrendV2Store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function truthy(value:unknown){return["1","true","yes","y"].includes(String(value||"").trim().toLowerCase())}
function isV2ScheduledCapture(request:NextRequest){return request.nextUrl.searchParams.get("tracking")==="v2"||request.headers.get("x-ezpz-v2-tracking")==="true"||truthy(request.nextUrl.searchParams.get("scheduled"))}
function pureLegacyTrendPick(pick:AnyRow){return String(pick?.source||"")==="Trend Play"&&!String(pick?.bestPlayType||"").trim()&&String(pick?.selectorVersion||"")!==MLB_TREND_V2_VERSION}
function isLaunchOrLater(value:unknown){const date=isoDate(value);return Boolean(date&&date>=MLB_TREND_V2_LAUNCH_DATE)}
function round(value:number,digits=1){const power=10**digits;return Math.round(value*power)/power}
function candidateKey(play:V2TrendPlay){return`${isoDate(play.recordDate||play.Date)}|${play.v2GameKey}|${play.market}`}

function snapshotRow(play:V2TrendPlay,nowMs:number):AnyRow{
  const start=parseGameStart(play.recordDate||play.Date,play.v2GameTime);
  const minutes=start==null?"":round((start-nowMs)/60000,1);
  const selection=play.market==="Moneyline"?String(play.selectionTeam||play.selection||""):String(play.side||"");
  return{"Snapshot Time ET":nowET(),Date:isoDate(play.recordDate||play.Date),"Game Key":play.v2GameKey,"Game Time":play.v2GameTime,Game:play.game,"Away Team":play.awayTeam,"Home Team":play.homeTeam,Market:play.market,Selection:selection,Side:play.side||"",Line:play.line??"",Odds:play.odds||"","V2 Score":round(play.v2Score,1),"V2 Tier":play.v2Tier,"V2 Market Gap":round(play.v2MarketGap,2),"V2 Ranking Probability":round(play.v2Probability,2),"Market Implied Probability":round(play.v2ImpliedProbability,2),"V2 Daily Rank":play.v2DailyRank??"","V2 Data Complete":play.v2DataComplete?"TRUE":"FALSE","V2 Direction":play.v2Direction?"TRUE":"FALSE","V2/Legacy Agreement":play.v2LegacyAgreement?"TRUE":"FALSE","Legacy Trend Score":round(play.legacyScore,1),"Legacy Trend Tier":play.legacyTier,"Minutes To Start":minutes,"Daily Eligible":play.v2DailyEligible?"TRUE":"FALSE","Model Version":MLB_TREND_V2_VERSION,"Details JSON":JSON.stringify({...play,snapshotEpoch:nowMs})};
}
function lastSnapshotEpoch(row:AnyRow){try{const details=JSON.parse(String(row?.["Details JSON"]||"{}"));const epoch=Number(details?.snapshotEpoch||0);if(Number.isFinite(epoch)&&epoch>0)return epoch}catch{}const parsed=Date.parse(String(row?.["Snapshot Time ET"]||""));return Number.isFinite(parsed)?parsed:0}
function snapshotRowsToAppend(scored:V2TrendPlay[],existing:AnyRow[],nowMs:number){const latest=new Map<string,number>();for(const row of existing){const key=`${isoDate(row.Date)}|${String(row["Game Key"]||"")}|${String(row.Market||"")}`;latest.set(key,Math.max(latest.get(key)||0,lastSnapshotEpoch(row)))}return scored.filter(play=>play.v2Direction).filter(play=>{const start=parseGameStart(play.recordDate||play.Date,play.v2GameTime);return start==null||start>nowMs}).filter(play=>{const last=latest.get(candidateKey(play))||0;const start=parseGameStart(play.recordDate||play.Date,play.v2GameTime);const minutes=start==null?null:(start-nowMs)/60000;const decisionWindow=minutes!=null&&minutes>0&&minutes<=MLB_TREND_V2_DECISION_WINDOW_MINUTES;return decisionWindow||!last||nowMs-last>=14*60000}).map(play=>snapshotRow(play,nowMs))}

function annotateLiveV2Status(scored:V2TrendPlay[],slateRows:AnyRow[],nowMs:number):V2TrendPlay[]{
  return scored.map(play=>{
    const start=parseGameStart(play.recordDate||play.Date,play.v2GameTime);
    const minutesToStart=start==null?null:(start-nowMs)/60000;
    const thresholdInfo=start==null?null:slateThresholdForStart(start,slateRows);
    const requiredGap=thresholdInfo?.threshold??null;
    const gapNeeded=requiredGap==null?null:Math.max(0,requiredGap-Number(play.v2MarketGap||0));
    const decisionWindowOpen=minutesToStart!=null&&minutesToStart>0&&minutesToStart<=MLB_TREND_V2_DECISION_WINDOW_MINUTES;
    const thresholdCleared=requiredGap!=null&&Number(play.v2MarketGap)>=requiredGap;
    let decisionStatus="";
    if(!play.v2Direction)decisionStatus="Not V2 direction";
    else if(!play.v2DailyEligible)decisionStatus="Blocked by guardrail";
    else if(minutesToStart==null)decisionStatus="Decision time unavailable";
    else if(minutesToStart<=0)decisionStatus="Game started";
    else if(!decisionWindowOpen)decisionStatus=`Waiting for T-${MLB_TREND_V2_DECISION_WINDOW_MINUTES} min`;
    else if(thresholdCleared)decisionStatus="OPEN • threshold cleared";
    else decisionStatus="OPEN • below threshold";
    return{...play,v2RequiredGap:requiredGap,v2GapNeeded:gapNeeded,v2MinutesToStart:minutesToStart,v2EarlyPremium:thresholdInfo?.earlyPremium??null,v2SlatePhase:thresholdInfo?.phase??null,v2SlateBlockIndex:thresholdInfo?.blockIndex??null,v2SlateBlockCount:thresholdInfo?.blockCount??null,v2DecisionWindowOpen:decisionWindowOpen,v2ThresholdCleared:thresholdCleared,v2DecisionStatus:decisionStatus} as V2TrendPlay;
  });
}

function dailyPickObject(decision:DailyLockDecision,today:string,nowMs:number):AnyRow{
  const play=decision.play;
  const selection=play.market==="Moneyline"?String(play.selectionTeam||play.selection||""):String(play.side||"");
  const line=play.market==="Total"&&play.line!=null?String(play.line):"";
  const playLabel=play.market==="Moneyline"?`${selection} Moneyline`:`${selection} ${line}`.trim();
  const candidateId=["v2",isoDate(today),play.v2GameKey,String(play.market).toLowerCase(),selection.toLowerCase().replace(/[^a-z0-9]+/g,"-"),line].join("|");
  const rule=decision.earlyPremium?`Early-half slate premium cleared: V2 Market Gap ${play.v2MarketGap.toFixed(1)} >= ${decision.threshold.toFixed(0)}`:`Back-half normal threshold cleared: V2 Market Gap ${play.v2MarketGap.toFixed(1)} >= ${decision.threshold.toFixed(0)}`;
  const marketGuard=play.market==="Moneyline"?"Moneyline guardrail passed: complete v2 inputs and v2/legacy direction agreement":"Totals guardrail passed: v2 direction is primary; legacy total direction is diagnostic only";
  return{candidateId,date:isoDate(today),gameKey:play.v2GameKey,gameTime:play.v2GameTime,game:play.game,awayTeam:play.awayTeam,homeTeam:play.homeTeam,market:play.market,play:playLabel,selection,line,odds:String(play.odds||""),source:"Trend Play",bestPlayType:"",trendTier:play.v2Tier,modelScore:0,trendScore:play.v2Score,aiScore:play.v2Score,estimatedProbability:round(play.v2Probability,1),marketImpliedProbability:round(play.v2ImpliedProbability,1),estimatedAdvantage:round(play.v2MarketGap,1),selected:true,protectionStatus:"PASSED",rejectionReason:"",confidenceReason:[`MLB Trend v2 daily rank #${play.v2DailyRank||1} at its lock window`,rule],whySelected:[rule,marketGuard,`Maximum ${MLB_TREND_V2_MAX_DAILY_PICKS} Trend v2 EZPZ Picks are allowed per MLB date`],historicalNotes:[`Legacy trend: ${play.legacyTier} ${play.legacyScore.toFixed(0)}`,"V2 ranking probability is not treated as a calibrated win probability"],risks:[],researchSummary:"",verdict:`FINAL MLB Trend v2 daily pick — ${playLabel}`,dataStatus:[`Trend v2 model ${MLB_TREND_V2_VERSION}`,`V2 Market Gap ${play.v2MarketGap.toFixed(1)}`,play.market==="Moneyline"?`V2/legacy agreement: ${play.v2LegacyAgreement?"YES":"NO"}`:`Legacy total agreement: ${play.v2LegacyAgreement?"YES":"NO (allowed for totals)"}`,`Locked ${decision.minutesToStart.toFixed(1)} minutes before scheduled start`],externalReviewStatus:"NOT_REQUIRED",snapshotStatus:"FINAL_PREGAME",lockedAt:nowET(),updatedAt:nowET(),result:"",units:0,resultUpdated:"",selectorVersion:MLB_TREND_V2_VERSION,v2EarlyPremium:decision.earlyPremium,v2RequiredGap:decision.threshold,v2DailyRank:play.v2DailyRank||1,v2LegacyScore:play.legacyScore,v2LegacyTier:play.legacyTier,v2LegacyAgreement:play.v2LegacyAgreement,v2DataComplete:play.v2DataComplete,v2MarketGap:play.v2MarketGap,v2Probability:play.v2Probability,v2LockedEpoch:nowMs};
}
function dailyPickRow(pick:AnyRow):AnyRow{return{Date:pick.date,"Candidate ID":pick.candidateId,"Game Key":pick.gameKey,"Game Time":pick.gameTime,Game:pick.game,"Away Team":pick.awayTeam,"Home Team":pick.homeTeam,Market:pick.market,Play:pick.play,Selection:pick.selection,Line:pick.line,Odds:pick.odds,"V2 Score":pick.trendScore,"V2 Tier":pick.trendTier,"V2 Market Gap":pick.v2MarketGap,"V2 Ranking Probability":pick.v2Probability,"Market Implied Probability":pick.marketImpliedProbability,"Legacy Trend Score":pick.v2LegacyScore,"Legacy Trend Tier":pick.v2LegacyTier,"V2/Legacy Agreement":pick.v2LegacyAgreement?"TRUE":"FALSE","V2 Data Complete":pick.v2DataComplete?"TRUE":"FALSE","Daily Rank":pick.v2DailyRank,"Early Premium":pick.v2EarlyPremium?"TRUE":"FALSE","Required Gap":pick.v2RequiredGap,"Locked At":pick.lockedAt,Result:pick.result||"",Units:String(pick.units??0),"Result Updated":pick.resultUpdated||"","Model Version":MLB_TREND_V2_VERSION,"Details JSON":JSON.stringify(pick)}}
function parseDailyPickRow(row:AnyRow):AnyRow|null{try{const raw=String(row?.["Details JSON"]||"").trim();if(raw){const parsed=JSON.parse(raw);if(parsed?.candidateId)return{...parsed,result:String(row.Result||parsed.result||""),units:Number(row.Units||parsed.units||0),resultUpdated:String(row["Result Updated"]||parsed.resultUpdated||"")}}}catch{}const candidateId=String(row?.["Candidate ID"]||"").trim();if(!candidateId)return null;return{candidateId,date:isoDate(row.Date),gameKey:String(row["Game Key"]||""),gameTime:String(row["Game Time"]||""),game:String(row.Game||""),awayTeam:String(row["Away Team"]||""),homeTeam:String(row["Home Team"]||""),market:String(row.Market||""),play:String(row.Play||""),selection:String(row.Selection||""),line:String(row.Line||""),odds:String(row.Odds||""),source:"Trend Play",bestPlayType:"",trendTier:String(row["V2 Tier"]||""),modelScore:0,trendScore:Number(row["V2 Score"]||0),aiScore:Number(row["V2 Score"]||0),estimatedProbability:Number(row["V2 Ranking Probability"]||0),marketImpliedProbability:Number(row["Market Implied Probability"]||0),estimatedAdvantage:Number(row["V2 Market Gap"]||0),selected:true,protectionStatus:"PASSED",rejectionReason:"",confidenceReason:[],whySelected:[],historicalNotes:[],risks:[],researchSummary:"",verdict:`FINAL MLB Trend v2 daily pick — ${String(row.Play||"")}`,dataStatus:[`Trend v2 model ${MLB_TREND_V2_VERSION}`],externalReviewStatus:"NOT_REQUIRED",snapshotStatus:"FINAL_PREGAME",lockedAt:String(row["Locked At"]||""),updatedAt:String(row["Locked At"]||""),result:String(row.Result||""),units:Number(row.Units||0),resultUpdated:String(row["Result Updated"]||""),selectorVersion:MLB_TREND_V2_VERSION}}
function normalize(value:unknown){return String(value||"").toLowerCase().replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim()}
function gradeDailyPick(pick:AnyRow,records:AnyRow[]):AnyRow{const record=records.find(row=>{if(isoDate(row?.date||row?.Date)!==isoDate(pick.date))return false;if(String(row?.market||row?.Market)!==String(pick.market))return false;const pk=String(pick.gameKey||"").replace(/\.0$/,"");const rk=String(row?.gameKey||row?.["Game Key"]||"").replace(/\.0$/,"");if(pk&&rk&&pk!==rk)return false;if(pick.market==="Total")return normalize(row.selection||row.Selection).startsWith(normalize(pick.selection));const rs=normalize(row.selection||row.Selection),ps=normalize(pick.selection);return rs===ps||rs.includes(ps)||ps.includes(rs)});if(!record||!String(record.result||record.Result||"").trim())return pick;const raw=String(record.result||record.Result||"").trim().toUpperCase();const result=raw.startsWith("W")?"W":raw.startsWith("L")?"L":raw.startsWith("P")?"P":"";if(!result)return pick;const units=Number.isFinite(Number(record.units))?Number(record.units):resultProfit(result,pick.odds);if(pick.result===result&&Number(pick.units||0)===units)return pick;return{...pick,result,units:round(units,2),resultUpdated:nowET(),updatedAt:nowET()}}

async function postProcessMlbPayload(request:NextRequest,payload:AnyRow){
  const today=isoDate(payload.today||new Date()),nowMs=Date.now();
  const slateRows=Array.isArray(payload.slateToday)?payload.slateToday:[];
  const scored=annotateLiveV2Status(scoreTrendBoardV2(Array.isArray(payload.trendPlays)?payload.trendPlays:[],slateRows),slateRows,nowMs);
  payload.trendPlays=scored;
  payload.trendV2={version:MLB_TREND_V2_VERSION,launchDate:MLB_TREND_V2_LAUNCH_DATE,normalGap:MLB_TREND_V2_NORMAL_GAP,earlyGap:MLB_TREND_V2_EARLY_GAP,maxDailyPicks:MLB_TREND_V2_MAX_DAILY_PICKS,decisionWindowMinutes:MLB_TREND_V2_DECISION_WINDOW_MINUTES,thresholdRule:"20% for the first half of unique game-start blocks; 15% from the midpoint through the final block",note:"V2 Ranking Probability and Market Gap are ranking diagnostics, not calibrated win probabilities."};

  let snapshotRows:AnyRow[]=[],dailyRows:AnyRow[]=[];
  try{[snapshotRows,dailyRows]=await Promise.all([readV2Tab("snapshots"),readV2Tab("daily")])}catch(error){console.error("Trend v2 history read failed; serving live v2 scores without persistence",error)}
  if(isV2ScheduledCapture(request)&&today>=MLB_TREND_V2_LAUNCH_DATE){try{const append=snapshotRowsToAppend(scored,snapshotRows,nowMs);if(append.length){await appendV2Rows("snapshots",append);snapshotRows=[...snapshotRows,...append]}}catch(error){console.error("Trend v2 snapshot append failed",error)}}

  let dailyPicks=dailyRows.map(parseDailyPickRow).filter((pick):pick is AnyRow=>Boolean(pick));
  let todayLocks=dailyPicks.filter(pick=>isoDate(pick.date)===today);
  if(isV2ScheduledCapture(request)&&today>=MLB_TREND_V2_LAUNCH_DATE&&todayLocks.length<MLB_TREND_V2_MAX_DAILY_PICKS){
    const lockedPairs=new Set(todayLocks.map(pick=>`${String(pick.gameKey||"").trim().replace(/\.0$/,"")}|${String(pick.market||"")}`));
    let available=scored.filter(play=>!lockedPairs.has(`${play.v2GameKey}|${play.market}`));
    const newLocks:AnyRow[]=[];
    while(todayLocks.length+newLocks.length<MLB_TREND_V2_MAX_DAILY_PICKS){
      const decision=chooseDailyTrendLock(available,slateRows,nowMs);
      if(!decision)break;
      const lock=dailyPickObject(decision,today,nowMs);
      newLocks.push(lock);
      const pair=`${decision.play.v2GameKey}|${decision.play.market}`;
      lockedPairs.add(pair);
      available=available.filter(play=>`${play.v2GameKey}|${play.market}`!==pair);
    }
    if(newLocks.length){
      try{await appendV2Rows("daily",newLocks.map(dailyPickRow));dailyPicks.push(...newLocks);todayLocks.push(...newLocks)}
      catch(error){console.error("Trend v2 daily lock persistence failed",error)}
    }
  }

  const graded=dailyPicks.map(pick=>gradeDailyPick(pick,Array.isArray(payload.trendRecordRows)?payload.trendRecordRows:[]));
  const gradeChanged=graded.some((pick,index)=>{const before=dailyPicks[index];return Boolean(before&&(before.result!==pick.result||Number(before.units||0)!==Number(pick.units||0)))});
  if(gradeChanged){dailyPicks=graded;try{await replaceV2DailyRows(dailyPicks.map(dailyPickRow))}catch(error){console.error("Trend v2 daily grading persistence failed",error)}}else dailyPicks=graded;
  todayLocks=dailyPicks.filter(pick=>isoDate(pick.date)===today);

  const legacyAiPicks=Array.isArray(payload.aiPicks)?payload.aiPicks:[];
  const filteredAiPicks=legacyAiPicks.filter((pick:AnyRow)=>!(isLaunchOrLater(pick?.date||today)&&pureLegacyTrendPick(pick)));
  for(const lock of todayLocks)filteredAiPicks.push(lock);
  payload.aiPicks=filteredAiPicks;
  const legacyRecordRows=Array.isArray(payload.aiPickRecordRows)?payload.aiPickRecordRows:[];
  const filteredRecordRows=legacyRecordRows.filter((pick:AnyRow)=>!(isLaunchOrLater(pick?.date||pick?.Date)&&pureLegacyTrendPick(pick)));
  payload.aiPickRecordRows=[...filteredRecordRows,...dailyPicks];

  const status=payload.aiSelectorStatus||{};
  const finalCount=filteredAiPicks.filter((pick:AnyRow)=>pick?.snapshotStatus==="FINAL_PREGAME").length;
  const lockedCount=todayLocks.length;
  const lockedNames=todayLocks.map(pick=>pick.play).filter(Boolean).join("; ");
  const remaining=Math.max(0,MLB_TREND_V2_MAX_DAILY_PICKS-lockedCount);
  const trendMessage=lockedCount>=MLB_TREND_V2_MAX_DAILY_PICKS
    ? `MLB Trend v2 daily max reached (${lockedCount}/${MLB_TREND_V2_MAX_DAILY_PICKS}): ${lockedNames}.`
    : lockedCount>0
      ? `MLB Trend v2 ${lockedCount}/${MLB_TREND_V2_MAX_DAILY_PICKS} locked: ${lockedNames}. ${remaining} slot${remaining===1?"":"s"} remain; another play must independently clear its threshold.`
      : filteredAiPicks.length
        ? `HOT Best Plays are final; MLB Trend v2 is ranking the slate for up to ${MLB_TREND_V2_MAX_DAILY_PICKS} daily trend picks.`
        : `MLB Trend v2 is ranking the slate. Up to ${MLB_TREND_V2_MAX_DAILY_PICKS} daily trend picks may lock, but none are forced.`;
  payload.aiSelectorStatus={...status,mode:finalCount===filteredAiPicks.length&&filteredAiPicks.length?"FINAL_PREGAME":"LIVE_PREVIEW",message:trendMessage,updatedAt:nowET(),candidateCount:Number(status.candidateCount||0)+scored.filter(play=>play.v2Direction).length,selectedCount:filteredAiPicks.length,trendV2DailyLocked:Boolean(lockedCount),trendV2DailyLockedCount:lockedCount,trendV2DailyMaxPicks:MLB_TREND_V2_MAX_DAILY_PICKS};
  return payload;
}

export async function GET(request:NextRequest){
  const sport=String(request.nextUrl.searchParams.get("sport")||"MLB").trim().toUpperCase();if(sport==="NFL"||sport==="NCAAF")return legacyGET(request);
  const legacyResponse=await legacyGET(request);const contentType=legacyResponse.headers.get("content-type")||"";if(!contentType.includes("application/json"))return legacyResponse;
  let payload:AnyRow;try{payload=await legacyResponse.json()}catch{return legacyResponse}if(!payload?.ok)return NextResponse.json(payload,{status:legacyResponse.status,headers:{"Cache-Control":"no-store, max-age=0"}});
  try{payload=await postProcessMlbPayload(request,payload)}catch(error){console.error("MLB Trend v2 wrapper failed; returning legacy response",error);payload.trendV2Error=error instanceof Error?error.message:String(error)}
  return NextResponse.json(payload,{status:legacyResponse.status,headers:{"Cache-Control":"no-store, max-age=0"}});
}
