import fs from "node:fs";

const path = "app/api/public-data/route.ts";
let text = fs.readFileSync(path, "utf8");
const original = text;

// The shared research patch intentionally reuses facts across markets, but pitcher-K
// and first-inning cards were still spending too many calls on low-value shared
// lookups before getting to actual recent K history. Re-prioritize the research plan
// by market and add deterministic fallbacks for recent/opponent/venue history.

const starterBundlePattern =
  /SHARED STARTER BUNDLE — ONE SET OF LOOKUPS PER GAME,[\s\S]*?\n\nSHARED LINEUP BUNDLE — ONE LOOKUP PER GAME,/;

const marketAwareStarterBundle = String.raw`MARKET-AWARE STARTER BUNDLE — RESEARCH THE FACTS THAT MATTER TO THE CANDIDATES FIRST:
Build the starter plan from the markets actually present in this game. Do NOT automatically spend four starter-source calls on every game.
- If MONEYLINE or TOTAL candidates exist, compare both starters using the supplied EZPZ context first, then fill only meaningful gaps. RotoWire probable starters, ESPN/official recent game logs, MLB split pages, and Baseball-Reference history are available sources, but do not fetch a field that EZPZ already supplies clearly.
- If the game contains only PITCHER STRIKEOUTS and/or FIRST INNING candidates, do NOT spend calls on generic MLB Day/Night splits, bullpen tables, broad injury pages, or full-game starter comparisons unless they directly affect workload/leash or the first inning. Prioritize the prop pitcher's exact recent starts, opponent/venue history, today's opposing lineup, and K/contact matchup.
- For a pitcher-K candidate, the recent-start history workflow below has priority over generic starter research. Do not use ESPN scoreboard as the only attempt for historical data.
- Reuse any starter facts already retrieved for another candidate in this game.

SHARED LINEUP BUNDLE — ONE LOOKUP PER GAME,`;

if (starterBundlePattern.test(text)) {
  text = text.replace(starterBundlePattern, marketAwareStarterBundle);
} else if (!text.includes("MARKET-AWARE STARTER BUNDLE — RESEARCH THE FACTS THAT MATTER TO THE CANDIDATES FIRST")) {
  throw new Error("Starter research bundle anchor not found for pitcher-K history patch");
}

const pitcherKExtraPattern =
  /PITCHER-K-ONLY EXTRA — use only when at least one Pitcher Strikeouts candidate exists:[\s\S]*?\n\nFIRST-INNING-ONLY EXTRA —/;

const pitcherKHistoryBlock = String.raw`PITCHER-K HISTORY WORKFLOW — REQUIRED WHEN AT LEAST ONE PITCHER STRIKEOUTS CANDIDATE EXISTS:
The goal is to leave the user with real numeric history, not a generic "history unavailable" note. These are explicitly approved additional sources for pitcher-K history and override any generic instruction that limits research to the earlier fixed-source list.

PRIORITY 1 — EXACT RECENT STARTS:
- First use exact recent-start rows already present in EZPZ structured context when they contain the needed numbers.
- Otherwise use the pitcher's Baseball-Reference game log/player page as the primary historical source. If Baseball-Reference is not cleanly retrievable, immediately fall back to StatMuse with a targeted pitcher game-log query. ESPN/official box scores are additional fallback sources, not the only historical attempt.
- Capture the last 5 starts before today's game whenever available: date, opponent, innings pitched, pitch count when available, and strikeouts.
- Calculate and report: strikeouts in each of the last 5 starts, average strikeouts, average pitch count when available, and the exact Over/Under record versus TODAY'S listed prop line. Example format: "Last 5 K: 3, 2, 3, 2, 6 — Under 4.5 in 4/5; 3.2 K/start; 74.6 pitches/start."
- A recent-start series is decision-relevant even when opponent-specific history is small or unavailable. Do not replace it with a sentence saying no history was found.

PRIORITY 2 — OPPONENT + VENUE HISTORY:
- Retrieve the pitcher's most recent starts against today's opponent, preferably the last 3-5 meetings when they exist. Baseball-Reference and StatMuse are approved. Report date, venue, IP and K for each usable start and summarize the Over/Under record versus today's prop line.
- When useful, identify starts at today's exact ballpark and state the sample size. Do not imply that a 1-2 start venue sample is predictive; label it small-sample context.
- If the primary history source fails, attempt the approved fallback before saying the data is unavailable. "Not available" is acceptable only after a targeted fallback attempt or when no prior matchup actually exists.

PRIORITY 3 — TODAY'S ACTUAL LINEUP + K/CONTACT FIT:
- Use the shared RotoWire daily lineup once. Then use Baseball Savant only for incremental pitcher whiff/K/pitch-mix/velocity and actual-hitter contact/K information that is not already supplied by EZPZ.
- Do not waste Savant calls re-fetching recent starts, pitch counts, lineups, injuries, bullpen, weather, or season ERA/WHIP.
- If hitter-level data cannot be retrieved, keep that component NEUTRAL. Do not let missing hitter-level data erase the real recent-start history gathered above.

PITCHER-K CALL PRIORITY / SKIP RULES:
- For a K candidate, exact recent starts and the Over/Under record versus today's line outrank bullpen, generic injuries, generic weather, generic team form, and broad season split lookups.
- Skip bullpen web research for pitcher-K unless there is a specific workload/leash reason it could cause an earlier hook. If the card schema requires a bullpen field, use supplied structured context or say it was not decision-relevant; do not spend a search merely to fill the field.
- Skip broad injury research once today's confirmed opposing lineup resolves the hitters who matter, unless a late scratch/activation is genuinely unresolved.
- Skip weather entirely for a confirmed indoor/domed game. For ordinary outdoor weather, search only if conditions could materially affect pitcher grip, delay risk, or workload.
- Stay inside the existing web-call ceiling by dropping low-value lookups before dropping recent K history. Do not raise the search count simply to fill every generic shared field.

HISTORICAL OUTPUT REQUIREMENTS FOR PITCHER-K CARDS:
- Historical Matchup Notes must include the recent-start numeric summary whenever those starts exist.
- Also include opponent/venue history when a real sample exists, with sample size and direction versus today's line.
- Distinguish RECENT FORM from OPPONENT HISTORY so the user can see what is broadly current versus matchup-specific.
- Never write "no historical factor was weighted" when recent starts were successfully retrieved; recent starts are historical evidence even if head-to-head history is absent.
- Verify baseball innings notation exactly. In box-score notation, 5.1 IP means five innings plus one out and 5.2 IP means five innings plus two outs. Never silently convert 5.1 to 5.2 or vice versa.
- When two sources disagree on an exact box-score value, prefer an official/box-score game log and note the conflict rather than inventing a blended value.

FIRST-INNING-ONLY EXTRA —`;

