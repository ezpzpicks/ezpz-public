import fs from "node:fs";

const path = "app/api/public-data/route.ts";
let text = fs.readFileSync(path, "utf8");
const original = text;

// Historical Trend Play records need more than the all_game_trends rows. Before
// that sheet became the authoritative frozen archive, the AI selector persisted
// each Trend Play's original FINAL_PREGAME tier, score, price, and result. Use
// those archived rows only as a gap-filler; authoritative all_game_trends/source
// rows always win when the same logical play exists in both places.
const helperMarker = "function buildTrendRecordRows(\n";
const helperBlock = `function buildAiHistoricalTrendRecordRows(
  rows: SheetRow[],
): TrendRecordResult[] {
  const archivedTier = (value: unknown): "Good" | "Strong" | "Elite" | null => {
    const key = textKey(value);
    if (key.includes("elite")) return "Elite";
    if (key.includes("strong")) return "Strong";
    if (key.includes("good")) return "Good";
    return null;
  };

  const logicalKey = (record: TrendRecordResult) => {
    const selectionKey =
      record.market === "Total"
        ? textKey(record.selection).includes("under")
          ? "under"
          : textKey(record.selection).includes("over")
            ? "over"
            : textKey(record.selection)
        : textKey(teamFromSelection(record.selection));
    const gameIdentity = [
      isoPublicDate(record.date),
      textKey(record.game),
      textKey(record.gameTime || record.gameKey),
    ].join("|");
    return [gameIdentity, record.market, selectionKey].join("|");
  };

  const byKey = new Map<string, TrendRecordResult>();
  for (const row of rows) {
    const source = String(row.Source || "").trim();
    if (source !== "Trend Play" && source !== "Best + Trend") continue;
    if (String(row["Snapshot Status"] || "").trim().toUpperCase() !== "FINAL_PREGAME") continue;

    const marketValue = String(row.Market || "").trim();
    if (marketValue !== "Moneyline" && marketValue !== "Total") continue;
    const market = marketValue as "Moneyline" | "Total";
    const result = resultCode(row.Result);
    if (!result) continue;

    const frozenTier = archivedTier(row["Trend Tier"]);
    if (!frozenTier) continue;
    const scoreValue = Number(row["Trend Score"]);
    const frozenScore = Number.isFinite(scoreValue) ? scoreValue : 0;
    const date = isoPublicDate(row.Date || "");
    if (!date) continue;

    const rawSelection = String(row.Selection || row.Play || "").trim();
    const side =
      market === "Total"
        ? textKey(rawSelection).includes("under")
          ? "Under"
          : textKey(rawSelection).includes("over")
            ? "Over"
            : textKey(row.Play).includes("under")
              ? "Under"
              : textKey(row.Play).includes("over")
                ? "Over"
                : ""
        : "";
    if (market === "Total" && !side) continue;

    const game = String(row.Game || "").trim();
    const gameKey = String(row["Game Key"] || "").trim().replace(/\\.0$/, "");
    const gameTime = String(row["Game Time"] || "").trim();
    const awayTeam = String(row["Away Team"] || "").trim();
    const homeTeam = String(row["Home Team"] || "").trim();
    const line = market === "Total" ? numericLine(row.Line || row.Play || "") : null;
    const odds = parseAmericanOdds(row.Odds);
    const savedUnits = Number(row.Units);
    const calculatedUnits =
      result === "P"
        ? 0
        : result === "L"
          ? -1
          : odds > 0
            ? odds / 100
            : odds < 0
              ? 100 / Math.abs(odds)
              : 1;
    const units = Number.isFinite(savedUnits) && (result === "P" || Math.abs(savedUnits) > 0.000001)
      ? savedUnits
      : calculatedUnits;
    const frozenAt = String(
      row["Locked At"] || row["Updated At"] || row["Result Updated"] || "",
    ).trim();
    const selection =
      market === "Total"
        ? String(row.Play || (side + " " + String(row.Line || ""))).trim()
        : rawSelection;
    if (!selection) continue;

    const sideGroup: TrendPlay["sideGroup"] =
      market === "Total"
        ? side
        : odds < 0
          ? "Favorite"
          : odds > 0
            ? "Underdog"
            : "";
    const archivedPlay: TrendPlay = {
      game,
      awayTeam,
      homeTeam,
      market,
      selection,
      selectionTeam: market === "Moneyline" ? teamFromSelection(rawSelection) : "",
      side,
      sideGroup,
      line,
      odds: String(row.Odds || ""),
      betsPct: 0,
      moneyPct: 0,
      gapPct: 0,
      score: frozenScore,
      tier: frozenTier,
      signals: [],
      updatedAt: frozenAt,
      frozenAt,
      snapshotStatus: "FINAL_PREGAME",
      gradingVersion: FROZEN_TREND_GRADING_VERSION,
      recordDate: date,
      recordGameKey: gameKey,
      recordGameTime: gameTime,
    };

    const candidate: TrendRecordResult = {
      date,
      game,
      gameKey,
      gameTime,
      market,
      selection,
      result,
      odds,
      units,
      frozenTier,
      frozenScore,
      frozenAt,
      snapshotStatus: "FINAL_PREGAME",
      trendScoreDetails: JSON.stringify(archivedPlay),
      recoveredFromSavedPregameSnapshot: true,
      recoveryNote: "ai_pick_selector FINAL_PREGAME archive",
    };

    const key = logicalKey(candidate);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, candidate);
      continue;
    }
    const candidateTime = Date.parse(candidate.frozenAt || "");
    const existingTime = Date.parse(existing.frozenAt || "");
    if (
      (Number.isFinite(candidateTime) ? candidateTime : 0) >=
      (Number.isFinite(existingTime) ? existingTime : 0)
    ) {
      byKey.set(key, candidate);
    }
  }

  return [...byKey.values()];
}

function mergeTrendRecordRows(
  primaryRows: TrendRecordResult[],
  archivedRows: TrendRecordResult[],
): TrendRecordResult[] {
  const logicalKey = (record: TrendRecordResult) => {
    const selectionKey =
      record.market === "Total"
        ? textKey(record.selection).includes("under")
          ? "under"
          : textKey(record.selection).includes("over")
            ? "over"
            : textKey(record.selection)
        : textKey(teamFromSelection(record.selection));
    const gameIdentity = [
      isoPublicDate(record.date),
      textKey(record.game),
      textKey(record.gameTime || record.gameKey),
    ].join("|");
    return [gameIdentity, record.market, selectionKey].join("|");
  };

  const merged = new Map<string, TrendRecordResult>();
  for (const row of archivedRows) merged.set(logicalKey(row), row);
  // The official frozen all_game_trends/current source is authoritative on any
  // overlap. AI history only fills dates/plays that predate that archive.
  for (const row of primaryRows) merged.set(logicalKey(row), row);
  return [...merged.values()];
}

`;

