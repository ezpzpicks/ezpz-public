import fs from "node:fs";

const path = "app/api/public-data/route.ts";
let text = fs.readFileSync(path, "utf8");
const original = text;

// The tracker helper historically classified pitcher K grades such as OVER / UNDER
// as generic game totals. That made aiRowsForType() discard every pitcher row and
// report SAMPLE 0-0-0 even when the public Best Plays card correctly showed a Cold
// rolling record. Fix the lookup first so the AI gate evaluates the exact pitcher
// strikeout market and exact grade bucket.
const pitcherRowsPattern = /if \(\["OVER", "UNDER", "LEAN OVER", "LEAN UNDER", "STRONG OVER", "STRONG UNDER"\]\.includes\(normalized\)\) \{\s*return trackerMarket\(row\) !== "Total" && normalizeType\(row\["Bet Type"\] \|\| row\.Market \|\| ""\) === normalized;\s*\}/;
const correctedPitcherRows = `if (["OVER", "UNDER", "LEAN OVER", "LEAN UNDER", "STRONG OVER", "STRONG UNDER"].includes(normalized)) {
      const market = textKey(row.Market || "");
      const isPitcherStrikeoutMarket =
        market.includes("pitcher strikeout") || market.includes("pitcher k");
      return (
        isPitcherStrikeoutMarket &&
        normalizeType(row["Bet Type"] || row.Market || "") === normalized
      );
    }`;
if (pitcherRowsPattern.test(text)) {
  text = text.replace(pitcherRowsPattern, correctedPitcherRows);
} else if (!text.includes('const isPitcherStrikeoutMarket =')) {
  throw new Error("Pitcher Last-7 tracker lookup marker not found");
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
  console.log("Applied corrected pitcher Last-7 lookup and COLD Best Play hard stop for build.");
} else {
  console.log("Pitcher Last-7 lookup and COLD Best Play hard stop already present.");
}
