import fs from "node:fs";

const path = "app/api/public-data/route.ts";
let text = fs.readFileSync(path, "utf8");
const marker = "HOT_ONLY_BEST_PLAY_POLICY_V1";

if (!text.includes(marker)) {
  // This runs last in prebuild. Replace the downstream selection-policy block so
  // Best Plays follow the user's exact rule: HOT is the only qualification gate.
  // Trend Plays keep their separate trend qualification path.
  const startMarker = "    const blocked = candidate.protectionReasons.length > 0;";
  const endMarker = "    return {";
  const start = text.indexOf(startMarker);
  if (start < 0) throw new Error("Deterministic AI selection block not found");
  const end = text.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error("AI selection return block not found");

  const replacement = `    // ${marker}\n    const bestPlayBacked = Boolean(candidate.bestPlayType);\n    const trendOnlyCandidate = !bestPlayBacked && candidate.source === "Trend Play";\n    const baseBlocked = candidate.protectionReasons.length > 0;\n\n    // Best Play policy: HOT is the only qualification requirement.\n    // A HOT Best Play cannot be removed by score, probability, advantage,\n    // research/recent-form interpretation, or another added selector gate.\n    // Neutral, Cold, and Small Sample Best Plays cannot qualify.\n    const hotBestPlay =\n      bestPlayBacked && candidate.pitcherBetTypeForm === "HOT";\n    const blocked = bestPlayBacked ? false : baseBlocked;\n\n    const rawTrendScore = Number(candidate.trendScore || 0);\n    const qualificationScore = aiScore;\n    const thresholdFailure = bestPlayBacked\n      ? hotBestPlay\n        ? ""\n        : \\`\\${candidate.bestPlayType || "Best Play"} is \\${candidate.pitcherBetTypeForm || "SAMPLE"} over its rolling Last 7; only HOT Best Play bet types qualify for AI Picks\\`\n      : trendOnlyCandidate && rawTrendScore < 69\n        ? \\`Trend score \\${rawTrendScore} did not reach the 69 Strong-trend minimum\\`\n        : trendOnlyCandidate && qualificationScore < 80\n          ? \\`AI score \\${qualificationScore} did not reach the 80 Trend Play requirement\\`\n          : "";\n\n    const preliminarySelected = bestPlayBacked\n      ? hotBestPlay\n      : !blocked && !thresholdFailure;\n    const rejectionReason = bestPlayBacked\n      ? thresholdFailure\n      : blocked\n        ? candidate.protectionReasons.join(" • ")\n        : thresholdFailure;\n    const liveBestPlayReviewNote =\n      snapshotStatus === "LIVE" && bestPlayBacked && preliminarySelected\n        ? \\`Live preview: \\${candidate.bestPlayType} is HOT over its rolling Last 7 (\\${candidate.pitcherBetTypeRecord || "0-0-0"}); it will lock as a Final AI Pick if the bet type is still HOT at the frozen pregame snapshot.\\`\n        : "";\n    return {`;

  text = text.slice(0, start) + replacement + text.slice(end + endMarker.length);

  // The stored pre-first-pitch recheck must use the same exact rule. It may only
  // demote a Best Play when its rolling form is no longer HOT, and it may restore
  // an older Last-7 rejection when the form is HOT. Numeric/research gates are
  // intentionally not part of this recheck.
  const storedGatePattern = /  const statusLine = `\$\{recordType\} Last 7 Bets: \$\{formLabel\} • \$\{lastSeven\.record\}`;[\s\S]*?\n  const cleanedStatus =/;
  if (!storedGatePattern.test(text)) {
    throw new Error("Stored Last-7 qualification block not found");
  }
  text = text.replace(
    storedGatePattern,
    `  const statusLine = \\`\\${recordType} Last 7 Bets: \\${formLabel} • \\${lastSeven.record}\\`;\n\n  let failure = "";\n  if (form !== "HOT") {\n    failure = \\`\\${recordType} is \\${formLabel} over its rolling Last 7 (\\${lastSeven.record}); only HOT Best Play bet types qualify for AI Picks\\`;\n  }\n\n  const cleanedStatus =`,
  );

  fs.writeFileSync(path, text, "utf8");
  console.log("Applied HOT-only Best Play AI policy and matching final Last-7 recheck.");
} else {
  console.log("HOT-only Best Play AI policy already applied.");
}
