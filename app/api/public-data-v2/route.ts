import { NextRequest, NextResponse } from "next/server";
import { GET as legacyGET } from "../public-data/route";
import {
  AnyRow, DailyLockDecision, MLB_TREND_V2_DECISION_WINDOW_MINUTES,
  MLB_TREND_V2_LAUNCH_DATE,
  MLB_TREND_V2_NORMAL_GAP, MLB_TREND_V2_SELECTION_POLICY,
  MLB_TREND_V2_VERSION, V2TrendPlay,
  applyMlbTrendV2SelectionGate, isoDate,
  mlbTrendV2RlmStatus, mlbTrendV2SelectionGate, nowET, parseGameStart, resultProfit,
  scoreTrendBoardV2, selectionThresholdForPlay,
} from "../../../lib/mlbTrendV2";
import { appendV2Rows, readV2Tab, replaceV2DailyRows } from "../../../lib/mlbTrendV2Store";
import { applyMlbTrendV2Adaptive } from "../../../lib/mlbTrendV2Lifecycle";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function truthy(value:unknown){return["1","true","yes","y"].includes(String(value||"").trim().toLowerCase())}
function isV2ScheduledCapture(request:NextRequest){return request.nextUrl.searchParams.get("tracking")==="v2"||request.headers.get("x-ezpz-v2-tracking")==="true"||truthy(request.nextUrl.searchParams.get("scheduled"))}
function pureLegacyTrendPick(pick:AnyRow){return String(pick?.source||"")==="Trend Play"&&!String(pick?.bestPlayType||"").trim()&&String(pick?.selectorVersion||"")!==MLB_TREND_V2_VERSION}
function isLaunchOrLater(value:unknown){const date=isoDate(value);return Boolean(date&&date>=MLB_TREND_V2_LAUNCH_DATE)}
function round(value:number,digits=1){const power=10**digits;return Math.round(value*power)/power}
function candidateKey(play:V2TrendPlay){return`${isoDate(play.recordDate||play.Date)}|${play.v2GameKey}|${play.market}`}
function cleanGameKey(value:unknown){return String(value||"").trim().replace(/\.0$/,"")}
function v2GameIdentity(value:AnyRow){const direct=cleanGameKey(value?.v2GameKey||value?.gameKey||value?.["Game Key"]);if(direct)return direct;const away=normalize(value?.awayTeam||value?.["Away Team"]),home=normalize(value?.homeTeam||value?.["Home Team"]);return away&&home?`${away}|${home}`:normalize(value?.game||value?.Game)}
function canonicalLine(value:unknown){const raw=String(value??"").trim();if(!raw)return"";const numeric=Number(raw);return Number.isFinite(numeric)?String(numeric):normalize(raw)}
function v2Selection(value:AnyRow){return String(value?.market||value?.Market)==="Moneyline"?normalize(value?.selectionTeam||value?.selection||value?.Selection):normalize(value?.side||value?.selection||value?.Selection)}
function v2CandidateIdentity(value:AnyRow){const market=String(value?.market||value?.Market||"");return[isoDate(value?.recordDate||value?.date||value?.Date),v2GameIdentity(value),market,v2Selection(value),market==="Total"?canonicalLine(value?.line??value?.Line):""].join("|")}
function sameV2Candidate(pick:AnyRow,play:V2TrendPlay){return v2GameIdentity(pick)===v2GameIdentity(play)&&String(pick?.market||pick?.Market)===String(play.market)&&v2Selection(pick)===v2Selection(play)&&(String(play.market)!=="Total"||canonicalLine(pick?.line??pick?.Line)===canonicalLine(play.line))}
function currentQualifierByGame(scored:V2TrendPlay[],slateRows:AnyRow[]){
  const best=new Map<string,V2TrendPlay>();
  for(const play of scored){
    if(!play.v2Direction||!play.v2DailyEligible)continue;
    const gameKey=v2GameIdentity(play),start=parseGameStart(play.recordDate||play.Date,play.v2GameTime);
    if(!gameKey||start==null)continue;
    const threshold=selectionThresholdForPlay(play,start,slateRows).threshold;
    if(!Number.isFinite(Number(play.v2MarketGap))||Number(play.v2MarketGap)<threshold)continue;
    const previous=best.get(gameKey);
    if(!previous||Number(play.v2MarketGap)>Number(previous.v2MarketGap)||(Number(play.v2MarketGap)===Number(previous.v2MarketGap)&&Number(play.v2Probability)>Number(previous.v2Probability)))best.set(gameKey,play);
  }
  return best;
}
function latestSnapshotByGameMarket(snapshotRows:AnyRow[],today:string){
  const latest=new Map<string,AnyRow>();
  for(const row of snapshotRows){
    if(isoDate(row.Date)!==today)continue;
    const gameKey=cleanGameKey(row["Game Key"]),market=String(row.Market||"").trim();
    if(!gameKey||!market)continue;
    const pair=`${gameKey}|${market}`;
    const previous=latest.get(pair);
    if(!previous||lastSnapshotEpoch(row)>lastSnapshotEpoch(previous))latest.set(pair,row);
  }
  return latest;
}
function currentLocksForToday(dailyPicks:AnyRow[],today:string,nowMs:number){
  const selected=new Map<string,AnyRow>();
  for(const pick of dailyPicks){
    if(isoDate(pick.date)!==today)continue;
    const gameKey=v2GameIdentity(pick);
    if(!gameKey)continue;
    const start=parseGameStart(pick.date,pick.gameTime);
    const started=start!=null&&start<=nowMs;
    // A pick is created only from an authoritative lock-window snapshot. Once it
    // is FINAL, later refreshes must not rewrite or remove that frozen decision.
    if(!started)continue;
    const previous=selected.get(gameKey);
    if(!previous||Number(pick?.v2MarketGap??pick?.estimatedAdvantage??Number.NEGATIVE_INFINITY)>Number(previous?.v2MarketGap??previous?.estimatedAdvantage??Number.NEGATIVE_INFINITY))selected.set(gameKey,pick);
  }
  return [...selected.values()].sort((a,b)=>Number(b?.v2MarketGap??b?.estimatedAdvantage??0)-Number(a?.v2MarketGap??a?.estimatedAdvantage??0));
}
function samePickSet(left:AnyRow[],right:AnyRow[]){const ids=(rows:AnyRow[])=>rows.map(row=>String(row?.candidateId||"")).sort().join("|");return left.length===right.length&&ids(left)===ids(right)}

