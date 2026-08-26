import fs from "node:fs";

const path = "app/api/public-data/route.ts";
let text = fs.readFileSync(path, "utf8");
const marker = "NO_FINAL_AI_REVIEW_SELECTION_CLEANUP_V3";

if (!text.includes(marker)) {
  // Start at the deterministic blocked flag that remains after
  // no_final_ai_review_patch.mjs. Replace the whole downstream policy block so
  // legacy review-admission variants cannot change final selection behavior.
  const startMarker = "    const blocked = candidate.protectionReasons.length > 0;";
  const endMarker = "    return {";
  const start = text.indexOf(startMarker);
  if (start < 0) throw new Error("Deterministic AI selection block not found");
  const end = text.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error("AI selection return block not found");

  const replacement = `    const blocked = candidate.protectionReasons.length > 0;\n    // ${marker}\n    // With no separate final reviewer, every candidate uses the normal deterministic\n    // score/probability/advantage and protection gates at both LIVE and FINAL_PREGAME.\n    const bestPlayBacked = Boolean(candidate.bestPlayType);\n    const trendOnlyCandidate = !bestPlayBacked && candidate.source === "Trend Play";\n\n    const bestPlayProfile = aiPitcherQualificationProfile(\n      candidate.pitcherBetTypeForm,\n    );\n    const bestPlayRequiredScore =\n      candidate.pitcherRequiredScore || bestPlayProfile.score;\n    const selectionThresholds = trendOnlyCandidate\n      ? {\n          score: 80,\n          probability: 0,\n          advantage: 0,\n          enforceProbability: false,\n          enforceAdvantage: false,\n        }\n      : bestPlayBacked\n        ? {\n            score: bestPlayRequiredScore,\n            probability: bestPlayProfile.probability,\n            advantage: bestPlayProfile.advantage,\n            enforceProbability: bestPlayProfile.enforceProbability,\n            enforceAdvantage: true,\n          }\n        : {\n            score: 74,\n            probability: 55,\n            advantage: AI_MINIMUM_ESTIMATED_ADVANTAGE,\n            enforceProbability: true,\n            enforceAdvantage: true,\n          };\n    const qualificationScore = aiScore;\n    const rawTrendScore = Number(candidate.trendScore || 0);\n    const thresholdFailure =\n      trendOnlyCandidate && rawTrendScore < 69\n        ? \`Trend score \${rawTrendScore} did not reach the 69 Strong-trend minimum\`\n        : qualificationScore < selectionThresholds.score\n          ? \`AI score \${qualificationScore} did not reach the \${selectionThresholds.score} grade-based requirement\`\n          : selectionThresholds.enforceProbability &&\n              estimatedProbability < selectionThresholds.probability\n            ? \`Estimated probability \${estimatedProbability.toFixed(1)}% did not reach \${selectionThresholds.probability}%\`\n            : selectionThresholds.enforceAdvantage && implied && advantage < selectionThresholds.advantage\n              ? \`Estimated advantage \${advantage.toFixed(1)}% did not reach \${selectionThresholds.advantage.toFixed(1)}%\`\n              : "";\n    const preliminarySelected = !blocked && !thresholdFailure;\n    const rejectionReason = blocked\n      ? candidate.protectionReasons.join(" • ")\n      : thresholdFailure;\n    const liveBestPlayReviewNote =\n      snapshotStatus === "LIVE" && bestPlayBacked && preliminarySelected\n        ? \`Live preview: \${candidate.bestPlayType} is \${candidate.pitcherBetTypeForm || "SAMPLE"} over its last 7 completed bets (\${candidate.pitcherBetTypeRecord || "0-0-0"}); final selection locks only if the frozen pregame snapshot still clears AI score \${bestPlayRequiredScore}+, estimated probability \${bestPlayProfile.probability.toFixed(1)}%+, estimated advantage \${bestPlayProfile.advantage.toFixed(2)}%+, and every protection gate.\`\n        : "";\n    return {`;

  text = text.slice(0, start) + replacement + text.slice(end + endMarker.length);
  fs.writeFileSync(path, text, "utf8");
  console.log("Restored deterministic AI thresholds and removed legacy AI-review selection policy.");
} else {
  console.log("Deterministic no-review selection policy already applied.");
}
