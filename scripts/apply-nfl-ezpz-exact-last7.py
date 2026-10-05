from pathlib import Path

path = Path("app/FootballBoard.tsx")
source = path.read_text()

marker = '\nfunction trendRecordTitle(signal: DirectTrendSignal, sport: Sport, betType: DirectTrendBetType) {'
if marker not in source:
    raise SystemExit("trendRecordTitle marker not found")

helper = r'''

type NflCoreTier = "Market Move + Total Money Momentum" | "Spread Money Momentum" | "Market Move" | "";
const NFL_CORE_HISTORY_EFFECTIVE_DATE = "2026-10-05";

function nflCoreTierForPick(pick: EzpzPick): NflCoreTier {
  const tier = String(pick.tier || "").trim();
  if (tier === "Market Move + Total Money Momentum" || tier === "Spread Money Momentum" || tier === "Market Move") {
    return tier;
  }
  const key = textKey(`${pick.tier || ""} ${pick.qualification || ""}`);
  if (key.includes("market move total money momentum")) return "Market Move + Total Money Momentum";
  if (key.includes("spread money momentum")) return "Spread Money Momentum";
  if (key.includes("market move")) return "Market Move";
  return "";
}

function historicalNflCoreHasHour(row: SheetRow) {
  const openingRaw = row["Opening Snapshot Time"] || row["Opening Snapshot"] || row["First Tracked At"] || row["First Snapshot Time"];
  const currentRaw = row["Snapshot Time"] || row["Frozen At"] || row["Updated At"] || row["Last Snapshot Time"];
  const opening = Date.parse(String(openingRaw || ""));
  const current = Date.parse(String(currentRaw || ""));
  if (Number.isFinite(opening) && Number.isFinite(current)) return current - opening >= 60 * 60_000;
  // Older settled ledger rows do not always retain both timestamps. Their
  // stored opening/current movement is still used as the Weeks 1-4 seed.
  return true;
}

function historicalNflGameIdentity(row: SheetRow) {
  const date = isoDate(row.Date || row["Game Date"] || "");
  const game = textKey(rowGame(row) || row["Game Key"] || row["Game ID"] || "")
    .replace(/\b(?:at|vs)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${date}|${game}`;
}

function nflCoreTierForHistoricalRow(row: SheetRow, marketRows: SheetRow[]): NflCoreTier {
  if (!historicalNflCoreHasHour(row)) return "";
  const labels = directTrendLabels(row, marketRows, "NFL");
  const market = textKey(row.Market);
  if (market === "total" && labels.includes("Market Move") && labels.includes("Money Momentum")) {
    return "Market Move + Total Money Momentum";
  }
  if (market === "spread" && labels.includes("Money Momentum")) return "Spread Money Momentum";
  if (market === "total" && labels.includes("Market Move")) return "Market Move";
  return "";
}

function nflCoreTierPriority(tier: NflCoreTier) {
  if (tier === "Market Move + Total Money Momentum") return 1;
  if (tier === "Spread Money Momentum") return 2;
  if (tier === "Market Move") return 3;
  return 99;
}

function nflCoreHistoricalSelections(rows: SheetRow[], beforeDate: string): EzpzPick[] {
  const byGame = new Map<string, SheetRow[]>();
  for (const row of rows || []) {
    const date = isoDate(row.Date || row["Game Date"] || "");
    if (!date || date >= NFL_CORE_HISTORY_EFFECTIVE_DATE || (beforeDate && date >= beforeDate)) continue;
    if (!resultCode(row.Result || row.Status)) continue;
    const key = historicalNflGameIdentity(row);
    const group = byGame.get(key) || [];
    group.push(row);
    byGame.set(key, group);
  }

  const selected: EzpzPick[] = [];
  byGame.forEach((gameRows) => {
    const byMarket = new Map<string, SheetRow[]>();
    gameRows.forEach((row) => {
      const market = textKey(row.Market);
      if (market !== "spread" && market !== "total") return;
      const group = byMarket.get(market) || [];
      group.push(row);
      byMarket.set(market, group);
    });

    const candidates: Array<{ row: SheetRow; tier: NflCoreTier; marketRows: SheetRow[] }> = [];
    byMarket.forEach((marketRows) => {
      const uniqueSides = new Map<string, SheetRow>();
      marketRows.forEach((row) => {
        const sideKey = historicalTrendSelectionKey(row);
        if (sideKey && !uniqueSides.has(sideKey)) uniqueSides.set(sideKey, row);
      });
      const sides = [...uniqueSides.values()];
      sides.forEach((row) => {
        const tier = nflCoreTierForHistoricalRow(row, sides);
        if (tier) candidates.push({ row, tier, marketRows: sides });
      });
    });

    candidates.sort((a, b) =>
      nflCoreTierPriority(a.tier) - nflCoreTierPriority(b.tier) ||
      textKey(a.row.Market).localeCompare(textKey(b.row.Market)) ||
      historicalTrendSelectionKey(a.row).localeCompare(historicalTrendSelectionKey(b.row)),
    );
    const chosen = candidates[0];
    if (!chosen) return;

    const chosenSide = historicalTrendSelectionKey(chosen.row);
    const contradicted = chosen.marketRows.some((candidate) =>
      historicalTrendSelectionKey(candidate) !== chosenSide &&
      directTrendLabels(candidate, chosen.marketRows, "NFL").length > 0
    );
    if (contradicted) return;

    const date = isoDate(chosen.row.Date || chosen.row["Game Date"] || "");
    const market = textKey(chosen.row.Market) === "total" ? "Total" : "Spread";
    const line = String(chosen.row["Public Split Line"] || chosen.row.Line || "").trim();
    const selectionBase = market === "Total"
      ? String(chosen.row.Side || chosen.row.Selection || chosen.row["Public Split Selection"] || "").trim()
      : String(chosen.row["Public Split Selection"] || chosen.row.Selection || "").trim();
    selected.push({
      date,
      source: "Trend Play",
      game: rowGame(chosen.row),
      market,
      selection: [selectionBase, line].filter(Boolean).join(" "),
      odds: displayOdds(chosen.row["Public Split Odds"] || chosen.row.Odds || "-110"),
      tier: chosen.tier,
      qualification: chosen.tier,
      result: resultCode(chosen.row.Result || chosen.row.Status),
      snapshotStatus: "FINAL_PREGAME",
    });
  });
  return selected;
}

function nflCoreExactLastSevenRecord(data: FootballData, pick: EzpzPick, beforeDate: string) {
  const tier = nflCoreTierForPick(pick);
  if (!tier) return { record: "0-0", totalBets: 0, units: 0, roi: 0 };

  const combined = new Map<string, EzpzPick>();
  for (const historical of nflCoreHistoricalSelections(data.trendRecordRows || [], beforeDate)) {
    if (nflCoreTierForPick(historical) !== tier) continue;
    combined.set(pickIdentity(historical), historical);
  }
  for (const historical of data.aiPickRecordRows || []) {
    const date = isoDate(historical.date);
    if (!date || date < NFL_CORE_HISTORY_EFFECTIVE_DATE || (beforeDate && date >= beforeDate)) continue;
    if (!resultCode(historical.result) || nflCoreTierForPick(historical) !== tier) continue;
    combined.set(pickIdentity(historical), historical);
  }

  const recent = [...combined.values()]
    .sort((a, b) =>
      isoDate(b.date).localeCompare(isoDate(a.date)) ||
      String(b.resultUpdated || "").localeCompare(String(a.resultUpdated || "")) ||
      String(b.game || "").localeCompare(String(a.game || "")),
    )
    .slice(0, 7);

  let wins = 0, losses = 0, pushes = 0, units = 0;
  recent.forEach((historical) => {
    const result = resultCode(historical.result);
    const odds = americanOdds(historical.odds) ?? -110;
    if (result === "W") {
      wins += 1;
      units += odds > 0 ? odds / 100 : 100 / Math.abs(odds);
    } else if (result === "L") {
      losses += 1;
      units -= 1;
    } else if (result === "P") pushes += 1;
  });
  const totalBets = wins + losses + pushes;
  return {
    record: pushes ? `${wins}-${losses}-${pushes}` : `${wins}-${losses}`,
    totalBets,
    units: Math.round(units * 100) / 100,
    roi: totalBets ? Math.round((units / totalBets) * 1000) / 10 : 0,
  };
}
'''

