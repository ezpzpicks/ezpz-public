# Matchup context evaluation

The evaluator compares both spread sides and both total directions for each game. Its local statistical fit uses the original saved evidence and earlier settled results. All fitting, scoring and explanations run inside the existing application.

## Evidence and comparisons

Each sport and market has its own fit. The 21 bounded inputs cover the price baseline, ticket and money shares, money above tickets, opening-to-final line changes, the latest distinct line move, individual role and venue records, recent team results, combined team trends, model edge and qualification, and NCAAF spread SOS differences.

Continuous interaction terms represent disagreements between the line, public tickets, team records and the model. Other interactions connect schedule strength to recent and venue form, and model direction to its earlier performance in the same sport, market and model version. These terms allow the fitted weights to vary with the surrounding evidence. A matchup can contain a combination that has no named play type.

Each team record is adjusted toward neutral using four prior decisions. Model form uses up to 20 earlier qualified model observations and eight prior neutral units. Original records and sample sizes remain visible beside the adjusted comparisons.

The chart retains the ticket share at the latest line change. That lets the review distinguish a line move made during majority support from a higher line that later held as the public shifted to the opposite direction. Future quotes, conflicting quotes at the same timestamp and timestamps without a timezone cannot supply movement features.

## Learning and decisions

The evaluator reuses the existing penalized logistic fit, paired price baseline, chronological calibration, push handling, uncertainty adjustment and one-pick-per-game selection. Each market pair supplies one observation. Opposing probabilities sum to one before accounting for pushes.

Training uses earlier dates whose results were known before the current Eastern midnight. Each historical training row receives only the model form known before its own snapshot. The current day's model form freezes with the daily fit. Data arriving afterward becomes eligible for a later dated model.

The fixed existing qualification settings require 40 training games across four dates, 20 chronological checks across three later dates, odds of −150 or better and at least 2% estimated return after uncertainty. A game receives one highest-ranked qualifying choice or a pass. Conflicts remain visible even when the decision is a pass.

The saved explanation contains each side's raw team records, line history, betting splits, model context, schedule comparison, opposing indications and the largest fitted contributions. Contributions describe changes to the statistical estimate. They are distinct from a validated causal explanation of the game outcome.

## Capture and records

The existing NFL, NCAAF, NBA and NCAAM producers prepare pending reviews as soon as complete live spread and total pairs are available. The same comparisons, eligibility settings and earlier-results-only daily model apply; live quotes never enter final capture or training. Pending reviews refresh with each producer run, show their source time, and remain outside paper records. The open review panel checks for updates every 30 seconds while visible.

The authenticated `/api/cron/matchup-context` refresh also prepares reviews directly from a current saved board. Deployment warmup uses this bounded path before full provider collection, so a slow collector cannot block the initial pending display. It does not scrape providers or change official picks.

The producers capture complete original paired markets in the final 10–20 minutes. Daily models and final game decisions use atomic first-insert ownership. The original quotes, case descriptions, weights and decision freeze together. A final review replaces the pending display for its game, even if an overlapping producer saves an older preview. Unfinalized previews disappear at kickoff and do not become historical decisions. Later settlement updates outcomes at the frozen quotes, with protection against older concurrent updates replacing newer outcome labels.

Models, pending slate previews and final decisions use the versioned `matchup_context_models`, `matchup_context_pending` and `matchup_context_decisions` datasets. The public Signals view reads saved reports through `/api/matchup-context`. Ordinary page reads retrieve saved data. The registration is paper evaluation with its own record.

The existing quote provenance stays visible as observed, assumed −110 or unverified. Missing context supplies zero directional evidence and is identified in the saved case. Historical flags and model-form counts use the captured input definitions.

## Development replay

The initial NCAAF replay uses the available original October 20–November 5 observations to prepare the November 6 comparison. It has 105 decided spread pairs and 111 total pairs across ten dates, with 52 and 58 chronological checks across six later dates.

The spread adjustment shrinks to zero. The total adjustment retains 5% of its raw fitted change. The evaluator identifies disagreements in Virginia Tech–SMU Over 56.5, South Florida–East Carolina Under 39.5, Nebraska −4.5 and Nevada +10.5, and passes all four after the existing price and uncertainty requirements. The saved USF–ECU final quote is 39.5, while the user's selection was Under 40.5.

Those examples are development diagnostics. The prospective paper record starts with newly captured decisions after deployment. This first fit demonstrates the evidence comparisons and the limitations of the current historical support.

Focused checks cover chronology, missing and future context, changing model form, duplicate evidence, paired probabilities, four-side decisions, SQL ownership, settlement and read-only reports. The fitting and scoring check also runs with network access disabled.
