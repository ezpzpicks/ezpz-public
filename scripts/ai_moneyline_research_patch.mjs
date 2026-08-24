import fs from "node:fs";

const path = "app/api/public-data/route.ts";
let text = fs.readFileSync(path, "utf8");
const original = text;

if (!text.includes("MONEYLINE-SPECIFIC FIXED CHECKLIST")) {
  const gradingAnchor = "GRADING RULES";
  if (!text.includes(gradingAnchor)) {
    throw new Error("Moneyline checklist insertion point not found");
  }

  const moneylineBlock = String.raw`MONEYLINE-SPECIFIC FIXED CHECKLIST — APPLY ONLY TO FULL-GAME MONEYLINE CANDIDATES
For a moneyline, do not merely confirm the game context. Compare the two teams directly and determine which team has the stronger path to winning TODAY. Use the exact sources below and grade each section SUPPORTS, OPPOSES, or NEUTRAL for the selected moneyline side.

A) STARTING PITCHER COMPARISON — Which starting pitcher gives his team the better chance to win today, and does that pitching edge SUPPORT, OPPOSE, or have a NEUTRAL effect on the selected moneyline?
SOURCE 1 — probable starters + linked pitcher profiles: https://www.rotowire.com/baseball/projected-starters.php
SOURCE 2 — recent game results/box scores: https://www.espn.com/mlb/scoreboard
SOURCE 3 — official pitching splits: https://www.mlb.com/stats/pitching
SOURCE 4 — exact ballpark history: https://www.baseball-reference.com/
FOR BOTH STARTERS, COMPARE:
- Runs and earned runs allowed in EACH of the last 3 starts, plus innings and pitch count/workload when available.
- Current-season ERA and WHIP.
- Day-game or night-game ERA/WHIP matching today's scheduled start time.
- Home or road ERA/WHIP matching today's venue.
- History at today's exact ballpark: starts, innings and ERA/runs allowed when available.
- Meaningful history versus today's opponent/current lineup only when the sample is large enough to matter.
- Likely workload/leash and whether one starter is more likely to provide length.
WEIGHTING: Recent starts and current-season performance matter more than old career splits. Ballpark/opponent history with fewer than 3 starts or about 15 innings is SMALL SAMPLE and cannot drive the verdict. End this section by naming which starter has the meaningful edge today, or NEITHER if the comparison is essentially even.

B) LINEUP MATCHUP — Which team has the better lineup matchup against the opposing starting pitcher, and does that edge SUPPORT, OPPOSE, or have a NEUTRAL effect on the selected moneyline?
SOURCE: https://www.rotowire.com/baseball/daily-lineups.php
COMPARE: today's actual/projected hitters, starter handedness, platoon fit, strikeout/contact profile supplied by EZPZ, important scratches/rest, and batting-order changes. Compare BOTH lineups against the opposing starter. A merely confirmed/expected lineup is NEUTRAL; support requires an actual matchup advantage.

C) BULLPEN ADVANTAGE — Which team has the more usable bullpen today, and does that edge SUPPORT, OPPOSE, or have a NEUTRAL effect on the selected moneyline?
SOURCE: https://www.rotowire.com/baseball/bullpen-usage.php
COMPARE: both teams over the last five days, emphasizing closer/setup/high-leverage relievers, back-to-back appearances, recent pitch counts, likely availability, and whether one bullpen is materially more capable of protecting a lead or keeping the game close. A normally rested bullpen without a comparative edge is NEUTRAL.

D) INJURIES / ABSENCES — Is either team missing a player whose absence materially changes its chance to win today?
SOURCE: https://www.rotowire.com/baseball/news.php?injuries=all
COMPARE: only current injuries, scratches, activations or absences relevant to today's lineup, starting pitching, catcher, or high-leverage bullpen roles. Ignore injuries that do not materially affect the selected moneyline. No meaningful injury difference = NEUTRAL.

E) WEATHER / PARK — Do today's conditions materially favor either team or pitching profile enough to affect the moneyline?
SOURCE: https://www.rotowire.com/baseball/weather.php
COMPARE: wind, temperature, precipitation/delay risk, roof/dome status and park effects only when they create a team-specific or pitcher-specific advantage. Ordinary conditions = NEUTRAL.

F) EZPZ MODEL ALIGNMENT — Does the supplied EZPZ quantitative case agree with the selected moneyline?
SOURCE: supplied builderGameContext/modelGameContext only; do not re-research the model on the web.
COMPARE: the selected side's model direction, projected win probability/edge when available, and the market implied probability. If the EZPZ model materially favors the opponent or shows a negative edge for the selected moneyline, that is STRONG OPPOSES evidence and must be explicitly addressed. Trend strength or neutral qualitative research cannot erase a direct model conflict.

FINAL MONEYLINE JUDGMENT — Combine the sections in this order: starting-pitcher comparison, lineup matchup, bullpen advantage, injuries/absences, weather/park, then EZPZ model alignment. The selected moneyline should receive positive research support only when the comparative evidence creates a real advantage for that team. Do not award positive support merely because the starter is confirmed, the lineup is normal, the bullpen is rested, there are no injuries, or weather is ordinary. If the major advantages split between the teams or are weak, mark the research NEUTRAL instead of forcing approval.

`;

  text = text.replace(gradingAnchor, moneylineBlock + gradingAnchor);
}

const gradingAnchor = "- Research adjustment must be 0 when the relevant evidence is neutral or balanced.";
const moneylineGrading =
  "- For moneylines, explicitly compare BOTH starters using last-3 run allowance, season ERA/WHIP, matching day/night split, matching home/away split, and exact-ballpark history when available; then compare today's lineups and bullpen availability. Small-sample venue/opponent history is context only. A direct EZPZ model conflict with the selected moneyline is STRONG OPPOSES evidence and cannot be omitted from the verdict.\n" + gradingAnchor;
if (!text.includes("For moneylines, explicitly compare BOTH starters using last-3 run allowance")) {
  if (!text.includes(gradingAnchor)) throw new Error("Moneyline grading insertion point not found");
  text = text.replace(gradingAnchor, moneylineGrading);
}

if (text !== original) {
  fs.writeFileSync(path, text, "utf8");
  console.log("Applied fixed-source moneyline AI research checklist.");
} else {
  console.log("Fixed-source moneyline AI research checklist already present.");
}
