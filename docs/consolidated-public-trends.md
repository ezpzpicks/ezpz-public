# Consolidated public-split catalogs

NFL, NCAAF, NBA and NCAAM each use 96 active public bet types. Each sport keeps
its own source definitions, identities, prices, memberships, records and ranking.
The original source catalogs and final pregame observations remain archived.
MLB already has a small direct catalog: Sharp, Public Fade and RLM by favorite
moneyline, underdog moneyline, Over and Under. Its twelve combinations do not
require expanding into dozens of new categories.

## Shared reporting contract

- Rank at most twenty types with at least eight wins/losses, strictly above 60%
  wins and at least 10% unrounded one-unit-risk ROI. Do not pad empty slots.
- Order by the one-sided 95% Wilson lower bound, then ROI and stable ID.
- Union related threshold/size memberships; deduplicate physical selections.
  Identical historical selection sets occupy one ranking slot.
- Keep ticket share, final money-ticket gap, opening-to-final money growth and
  line movement distinct. Keep Over/Under directions and line-support roles.
- Multiple matches still produce one Public Trend signal. Other signal
  definitions and official sport-specific selector thresholds are separate.
- NBA and NCAAM retain their explicit assumed -110 price policy. Their ROI is
  calculated at that assumption and is not observed sportsbook execution.
- NCAAM can have zero qualifiers until enough actual NCAAM observations exist.
  NBA/football records cannot seed its win rates.

## Preserved captures and reconstructed research

New observations use a dated sport-specific grouped policy. Previously captured
flags, selections, scores and prices retain their original policy at settlement.
Research replay changes only Public Trend, with outcome updates from the same
frozen line when a pending game settles. It never invents missing model, team or
SOS votes. The group ranking at a historical decision uses only outcomes settled
before that decision and excludes that game.

Replayed observations are marked historical, even for recent game dates. New
captured observations remain a separate forward source. Policy mismatches cannot
silently borrow another combo record. Favorite/underdog/Over/Under and exact
active sets remain separate in combo records.

Basketball stores replayed and captured daily aggregates separately. Each source
replaces its own changed day before the sources are combined, preventing
double-counting or deletion of replayed games on a day that also has new captures.
Original daily history remains available for old-policy tiles.

## Producer migration and cost

The existing authenticated basketball collector accepts `consolidate=1` to
migrate saved analysis from original frozen evidence without refreshing a live
provider, running a model or rewriting original captures. It requires the cron
credential even in preview and rejects dry-run bypasses. The existing deployment
bootstrap calls it once for NBA/NCAAM together.

Ordinary basketball ticks use compact saved state. Season records are read only
for initial grouping migration or changed results. NCAAF uses the existing saved
public-board producer. No new poller or cadence is introduced, and public page
reads perform no grouping migration or season scan. Frozen membership parsing
is memoized by object identity during reconstruction.

The group definitions were chosen after inspecting this season. Historical ROI
and reconstructed combos remain exploratory; only new captures establish
performance under the deployed grouped policy.
