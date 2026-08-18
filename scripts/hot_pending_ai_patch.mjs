import fs from "node:fs";

const path = "app/api/public-data/route.ts";
let text = fs.readFileSync(path, "utf8");
const original = text;

const oldVersion = 'const AI_PICK_SELECTOR_VERSION = "hybrid-web-context-v19-trend-review-calibration";';
const newVersion = 'const AI_PICK_SELECTOR_VERSION = "hybrid-web-context-v20-hot-pending-review";';

if (text.includes(oldVersion)) {
  text = text.replace(oldVersion, newVersion);
} else if (!text.includes(newVersion)) {
  throw new Error("AI selector version target not found");
}

const oldBlock = `    const preliminarySelected = !blocked && !thresholdFailure;
    const rejectionReason = blocked
      ? candidate.protectionReasons.join(" • ")
      : thresholdFailure;
    const liveBestPlayReviewNote =
      snapshotStatus === "LIVE" && bestPlayBacked && preliminarySelected
        ? \`Pending final review: \${candidate.bestPlayType} is \${candidate.pitcherBetTypeForm || "SAMPLE"} over its last 7 completed bets (\${candidate.pitcherBetTypeRecord || "0-0-0"}); final selection requires AI score \${bestPlayRequiredScore}+, estimated probability \${bestPlayProfile.probability.toFixed(1)}%+, estimated advantage \${bestPlayProfile.advantage.toFixed(2)}%+, and final AI approval.\`
        : "";
`;

const newBlock = `    // HOT is an admission rule for the live AI-review queue, not an automatic
    // final pick. Any non-blocked Best Play carrying the same HOT Last-7 badge
    // shown on the public card is surfaced as Pending AI even when its current
    // score/probability/advantage would miss the normal preview threshold.
    // FINAL_PREGAME still applies the full numeric gate after external review.
    const hotBestPlayPendingReview =
      snapshotStatus === "LIVE" &&
      bestPlayBacked &&
      candidate.pitcherBetTypeForm === "HOT";
    const preliminarySelected =
      !blocked && (hotBestPlayPendingReview || !thresholdFailure);
    const rejectionReason = blocked
      ? candidate.protectionReasons.join(" • ")
      : hotBestPlayPendingReview
        ? ""
        : thresholdFailure;
    const liveBestPlayReviewNote =
      snapshotStatus === "LIVE" && bestPlayBacked && preliminarySelected
        ? hotBestPlayPendingReview
          ? \`Pending final review: \${candidate.bestPlayType} is HOT over its last 7 completed bets (\${candidate.pitcherBetTypeRecord || "0-0-0"}), so HOT Best Plays are automatically admitted to AI consideration. Final publication still requires the final AI review plus AI score \${bestPlayRequiredScore}+, estimated probability \${bestPlayProfile.probability.toFixed(1)}%+, and estimated advantage \${bestPlayProfile.advantage.toFixed(2)}%+.\`
          : \`Pending final review: \${candidate.bestPlayType} is \${candidate.pitcherBetTypeForm || "SAMPLE"} over its last 7 completed bets (\${candidate.pitcherBetTypeRecord || "0-0-0"}); final selection requires AI score \${bestPlayRequiredScore}+, estimated probability \${bestPlayProfile.probability.toFixed(1)}%+, estimated advantage \${bestPlayProfile.advantage.toFixed(2)}%+, and final AI approval.\`
        : "";
`;

if (text.includes(oldBlock)) {
  text = text.replace(oldBlock, newBlock);
} else if (!text.includes(newBlock)) {
  throw new Error("AI selector threshold block not found");
}

if (text !== original) {
  fs.writeFileSync(path, text, "utf8");
  console.log("Applied HOT Pending AI selector patch for build.");
} else {
  console.log("HOT Pending AI selector patch already present.");
}
