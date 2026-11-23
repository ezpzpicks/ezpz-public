# Live market projections

NBA, NFL and NCAAF spreads and totals use the frozen balanced directional rules approved for NCAAM. These are initial operating weights, with new game projections explicitly Ungraded. MLB and player props are outside this rollout.

| Evidence | Point contribution |
| --- | --- |
| Line movement | 1 per supporting point |
| Money share movement | 2 per 10 percentage points |
| Opposing money/ticket movement | Extra 1 per matched 10 percentage points |
| Ticket-only movement | 0.5 per 10 percentage points, opposite the tickets |
| Same-window line confirmation | 0.5 |
| Later line confirmation | 0.25 |

Ordinary split evidence starts at 25% weight on a flat line, reaches 62.5% with one supporting point and 100% with two. Opposing money/ticket movement starts at 75%; opposing price movement further damps split evidence. Nonzero adjustments have a one-point minimum, with caps of four spread points and six total points. The checked-in configuration and 90 approved numerical cases freeze these rules independently of later NCAAM changes.

Each sport activates on its first deployed producer tick. Existing paced collectors and public-board producers save new projections in `market_projection_updates`; public page reads remain read-only. A snapshot embeds its unadjusted native forecast, actual paired observations, input digest and separate spread/total contributions. Refreshes recompute from that baseline, never from a previously adjusted score. NBA preserves native forecasting and lineup data; NFL reads its independent spread and total proofs at full precision.

Paired team identities, sport, slate date, kickoff, shares, source and timestamps must agree. Missing percentages stay unknown and do not prevent a verified line movement from counting. Incomplete or stale paired markets wait for fresh observations. The existing 10–20 minute final window remains authoritative; an insert-time guard prevents concurrent live writers from overtaking a frozen projection. No in-game snapshot is created.

Forecast cards and shared signal projections show compact green/red arrows for the change from baseline. Spread arrows describe each team's strength, so their signs are opposite; a stronger team's numerical handicap becomes more negative. Score deltas combine the spread and total effects, while total arrows show the total change.

New adjusted forecasts cannot cast graded model votes or create game bets until grading is established. Native NBA A/B records are filtered at the immutable activation cutoff before selecting the latest legacy capture. Football writers check the same activation within their game-bet insertion transaction. Earlier bets retain their captured line, side and grade and can still settle; player props continue independently. No historical bet reconstruction or performance backtest is part of this rollout.
