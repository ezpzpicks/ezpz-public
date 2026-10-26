# NBA public markets and Signals

NBA Public Betting Splits uses the NFL market card, bars, movement charts and
records table. Its selector browses daily slates. NBA Signals uses the NFL
five-column board: money, line movement, public trends, team trends and model.

The 3+ test requires at least three signals and two independent sources. Money,
movement and public trends share one market source. Multiple matching public
systems count as one signal. This is prospective testing; it does not create
EZPZ picks or social posts.

NBA has a separate market-only catalog and results ledger. Its top 20 use the
same one-sided 95% Wilson formula and eligibility as NFL Signals: strictly above
60% wins and positive net units, with pushes excluded from the win denominator.
There is no additional sample minimum. Football weather, personnel, standings
and archived-model cohorts are excluded. Unknown history supplies no vote.

Only identity-matched ScoresAndOdds quartets captured 10–20 minutes before
tipoff enter public trend records. Official ESPN NBA finals settle their saved
lines. Team scores use tracked current-season games and NFL's 50/30/20 weights;
the threshold is 75. NBA model votes require a saved A/B forecast known before
the decision, a matching side and an equal or better line. Expected-rotation
forecasts keep their unchecked-injury label.

The existing paced NBA collector captures all final signal observations,
including non-picks, and settles pending prior dates. Recorded votes, supporting
rankings and lines replay without later reranking. Public endpoints are read-only
and use date-indexed reads plus a saved season rollup. Full-season catalog work
runs only when results change. The 30-minute/5-minute refresh policy is retained.

Datasets: `nba_trend_records`, `nba_signal_observations`, `nba_analysis_state`.
Archives: `/api/nba-signals-history?date=YYYY-MM-DD`.

Collection attempts and successful freshness have separate durable timestamps.
Failures, partial responses and date rollover therefore still obey 30-minute
collection outside the final 90 minutes; the countdown immediately switches to
five-minute attempts. A failed attempt does not update the last-success clock.
NBA requests explicitly select the Eastern slate date, and event ISO kickoffs
supply each market's date rather than a potentially stale page title. NCAAF
requests select the current Sunday-Saturday source week. Verified NBA schedules
are saved even while markets are unavailable, so the countdown remains known.
Missing market quartets mark the NBA board stale; retained prices cannot become
new final observations. Market locks are persisted independently of lineups.
