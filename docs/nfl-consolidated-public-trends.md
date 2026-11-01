# NFL consolidated public-split types

The active public catalog has 96 types, replacing 1,058 original named directions
and their incidental filter variants in the public ranking. The original catalog
and frozen membership ledger remain the source evidence; they are not deleted or
reclassified in storage. NCAAF, NBA and NCAAM retain their own definitions.

`lib/catalog/nflConsolidatedCatalog.ts` defines the fixed groups. Related threshold
and movement-size variants become a union of original memberships. Each game,
market and physical selection contributes once to each group, including when a
game or team has multiple source aliases. Total directions remain separate;
line-support favorites and underdogs remain separate. Ticket percentage,
money-ticket gap and opening-to-final money growth are distinct families.

## Ranking and matching

- At most 20 public types.
- At least 8 wins/losses; pushes do not meet that minimum.
- Win percentage strictly greater than 60%.
- Unrounded one-unit-risk ROI at least 10%, at the observed saved odds.
- Order by the existing one-sided 95% Wilson lower bound, then ROI and stable ID.
- Identical historical selection sets occupy one slot, not several.
- A shorter qualifying list is not padded with weaker or duplicate types.
- A play matching multiple groups still earns one Public Trend signal.

Public records, badges and live Signals preserve the same NFL ranked order.
The group definitions do not use retrospective day-of-week, source, quote-shape
or price facets to create many small versions of the same record.

## Combo research and captured decisions

The new policy is `football-signals-nfl-grouped-2026-11-01-v2`.
Previously captured official signals, picks, prices, lines and combo scores keep
their original rule version. Settlement updates preserve that version.

A read-only research replay changes only the Public Trend vote. It requires the
same frozen game/selection, line, observed price and snapshot time (within one
minute). Missing original evidence is excluded; current models and team scores
cannot manufacture missing historical votes. Group rankings at each replayed
snapshot use only results settled before that timestamp and exclude that game.

Reclassified observations carry `researchOrigin: replay` and enter the historical
phase, including observations after the old tracking boundary. They are never
presented as newly captured forward results. The new side-specific combo history
is used for new policy previews/captures; the original research remains available
for legacy captured tiles. A combo record from another policy cannot silently
substitute for a missing record. Official selector thresholds are not changed.

## Operations and validation

The existing collector publishes the grouped catalog and combo research in the
saved public board. Public reads retain the saved-board path, without another
poller, full-season DB scan per visitor or cadence change.

Read-only preview, using saved JSON and optional original signal archives:

```sh
node scripts/preview-nfl-consolidation.cjs BOARD_JSON SIGNAL_ARCHIVE_JSON ...
```

This emits all 96 definitions, observed records, ranked types, original/proposed
side-specific combo cells and replay coverage. The proposed definitions were
chosen after inspecting the season; reconstructed results remain exploratory
historical research, not an untouched prospective test.
