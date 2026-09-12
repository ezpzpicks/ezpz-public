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
  'pendingResolutionSnapshotRowsToAppend(',
  'durablePendingIds.has(v2CandidateIdentity(play))',
  'function recoveryPendingV2PickObject(',
  'function unresolvedPendingSnapshotDecisions(',
  'snapshotIsFreshForLock(row,start)',
  'RECOVERY OPEN — saved pregame PENDING state',
  'const recoveryPendingV2Picks:AnyRow[]=[];',
  'const pendingV2Picks=[...livePendingV2Picks,...recoveryPendingV2Picks];',
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
const recoveryDisplayHelperStart = route.indexOf("function recoveryPendingV2PickObject(");
const recoveryDisplayHelperEnd = route.indexOf("function dailyPickRow(", recoveryDisplayHelperStart);
if (recoveryDisplayHelperStart < 0 || recoveryDisplayHelperEnd < 0) {
  throw new Error("Recovery-window PENDING display helper is missing");
}
const recoveryDisplayHelper = route.slice(recoveryDisplayHelperStart, recoveryDisplayHelperEnd);
if (recoveryDisplayHelper.includes("start<=nowMs") || recoveryDisplayHelper.includes("currentQualifier")) {
  throw new Error("Recovery-window PENDING cards must come only from the saved pregame decision");
}
const recoveryDisplayCall = route.lastIndexOf("unresolvedPendingSnapshotDecisions(snapshotRows,slateRows,today,nowMs,recoveryPendingGames)");
if (recoveryDisplayCall < lateRecoveryEnd || !route.slice(recoveryDisplayCall).includes("recoveryPendingGames.add(gameKey)")) {
  throw new Error("Saved PENDING cards are not kept visible after start with the one-pick-per-game guard");
}
if (!route.includes("Once it\n    // is FINAL, later refreshes must not rewrite or remove that frozen decision.")) {
  throw new Error("Finalized picks are not protected from later snapshot reconciliation");
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

const recoveryStartMs = Date.parse("2026-09-11T23:10:00Z");
const compiledRoute = ts.transpileModule(
  `${route}\nexport { currentLocksForToday, latePendingSnapshotDecisions, pendingQualifierSnapshotRowsToAppend, pendingResolutionSnapshotRowsToAppend, recoveryPendingV2PickObject, unresolvedPendingSnapshotDecisions };`,
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText;
const loadedRoute = { exports: {} };
vm.runInNewContext(compiledRoute, {
  module: loadedRoute,
  exports: loadedRoute.exports,
  require(specifier) {
    if (specifier === "next/server") return { NextResponse: { json: (value) => value } };
    if (specifier === "../public-data/route") return { GET: async () => ({}) };
    if (specifier === "../../../lib/mlbTrendV2") {
      return {
        MLB_TREND_V2_DECISION_WINDOW_MINUTES: 15,
        MLB_TREND_V2_LAUNCH_DATE: "2026-09-07",
        MLB_TREND_V2_NORMAL_GAP: 15,
        MLB_TREND_V2_SELECTION_POLICY: "mlb-trend-v2-rlm-only-2026-09-10",
        MLB_TREND_V2_VERSION: "mlb-trend-v2-test",
        isoDate: (value) => String(value || "").slice(0, 10),
        mlbTrendV2RlmStatus: () => "RLM_SUPPORT",
        mlbTrendV2SelectionGate: (play) => Number(play?.v2MarketGap) >= 15,
        nowET: () => "9/11/2026, 7:15 PM ET",
        parseGameStart: () => recoveryStartMs,
        selectionThresholdForPlay: () => ({ threshold: 15, earlyPremium: false }),
      };
    }
    if (specifier === "../../../lib/mlbTrendV2Store") {
      return { appendV2Rows: async () => {}, readV2Tab: async () => [], replaceV2DailyRows: async () => {} };
    }
    if (specifier === "../../../lib/mlbTrendV2Lifecycle") return { applyMlbTrendV2Adaptive: async () => ({ plays: [] }) };
    throw new Error(`Unexpected route import: ${specifier}`);
  },
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

const recoveryPlay = {
  recordDate: "2026-09-11",
  v2GameKey: "yankees-mets",
  v2GameTime: "7:10 PM",
  game: "New York Yankees @ New York Mets",
  awayTeam: "New York Yankees",
  homeTeam: "New York Mets",
  market: "Total",
  selection: "Under",
  side: "Under",
  line: 8.5,
  odds: "-110",
  v2Tier: "Elite",
  v2Score: 90,
  v2Probability: 60,
  v2ImpliedProbability: 52.4,
  v2MarketGap: 17.6,
  v2ModelVersion: "mlb-trend-v2-test",
  v2LegacyAgreement: true,
  v2DataComplete: true,
  v2DailyEligible: true,
  v2Direction: true,
  v2DailyRank: 1,
  legacyScore: 78,
  legacyTier: "Strong",
};
const snapshot = (play, epoch, pendingEzpzCandidate = false) => ({
  Date: "2026-09-11",
  "Game Key": "yankees-mets",
  "Game Time": "7:10 PM",
  Market: play.market,
  Selection: play.selection,
  Side: play.side,
  Line: play.line,
  Odds: play.odds,
  "V2 Market Gap": play.v2MarketGap,
  "V2 Direction": play.v2Direction ? "TRUE" : "FALSE",
  "Daily Eligible": play.v2DailyEligible ? "TRUE" : "FALSE",
  "Minutes To Start": (recoveryStartMs - epoch) / 60_000,
  "Details JSON": JSON.stringify({ ...play, snapshotEpoch: epoch, pendingEzpzCandidate }),
});

// Mirrors the Phillies-Braves regression: Over 8.5 was visibly PENDING early,
// then a 93-minute-old Over 8 row became the latest stored market row. That
// stale row must neither finalize nor erase the saved PENDING card at game time.
const earlyPending = snapshot(recoveryPlay, recoveryStartMs - 128 * 60_000, true);
const staleDifferentLinePlay = {
  ...recoveryPlay,
  selection: "Under",
  side: "Under",
  line: 8,
  odds: "-118",
  v2MarketGap: 14.4,
  v2DailyEligible: false,
};
const staleDifferentLine = snapshot(staleDifferentLinePlay, recoveryStartMs - 93 * 60_000);
const staleRows = [earlyPending, staleDifferentLine];
const afterStartMs = recoveryStartMs + 2 * 60_000;

const staleFinalDecisions = loadedRoute.exports.latePendingSnapshotDecisions(
  staleRows,
  [],
  "2026-09-11",
  afterStartMs,
  new Set(),
);
assert.equal(staleFinalDecisions.length, 0);
const unresolved = loadedRoute.exports.unresolvedPendingSnapshotDecisions(
  staleRows,
  [],
  "2026-09-11",
  afterStartMs,
  new Set(),
);
assert.equal(unresolved.length, 1);
assert.equal(unresolved[0].play.line, 8.5);
const recoveryPendingPick = loadedRoute.exports.recoveryPendingV2PickObject(
  unresolved[0],
  "2026-09-11",
  afterStartMs,
);
assert.equal(recoveryPendingPick.snapshotStatus, "LIVE");
assert.equal(recoveryPendingPick.lockedAt, "");
assert.equal(recoveryPendingPick.recoveryPendingFromSavedSnapshot, true);
assert.equal(recoveryPendingPick.v2LockedEpoch, undefined);
assert.match(recoveryPendingPick.verdict, /^PENDING RECOVERY/);
assert.ok(recoveryPendingPick.dataStatus.includes("RECOVERY OPEN — saved pregame PENDING state"));

// The public refresh is allowed to supply the missing lock snapshot, but only
// for a game whose exact candidate was explicitly PENDING before first pitch.
const resolutionRows = loadedRoute.exports.pendingResolutionSnapshotRowsToAppend(
  [recoveryPlay],
  staleRows,
  "2026-09-11",
  afterStartMs,
);
assert.equal(resolutionRows.length, 1);
const resolvedRows = [...staleRows, ...resolutionRows];
const recoveredFinal = loadedRoute.exports.latePendingSnapshotDecisions(
  resolvedRows,
  [],
  "2026-09-11",
  afterStartMs,
  new Set(),
);
assert.equal(recoveredFinal.length, 1);
assert.equal(recoveredFinal[0].play.line, 8.5);
assert.equal(loadedRoute.exports.unresolvedPendingSnapshotDecisions(resolvedRows, [], "2026-09-11", afterStartMs, new Set()).length, 0);

// A fresh changed/below-threshold snapshot resolves the wait without reviving
// the older candidate or creating a new in-game pick.
const invalidatingRows = loadedRoute.exports.pendingResolutionSnapshotRowsToAppend(
  [staleDifferentLinePlay],
  staleRows,
  "2026-09-11",
  afterStartMs,
);
assert.equal(invalidatingRows.length, 1);
const invalidatedRows = [...staleRows, ...invalidatingRows];
assert.equal(loadedRoute.exports.latePendingSnapshotDecisions(invalidatedRows, [], "2026-09-11", afterStartMs, new Set()).length, 0);
assert.equal(loadedRoute.exports.unresolvedPendingSnapshotDecisions(invalidatedRows, [], "2026-09-11", afterStartMs, new Set()).length, 0);

// An early marker for the same candidate is refreshed once inside T-15 so the
// lock can never be decided by an hours-old row again.
const refreshedPendingRows = loadedRoute.exports.pendingQualifierSnapshotRowsToAppend(
  new Map([["yankees-mets", recoveryPlay]]),
  [earlyPending],
  recoveryStartMs - 5 * 60_000,
);
assert.equal(refreshedPendingRows.length, 1);
assert.equal(JSON.parse(refreshedPendingRows[0]["Details JSON"]).pendingEzpzCandidate, true);

// Once saved as FINAL, later market movement cannot make the pick disappear.
const finalPick = {
  candidateId: "v2|2026-09-11|yankees-mets|total|under|8.5",
  date: "2026-09-11",
  gameKey: "yankees-mets",
  gameTime: "7:10 PM",
  market: "Total",
  play: "Under 8.5",
  selection: "Under",
  line: "8.5",
  v2MarketGap: 17.6,
  snapshotStatus: "FINAL_PREGAME",
};
assert.equal(loadedRoute.exports.currentLocksForToday([finalPick], "2026-09-11", afterStartMs).length, 1);

console.log("Validated MLB EZPZ policy: 15% plus RLM Support/Strong RLM Support, one pick per game, no slate cap, stale snapshots preserve PENDING visibility, and the first usable lock snapshot freezes the result.");
