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
