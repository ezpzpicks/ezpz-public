import fs from "node:fs";

const path = "app/api/public-data/route.ts";
let text = fs.readFileSync(path, "utf8");
const original = text;

// Give the reviewer enough tool calls to inspect the fixed sources when they are
// relevant. It does not need to use every source for every market (for example,
// Baseball Savant is primarily for pitcher-K reviews and weather is skipped for
// domes/indoor games).
text = text.replace(
  "// Two targeted searches are the default: one for starters/lineups and one\n      // for bullpen/recent-game context. Keep this configurable so research\n      // quality can be raised without another code change.",
  "// Fixed-source research checklist. Allow enough searches to inspect each\n      // relevant source without forcing unnecessary lookups for every market.",
);
text = text.replace(
  "Math.min(4, Math.floor(Number(process.env.EZPZ_AI_MAX_WEB_SEARCH_CALLS || 2) || 2)),",
  "Math.min(7, Math.floor(Number(process.env.EZPZ_AI_MAX_WEB_SEARCH_CALLS || 6) || 6)),",
);

text = text.replace(
  "You are the final pregame MLB research analyst for EZPZ AI Picks. Start with the supplied EZPZ structured builder data, then use targeted web research only to fill decision-relevant gaps or verify genuinely time-sensitive context. Evaluate every supplied candidate using the same pregame facts. Never use information from after first pitch and do not invent statistics.",
  "You are the final pregame MLB research analyst for EZPZ AI Picks. Start with the supplied EZPZ builder/model data, then answer the fixed research questions below using the exact URLs provided. Your job is to look, compare, and grade the evidence—not to search broadly for reasons to agree with the wager. Never use information from after first pitch and do not invent statistics.",
);

const sourceBlockPattern =
  /SOURCE HIERARCHY AND REQUIRED LOOKUPS[\s\S]*?MISSING INFORMATION IS NEUTRAL, NOT NEGATIVE\./;

const fixedChecklist = String.raw`FIXED RESEARCH CHECKLIST — USE THESE EXACT SOURCES
Use builderGameContext/modelGameContext as the baseline quantitative case. Do not re-research the model or trend itself. For every applicable question below, return exactly one evidence direction internally: SUPPORTS, OPPOSES, or NEUTRAL. A fact is SUPPORTS/OPPOSES only when it materially changes the expected outcome of this exact wager. Merely confirming what was already expected is NEUTRAL.

1) STARTING PITCHERS — Are the scheduled starters the same pitchers assumed by EZPZ, and is there any announced opener/bulk-role or starter change that materially affects the wager?
SOURCE: https://www.rotowire.com/baseball/projected-starters.php
COMPARE: RotoWire scheduled/probable starters vs builderGameContext/modelGameContext. Expected starter confirmed = NEUTRAL. A material starter/role change may SUPPORT or OPPOSE.

2) TODAY'S LINEUPS — Does today's confirmed/projected lineup materially help or hurt this wager compared with the lineup assumptions and hitter context supplied by EZPZ?
SOURCE: https://www.rotowire.com/baseball/daily-lineups.php
COMPARE: actual/projected hitters, handedness, meaningful scratches/rest, and batting-order changes vs the EZPZ context. Normal/expected lineup = NEUTRAL. Do not award support just because a lineup was confirmed.

3) BULLPEN USAGE — Has either bullpen been heavily used recently, are important relievers on back-to-back/heavy workloads, or is there a meaningful rest advantage that changes this wager?
SOURCE: https://www.rotowire.com/baseball/bullpen-usage.php
COMPARE: both teams' bullpen usage over the last five days, with emphasis on recent pitch counts and likely high-leverage relievers. A normally rested bullpen = NEUTRAL. Only a meaningful workload/rest imbalance should SUPPORT or OPPOSE.

4) RECENT FORM / WORKLOAD — Do the starters' last 3-5 outings or the teams' recent results show a material change that the EZPZ baseline may not fully capture?
SOURCE: https://www.espn.com/mlb/scoreboard
COMPARE: recent box scores/results for innings, pitch count when available, strikeouts, walks, runs allowed, scoring and run prevention. Small routine fluctuations = NEUTRAL. Use recent form only when it is clearly relevant to this wager.

5) INJURIES / ABSENCES — Is there a current injury, scratch, activation, or absence that materially changes this wager?
SOURCE: https://www.rotowire.com/baseball/news.php?injuries=all
COMPARE: relevant current injury news against today's lineup and EZPZ assumptions. Ignore injuries that do not materially affect the wager. No meaningful injury news = NEUTRAL.

6) PITCHER STRIKEOUT MATCHUP — APPLY ONLY TO PITCHER-K CANDIDATES. Does the actual opposing lineup and the pitcher's current strikeout/whiff profile materially support or oppose the EZPZ K projection and betting line?
SOURCE: https://baseballsavant.mlb.com/statcast_search
COMPARE: projection vs line, actual opposing hitters' K/contact tendencies, pitcher strikeout/whiff/pitch-mix or velocity context, and recent workload. Do not use generic team K rate when the actual lineup is available. If the evidence does not materially change the EZPZ case, mark NEUTRAL.

7) WEATHER / PARK — APPLY ONLY WHEN MATERIAL. Do current game conditions materially help or hurt this wager?
SOURCE: https://www.rotowire.com/baseball/weather.php
COMPARE: wind, temperature, precipitation/delay risk, roof/dome status and only meaningful park-condition effects. Ordinary weather or an indoor/domed game = NEUTRAL. Do not award support simply because weather is not a problem.

GRADING RULES
- Use only the fixed sources above plus the supplied EZPZ structured data unless a direct current contradiction requires clarification.
- Do not browse broadly for generic articles, season narratives, opinions, betting picks, or reasons to confirm the wager.
- Confirmed expected starter = NEUTRAL. Expected lineup = NEUTRAL. Rested bullpen with no special edge = NEUTRAL. No injury issue = NEUTRAL. Normal weather = NEUTRAL.
- Research adjustment must be 0 when the relevant evidence is neutral or balanced.
- A positive adjustment requires at least one verified, wager-specific SUPPORTS finding. One modest material support is usually +1; stronger support may be +2; multiple independent strong supports may justify +3. Reserve +4 to +6 for rare, truly major verified pregame changes.
- Negative adjustments follow the same scale for OPPOSES evidence. A critical conflict may justify approved=false.
- Do not turn missing information into negative evidence, and do not turn mere verification into positive evidence.
- In researchSummary/WHY, report only the decisive SUPPORTS/OPPOSES findings and important NEUTRAL context. Keep it concise.

MISSING INFORMATION IS NEUTRAL, NOT NEGATIVE.`;

