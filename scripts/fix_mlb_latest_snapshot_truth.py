from pathlib import Path
import re

path = Path("app/api/public-data-v2/route.ts")
text = path.read_text()

if "function latestSnapshotByGameMarket(" in text and "Authoritative DraftKings lock snapshot" in text:
    print("MLB latest-snapshot truth policy already applied")
    raise SystemExit(0)

# The final/locked MLB state must come from the newest observed DraftKings snapshot,
# not from the newest snapshot that happened to qualify. A candidate must still have
# appeared as PENDING before start; post-start snapshots may confirm or invalidate it,
# but may never create a brand-new candidate.
current_locks_pattern = re.compile(
    r"function currentLocksForToday\(.*?\n}\nfunction samePickSet",
    re.S,
)
current_locks_replacement = r'''function latestSnapshotByGameMarket(snapshotRows:AnyRow[],today:string){
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
function currentLocksForToday(dailyPicks:AnyRow[],today:string,qualifiers:Map<string,V2TrendPlay>,nowMs:number,snapshotRows:AnyRow[],slateRows:AnyRow[]){
  const selected=new Map<string,AnyRow>();
  const latestSnapshots=latestSnapshotByGameMarket(snapshotRows,today);
  for(const pick of dailyPicks){
    if(isoDate(pick.date)!==today)continue;
    const gameKey=v2GameIdentity(pick),qualifier=qualifiers.get(gameKey);
    if(!gameKey)continue;
    const start=parseGameStart(pick.date,pick.gameTime);
    const started=start!=null&&start<=nowMs;
    // Final MLB Trend v2 picks are not authoritative until scheduled start has passed.
    if(!started)continue;
    const market=String(pick.market||pick.Market||"").trim();
    const snapshot=latestSnapshots.get(`${gameKey}|${market}`);
    if(snapshot){
      const latestPlay=playFromSnapshotRow(snapshot);
      if(!latestPlay||!sameV2Candidate(pick,latestPlay))continue;
      if(!truthy(snapshot["V2 Direction"])||!truthy(snapshot["Daily Eligible"])||!mlbTrendV2SelectionGate(latestPlay))continue;
      const latestStart=parseGameStart(latestPlay.recordDate||latestPlay.Date||snapshot.Date,latestPlay.v2GameTime||snapshot["Game Time"]);
      if(latestStart==null)continue;
      const thresholdInfo=selectionThresholdForPlay(latestPlay,latestStart,slateRows);
      if(Number(latestPlay.v2MarketGap)<thresholdInfo.threshold)continue;
    }else if(!qualifier||!sameV2Candidate(pick,qualifier))continue;
    const previous=selected.get(gameKey);
    if(!previous||Number(pick?.v2MarketGap??pick?.estimatedAdvantage??Number.NEGATIVE_INFINITY)>Number(previous?.v2MarketGap??previous?.estimatedAdvantage??Number.NEGATIVE_INFINITY))selected.set(gameKey,pick);
  }
  return [...selected.values()].sort((a,b)=>Number(b?.v2MarketGap??b?.estimatedAdvantage??0)-Number(a?.v2MarketGap??a?.estimatedAdvantage??0));
}
function samePickSet'''
text, count = current_locks_pattern.subn(current_locks_replacement, text, count=1)
if count != 1:
    raise RuntimeError("Could not replace currentLocksForToday block")

recovery_pattern = re.compile(
    r"function latePendingSnapshotDecisions\(.*?\n}\nfunction snapshotRowsToAppend\(.*?\n\nfunction annotateLiveV2Status",
    re.S,
)
recovery_replacement = r'''function latePendingSnapshotDecisions(snapshotRows:AnyRow[],slateRows:AnyRow[],today:string,nowMs:number,lockedGames:Set<string>):DailyLockDecision[]{
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
    // Never search backward for an older qualifying state. The newest observed
    // DraftKings snapshot is the truth, even when it was captured just after start.
    if(!durablePendingIds.has(v2CandidateIdentity(play)))continue;
    if(!truthy(row["V2 Direction"])||!truthy(row["Daily Eligible"])||!mlbTrendV2SelectionGate(play))continue;
    const thresholdInfo=selectionThresholdForPlay(play,start,slateRows);
    if(Number(play.v2MarketGap)<thresholdInfo.threshold)continue;
    recoveries.push({play,threshold:thresholdInfo.threshold,earlyPremium:thresholdInfo.earlyPremium,minutesToStart:(start-nowMs)/60000});
  }
  return recoveries.sort((a,b)=>b.play.v2MarketGap-a.play.v2MarketGap);
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

function annotateLiveV2Status'''
text, count = recovery_pattern.subn(recovery_replacement, text, count=1)
if count != 1:
    raise RuntimeError("Could not replace recovery/snapshot block")

