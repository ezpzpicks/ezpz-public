# Signal combination research

The Signals board compares frozen 0-, 1-, 2- and 3+-signal observations, exact
combinations, and inclusive individual-signal baselines. It does not promote
combinations into EZPZ picks or change the existing 3+ test, raw signal rules,
one-pick-per-game selector, price cap, or posting behavior.

## Evidence and scope

- Use the original saved signal flags, line, odds, rule version and final-window
  capture, including sides that were never selected by the 3+ test.
- Accept only recorded 10–20-minute pregame observations with a finite line and
  valid saved American odds of -150 or better. Reject changed-rule rollups,
  conflicting duplicate decisions and impossible/future captures.
- Settle at the frozen line. A result requires a timestamp after kickoff and no
  later than the evaluation time. Pending outcomes do not enter ROI.
- Risk one unit per settled observation; wins return the saved American-odds
  profit, losses cost one unit and pushes return zero profit. Round only display
  totals. Identify assumed prices and observations whose provenance was not
  recorded; do not present those as verified sportsbook execution.
- Keep each sport and market separate. An exact pair excludes observations with
  a third signal. An individual baseline includes every observation matching
  that signal, so its sample overlaps with combination samples.
- Tile combo records also match the selected side: favorite, underdog, pick'em,
  over or under. Spread categories use the saved line; totals use the saved
  direction. Missing directions stay unavailable rather than using pooled
  totals. The expanded research tables retain their overall market totals.
- These are **side observations**, not a simulated final betting card. Both
  sides and multiple markets from one game can appear. They are correlated;
  sample sizes are not counts of independent games.

The forward-test boundary is `2026-10-23T22:27:21.000Z`, when this tracking
definition was established. Previously captured observations remain available
as earlier history. Never manufacture missing historical votes from current
models, team histories or Wilson leaderboards.

## Storage and cost

NFL and NCAAF reuse the observations already loaded by the board. NBA seeds
existing archived signal observations once through the existing date-keyed
read, then replaces compact daily aggregates in its existing analysis state as
results arrive. Repeated collector ticks cannot append the same sample again.
The side-aware research version rebuilds NBA's existing daily aggregates from
the original saved observations once, using that same collector seeding path.
Public reads perform no research writes and no full-season trend rebuilding.
There is no additional poller or cadence change.

The reporting engine is sport-neutral. Current adapters are NFL, NCAAF and NBA,
the sports with an existing Signals capture pipeline. MLB/NCAAM can use the same
engine when their signal adapters exist; this change invents no unsupported
signal feeds or historical records for them.

## Promotion remains a later decision

Use earlier history to identify candidates, then evaluate their later results
separately, including ROI, price quality, sample size and uncertainty. Compare
exact combinations with their individual baselines without interpreting the
observational comparison as causal improvement. Positive observed ROI alone
does not whitelist a combination or post it as an EZPZ pick.

Run the research, football/NBA capture and shared UI tests with `node --test
tests/signal-combinations.test.cjs tests/football-signals.test.cjs
tests/nba-signals.test.cjs tests/football-signals-ui.test.cjs
tests/nba-signals-ui.test.cjs`.
