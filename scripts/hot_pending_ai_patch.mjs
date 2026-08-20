import fs from "node:fs";

const path = "app/api/public-data/route.ts";
let text = fs.readFileSync(path, "utf8");
const original = text;

const selectorVersion =
  'const AI_PICK_SELECTOR_VERSION = "hybrid-web-context-v22-balanced-final-review";';
const versionPattern =
  /const AI_PICK_SELECTOR_VERSION = "hybrid-web-context-v(?:19-trend-review-calibration|20-hot-pending-review|21-priority-ai-review|22-balanced-final-review)";/;
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

const prioritySelectionBlockV21 = `    const priorityAiReviewCandidate = aiPriorityReviewCandidate(candidate);
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

const balancedPrioritySelectionBlock = `    const priorityAiReviewCandidate = aiPriorityReviewCandidate(candidate);
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
    // Strong/Elite/HOT plays are guaranteed admission to AI review while LIVE,
    // even if they are currently below a soft numeric threshold. At FINAL_PREGAME,
    // publication requires BOTH final AI approval and the normal post-research
    // score/probability/advantage gate. AI approval no longer bypasses the gate.
    const priorityLiveReviewAdmission =
      snapshotStatus === "LIVE" && priorityAiReviewCandidate;
    const preliminarySelected =
      !effectiveBlocked && (priorityLiveReviewAdmission || !thresholdFailure);
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
      : priorityLiveReviewAdmission
        ? ""
        : thresholdFailure;
    const liveBestPlayReviewNote =
      snapshotStatus === "LIVE" && priorityAiReviewCandidate && preliminarySelected
        ? \`Pending final AI review: automatically admitted because it is \${aiPriorityReviewLabel(candidate)}. Final publication still requires AI approval plus the normal score, probability, and advantage requirements.\`
        : snapshotStatus === "LIVE" && bestPlayBacked && preliminarySelected
          ? \`Pending final review: \${candidate.bestPlayType} is \${candidate.pitcherBetTypeForm || "SAMPLE"} over its last 7 completed bets (\${candidate.pitcherBetTypeRecord || "0-0-0"}); final selection requires AI score \${bestPlayRequiredScore}+, estimated probability \${bestPlayProfile.probability.toFixed(1)}%+, estimated advantage \${bestPlayProfile.advantage.toFixed(2)}%+, and final AI approval.\`
          : "";
`;

if (text.includes(oldSelectionBlock)) {
  text = text.replace(oldSelectionBlock, balancedPrioritySelectionBlock);
} else if (text.includes(hotOnlySelectionBlock)) {
  text = text.replace(hotOnlySelectionBlock, balancedPrioritySelectionBlock);
} else if (text.includes(prioritySelectionBlockV21)) {
  text = text.replace(prioritySelectionBlockV21, balancedPrioritySelectionBlock);
} else if (!text.includes(balancedPrioritySelectionBlock)) {
  throw new Error("AI selector threshold block not found");
}

const oldReviewCandidates = `  // Deterministic failures can never become selected after research. Persist
  // their blocked decision without paying for a web-search/model call.
  const reviewCandidates = targetCandidates.filter(
    (candidate) => candidate.protectionReasons.length === 0,
  );
`;
const priorityReviewCandidates = `  // Strong/Elite/HOT candidates are deliberately sent to the reviewer even
  // when a soft historical/market-context rule disagrees. Only missing core bet
  // identity/data prevents the review call. Final publication still applies the
  // normal post-research quantitative gate in addition to AI approval.
  const reviewCandidates = targetCandidates.filter((candidate) => {
    if (aiPriorityReviewCandidate(candidate)) {
      return aiPriorityHardProtectionReasons(candidate).length === 0;
    }
    return candidate.protectionReasons.length === 0;
  });
`;
const v21ReviewCandidates = `  // Strong/Elite/HOT candidates are deliberately sent to the reviewer even
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
  text = text.replace(oldReviewCandidates, priorityReviewCandidates);
} else if (text.includes(v21ReviewCandidates)) {
  text = text.replace(v21ReviewCandidates, priorityReviewCandidates);
} else if (!text.includes(priorityReviewCandidates)) {
  throw new Error("AI final review candidate filter not found");
}

const oldApprovalGuidance =
  "approved=false is a final veto only for materially negative evidence discovered in the matchup research; it is not a numeric-threshold veto. Never set approved=false solely because aiScoreBeforeResearch is below a downstream selector threshold.";
const balancedApprovalGuidance =
  "approved=true means the matchup research gives enough qualitative support to publish the wager; it must not mean merely that no catastrophic veto was found. Never set approved=false solely because aiScoreBeforeResearch is below a downstream selector threshold, because the selector applies that numeric gate after research. However, for a borderline candidate near its required score/probability/advantage thresholds, neutral or ambiguous research is not sufficient for approved=true. Borderline plays should be approved only when the verified matchup context positively supports or meaningfully validates the wager. A clearly strong quantitative candidate can remain approved when research is neutral and no material contradiction is found.";
if (text.includes(oldApprovalGuidance)) {
  text = text.replace(oldApprovalGuidance, balancedApprovalGuidance);
} else if (!text.includes(balancedApprovalGuidance)) {
  throw new Error("AI reviewer approval guidance not found");
}

const oldTrendGuidance =
  "Do not reject a trend-only candidate because aiScoreBeforeResearch is below 80. First evaluate the actual matchup and assign the research adjustment. If the research is neutral, use adjustment=0 and approved=true unless the research itself uncovers a material negative reason to veto. The selector, not the reviewer, applies the final 80+ score gate after the adjustment. Small sample, trend strength alone is insufficient, lack of extra corroboration, or a pre-research score shortfall are not valid reasons for approved=false. For a trend-only play, approved=false must reflect a concrete researched matchup problem such as a materially unfavorable confirmed starter, lineup, bullpen, weather, or relevant split/context issue. The AI remains the final qualitative decider on matchup evidence, while the selector remains the final numeric gatekeeper.";
const balancedTrendGuidance =
  "Do not reject a trend-only candidate solely because aiScoreBeforeResearch is below 80; the selector applies the final adjusted 80+ gate after research. But neutral research is no longer automatic approval. For trend-only candidates that are borderline—especially an AI score within 3 points of 80, modest advantage, or a case driven mainly by the trend signal—approved=true requires verified matchup evidence that positively corroborates the wager. If the research is neutral, mixed, or fails to add meaningful matchup support to a borderline case, approved=false is appropriate even without one catastrophic conflict. For a clearly strong trend-only quantitative case comfortably above the threshold, neutral research may remain approved when no material contradiction is found. Concrete unfavorable starter, lineup, bullpen, weather, split, or matchup evidence should still produce approved=false. The AI is the qualitative filter; the selector remains the final numeric gatekeeper.";
if (text.includes(oldTrendGuidance)) {
  text = text.replace(oldTrendGuidance, balancedTrendGuidance);
} else if (!text.includes(balancedTrendGuidance)) {
  throw new Error("Trend-only reviewer guidance not found");
}

if (text.includes('prompt_cache_key: "ezpz-ai-game-v13"')) {
  text = text.replace(
    'prompt_cache_key: "ezpz-ai-game-v13"',
    'prompt_cache_key: "ezpz-ai-game-v14"',
  );
}

if (text !== original) {
  fs.writeFileSync(path, text, "utf8");
  console.log("Applied balanced Strong/Elite/HOT AI review selector patch for build.");
} else {
  console.log("Balanced Strong/Elite/HOT AI review selector patch already present.");
}
