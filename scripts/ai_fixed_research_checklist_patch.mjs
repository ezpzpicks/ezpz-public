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

1) STARTING PITCHING ADVANTAGE — Who is the better starting pitcher today, and does that pitching advantage SUPPORT, OPPOSE, or have a NEUTRAL effect on this pick?
SOURCE: https://www.rotowire.com/baseball/projected-starters.php
COMPARE: both scheduled/probable starters, their recent effectiveness and workload context from EZPZ, and any meaningful role difference or starter change. Decide which starter has the matchup advantage, then determine whether that advantage actually matters for this exact wager. If neither starter creates a meaningful edge for the pick, mark NEUTRAL.

2) LINEUP MATCHUP — How do today's confirmed/projected lineups match up against the opposing starting pitcher, and does that matchup SUPPORT, OPPOSE, or have a NEUTRAL effect on this pick?
SOURCE: https://www.rotowire.com/baseball/daily-lineups.php
COMPARE: the actual/projected hitters against the opposing starter using handedness, strikeout/contact profile, platoon strength, meaningful scratches/rest, and batting-order changes. Focus on which lineup has the more favorable matchup against the opposing pitcher and whether that matchup materially affects this exact wager. A normal or expected lineup without a meaningful matchup edge = NEUTRAL.

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
- Confirmed expected starter = NEUTRAL unless the actual starter comparison creates a meaningful pitching advantage for or against the pick. Expected lineup = NEUTRAL unless the actual lineup-to-pitcher matchup creates a meaningful edge. Rested bullpen with no special edge = NEUTRAL. No injury issue = NEUTRAL. Normal weather = NEUTRAL.
- Research adjustment must be 0 when the relevant evidence is neutral or balanced.
- A positive adjustment requires at least one verified, wager-specific SUPPORTS finding. One modest material support is usually +1; stronger support may be +2; multiple independent strong supports may justify +3. Reserve +4 to +6 for rare, truly major verified pregame changes.
- Negative adjustments follow the same scale for OPPOSES evidence. A critical conflict may justify approved=false.
- Do not turn missing information into negative evidence, and do not turn mere verification into positive evidence.

SUMMARY OUTPUT — NUMBERS FIRST
- researchSummary must be a compact list of the DIRECT COMPARATIVE ADVANTAGES for the exact wager. Show the actual numbers from the fixed sources whenever they are available, even when the difference is small or grades NEUTRAL.
- Never replace an available comparison with phrases such as "no advantage found," "no meaningful edge," "nothing notable," or "research did not corroborate." If the numbers exist, show them and name which side the numbers favor.
- Examples of the required style: "Starter edge: PHI — last 3 ER 1/2/1 vs NYM 4/3/2; night ERA 2.61 vs 3.48." "Bullpen: PHI high-leverage arms 28 pitches last 2 days vs NYM 61 — PHI rest edge." "Model: Under 8.5; EZPZ projection 7.7 — 0.8-run Under edge."
- A small edge may still be NEUTRAL for grading, but the summary must still report it: for example, "Night ERA 3.42 vs 3.66 — slight selected-side edge (NEUTRAL weight)."
- For last-3-start pitcher comparisons, list the exact runs/earned runs allowed by start rather than saying "better recent form."
- For day/night, home/away, ballpark, ERA/WHIP, K rate, pitch count, model projection, implied probability, or bullpen workload, include the exact values whenever the source provides them.
- Omit generic process commentary, threshold explanations, confirmations, and filler. Do not explain that a source was searched. Do not spend summary space saying normal lineup/no injuries/normal weather unless it directly creates a comparison advantage.
- If a requested number truly is unavailable, omit that comparison unless its absence materially affects the decision; do not substitute vague prose.
- WHY should contain at most the 1-2 strongest direct advantages/conflicts and should use the same exact numbers instead of generic narrative.

MISSING INFORMATION IS NEUTRAL, NOT NEGATIVE.`;

if (sourceBlockPattern.test(text)) {
  text = text.replace(sourceBlockPattern, fixedChecklist);
} else if (!text.includes("FIXED RESEARCH CHECKLIST — USE THESE EXACT SOURCES")) {
  throw new Error("Fixed AI research checklist insertion point not found");
}

const structuredSharedFields =
  "The shared fields must be concise but matchup-specific: startingPitching names both starters and any prop pitcher and notes confirmed/projected lineup context when material; bullpenAnalysis uses structured bullpen context first and supplements exact recent reliever usage when needed; recentTeamForm covers both teams using structured context first; historicalMatchup includes meaningful split/history sample context or says no meaningful sample exists. Never describe a concrete builderGameContext/modelGameContext fact as unverified simply because web search failed to reproduce it.";
const conciseSharedFields =
  "Keep the shared fields concise, numeric, and comparison-first. Use the fixed checklist and exact URLs above. Show the actual comparison values and name the side with the edge even when the difference is small. Clearly distinguish SUPPORTS, OPPOSES, and NEUTRAL for grading, but never hide an available numeric edge behind phrases like 'no advantage found.' Do not award positive support for merely confirming expected starters, a normal lineup, an ordinarily rested bullpen, no material injury, or normal weather.";
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
  console.log("Applied concise fixed-source MLB AI research checklist with numeric summaries.");
} else {
  console.log("Concise fixed-source MLB AI research checklist already present.");
}
