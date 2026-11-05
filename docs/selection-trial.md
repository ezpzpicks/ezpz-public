# Expected-value selection trial

Policy: `selection-trial-2026-11-04-v1`. This is a prospective challenger, not an
official selector. The current MLB/NFL/NCAAF/NBA rules, NCAAM calibration hold,
official records, MCP events, Buffer publishing and recaps keep their existing
contracts. Promotion requires a separately dated policy after subsequent results
support it. A positive historical ROI does not automatically promote anything.

## Inputs and isolation

NFL, NCAAF, NBA and NCAAM reuse their original immutable signal observations.
Reclassified research flags, live/backup quotes, reconstructed histories, missing
prices, incomplete opposing pairs, contradictory duplicate observations and
captures outside T-20 to T-10 are rejected. Each sport has independent training,
models, calibration and ledgers. Old official selections are never relabeled.

NBA/NCAAM share no outcomes with football or each other. MLB has a new, separate
original-quote adapter for Moneyline/Total: money-minus-tickets and observed line
changes are available; absent team/model/public-system context stays absent.
It does not manufacture historical model features or interpret old ranking
scores as probabilities. MLB's adapter starts building its own archive when
verified final quotes are available; offseason/cold-start status can persist.
Run lines and player props are outside this initial trial's evidence adapter.

## Model

