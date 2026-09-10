from pathlib import Path

PAGE = Path("app/page.tsx")
ROUTE = Path("app/api/public-data-v2/route.ts")
MODEL = Path("lib/mlbTrendV2.ts")

page = PAGE.read_text()
route = ROUTE.read_text()
model = MODEL.read_text()


def replace_once(source: str, old: str, new: str, label: str) -> str:
    if old not in source:
        if new in source:
            print(f"Already applied: {label}")
            return source
        raise SystemExit(f"Missing patch anchor: {label}")
    return source.replace(old, new, 1)


# The model constant is the source-of-truth rule. Fail loudly if an older
# migration has changed it instead of silently applying another incompatible patch.
required_model_rules = [
    'export const MLB_TREND_V2_NORMAL_GAP = 15;',
    'export const MLB_TREND_V2_EARLY_GAP = 15;',
    'export const MLB_TREND_V2_MAX_DAILY_PICKS = 2;',
    'export const MLB_TREND_V2_DECISION_WINDOW_MINUTES = 15;',
]
missing = [rule for rule in required_model_rules if rule not in model]
if missing:
    raise SystemExit("MLB Trend V2 source rules are not in the expected state: " + ", ".join(missing))

# ---- API: make the max-two rule real, not just a dead constant. ----
route = replace_once(
    route,
    '  MLB_TREND_V2_EARLY_GAP, MLB_TREND_V2_LAUNCH_DATE,\n  MLB_TREND_V2_NORMAL_GAP, MLB_TREND_V2_VERSION, V2TrendPlay,',
    '  MLB_TREND_V2_EARLY_GAP, MLB_TREND_V2_LAUNCH_DATE, MLB_TREND_V2_MAX_DAILY_PICKS,\n  MLB_TREND_V2_NORMAL_GAP, MLB_TREND_V2_VERSION, V2TrendPlay,',
    "restore max-daily-picks import",
)

route = replace_once(
    route,
    'payload.trendV2={version:MLB_TREND_V2_VERSION,launchDate:MLB_TREND_V2_LAUNCH_DATE,normalGap:MLB_TREND_V2_NORMAL_GAP,earlyGap:MLB_TREND_V2_EARLY_GAP,allAboveThreshold:true,decisionWindowMinutes:MLB_TREND_V2_DECISION_WINDOW_MINUTES,thresholdRule:"Every otherwise-eligible MLB Trend v2 play with V2 Market Gap >= 15% locks as an EZPZ Pick; a saved pregame PENDING qualifier may finalize on a later run even after scheduled start",note:"Late finalization uses the last saved pregame pending snapshot, never in-game market data. V2 Ranking Probability and Market Gap are ranking diagnostics, not calibrated win probabilities.",adaptiveLifecycle:adaptive.lifecycle};',
    'payload.trendV2={version:MLB_TREND_V2_VERSION,launchDate:MLB_TREND_V2_LAUNCH_DATE,normalGap:MLB_TREND_V2_NORMAL_GAP,earlyGap:MLB_TREND_V2_EARLY_GAP,maxDailyPicks:MLB_TREND_V2_MAX_DAILY_PICKS,decisionWindowMinutes:MLB_TREND_V2_DECISION_WINDOW_MINUTES,thresholdRule:"Up to 2 MLB Trend v2 EZPZ Picks may be shown per date; each must independently clear a 15% V2 Market Gap. Saved pregame PENDING qualifiers may still finalize on a later run if a slot remains",note:"Late finalization uses the last saved pregame pending snapshot, never in-game market data. V2 Ranking Probability and Market Gap are ranking diagnostics, not calibrated win probabilities.",adaptiveLifecycle:adaptive.lifecycle};',
    "restore max-two metadata",
)

route = route.replace(
    '"Every otherwise-eligible MLB Trend v2 play with a V2 Market Gap of 15% or greater is an EZPZ Pick"',
    '`Up to ${MLB_TREND_V2_MAX_DAILY_PICKS} MLB Trend v2 EZPZ Picks are allowed per date; each must clear a 15% V2 Market Gap`',
)

helper_anchor = 'async function postProcessMlbPayload(request:NextRequest,payload:AnyRow){'
helper = '''function mlbV2PickGap(pick:AnyRow){const value=Number(pick?.v2MarketGap??pick?.estimatedAdvantage??Number.NEGATIVE_INFINITY);return Number.isFinite(value)?value:Number.NEGATIVE_INFINITY}\nfunction capMlbV2Locks(picks:AnyRow[],date:string){return picks.filter(pick=>isoDate(pick.date)===date).sort((a,b)=>{const gap=mlbV2PickGap(b)-mlbV2PickGap(a);if(gap)return gap;const ar=Number(a?.v2DailyRank??Number.MAX_SAFE_INTEGER),br=Number(b?.v2DailyRank??Number.MAX_SAFE_INTEGER);if(ar!==br)return ar-br;return String(a?.lockedAt||a?.updatedAt||"").localeCompare(String(b?.lockedAt||b?.updatedAt||""))}).slice(0,MLB_TREND_V2_MAX_DAILY_PICKS)}\n\n'''
if "function capMlbV2Locks(" not in route:
    if helper_anchor not in route:
        raise SystemExit("Missing patch anchor: post-process helper insertion")
    route = route.replace(helper_anchor, helper + helper_anchor, 1)

