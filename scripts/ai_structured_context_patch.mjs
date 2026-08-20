import fs from "node:fs";

const path = "app/api/public-data/route.ts";
let text = fs.readFileSync(path, "utf8");
const original = text;

// This patch upgrades the AI review so it relies on already-fetched game/model data first,
// and only uses web search for supplemental context that is not present in the builder data.
// It intentionally avoids adding a new external data dependency.

// 1) Raise default search context from low -> medium for supplemental research.
text = text.replace(
  'process.env.EZPZ_AI_SEARCH_CONTEXT_SIZE || "low"',
  'process.env.EZPZ_AI_SEARCH_CONTEXT_SIZE || "medium"',
);
text = text.replace(
  ': "low";',
  ': "medium";',
);

// 2) Make the research prompt explicitly trust structured builder/model context.
const oldPrimary =
  "Use modelGameContext as the primary quantitative source. The purpose of external research is NOT to rediscover or independently corroborate the model/trend signal. Its purpose is to determine whether today's specific matchup provides verified evidence that strengthens, weakens, or leaves unchanged the supplied quantitative case.";
const newPrimary =
  "Use modelGameContext as the PRIMARY SOURCE OF TRUTH for any structured game information already supplied by EZPZ. This context is assembled from the same upstream data used by the slate/model builder, so do not spend web-search calls re-verifying a starter, lineup, projection, recent-form value, bullpen value, park/weather value, or other field that is already explicitly present there. External web research is supplemental only: use it for missing, time-sensitive, qualitative, or news-like context that the structured builder data does not contain. The purpose of external research is NOT to rediscover or independently corroborate the model/trend signal. Its purpose is to determine whether today's specific matchup provides verified evidence that strengthens, weakens, or leaves unchanged the supplied quantitative case.";

if (text.includes(oldPrimary)) {
  text = text.replace(oldPrimary, newPrimary);
} else if (!text.includes(newPrimary)) {
  console.warn("Primary structured-context prompt sentence was not found; continuing without replacement.");
}

// 3) Add rules that prevent the model from calling already-present structured facts 'unverified'.
const anchor =
  "MISSING INFORMATION IS NEUTRAL, NOT NEGATIVE. Failure to find or verify a requested fact is never evidence against a wager.";
const structuredRules = `STRUCTURED DATA RULES\n- Treat explicit fields in modelGameContext as already verified EZPZ inputs unless the prompt specifically labels a field projected, stale, missing, or uncertain.\n- If modelGameContext names the scheduled/probable starters, do NOT say the starters could not be verified merely because a web search did not return an MLB.com or RotoWire result.\n- If modelGameContext includes a lineup or lineup-derived matchup values, use them directly and identify them as EZPZ structured data; only web-search for a lineup when the structured context says it is missing/projected and today's confirmation is decision-relevant.\n- If modelGameContext includes bullpen usage, recent-form, pitch-count/leash, injury, or weather/park fields, use them before searching the web.\n- Never overwrite a concrete structured fact with a weaker generic search result or a search failure. A direct verified contradiction from a high-quality current source may be noted as a conflict, but absence of a search result is not a contradiction.\n- In the written explanation, distinguish 'EZPZ structured data' from 'supplemental web research' so the user can see which facts came from the builder versus the web.\n\n`;

if (text.includes(anchor) && !text.includes("STRUCTURED DATA RULES")) {
  text = text.replace(anchor, structuredRules + anchor);
}

// 4) Encourage efficient tool use instead of mandatory broad source re-checks.
text = text.replace(
  "Do not claim a lineup or starter could not be found until MLB.com and RotoWire have both been attempted.",
  "Only perform MLB.com/RotoWire starter or lineup lookups when the structured EZPZ context does not already provide the needed information. If the structured context already provides it, do not waste a search call re-checking it.",
);
text = text.replace(
  "First use ESPN's previous-game box score and pitching lines to identify relievers used, innings/pitches when available, and back-to-back workload. MLB.com previous-game box scores/Gameday are the backup.",
  "If bullpen usage is not already present in modelGameContext, first use ESPN's previous-game box score and pitching lines to identify relievers used, innings/pitches when available, and back-to-back workload. MLB.com previous-game box scores/Gameday are the backup.",
);

// 5) Add a concise provenance note to the shared-field instructions.
const oldShared =
  "The shared fields must be concise but matchup-specific: startingPitching names both starters and any prop pitcher and notes confirmed/projected lineup context when material; bullpenAnalysis covers previous-game usage/availability or says no material concern was verified; recentTeamForm covers both teams; historicalMatchup includes meaningful split/history sample context or says no meaningful sample exists.";
const newShared =
  "The shared fields must be concise but matchup-specific: startingPitching names both starters and any prop pitcher and notes confirmed/projected lineup context when material; bullpenAnalysis covers previous-game usage/availability or says no material concern was verified; recentTeamForm covers both teams; historicalMatchup includes meaningful split/history sample context or says no meaningful sample exists. Prefer facts already present in EZPZ structured/modelGameContext, and use supplemental web research only for gaps. Do not describe a structured fact as unverified just because web search did not independently find it.";
if (text.includes(oldShared)) {
  text = text.replace(oldShared, newShared);
}

if (text !== original) {
  fs.writeFileSync(path, text, "utf8");
  console.log("Applied structured-data-first AI research patch.");
} else {
  console.log("Structured-data-first AI research patch already present or no matching anchors found.");
}
