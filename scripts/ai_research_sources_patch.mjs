import fs from "node:fs";

const path = "app/api/public-data/route.ts";
let text = fs.readFileSync(path, "utf8");
const original = text;

const oldMaxToolCalls = `      tool_choice: "required",
      max_tool_calls: 1,
      parallel_tool_calls: false,`;
const newMaxToolCalls = `      tool_choice: "required",
      // Two targeted searches are the default: one for starters/lineups and one
      // for bullpen/recent-game context. Keep this configurable so research
      // quality can be raised without another code change.
      max_tool_calls: Math.max(
        1,
        Math.min(4, Math.floor(Number(process.env.EZPZ_AI_MAX_WEB_SEARCH_CALLS || 2) || 2)),
      ),
      parallel_tool_calls: false,`;

if (text.includes(oldMaxToolCalls)) {
  text = text.replace(oldMaxToolCalls, newMaxToolCalls);
} else if (!text.includes(newMaxToolCalls)) {
  throw new Error("AI web-search max_tool_calls block not found");
}

const oldOpening =
  "You are the final pregame MLB research analyst for EZPZ AI Picks. Use one web search to research this one game, then evaluate every supplied candidate using the same verified pregame facts. Never use information from after first pitch and do not invent statistics.";
const newOpening =
  "You are the final pregame MLB research analyst for EZPZ AI Picks. Perform targeted web research for this one game, then evaluate every supplied candidate using the same verified pregame facts. Never use information from after first pitch and do not invent statistics.";

if (text.includes(oldOpening)) {
  text = text.replace(oldOpening, newOpening);
} else if (!text.includes(newOpening)) {
  throw new Error("AI research prompt opening not found");
}

const oldResearchParagraph =
  "Use modelGameContext as the primary quantitative source. Verify only decision-relevant details: probable/confirmed starters, projected lineups, recent 3-5-start form, workload/leash, bullpen availability, meaningful matchup or split evidence, and weather/park only if material. State plainly when a split or history sample is unavailable or too small.";

const sourceHierarchy = `SOURCE HIERARCHY AND REQUIRED LOOKUPS
1) STARTERS + TODAY'S LINEUPS: First use MLB.com official Probable Pitchers/Gameday for confirmed starters and official lineup information. Use RotoWire MLB Daily Lineups as the primary backup and as the preferred projected-lineup source when MLB has not posted a confirmed lineup. Do not claim a lineup or starter could not be found until MLB.com and RotoWire have both been attempted.
2) BULLPEN AVAILABILITY/USAGE: First use ESPN's previous-game box score and pitching lines to identify relievers used, innings/pitches when available, and back-to-back workload. MLB.com previous-game box scores/Gameday are the backup. Focus on the previous 1-2 days and the leverage relievers most likely to matter tonight.
3) STARTER RECENT FORM + WORKLOAD: Prefer MLB.com or ESPN game logs for the last 3-5 starts. For pitcher strikeout candidates, use Baseball Savant when useful for whiff, strikeout, arsenal, pitch-mix, velocity, or matchup evidence.
4) TEAM RECENT FORM: Prefer MLB.com or ESPN schedule/results for recent games. Use relevant recent scoring/run-prevention context rather than generic season record alone.
5) INJURIES/ABSENCES: Prefer MLB.com/team injury information, with RotoWire or ESPN as backup. Only treat an injury as material when it meaningfully affects the wager being reviewed.
6) MATCHUP/SPLITS: Use Baseball Savant or FanGraphs for meaningful handedness, contact, strikeout, or historical matchup evidence when relevant. Explicitly acknowledge small samples.
7) WEATHER/PARK: Check only when weather, wind, temperature, roof status, or park conditions could materially affect this wager.

Use modelGameContext as the primary quantitative source. The purpose of external research is NOT to rediscover or independently corroborate the model/trend signal. Its purpose is to determine whether today's specific matchup provides verified evidence that strengthens, weakens, or leaves unchanged the supplied quantitative case.

MISSING INFORMATION IS NEUTRAL, NOT NEGATIVE. Failure to find or verify a requested fact is never evidence against a wager. If a lineup, bullpen detail, split, injury update, or other requested item remains unavailable after the required source attempts, state that it was not verified and assign 0 adjustment for that missing fact. Never reduce adjustment, set approved=false, or describe the case as weakened merely because research did not find corroborating information. A negative adjustment requires actual verified evidence that is adverse to the wager.`;

if (text.includes(oldResearchParagraph)) {
  text = text.replace(oldResearchParagraph, sourceHierarchy);
} else if (!text.includes(sourceHierarchy)) {
  throw new Error("AI research source-hierarchy insertion point not found");
}

const oldSharedFields =
  "The shared fields must be concise but matchup-specific: startingPitching names both starters and any prop pitcher; bullpenAnalysis covers availability or says no material concern was verified; recentTeamForm covers both teams; historicalMatchup includes sample context or says no meaningful sample exists.";
const newSharedFields =
  "The shared fields must be concise but matchup-specific: startingPitching names both starters and any prop pitcher and notes confirmed/projected lineup context when material; bullpenAnalysis covers previous-game usage/availability or says no material concern was verified; recentTeamForm covers both teams; historicalMatchup includes meaningful split/history sample context or says no meaningful sample exists.";

if (text.includes(oldSharedFields)) {
  text = text.replace(oldSharedFields, newSharedFields);
} else if (!text.includes(newSharedFields)) {
  throw new Error("AI shared research fields paragraph not found");
}

const oldPitcherKs =
  "Test the projection versus line, opposing lineup K/contact tendencies, pitcher arsenal/whiff fit, recent starts, innings/pitch count/leash, relevant history sample, and whether today’s lineup differs from generic team rates. A negative net assessment must be approved=false.";
const newPitcherKs =
  "Test the projection versus line, today's confirmed/projected opposing lineup K/contact tendencies, pitcher arsenal/whiff fit, recent 3-5 starts, innings/pitch count/leash, relevant history sample, and whether today's lineup differs from generic team rates. A negative adjustment or veto must cite actual adverse evidence, not missing data.";

if (text.includes(oldPitcherKs)) {
  text = text.replace(oldPitcherKs, newPitcherKs);
} else if (!text.includes(newPitcherKs)) {
  throw new Error("Pitcher-strikeout research paragraph not found");
}

if (text !== original) {
  fs.writeFileSync(path, text, "utf8");
  console.log("Applied targeted MLB AI research source hierarchy for build.");
} else {
  console.log("Targeted MLB AI research source hierarchy already present.");
}