if (!text.includes("function buildAiHistoricalTrendRecordRows(")) {
  if (!text.includes(helperMarker)) {
    throw new Error("Trend record builder marker not found for AI history recovery");
  }
  text = text.replace(helperMarker, helperBlock + helperMarker);
}

const oldCall = `    const trendRecordRows = buildTrendRecordRows(\n      completedAllGameTrendRows,\n      authoritativeFrozenTrendPlays,\n      slateTodayRaw as SheetRow[],\n      savedPublicSplits,\n    );`;
const historicalSourceCall = `    const trendRecordRows = buildTrendRecordRows(\n      trendSourceRows,\n      authoritativeFrozenTrendPlays,\n      slateTodayRaw as SheetRow[],\n      savedPublicSplits,\n    );`;
const mergedCall = `    const primaryTrendRecordRows = buildTrendRecordRows(\n      trendSourceRows,\n      authoritativeFrozenTrendPlays,\n      slateTodayRaw as SheetRow[],\n      savedPublicSplits,\n    );\n    const trendRecordRows = mergeTrendRecordRows(\n      primaryTrendRecordRows,\n      buildAiHistoricalTrendRecordRows(storedAiPickRows),\n    );`;

if (text.includes(oldCall)) {
  text = text.replace(oldCall, mergedCall);
} else if (text.includes(historicalSourceCall)) {
  text = text.replace(historicalSourceCall, mergedCall);
} else if (!text.includes(mergedCall)) {
  throw new Error("Trend record source call not found for archived AI history recovery");
}

if (text !== original) {
  fs.writeFileSync(path, text, "utf8");
  console.log("Trend Records now merge authoritative history with archived FINAL_PREGAME AI Trend Plays.");
} else {
  console.log("Trend Records already merge authoritative history with archived FINAL_PREGAME AI Trend Plays.");
}
