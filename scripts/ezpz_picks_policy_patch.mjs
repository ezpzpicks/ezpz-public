import fs from "node:fs";

const ROUTE_PATH = "app/api/public-data/route.ts";
const PAGE_PATH = "app/page.tsx";
const FOOTBALL_PATH = "app/FootballBoard.tsx";
const NOTIFIER_PATH = "scripts/ai_final_notifications.mjs";
const MARKER = "EZPZ_PICKS_POLICY_V2";

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
    .replaceAll("No candidate currently passes every EZPZ AI selection and protection rule", "No candidate currently passes the EZPZ Picks qualification rules")
    .replaceAll("AI Confidence", "EZPZ Confidence")
    .replaceAll("Required AI Score", "Required Score")
    .replaceAll("only HOT Best Play bet types qualify for AI Picks", "only HOT Best Play bet types qualify for EZPZ Picks")
    .replaceAll("qualify for AI Picks", "qualify for EZPZ Picks");
}

function patchRoute(text) {
  text = renamePublicCopy(text);
  text = text.replace(
    /const AI_PICK_SELECTOR_VERSION = "[^"]+";/,
    'const AI_PICK_SELECTOR_VERSION = "ezpz-picks-deterministic-v2";',
  );

  // Yesterday's Trend Play qualification is the qualification gate itself.
  // Good/Strong/Elite are all real Trend Plays; Pass is not. The old AI-only
  // Strong/Elite admission rule incorrectly discarded valid Good Trend Plays.
  text = text.replace(
    /  \/\/ Good-only trends stay visible on the Trend Plays board,[\s\S]*?\n  if \(play\.tier === "Good"\) return;\n/,
    "",
  );

  if (!text.includes(MARKER)) {
    const startMarker = "    // HOT_ONLY_BEST_PLAY_POLICY_V1";
    const endMarker = "    return {";
    const replacement = `    // ${MARKER}\n    const bestPlayBacked = Boolean(candidate.bestPlayType);\n    const trendBacked = Boolean(\n      candidate.trendPlay && candidate.trendPlay.tier !== "Pass",\n    );\n\n    // Best Plays qualify only through HOT rolling Last-7 form. Trend Plays\n    // qualify independently through the Trend Play engine, which already\n    // applies the agreed 7D/30D grading, positive blended ROI, +10 point net\n    // ROI edge, opposing-7D-green veto, head-to-head scoring, and 60+ tier floor.\n    // If a wager is Best + Trend, either valid path can qualify it; a non-HOT\n    // Best Play may not erase an otherwise valid Trend Play.\n    const hotBestPlay =\n      bestPlayBacked && candidate.pitcherBetTypeForm === "HOT";\n\n    // Keep only hard wager-integrity protections. Old AI/research/soft score\n    // protections are intentionally not allowed to override the two explicit\n    // qualification paths above. The -150 maximum price remains a global rule.\n    const hardProtectionReasons = candidate.protectionReasons.filter((reason) => {\n      const value = String(reason || "");\n      return (\n        value === "Playable odds are missing" ||\n        value.includes("maximum price") ||\n        value.includes("could not be matched to today") ||\n        value.includes("betting line is missing") ||\n        value.includes("required selector score is invalid")\n      );\n    });\n    const blocked = hardProtectionReasons.length > 0;\n    const qualifiesByBestPlay = hotBestPlay;\n    const qualifiesByTrend = trendBacked;\n    const preliminarySelected =\n      !blocked && (qualifiesByBestPlay || qualifiesByTrend);\n\n    const thresholdFailure = preliminarySelected\n      ? ""\n      : blocked\n        ? hardProtectionReasons.join(" • ")\n        : bestPlayBacked && !hotBestPlay && !trendBacked\n          ? (candidate.bestPlayType || "Best Play") +\n            " is " +\n            (candidate.pitcherBetTypeForm || "SAMPLE") +\n            " over its rolling Last 7; only HOT Best Play bet types qualify for EZPZ Picks"\n          : !trendBacked && !hotBestPlay\n            ? "This wager no longer meets an EZPZ Picks qualification path"\n            : "";\n    const rejectionReason = thresholdFailure;\n\n    const liveBestPlayReviewNote =\n      snapshotStatus === "LIVE" && preliminarySelected\n        ? qualifiesByBestPlay && qualifiesByTrend\n          ? "Live preview: qualifies as both a HOT Best Play and a current Trend Play. It becomes Final at the frozen 15-minute pregame snapshot if at least one qualifying path still passes."\n          : qualifiesByBestPlay\n            ? "Live preview: qualifies because its Best Play bet type is HOT over the rolling Last 7. It becomes Final at the frozen 15-minute pregame snapshot if it is still HOT."\n            : "Live preview: qualifies through the current Trend Play rules. It becomes Final at the frozen 15-minute pregame snapshot if those trend qualifications are still valid."\n        : "";\n`;
    text = replaceRange(
      text,
      startMarker,
      endMarker,
      replacement,
      "deterministic qualification block",
    );
  }

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
  text = text.replaceAll("Deterministic finalization — no separate AI review", "Locked from the 15-minute qualification snapshot");
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
  text = text.replaceAll('pick?.play || pick?.selection || "AI Pick"', 'pick?.play || pick?.selection || "EZPZ Pick"');
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

console.log("Applied final EZPZ Picks naming, HOT-only Best Play policy, yesterday's Trend Play qualification, and 15-minute deterministic lock policy.");