function snapshotRow(play:V2TrendPlay,nowMs:number,pendingEzpzCandidate=false):AnyRow{
  const start=parseGameStart(play.recordDate||play.Date,play.v2GameTime);
  const minutes=start==null?"":round((start-nowMs)/60000,1);
  const selection=play.market==="Moneyline"?String(play.selectionTeam||play.selection||""):String(play.side||"");
  return{"Snapshot Time ET":nowET(),Date:isoDate(play.recordDate||play.Date),"Game Key":play.v2GameKey,"Game Time":play.v2GameTime,Game:play.game,"Away Team":play.awayTeam,"Home Team":play.homeTeam,Market:play.market,Selection:selection,Side:play.side||"",Line:play.line??"",Odds:play.odds||"","V2 Score":round(play.v2Score,1),"V2 Tier":play.v2Tier,"V2 Market Gap":round(play.v2MarketGap,2),"V2 Ranking Probability":round(play.v2Probability,2),"Market Implied Probability":round(play.v2ImpliedProbability,2),"V2 Daily Rank":play.v2DailyRank??"","V2 Data Complete":play.v2DataComplete?"TRUE":"FALSE","V2 Direction":play.v2Direction?"TRUE":"FALSE","V2/Legacy Agreement":play.v2LegacyAgreement?"TRUE":"FALSE","Legacy Trend Score":round(play.legacyScore,1),"Legacy Trend Tier":play.legacyTier,"Minutes To Start":minutes,"Daily Eligible":play.v2DailyEligible?"TRUE":"FALSE","Model Version":String(play.v2ModelVersion||MLB_TREND_V2_VERSION),"Details JSON":JSON.stringify({...play,snapshotEpoch:nowMs,pendingEzpzCandidate})};
}
function lastSnapshotEpoch(row:AnyRow){try{const details=JSON.parse(String(row?.["Details JSON"]||"{}"));const epoch=Number(details?.snapshotEpoch||0);if(Number.isFinite(epoch)&&epoch>0)return epoch}catch{}const parsed=Date.parse(String(row?.["Snapshot Time ET"]||""));return Number.isFinite(parsed)?parsed:0}
function snapshotWasDisplayedPending(row:AnyRow){try{const details=JSON.parse(String(row?.["Details JSON"]||"{}"));return details?.pendingEzpzCandidate===true||truthy(details?.pendingEzpzCandidate)}catch{return false}}
function snapshotIsFreshForLock(row:AnyRow,start:number){return lastSnapshotEpoch(row)>=start-MLB_TREND_V2_DECISION_WINDOW_MINUTES*60000}

function playFromSnapshotRow(row:AnyRow):V2TrendPlay|null{
  let parsed:AnyRow;
  try{parsed=JSON.parse(String(row["Details JSON"]||"{}"))}catch{return null}
  if(!parsed||typeof parsed!=="object")return null;
  const rawGap=String(row["V2 Market Gap"]??"").trim();
  const gap=Number(rawGap||parsed.v2MarketGap);
  if(!Number.isFinite(gap))return null;
  return{...parsed,recordDate:parsed.recordDate||row.Date,market:String(parsed.market||row.Market||""),selection:parsed.selection||row.Selection,side:parsed.side||row.Side,line:parsed.line??row.Line,odds:parsed.odds||row.Odds,v2MarketGap:gap,v2Direction:truthy(row["V2 Direction"]),v2DailyEligible:truthy(row["Daily Eligible"]),v2GameKey:cleanGameKey(row["Game Key"]||parsed.v2GameKey)||parsed.v2GameKey,v2GameTime:String(row["Game Time"]||parsed.v2GameTime||"")} as unknown as V2TrendPlay;
}

type SavedPendingSnapshot={row:AnyRow;play:V2TrendPlay;identity:string;gameKey:string;start:number;epoch:number};
function savedPendingSnapshotsByGame(existing:AnyRow[]){
  const saved=new Map<string,SavedPendingSnapshot>();
  for(const row of existing){
    if(!snapshotWasDisplayedPending(row)||!truthy(row["V2 Direction"])||!truthy(row["Daily Eligible"]))continue;
    const play=playFromSnapshotRow(row);
    if(!play||!mlbTrendV2SelectionGate(play))continue;
    const gameKey=v2GameIdentity(play),identity=v2CandidateIdentity(play);
    const start=parseGameStart(play.recordDate||play.Date||row.Date,play.v2GameTime||row["Game Time"]);
    const epoch=lastSnapshotEpoch(row);
    if(!gameKey||!identity||start==null||!epoch||epoch>=start)continue;
    const previous=saved.get(gameKey);
    if(!previous||epoch>previous.epoch||(epoch===previous.epoch&&Number(play.v2MarketGap)>Number(previous.play.v2MarketGap)))saved.set(gameKey,{row,play,identity,gameKey,start,epoch});
  }
  return saved;
}
function savedPendingCandidateIdentities(existing:AnyRow[]){return new Set([...savedPendingSnapshotsByGame(existing).values()].map(saved=>saved.identity))}

