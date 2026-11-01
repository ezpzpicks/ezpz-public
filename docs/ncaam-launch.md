# NCAAM launch — November 1, 2026

NCAAM now has a separate saved schedule, market, forecast, signal and record
pipeline. The public pages reuse the basketball components and the shared
football signal/combination evaluation. All data stays in sport `NCAAM`.

## Collection and timing

The existing `/api/cron/nba-market` invocation handles NBA first, then NCAAM.
Each sport has an independent failure boundary and saved refresh clock. There
is no new cron or page-triggered collection. The existing 30-minute cadence,
five-minute countdown within 90 minutes, and 10–20 minute final window apply.
An uncovered college game cannot prevent a different complete game from locking.

ESPN men's college basketball supplies event IDs, absolute tipoffs, regular and
postseason fixtures, results and neutral venues. Use groups=50 and limit=1000.
Exhibitions and unverified start times cannot acquire final locks. Source team
order may be reversed at neutral sites; spread selections are bound by team,
then mapped into ESPN's orientation. Source display clocks do not replace the
verified ESPN UTC timestamp, including the November 1 DST transition.

ScoresAndOdds `NCAAB` consensus is requested for the Eastern calendar date.
Four consistent spread/total sides are required to save a market observation;
prices use the existing -110 assumption. Covers remains a model-only fallback
in the Python builder. Its consensus votes never become sportsbook splits.

## Warren Nolan

Every six hours at most, the paced collector saves the basketball ending-year
pages `/basketball/2027/elo` and `/basketball/2027/sos-rpi`. Basketball has team
ELO and current RPI SOS; it does not expose football's `/sos-elo` page. These
metrics retain their own labels and source links. A 0-0 opponent record has no
played schedule evidence. SOS is context until NCAAM qualification is calibrated.
No predicted/remaining schedule is substituted for current SOS.

## Model and qualification status

The old manual foundation was not complete. Its defensive eFG sign is corrected
in the admin repository. The new automated v0.2 baseline uses dated Torvik
adjusted offense, defense and tempo, with verified neutral-site handling. It
excludes overlapping raw four-factor/SOS additions and has no claimed calibrated
probabilities. Forecasts are immutable by version and early/pregame phase.

**The automatic model is Research, not a validated A/B selection policy.**
Full Slate shows its projections, exact market source/line and results. A/B
records exclude Research forecasts. Player availability is explicitly unchecked.

NCAAM captures every eligible final signal side and its own exact combination,
market and side-category history. Cold-start scores are 50. No NCAAF/NBA history
or score threshold is imported. Until a dated NCAAM policy is added, official
EZPZ qualification is disabled and the UI explains calibration status.

MCP/current-pick/results schemas accept NCAAM; the same eligibility gate rejects
unapproved picks. Signal collection, final captures, settlement and exact-combination research stay active while official selection is on hold. The Signals view can filter for active signals without requiring an official EZPZ pick. Existing publishing subscriptions remain untouched. Adding
NCAAM to an existing webhook filter requires reading and preserving the complete
trigger set; do not reconstruct an opaque trigger from a prompt.

## Saved datasets and reads

- `schedule`, `posted_games`: complete official schedule, including unmodeled games.
- `weekly_market_trends`, `odds_snapshot`, `public_split_snapshots`: observed market evidence.
- `ncaam_model_forecasts`, `ncaam_rating_inputs`: Python forecasts and dated model inputs.
- `ncaam_warrennolan_snapshots`: six-hour ELO/RPI SOS cache.
- `ncaam_signal_observations`, `ncaam_trend_records`: immutable pregame evidence and settlement.
- `ncaam_analysis_state`: compact season rollups; only pending dates are refreshed.
- `current_ezpz_picks`: existing final-pick integration contract.

Public and archive routes read saved data only. They do not write, fetch source
pages, run models or scan season snapshot archives. Season trend ranking is
recomputed only when an official result changes. Full Slate, splits, signals and
records have daily archive controls and keep saved games visible after tipoff.
