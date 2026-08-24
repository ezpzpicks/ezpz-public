import fs from "node:fs";

const path = "app/api/public-data/route.ts";
let text = fs.readFileSync(path, "utf8");
const original = text;

// Totals need a deeper contextual pitching review than the shared ML/prop checklist.
// Allow one additional targeted lookup for the totals-only split/history work.
text = text.replace(
  "Math.min(7, Math.floor(Number(process.env.EZPZ_AI_MAX_WEB_SEARCH_CALLS || 6) || 6)),",
  "Math.min(8, Math.floor(Number(process.env.EZPZ_AI_MAX_WEB_SEARCH_CALLS || 7) || 7)),",
);

if (!text.includes("3) GAME TOTAL — STARTER RUN PREVENTION")) {
  const bullpenHeading =
    "3) BULLPEN USAGE — Has either bullpen been heavily used recently, are important relievers on back-to-back/heavy workloads, or is there a meaningful rest advantage that changes this wager?";

  const totalsBlock = String.raw`3) GAME TOTAL — STARTER RUN PREVENTION — APPLY ONLY TO FULL-GAME OVER/UNDER CANDIDATES. Does the actual run-prevention profile of BOTH starting pitchers support or oppose this total?
QUESTION FOR AN UNDER: Have both starters shown enough recent and contextual run prevention to make a low-scoring game more likely?
QUESTION FOR AN OVER: Has one or both starters shown enough recent or contextual run-prevention weakness to make a high-scoring game more likely?

SOURCE A — probable starters + linked pitcher profiles: https://www.rotowire.com/baseball/projected-starters.php
USE: confirm both starters, then use the linked RotoWire pitcher profiles for season ERA/WHIP, recent game logs, home/away splits, handedness splits and workload context when available.

SOURCE B — recent game results/box scores: https://www.espn.com/mlb/scoreboard
USE: verify each starter's LAST 3 STARTS. Record innings pitched, total runs allowed, earned runs allowed, hits, walks, home runs and pitch count when available. State the runs/earned runs allowed in each of the three starts rather than using vague labels such as "good recent form" or "struggling."

SOURCE C — day/night and other official pitching splits: https://www.mlb.com/stats/pitching
USE: select the split that matches today's game. If this is a night game, compare each starter's Night Games ERA/WHIP; if it is a day game, use Day Games. Also use Home/Away when relevant. Compare the split to the pitcher's overall season ERA so the AI can identify a real contextual difference instead of merely repeating the season number.

SOURCE D — exact ballpark history: https://www.baseball-reference.com/
USE: search the exact starting pitcher, open the pitcher's Pitching Splits, and check Ballparks/Game-Level for the stadium hosting today's game. Report starts, innings and ERA/runs allowed at THIS specific ballpark when available. If the sample is fewer than 3 starts or roughly 15 innings, label it SMALL SAMPLE and do not give it strong weight.

TOTALS STARTER COMPARISON — FOR EACH STARTER REPORT/COMPARE:
- Runs and earned runs allowed in EACH of the last 3 starts, plus innings/workload.
- Current-season ERA and WHIP.
- Day-game or night-game ERA/WHIP matching today's scheduled start time.
- Home or road ERA/WHIP matching today's venue.
- Specific history at today's ballpark, with sample size.
- Meaningful history versus today's opponent/current lineup only when the sample is large enough to matter.
- Whether these factors collectively SUPPORT, OPPOSE, or are NEUTRAL for the exact Over/Under side.

UNDER INTERPRETATION — Favor SUPPORT only when the combined starter evidence points toward run suppression. Strong Under support usually requires both starters to be reasonably trustworthy, or one elite run-prevention starter plus no major vulnerability from the other starter. A starter allowing elevated runs recently, carrying an adverse day/night or venue split, or showing a meaningful matchup weakness is OPPOSES evidence for the Under.

OVER INTERPRETATION — Apply the same exact evidence in the opposite direction. Favor SUPPORT when one or both starters show meaningful scoring vulnerability: elevated runs allowed across the last 3 starts, poor season ERA/WHIP, adverse day/night or home/road split, poor history at today's ballpark with a meaningful sample, or a lineup matchup that is especially favorable for the offense. One clearly vulnerable starter can materially support an Over even if the other starter is solid. Conversely, two strong recent run-prevention profiles with favorable contextual splits are OPPOSES evidence for the Over.

TOTALS MODEL ALIGNMENT — Before approving the research case, compare the EZPZ model total projection with the betting line. For an UNDER, a model projection materially ABOVE the line is opposing evidence; for an OVER, a model projection materially BELOW the line is opposing evidence. A disagreement of 0.5 runs or more is STRONG OPPOSES evidence and must be explicitly addressed rather than ignored.

WEIGHTING — Recent starts and current-season performance matter more than old career splits. Day/night, home/away and ballpark history are supporting context, not automatic reasons to approve. One tiny historical sample must never outweigh three recent starts or the current EZPZ projection.

FINAL TOTALS JUDGMENT — Combine BOTH starting pitchers first, then the lineup matchup, bullpen usage and weather/park questions below. For an UNDER, strong support means both starters are reasonably aligned with run prevention and there is no major opposing factor. For an OVER, strong support can come from one clearly vulnerable starter or multiple scoring-positive factors. If the evidence is mixed, mark NEUTRAL rather than forcing support.`;

  if (!text.includes(bullpenHeading)) {
    throw new Error("Bullpen checklist heading not found for totals insertion");
  }
  text = text.replace(bullpenHeading, `${totalsBlock}\n\n4) BULLPEN USAGE — Has either bullpen been heavily used recently, are important relievers on back-to-back/heavy workloads, or is there a meaningful rest advantage that changes this wager?`);

  text = text.replace(
    "4) RECENT FORM / WORKLOAD — Do the starters' last 3-5 outings or the teams' recent results show a material change that the EZPZ baseline may not fully capture?",
    "5) RECENT FORM / WORKLOAD — Do the starters' last 3-5 outings or the teams' recent results show a material change that the EZPZ baseline may not fully capture?",
  );
  text = text.replace(
    "5) INJURIES / ABSENCES — Is there a current injury, scratch, activation, or absence that materially changes this wager?",
    "6) INJURIES / ABSENCES — Is there a current injury, scratch, activation, or absence that materially changes this wager?",
  );
  text = text.replace(
    "6) PITCHER STRIKEOUT MATCHUP — APPLY ONLY TO PITCHER-K CANDIDATES.",
    "7) PITCHER STRIKEOUT MATCHUP — APPLY ONLY TO PITCHER-K CANDIDATES.",
  );
  text = text.replace(
    "7) WEATHER / PARK — APPLY ONLY WHEN MATERIAL.",
    "8) WEATHER / PARK — APPLY ONLY WHEN MATERIAL.",
  );
}

const gradingAnchor =
  "- Research adjustment must be 0 when the relevant evidence is neutral or balanced.";
const totalsGrading =
  "- For full-game totals, explicitly include both starters' last-3-start run allowance, season ERA/WHIP, matching day/night split, matching home/away split, and exact-ballpark history when available. Small-sample venue history is context only. Apply these same inputs symmetrically: run-prevention strength SUPPORTS an Under and OPPOSES an Over; run-prevention weakness OPPOSES an Under and SUPPORTS an Over. One clearly vulnerable starter may materially support an Over. A 0.5+ run conflict between the EZPZ projection and the selected total side is STRONG OPPOSES evidence and cannot be omitted from the verdict.\n" + gradingAnchor;
if (!text.includes("For full-game totals, explicitly include both starters' last-3-start run allowance")) {
  if (!text.includes(gradingAnchor)) throw new Error("Totals grading insertion point not found");
  text = text.replace(gradingAnchor, totalsGrading);
}

if (text !== original) {
  fs.writeFileSync(path, text, "utf8");
  console.log("Applied totals-specific starter run-prevention AI research checklist.");
} else {
  console.log("Totals-specific AI research checklist already present.");
}
