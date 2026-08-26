import fs from "node:fs";

const path = "app/api/public-data/route.ts";
let text = fs.readFileSync(path, "utf8");
let changed = false;

// Final decisions are candidate-level, not game-level. A finalized Best Play
// must not prevent a different qualifying Trend Play from the same game from
// being created and finalized.
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
    if (!targetGameKeys.has(candidate.gameKey)) return false;
    if (storedFinalCandidateIds.has(candidate.candidateId)) return false;`;

if (text.includes(oldFinalizationBlock)) {
  text = text.replace(oldFinalizationBlock, newFinalizationBlock);
  changed = true;
} else if (!text.includes("const storedFinalCandidateIds = new Set(")) {
  throw new Error("Trend candidate finalization target not found");
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

// HOT remains the only Best Play performance/form gate, but -150 is a hard
// global betting constraint for every AI Pick.
const oldHotBlock = `    const hotBestPlay =
      bestPlayBacked && candidate.pitcherBetTypeForm === "HOT";
    const blocked = bestPlayBacked ? false : baseBlocked;`;
const newHotBlock = `    const bestPlayOddsFailure = bestPlayBacked
      ? candidate.protectionReasons.find(
          (reason) =>
            reason === "Playable odds are missing" ||
            reason.includes("maximum price"),
        ) || ""
      : "";
    const hotBestPlay =
      bestPlayBacked && candidate.pitcherBetTypeForm === "HOT";
    const blocked = bestPlayBacked ? Boolean(bestPlayOddsFailure) : baseBlocked;`;
if (text.includes(oldHotBlock)) {
  text = text.replace(oldHotBlock, newHotBlock);
  changed = true;
} else if (!text.includes("const bestPlayOddsFailure = bestPlayBacked")) {
  throw new Error("Best Play odds-cap target not found");
}

const oldBestThreshold = `    const thresholdFailure = bestPlayBacked
      ? hotBestPlay
        ? ""
        : (candidate.bestPlayType || "Best Play") + " is " + (candidate.pitcherBetTypeForm || "SAMPLE") + " over its rolling Last 7; only HOT Best Play bet types qualify for AI Picks"
      : trendOnlyCandidate && rawTrendScore < 69`;
const newBestThreshold = `    const thresholdFailure = bestPlayBacked
      ? bestPlayOddsFailure
        ? bestPlayOddsFailure
        : hotBestPlay
          ? ""
          : (candidate.bestPlayType || "Best Play") + " is " + (candidate.pitcherBetTypeForm || "SAMPLE") + " over its rolling Last 7; only HOT Best Play bet types qualify for AI Picks"
      : trendOnlyCandidate && rawTrendScore < 69`;
if (text.includes(oldBestThreshold)) {
  text = text.replace(oldBestThreshold, newBestThreshold);
  changed = true;
} else if (!text.includes("? bestPlayOddsFailure")) {
  throw new Error("Best Play threshold odds-cap target not found");
}

const oldPreliminary = `    const preliminarySelected = bestPlayBacked
      ? hotBestPlay
      : !blocked && !thresholdFailure;`;
const newPreliminary = `    const preliminarySelected = bestPlayBacked
      ? hotBestPlay && !bestPlayOddsFailure
      : !blocked && !thresholdFailure;`;
if (text.includes(oldPreliminary)) {
  text = text.replace(oldPreliminary, newPreliminary);
  changed = true;
} else if (!text.includes("? hotBestPlay && !bestPlayOddsFailure")) {
  throw new Error("Best Play preliminary selection target not found");
}

if (changed) {
  fs.writeFileSync(path, text, "utf8");
  console.log("Applied candidate-level Trend Play locks and global -150 AI price cap.");
} else {
  console.log("Candidate-level Trend Play locks and -150 AI price cap already applied.");
}
