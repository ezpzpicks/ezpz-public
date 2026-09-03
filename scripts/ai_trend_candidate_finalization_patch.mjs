import fs from "node:fs";

const path = "app/api/public-data/route.ts";
let text = fs.readFileSync(path, "utf8");
let changed = false;

// Final decisions are candidate-level, not game-level. A finalized Best Play
// must not prevent a different qualifying Trend Play from the same game from
// being created and finalized. A frozen Trend Play is itself an authoritative
// FINAL_PREGAME trigger, so it must not wait on a possibly cached daily_slate
// Public Data Status cell before finalizing.
const oldFinalizationBlock = `  const storedFinalGameKeys = new Set(
    storedToday
      .filter(
        (pick) =>
          pick.snapshotStatus === "FINAL_PREGAME" &&
          pick.externalReviewStatus === "NOT_REQUIRED",
      )
      .map((pick) => pick.gameKey),
  );
  const targetGameKeys = new Set(
    slateRows
      .filter((row) => {
        const gameKey = draftKingsGameKey(row);
        return (
          finalDraftKingsGameKeys.has(gameKey) ||
          slateHasFinalPregameSnapshot(row)
        );
      })
      .map((row) => draftKingsGameKey(row))
      .filter((key) => !storedFinalGameKeys.has(key)),
  );
  const targetCandidates = candidates.filter((candidate) => {
    if (!targetGameKeys.has(candidate.gameKey)) return false;`;

const newFinalizationBlock = `  const storedFinalCandidateIds = new Set(
    storedToday
      .filter((pick) => pick.snapshotStatus === "FINAL_PREGAME")
      .map((pick) => pick.candidateId),
  );
  const targetGameKeys = new Set(
    slateRows
      .filter((row) => {
        const gameKey = draftKingsGameKey(row);
        return (
          finalDraftKingsGameKeys.has(gameKey) ||
          slateHasFinalPregameSnapshot(row)
        );
      })
      .map((row) => draftKingsGameKey(row)),
  );
  const targetCandidates = candidates.filter((candidate) => {
    const hasFrozenTrendSnapshot =
      candidate.trendPlay?.snapshotStatus === "FINAL_PREGAME";
    if (!targetGameKeys.has(candidate.gameKey) && !hasFrozenTrendSnapshot) return false;
    if (storedFinalCandidateIds.has(candidate.candidateId)) return false;`;

if (text.includes(oldFinalizationBlock)) {
  text = text.replace(oldFinalizationBlock, newFinalizationBlock);
  changed = true;
} else if (!text.includes("const storedFinalCandidateIds = new Set(")) {
  throw new Error("Trend candidate finalization target not found");
}

// Upgrade an already candidate-level build that predates the frozen-trend
// trigger. This keeps the patch resilient if an earlier build step has already
// converted the game lock before this script runs.
const oldCandidateTrigger = `  const targetCandidates = candidates.filter((candidate) => {
    if (!targetGameKeys.has(candidate.gameKey)) return false;
    if (storedFinalCandidateIds.has(candidate.candidateId)) return false;`;
const newCandidateTrigger = `  const targetCandidates = candidates.filter((candidate) => {
    const hasFrozenTrendSnapshot =
      candidate.trendPlay?.snapshotStatus === "FINAL_PREGAME";
    if (!targetGameKeys.has(candidate.gameKey) && !hasFrozenTrendSnapshot) return false;
    if (storedFinalCandidateIds.has(candidate.candidateId)) return false;`;
if (text.includes(oldCandidateTrigger)) {
  text = text.replace(oldCandidateTrigger, newCandidateTrigger);
  changed = true;
} else if (!text.includes("const hasFrozenTrendSnapshot =")) {
  throw new Error("Frozen Trend Play finalization trigger target not found");
}

// Do not allow a frozen Strong/Elite Trend Play to vanish silently. Every such
// candidate must produce a terminal FINAL_PREGAME selector row (selected or
// rejected with a reason), even if the normal game-level tracking handoff was
// missed. The durable trend snapshot is authoritative and remains eligible for
// recovery after first pitch.
const oldRecoveryGrace = `    const withinRecoveryGrace =
      start == null || selectorNow <= start + AI_FINAL_PREGAME_RECOVERY_GRACE_MS;
    if (
      withinRecoveryGrace &&
      (hasDedicatedFinalMarketSnapshot || hasFrozenTrendSnapshot)
    ) {`;
const newRecoveryGrace = `    const frozenStrongOrEliteTrend = Boolean(
      hasFrozenTrendSnapshot &&
      (candidate.trendPlay?.tier === "Strong" || candidate.trendPlay?.tier === "Elite")
    );
    const withinRecoveryGrace =
      start == null || selectorNow <= start + AI_FINAL_PREGAME_RECOVERY_GRACE_MS;
    if (
      (withinRecoveryGrace || frozenStrongOrEliteTrend) &&
      (hasDedicatedFinalMarketSnapshot || hasFrozenTrendSnapshot)
    ) {`;
if (text.includes(oldRecoveryGrace)) {
  text = text.replace(oldRecoveryGrace, newRecoveryGrace);
  changed = true;
} else if (!text.includes("const frozenStrongOrEliteTrend = Boolean(")) {
  throw new Error("Frozen Strong/Elite recovery target not found");
}

// The live/pending lifecycle had a second game-level lock. Convert it to the
// same candidate-level rule so a Best Play final does not hide a later Trend Play.
const oldLiveLockBlock = `  // Any persisted FINAL_PREGAME row means that candidate has already reached
  // the final-decision stage. Do not recreate a live/pending preview for the
  // same game after that point, including when the final decision was rejection.
  const refreshedLockedKeys = new Set(
    refreshedToday
      .filter((pick) => pick.snapshotStatus === "FINAL_PREGAME")
      .map((pick) => pick.gameKey),
  );
  const liveCandidates = candidates.filter(
    (candidate) =>
      !refreshedLockedKeys.has(candidate.gameKey) &&
      (!candidate.slateRow || isPregameRow(candidate.slateRow, selectorNow)),
  );`;

const newLiveLockBlock = `  // Only the exact finalized candidate is locked. Other candidate IDs from the
  // same game (for example a Trend Play after a Best Play) remain eligible.
  const refreshedLockedCandidateIds = new Set(
    refreshedToday
      .filter((pick) => pick.snapshotStatus === "FINAL_PREGAME")
      .map((pick) => pick.candidateId),
  );
  const liveCandidates = candidates.filter(
    (candidate) =>
      !refreshedLockedCandidateIds.has(candidate.candidateId) &&
      (!candidate.slateRow || isPregameRow(candidate.slateRow, selectorNow)),
  );`;

if (text.includes(oldLiveLockBlock)) {
  text = text.replace(oldLiveLockBlock, newLiveLockBlock);
  changed = true;
} else if (!text.includes("const refreshedLockedCandidateIds = new Set(")) {
  throw new Error("Trend live candidate lock target not found");
}

// Do not rewrite Best Play qualification here. The selector in route.ts now
// owns the tiered rolling Last-7 policy and its existing protectionReasons
// enforce hard wager protections such as the price cap.

if (changed) {
  fs.writeFileSync(path, text, "utf8");
  console.log("Applied fail-safe frozen Strong/Elite Trend Play terminal persistence and candidate-level locks.");
} else {
  console.log("Frozen Strong/Elite Trend Play terminal persistence fail-safe already applied.");
}