One paired market is one training observation. Opposing sides are not two
independent successes; each sport/market fit has at most one sample per game.
Spread reference = favorite (stable ID tie-break at pick'em), total reference =
Over, moneyline reference = lower implied payout/favorite. The opposing
prediction is the exact probability complement, conditional on no push.

The two opposing saved American prices supply a normalized, vig-removed market
baseline. Penalized logistic regression learns changes relative to that
baseline. The fixed feature list includes available individual signal flags,
bounded original signal strengths, separate legacy/grouped public-system flags,
and two predefined interactions across market/model/team evidence groups.
Unknown strengths are zero evidence, not positive votes. Regularization handles
overlap and pulls sparse patterns toward the baseline. No exact-combination
lookup table or search through every possible interaction is fitted.

The ridge penalty is 16 (intercept 32). There is no per-sport optimization of
these constants against historical profits. Damped Newton fitting checks
numerical convergence; a failed fit cannot qualify a pick. A daily model uses earlier game
dates only, with result timestamps after the game and before that day's Eastern
midnight. Unzoned result timestamps are unavailable. Results observed late cannot enter a fold before they became known.
Whole games stay on one side of the date boundary, including the DST transition.

Within that earlier history, chronological folds fit each earlier model and
predict later dates. A penalized scalar from 0 to 1 shrinks the learned change
toward the market using only those earlier out-of-time predictions. It cannot
amplify an edge. Raw out-of-time Brier/log-loss metrics are descriptive; they are
not an independent test of the final shrink-factor choice. Only subsequently
frozen prospective cards test the complete selection algorithm.

## Qualification

Requirements are fixed before the prospective trial:

- At least 40 decided market/game observations across four training dates.
- At least 20 chronological calibration observations across three later dates.
- Saved odds of -150 or better, consistent with the existing price cap.
- At least +2% estimated return after the uncertainty adjustment.

The uncertainty adjustment uses the penalized fit's inverse-Hessian variance,
a calibration sampling floor, and a fixed 1.28155 logit-scale multiplier. It is
an approximate model adjustment, **not** a validated confidence interval or a
guarantee of profitable betting. Availability and calibration counts alone do
not establish a reliable win probability.

For integer spread/total lines, push rate uses that sport/market's earlier
integer-line results with an explicit Beta(1,49) prior. Half-point lines and
moneylines have zero push probability in this adapter. For one unit risk:

`expected return = (1 - push probability) * (win probability * odds profit - loss probability)`

Both full opposing market pairs must be saved at essentially the same time.
While still T-20 to T-10, the highest conservative expected return can earn one
trial pick per game; otherwise the game is a recorded pass. Snapshot times,
model ID, training cutoff, estimates, contributions, prices, chosen side and
the incumbent on that exact card freeze on first insert. Late collector ticks
cannot backfill a missed pregame decision. A missing unrelated game's feed
does not prevent complete captured games from being assessed.

## Capture, settlement and cost

Existing scheduled producers own capture. The trial introduces no scheduler,
provider request, model run in a page request, or publishing call. Original
history is read once per sport/date to fit a frozen daily model; later ticks
read small date-indexed model/decision records and pending labels. Unresolved
older dates are rediscovered at daily model creation until settled. No season
history is scanned by an ordinary public board request.

Models and cards use atomic first-insert ownership under the existing Turso
transaction helper. Overlapping collectors cannot replace a saved model or
selection. Settlement merges outcome labels only after kickoff and at the
identical original quote; it cannot rewrite a pick or model. Trial failures are
isolated from official picks. Pending outcomes do not enter ROI; pushes are
settled zero-profit wagers. Each win returns the profit of its saved price.

The trial records assumed -110 and unverified price provenance explicitly.
These are paper results, not claims of sportsbook execution. The incumbent
comparison includes only the same complete captured games and quotes, not its
entire published record. Pass counts and coverage accompany returns so sparse
selection or incomplete data cannot masquerade as broad success.

## Opposite-side paper test

The separate `selection-opposite-test-2026-11-04-v1` strategy extends **new**
complete pregame cards with a frozen raw candidate and, when triggered, its exact
opposing side at that side's saved price. Existing cards remain unchanged. It
does not change the strict trial model, its calibration, official selectors,
publishing, or earlier records. Existing scheduled collectors capture it;
there is no additional cron or source request.

The raw control chooses the highest raw estimated ROI of at least +2% per game,
before the added calibration shrink and uncertainty reduction, with -150 or
better odds. It still needs a converged fit and 40 earlier training games across
four dates. Raw estimates and candidate identity freeze with the card.

The opposite test uses that same candidate and requires all of:

- The strict trial rejects the original candidate.
- At least 20 chronological validation games across three dates.
- Calibration retained exactly zero learned adjustment, with model status
  `No supported edge yet`.
- Raw out-of-time Brier error exceeds the market baseline's Brier error.
- The exact opposing side in the same market has saved odds of -150 or better.

Insufficient history, a failed fit, or an uncertainty-only rejection cannot
trigger a reversal. The opponent never becomes an independent training sample.
The mechanical opposite selection is a **hypothesis**, not an estimate that
its win probability or conservative ROI is positive. The uncertainty adjustment
is not inverted into confidence in the other side.

The report shows all qualifying raw candidates, plus original candidates and
opposite selections on the **same reversal games**. Each uses its own original
price; settlement shares the existing outcome-only contract. Pending bets are
excluded from ROI, and pushes return zero. Older cards without this versioned
extension are not backfilled or included in either paper record. Historical
30-21 and 5-0 reversals from the initial NBA diagnostic remain exploratory;
they are not prospective test wins or Dallas-specific pattern records. The
five positive-ROI spread forecasts were below +2%, so that 5-0 does not directly
validate this test's +2% entry rule.

Validation includes reversal gating, one selection per game, paired controls,
missing-history/uncertainty rejection, exact opposing prices, legacy-card
exclusion, and immutable settlement. Run the existing trial tests plus
`node --test tests/selection-trial-opposite.test.cjs`.

## Active fade qualifier (November 5)

The fade test now uses the saved **mechanical reversal rule** as its qualifier.
The `fadeTrial` API report and the main Fade test table use the versioned
`paperComparison.oppositePickId`; estimated fade ROI and signed-calibration
uncertainty do not veto or rank that selection. This is the same mechanical
rule already captured prospectively, so its original cards and records can be
used without reclassifying games after their results. The raw candidate still
needs +2% raw estimated ROI; the opposite side has no estimated ROI minimum.

The rule requires the stable 40-game/four-date raw fit, 20 chronological
calibration checks across three dates, zero retained original adjustment,
`No supported edge yet`, raw prediction error worse than the market baseline,
and each side's own odds of -150 or better. The highest raw candidate is the
only one considered per game. Missing history, failed fits and uncertainty-only
rejections cannot trigger a reversal. Evidence is usually pooled by sport and
market; this is not a matchup-specific reversed win rate or a two-signal rule.

The signed probability model below remains informational. Its old ROI-filtered
record remains separately available under `fadeTrial.calibratedComparison`;
`fadeTrial.estimatePolicy` identifies that model's version, while
`fadeTrial.policy` identifies the active mechanical rule and explicitly marks
`usesEstimatedFadeRoi: false`. A missing estimate cannot suppress a rule-qualified
fade. No collector writes, frozen decisions, official selectors or publishing
rules change in this update.

## Experimental calibrated fade probabilities

`selection-fade-2026-11-04-v1` is a separate research model. It preserves the
strict trial and the mechanical opposite-side test. It estimates each side's
probability; it never turns a rejected lower bound into confidence in the
opponent, reverses an ROI percentage, or treats 30-21 as a matchup probability.

The unchanged raw sport/market model generates chronological predictions.
Signed calibration fits a logit adjustment weight on a fixed -1 to +1 grid in
0.05 steps: negative = fade, zero = market baseline, positive = follow. The
global penalty remains 2, centered at zero. With at least ten games across
three dates, the original source signal combination receives a partially
pooled adjustment (penalty 4, centered on the global weight); matching original
public-type identities may then receive an adjustment (penalty 8, centered on
the combination weight). Role, opposing signals, and legacy/grouped policy
families distinguish combinations. Sparse contexts use the broader estimate.
Overlapping public types select unique market/game observations once.

Only the original captured public-type IDs enter these contexts. Later
leaderboard ranks, system win-loss records, and retrospectively reclassified
flags are not features. The storage query preserves IDs while discarding the
large public-system context arrays. The raw model's coefficients, original
calibration, feature list, and existing model IDs remain unchanged.

A second chronological layer checks the signed calibration: for each later
date, fit calibration only on earlier raw predictions whose labels were known
before that date's Eastern midnight. At least 20 such later checks across
three dates were required by the original ROI-filtered comparison, in addition to the existing
40-game/four-date training and 20-game/three-date calibration minimums.
Matching raw +2% cohort counts are reported separately; they are not added to
the general validation count or represented as an independent winning record.

The per-side probability is `sigmoid(sideSign * (marketLogit + signedWeight * rawAdjustment))`.
Approximate logit variance includes `signedWeight² * rawParameterVariance`
plus `rawAdjustment² * signedWeightVariance`. Nested local fits do not add
overlapping support as independent precision. A floor of
`1 / (laterValidationGames + 20)` remains; the existing 1.281551565545
uncertainty multiplier reduces the selected side's probability. These are
provisional modeling choices, not a validated confidence interval.

Expected and conservative ROI each use that side's original odds and push
adjustment. The original ROI-filtered comparison required the opposite of
the qualifying raw direction, a negative calibrated weight, the earlier/later
history minimums, both source and fade prices of -150 or better, and +2% conservative
ROI. That comparison's selections and rejection reasons remain frozen for
research. The active fade qualifier above does not use these extra gates.

Existing collectors freeze signed models in `selection_fade_models` and attach
a separately versioned `fadeComparison` only to newly captured cards. The raw
fit is reused on new dates; adding the model to an already-frozen date needs
one bounded history read/build. Outcomes alone may update afterward. Old
cards cannot acquire retrospective fade selections. Model/estimation failures
are isolated from strict trial capture and official picks. Public API reads
do not build models and omit the full signed-calibration samples.

### November 4 replay

The requested OKC -3.5, Ball State +2.5, and Spurs -12.5 replays use only
earlier-date results known before November 4 Eastern midnight and the exact
original final pregame quotes. The model was developed after those games;
these are retrospective research estimates, not actual pregame selections or
independent proof of profitability. All three meet the mechanical fade rule.
None cleared the original conservative +2% filter under its fixed settings;
these percentages are now informational. The replay reports both checks
explicitly and remains excluded from all prospective records.

The reproducible compressed fixture preserves 368 NBA and 422 NCAAF historical
sides plus the twelve requested game-quote sides. Target outcomes are removed.
Run:

```sh
node scripts/replay-selection-fade.cjs --fixture tests/fixtures/selection-fade-replay-2026-11-04.json.gz
node --test tests/selection-fade.test.cjs tests/selection-trial-store.test.cjs
```

The committed report is `app/data/selection-fade-replay-2026-11-04.json`; the
Selection trial page shows each sport's examples with cover probability,
expected ROI, conservative ROI, support, and rejection reasons. Tests reproduce
the published numbers and verify that changing the target outcomes cannot
change the models or estimates.

## Review

The lazy **Selection trial** panel appears in Signals and Signal Research, with
an all-sport review page at `/selection-trial`. The read-only endpoint is
`/api/selection-trial?sport=NBA&date=2026-11-04`. It exposes the frozen model,
training/calibration support, trial and matched-incumbent records, and daily
decisions. Nothing from this endpoint is eligible for automatic posting.

Validation: `node --test tests/selection-trial.test.cjs tests/selection-trial-store.test.cjs`.
Tests include chronological result availability, duplicate/conflicting pairs,
DST, small samples, coherent probabilities, quote integrity, prospective-only
capture, ROI/push accounting, isolation from official feeds, and real SQLite
atomic-insert/outcome-only-update behavior.

### Initial archive audit (November 4, before this date's outcomes)

Original public signal-history responses were checked with
`node scripts/audit-selection-trial.cjs <saved-history-directory> 2026-11-04`.
This is data/chronology validation, not a prospective ROI backtest.

| Sport | Decided spread pairs | Decided total pairs | Training dates | Later calibration pairs (spread / total) |
| --- | ---: | ---: | ---: | ---: |
| NFL | 29 | 29 | 8 | 0 / 0 |
| NCAAF | 102 | 106 | 8 | 49 / 53 |
| NBA | 92 | 92 | 12 | 51 / 51 |
| NCAAM | 126 | 126 | 3 | 0 / 0 |

NBA's raw fold Brier scores were .2530/.2515 against .2500/.2500 market
baselines. NCAAF's were .2513/.2503 against .2493/.2509. The conservative
calibration chose zero learned adjustment in all four calibrated markets.
Accordingly, initial states show **No supported edge yet**, and those models
pass rather than treating a historical winning combination as established
value. NFL lacks the training count; NCAAM lacks enough distinct training dates.
MLB needs its own newly captured quote history. Subsequent daily fits can change
as genuine additional outcomes arrive, under the same frozen algorithm.
