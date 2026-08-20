import fs from "node:fs";

const path = "app/api/public-data/route.ts";
let text = fs.readFileSync(path, "utf8");
const original = text;

function replaceOne(oldValue, newValue, label) {
  const count = text.split(oldValue).length - 1;
  if (count === 1) {
    text = text.replace(oldValue, newValue);
    return;
  }
  if (text.includes(newValue)) return;
  throw new Error(`${label} target not found exactly once (found ${count})`);
}

// This patch runs after hot_pending_ai_patch.mjs. Preserve that patch's newer
// Strong/Elite/HOT admission logic while advancing only the research layer.
const selectorVersion =
  'const AI_PICK_SELECTOR_VERSION = "hybrid-web-context-v23-research-source-hierarchy";';
const versionPattern =
  /const AI_PICK_SELECTOR_VERSION = "hybrid-web-context-v(?:19-trend-review-calibration|20-hot-pending-review|21-priority-ai-review|22-balanced-final-review|23-research-source-hierarchy)";/;
if (versionPattern.test(text)) {
  text = text.replace(versionPattern, selectorVersion);
} else if (!text.includes(selectorVersion)) {
  throw new Error("AI selector version target not found");
}

const oldSearchConfig = `  const configuredSearchContextSize = String(
    process.env.EZPZ_AI_SEARCH_CONTEXT_SIZE || "low",
  ).trim();
  const searchContextSize: "low" | "medium" | "high" = ["low", "medium", "high"].includes(
    configuredSearchContextSize,
  )
    ? (configuredSearchContextSize as "low" | "medium" | "high")
    : "low";`;

const newSearchConfig = `  const configuredSearchContextSize = String(
    process.env.EZPZ_AI_SEARCH_CONTEXT_SIZE || "medium",
  ).trim();
  const searchContextSize: "low" | "medium" | "high" = ["low", "medium", "high"].includes(
    configuredSearchContextSize,
  )
    ? (configuredSearchContextSize as "low" | "medium" | "high")
    : "medium";
  const configuredResearchSearchesRaw = Number(
    process.env.EZPZ_AI_MAX_RESEARCH_SEARCHES || 2,
  );
  const maxResearchSearches = Number.isFinite(configuredResearchSearchesRaw)
    ? Math.max(1, Math.min(4, Math.floor(configuredResearchSearchesRaw)))
    : 2;`;
replaceOne(oldSearchConfig, newSearchConfig, "AI research search configuration");

if (/prompt_cache_key: "ezpz-ai-game-v(?:13|14)"/.test(text)) {
  text = text.replace(
    /prompt_cache_key: "ezpz-ai-game-v(?:13|14)"/,
    'prompt_cache_key: "ezpz-ai-game-v23"',
  );
} else if (!text.includes('prompt_cache_key: "ezpz-ai-game-v23"')) {
  throw new Error("AI research prompt cache key target not found");
}

replaceOne(
  "      max_tool_calls: 1,",
  "      max_tool_calls: maxResearchSearches,",
  "AI research web-search budget",
);

const oldPromptOpening = `              text: \`You are the final pregame MLB research analyst for EZPZ AI Picks. Use one web search to research this one game, then evaluate every supplied candidate using the same verified pregame facts. Never use information from after first pitch and do not invent statistics.

Use modelGameContext as the primary quantitative source. Verify only decision-relevant details: probable/confirmed starters, projected lineups, recent 3-5-start form, workload/leash, bullpen availability, meaningful matchup or split evidence, and weather/park only if material. State plainly when a split or history sample is unavailable or too small.

The shared fields must be concise but matchup-specific:`;

