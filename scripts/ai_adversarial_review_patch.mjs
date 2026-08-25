import fs from "node:fs";

const path = "app/api/public-data/route.ts";
let text = fs.readFileSync(path, "utf8");
const original = text;

// Bump the selector contract so in-memory research caches cannot reuse reviews
// produced under the softer qualitative standard.
text = text.replace(
  /const AI_PICK_SELECTOR_VERSION = "[^"]+";/,
  'const AI_PICK_SELECTOR_VERSION = "hybrid-web-context-v20-adversarial-review";',
);

const strictMarker = "STRICT QUALITATIVE REVIEW — MODEL DOES NOT OVERRIDE CONTRADICTIONS";
const strictBlock = String.raw`${strictMarker}
The model, trend score, and quantitative qualification gates are the candidate-generation layer. They are already priced into the supplied baseline and MUST NOT be used as a reason to dismiss contradictory research. Your final-review job is adversarial: actively try to disprove each wager. A sentence such as "the model edge outweighs recent form" is not a valid approval rationale by itself.

Treat evidence by direction and strength:
- NEUTRAL evidence does not help or hurt the wager.
- One modest but real OPPOSES finding should normally be adjustment -1 to -2.
- One material OPPOSES finding should normally be adjustment -2 to -3.
- A strong/repeated contradiction to the core wager should normally be adjustment -4 to -6 and may require approved=false.
- Two independent material OPPOSES findings should normally result in approved=false even when the model score is excellent.
- One major conflict that directly attacks the wager's core assumption should result in approved=false unless there is separate, current, wager-specific evidence that convincingly explains why the conflict should not carry forward today.
- Positive adjustments are intentionally harder to earn: +1 for one verified material support, +2 for strong support, +3 only for multiple independent strong supports, and +4 to +6 only for rare major pregame changes. Do not use positive adjustment merely because the model already likes the play.

For any approved candidate that has a material contradiction, selectionComparison/finalVerdict MUST name the independent current evidence that overcomes that contradiction. The model projection, AI score, trend score, Best Play label, and prior qualification are not independent offsetting evidence. If no such current evidence exists, use approved=false.

PITCHER STRIKEOUT STRICTNESS
Recent strikeout results are a genuine contradiction test, not a footnote. Compare the proposed side with the last 3-5 starts and with the most recent 1-2 starts. If the proposed side would have lost in at least 3 of the last 5 starts, or if each of the last two starts materially cleared the opposite side of the current line, treat that as a MATERIAL OPPOSES finding. Do not reduce it to -1 simply because the projection has a large edge. To approve despite that conflict, cite a separate today-specific reason such as a materially different confirmed lineup K/contact profile, a verified workload/leash change, a meaningful current arsenal/whiff/velocity change, or another concrete matchup change. If research cannot identify a convincing independent reason, approved=false. Conversely, routine variance around the line is not automatically a veto; grade the magnitude and recency of the contradiction.

The intended outcome is selectivity, not a fixed daily quota. Do not target a number of picks. Apply the same strict standard independently to every candidate so weak or conflicted slates can produce very few selections and unusually strong slates can produce more.`;

if (!text.includes(strictMarker)) {
  const primaryAnchor =
    "Keep selectionComparison and finalVerdict direct and wager-specific.";
  const fallbackAnchor = "Return only the required JSON object.";
  if (text.includes(primaryAnchor)) {
    text = text.replace(primaryAnchor, `${strictBlock}\n\n${primaryAnchor}`);
  } else if (text.includes(fallbackAnchor)) {
    text = text.replace(fallbackAnchor, `${strictBlock}\n\n${fallbackAnchor}`);
  } else {
    throw new Error("Final AI review prompt anchor not found for adversarial strictness patch");
  }
}

if (text !== original) {
  fs.writeFileSync(path, text, "utf8");
  console.log("Applied adversarial final-review strictness and contradiction handling.");
} else {
  console.log("Adversarial final-review strictness already present.");
}
