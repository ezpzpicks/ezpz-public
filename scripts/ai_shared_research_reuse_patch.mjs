import fs from "node:fs";

const path = "app/api/public-data/route.ts";
let text = fs.readFileSync(path, "utf8");
const original = text;

// Upgrade the legacy/default selector model to GPT-5.6 Terra while preserving
// the environment variable as a future override. If production still carries
// the old explicit gpt-5-mini override, treat that as legacy and upgrade it too.
const legacyModelLine = '  const model = String(process.env.EZPZ_AI_SELECTOR_MODEL || "gpt-5-mini").trim();';
const terraModelBlock = `  const configuredAiSelectorModel = String(process.env.EZPZ_AI_SELECTOR_MODEL || "").trim();\n  const model = (!configuredAiSelectorModel || configuredAiSelectorModel === "gpt-5-mini")\n    ? "gpt-5.6-terra"\n    : configuredAiSelectorModel;`;
if (text.includes(legacyModelLine)) {
  text = text.replace(legacyModelLine, terraModelBlock);
} else if (!text.includes('"gpt-5.6-terra"')) {
  throw new Error("AI selector model configuration not found for Terra upgrade");
}

if (!text.includes("GAME-LEVEL RESEARCH REUSE — RESEARCH ONCE, APPLY TO EVERY CANDIDATE")) {
  const insertionAnchor = "MONEYLINE-SPECIFIC FIXED CHECKLIST — APPLY ONLY TO FULL-GAME MONEYLINE CANDIDATES";
  const fallbackAnchor = "GRADING RULES";
  const anchor = text.includes(insertionAnchor) ? insertionAnchor : fallbackAnchor;
  if (!text.includes(anchor)) throw new Error("Shared research reuse insertion point not found");

  const reuseBlock = String.raw`GAME-LEVEL RESEARCH REUSE — RESEARCH ONCE, APPLY TO EVERY CANDIDATE
The candidates supplied in this request belong to the SAME GAME. Before using web search, inspect all candidate markets for this game and build ONE unique research plan. Never repeat the same factual/source lookup because the same game has a Moneyline, Total, Pitcher-K, First-Inning candidate, multiple candidate sides, or multiple candidate reviews. Once a fact is retrieved for this game, reuse that exact fact in every applicable candidate review. The factual research is market-neutral; only the interpretation changes by wager type.

SHARED STARTER BUNDLE — ONE SET OF LOOKUPS PER GAME, reused by MONEYLINE + TOTAL and any relevant K/first-inning context:
1. https://www.rotowire.com/baseball/projected-starters.php — both starters, linked pitcher profiles, season ERA/WHIP and workload context when available.
2. https://www.espn.com/mlb/scoreboard — BOTH starters' exact last 3 starts: IP, runs/ER, hits, walks, HR, pitch count and Ks when available.
3. https://www.mlb.com/stats/pitching — matching Day/Night and Home/Away ERA/WHIP for BOTH starters.
4. https://www.baseball-reference.com/ — exact-ballpark history and meaningful opponent history for BOTH starters, with sample size.
Do not run this starter bundle once for a Total and again for a Moneyline. It is ONE factual comparison. For a MONEYLINE, interpret it as which starter gives his team the better chance to win. For a TOTAL, interpret the same numbers as run-prevention strength/vulnerability. For a pitcher-K candidate, reuse the starter's recent IP/pitch-count/K workload from this bundle instead of looking it up again.

SHARED LINEUP BUNDLE — ONE LOOKUP PER GAME, reused by MONEYLINE + TOTAL + PITCHER K + FIRST INNING:
https://www.rotowire.com/baseball/daily-lineups.php
Retrieve both actual/projected lineups once. Reuse the same hitters, handedness, scratches/rest and batting-order information everywhere. For MONEYLINE, compare which lineup has the better matchup against the opposing starter. For TOTAL, judge whether the two lineups increase or suppress scoring. For PITCHER K, use the exact opposing lineup for K/contact matchup. For FIRST INNING, focus the same lineup data on the top of each batting order. Never re-fetch the lineup simply because the wager type changes.

SHARED BULLPEN BUNDLE — ONE LOOKUP PER GAME, reused by MONEYLINE + TOTAL:
https://www.rotowire.com/baseball/bullpen-usage.php
Retrieve both teams' last-five-day usage, high-leverage workload and likely availability once. For MONEYLINE, interpret it as the ability to protect/hold a lead. For TOTAL, interpret the same workload as late-inning run suppression/vulnerability. Do not perform a second bullpen lookup for another candidate in this game.

SHARED INJURY BUNDLE — AT MOST ONE LOOKUP PER GAME when relevant, reused by all markets:
https://www.rotowire.com/baseball/news.php?injuries=all
Only retrieve current injuries/scratches/activations that can affect today's actual game. Reuse the result across every candidate. If the supplied confirmed lineup already resolves an absence and there is no material unresolved injury question, do not spend another search merely to confirm that nothing changed.

SHARED WEATHER/PARK BUNDLE — AT MOST ONE LOOKUP PER GAME when material, reused by MONEYLINE + TOTAL + FIRST INNING and pitcher K when conditions affect workload:
https://www.rotowire.com/baseball/weather.php
Retrieve conditions once. An indoor/domed game or ordinary non-material weather does not require repeated lookup or commentary.

PITCHER-K-ONLY EXTRA — use only when at least one Pitcher Strikeouts candidate exists:
https://baseballsavant.mlb.com/statcast_search
Use Baseball Savant for pitcher whiff/K/pitch-mix/velocity and actual-lineup contact/K fit not already supplied by EZPZ. If the same game has more than one K candidate, combine the relevant pitchers/hitters into as few Savant lookups as practical. Do not use Savant to re-fetch recent starts, pitch counts, lineups, injuries, bullpen or weather already gathered above.

FIRST-INNING-ONLY EXTRA — use only when the existing structured first-inning signal and shared starter/lineup/weather facts leave a material unresolved first-inning question. Do not broadly re-search full-game starter, lineup or weather facts that are already in the shared bundles.

SEARCH-EFFICIENCY RULES:
- Research the GAME, not each bet. One source result can and should support multiple candidate reviews.
- Before every web call, ask: "Do I already have this exact fact from the supplied EZPZ context or an earlier lookup in this same game review?" If yes, reuse it and do not search again.
- Never search the same exact URL/source twice for the same game unless the first result was genuinely unusable or contradictory.
- Never re-research the EZPZ model score, projection, trend score, betting line or implied probability on the web; those are supplied structured facts.
- Opposite interpretations do not require opposite searches. Example: the same 5.20 night ERA can OPPOSE an Under, SUPPORT an Over, and weaken that pitcher's team's Moneyline without another lookup.
- If Moneyline + Total candidates coexist, the four-source starter bundle must be gathered only once and then interpreted for both markets.
- If Moneyline/Total + Pitcher-K coexist, reuse the same daily lineup and recent-start/workload data; Savant is the principal incremental K-specific source.
- Keep the existing maximum search-call allowance as a ceiling for difficult games, not a target. Use fewer calls whenever the unique source plan can answer the game completely.

`;

  text = text.replace(anchor, reuseBlock + anchor);
}

// Reinforce reuse in the concise shared-field instruction so the final output
// cannot imply that each candidate was researched independently.
const sharedFieldAnchor =
  "Keep the shared fields concise, numeric, and comparison-first. Use the fixed checklist and exact URLs above.";
const sharedFieldReplacement =
  "Keep the shared fields concise, numeric, and comparison-first. Research each unique source/fact once per game, reuse it across every applicable candidate in this request, then interpret the same facts by wager type. Use the fixed checklist and exact URLs above.";
if (text.includes(sharedFieldAnchor)) {
  text = text.replace(sharedFieldAnchor, sharedFieldReplacement);
}

if (text !== original) {
  fs.writeFileSync(path, text, "utf8");
  console.log("Applied game-level AI research reuse and GPT-5.6 Terra upgrade.");
} else {
  console.log("Game-level AI research reuse and GPT-5.6 Terra upgrade already present.");
}
