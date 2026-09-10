import fs from "node:fs";

const modelPath = "lib/mlbTrendV2.ts";
const routePath = "app/api/public-data-v2/route.ts";
const pagePath = "app/page.tsx";

let model = fs.readFileSync(modelPath, "utf8");
let route = fs.readFileSync(routePath, "utf8");
let page = fs.readFileSync(pagePath, "utf8");

function replaceRequired(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Missing patch anchor: ${label}`);
  return source.replace(from, to);
}

// One threshold, no daily cap.
model = model.replace('export const MLB_TREND_V2_EARLY_GAP = 20;', 'export const MLB_TREND_V2_EARLY_GAP = 15;');
model = model.replace('export const MLB_TREND_V2_MAX_DAILY_PICKS = 2;\n', '');
if (!model.includes('export const MLB_TREND_V2_NORMAL_GAP = 15;') || !model.includes('export const MLB_TREND_V2_EARLY_GAP = 15;')) {
  throw new Error('MLB V2 15% threshold constants are not in the expected state');
}

route = route.replace(
  '  MLB_TREND_V2_EARLY_GAP, MLB_TREND_V2_LAUNCH_DATE, MLB_TREND_V2_MAX_DAILY_PICKS,\n',
  '  MLB_TREND_V2_EARLY_GAP, MLB_TREND_V2_LAUNCH_DATE,\n',
);
route = route.replace(
  '`Up to ${MLB_TREND_V2_MAX_DAILY_PICKS} MLB Trend v2 EZPZ Picks are allowed per date; each must clear a 15% V2 Market Gap`',
  '"Every otherwise-eligible MLB Trend v2 play with a V2 Market Gap of 15% or greater is an EZPZ Pick"',
);

// Remove the accidental max-two helper if present.
route = route.replace(/function mlbV2PickGap\(pick:AnyRow\)[\s\S]*?function capMlbV2Locks\(picks:AnyRow\[],date:string\)[^\n]*\n\n/, '');

route = replaceRequired(
  route,
  '  payload.trendV2={version:MLB_TREND_V2_VERSION,launchDate:MLB_TREND_V2_LAUNCH_DATE,normalGap:MLB_TREND_V2_NORMAL_GAP,earlyGap:MLB_TREND_V2_EARLY_GAP,maxDailyPicks:MLB_TREND_V2_MAX_DAILY_PICKS,decisionWindowMinutes:MLB_TREND_V2_DECISION_WINDOW_MINUTES,thresholdRule:"Up to 2 MLB Trend v2 EZPZ Picks may be shown per date; each must independently clear a 15% V2 Market Gap. Saved pregame PENDING qualifiers may still finalize on a later run if a slot remains",note:"Late finalization uses the last saved pregame pending snapshot, never in-game market data. V2 Ranking Probability and Market Gap are ranking diagnostics, not calibrated win probabilities.",adaptiveLifecycle:adaptive.lifecycle};',
  '  payload.trendV2={version:MLB_TREND_V2_VERSION,launchDate:MLB_TREND_V2_LAUNCH_DATE,normalGap:MLB_TREND_V2_NORMAL_GAP,earlyGap:MLB_TREND_V2_EARLY_GAP,allAboveThreshold:true,decisionWindowMinutes:MLB_TREND_V2_DECISION_WINDOW_MINUTES,thresholdRule:"Every otherwise-eligible MLB Trend v2 play with V2 Market Gap >= 15% locks as an EZPZ Pick; a saved pregame PENDING qualifier may finalize on a later run even after scheduled start",note:"Late finalization uses the last saved pregame pending snapshot, never in-game market data. V2 Ranking Probability and Market Gap are ranking diagnostics, not calibrated win probabilities.",adaptiveLifecycle:adaptive.lifecycle};',
  'uncapped metadata',
);

route = route.replace('  let todayLocks=capMlbV2Locks(dailyPicks,today);', '  let todayLocks=dailyPicks.filter(pick=>isoDate(pick.date)===today);');
route = route.replace(
  '  if(isV2ScheduledCapture(request)&&today>=MLB_TREND_V2_LAUNCH_DATE&&todayLocks.length<MLB_TREND_V2_MAX_DAILY_PICKS){',
  '  if(isV2ScheduledCapture(request)&&today>=MLB_TREND_V2_LAUNCH_DATE){',
);
route = route.replace(
  '    while(todayLocks.length+newLocks.length<MLB_TREND_V2_MAX_DAILY_PICKS){',
  '    while(true){',
);
route = route.replace('      if(todayLocks.length+newLocks.length>=MLB_TREND_V2_MAX_DAILY_PICKS)break;\n', '');
route = route.replace('  todayLocks=capMlbV2Locks(dailyPicks,today);', '  todayLocks=dailyPicks.filter(pick=>isoDate(pick.date)===today);');

// Keep the useful cleanup from the previous repair: current MLB EZPZ cards are V2 only.
if (!route.includes('const filteredAiPicks=legacyAiPicks.filter((pick:AnyRow)=>!isLaunchOrLater(pick?.date||today));')) {
  route = route.replace(
    'const filteredAiPicks=legacyAiPicks.filter((pick:AnyRow)=>!(isLaunchOrLater(pick?.date||today)&&pureLegacyTrendPick(pick)));',
    'const filteredAiPicks=legacyAiPicks.filter((pick:AnyRow)=>!isLaunchOrLater(pick?.date||today));',
  );
}

route = route.replace('  const remainingV2Slots=Math.max(0,MLB_TREND_V2_MAX_DAILY_PICKS-todayLocks.length);\n', '');
route = route.replace(
  '    .filter((pick)=>!lockedIds.has(String(pick.candidateId||"")))\n    .sort((a,b)=>mlbV2PickGap(b)-mlbV2PickGap(a))\n    .slice(0,remainingV2Slots);',
  '    .filter((pick)=>!lockedIds.has(String(pick.candidateId||"")));',
);
route = route.replace(
  '  const displayedDailyPicks=dailyPicks.filter((pick:AnyRow)=>isoDate(pick.date)!==today||lockedIds.has(String(pick.candidateId||"")));\n  payload.aiPickRecordRows=[...filteredRecordRows,...displayedDailyPicks];',
  '  payload.aiPickRecordRows=[...filteredRecordRows,...dailyPicks];',
);

const cappedStatus = `  const totalV2Shown=lockedCount+pendingCount;\n  const trendMessage=pendingCount>0\n    ? \`MLB Trend v2 is showing \${totalV2Shown}/\${MLB_TREND_V2_MAX_DAILY_PICKS} daily slots: \${pendingCount} PENDING 15%+ qualifier\${pendingCount===1?"":"s"}\${lockedCount?\` and \${lockedCount} FINAL\`:""}.\`\n    : lockedCount>0\n      ? \`MLB Trend v2 has \${lockedCount}/\${MLB_TREND_V2_MAX_DAILY_PICKS} FINAL daily pick\${lockedCount===1?"":"s"}. Each cleared the 15% V2 Market Gap threshold.\`\n      : \`MLB Trend v2 is tracking the slate. Up to \${MLB_TREND_V2_MAX_DAILY_PICKS} daily picks may qualify; each must clear a 15% V2 Market Gap.\`;\n  payload.aiSelectorStatus={...status,mode:finalCount===filteredAiPicks.length&&filteredAiPicks.length?"FINAL_PREGAME":"LIVE_PREVIEW",message:trendMessage,updatedAt:nowET(),candidateCount:Number(status.candidateCount||0)+scored.filter(play=>play.v2Direction).length,selectedCount:filteredAiPicks.length,trendV2DailyLocked:Boolean(lockedCount),trendV2DailyLockedCount:lockedCount,trendV2DailyMaxPicks:MLB_TREND_V2_MAX_DAILY_PICKS,trendV2Threshold:15};`;
const uncappedStatus = `  const trendMessage=pendingCount>0\n    ? \`MLB Trend v2 has \${pendingCount} PENDING 15%+ qualifier\${pendingCount===1?"":"s"} awaiting the next lock run: \${pendingNames}.\${lockedCount?\` \${lockedCount} pick\${lockedCount===1?" is":"s are"} already FINAL: \${lockedNames}.\`:""}\`\n    : lockedCount>0\n      ? \`MLB Trend v2 has \${lockedCount} FINAL 15%+ pick\${lockedCount===1?"":"s"}: \${lockedNames}. Every additional otherwise-eligible play that reaches 15% will also qualify.\`\n      : \`MLB Trend v2 is tracking the slate. Every otherwise-eligible play that reaches a 15% V2 Market Gap qualifies as an EZPZ Pick.\`;\n  payload.aiSelectorStatus={...status,mode:finalCount===filteredAiPicks.length&&filteredAiPicks.length?"FINAL_PREGAME":"LIVE_PREVIEW",message:trendMessage,updatedAt:nowET(),candidateCount:Number(status.candidateCount||0)+scored.filter(play=>play.v2Direction).length,selectedCount:filteredAiPicks.length,trendV2DailyLocked:Boolean(lockedCount),trendV2DailyLockedCount:lockedCount,trendV2AllAboveThreshold:true,trendV2Threshold:15};`;
if (route.includes(cappedStatus)) route = route.replace(cappedStatus, uncappedStatus);
if (!route.includes('trendV2AllAboveThreshold:true')) throw new Error('Uncapped selector status was not applied');

// Ensure all MLB V2 cards, FINAL and PENDING, use the same GAP-only details.
if (!page.includes('const showGapOnly = isMlbTrendV2Pick;')) {
  page = replaceRequired(
    page,
    '  const isPendingTrend = !pick.bestPlayType && !isFinalReview;\n  const pendingTrendGap = Number(pick.estimatedAdvantage);',
    '  const isPendingTrend = !pick.bestPlayType && !isFinalReview;\n  const isMlbTrendV2Pick =\n    String(pick.selectorVersion || "").startsWith("mlb-trend-v2") ||\n    String(pick.candidateId || "").startsWith("v2|");\n  const showGapOnly = isMlbTrendV2Pick;\n  const displayedTrendGap = Number(pick.estimatedAdvantage);',
    'identify MLB V2 cards',
  );
  page = page.replace('        {isPendingTrend ? (', '        {showGapOnly ? (');
  page = page.replace('Number.isFinite(pendingTrendGap)', 'Number.isFinite(displayedTrendGap)');
  page = page.replace('pendingTrendGap.toFixed(1)', 'displayedTrendGap.toFixed(1)');
  page = page.replaceAll('!isPendingTrend &&', '!showGapOnly &&');
  page = page.replace('        {!isPendingTrend ? (', '        {!showGapOnly ? (');
}

for (const forbidden of ['MLB_TREND_V2_MAX_DAILY_PICKS', 'capMlbV2Locks(', 'remainingV2Slots', 'trendV2DailyMaxPicks']) {
  if (route.includes(forbidden)) throw new Error(`Daily cap marker still present in route: ${forbidden}`);
}
if (!route.includes('while(true){')) throw new Error('Uncapped lock loop missing');
if (!route.includes('allAboveThreshold:true')) throw new Error('Uncapped threshold metadata missing');
if (!route.includes('const filteredAiPicks=legacyAiPicks.filter((pick:AnyRow)=>!isLaunchOrLater(pick?.date||today));')) throw new Error('Legacy current-pick cleanup missing');
if (!page.includes('const showGapOnly = isMlbTrendV2Pick;') || !page.includes('displayedTrendGap.toFixed(1)')) throw new Error('MLB V2 GAP-only UI missing');

fs.writeFileSync(modelPath, model);
fs.writeFileSync(routePath, route);
fs.writeFileSync(pagePath, page);
console.log('MLB EZPZ policy enforced: every eligible 15%+ V2 play qualifies; no daily cap; V2-only current cards; GAP-only tile details.');