function pendingQualifierSnapshotRowsToAppend(qualifiers:Map<string,V2TrendPlay>,existing:AnyRow[],nowMs:number){
  const saved=savedPendingSnapshotsByGame(existing);
  const rows:AnyRow[]=[];
  for(const play of qualifiers.values()){
    const gameKey=v2GameIdentity(play),start=parseGameStart(play.recordDate||play.Date,play.v2GameTime);
    const identity=v2CandidateIdentity(play);
    if(!gameKey||!identity||start==null||start<=nowMs)continue;
    const previous=saved.get(gameKey);
    const sameCandidate=previous?.identity===identity;
    const hasFreshPendingSnapshot=Boolean(previous&&snapshotIsFreshForLock(previous.row,start));
    // Refresh an early saved candidate once it reaches the T-15 lock window.
    // This prevents an hours-old scheduled row from outranking the state the
    // visitor actually saw as PENDING immediately before game time.
    if(sameCandidate&&((start-nowMs)>MLB_TREND_V2_DECISION_WINDOW_MINUTES*60000||hasFreshPendingSnapshot))continue;
    const row=snapshotRow(play,nowMs,true);
    rows.push(row);
    saved.set(gameKey,{row,play,identity,gameKey,start,epoch:nowMs});
  }
  return rows;
}

function pendingResolutionSnapshotRowsToAppend(scored:V2TrendPlay[],existing:AnyRow[],today:string,nowMs:number){
  const latest=latestSnapshotByGameMarket(existing,today);
  const currentByGameMarket=new Map<string,V2TrendPlay>();
  for(const play of scored){
    if(!play.v2Direction)continue;
    const gameKey=v2GameIdentity(play),market=String(play.market||"").trim();
    if(gameKey&&market)currentByGameMarket.set(`${gameKey}|${market}`,play);
  }
  const rows:AnyRow[]=[];
  for(const saved of savedPendingSnapshotsByGame(existing).values()){
    if(saved.start>nowMs)continue;
    const market=String(saved.play.market||"").trim(),pair=`${saved.gameKey}|${market}`;
    const latestRow=latest.get(pair);
    if(latestRow&&snapshotIsFreshForLock(latestRow,saved.start))continue;
    const current=currentByGameMarket.get(pair);
    if(!current)continue;
    // A normal public refresh can supply the missing lock snapshot. Only a game
    // that was explicitly PENDING before start is eligible for this recovery.
    rows.push(snapshotRow(current,nowMs));
  }
  return rows;
}

function latePendingSnapshotDecisions(snapshotRows:AnyRow[],slateRows:AnyRow[],today:string,nowMs:number,lockedGames:Set<string>):DailyLockDecision[]{
  const durablePendingIds=savedPendingCandidateIdentities(snapshotRows);
  const latest=latestSnapshotByGameMarket(snapshotRows,today);
  const recoveries:DailyLockDecision[]=[];
  for(const row of latest.values()){
    const gameKey=cleanGameKey(row["Game Key"]),market=String(row.Market||"").trim();
    if(!gameKey||!market||lockedGames.has(gameKey))continue;
    const play=playFromSnapshotRow(row);
    if(!play)continue;
    const start=parseGameStart(play.recordDate||play.Date||row.Date,play.v2GameTime||row["Game Time"]);
    if(start==null||start>nowMs)continue;
    // Only a snapshot from the lock window can finalize or invalidate a saved
    // candidate. An hours-old row must leave the visible card PENDING.
    if(!snapshotIsFreshForLock(row,start))continue;
    if(!durablePendingIds.has(v2CandidateIdentity(play)))continue;
    if(!truthy(row["V2 Direction"])||!truthy(row["Daily Eligible"])||!mlbTrendV2SelectionGate(play))continue;
    const thresholdInfo=selectionThresholdForPlay(play,start,slateRows);
    if(Number(play.v2MarketGap)<thresholdInfo.threshold)continue;
    recoveries.push({play,threshold:thresholdInfo.threshold,earlyPremium:thresholdInfo.earlyPremium,minutesToStart:(start-nowMs)/60000});
  }
  return recoveries.sort((a,b)=>b.play.v2MarketGap-a.play.v2MarketGap);
}
function unresolvedPendingSnapshotDecisions(snapshotRows:AnyRow[],slateRows:AnyRow[],today:string,nowMs:number,blockedGames:Set<string>):DailyLockDecision[]{
  const latest=latestSnapshotByGameMarket(snapshotRows,today);
  const pending:DailyLockDecision[]=[];
  for(const saved of savedPendingSnapshotsByGame(snapshotRows).values()){
    if(isoDate(saved.play.recordDate||saved.play.Date||saved.row.Date)!==today||saved.start>nowMs||blockedGames.has(saved.gameKey))continue;
    const market=String(saved.play.market||"").trim();
    const latestRow=latest.get(`${saved.gameKey}|${market}`);
    if(latestRow&&snapshotIsFreshForLock(latestRow,saved.start))continue;
    const thresholdInfo=selectionThresholdForPlay(saved.play,saved.start,slateRows);
    if(Number(saved.play.v2MarketGap)<thresholdInfo.threshold)continue;
    pending.push({play:saved.play,threshold:thresholdInfo.threshold,earlyPremium:thresholdInfo.earlyPremium,minutesToStart:(saved.start-nowMs)/60000});
  }
  return pending.sort((a,b)=>b.play.v2MarketGap-a.play.v2MarketGap);
}
function snapshotRowsToAppend(scored:V2TrendPlay[],existing:AnyRow[],nowMs:number){
  const latest=new Map<string,number>();
  for(const row of existing){
    const key=`${isoDate(row.Date)}|${String(row["Game Key"]||"")}|${String(row.Market||"")}`;
    latest.set(key,Math.max(latest.get(key)||0,lastSnapshotEpoch(row)));
  }
  return scored
    .filter(play=>play.v2Direction)
    .filter(play=>{
      const start=parseGameStart(play.recordDate||play.Date,play.v2GameTime);
      if(start==null)return true;
      const minutesToStart=(start-nowMs)/60000;
      // DraftKings splits are treated as locked at game time. Keep capturing through
      // the symmetric +15 minute lock window so a slightly-late poll can become the
      // authoritative final snapshot rather than reviving an older qualifier.
      return minutesToStart>=-MLB_TREND_V2_DECISION_WINDOW_MINUTES;
    })
    .filter(play=>{
      const last=latest.get(candidateKey(play))||0;
      const start=parseGameStart(play.recordDate||play.Date,play.v2GameTime);
      const minutes=start==null?null:(start-nowMs)/60000;
      const lockWindow=minutes!=null&&minutes<=MLB_TREND_V2_DECISION_WINDOW_MINUTES&&minutes>=-MLB_TREND_V2_DECISION_WINDOW_MINUTES;
      return lockWindow||!last||nowMs-last>=14*60000;
    })
    .map(play=>snapshotRow(play,nowMs));
}

