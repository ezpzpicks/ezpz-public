import fs from "node:fs";

const path = "app/api/public-data/route.ts";
let text = fs.readFileSync(path, "utf8");
const original = text;

const selectorVersion =
  'const AI_PICK_SELECTOR_VERSION = "hybrid-web-context-v21-priority-ai-review";';
const versionPattern =
  /const AI_PICK_SELECTOR_VERSION = "hybrid-web-context-v(?:19-trend-review-calibration|20-hot-pending-review|21-priority-ai-review)";/;
if (versionPattern.test(text)) {
  text = text.replace(versionPattern, selectorVersion);
} else if (!text.includes(selectorVersion)) {
  throw new Error("AI selector version target not found");
}

const helperMarker = `function finalizeAiCandidates(`;
const priorityHelpers = `function aiPriorityReviewCandidate(candidate: AiSelectorCandidate) {
  const bestPlayLabel = \`${"${candidate.bestPlayType || \"\"} ${candidate.bestPlay?.playType || \"\"}"}\`.toUpperCase();
  return (
    candidate.pitcherBetTypeForm === "HOT" ||
    /\\b(STRONG|ELITE)\\b/.test(bestPlayLabel) ||
    candidate.trendTier === "Strong" ||
    candidate.trendTier === "Elite"
  );
}

function aiPriorityReviewLabel(candidate: AiSelectorCandidate) {
  const labels: string[] = [];
  const rawBestPlay = String(candidate.bestPlay?.playType || candidate.bestPlayType || "").trim();
  if (/\\b(STRONG|ELITE)\\b/i.test(rawBestPlay)) labels.push(rawBestPlay);
  if (candidate.trendTier === "Strong" || candidate.trendTier === "Elite") {
    labels.push(\`${"${candidate.trendTier} Trend Play"}\`);
  }
  if (candidate.pitcherBetTypeForm === "HOT") {
    labels.push(
      \`HOT Last-7 Best Play (\${candidate.pitcherBetTypeRecord || "0-0-0"})\`,
    );
  }
  return labels.join(" + ") || "priority Strong/Elite/HOT qualification";
}

function aiPriorityHardProtectionReasons(candidate: AiSelectorCandidate) {
  return candidate.protectionReasons.filter((reason) => {
    const text = String(reason || "").toLowerCase();
    return (
      text.includes("could not be matched to today") ||
      text.includes("playable odds are missing") ||
      text.includes("betting line is missing") ||
      text.includes("required selector score is invalid")
    );
  });
}

`;
if (!text.includes("function aiPriorityReviewCandidate(")) {
  if (!text.includes(helperMarker)) throw new Error("finalizeAiCandidates marker not found");
  text = text.replace(helperMarker, `${priorityHelpers}${helperMarker}`);
}

const oldSelectionBlock = `    const preliminarySelected = !blocked && !thresholdFailure;
    const rejectionReason = blocked
      ? candidate.protectionReasons.join(" • ")
      : thresholdFailure;
    const liveBestPlayReviewNote =
      snapshotStatus === "LIVE" && bestPlayBacked && preliminarySelected
        ? \`Pending final review: \${candidate.bestPlayType} is \${candidate.pitcherBetTypeForm || "SAMPLE"} over its last 7 completed bets (\${candidate.pitcherBetTypeRecord || "0-0-0"}); final selection requires AI score \${bestPlayRequiredScore}+, estimated probability \${bestPlayProfile.probability.toFixed(1)}%+, estimated advantage \${bestPlayProfile.advantage.toFixed(2)}%+, and final AI approval.\`
        : "";
`;