const newPromptOpening = `              text: \`You are the final pregame MLB research analyst for EZPZ AI Picks. Research this one game with targeted web searches, then evaluate every supplied candidate using the same verified pregame facts. Never use information from after first pitch and do not invent statistics.

Use modelGameContext as the primary quantitative source. Verify only decision-relevant details: probable/confirmed starters, projected or confirmed lineups, recent 3-5-start form, workload/leash, bullpen availability, meaningful matchup or split evidence, injuries/scratches, and weather/park only if material.

SEARCH PLAN AND PREFERRED SOURCES:
1. Starting pitchers and lineups — search MLB.com first for official probable pitchers, Gameday, and confirmed lineups. If a confirmed lineup is not yet posted there, use RotoWire Daily Lineups for confirmed/projected lineups and pitching matchups.
2. Bullpen availability/workload — use ESPN's previous-game box score to identify relievers used and their workload; MLB Gameday/box scores are the preferred backup. Check the prior one to three games only when needed to determine availability.
3. Starting-pitcher recent form — use MLB or ESPN game logs for the most recent three to five starts.
4. Pitcher strikeout, arsenal, whiff, and pitch-type matchup research — prefer Baseball Savant; use FanGraphs only when Savant does not provide the needed split/context.
5. Recent team form — use MLB or ESPN schedules/results and game logs. Focus on facts relevant to the current wager rather than generic record recaps.
6. Injuries, scratches, and expected absences — use official MLB/team injury information first; RotoWire or ESPN are acceptable backups.
7. Batter/pitcher splits and matchup context — prefer Baseball Savant, then FanGraphs. Do not overstate tiny BvP samples.
8. Weather/park — research only when it can materially affect the wager.

Use at least two targeted searches when needed: one should prioritize MLB/RotoWire for starters and lineups, while another should prioritize ESPN/MLB for bullpen usage and recent-game context. If a pitcher prop requires arsenal/whiff evidence, include Baseball Savant in the search plan. Do not spend searches on generic summaries when a source-specific query can answer the required fact.

RESEARCH EVIDENCE RULE: Failure to locate a fact is not evidence against a wager. Missing, unavailable, unconfirmed, or too-small information must be treated as neutral and must not lower adjustment, probability, or approval. Use adjustment=0 when research simply fails to add decision-relevant evidence. A negative adjustment or approved=false requires concrete verified adverse evidence such as a confirmed unfavorable lineup change, starter change/limitation, heavily taxed key relievers, material injury/scratch, relevant unfavorable matchup/split, or material weather condition. Never use "research failed to corroborate", "no supporting information found", "could not verify a surge", or similar absence-of-evidence wording as the reason for a negative adjustment or veto. State plainly when a split or history sample is unavailable or too small, but keep that item neutral.

The shared fields must be concise but matchup-specific:`;
replaceOne(oldPromptOpening, newPromptOpening, "AI research source hierarchy prompt");

// hot_pending_ai_patch.mjs intentionally made neutral research a qualitative
// veto for borderline plays. The research layer should instead report what it
// actually found and leave numeric thresholds to the selector.
const balancedApprovalGuidance =
  "approved=true means the matchup research gives enough qualitative support to publish the wager; it must not mean merely that no catastrophic veto was found. Never set approved=false solely because aiScoreBeforeResearch is below a downstream selector threshold, because the selector applies that numeric gate after research. However, for a borderline candidate near its required score/probability/advantage thresholds, neutral or ambiguous research is not sufficient for approved=true. Borderline plays should be approved only when the verified matchup context positively supports or meaningfully validates the wager. A clearly strong quantitative candidate can remain approved when research is neutral and no material contradiction is found.";
const neutralApprovalGuidance =
  "approved=true means the matchup research found no concrete material reason to veto the wager. Never set approved=false solely because aiScoreBeforeResearch is below a downstream selector threshold, because the selector applies that numeric gate after research. Neutral, unavailable, incomplete, or non-corroborating research is not negative evidence and must not by itself make approved=false, even for a borderline candidate. When research is neutral, use adjustment=0 and let the selector's score/probability/advantage requirements decide publication. Use approved=false only when verified matchup evidence materially weakens or contradicts the wager.";
if (text.includes(balancedApprovalGuidance)) {
  text = text.replace(balancedApprovalGuidance, neutralApprovalGuidance);
} else if (!text.includes(neutralApprovalGuidance)) {
  throw new Error("AI reviewer approval guidance target not found");
}

const balancedTrendGuidance =
  "Do not reject a trend-only candidate solely because aiScoreBeforeResearch is below 80; the selector applies the final adjusted 80+ gate after research. But neutral research is no longer automatic approval. For trend-only candidates that are borderline—especially an AI score within 3 points of 80, modest advantage, or a case driven mainly by the trend signal—approved=true requires verified matchup evidence that positively corroborates the wager. If the research is neutral, mixed, or fails to add meaningful matchup support to a borderline case, approved=false is appropriate even without one catastrophic conflict. For a clearly strong trend-only quantitative case comfortably above the threshold, neutral research may remain approved when no material contradiction is found. Concrete unfavorable starter, lineup, bullpen, weather, split, or matchup evidence should still produce approved=false. The AI is the qualitative filter; the selector remains the final numeric gatekeeper.";
const neutralTrendGuidance =
  "Do not reject a trend-only candidate solely because aiScoreBeforeResearch is below 80; the selector applies the final adjusted 80+ gate after research. First evaluate the actual matchup and assign only an evidence-based research adjustment. If research is neutral, unavailable, mixed without a clear adverse conclusion, or simply fails to add extra corroboration, use adjustment=0 and approved=true unless concrete verified matchup evidence materially weakens the play. Lack of extra support is not a veto. The selector, not the reviewer, applies the final 80+ score gate after the adjustment. Concrete unfavorable starter, lineup, bullpen, weather, split, or matchup evidence can still produce approved=false. The AI is the qualitative matchup filter; the selector remains the final numeric gatekeeper.";
if (text.includes(balancedTrendGuidance)) {
  text = text.replace(balancedTrendGuidance, neutralTrendGuidance);
} else if (!text.includes(neutralTrendGuidance)) {
  throw new Error("Trend-only neutral research guidance target not found");
}

if (text !== original) {
  fs.writeFileSync(path, text, "utf8");
  console.log("Applied targeted MLB research sources and neutral-evidence rules.");
} else {
  console.log("Targeted MLB research source patch already applied.");
}
