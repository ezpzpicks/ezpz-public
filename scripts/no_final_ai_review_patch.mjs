import fs from "node:fs";

const ROUTE_PATH = "app/api/public-data/route.ts";
const PAGE_PATH = "app/page.tsx";
const NOTIFIER_PATH = "scripts/ai_final_notifications.mjs";
const MARKER = "NO_FINAL_AI_REVIEW_V1";

function replaceRequired(text, search, replacement, label) {
  const next = typeof search === "string"
    ? text.replace(search, replacement)
    : text.replace(search, replacement);
  if (next === text) throw new Error(`No-final-AI-review patch target not found: ${label}`);
  return next;
}

function replaceRange(text, startMarker, endMarker, replacement, label) {
  const start = text.indexOf(startMarker);
  if (start < 0) throw new Error(`No-final-AI-review start target not found: ${label}`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`No-final-AI-review end target not found: ${label}`);
  return text.slice(0, start) + replacement + text.slice(end);
}

function patchRoute(text) {
  if (text.includes(MARKER)) return text;

  text = text.replace(
    /const AI_PICK_SELECTOR_VERSION = "[^"]+";/,
    'const AI_PICK_SELECTOR_VERSION = "deterministic-final-v1";',
  );

  if (!text.includes('| "NOT_REQUIRED";')) {
    text = replaceRequired(
      text,
      '  | "REVIEW_ERROR";',
      '  | "REVIEW_ERROR"\n  | "NOT_REQUIRED";',
      "AI external status union",
    );
  }

  text = replaceRequired(
    text,
    `  if (\n    pick.snapshotStatus !== "FINAL_PREGAME" ||\n    pick.externalReviewStatus !== "WEB_REVIEWED" ||\n    !pick.bestPlayType\n  ) {`,
    `  if (\n    pick.snapshotStatus !== "FINAL_PREGAME" ||\n    !pick.bestPlayType\n  ) {`,
    "Last-7 final gate review dependency",
  );

  text = text.replace(
    "  // This recheck exists only to catch Last-7 changes between final review\n  // and the scheduled start of this specific game.",
    "  // This recheck exists only to catch Last-7 changes between the final\n  // pregame lock and the scheduled start of this specific game.",
  );
  text = text.replace(
    "  // restore the already-completed external review without another AI call.",
    "  // restore the already-locked deterministic selection without any AI call.",
  );

  text = replaceRange(
    text,
    "function aiStoredFinalSelectionIsLocked(pick: AiPick) {",
    "function aiSortByGameTime",
    `function aiStoredFinalSelectionIsLocked(pick: AiPick) {\n  // ${MARKER}: a selected FINAL_PREGAME row is locked without any separate\n  // external AI approval. The free rolling Last-7 gate may still demote or\n  // restore the stored decision before first pitch.\n  return pick.snapshotStatus === "FINAL_PREGAME" && pick.selected === true;\n}\n\nfunction aiStoredFinalDecisionIsTerminal(pick: AiPick) {\n  return pick.snapshotStatus === "FINAL_PREGAME";\n}\n\nfunction aiSortByGameTime`,
    "stored final decision helpers",
  );

  text = replaceRange(
    text,
    "    const review = externalReviews.get(candidate.candidateId);",
    "    const trendBlend = aiTrendBlendWeights(candidate.trendPlay);",
    `    // ${MARKER}: final selection is based only on the deterministic EZPZ\n    // model/trend/record/market/protection inputs already attached to the candidate.\n    const trendBlend = aiTrendBlendWeights(candidate.trendPlay);`,
    "external review score adjustment block",
  );

  text = replaceRange(
    text,
    "    // A FINAL_PREGAME row is publishable only when this candidate actually",
    "    const blocked = candidate.protectionReasons.length > 0;",
    `    // ${MARKER}: FINAL_PREGAME does not require a second AI/web approval.\n    // The same deterministic gates used in live preview are re-evaluated against\n    // the frozen pregame snapshot and then locked.\n    const blocked = candidate.protectionReasons.length > 0;`,
    "missing final external review blocker",
  );

  text = text.replace(
    "and final AI approval.",
    "and the final frozen pregame snapshot still passing every deterministic gate.",
  );

  text = replaceRange(
    text,
    "      externalReviewStatus: review",
    "      snapshotStatus,",
    `      externalReviewStatus: "NOT_REQUIRED" as const,\n      snapshotStatus,`,
    "finalized external review status",
  );

  text = replaceRange(
    text,
    "  // Never leave an interrupted final-review row visible after first pitch",
    "  // A final snapshot is not fully locked until its external review reaches a",
    "",
    "expired final review recovery",
  );

  text = replaceRange(
    text,
    "  // A final snapshot is not fully locked until its external review reaches a",
    "  const targetCandidates = candidates.filter((candidate) => {",
    `  // ${MARKER}: a game enters finalization only after the actual frozen pregame\n  // market snapshot exists. No separate review window or retry queue is used.\n  const storedTodayByCandidateId = new Map(\n    storedToday.map((pick) => [pick.candidateId, pick] as const),\n  );\n  const finalDraftKingsGameKeys = new Set(\n    draftKings.splits\n      .filter(\n        (split) =>\n          split.snapshotStatus === "FINAL_PREGAME" &&\n          (split.market === "Moneyline" || split.market === "Total"),\n      )\n      .map(\n        (split) =>\n          \`${'${isoPublicDate(split.date)}|${normalizeTeam(split.awayTeam)}|${normalizeTeam(split.homeTeam)}'}\`,\n      ),\n  );\n  const storedFinalGameKeys = new Set(\n    storedToday\n      .filter(\n        (pick) =>\n          pick.snapshotStatus === "FINAL_PREGAME" &&\n          pick.externalReviewStatus === "NOT_REQUIRED",\n      )\n      .map((pick) => pick.gameKey),\n  );\n  const targetGameKeys = new Set(\n    slateRows\n      .filter((row) => {\n        const gameKey = draftKingsGameKey(row);\n        return (\n          finalDraftKingsGameKeys.has(gameKey) ||\n          slateHasFinalPregameSnapshot(row)\n        );\n      })\n      .map((row) => draftKingsGameKey(row))\n      .filter((key) => !storedFinalGameKeys.has(key)),\n  );\n  const targetCandidates = candidates.filter((candidate) => {`,
    "finalization target setup",
  );

  text = replaceRange(
    text,
    "  const targetCandidates = candidates.filter((candidate) => {",
    "  const refreshedStored = workingStoredRows.map(parseAiPickRow)",
    `  const targetCandidates = candidates.filter((candidate) => {\n    if (!targetGameKeys.has(candidate.gameKey)) return false;\n    const started = candidate.slateRow\n      ? !isPregameRow(candidate.slateRow, selectorNow)\n      : false;\n    return !started;\n  });\n\n  if (targetCandidates.length) {\n    const finalTargetPicks = finalizeAiCandidates(\n      targetCandidates,\n      new Map(),\n      "NOT_REQUIRED",\n      "FINAL_PREGAME",\n    );\n    await persistAiPickRows(finalTargetPicks);\n    const finalRows = finalTargetPicks.map(aiPickRow);\n    const finalizedCandidateIds = new Set(\n      finalTargetPicks.map((pick) => pick.candidateId),\n    );\n    workingStoredRows = [\n      ...workingStoredRows.filter((row) => {\n        const storedPick = parseAiPickRow(row);\n        return !storedPick || !finalizedCandidateIds.has(storedPick.candidateId);\n      }),\n      ...finalRows,\n    ];\n  }\n\n  const refreshedStored = workingStoredRows.map(parseAiPickRow)`,
    "external AI request lifecycle",
  );

  text = text.replace(
    '    process.env.OPENAI_API_KEY ? "PENDING_FINAL_REVIEW" : "NOT_CONFIGURED",',
    '    "NOT_REQUIRED",',
  );

  text = text.replaceAll(
    "externalResearchConfigured: Boolean(process.env.OPENAI_API_KEY)",
    "externalResearchConfigured: false",
  );
  text = text.replace(
    "locked at final pregame review",
    "locked at final pregame snapshot",
  );
  text = text.replace(
    "Live selector preview; external context is reviewed and locked with the final pregame snapshot",
    "Live selector preview; final selection locks from the frozen pregame snapshot using deterministic EZPZ gates",
  );

  return text;
}

