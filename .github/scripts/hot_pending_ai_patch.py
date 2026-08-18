from pathlib import Path

path = Path("app/api/public-data/route.ts")
text = path.read_text()

old_version = 'const AI_PICK_SELECTOR_VERSION = "hybrid-web-context-v19-trend-review-calibration";'
new_version = 'const AI_PICK_SELECTOR_VERSION = "hybrid-web-context-v20-hot-pending-review";'
if old_version in text:
    text = text.replace(old_version, new_version, 1)
elif new_version not in text:
    raise SystemExit("AI selector version target not found")

old = '''    const preliminarySelected = !blocked && !thresholdFailure;
    const rejectionReason = blocked
      ? candidate.protectionReasons.join(" • ")
      : thresholdFailure;
    const liveBestPlayReviewNote =
      snapshotStatus === "LIVE" && bestPlayBacked && preliminarySelected
        ? `Pending final review: ${candidate.bestPlayType} is ${candidate.pitcherBetTypeForm || "SAMPLE"} over its last 7 completed bets (${candidate.pitcherBetTypeRecord || "0-0-0"}); final selection requires AI score ${bestPlayRequiredScore}+, estimated probability ${bestPlayProfile.probability.toFixed(1)}%+, estimated advantage ${bestPlayProfile.advantage.toFixed(2)}%+, and final AI approval.`
        : "";
'''

new = '''    // HOT is an admission rule for the live AI-review queue, not an automatic
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
          ? `Pending final review: ${candidate.bestPlayType} is HOT over its last 7 completed bets (${candidate.pitcherBetTypeRecord || "0-0-0"}), so HOT Best Plays are automatically admitted to AI consideration. Final publication still requires the final AI review plus AI score ${bestPlayRequiredScore}+, estimated probability ${bestPlayProfile.probability.toFixed(1)}%+, and estimated advantage ${bestPlayProfile.advantage.toFixed(2)}%+.`
          : `Pending final review: ${candidate.bestPlayType} is ${candidate.pitcherBetTypeForm || "SAMPLE"} over its last 7 completed bets (${candidate.pitcherBetTypeRecord || "0-0-0"}); final selection requires AI score ${bestPlayRequiredScore}+, estimated probability ${bestPlayProfile.probability.toFixed(1)}%+, estimated advantage ${bestPlayProfile.advantage.toFixed(2)}%+, and final AI approval.`
        : "";
'''

if old in text:
    text = text.replace(old, new, 1)
elif new not in text:
    raise SystemExit("AI selector threshold block not found")

path.write_text(text)