route = replace_once(
    route,
    '  let todayLocks=dailyPicks.filter(pick=>isoDate(pick.date)===today);',
    '  let todayLocks=capMlbV2Locks(dailyPicks,today);',
    "cap persisted current-day locks",
)
route = replace_once(
    route,
    '  if(isV2ScheduledCapture(request)&&today>=MLB_TREND_V2_LAUNCH_DATE){',
    '  if(isV2ScheduledCapture(request)&&today>=MLB_TREND_V2_LAUNCH_DATE&&todayLocks.length<MLB_TREND_V2_MAX_DAILY_PICKS){',
    "cap lock capture gate",
)
route = replace_once(
    route,
    '    while(true){',
    '    while(todayLocks.length+newLocks.length<MLB_TREND_V2_MAX_DAILY_PICKS){',
    "cap lock loop",
)
route = replace_once(
    route,
    '    for(const decision of latePendingSnapshotDecisions(snapshotRows,slateRows,today,nowMs,lockedPairs)){\n      const pair=`${decision.play.v2GameKey}|${decision.play.market}`;',
    '    for(const decision of latePendingSnapshotDecisions(snapshotRows,slateRows,today,nowMs,lockedPairs)){\n      if(todayLocks.length+newLocks.length>=MLB_TREND_V2_MAX_DAILY_PICKS)break;\n      const pair=`${decision.play.v2GameKey}|${decision.play.market}`;',
    "cap late-recovery loop",
)
route = replace_once(
    route,
    '  todayLocks=dailyPicks.filter(pick=>isoDate(pick.date)===today);',
    '  todayLocks=capMlbV2Locks(dailyPicks,today);',
    "cap post-grade current-day locks",
)

# From the V2 launch forward, the old selector must not feed current MLB EZPZ cards.
# This is what prevents old ROI-based cards from being merged beside V2 cards.
route = replace_once(
    route,
    '  const filteredAiPicks=legacyAiPicks.filter((pick:AnyRow)=>!(isLaunchOrLater(pick?.date||today)&&pureLegacyTrendPick(pick)));',
    '  const filteredAiPicks=legacyAiPicks.filter((pick:AnyRow)=>!isLaunchOrLater(pick?.date||today));',
    "remove post-launch legacy current picks",
)

pending_old = '''  const pendingV2Picks=scored
    .map((play)=>pendingV2PickObject(play,today,slateRows,nowMs))
    .filter((pick):pick is AnyRow=>Boolean(pick))
    .filter((pick)=>!lockedIds.has(String(pick.candidateId||"")));'''
pending_new = '''  const remainingV2Slots=Math.max(0,MLB_TREND_V2_MAX_DAILY_PICKS-todayLocks.length);
  const pendingV2Picks=scored
    .map((play)=>pendingV2PickObject(play,today,slateRows,nowMs))
    .filter((pick):pick is AnyRow=>Boolean(pick))
    .filter((pick)=>!lockedIds.has(String(pick.candidateId||"")))
    .sort((a,b)=>mlbV2PickGap(b)-mlbV2PickGap(a))
    .slice(0,remainingV2Slots);'''
route = replace_once(route, pending_old, pending_new, "cap pending V2 cards")

route = replace_once(
    route,
    '  const filteredRecordRows=legacyRecordRows.filter((pick:AnyRow)=>!(isLaunchOrLater(pick?.date||pick?.Date)&&pureLegacyTrendPick(pick)));\n  payload.aiPickRecordRows=[...filteredRecordRows,...dailyPicks];',
    '  const filteredRecordRows=legacyRecordRows.filter((pick:AnyRow)=>!isLaunchOrLater(pick?.date||pick?.Date));\n  const displayedDailyPicks=dailyPicks.filter((pick:AnyRow)=>isoDate(pick.date)!==today||lockedIds.has(String(pick.candidateId||"")));\n  payload.aiPickRecordRows=[...filteredRecordRows,...displayedDailyPicks];',
    "remove post-launch legacy records and hide overflow locks",
)

status_start = '''  const trendMessage=pendingCount>0
    ? `MLB Trend v2 has ${pendingCount} PENDING 15%+ qualifier${pendingCount===1?"":"s"} awaiting the next lock run: ${pendingNames}.${lockedCount?` ${lockedCount} pick${lockedCount===1?" is":"s are"} already FINAL: ${lockedNames}.`:""}`
    : lockedCount>0
      ? `MLB Trend v2 has ${lockedCount} FINAL 15%+ pick${lockedCount===1?"":"s"}: ${lockedNames}. New qualifiers appear as PENDING before T-${MLB_TREND_V2_DECISION_WINDOW_MINUTES}.`
      : filteredAiPicks.length
        ? `HOT Best Plays are final; any MLB Trend v2 play that currently clears 15% appears as PENDING until the next lock run; delayed runs can recover from the saved pregame snapshot.`
        : `MLB Trend v2 is tracking the slate. A play appears as PENDING as soon as it currently clears 15%, then becomes FINAL on the next lock run; delayed runs can recover from the saved pregame snapshot.`;
  payload.aiSelectorStatus={...status,mode:finalCount===filteredAiPicks.length&&filteredAiPicks.length?"FINAL_PREGAME":"LIVE_PREVIEW",message:trendMessage,updatedAt:nowET(),candidateCount:Number(status.candidateCount||0)+scored.filter(play=>play.v2Direction).length,selectedCount:filteredAiPicks.length,trendV2DailyLocked:Boolean(lockedCount),trendV2DailyLockedCount:lockedCount,trendV2AllAboveThreshold:true,trendV2Threshold:15};'''