function patchPage(text) {
  if (text.includes(MARKER)) return text;

  if (!text.includes('| "NOT_REQUIRED";')) {
    text = replaceRequired(
      text,
      '  | "REVIEW_ERROR";',
      '  | "REVIEW_ERROR"\n  | "NOT_REQUIRED";',
      "page AI external status union",
    );
  }

  text = replaceRange(
    text,
    "function aiExternalReviewLabel(status: AiPickExternalStatus) {",
    "function cleanAiDisplayText",
    `function aiExternalReviewLabel(status: AiPickExternalStatus) {\n  // ${MARKER}\n  if (status === "NOT_REQUIRED") return "Deterministic finalization — no separate AI review";\n  if (status === "WEB_REVIEWED") return "Legacy external review record";\n  if (status === "NO_VERIFIED_CONTEXT") return "Legacy no-context review record";\n  if (status === "PENDING_FINAL_REVIEW") return "Legacy pending review record";\n  if (status === "REVIEW_ERROR") return "Legacy review error record";\n  return "Legacy review status";\n}\n\nfunction cleanAiDisplayText`,
    "page external review label",
  );

  text = replaceRequired(
    text,
    `  const isFinalReview =\n    pick.snapshotStatus === "FINAL_PREGAME" &&\n    pick.externalReviewStatus === "WEB_REVIEWED" &&\n    pick.protectionStatus === "PASSED";`,
    `  const isFinalReview =\n    pick.snapshotStatus === "FINAL_PREGAME" &&\n    pick.protectionStatus === "PASSED";`,
    "page final badge dependency",
  );

  text = text.replace(
    "This candidate currently clears the preliminary score, probability, value, and protection thresholds; final AI review is still pending.",
    "This candidate currently clears the score, probability, value, and protection thresholds; the final frozen pregame snapshot has not locked yet.",
  );
  text = text.replace(
    "PENDING — UNDER REVIEW",
    "LIVE — NOT LOCKED",
  );
  text = text.replace(
    "The selector is reviewing today’s Best Plays and Trend Plays.",
    "The selector is evaluating today’s Best Plays and Trend Plays with deterministic EZPZ gates.",
  );

  return text;
}