function annotateLiveV2Status(scored:V2TrendPlay[],slateRows:AnyRow[],nowMs:number):V2TrendPlay[]{
  return scored.map(play=>{
    const start=parseGameStart(play.recordDate||play.Date,play.v2GameTime);
    const minutesToStart=start==null?null:(start-nowMs)/60000;
    const thresholdInfo=start==null?null:selectionThresholdForPlay(play,start,slateRows);
    const requiredGap=thresholdInfo?.threshold??null;
    const gapNeeded=requiredGap==null?null:Math.max(0,requiredGap-Number(play.v2MarketGap||0));
    const decisionWindowOpen=minutesToStart!=null&&minutesToStart<=MLB_TREND_V2_DECISION_WINDOW_MINUTES;
    const thresholdCleared=requiredGap!=null&&Number(play.v2MarketGap)>=requiredGap;
    let decisionStatus="";
    if(!play.v2Direction)decisionStatus="Not V2 direction";
    else if(!play.v2DailyEligible)decisionStatus="Blocked by guardrail";
    else if(minutesToStart==null)decisionStatus="Decision time unavailable";
    else if(!decisionWindowOpen)decisionStatus=`Waiting for T-${MLB_TREND_V2_DECISION_WINDOW_MINUTES} min`;
    else if(thresholdCleared)decisionStatus=minutesToStart<=0?"RECOVERY OPEN • pending can still finalize":"OPEN • threshold cleared";
    else decisionStatus=minutesToStart<=0?"RECOVERY OPEN • saved pending required":"OPEN • below threshold";
    return{...play,v2RequiredGap:requiredGap,v2GapNeeded:gapNeeded,v2MinutesToStart:minutesToStart,v2EarlyPremium:thresholdInfo?.earlyPremium??null,v2SlatePhase:thresholdInfo?.phase??null,v2SlateBlockIndex:thresholdInfo?.blockIndex??null,v2SlateBlockCount:thresholdInfo?.blockCount??null,v2DecisionWindowOpen:decisionWindowOpen,v2ThresholdCleared:thresholdCleared,v2DecisionStatus:decisionStatus} as V2TrendPlay;
  });
}

