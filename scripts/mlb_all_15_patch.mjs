import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const model = fs.readFileSync("lib/mlbTrendV2.ts", "utf8");
const route = fs.readFileSync("app/api/public-data-v2/route.ts", "utf8");
const page = fs.readFileSync("app/page.tsx", "utf8");

const requiredModelMarkers = [
  'export const MLB_TREND_V2_NORMAL_GAP = 15;',
  'export const MLB_TREND_V2_EARLY_GAP = 15;',
  'mlb-trend-v2-rlm-only-2026-09-10',
  'status==="RLM_SUPPORT"||status==="STRONG_RLM_SUPPORT"',
  'v2RlmStatus:rlmStatus',
];

const requiredRouteMarkers = [
  'function currentQualifierByGame(',
  'function currentLocksForToday(',
  'const lockedGames=new Set(',
  'trendV2MaxPerGame:1',
  'trendV2NoSlateMaximum:true',
  'trendV2RequiresRlmSupport:true',
  'trendV2PregameFinalizationRequired:false',
  'pendingQualifierSnapshotRowsToAppend(',
  'durablePendingIds.has(v2CandidateIdentity(play))',
  'may finalize on a later run, including after start',
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
  "MLB_TREND_V2_TOTAL_SELECTIVE_GAP",
  "v2PrimaryLast7Roi",
  "primary-signal Last-7 ROI",
]) {
  if (route.includes(forbidden)) throw new Error(`Obsolete MLB policy marker remains: ${forbidden}`);
}

const lateRecoveryStart = route.indexOf("for(const decision of latePendingSnapshotDecisions(");
const lateRecoveryEnd = route.indexOf("if(rewriteRequired||newLocks.length){", lateRecoveryStart);
if (lateRecoveryStart < 0 || lateRecoveryEnd < 0) {
  throw new Error("Late PENDING recovery loop is missing");
}
const lateRecoveryLoop = route.slice(lateRecoveryStart, lateRecoveryEnd);
if (lateRecoveryLoop.includes("currentQualifier")) {
  throw new Error("Late recovery must use the saved PENDING state without rechecking post-start live qualification");
}
if (!route.includes("const started=start!=null&&start<=nowMs;") || !route.includes("if(!started&&(!qualifier||!sameV2Candidate(pick,qualifier)))continue;")) {
  throw new Error("Finalized picks are not protected from post-start live-data reconciliation");
}

if (!page.includes("const showGapOnly = isMlbTrendV2Pick;") || !page.includes("displayedTrendGap.toFixed(1)")) {
  throw new Error("MLB V2 GAP-only tile display is missing");
}

const compiled = ts.transpileModule(model, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const loaded = { exports: {} };
vm.runInNewContext(compiled, {
  module: loaded,
  exports: loaded.exports,
  require() { throw new Error("Unexpected import while loading MLB policy module"); },
  console,
  Date,
  Intl,
  Math,
  Set,
  Map,
  Number,
  String,
  Boolean,
  Array,
  Object,
  JSON,
  RegExp,
});

const { mlbTrendV2RlmStatus, mlbTrendV2SelectionGate, selectionThresholdForPlay } = loaded.exports;
const candidate = (gap, signals, market = "Moneyline") => ({
  market,
  v2MarketGap: gap,
  signals: signals.map((signalKey) => ({ signalKey })),
});

assert.equal(mlbTrendV2SelectionGate(candidate(15, ["REVERSE_LINE_MOVEMENT_SUPPORT"])), true);
assert.equal(mlbTrendV2SelectionGate(candidate(18, ["STRONG_REVERSE_LINE_MOVEMENT_SUPPORT"], "Total")), true);
assert.equal(mlbTrendV2SelectionGate(candidate(14.99, ["STRONG_REVERSE_LINE_MOVEMENT_SUPPORT"])), false);
assert.equal(mlbTrendV2SelectionGate(candidate(22, [])), false);
assert.equal(mlbTrendV2SelectionGate(candidate(22, ["STRONG_SHARP_SUPPORT"])), false);
assert.equal(mlbTrendV2SelectionGate(candidate(22, ["REVERSE_LINE_MOVEMENT_SUPPORT", "REVERSE_LINE_MOVEMENT_AGAINST"])), false);
assert.equal(mlbTrendV2RlmStatus(candidate(22, ["STRONG_REVERSE_LINE_MOVEMENT_SUPPORT"])), "STRONG_RLM_SUPPORT");
assert.equal(mlbTrendV2SelectionGate({ market: "Total", v2MarketGap: 16, signals: [{ signal: "Reverse Line Movement Support" }] }), true);
assert.equal(selectionThresholdForPlay(candidate(20, ["REVERSE_LINE_MOVEMENT_SUPPORT"], "Total"), Date.now(), []).threshold, 15);

console.log("Validated MLB EZPZ policy: 15% plus RLM Support/Strong RLM Support, one pick per game, no slate cap, and durable PENDING recovery after start.");
