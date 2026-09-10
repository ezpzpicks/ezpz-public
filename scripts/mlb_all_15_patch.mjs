import fs from "node:fs";

const model = fs.readFileSync("lib/mlbTrendV2.ts", "utf8");
const route = fs.readFileSync("app/api/public-data-v2/route.ts", "utf8");
const page = fs.readFileSync("app/page.tsx", "utf8");

const requiredModelMarkers = [
  'export const MLB_TREND_V2_NORMAL_GAP = 15;',
  'export const MLB_TREND_V2_EARLY_GAP = 15;',
];

const requiredRouteMarkers = [
  'function currentQualifierByGame(',
  'function currentLocksForToday(',
  'const lockedGames=new Set(',
  'trendV2MaxPerGame:1',
  'trendV2NoSlateMaximum:true',
  'maxPerGame:1',
  'noSlateMaximum:true',
  'there is no slate maximum',
];

for (const marker of requiredModelMarkers) {
  if (!model.includes(marker)) throw new Error(`Missing MLB threshold policy marker: ${marker}`);
}

for (const marker of requiredRouteMarkers) {
  if (!route.includes(marker)) throw new Error(`Missing MLB one-pick-per-game policy marker: ${marker}`);
}

for (const forbidden of [
  "MLB_TREND_V2_MAX_DAILY_PICKS",
  "capMlbV2Locks(",
  "remainingV2Slots",
  "trendV2DailyMaxPicks",
  "lockedPairs",
]) {
  if (route.includes(forbidden)) throw new Error(`Obsolete MLB slate-cap marker remains: ${forbidden}`);
}

if (!page.includes("const showGapOnly = isMlbTrendV2Pick;") || !page.includes("displayedTrendGap.toFixed(1)")) {
  throw new Error("MLB V2 GAP-only tile display is missing");
}

console.log("Validated MLB EZPZ policy: 15% threshold, one highest-gap pick per game, and no slate-wide maximum.");