function dailyPickObject(decision:DailyLockDecision,today:string,nowMs:number):AnyRow{
  const play=decision.play;
  const lateRecovery=decision.minutesToStart<=0;
  const rlmStatus=mlbTrendV2RlmStatus(play);
  const rlmLabel=rlmStatus==="STRONG_RLM_SUPPORT"?"Strong RLM Support":"RLM Support";
  const selection=play.market==="Moneyline"?String(play.selectionTeam||play.selection||""):String(play.side||"");
  const line=play.market==="Total"&&play.line!=null?String(play.line):"";
  const playLabel=play.market==="Moneyline"?`${selection} Moneyline`:`${selection} ${line}`.trim();
  const candidateId=["v2",isoDate(today),play.v2GameKey,String(play.market).toLowerCase(),selection.toLowerCase().replace(/[^a-z0-9]+/g,"-"),line].join("|");
  const rule=`RLM-only gate cleared: V2 Market Gap ${play.v2MarketGap.toFixed(1)} >= ${decision.threshold.toFixed(0)} with ${rlmLabel}`;
  const marketGuard=play.market==="Moneyline"
    ?"Moneyline guardrail passed: complete v2 inputs and v2/legacy direction agreement"
    :"Totals guardrail passed: complete v2 inputs and the v2 total direction is primary";
  return{candidateId,date:isoDate(today),gameKey:play.v2GameKey,gameTime:play.v2GameTime,game:play.game,awayTeam:play.awayTeam,homeTeam:play.homeTeam,market:play.market,play:playLabel,selection,line,odds:String(play.odds||""),source:"Trend Play",bestPlayType:"",trendTier:play.v2Tier,modelScore:0,trendScore:play.v2Score,aiScore:play.v2Score,estimatedProbability:round(play.v2Probability,1),marketImpliedProbability:round(play.v2ImpliedProbability,1),estimatedAdvantage:round(play.v2MarketGap,1),selected:true,protectionStatus:"PASSED",rejectionReason:"",confidenceReason:[`${rlmLabel} confirmed on the authoritative DraftKings snapshot`,rule],whySelected:[rule,marketGuard,"Only the highest-gap RLM-supported MLB Trend v2 play from each game can become an EZPZ Pick; there is no slate-wide maximum"],historicalNotes:[`Legacy trend: ${play.legacyTier} ${play.legacyScore.toFixed(0)}`,"V2 ranking probability is not treated as a calibrated win probability"],risks:[],researchSummary:"",verdict:`FINAL MLB Trend v2 daily pick — ${playLabel}`,dataStatus:[`Trend v2 model ${String(play.v2ModelVersion||MLB_TREND_V2_VERSION)}`,`V2 Market Gap ${play.v2MarketGap.toFixed(1)}`,`RLM confirmation: ${rlmLabel}`,play.market==="Moneyline"?`V2/legacy agreement: ${play.v2LegacyAgreement?"YES":"NO"}`:`Legacy total agreement: ${play.v2LegacyAgreement?"YES":"NO (allowed for totals)"}`,lateRecovery?`Finalized ${Math.abs(decision.minutesToStart).toFixed(1)} minutes after scheduled start from the latest retained DraftKings snapshot for a pregame PENDING candidate`:`Finalized ${decision.minutesToStart.toFixed(1)} minutes before scheduled start`],externalReviewStatus:"NOT_REQUIRED",snapshotStatus:"FINAL_PREGAME",lockedAt:nowET(),updatedAt:nowET(),result:"",units:0,resultUpdated:"",selectorVersion:MLB_TREND_V2_VERSION,v2SelectionPolicy:MLB_TREND_V2_SELECTION_POLICY,v2RlmStatus:rlmStatus,v2EarlyPremium:decision.earlyPremium,v2RequiredGap:decision.threshold,v2DailyRank:play.v2DailyRank||1,v2LegacyScore:play.legacyScore,v2LegacyTier:play.legacyTier,v2LegacyAgreement:play.v2LegacyAgreement,v2DataComplete:play.v2DataComplete,v2MarketGap:play.v2MarketGap,v2Probability:play.v2Probability,v2ModelVersion:String(play.v2ModelVersion||MLB_TREND_V2_VERSION),v2LockedEpoch:nowMs,lateRecoveryFromPendingSnapshot:lateRecovery};
}
function pendingV2PickObject(play:V2TrendPlay,today:string,slateRows:AnyRow[],nowMs:number):AnyRow|null{
  const start=parseGameStart(play.recordDate||play.Date,play.v2GameTime);
  if(start==null||start<=nowMs||!play.v2Direction||!play.v2DailyEligible)return null;
  const thresholdInfo=selectionThresholdForPlay(play,start,slateRows);
  if(Number(play.v2MarketGap)<thresholdInfo.threshold)return null;
  const minutesToStart=(start-nowMs)/60000;
  const base=dailyPickObject({play,threshold:thresholdInfo.threshold,earlyPremium:thresholdInfo.earlyPremium,minutesToStart},today,nowMs);
  return{...base,snapshotStatus:"LIVE",lockedAt:"",updatedAt:nowET(),verdict:`PENDING MLB Trend v2 qualifier — ${base.play}`,confidenceReason:[`Currently clears the ${thresholdInfo.threshold.toFixed(0)}% V2 Market Gap threshold`,`${mlbTrendV2RlmStatus(play)==="STRONG_RLM_SUPPORT"?"Strong RLM Support":"RLM Support"} confirmed`],whySelected:[...base.whySelected,"This displayed PENDING state is saved and may finalize on a later run, including after start"],dataStatus:[`Trend v2 model ${String(play.v2ModelVersion||MLB_TREND_V2_VERSION)}`,`V2 Market Gap ${play.v2MarketGap.toFixed(1)}`,`RLM confirmation: ${mlbTrendV2RlmStatus(play)==="STRONG_RLM_SUPPORT"?"Strong RLM Support":"RLM Support"}`,`Currently ${minutesToStart.toFixed(1)} minutes before scheduled start`,`Pregame finalization is not required; this saved PENDING state remains eligible after start`],v2LockedEpoch:undefined};
}
function recoveryPendingV2PickObject(decision:DailyLockDecision,today:string,nowMs:number):AnyRow{
  const play=decision.play;
  const base=dailyPickObject(decision,today,nowMs);
  const rlmLabel=mlbTrendV2RlmStatus(play)==="STRONG_RLM_SUPPORT"?"Strong RLM Support":"RLM Support";
  return{...base,snapshotStatus:"LIVE",lockedAt:"",updatedAt:nowET(),verdict:`PENDING RECOVERY — ${base.play}`,confidenceReason:[`Saved pregame state cleared the ${decision.threshold.toFixed(0)}% V2 Market Gap threshold`,`${rlmLabel} was confirmed before scheduled start`],whySelected:[...base.whySelected,"The saved pregame PENDING card remains visible until a usable DraftKings lock snapshot arrives"],dataStatus:[`Trend v2 model ${String(play.v2ModelVersion||MLB_TREND_V2_VERSION)}`,`Saved pregame V2 Market Gap ${play.v2MarketGap.toFixed(1)}`,`Saved pregame RLM confirmation: ${rlmLabel}`,`RECOVERY OPEN — saved pregame PENDING state`,`Awaiting the first DraftKings snapshot from the lock window; stale earlier snapshots cannot remove this card`],v2LockedEpoch:undefined,recoveryPendingFromSavedSnapshot:true};
}
function dailyPickRow(pick:AnyRow):AnyRow{return{Date:pick.date,"Candidate ID":pick.candidateId,"Game Key":pick.gameKey,"Game Time":pick.gameTime,Game:pick.game,"Away Team":pick.awayTeam,"Home Team":pick.homeTeam,Market:pick.market,Play:pick.play,Selection:pick.selection,Line:pick.line,Odds:pick.odds,"V2 Score":pick.trendScore,"V2 Tier":pick.trendTier,"V2 Market Gap":pick.v2MarketGap,"V2 Ranking Probability":pick.v2Probability,"Market Implied Probability":pick.marketImpliedProbability,"Legacy Trend Score":pick.v2LegacyScore,"Legacy Trend Tier":pick.v2LegacyTier,"V2/Legacy Agreement":pick.v2LegacyAgreement?"TRUE":"FALSE","V2 Data Complete":pick.v2DataComplete?"TRUE":"FALSE","Daily Rank":pick.v2DailyRank,"Early Premium":pick.v2EarlyPremium?"TRUE":"FALSE","Required Gap":pick.v2RequiredGap,"Locked At":pick.lockedAt,Result:pick.result||"",Units:String(pick.units??0),"Result Updated":pick.resultUpdated||"","Model Version":String(pick.v2ModelVersion||MLB_TREND_V2_VERSION),"Details JSON":JSON.stringify(pick)}}
function parseDailyPickRow(row:AnyRow):AnyRow|null{try{const raw=String(row?.["Details JSON"]||"").trim();if(raw){const parsed=JSON.parse(raw);if(parsed?.candidateId)return{...parsed,result:String(row.Result||parsed.result||""),units:Number(row.Units||parsed.units||0),resultUpdated:String(row["Result Updated"]||parsed.resultUpdated||"")}}}catch{}const candidateId=String(row?.["Candidate ID"]||"").trim();if(!candidateId)return null;return{candidateId,date:isoDate(row.Date),gameKey:String(row["Game Key"]||""),gameTime:String(row["Game Time"]||""),game:String(row.Game||""),awayTeam:String(row["Away Team"]||""),homeTeam:String(row["Home Team"]||""),market:String(row.Market||""),play:String(row.Play||""),selection:String(row.Selection||""),line:String(row.Line||""),odds:String(row.Odds||""),source:"Trend Play",bestPlayType:"",trendTier:String(row["V2 Tier"]||""),modelScore:0,trendScore:Number(row["V2 Score"]||0),aiScore:Number(row["V2 Score"]||0),estimatedProbability:Number(row["V2 Ranking Probability"]||0),marketImpliedProbability:Number(row["Market Implied Probability"]||0),estimatedAdvantage:Number(row["V2 Market Gap"]||0),selected:true,protectionStatus:"PASSED",rejectionReason:"",confidenceReason:[],whySelected:[],historicalNotes:[],risks:[],researchSummary:"",verdict:`FINAL MLB Trend v2 daily pick — ${String(row.Play||"")}`,dataStatus:[`Trend v2 model ${MLB_TREND_V2_VERSION}`],externalReviewStatus:"NOT_REQUIRED",snapshotStatus:"FINAL_PREGAME",lockedAt:String(row["Locked At"]||""),updatedAt:String(row["Locked At"]||""),result:String(row.Result||""),units:Number(row.Units||0),resultUpdated:String(row["Result Updated"]||""),selectorVersion:MLB_TREND_V2_VERSION}}
function normalize(value:unknown){return String(value||"").toLowerCase().replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim()}
function gradeDailyPick(pick:AnyRow,records:AnyRow[]):AnyRow{const record=records.find(row=>{if(isoDate(row?.date||row?.Date)!==isoDate(pick.date))return false;if(String(row?.market||row?.Market)!==String(pick.market))return false;const pk=String(pick.gameKey||"").replace(/\.0$/,"");const rk=String(row?.gameKey||row?.["Game Key"]||"").replace(/\.0$/,"");if(pk&&rk&&pk!==rk)return false;if(pick.market==="Total")return normalize(row.selection||row.Selection).startsWith(normalize(pick.selection));const rs=normalize(row.selection||row.Selection),ps=normalize(pick.selection);return rs===ps||rs.includes(ps)||ps.includes(rs)});if(!record||!String(record.result||record.Result||"").trim())return pick;const raw=String(record.result||record.Result||"").trim().toUpperCase();const result=raw.startsWith("W")?"W":raw.startsWith("L")?"L":raw.startsWith("P")?"P":"";if(!result)return pick;const units=Number.isFinite(Number(record.units))?Number(record.units):resultProfit(result,pick.odds);if(pick.result===result&&Number(pick.units||0)===units)return pick;return{...pick,result,units:round(units,2),resultUpdated:nowET(),updatedAt:nowET()}}

