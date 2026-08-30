import fs from "node:fs";

const ROUTE_PATH = "app/api/public-data/route.ts";
const PAGE_PATH = "app/page.tsx";
const FOOTBALL_PATH = "app/FootballBoard.tsx";
const NOTIFIER_PATH = "scripts/ai_final_notifications.mjs";

function replaceRange(text, startMarker, endMarker, replacement, label) {
  const start = text.indexOf(startMarker);
  if (start < 0) throw new Error(`EZPZ Picks policy start target not found: ${label}`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`EZPZ Picks policy end target not found: ${label}`);
  return text.slice(0, start) + replacement + text.slice(end);
}

function renamePublicCopy(text) {
  return text
    .replaceAll("EZPZ AI Pick Selector", "EZPZ Picks")
    .replaceAll("EZPZ AI Picks", "EZPZ Picks")
    .replaceAll("EZPZ AI Pick", "EZPZ Pick")
    .replaceAll("Final AI Pick", "Final EZPZ Pick")
    .replaceAll("AI Pick Final", "EZPZ Pick Final")
    .replaceAll(
      "No candidate currently passes every EZPZ AI selection and protection rule",
      "No candidate currently passes the EZPZ Picks qualification rules",
    )
    .replaceAll("AI Confidence", "EZPZ Confidence")
    .replaceAll("Required AI Score", "Required Score")
    .replaceAll("qualify for AI Picks", "qualify for EZPZ Picks");
}

