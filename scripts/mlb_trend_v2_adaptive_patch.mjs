import fs from "node:fs";

const path = "app/api/public-data-v2/route.ts";
let source = fs.readFileSync(path, "utf8");

const importNeedle = 'import { appendV2Rows, readV2Tab, replaceV2DailyRows } from "../../../lib/mlbTrendV2Store";';
const adaptiveImport = 'import { applyMlbTrendV2Adaptive } from "../../../lib/mlbTrendV2Lifecycle";';
if (!source.includes(adaptiveImport)) {
  if (!source.includes(importNeedle)) throw new Error("Could not find MLB Trend V2 store import anchor.");
  source = source.replace(importNeedle, `${importNeedle}\n${adaptiveImport}`);
}

const oldScore = 'const scored=annotateLiveV2Status(scoreTrendBoardV2(Array.isArray(payload.trendPlays)?payload.trendPlays:[],slateRows),slateRows,nowMs);';
const newScore = 'const baselineScored=scoreTrendBoardV2(Array.isArray(payload.trendPlays)?payload.trendPlays:[],slateRows);\n  const adaptive=await applyMlbTrendV2Adaptive(baselineScored);\n  const scored=annotateLiveV2Status(adaptive.plays,slateRows,nowMs);';
if (source.includes(oldScore)) source = source.replace(oldScore, newScore);
else if (!source.includes('const adaptive=await applyMlbTrendV2Adaptive(baselineScored);')) throw new Error("Could not find MLB Trend V2 scoring anchor.");

const metadataNeedle = 'note:"V2 Ranking Probability and Market Gap are ranking diagnostics, not calibrated win probabilities."};';
const metadataReplacement = 'note:"V2 Ranking Probability and Market Gap are ranking diagnostics, not calibrated win probabilities.",adaptiveLifecycle:adaptive.lifecycle};';
if (source.includes(metadataNeedle)) source = source.replace(metadataNeedle, metadataReplacement);
else if (!source.includes('adaptiveLifecycle:adaptive.lifecycle')) throw new Error("Could not find MLB Trend V2 metadata anchor.");

const snapshotVersionNeedle = '"Model Version":MLB_TREND_V2_VERSION,"Details JSON":JSON.stringify({...play,snapshotEpoch:nowMs})';
const snapshotVersionReplacement = '"Model Version":String(play.v2ModelVersion||MLB_TREND_V2_VERSION),"Details JSON":JSON.stringify({...play,snapshotEpoch:nowMs})';
if (source.includes(snapshotVersionNeedle)) source = source.replace(snapshotVersionNeedle, snapshotVersionReplacement);

const lockedVersionNeedle = 'v2Probability:play.v2Probability,v2LockedEpoch:nowMs';
const lockedVersionReplacement = 'v2Probability:play.v2Probability,v2ModelVersion:String(play.v2ModelVersion||MLB_TREND_V2_VERSION),v2LockedEpoch:nowMs';
if (source.includes(lockedVersionNeedle)) source = source.replace(lockedVersionNeedle, lockedVersionReplacement);

fs.writeFileSync(path, source);
console.log("Integrated adaptive MLB Trend V2 lifecycle into public-data-v2 route.");
