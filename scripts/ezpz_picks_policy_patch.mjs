import fs from "node:fs";

const ROUTE_PATH = "app/api/public-data/route.ts";
const PAGE_PATH = "app/page.tsx";
const FOOTBALL_PATH = "app/FootballBoard.tsx";
const NOTIFIER_PATH = "scripts/ai_final_notifications.mjs";

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
    'const AI_PICK_SELECTOR_VERSION = "ezpz-picks-deterministic-v4-tiered";',
  );

  // IMPORTANT: qualification logic intentionally stays in route.ts. Do not
  // replace it here. Best Plays use the tiered rolling Last-7 thresholds:
  // HOT 74/50/1.5, NEUTRAL 80/52.5/3.25, SAMPLE 86/55/5, COLD excluded.
  // Strong/Elite Trend Plays keep their independent qualification path.
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
  "Applied EZPZ Picks naming while preserving tiered Best Play Last-7 qualification and deterministic 15-minute locking.",
);