function patchRoute(text) {
  text = renamePublicCopy(text);
  text = text.replace(
    /const AI_PICK_SELECTOR_VERSION = "[^"]+";/,
    'const AI_PICK_SELECTOR_VERSION = "ezpz-picks-deterministic-v5-tiered-paths";',
  );

  // This is the final selector-policy pass in prebuild. Earlier legacy patches
  // still contain old external-review/HOT-only code and can leave dangling
  // `review` references after the deterministic-review cleanup. Replace the
  // complete finalizer here so production always uses one coherent policy.
  //
  // Best Play path:
  //   HOT     74 score / 50% probability / 1.5% advantage
  //   NEUTRAL 80 score / 52.5% probability / 3.25% advantage
  //   SAMPLE  86 score / 55% probability / 5% advantage
  //   COLD    excluded from the Best Play path
  // Trend path:
  //   Strong/Elite (69+) + qualification score 80+
  //
  // Best + Trend candidates may qualify through either valid path. A weak or
  // COLD Best Play must not erase an otherwise valid Strong/Elite Trend Play.
  const deterministicFinalizer = `function finalizeAiCandidates(
  candidates: AiSelectorCandidate[],
  _externalReviews: Map<string, AiExternalReview>,
  _externalStatus: AiPickExternalStatus,
  snapshotStatus: AiPickSnapshotStatus,
  _reviewErrors: Map<string, string> = new Map(),
) {
  const finalized = candidates.map((candidate) => {
    const trendBlend = aiTrendBlendWeights(candidate.trendPlay);
    const baseScore = candidate.source === "Best + Trend"
      ? candidate.modelScore * trendBlend.modelWeight +
        candidate.trendScore * trendBlend.trendWeight
      : candidate.source === "Trend Play" && !candidate.bestPlayType
        ? aiTrendOnlyBaseScore(candidate.trendScore)
        : candidate.modelScore || candidate.trendScore;
    const aiScore = clampScore(baseScore + candidate.scoreAdjustment);
    const estimatedProbability = aiRound(
      aiClamp(candidate.baselineProbability + candidate.probabilityAdjustment, 40, 82),
      1,
    );
    const implied = candidate.marketImpliedProbability || aiImpliedProbability(candidate.odds);
    const advantage = implied ? aiRound(estimatedProbability - implied, 1) : 0;

    const blocked = candidate.protectionReasons.length > 0;
    const bestPlayBacked = Boolean(candidate.bestPlayType);
    const trendBacked = Boolean(candidate.trendPlay);
    const rawTrendScore = Number(candidate.trendScore || 0);

    const bestPlayProfile = aiPitcherQualificationProfile(
      candidate.pitcherBetTypeForm,
    );
    const bestPlayRequiredScore =
      candidate.pitcherRequiredScore || bestPlayProfile.score;
    const coldBestPlay = candidate.pitcherBetTypeForm === "COLD";

    const qualifiesByBestPlay =
      bestPlayBacked &&
      !coldBestPlay &&
      aiScore >= bestPlayRequiredScore &&
      (!bestPlayProfile.enforceProbability ||
        estimatedProbability >= bestPlayProfile.probability) &&
      (!implied || advantage >= bestPlayProfile.advantage);

    const qualifiesByTrend =
      trendBacked &&
      rawTrendScore >= 69 &&
      aiScore >= 80;

    const preliminarySelected =
      !blocked && (qualifiesByBestPlay || qualifiesByTrend);

    let thresholdFailure = "";
    if (!preliminarySelected && !blocked) {
      const failures: string[] = [];
      if (bestPlayBacked) {
        if (coldBestPlay) {
          failures.push(
            `${candidate.bestPlayType || "Best Play"} is Cold over its rolling Last 7 and is excluded from the Best Play qualification path`,
          );
        } else if (aiScore < bestPlayRequiredScore) {
          failures.push(
            `qualification score ${aiScore} did not reach the ${bestPlayRequiredScore} Best Play requirement`,
          );
        } else if (
          bestPlayProfile.enforceProbability &&
          estimatedProbability < bestPlayProfile.probability
        ) {
          failures.push(
            `Estimated probability ${estimatedProbability.toFixed(1)}% did not reach ${bestPlayProfile.probability.toFixed(1)}% for the Best Play path`,
          );
        } else if (implied && advantage < bestPlayProfile.advantage) {
          failures.push(
            `Estimated advantage ${advantage.toFixed(1)}% did not reach ${bestPlayProfile.advantage.toFixed(2)}% for the Best Play path`,
          );
        }
      }
      if (trendBacked) {
        if (rawTrendScore < 69) {
          failures.push(
            `Trend score ${rawTrendScore} did not reach the 69 Strong-trend minimum`,
          );
        } else if (aiScore < 80) {
          failures.push(
            `qualification score ${aiScore} did not reach the 80 Trend Play requirement`,
          );
        }
      }
      thresholdFailure = failures.join(" • ") ||
        "This wager does not currently meet an EZPZ Picks qualification path";
    }

    const rejectionReason = blocked
      ? candidate.protectionReasons.join(" • ")
      : thresholdFailure;

    const liveQualificationNote =
      snapshotStatus === "LIVE" && preliminarySelected
        ? qualifiesByBestPlay && qualifiesByTrend
          ? "Live preview: qualifies through both the Best Play and Strong/Elite Trend Play paths; it locks from the frozen 15-minute pregame snapshot if at least one path still passes."
          : qualifiesByBestPlay
            ? `Live preview: qualifies through the ${candidate.pitcherBetTypeForm || "SAMPLE"} Best Play path; it locks from the frozen 15-minute pregame snapshot if that path still passes.`
            : "Live preview: qualifies through the Strong/Elite Trend Play path; it locks from the frozen 15-minute pregame snapshot if that path still passes."
        : "";

    return {
      ...candidate,
      aiScore,
      estimatedProbability,
      marketImpliedProbability: implied,
      estimatedAdvantage: advantage,
      selected: preliminarySelected,
      protectionStatus: blocked ? "BLOCKED" as const : "PASSED" as const,
      rejectionReason,
      confidenceReason: sanitizeAiPublicList(candidate.confidenceReason, 6),
      whySelected: sanitizeAiPublicList(
        liveQualificationNote
          ? [liveQualificationNote, ...candidate.whySelected]
          : candidate.whySelected,
        14,
      ),
      historicalNotes: sanitizeAiPublicList(candidate.historicalNotes, 5),
      risks: [],
      researchSummary: sanitizeAiPublicText(candidate.researchSummary),
      verdict: sanitizeAiPublicText(candidate.verdict),
      dataStatus: [
        ...new Set(
          [liveQualificationNote, ...candidate.dataStatus].filter(Boolean),
        ),
      ].slice(0, 5),
      externalReviewStatus: "NOT_REQUIRED" as const,
      snapshotStatus,
      lockedAt: snapshotStatus === "FINAL_PREGAME" ? nowET() : "",
      updatedAt: nowET(),
    };
  });

  const publicPicks = finalized.map(({
    slateRow,
    bestPlay,
    trendPlay,
    baselineProbability,
    scoreAdjustment,
    probabilityAdjustment,
    protectionReasons,
    ...pick
  }) => pick as AiPick);

  return applyAiFullGameMarketLimit(publicPicks);
}

`;

  text = replaceRange(
    text,
    "function finalizeAiCandidates(",
    "function aiFullGameMarketSourceRank",
    deterministicFinalizer,
    "deterministic tiered finalizer",
  );

  text = text.replaceAll("AI play odds ", "EZPZ Pick odds ");
  text = text.replaceAll("AI odds cap: -150 maximum", "EZPZ Picks odds cap: -150 maximum");
  text = text.replaceAll("AI score ", "qualification score ");
  text = text.replaceAll("Final AI review", "Final selector review");
  text = text.replaceAll("final AI approval", "final qualification");
  text = text.replaceAll("AI Pick Selector is unavailable", "EZPZ Picks is unavailable");
  return text;
}

