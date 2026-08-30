import fs from "node:fs";

const routePath = "app/api/public-data/route.ts";
const pagePath = "app/page.tsx";
const packagePath = "package.json";

let route = fs.readFileSync(routePath, "utf8");
const page = fs.readFileSync(pagePath, "utf8");

function mustInclude(text, marker, label) {
  if (!text.includes(marker)) throw new Error(`Missing ${label}: ${marker}`);
}

function replaceOnce(text, oldText, newText, label) {
  if (!text.includes(oldText)) throw new Error(`Missing replacement target: ${label}`);
  return text.replace(oldText, newText);
}

function replaceRegexOnce(text, pattern, replacement, label) {
  if (!pattern.test(text)) throw new Error(`Missing regex target: ${label}`);
  return text.replace(pattern, replacement);
}

function replaceInsideFunction(text, functionName, oldText, newText, label) {
  const start = text.indexOf(`function ${functionName}(`);
  if (start < 0) throw new Error(`Missing function: ${functionName}`);
  const nextFunction = text.indexOf("\nfunction ", start + 10);
  const end = nextFunction < 0 ? text.length : nextFunction;
  let body = text.slice(start, end);
  if (!body.includes(oldText)) throw new Error(`Missing ${label} inside ${functionName}`);
  body = body.replace(oldText, newText);
  return text.slice(0, start) + body + text.slice(end);
}

// Materialize the current production patch behavior once, then commit it as
// normal source. These checks prevent a partial migration.
for (const [marker, label] of [
  ["All-time is display-only for trend grading", "recent-window trend weighting"],
  ["Recent-window availability, not all-time history, chooses the grading scope.", "recent trend scope"],
  ["netRoiAdvantage >= 10", "+10% net ROI trend gate"],
  ["function aiTrendSignalsAllGreen(play: TrendPlay)", "all-green trend gate"],
  ["playableOdds < -150", "-150 odds cap"],
]) mustInclude(route, marker, label);
mustInclude(page, "netRoiAdvantage >= 10", "page +10% net ROI trend gate");

route = route.replace(
  /const AI_PICK_SELECTOR_VERSION = "[^"]+";/,
  'const AI_PICK_SELECTOR_VERSION = "ezpz-picks-hardcoded-v6-hot-only-roi10";',
);

const policyAnchor = "const AI_MINIMUM_ESTIMATED_ADVANTAGE = 5;\n";
if (!route.includes("const EZPZ_BEST_PLAY_POLICY")) {
  route = replaceOnce(
    route,
    policyAnchor,
    `const AI_MINIMUM_ESTIMATED_ADVANTAGE = 5;\n\n// PERMANENT EZPZ PICKS POLICY. These are normal source rules, not build patches.\n// Best Play path: HOT only, with a maximum price of -150.\n// Trend path: every signal green plus at least +10% net ROI vs the opposing side.\nconst EZPZ_BEST_PLAY_POLICY = {\n  requiredForm: \"HOT\" as const,\n  maxFavoritePrice: -150,\n  minimumScore: 74,\n  minimumProbability: 50,\n  minimumAdvantage: 1.5,\n};\n\nconst EZPZ_TREND_POLICY = {\n  requireAllSignalsGreen: true,\n  minimumNetRoiAdvantage: 10,\n};\n`,
    "EZPZ policy constants",
  );
}

// There is no Neutral/Sample Best Play threshold ladder anymore. The only
// numeric profile is the HOT profile; non-HOT form is blocked separately.
route = replaceRegexOnce(
  route,
  /function aiPitcherRequiredScore\([\s\S]*?\n}\n\n(?=type AiPitcherQualificationProfile)/,
  `function aiPitcherRequiredScore(\n  _record: RecordTotals,\n  _form: AiPitcherBetTypeForm,\n) {\n  return EZPZ_BEST_PLAY_POLICY.minimumScore;\n}\n\n`,
  "Best Play score helper",
);
route = replaceRegexOnce(
  route,
  /function aiPitcherQualificationProfile\([\s\S]*?\n}\n\n(?=function aiHistoricalRecordType)/,
  `function aiPitcherQualificationProfile(\n  _form: AiPitcherBetTypeForm | undefined,\n  _record: RecordTotals | null = null,\n): AiPitcherQualificationProfile {\n  return {\n    score: EZPZ_BEST_PLAY_POLICY.minimumScore,\n    probability: EZPZ_BEST_PLAY_POLICY.minimumProbability,\n    advantage: EZPZ_BEST_PLAY_POLICY.minimumAdvantage,\n    enforceProbability: true,\n  };\n}\n\n`,
  "Best Play qualification profile",
);