async function postProcessMlbPayload(request:NextRequest,payload:AnyRow){
  const today=isoDate(payload.today||new Date()),nowMs=Date.now();
  const slateRows=Array.isArray(payload.slateToday)?payload.slateToday:[];
  const baselineScored=scoreTrendBoardV2(Array.isArray(payload.trendPlays)?payload.trendPlays:[],slateRows);
  const adaptive=await applyMlbTrendV2Adaptive(baselineScored);
  const rlmGated=applyMlbTrendV2SelectionGate(adaptive.plays);
  const scored=annotateLiveV2Status(rlmGated,slateRows,nowMs);
  const currentQualifiers=currentQualifierByGame(scored,slateRows);
  payload.trendPlays=scored;
  payload.trendV2={version:MLB_TREND_V2_VERSION,selectionPolicy:MLB_TREND_V2_SELECTION_POLICY,launchDate:MLB_TREND_V2_LAUNCH_DATE,gapThreshold:MLB_TREND_V2_NORMAL_GAP,requiresRlmSupport:true,acceptedRlmStatuses:["RLM_SUPPORT","STRONG_RLM_SUPPORT"],maxPerGame:1,noSlateMaximum:true,targetFinalizationMinutes:MLB_TREND_V2_DECISION_WINDOW_MINUTES,pregameFinalizationRequired:false,thresholdRule:"Every official MLB Trend v2 EZPZ Pick requires V2 Market Gap >= 15% plus RLM Support or Strong RLM Support. One pick max per game; no slate-wide maximum.",note:"A qualifier is durably saved when it appears as PENDING before scheduled start and remains visible after start until a usable DraftKings lock-window snapshot can finalize or invalidate it. Stale earlier snapshots cannot erase the PENDING card, and only candidates that were explicitly PENDING before start can recover, so no new post-start candidates are created. Non-RLM V2 candidates remain in shadow tracking. V2 Ranking Probability and Market Gap are ranking diagnostics, not calibrated win probabilities.",adaptiveLifecycle:adaptive.lifecycle};

  let snapshotRows:AnyRow[]=[],dailyRows:AnyRow[]=[];
  try{[snapshotRows,dailyRows]=await Promise.all([readV2Tab("snapshots"),readV2Tab("daily")])}catch(error){console.error("Trend v2 history read failed; serving live v2 scores without persistence",error)}
  if(isV2ScheduledCapture(request)&&today>=MLB_TREND_V2_LAUNCH_DATE){try{const append=snapshotRowsToAppend(scored,snapshotRows,nowMs);if(append.length){await appendV2Rows("snapshots",append);snapshotRows=[...snapshotRows,...append]}}catch(error){console.error("Trend v2 snapshot append failed",error)}}
  if(today>=MLB_TREND_V2_LAUNCH_DATE){try{const append=pendingQualifierSnapshotRowsToAppend(currentQualifiers,snapshotRows,nowMs);if(append.length){await appendV2Rows("snapshots",append);snapshotRows=[...snapshotRows,...append]}}catch(error){console.error("Trend v2 PENDING-state persistence failed",error)}}
  const draftKingsUsable=Boolean(payload.draftKings&&payload.draftKings.status!=="UNAVAILABLE"&&!truthy(payload.draftKings.stale));
  if(today>=MLB_TREND_V2_LAUNCH_DATE&&draftKingsUsable){try{const append=pendingResolutionSnapshotRowsToAppend(scored,snapshotRows,today,nowMs);if(append.length){await appendV2Rows("snapshots",append);snapshotRows=[...snapshotRows,...append]}}catch(error){console.error("Trend v2 lock-window recovery snapshot failed",error)}}
  const durablePendingIds=savedPendingCandidateIdentities(snapshotRows);

  let dailyPicks=dailyRows.map(parseDailyPickRow).filter((pick):pick is AnyRow=>Boolean(pick));
  const storedTodayLocks=dailyPicks.filter(pick=>isoDate(pick.date)===today);
  let todayLocks=currentLocksForToday(dailyPicks,today,nowMs);
  // Any request after scheduled start may complete the deterministic recovery
  // for a candidate that was already durably PENDING before first pitch. This
  // removes the GitHub-cron dependency without permitting new in-game picks.
  if(today>=MLB_TREND_V2_LAUNCH_DATE){
    const rewriteRequired=!samePickSet(storedTodayLocks,todayLocks);
    if(rewriteRequired)dailyPicks=[...dailyPicks.filter(pick=>isoDate(pick.date)!==today),...todayLocks];
    const lockedGames=new Set(todayLocks.map(v2GameIdentity).filter(Boolean));
    const newLocks:AnyRow[]=[];
    // Authoritative DraftKings lock snapshot: finalize only after scheduled start.
    for(const decision of latePendingSnapshotDecisions(snapshotRows,slateRows,today,nowMs,lockedGames)){
      const gameKey=v2GameIdentity(decision.play);
      if(!gameKey||lockedGames.has(gameKey))continue;
      newLocks.push(dailyPickObject(decision,today,nowMs));
      lockedGames.add(gameKey);
    }
    if(rewriteRequired||newLocks.length){
      const nextDailyPicks=[...dailyPicks,...newLocks];
      try{if(rewriteRequired)await replaceV2DailyRows(nextDailyPicks.map(dailyPickRow));else await appendV2Rows("daily",newLocks.map(dailyPickRow));dailyPicks=nextDailyPicks;todayLocks=currentLocksForToday(dailyPicks,today,nowMs)}
      catch(error){console.error("Trend v2 daily lock persistence failed",error)}
    }
  }

  const graded=dailyPicks.map(pick=>gradeDailyPick(pick,Array.isArray(payload.trendRecordRows)?payload.trendRecordRows:[]));
  const gradeChanged=graded.some((pick,index)=>{const before=dailyPicks[index];return Boolean(before&&(before.result!==pick.result||Number(before.units||0)!==Number(pick.units||0)))});
  if(gradeChanged){dailyPicks=graded;try{await replaceV2DailyRows(dailyPicks.map(dailyPickRow))}catch(error){console.error("Trend v2 daily grading persistence failed",error)}}else dailyPicks=graded;
  todayLocks=currentLocksForToday(dailyPicks,today,nowMs);

  const legacyAiPicks=Array.isArray(payload.aiPicks)?payload.aiPicks:[];
  const filteredAiPicks=legacyAiPicks.filter((pick:AnyRow)=>!isLaunchOrLater(pick?.date||today));
  const lockedGames=new Set(todayLocks.map(v2GameIdentity).filter(Boolean));
  const livePendingV2Picks=[...currentQualifiers.values()]
    .filter((play)=>!lockedGames.has(v2GameIdentity(play)))
    .filter((play)=>durablePendingIds.has(v2CandidateIdentity(play)))
    .map((play)=>pendingV2PickObject(play,today,slateRows,nowMs))
    .filter((pick):pick is AnyRow=>Boolean(pick));
  const recoveryPendingGames=new Set([...lockedGames,...livePendingV2Picks.map(v2GameIdentity).filter(Boolean)]);
  const recoveryPendingV2Picks:AnyRow[]=[];
  for(const decision of unresolvedPendingSnapshotDecisions(snapshotRows,slateRows,today,nowMs,recoveryPendingGames)){
    const gameKey=v2GameIdentity(decision.play);
    if(!gameKey||recoveryPendingGames.has(gameKey))continue;
    recoveryPendingV2Picks.push(recoveryPendingV2PickObject(decision,today,nowMs));
    recoveryPendingGames.add(gameKey);
  }
  const pendingV2Picks=[...livePendingV2Picks,...recoveryPendingV2Picks];
  for(const pendingPick of pendingV2Picks)filteredAiPicks.push(pendingPick);
  for(const lock of todayLocks)filteredAiPicks.push(lock);
  payload.aiPicks=filteredAiPicks;
  const legacyRecordRows=Array.isArray(payload.aiPickRecordRows)?payload.aiPickRecordRows:[];
  const filteredRecordRows=legacyRecordRows.filter((pick:AnyRow)=>!isLaunchOrLater(pick?.date||pick?.Date));
  const visibleDailyPicks=[...dailyPicks.filter(pick=>isoDate(pick.date)!==today),...todayLocks];
  payload.aiPickRecordRows=[...filteredRecordRows,...visibleDailyPicks];

  const status=payload.aiSelectorStatus||{};
  const finalCount=filteredAiPicks.filter((pick:AnyRow)=>pick?.snapshotStatus==="FINAL_PREGAME").length;
  const lockedCount=todayLocks.length;
  const pendingCount=pendingV2Picks.length;
  const lockedNames=todayLocks.map(pick=>pick.play).filter(Boolean).join("; ");
  const pendingNames=pendingV2Picks.map(pick=>pick.play).filter(Boolean).join("; ");
  const trendMessage=pendingCount>0
    ? `MLB Trend v2 has ${pendingCount} PENDING 15%+ RLM-supported qualifier${pendingCount===1?"":"s"}: ${pendingNames}. Each displayed PENDING state is saved and may finalize after start.${lockedCount?` ${lockedCount} pick${lockedCount===1?" is":"s are"} already FINAL: ${lockedNames}.`:""}`
    : lockedCount>0
      ? `MLB Trend v2 has ${lockedCount} FINAL 15%+ RLM-supported pick${lockedCount===1?"":"s"}: ${lockedNames}. Only the highest-gap qualifier from each game can be selected; there is no slate maximum.`
      : `MLB Trend v2 is tracking the slate. Official picks require a 15%+ V2 Market Gap with RLM Support or Strong RLM Support. There is one pick max per game and no slate maximum.`;
  payload.aiSelectorStatus={...status,mode:finalCount===filteredAiPicks.length&&filteredAiPicks.length?"FINAL_PREGAME":"LIVE_PREVIEW",message:trendMessage,updatedAt:nowET(),candidateCount:Number(status.candidateCount||0)+scored.filter(play=>play.v2Direction).length,selectedCount:filteredAiPicks.length,trendV2DailyLocked:Boolean(lockedCount),trendV2DailyLockedCount:lockedCount,trendV2MaxPerGame:1,trendV2NoSlateMaximum:true,trendV2Threshold:15,trendV2RequiresRlmSupport:true,trendV2PregameFinalizationRequired:false,trendV2SelectionPolicy:MLB_TREND_V2_SELECTION_POLICY};
  return payload;
}

export async function GET(request:NextRequest){
  const sport=String(request.nextUrl.searchParams.get("sport")||"MLB").trim().toUpperCase();if(sport==="NFL"||sport==="NCAAF")return legacyGET(request);
  const legacyResponse=await legacyGET(request);const contentType=legacyResponse.headers.get("content-type")||"";if(!contentType.includes("application/json"))return legacyResponse;
  let payload:AnyRow;try{payload=await legacyResponse.json()}catch{return legacyResponse}if(!payload?.ok)return NextResponse.json(payload,{status:legacyResponse.status,headers:{"Cache-Control":"no-store, max-age=0"}});
  try{payload=await postProcessMlbPayload(request,payload)}catch(error){console.error("MLB Trend v2 wrapper failed; returning legacy response",error);payload.trendV2Error=error instanceof Error?error.message:String(error)}
  return NextResponse.json(payload,{status:legacyResponse.status,headers:{"Cache-Control":"no-store, max-age=0"}});
}