function patchNotifier(text) {
  if (text.includes(`${MARKER}: notifier`)) return text;
  text = replaceRequired(
    text,
    `    .filter((pick) => pick?.protectionStatus === "PASSED")\n    .filter((pick) => pick?.snapshotStatus === "FINAL_PREGAME")\n    .filter((pick) => pick?.externalReviewStatus === "WEB_REVIEWED");`,
    `    .filter((pick) => pick?.protectionStatus === "PASSED")\n    // ${MARKER}: notifier\n    .filter((pick) => pick?.snapshotStatus === "FINAL_PREGAME");`,
    "final pick notification review filter",
  );
  return text;
}

const routeOriginal = fs.readFileSync(ROUTE_PATH, "utf8");
const pageOriginal = fs.readFileSync(PAGE_PATH, "utf8");
const notifierOriginal = fs.readFileSync(NOTIFIER_PATH, "utf8");

const routePatched = patchRoute(routeOriginal);
const pagePatched = patchPage(pageOriginal);
const notifierPatched = patchNotifier(notifierOriginal);

if (routePatched !== routeOriginal) fs.writeFileSync(ROUTE_PATH, routePatched, "utf8");
if (pagePatched !== pageOriginal) fs.writeFileSync(PAGE_PATH, pagePatched, "utf8");
if (notifierPatched !== notifierOriginal) fs.writeFileSync(NOTIFIER_PATH, notifierPatched, "utf8");

console.log("Applied deterministic final AI-pick locking with no separate AI/web review.");