if (pitcherKExtraPattern.test(text)) {
  text = text.replace(pitcherKExtraPattern, pitcherKHistoryBlock);
} else if (!text.includes("PITCHER-K HISTORY WORKFLOW — REQUIRED WHEN AT LEAST ONE PITCHER STRIKEOUTS CANDIDATE EXISTS")) {
  throw new Error("Pitcher-K extra anchor not found for history patch");
}

// Make first-inning-only reviews avoid consuming the same low-value calls that were
// crowding out useful starter history. This keeps NRFI/YRFI focused on the top of the
// order, starter first-inning context, and only material conditions.
const oldFirstInning =
  "FIRST-INNING-ONLY EXTRA — use only when the existing structured first-inning signal and shared starter/lineup/weather facts leave a material unresolved first-inning question. Do not broadly re-search full-game starter, lineup or weather facts that are already in the shared bundles.";
const newFirstInning =
  "FIRST-INNING-ONLY EXTRA — use only when the existing structured first-inning signal plus the shared starter/lineup facts leave a material unresolved first-inning question. For NRFI/YRFI-only reviews, prioritize the two starters' current first-inning/recent-start context and the top of each confirmed batting order. Do not spend web calls on bullpen usage because relievers do not normally affect the first inning. Skip broad injury research once the confirmed lineups resolve availability, and skip weather for a confirmed dome/indoor game. Do not broadly re-search full-game facts already supplied by EZPZ.";
if (text.includes(oldFirstInning)) {
  text = text.replace(oldFirstInning, newFirstInning);
}

// Reinforce the fallback rule near the global search-efficiency instructions.
const efficiencyAnchor =
  '- Keep the existing maximum search-call allowance as a ceiling for difficult games, not a target. Use fewer calls whenever the unique source plan can answer the game completely.';
const efficiencyReplacement =
  '- Keep the existing maximum search-call allowance as a ceiling for difficult games, not a target. Use fewer calls whenever the unique source plan can answer the game completely. For pitcher-K candidates, never sacrifice the required last-five-start history to fill lower-value bullpen/injury/weather/shared fields; use Baseball-Reference with StatMuse as the targeted fallback before declaring history unavailable.';
if (text.includes(efficiencyAnchor)) {
  text = text.replace(efficiencyAnchor, efficiencyReplacement);
}

if (text !== original) {
  fs.writeFileSync(path, text, "utf8");
  console.log("Applied pitcher-K historical research priority and fallback workflow.");
} else {
  console.log("Pitcher-K historical research priority and fallback workflow already present.");
}
