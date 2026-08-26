import fs from "node:fs";

const path = "app/api/public-data/route.ts";
let text = fs.readFileSync(path, "utf8");
let changed = false;

// A game can produce more than one AI candidate at slightly different moments.
// Do not mark the whole game as finished just because one Best Play locked first.
// Lock/finalize at candidate level so a qualifying Trend Play can still appear.
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

// HOT remains the only Best Play performance/form gate, but the user's new
// -150 maximum price is a hard global betting constraint for every AI Pick.
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
  console.log("Applied candidate-level Trend Play finalization and global -150 AI price cap.");
} else {
  console.log("Trend candidate finalization and -150 AI price cap already applied.");
}