// Best Play admission is HOT-only before finalization.
route = replaceInsideFunction(
  route,
  "aiRecordAdjustments",
  'if (form === "COLD") {',
  'if (form !== EZPZ_BEST_PLAY_POLICY.requiredForm) {',
  "HOT-only form gate",
);

// Stored/frozen Best Plays get the same HOT-only recheck so an older row cannot
// be restored through the former Neutral/Sample threshold ladder.
route = replaceInsideFunction(
  route,
  "aiStoredLastSevenQualificationCorrection",
  'if (form === "COLD") {',
  'if (form !== EZPZ_BEST_PLAY_POLICY.requiredForm) {',
  "stored HOT-only gate",
);

// Final selector explicitly requires HOT rather than merely excluding COLD.
route = replaceOnce(
  route,
  'const coldBestPlay = candidate.pitcherBetTypeForm === "COLD";',
  'const hotBestPlay = candidate.pitcherBetTypeForm === EZPZ_BEST_PLAY_POLICY.requiredForm;',
  "finalizer HOT flag",
);
route = replaceOnce(route, "      !coldBestPlay &&", "      hotBestPlay &&", "finalizer HOT requirement");
route = replaceOnce(route, "        if (coldBestPlay) {", "        if (!hotBestPlay) {", "finalizer HOT failure branch");
route = route.replace(
  " is Cold over its rolling Last 7 and is excluded from the Best Play qualification path",
  " is not HOT over its rolling Last 7 and is excluded because Best Play EZPZ Picks are HOT-only",
);

// Bind the already-materialized -150 and +10 rules to permanent source policy.
route = route.replace(
  "playableOdds < -150",
  "playableOdds < EZPZ_BEST_PLAY_POLICY.maxFavoritePrice",
);
route = route.replace(
  "netRoiAdvantage >= 10",
  "netRoiAdvantage >= EZPZ_TREND_POLICY.minimumNetRoiAdvantage",
);

// Every active Trend signal must be green/positive.
route = replaceRegexOnce(
  route,
  /function aiTrendSignalsAllGreen\(play: TrendPlay\) \{[\s\S]*?\n}\n/,
  `function aiTrendSignalsAllGreen(play: TrendPlay) {\n  const signals = play.signals || [];\n  return (\n    EZPZ_TREND_POLICY.requireAllSignalsGreen &&\n    signals.length > 0 &&\n    signals.every((signal) => signal.tone === \"positive\")\n  );\n}\n`,
  "all-green helper",
);

// Remove stale explanatory copy that described Neutral/Sample as valid.
route = route.replace(
  "Hot = 74 score / 50% probability / 1.5% advantage; Neutral = 80 / 52.5% / 3.25%; Small Sample = 86 / 55% / 5%; Cold is excluded before review.",
  "Best Play eligibility is HOT-only: HOT requires 74 score / 50% probability / 1.5% advantage, with odds no worse than -150. Neutral, Small Sample, and Cold are ineligible.",
);

for (const marker of [
  'requiredForm: "HOT" as const',
  "maxFavoritePrice: -150",
  "minimumNetRoiAdvantage: 10",
  "playableOdds < EZPZ_BEST_PLAY_POLICY.maxFavoritePrice",
  "form !== EZPZ_BEST_PLAY_POLICY.requiredForm",
  "hotBestPlay &&",
  "netRoiAdvantage >= EZPZ_TREND_POLICY.minimumNetRoiAdvantage",
  'signals.every((signal) => signal.tone === "positive")',
]) mustInclude(route, marker, "final EZPZ policy invariant");

// Stop mutating production code during Vercel/Next builds. The materialized
// route/page/football/lib files are now the source of truth.
const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
delete pkg.scripts.prebuild;

fs.writeFileSync(routePath, route);
fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + "\n");
console.log("Hard-coded EZPZ policy: Best Plays HOT-only / -150 max; Trend all-green / +10% net ROI. Removed prebuild patch chain.");