const hotOnlySelectionBlock = `    // HOT is an admission rule for the live AI-review queue, not an automatic
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

const prioritySelectionBlock = `    const priorityAiReviewCandidate = aiPriorityReviewCandidate(candidate);
    const priorityHardProtectionReasons = priorityAiReviewCandidate
      ? aiPriorityHardProtectionReasons(candidate)
      : [];
    const priorityFinalReviewBlocked =
      snapshotStatus === "FINAL_PREGAME" &&
      priorityAiReviewCandidate &&
      (!review || !review.approved || review.criticalConflict);
    const effectiveBlocked = priorityAiReviewCandidate
      ? priorityHardProtectionReasons.length > 0 || priorityFinalReviewBlocked
      : blocked;
    // Strong Best Plays, Elite Best Plays, Strong/Elite Trend Plays, and HOT
    // Last-7 Best Plays always reach AI review. For this priority group the
    // final external AI approval/rejection is decisive; the legacy numeric gate
    // remains diagnostic context but cannot veto an AI-approved play afterward.
    const preliminarySelected =
      !effectiveBlocked && (priorityAiReviewCandidate || !thresholdFailure);
    const rejectionReason = effectiveBlocked
      ? priorityAiReviewCandidate
        ? priorityHardProtectionReasons.length
          ? priorityHardProtectionReasons.join(" • ")
          : snapshotStatus === "FINAL_PREGAME" && !review
            ? "Final external AI review did not complete"
            : review && !review.approved
              ? \`Final AI review rejected this wager: \${review.finalVerdict || review.verdict || review.selectionComparison}\`
              : review?.criticalConflict
                ? review.criticalConflictReason || "Final AI review found a critical conflict"
                : candidate.protectionReasons.join(" • ")
        : candidate.protectionReasons.join(" • ")
      : priorityAiReviewCandidate
        ? ""
        : thresholdFailure;
    const liveBestPlayReviewNote =
      snapshotStatus === "LIVE" && priorityAiReviewCandidate && preliminarySelected
        ? \`Pending final AI review: automatically admitted because it is \${aiPriorityReviewLabel(candidate)}. The final AI reviewer will decide whether this becomes an AI Pick.\`
        : snapshotStatus === "LIVE" && bestPlayBacked && preliminarySelected
          ? \`Pending final review: \${candidate.bestPlayType} is \${candidate.pitcherBetTypeForm || "SAMPLE"} over its last 7 completed bets (\${candidate.pitcherBetTypeRecord || "0-0-0"}); final selection requires AI score \${bestPlayRequiredScore}+, estimated probability \${bestPlayProfile.probability.toFixed(1)}%+, estimated advantage \${bestPlayProfile.advantage.toFixed(2)}%+, and final AI approval.\`
          : "";
`;

if (text.includes(oldSelectionBlock)) {
  text = text.replace(oldSelectionBlock, prioritySelectionBlock);
} else if (text.includes(hotOnlySelectionBlock)) {
  text = text.replace(hotOnlySelectionBlock, prioritySelectionBlock);
} else if (!text.includes(prioritySelectionBlock)) {
  throw new Error("AI selector threshold block not found");
}

const oldReviewCandidates = `  // Deterministic failures can never become selected after research. Persist
  // their blocked decision without paying for a web-search/model call.
  const reviewCandidates = targetCandidates.filter(
    (candidate) => candidate.protectionReasons.length === 0,
  );
`;
const newReviewCandidates = `  // Strong/Elite/HOT candidates are deliberately sent to the reviewer even
  // when a soft historical/market-context rule disagrees. Only missing core bet
  // identity/data prevents the review call; the AI reviewer decides the final
  // outcome for this priority group.
  const reviewCandidates = targetCandidates.filter((candidate) => {
    if (aiPriorityReviewCandidate(candidate)) {
      return aiPriorityHardProtectionReasons(candidate).length === 0;
    }
    return candidate.protectionReasons.length === 0;
  });
`;
if (text.includes(oldReviewCandidates)) {
  text = text.replace(oldReviewCandidates, newReviewCandidates);
} else if (!text.includes(newReviewCandidates)) {
  throw new Error("AI final review candidate filter not found");
}

if (text !== original) {
  fs.writeFileSync(path, text, "utf8");
  console.log("Applied Strong/Elite/HOT AI review selector patch for build.");
} else {
  console.log("Strong/Elite/HOT AI review selector patch already present.");
}
