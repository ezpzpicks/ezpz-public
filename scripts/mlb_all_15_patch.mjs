import fs from "node:fs";

const modelPath = "lib/mlbTrendV2.ts";
const routePath = "app/api/public-data-v2/route.ts";

let model = fs.readFileSync(modelPath, "utf8");
let route = fs.readFileSync(routePath, "utf8");

function replaceOnce(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Missing patch anchor: ${label}`);
  return source.replace(from, to);
}

model = replaceOnce(
  model,
  'export const MLB_TREND_V2_EARLY_GAP = 20;',
  'export const MLB_TREND_V2_EARLY_GAP = 15;',
  'early threshold 20 -> 15',
);

route = replaceOnce(
  route,
  '  MLB_TREND_V2_EARLY_GAP, MLB_TREND_V2_LAUNCH_DATE, MLB_TREND_V2_MAX_DAILY_PICKS,\n',
  '  MLB_TREND_V2_EARLY_GAP, MLB_TREND_V2_LAUNCH_DATE,\n',
  'remove max-picks import',
);

route = replaceOnce(
  route,
  '  const rule=decision.earlyPremium?`Early-half slate premium cleared: V2 Market Gap ${play.v2MarketGap.toFixed(1)} >= ${decision.threshold.toFixed(0)}`:`Back-half normal threshold cleared: V2 Market Gap ${play.v2MarketGap.toFixed(1)} >= ${decision.threshold.toFixed(0)}`;',
  '  const rule=`15% threshold cleared: V2 Market Gap ${play.v2MarketGap.toFixed(1)} >= ${decision.threshold.toFixed(0)}`;',
  'single 15% rule text',
);

route = replaceOnce(
  route,
  'whySelected:[rule,marketGuard,`Maximum ${MLB_TREND_V2_MAX_DAILY_PICKS} Trend v2 EZPZ Picks are allowed per MLB date`]',
  'whySelected:[rule,marketGuard,"Every otherwise-eligible MLB Trend v2 play with a V2 Market Gap of 15% or greater is an EZPZ Pick"]',
  'all-above-15 why selected',
);

route = replaceOnce(
  route,
  'payload.trendV2={version:MLB_TREND_V2_VERSION,launchDate:MLB_TREND_V2_LAUNCH_DATE,normalGap:MLB_TREND_V2_NORMAL_GAP,earlyGap:MLB_TREND_V2_EARLY_GAP,maxDailyPicks:MLB_TREND_V2_MAX_DAILY_PICKS,decisionWindowMinutes:MLB_TREND_V2_DECISION_WINDOW_MINUTES,thresholdRule:"20% for the first half of unique game-start blocks; 15% from the midpoint through the final block",note:"V2 Ranking Probability and Market Gap are ranking diagnostics, not calibrated win probabilities.",adaptiveLifecycle:adaptive.lifecycle};',
  'payload.trendV2={version:MLB_TREND_V2_VERSION,launchDate:MLB_TREND_V2_LAUNCH_DATE,normalGap:MLB_TREND_V2_NORMAL_GAP,earlyGap:MLB_TREND_V2_EARLY_GAP,allAboveThreshold:true,decisionWindowMinutes:MLB_TREND_V2_DECISION_WINDOW_MINUTES,thresholdRule:"Every otherwise-eligible MLB Trend v2 play with V2 Market Gap >= 15% locks as an EZPZ Pick",note:"V2 Ranking Probability and Market Gap are ranking diagnostics, not calibrated win probabilities.",adaptiveLifecycle:adaptive.lifecycle};',
  'metadata all-above-15 rule',
);

route = replaceOnce(
  route,
  '  if(isV2ScheduledCapture(request)&&today>=MLB_TREND_V2_LAUNCH_DATE&&todayLocks.length<MLB_TREND_V2_MAX_DAILY_PICKS){',
  '  if(isV2ScheduledCapture(request)&&today>=MLB_TREND_V2_LAUNCH_DATE){',
  'remove daily cap gate',
);

route = replaceOnce(
  route,
  '    while(todayLocks.length+newLocks.length<MLB_TREND_V2_MAX_DAILY_PICKS){',
  '    while(true){',
  'remove daily cap loop',
);

const statusStart = '  const remaining=Math.max(0,MLB_TREND_V2_MAX_DAILY_PICKS-lockedCount);\n  const trendMessage=lockedCount>=MLB_TREND_V2_MAX_DAILY_PICKS\n    ? `MLB Trend v2 daily max reached (${lockedCount}/${MLB_TREND_V2_MAX_DAILY_PICKS}): ${lockedNames}.`\n    : lockedCount>0\n      ? `MLB Trend v2 ${lockedCount}/${MLB_TREND_V2_MAX_DAILY_PICKS} locked: ${lockedNames}. ${remaining} slot${remaining===1?"":"s"} remain; another play must independently clear its threshold.`\n      : filteredAiPicks.length\n        ? `HOT Best Plays are final; MLB Trend v2 is ranking the slate for up to ${MLB_TREND_V2_MAX_DAILY_PICKS} daily trend picks.`\n        : `MLB Trend v2 is ranking the slate. Up to ${MLB_TREND_V2_MAX_DAILY_PICKS} daily trend picks may lock, but none are forced.`;';
const statusReplacement = '  const trendMessage=lockedCount>0\n    ? `MLB Trend v2 has ${lockedCount} locked 15%+ pick${lockedCount===1?"":"s"}: ${lockedNames}. Every additional otherwise-eligible play that reaches 15% will also lock.`\n    : filteredAiPicks.length\n      ? `HOT Best Plays are final; MLB Trend v2 will lock every otherwise-eligible play that reaches a 15% Market Gap.`\n      : `MLB Trend v2 is tracking the slate. Every otherwise-eligible play that reaches a 15% Market Gap will lock as an EZPZ Pick.`;';
route = replaceOnce(route, statusStart, statusReplacement, 'uncapped status message');

route = replaceOnce(
  route,
  'trendV2DailyLockedCount:lockedCount,trendV2DailyMaxPicks:MLB_TREND_V2_MAX_DAILY_PICKS',
  'trendV2DailyLockedCount:lockedCount,trendV2AllAboveThreshold:true,trendV2Threshold:15',
  'status metadata',
);

fs.writeFileSync(modelPath, model);
fs.writeFileSync(routePath, route);
console.log("Patched MLB Trend V2 to lock every eligible play at 15%+ Market Gap.");
