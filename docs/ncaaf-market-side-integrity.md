# NCAAF market-side integrity

## November 4 failure

The raw public split archive retained Central Michigan -3 and Eastern Michigan
+3 before their November 4 kickoff. The weekly tracker contained one spread
row instead: its selected team was Central Michigan, its label still included
-2.5, and its numeric line and percentages belonged to Eastern Michigan +3.
The totals were complete.

ESPN's school labels explain the storage collision. The scoreboard supplied
`C Michigan` and `E Michigan` as short display names. The historical token
matcher discarded the one-letter prefixes, so both full school names matched
the first opponent. Both rows received the same canonical spread-side key.
The production parser, mapping, storage and freeze test reproduces a single
stored row before this fix and two independent rows afterward.

Toledo-Sacramento State had a different issue. The saved source contained a
complete 52.5 total but no spread splits. A direct check of the retained
ScoresAndOdds Week 10 page on November 5 showed a listed 25.5 spread with only
a partial betting percentage and no usable handle percentages. The parser
correctly omitted that incomplete evidence. A Covers model line is not a
substitute for missing public betting inputs.

## Fix

- Prefer ESPN's full school `location` over its abbreviated display name.
- Normalize the known C/E/W Michigan abbreviations when reading legacy rows.
- Resolve the selected team against both opponents. An exact school match
  takes priority; a historical loose match is accepted only when unambiguous.
- Reject ambiguous school sides and foreign game/market/side history before
  normalizing aliases. Never relabel an opponent's observation as its own side.
- Keep the selected school separate from the numeric line during refreshes.
  A source quote after the final cutoff cannot put a different line in the
  retained selection label.
- Require both spread and total pairs in NCAAF coverage reporting. Keep usable
  markets, but report absent or one-sided markets in the collector warnings.
  Existing published-market-only coverage callers keep their policy.

The regression suite exercises the production scheduled writer, final window,
read-time deduplication, Michigan/Michigan State overlap, ambiguous names,
foreign history, partial source percentages and missing spread coverage.
These tests run in the existing market workflow.

This change does not reconstruct past signal observations or add historical
bets to the prospective fade record. The original snapshots remain the audit
source; previously damaged weekly rows require a separate, provenance-aware
historical repair.
