import fs from "node:fs";

const path = "app/api/public-data/route.ts";
let text = fs.readFileSync(path, "utf8");
const marker = "NO_FINAL_AI_REVIEW_SELECTION_CLEANUP_V1";

if (!text.includes(marker)) {
  const startMarker = "    const priorityAiReviewCandidate = aiPriorityReviewCandidate(candidate);";
  const endMarker = "    return {";
  const start = text.indexOf(startMarker);
  if (start < 0) throw new Error("Priority AI-review selection block not found");
  const end = text.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error("AI selection return block not found");

  const replacement = `    // ${marker}\n    // With no separate final reviewer, every candidate uses the normal deterministic\n    // score/probability/advantage and protection gates at both LIVE and FINAL_PREGAME.\n    const preliminarySelected = !blocked && !thresholdFailure;\n    const rejectionReason = blocked\n      ? candidate.protectionReasons.join(" • ")\n      : thresholdFailure;\n    const liveBestPlayReviewNote =\n      snapshotStatus === "LIVE" && bestPlayBacked && preliminarySelected\n        ? \`Live preview: \${candidate.bestPlayType} is \${candidate.pitcherBetTypeForm || "SAMPLE"} over its last 7 completed bets (\${candidate.pitcherBetTypeRecord || "0-0-0"}); final selection locks only if the frozen pregame snapshot still clears AI score \${bestPlayRequiredScore}+, estimated probability \${bestPlayProfile.probability.toFixed(1)}%+, estimated advantage \${bestPlayProfile.advantage.toFixed(2)}%+, and every protection gate.\`\n        : "";\n    return {`;

  text = text.slice(0, start) + replacement + text.slice(end + endMarker.length);
  fs.writeFileSync(path, text, "utf8");
  console.log("Removed legacy priority AI-review admission/approval logic from final selection.");
} else {
  console.log("Legacy priority AI-review selection logic already removed.");
}
