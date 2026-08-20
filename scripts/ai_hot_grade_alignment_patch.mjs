import fs from "node:fs";

const path = "app/api/public-data/route.ts";
let text = fs.readFileSync(path, "utf8");
const original = text;

const selectorVersion =
  'const AI_PICK_SELECTOR_VERSION = "hybrid-web-context-v23-grade-aligned-last7";';
const versionPattern =
  /const AI_PICK_SELECTOR_VERSION = "hybrid-web-context-v(?:19-trend-review-calibration|20-hot-pending-review|21-priority-ai-review|22-balanced-final-review|23-grade-aligned-last7)";/;
if (versionPattern.test(text)) {
  text = text.replace(versionPattern, selectorVersion);
} else if (!text.includes(selectorVersion)) {
  throw new Error("AI selector version target not found");
}

const genericPitcherOverMarker =
  '  if (text.includes("STRONG OVER")) return "STRONG OVER";';
const totalOverGuard =
  '  if (text.includes("TOTAL OVER") || text.includes("GAME TOTAL OVER")) return "TOTAL OVER";';
const totalUnderGuard =
  '  if (text.includes("TOTAL UNDER") || text.includes("GAME TOTAL UNDER")) return "TOTAL UNDER";';
if (!text.includes(totalOverGuard) || !text.includes(totalUnderGuard)) {
  if (!text.includes(genericPitcherOverMarker)) {
    throw new Error("normalizeType pitcher-grade marker not found");
  }
  text = text.replace(
    genericPitcherOverMarker,
    `  // Keep game totals out of pitcher OVER/UNDER Last-7 records.\n${totalOverGuard}\n${totalUnderGuard}\n${genericPitcherOverMarker}`,
  );
}

const candidateMarker = `function aiCandidateFromBestPlay(`;
const recordTypeHelper = `function aiBestPlayRecordTypeForSelector(
  market: AiPickMarket | "",
  playLabel: unknown,
  bestPlayType: unknown,
) {
  if (market === "Pitcher Strikeouts") {
    const summaryGrade = normalizeType(playLabel);
    if (
      ["STRONG OVER", "OVER", "LEAN OVER", "STRONG UNDER", "UNDER", "LEAN UNDER"].includes(summaryGrade)
    ) {
      return summaryGrade;
    }
  }
  return aiCanonicalBestPlayType(bestPlayType);
}

`;
if (!text.includes("function aiBestPlayRecordTypeForSelector(")) {
  if (!text.includes(candidateMarker)) {
    throw new Error("aiCandidateFromBestPlay marker not found");
  }
  text = text.replace(candidateMarker, `${recordTypeHelper}${candidateMarker}`);
}

const oldCandidateBestPlayType =
  `    bestPlayType: aiCanonicalBestPlayType(play.playType),`;
const newCandidateBestPlayType =
  `    bestPlayType: aiBestPlayRecordTypeForSelector(identity.market, play.play, play.playType),`;
if (text.includes(oldCandidateBestPlayType)) {
  text = text.replace(oldCandidateBestPlayType, newCandidateBestPlayType);
} else if (!text.includes(newCandidateBestPlayType)) {
  throw new Error("AI candidate Best Play record type assignment not found");
}

const oldStoredRecordType =
  `  const recordType = aiCanonicalBestPlayType(pick.bestPlayType);`;
const newStoredRecordType =
  `  const recordType = aiBestPlayRecordTypeForSelector(pick.market, pick.play, pick.bestPlayType);`;
if (text.includes(oldStoredRecordType)) {
  text = text.replace(oldStoredRecordType, newStoredRecordType);
} else if (!text.includes(newStoredRecordType)) {
  throw new Error("Stored AI pick Last-7 record type assignment not found");
}

const oldStoredGate = `  const managedByThisGate = pick.rejectionReason.startsWith(
    AI_STORED_LAST7_GATE_PREFIX,
  );
  if (!pick.selected && !managedByThisGate) return null;
`;
const newStoredGate = `  const managedByThisGate = pick.rejectionReason.startsWith(
    AI_STORED_LAST7_GATE_PREFIX,
  );
  // Re-evaluate a pre-first-pitch pick that was blocked by an older numeric
  // threshold so a corrected Last-7 grade can restore an already-completed AI
  // review without paying for another research call.
  const priorThresholdGate =
    !pick.selected &&
    pick.selectorVersion !== AI_PICK_SELECTOR_VERSION &&
    /(?:premium-play threshold|record-based threshold|grade-based requirement)/i.test(
      pick.rejectionReason,
    );
  if (!pick.selected && !managedByThisGate && !priorThresholdGate) return null;
`;
if (text.includes(oldStoredGate)) {
  text = text.replace(oldStoredGate, newStoredGate);
} else if (!text.includes(newStoredGate)) {
  throw new Error("Stored Last-7 gate admission block not found");
}

const oldRestoreGate = `  if (managedByThisGate && !pick.selected) {`;
const newRestoreGate = `  if ((managedByThisGate || priorThresholdGate) && !pick.selected) {`;
if (text.includes(oldRestoreGate)) {
  text = text.replace(oldRestoreGate, newRestoreGate);
} else if (!text.includes(newRestoreGate)) {
  throw new Error("Stored Last-7 restore block not found");
}

text = text.replace(/premium-play threshold/g, "grade-based requirement");

if (text !== original) {
  fs.writeFileSync(path, text, "utf8");
  console.log("Applied grade-aligned Last-7 AI selector patch for build.");
} else {
  console.log("Grade-aligned Last-7 AI selector patch already present.");
}