status_new = '''  const totalV2Shown=lockedCount+pendingCount;
  const trendMessage=pendingCount>0
    ? `MLB Trend v2 is showing ${totalV2Shown}/${MLB_TREND_V2_MAX_DAILY_PICKS} daily slots: ${pendingCount} PENDING 15%+ qualifier${pendingCount===1?"":"s"}${lockedCount?` and ${lockedCount} FINAL`:""}.`
    : lockedCount>0
      ? `MLB Trend v2 has ${lockedCount}/${MLB_TREND_V2_MAX_DAILY_PICKS} FINAL daily pick${lockedCount===1?"":"s"}. Each cleared the 15% V2 Market Gap threshold.`
      : `MLB Trend v2 is tracking the slate. Up to ${MLB_TREND_V2_MAX_DAILY_PICKS} daily picks may qualify; each must clear a 15% V2 Market Gap.`;
  payload.aiSelectorStatus={...status,mode:finalCount===filteredAiPicks.length&&filteredAiPicks.length?"FINAL_PREGAME":"LIVE_PREVIEW",message:trendMessage,updatedAt:nowET(),candidateCount:Number(status.candidateCount||0)+scored.filter(play=>play.v2Direction).length,selectedCount:filteredAiPicks.length,trendV2DailyLocked:Boolean(lockedCount),trendV2DailyLockedCount:lockedCount,trendV2DailyMaxPicks:MLB_TREND_V2_MAX_DAILY_PICKS,trendV2Threshold:15};'''
route = replace_once(route, status_start, status_new, "restore max-two selector status")

# ---- UI: every current MLB V2 card, FINAL or PENDING, is GAP-only. ----
page = replace_once(
    page,
    '''  const isPendingTrend = !pick.bestPlayType && !isFinalReview;
  const pendingTrendGap = Number(pick.estimatedAdvantage);''',
    '''  const isPendingTrend = !pick.bestPlayType && !isFinalReview;
  const isMlbTrendV2Pick =
    String(pick.selectorVersion || "").startsWith("mlb-trend-v2") ||
    String(pick.candidateId || "").startsWith("v2|");
  const showGapOnly = isMlbTrendV2Pick;
  const displayedTrendGap = Number(pick.estimatedAdvantage);''',
    "identify all MLB V2 cards",
)
page = replace_once(page, '        {isPendingTrend ? (', '        {showGapOnly ? (', "show gap for final and pending V2")
page = page.replace('pendingTrendGap.toFixed(1)', 'displayedTrendGap.toFixed(1)', 1)
page = page.replace('Number.isFinite(pendingTrendGap)', 'Number.isFinite(displayedTrendGap)', 1)
page = page.replace('!isPendingTrend && researchSummary', '!showGapOnly && researchSummary', 1)
page = page.replace('!isPendingTrend && verdict', '!showGapOnly && verdict', 1)
page = page.replace('        {!isPendingTrend ? (', '        {!showGapOnly ? (', 1)

# Required end-state assertions make this repair safe to re-run and catch future regressions.
route_required = [
    "MLB_TREND_V2_MAX_DAILY_PICKS",
    "capMlbV2Locks(dailyPicks,today)",
    "todayLocks.length+newLocks.length<MLB_TREND_V2_MAX_DAILY_PICKS",
    ".slice(0,remainingV2Slots)",
    "!isLaunchOrLater(pick?.date||today)",
    "trendV2DailyMaxPicks:MLB_TREND_V2_MAX_DAILY_PICKS",
]
page_required = [
    "const showGapOnly = isMlbTrendV2Pick;",
    "displayedTrendGap.toFixed(1)",
    "!showGapOnly && researchSummary",
    "!showGapOnly && verdict",
    "{!showGapOnly ? (",
]
missing_route = [item for item in route_required if item not in route]
missing_page = [item for item in page_required if item not in page]
if missing_route or missing_page:
    raise SystemExit(f"Repair validation failed. route={missing_route}; page={missing_page}")

# No current V2 route should retain the uncapped migration loop/status.
for forbidden in ["while(true){", "trendV2AllAboveThreshold:true"]:
    if forbidden in route:
        raise SystemExit(f"Uncapped MLB V2 marker still present: {forbidden}")

ROUTE.write_text(route)
PAGE.write_text(page)
print("MLB EZPZ repaired: max 2 current V2 picks, no post-launch legacy merge, GAP-only V2 tiles.")