source = source.replace(marker, helper + marker, 1)

old = '''  if (!isProp && primaryTrend) {\n    const trendRecord = directTrendRecord(\n      data.trendRecordRows || [],\n      sport,\n      primaryTrend,\n      directBetType,\n      isoDate(pick.date) || isoDate(data.today),\n    );\n    return ('''
new = '''  if (!isProp && primaryTrend) {\n    const exactCoreTier = sport === "NFL" ? nflCoreTierForPick(pick) : "";\n    const trendRecord = exactCoreTier\n      ? nflCoreExactLastSevenRecord(data, pick, isoDate(pick.date) || isoDate(data.today))\n      : directTrendRecord(\n          data.trendRecordRows || [],\n          sport,\n          primaryTrend,\n          directBetType,\n          isoDate(pick.date) || isoDate(data.today),\n        );\n    const trendRecordLabel = exactCoreTier\n      ? `${exactCoreTier} Exact EZPZ Record`\n      : trendRecordTitle(primaryTrend, sport, directBetType);\n    return ('''
if old not in source:
    raise SystemExit("HistoryPickCard trendRecord block not found")
source = source.replace(old, new, 1)

old_label = '<span className="footballHistoryTrendRecordLabel">{trendRecordTitle(primaryTrend, sport, directBetType)} • Last 7</span>'
new_label = '<span className="footballHistoryTrendRecordLabel">{trendRecordLabel} • Last 7</span>'
if old_label not in source:
    raise SystemExit("trend record label not found")
source = source.replace(old_label, new_label, 1)

path.write_text(source)
