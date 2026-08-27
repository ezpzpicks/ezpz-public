import fs from "node:fs";

const routePath = "app/api/public-data/route.ts";
const marker = "AI_FINAL_SNAPSHOT_SETTLEMENT_V1";
let source = fs.readFileSync(routePath, "utf8");

if (source.includes(marker)) {
  console.log("[ai-final-snapshot-integrity] settlement already applied");
  process.exit(0);
}

const oldText = `    result.slateRowsUpdated = slateUpdates.length;
    result.trackerRowsUpdated = trackerUpdates.length;
    result.allGameTrendRowsUpdated = trendUpdates.length;
    result.status =
      snapshotRecords.length || slateUpdates.length || trackerUpdates.length || trendUpdates.length
        ? "SAVED"
        : "NO_CHANGES";
    draftKingsPersistenceCache = { key: persistenceKey, savedAt: Date.now(), result };
    return result;`;

const newText = `    result.slateRowsUpdated = slateUpdates.length;
    result.trackerRowsUpdated = trackerUpdates.length;
    result.allGameTrendRowsUpdated = trendUpdates.length;

    // ${marker}: the first tracking pass writes public_split_snapshots and
    // all_game_trends from the matrix that existed at the start of the request.
    // When a new ~15-minute snapshot is created, immediately run one Sheets-only
    // scheduled settlement pass. That second pass re-reads the now-durable
    // tracking snapshot and guarantees the exact FINAL_PREGAME state is copied
    // into all_game_trends before the selector continues. It does not run a
    // separate AI/web review and cannot overwrite an existing tracking snapshot.
    if (trackingCapture && trackingGameKeys.size > 0) {
      const settlement = await persistFinalPregameDraftKings(
        livePayload,
        today,
        "scheduled",
      );
      if (settlement.status === "ERROR" && settlement.error) {
        result.error = \`Final snapshot settlement: \${settlement.error}\`;
      } else {
        result.slateRowsUpdated = Math.max(
          result.slateRowsUpdated,
          settlement.slateRowsUpdated,
        );
        result.trackerRowsUpdated = Math.max(
          result.trackerRowsUpdated,
          settlement.trackerRowsUpdated,
        );
        result.allGameTrendRowsUpdated = Math.max(
          result.allGameTrendRowsUpdated,
          settlement.allGameTrendRowsUpdated,
        );
      }
    }

    result.status = result.error
      ? "ERROR"
      : snapshotRecords.length || slateUpdates.length || trackerUpdates.length || trendUpdates.length
        ? "SAVED"
        : "NO_CHANGES";
    draftKingsPersistenceCache = { key: persistenceKey, savedAt: Date.now(), result };
    return result;`;

if (!source.includes(oldText)) {
  throw new Error(
    "[ai-final-snapshot-integrity] settlement anchor not found after prior prebuild patches",
  );
}

source = source.replace(oldText, newText);
fs.writeFileSync(routePath, source, "utf8");
console.log("[ai-final-snapshot-integrity] applied final snapshot settlement pass");