# We no longer lock a candidate before start. It remains PENDING, then the first
# scheduled run after start finalizes only if the newest snapshot still qualifies.
prelock_pattern = re.compile(
    r"    let available=scored\.filter\(play=>!lockedGames\.has\(v2GameIdentity\(play\)\)\);\n"
    r"    const newLocks:AnyRow\[\]=\[\];\n"
    r"    while\(true\)\{.*?\n    \}\n"
    r"    for\(const decision of latePendingSnapshotDecisions",
    re.S,
)
text, count = prelock_pattern.subn(
    "    const newLocks:AnyRow[]=[];\n    // Authoritative DraftKings lock snapshot: finalize only after scheduled start.\n    for(const decision of latePendingSnapshotDecisions",
    text,
    count=1,
)
if count != 1:
    raise RuntimeError("Could not remove pre-start finalization loop")

text = text.replace("applyMlbTrendV2SelectionGate, chooseDailyTrendLock, isoDate,", "applyMlbTrendV2SelectionGate, isoDate,")
text = text.replace(
    "currentLocksForToday(dailyPicks,today,currentQualifiers,nowMs)",
    "currentLocksForToday(dailyPicks,today,currentQualifiers,nowMs,snapshotRows,slateRows)",
)

text = text.replace(
    'confidenceReason:[`${rlmLabel} confirmed before start`,rule]',
    'confidenceReason:[`${rlmLabel} confirmed on the authoritative DraftKings snapshot`,rule]',
)
text = text.replace(
    'lateRecovery?`Finalized ${Math.abs(decision.minutesToStart).toFixed(1)} minutes after scheduled start from its saved PENDING state`:`Finalized ${decision.minutesToStart.toFixed(1)} minutes before scheduled start`',
    'lateRecovery?`Finalized ${Math.abs(decision.minutesToStart).toFixed(1)} minutes after scheduled start from the latest retained DraftKings snapshot for a pregame PENDING candidate`:`Finalized ${decision.minutesToStart.toFixed(1)} minutes before scheduled start`',
)

recovery_card_pattern = re.compile(
    r"function recoveryPendingV2PickObject\(decision:DailyLockDecision,today:string,nowMs:number\):AnyRow\{.*?\n}\nfunction dailyPickRow",
    re.S,
)
recovery_card_replacement = r'''function recoveryPendingV2PickObject(decision:DailyLockDecision,today:string,nowMs:number):AnyRow{
  const play=decision.play;
  const base=dailyPickObject(decision,today,nowMs);
  const rlmLabel=mlbTrendV2RlmStatus(play)==="STRONG_RLM_SUPPORT"?"Strong RLM Support":"RLM Support";
  return{...base,snapshotStatus:"LIVE",lockedAt:"",updatedAt:nowET(),verdict:`PENDING RECOVERY — ${base.play}`,confidenceReason:[`Latest retained DraftKings snapshot clears the ${decision.threshold.toFixed(0)}% V2 Market Gap threshold`,`${rlmLabel} confirmed on the latest retained DraftKings snapshot`],whySelected:[...base.whySelected,"This candidate was already shown PENDING before start; the newest retained DraftKings snapshot is authoritative even when captured shortly after scheduled start"],dataStatus:[`Trend v2 model ${String(play.v2ModelVersion||MLB_TREND_V2_VERSION)}`,`Latest retained DraftKings V2 Market Gap ${play.v2MarketGap.toFixed(1)}`,`Latest retained DraftKings RLM confirmation: ${rlmLabel}`,`RECOVERY OPEN — pregame PENDING candidate`,`No new post-start candidate is created; the latest retained snapshot can only confirm or invalidate the pregame PENDING state`],v2LockedEpoch:undefined,recoveryPendingFromSavedSnapshot:true};
}
function dailyPickRow'''
text, count = recovery_card_pattern.subn(recovery_card_replacement, text, count=1)
if count != 1:
    raise RuntimeError("Could not update recovery pending card copy")

text = text.replace(
    "Late finalization uses only that saved PENDING state, never in-game market data.",
    "The latest retained DraftKings snapshot is authoritative at lock, including a snapshot captured shortly after scheduled start; recovery is allowed only for candidates that were already PENDING before start, so no new post-start candidates are created.",
)

path.write_text(text)
print("Applied MLB authoritative latest-snapshot policy")
