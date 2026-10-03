from pathlib import Path

path = Path("lib/footballWeeklyMarket.ts")
text = path.read_text()

old_history = '''  // NCAAF updates each side directly from the movementHistory already persisted
  // on that weekly trend row. Do not rebuild one giant in-memory Saturday
  // archive here. NFL retains its existing raw-history read.
  const existingMarketHistory = sport === "NCAAF"
    ? []
    : activeMarketDates.length
      ? (await readSportWorksheetByDateKeys(sport, MARKET_HISTORY_TAB, activeMarketDates, MARKET_HISTORY_HEADERS))
          .filter((row) => String(row.Source || "").trim() === SCORES_AND_ODDS_SOURCE)
      : [];'''
new_history = '''  // Reuse compact movementHistory persisted on active NFL weekly rows instead of
  // re-reading the full raw odds_snapshot archive every five minutes. Existing
  // active rows without movementHistory trigger one raw-history seed pass; once
  // seeded, subsequent runs use only the compact per-side history. Raw snapshots
  // are still appended below exactly as before for the permanent chart archive.
  const activeNflSplitKeys = sport === "NFL"
    ? new Set(activeSourceSplits.map(splitTrendKey))
    : new Set<string>();
  const persistedNflMarketHistory: SheetRow[] = [];
  let nflNeedsRawHistorySeed = false;
  if (sport === "NFL") {
    for (const row of effectiveExistingTrends) {
      if (!activeNflSplitKeys.has(trendKey(row))) continue;
      const raw = String(row["Details JSON"] || "").trim();
      if (!raw) continue;
      try {
        const play = JSON.parse(raw) as WeeklyTrendPlay;
        if (!Array.isArray(play.movementHistory)) {
          nflNeedsRawHistorySeed = true;
          continue;
        }
        persistedNflMarketHistory.push(...persistedNcaafMarketHistoryRowsForPlay(play));
      } catch {
        nflNeedsRawHistorySeed = true;
      }
    }
  }
  const existingMarketHistory = sport === "NCAAF"
    ? []
    : sport === "NFL" && !nflNeedsRawHistorySeed
      ? persistedNflMarketHistory
      : activeMarketDates.length
        ? (await readSportWorksheetByDateKeys(sport, MARKET_HISTORY_TAB, activeMarketDates, MARKET_HISTORY_HEADERS))
            .filter((row) => String(row.Source || "").trim() === SCORES_AND_ODDS_SOURCE)
        : [];'''
if text.count(old_history) != 1:
    raise SystemExit(f"Expected one NFL raw-history block, found {text.count(old_history)}")
text = text.replace(old_history, new_history, 1)

old_missed = '''              liveCandidates.push({
                ...saved,
                week: footballWeekLabel(sport, saved.date),
                snapshotStatus: missedLock ? "MISSED_LOCK" as const : "FINAL_PREGAME" as const,
                frozenAt: missedLock ? undefined : saved.updatedAt,
                lockWarning: missedLock
                  ? `Lock capture missed — last verified ${saved.updatedAt}.`
                  : "Finalized from the last verified pregame snapshot after ScoresAndOdds stopped updating.",
              });'''
new_missed = '''              liveCandidates.push({
                ...saved,
                week: footballWeekLabel(sport, saved.date),
                movementHistory: Array.isArray(saved.movementHistory)
                  ? saved.movementHistory
                  : movementHistoryForPlay(saved, marketHistoryRows),
                snapshotStatus: missedLock ? "MISSED_LOCK" as const : "FINAL_PREGAME" as const,
                frozenAt: missedLock ? undefined : saved.updatedAt,
                lockWarning: missedLock
                  ? `Lock capture missed — last verified ${saved.updatedAt}.`
                  : "Finalized from the last verified pregame snapshot after ScoresAndOdds stopped updating.",
              });'''
if text.count(old_missed) != 1:
    raise SystemExit(f"Expected one NFL missed-lock block, found {text.count(old_missed)}")
text = text.replace(old_missed, new_missed, 1)

old_lock = '''      const freshLock = buildPlay(split, existing, history, marketHistoryRows);
      liveCandidates.push({
        ...freshLock,
        week: footballWeekLabel(sport, split.date),
        snapshotStatus: "FINAL_PREGAME" as const,
        frozenAt: freshLock.updatedAt,
        lockWarning: undefined,
      });'''
new_lock = '''      const freshLock = buildPlay(split, existing, history, marketHistoryRows);
      liveCandidates.push({
        ...freshLock,
        week: footballWeekLabel(sport, split.date),
        movementHistory: movementHistoryForPlay(freshLock, marketHistoryRows),
        snapshotStatus: "FINAL_PREGAME" as const,
        frozenAt: freshLock.updatedAt,
        lockWarning: undefined,
      });'''
if text.count(old_lock) != 1:
    raise SystemExit(f"Expected one NFL fresh-lock block, found {text.count(old_lock)}")
text = text.replace(old_lock, new_lock, 1)

old_live = '''    liveCandidates.push({ ...buildPlay(split, existing, history, marketHistoryRows), week: footballWeekLabel(sport, split.date) });'''
new_live = '''    const livePlay = buildPlay(split, existing, history, marketHistoryRows);
    liveCandidates.push({
      ...livePlay,
      week: footballWeekLabel(sport, split.date),
      movementHistory: movementHistoryForPlay(livePlay, marketHistoryRows),
    });'''
if text.count(old_live) != 1:
    raise SystemExit(f"Expected one NFL live-play block, found {text.count(old_live)}")
text = text.replace(old_live, new_live, 1)

path.write_text(text)
