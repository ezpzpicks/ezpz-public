# NCAAF totals direction forward test

Policy: `ncaaf-total-direction-forward-2026-10-30-v1`, starting October 30, 2026.
This is a prospective paper test, separate from model records, official EZPZ Picks
and social posting. The historical 22–12 fade result is not added to this record.

Fixed candidates:

- A Total Fade: reverse an A Total with a positive model edge of at least six
  points, at the exact saved total line.
- Original B Total: retain a B Total with a three to below six point edge and its
  exact saved side and line.
- Original A Total: retain the original A direction as a paired comparison,
  reported separately from the fade and never pooled into its statistics.

Paper profit assumes -110 odds and one unit risked on every selected play. This
does not verify whether the opposite side was offered at that price or line.
The policy pins the current `cfb-v2.8.1-five-game-residual-totals-2026-10-07`
model version. Parameter changes require a new policy version.

The existing NCAAF scheduled public snapshot job observes saved model forecasts
and their canonical schedule. Only valid, matching games observed before kickoff
are admitted. Forecasts, lines, grade, direction and selection decisions freeze
on the first observation, including observations that produce no candidate.
Database clock guards prevent delayed requests from capturing after kickoff.
Later refreshes cannot rewrite those decisions or add a missed selection.

Settlement reuses already-loaded completed schedule scores, with explicit missing
score and cancellation checks. Only result fields change. Pushes return zero;
pending entries are excluded from profit and ROI denominators. Capture failure
does not interrupt official model/pick processing.

Read current results at `/api/ncaaf-total-forward-test`. This endpoint is read-only
and returns per-strategy W-L-P, pending count, units, ROI and recent frozen entries.
All research entries are labeled `official: false`, `eligibleForPosting: false`.
There is no automatic promotion of this experiment into official selections.

Storage uses separate `ncaaf_total_forward_*` tables and indexes. Public page reads
do not perform captures, create tables or fetch odds. Unchanged scheduled cycles
perform no forecast writes, and the job reuses its existing model/schedule reads.

Validation:

```sh
node --test tests/ncaaf-total-forward.test.cjs tests/ncaaf-model-research.test.cjs tests/football-team-season-history.test.cjs tests/ncaaf-public-performance.test.cjs
npx tsc --noEmit
```
