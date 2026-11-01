# Sport-specific combo-score selector

The NCAAF EZPZ selector changes prospectively on game date **2026-11-01**.
The October 31 trial and earlier official selections are not retroactively
published or mixed into the new score-policy record.

| Sport | Official selector from Nov 1 | Score status |
| --- | --- | --- |
| NCAAF | Highest combo score per game, minimum 65 | Active, provisional cutoff |
| NFL | Existing 2-signal, 2-evidence-group selector | Separate calibration; no approved score cutoff |
| NBA | Existing 2-signal, 2-evidence-group selector | Separate calibration; no approved score cutoff |
| MLB / NCAAM | Existing supported behavior | No invented combo-history adapter or cutoff |

Each sport's score threshold is a dated policy in `lib/comboScore.ts`. Promote
another sport or a threshold change by adding a new policy entry with its own
effective date and version. Do not edit a historical entry or rescore saved
decisions under a later cutoff.

## Formula

Use the exact active, available signal set, sport, market, and selected side
(favorite, underdog, pick'em, over, under). Given own W-L-P and opponent Wo-Lo-Po:

```text
own adjusted win rate = (W + 10) / (W + L + 20)
opponent adjusted loss rate = (Lo + 10) / (Wo + Lo + 20)
raw = 100 × (own adjusted win rate + opponent adjusted loss rate) / 2
score = clamp(50 + 3 × (raw − 50), 0, 100)
```

Pushes are excluded from the rate; empty history is neutral at 50. This is a
ranking score, not a win probability. A side with zero active signals can qualify.
Cutoffs use the full-precision number, not its rounded display value.

## Capture, selection, and accounting

- Use only earlier game dates. Today's results never enter today's score.
- Freeze the score, raw score, both exact combinations, side groups, W-L-P
  inputs, opponent identity/quote, history dates, and calculation time with the
  original observation. Results can settle later; score inputs cannot change.
- Retain valid saved odds of -150 or better and a verified T-20 to T-10 quote.
  An available corrected schedule takes precedence over a mismatched feed clock.
- Wait for both opposing pairs (spread and total) to be captured before selecting
  the game's single leader. This prevents a late-arriving market from replacing
  a decision after its event was emitted.
- Select the highest full-precision score. Exact ties prefer Spread, then a fixed
  descending selection order and ID. Results never break ties.
- Current official score summaries include only this dated score policy.
  The date archive retains old selectors and original frozen evidence.
- NFL and NBA save score observations prospectively for calibration while their
  existing official selectors continue. New scores do not manufacture old votes
  or promote the trial's retrospective card into official records.

## Sport-by-sport evidence at rollout

NFL and NBA were replayed with the same formula, one highest-scoring play per
game, prior-date records known before each slate's Eastern midnight, original
saved signal flags/lines, and standardized -110 prices. This conservative replay
has only 16 NFL games and 73 NBA games. NCAAF's October 31 trial uses its fixed
pre-day combo records, with 44 verified final-window games and three excluded
one-hour-early captures.

| Sport | Cutoff | W-L-P | ROI at -110 | Interpretation |
| --- | --- | --- | --- | --- |
| NFL | 55 | 2-0-0 | +90.9% | Two plays cannot establish a cutoff |
| NFL | 60 | 1-0-0 | +90.9% | Only one play |
| NFL | 65 | 0-0-0 | Unavailable | No qualifiers |
| NBA | 55 | 22-22-0 | -4.5% | No demonstrated advantage |
| NBA | 60 | 11-11-0 | -4.5% | No demonstrated advantage |
| NBA | 65 | 1-4-0 | -61.8% | Higher scores have not shown better returns |
| NCAAF, Oct 31 | 65 | 12-4-1, 1 pending | +40.6% settled | Initial provisional cutoff |
| NCAAF, Oct 31 | 70 | 7-1-1, 1 pending | +59.6% settled | Comparison candidate; less volume |

The NCAAF status is from 11:14 PM ET on October 31; its pending games are not
declared wins. NFL/NBA results are descriptive calibration evidence, not an
optimized or validated threshold. Choosing NBA's cutoff merely to maximize
this sample's profit would not validate that its score ranks plays correctly.

## Feed and delivery contract

The site, saved-picks API, MCP tools/events, and saved-result reader all use the
shared selector. Score selections expose `selectionMethod=combo_score`, numeric
`score`, `scoreThreshold`, `threshold`, `scoreVersion`, and `selectorVersion`.
The stable `pickCategory=signals`, `pickLabel=EZPZ Signal Pick`, pick IDs and
existing event subscription are retained for publisher/recap compatibility.
Signal counts are supporting context only for NCAAF score picks.

No new poller, history scan, model build, or page-read write is added. Football
reuses already loaded observations; NBA reuses its compact daily research state.
The existing paced collector owns capture and publication events.