function patchPage(text) {
  text = renamePublicCopy(text);
  text = text.replaceAll(
    "Deterministic finalization — no separate AI review",
    "Locked from the 15-minute qualification snapshot",
  );
  text = text.replaceAll("Legacy external review record", "Legacy selector record");
  text = text.replaceAll("Legacy no-context review record", "Legacy selector record");
  text = text.replaceAll("Legacy pending review record", "Legacy selector record");
  text = text.replaceAll("Legacy review error record", "Legacy selector record");
  text = text.replaceAll("Legacy review status", "Legacy selector record");
  text = text.replaceAll("AI Confidence", "EZPZ Confidence");
  text = text.replaceAll("Required AI Score", "Required Score");
  text = text.replaceAll("AI score", "qualification score");
  return text;
}

function patchFootball(text) {
  text = renamePublicCopy(text);
  text = text.replaceAll("AI picks are not enabled yet", "EZPZ Picks are not enabled yet");
  return text;
}

function patchNotifier(text) {
  text = renamePublicCopy(text);
  text = text.replaceAll(
    'pick?.play || pick?.selection || "AI Pick"',
    'pick?.play || pick?.selection || "EZPZ Pick"',
  );
  text = text.replaceAll("AI Score ", "Qualification Score ");
  text = text.replaceAll("AI notification", "EZPZ Picks notification");
  text = text.replaceAll("AI-final notifier", "EZPZ Picks final notifier");
  return text;
}

const routeOriginal = fs.readFileSync(ROUTE_PATH, "utf8");
const pageOriginal = fs.readFileSync(PAGE_PATH, "utf8");
const footballOriginal = fs.readFileSync(FOOTBALL_PATH, "utf8");
const notifierOriginal = fs.readFileSync(NOTIFIER_PATH, "utf8");

const routePatched = patchRoute(routeOriginal);
const pagePatched = patchPage(pageOriginal);
const footballPatched = patchFootball(footballOriginal);
const notifierPatched = patchNotifier(notifierOriginal);

if (routePatched !== routeOriginal) fs.writeFileSync(ROUTE_PATH, routePatched, "utf8");
if (pagePatched !== pageOriginal) fs.writeFileSync(PAGE_PATH, pagePatched, "utf8");
if (footballPatched !== footballOriginal) fs.writeFileSync(FOOTBALL_PATH, footballPatched, "utf8");
if (notifierPatched !== notifierOriginal) fs.writeFileSync(NOTIFIER_PATH, notifierPatched, "utf8");

console.log(
  "Applied deterministic tiered EZPZ Picks qualification with independent Best Play and Trend Play paths plus 15-minute locking.",
);
