import fs from "node:fs";

const routePath = "app/api/public-data/route.ts";
let source = fs.readFileSync(routePath, "utf8");
let changed = false;

function replaceOnce(oldText, newText, label) {
  if (source.includes(newText)) {
    console.log(`[ai-final-snapshot-integrity] ${label}: already applied`);
    return;
  }
  if (!source.includes(oldText)) {
    throw new Error(`[ai-final-snapshot-integrity] ${label}: expected source anchor not found`);
  }
  source = source.replace(oldText, newText);
  changed = true;
  console.log(`[ai-final-snapshot-integrity] ${label}: patched`);
}

replaceOnce(
`  const finalDraftKingsGameKeys = new Set(
    draftKings.splits
      .filter(
        (split) =>
          split.snapshotStatus === "FINAL_PREGAME" &&
          (split.market === "Moneyline" || split.market === "Total"),
      )
      .map(
        (split) =>
          \`${'${isoPublicDate(split.date)}|${normalizeTeam(split.awayTeam)}|${normalizeTeam(split.homeTeam)}'}\`,
      ),
  );`,
`  const finalDraftKingsGameKeys = new Set(
    draftKings.splits
      .filter(
        (split) =>
          split.snapshotStatus === "FINAL_PREGAME" &&
          (split.market === "Moneyline" || split.market === "Total"),
      )
      // Keep the exact same date/team/start-time identity as draftKingsGameKey().
      // The old three-part key omitted first-pitch time, so a saved FINAL_PREGAME
      // market snapshot could never match the four-part slate/AI game key.
      .map((split) => draftKingsMarketInstanceKey(split)),
  );`,
  "align final DraftKings and AI game keys",
);

replaceOnce(
`    if (persistence.snapshotRowsUpdated > 0) {
      savedPublicSplits = await safeReadPublicSplitRows();
      finalSnapshotDraftKings = snapshotPayloadFromRows(
        savedPublicSplits.filter(isFifteenMinuteTrackingSnapshot),
        today,
      );
    }`,
`    if (persistence.snapshotRowsUpdated > 0) {
      // The tracking row is written before this request's original all_game_trends
      // matrix can see it. Run one Sheets-only settlement pass after the durable
      // snapshot exists so the exact FINAL_PREGAME market state is guaranteed to
      // propagate into all_game_trends in the same cron request. This never runs
      // another external AI review and non-tracking snapshots cannot overwrite an
      // existing 15-minute tracking row.
      if (trackingCapture) {
        const settlement = await persistFinalPregameDraftKings(
          draftKings,
          today,
          "scheduled",
        );
        if (settlement.status === "ERROR" && settlement.error) {
          draftKings.errors = [
            ...draftKings.errors,
            \`Final snapshot settlement: ${'${settlement.error}'}\`,
          ];
        } else {
          persistence.allGameTrendRowsUpdated = Math.max(
            persistence.allGameTrendRowsUpdated,
            settlement.allGameTrendRowsUpdated,
          );
          persistence.trackerRowsUpdated = Math.max(
            persistence.trackerRowsUpdated,
            settlement.trackerRowsUpdated,
          );
          persistence.slateRowsUpdated = Math.max(
            persistence.slateRowsUpdated,
            settlement.slateRowsUpdated,
          );
        }
      }

      savedPublicSplits = await safeReadPublicSplitRows();
      finalSnapshotDraftKings = snapshotPayloadFromRows(
        savedPublicSplits.filter(isFifteenMinuteTrackingSnapshot),
        today,
      );
    }`,
  "settle tracking snapshot into all_game_trends",
);

replaceOnce(
`  // Re-run only the free rolling Last-7 Best Play qualification gate against
  // completed/locked AI picks before their game starts. The external web
  // review remains frozen, so this never creates another OpenAI request.
  const lastSevenCorrections = storedToday
    .map((pick) =>
      aiStoredLastSevenQualificationCorrection(
        pick,
        completedTrackerRows,
        selectorNow,
      ),
    )
    .filter((pick): pick is AiPick => Boolean(pick));`,
`  // The ~15-minute FINAL_PREGAME decision is the immutable betting decision.
  // Once that snapshot/review has qualified or rejected a play, later record
  // changes must not rebuild, demote, restore, or re-grade it. At first pitch
  // the UI may change the badge/status to FINAL, but the saved decision stays
  // exactly as it was at the pregame lock.
  const lastSevenCorrections: AiPick[] = [];`,
  "freeze final-pregame AI decision against later Last-7 changes",
);

if (changed) {
  fs.writeFileSync(routePath, source);
  console.log("[ai-final-snapshot-integrity] route.ts updated");
} else {
  console.log("[ai-final-snapshot-integrity] no changes needed");
}