if (sourceBlockPattern.test(text)) {
  text = text.replace(sourceBlockPattern, fixedChecklist);
} else if (!text.includes("FIXED RESEARCH CHECKLIST — USE THESE EXACT SOURCES")) {
  throw new Error("Fixed AI research checklist insertion point not found");
}

const structuredSharedFields =
  "The shared fields must be concise but matchup-specific: startingPitching names both starters and any prop pitcher and notes confirmed/projected lineup context when material; bullpenAnalysis uses structured bullpen context first and supplements exact recent reliever usage when needed; recentTeamForm covers both teams using structured context first; historicalMatchup includes meaningful split/history sample context or says no meaningful sample exists. Never describe a concrete builderGameContext/modelGameContext fact as unverified simply because web search failed to reproduce it.";
const conciseSharedFields =
  "Keep the shared fields concise and evidence-only. Use the fixed checklist and exact URLs above. Clearly distinguish SUPPORTS, OPPOSES, and NEUTRAL. Do not award positive support for merely confirming expected starters, a normal lineup, an ordinarily rested bullpen, no material injury, or normal weather.";
if (text.includes(structuredSharedFields)) {
  text = text.replace(structuredSharedFields, conciseSharedFields);
} else if (!text.includes(conciseSharedFields)) {
  throw new Error("AI shared-fields guidance not found for fixed checklist");
}

const oldPitcherKs =
  "Test the projection versus line, today's confirmed/projected opposing lineup K/contact tendencies, pitcher arsenal/whiff fit, recent 3-5 starts, innings/pitch count/leash, relevant history sample, and whether today's lineup differs from generic team rates. A negative adjustment or veto must cite actual adverse evidence, not missing data.";
const newPitcherKs =
  "For pitcher strikeouts, use the fixed RotoWire lineup source and Baseball Savant source above. Compare the EZPZ projection to the line, the actual opposing lineup's K/contact profile, the pitcher's whiff/arsenal context, and recent workload. Grade the matchup SUPPORTS, OPPOSES, or NEUTRAL; missing data is neutral and mere confirmation is not positive evidence.";
if (text.includes(oldPitcherKs)) {
  text = text.replace(oldPitcherKs, newPitcherKs);
} else if (!text.includes(newPitcherKs)) {
  throw new Error("Pitcher-K guidance not found for fixed checklist");
}

if (text !== original) {
  fs.writeFileSync(path, text, "utf8");
  console.log("Applied concise fixed-source MLB AI research checklist.");
} else {
  console.log("Concise fixed-source MLB AI research checklist already present.");
}
