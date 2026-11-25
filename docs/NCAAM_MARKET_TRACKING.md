# NCAAM market tracking

The v0.17 projection layer applies the approved balanced v3 market-flow rules to the captured v0.16 team baseline. Ordinary split pressure starts at 25% weight with a flat line, increases continuously to 62.5% at one supporting point and full weight at two points. Money/ticket divergence retains its 75% starting weight. Line movement remains independent. The one-point nonzero floor and four-point spread / six-point total caps remain fixed.

The existing authenticated basketball collector saves each changed forecast as an immutable row in `ncaam_market_projection_updates` after saving its paired line/split observations. No separate schedule or resource is added. Public reads remain read-only. A scoped cache is invalidated after dataset writes so the model uses this tick's observations immediately.

The first deployed collector tick inserts one immutable activation timestamp in `ncaam_market_projection_activation`. The graded ledger preserves every pre-activation A/B forecast at its captured side and quote. Later underlying-baseline A/B fields cannot become new graded bets. The new projection layer is always Ungraded; it cannot cast an A/B model signal. Full Slate displays the adjusted score, fair spread, total and market adjustment summary.

Each update saves its baseline record ID, original scoring proof, quote/split histories, parameters, contributions, input digest and publication time. Clock-only refreshes are idempotent. Histories are recomputed from the unadjusted baseline rather than compounding prior corrections. Paired observations must agree and precede tipoff. Missing splits are never invented: saved quotes from the same provider can supply line-only history, while a single observation leaves the baseline unchanged. The existing final pregame capture stops further revisions; no new forecast is created after tipoff.

The board and collector query only the latest tracked payload per game. Full earlier snapshots remain in storage for later grading analysis; they are not all shipped to the browser. Existing forecast rows, grade rows, manual EZPZ selections and historical betting results are not rewritten. No historical betting backtest or grading recalibration is performed by this rollout.

`lib/config/ncaam-market-tracking.json` mirrors the approved Python repository's `config/ncaam_market_tracking_live.json`. `lib/ncaamMarketTrackingPolicy.ts` is checked against those fixed parameters and 90 Python-generated rule examples. The test suite also executes the actual insert-only SQL against SQLite and checks duplicates, revisions, final capture, ledger preservation and model-vote suppression.

## Forward-only cap sizing

New eligible captures use adjustment sizing `uncapped-v1` for spreads and totals across NCAAM, NBA, NFL, and NCAAF. The existing feature weights, 1-point nonzero floor, timing/identity/eligibility rules, and positive team-score requirement do not change. The capped scorer remains in place to replay legacy rows and store a same-input comparator alongside each uncapped row. Model grade activation, previously saved final forecasts and historical records are unchanged. The first roll forward is the next eligible collector capture under the new build, not a replay of prior decisions.

To stop future uncapped captures, set the Vercel server environment variable `EZPZ_MARKET_PROJECTION_CAPS=on` and redeploy the compatible build. This records future updates under `rollback-capped-v1`, leaving stored uncapped and legacy final rows readable and frozen. Do not roll back to a binary predating mixed-policy reads after uncapped rows have been written. Neither setting changes MLB, props, grades, picks, or baseline models.

### November 25 total policy

The compatible reader accepts v0.17 and v0.18. On this release, only a new pregame capture whose market decision clock is at or after 2026-11-25 21:30 UTC (4:30 p.m. Eastern) may use v0.18. Previously frozen final observations stay immutable. No migration, refresh, replay or data rewrite is required. For v0.18 the current total adjustment is minus twice the same-input original adjustment. The original total and its signed adjustment, source contributions, decision line, edges and comparison sides are retained in market_tracking.original_total_shadow. To audit, use one frozen final per game, compare the two sides at the saved total line against the same final game total, count an exact market push separately, and abstain for a zero model edge. This is a forecast comparison only. No official pick or price return follows from it.

To roll back new captures, set NCAAM_TOTAL_REVERSAL_DISABLED=1 and deploy the same compatible release. Leave mixed-version readers in place. Previously published snapshots stay readable. Legacy totals remain subject to the November 25 presentation bridge. A rollback to a reader predating v0.18 is unsafe after the first new capture.
