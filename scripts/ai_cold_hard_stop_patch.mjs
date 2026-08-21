import fs from "node:fs";

const path = "app/api/public-data/route.ts";
let text = fs.readFileSync(path, "utf8");
const original = text;

const oldVersion =
  'const AI_PICK_SELECTOR_VERSION = "hybrid-web-context-v22-balanced-final-review";';
const newVersion =
  'const AI_PICK_SELECTOR_VERSION = "hybrid-web-context-v23-cold-hard-stop";';
if (text.includes(oldVersion)) {
  text = text.replace(oldVersion, newVersion);
} else if (!text.includes(newVersion)) {
  throw new Error("AI selector v22 version marker not found after hot-pending patch");
}

const oldPriorityHeader = `function aiPriorityReviewCandidate(candidate: AiSelectorCandidate) {
  const bestPlayLabel = \`\${candidate.bestPlayType || ""} \${candidate.bestPlay?.playType || ""}\`.toUpperCase();
  return (`;
const newPriorityHeader = `function aiPriorityReviewCandidate(candidate: AiSelectorCandidate) {
  const bestPlayLabel = \`\${candidate.bestPlayType || ""} \${candidate.bestPlay?.playType || ""}\`.toUpperCase();
  // COLD is a hard exclusion. A Strong/Elite label must never override the
  // exact Last-7 pitcher bet-type form shown on the Best Plays card.
  if (candidate.pitcherBetTypeForm === "COLD") return false;
  return (`;
if (text.includes(oldPriorityHeader)) {
  text = text.replace(oldPriorityHeader, newPriorityHeader);
} else if (!text.includes(newPriorityHeader)) {
  throw new Error("AI priority helper marker not found after hot-pending patch");
}

const oldSelectionStart = `    const priorityAiReviewCandidate = aiPriorityReviewCandidate(candidate);
    const priorityHardProtectionReasons = priorityAiReviewCandidate
      ? aiPriorityHardProtectionReasons(candidate)
      : [];
    const priorityFinalReviewBlocked =
      snapshotStatus === "FINAL_PREGAME" &&
      priorityAiReviewCandidate &&
      (!review || !review.approved || review.criticalConflict);
    const effectiveBlocked = priorityAiReviewCandidate
      ? priorityHardProtectionReasons.length > 0 || priorityFinalReviewBlocked
      : blocked;`;
const newSelectionStart = `    // Final server-side Last-7 hard stop. Re-evaluate the candidate form at the
    // last selection stage so restored snapshots, priority admission, or a
    // Strong/Elite label can never surface a COLD pitcher Best Play as Pending
    // or Final AI.
    const coldBestPlayHardStop = candidate.pitcherBetTypeForm === "COLD";
    const priorityAiReviewCandidate =
      !coldBestPlayHardStop && aiPriorityReviewCandidate(candidate);
    const priorityHardProtectionReasons = priorityAiReviewCandidate
      ? aiPriorityHardProtectionReasons(candidate)
      : [];
    const priorityFinalReviewBlocked =
      snapshotStatus === "FINAL_PREGAME" &&
      priorityAiReviewCandidate &&
      (!review || !review.approved || review.criticalConflict);
    const effectiveBlocked = coldBestPlayHardStop
      ? true
      : priorityAiReviewCandidate
        ? priorityHardProtectionReasons.length > 0 || priorityFinalReviewBlocked
        : blocked;`;
if (text.includes(oldSelectionStart)) {
  text = text.replace(oldSelectionStart, newSelectionStart);
} else if (!text.includes(newSelectionStart)) {
  throw new Error("Balanced AI final-selection block not found after hot-pending patch");
}

if (text !== original) {
  fs.writeFileSync(path, text, "utf8");
  console.log("Applied COLD Best Play final hard-stop patch for build.");
} else {
  console.log("COLD Best Play final hard-stop patch already present.");
}
