from pathlib import Path


def replace_once(path: Path, old: str, new: str, label: str):
    text = path.read_text()
    if new in text:
        print(f"{label}: already applied")
        return False
    if old not in text:
        raise SystemExit(f"Could not find patch target: {label}")
    path.write_text(text.replace(old, new, 1))
    print(f"{label}: applied")
    return True


board = Path("app/FootballBoard.tsx")

replace_once(
    board,
    'type FbRecordType = "Favorite Spread" | "Underdog Spread" | "Over" | "Under";\n',
    'type FbRecordType = "Spread" | "Total" | "Favorite Spread" | "Underdog Spread" | "Over" | "Under";\n',
    "Allow broad NFL record buckets",
)

replace_once(
    board,
    'const FB_RECORD_TYPES: FbRecordType[] = ["Favorite Spread", "Underdog Spread", "Over", "Under"];\n',
    'const FB_CFB_RECORD_TYPES: FbRecordType[] = ["Favorite Spread", "Underdog Spread", "Over", "Under"];\nconst FB_NFL_RECORD_TYPES: FbRecordType[] = ["Spread", "Total"];\n\nfunction fbRecordTypes(sport: Sport) {\n  return sport === "NCAAF" ? FB_CFB_RECORD_TYPES : FB_NFL_RECORD_TYPES;\n}\n',
    "Separate CFB and NFL record bucket lists",
)

replace_once(
    board,
    '''function fbTrackerRecordType(row: SheetRow): FbRecordType | null {
  const marketKey = textKey(row["Bet Type"] || row.Market);
  if (marketKey.includes("total")) return fbRecordTypeForSelection("Total", row.Selection, fbTrailingLine(row.Selection));
  if (marketKey.includes("spread")) return fbRecordTypeForSelection("Spread", row.Selection, fbTrailingLine(row.Selection));
  return null;
}
''',
    '''function fbTrackerRecordType(row: SheetRow, sport: Sport): FbRecordType | null {
  const marketKey = textKey(row["Bet Type"] || row.Market);
  if (sport === "NFL") return marketKey.includes("total") ? "Total" : marketKey.includes("spread") ? "Spread" : null;
  if (marketKey.includes("total")) return fbRecordTypeForSelection("Total", row.Selection, fbTrailingLine(row.Selection));
  if (marketKey.includes("spread")) return fbRecordTypeForSelection("Spread", row.Selection, fbTrailingLine(row.Selection));
  return null;
}
''',
    "Keep NFL tracker records broad while splitting CFB",
)

replace_once(
    board,
    '''function fbBestPlayRecordType(play: Play, split?: DraftKingsSplit): FbRecordType | null {
  const market: "Spread" | "Total" = textKey(play.role || play.playType).includes("total") ? "Total" : "Spread";
  if (market === "Total") return fbRecordTypeForSelection(market, split?.side || play.play, split?.line ?? fbTrailingLine(play.play));
  return fbRecordTypeForSelection(market, play.play, split?.line ?? fbTrailingLine(play.play));
}
''',
    '''function fbBestPlayRecordType(play: Play, split: DraftKingsSplit | undefined, sport: Sport): FbRecordType | null {
  const market: "Spread" | "Total" = textKey(play.role || play.playType).includes("total") ? "Total" : "Spread";
  if (sport === "NFL") return market;
  if (market === "Total") return fbRecordTypeForSelection(market, split?.side || play.play, split?.line ?? fbTrailingLine(play.play));
  return fbRecordTypeForSelection(market, play.play, split?.line ?? fbTrailingLine(play.play));
}
''',
    "Make model-play record bucket sport aware",
)

replace_once(
    board,
    '''function fbEzpzRecordType(pick: EzpzPick, splits: DraftKingsSplit[]): FbRecordType | null {
  const split = fbPickSplit(pick, splits);
  return fbRecordTypeForSelection(pick.market, pick.market === "Total" ? split?.side || pick.selection : pick.selection, split?.line ?? fbTrailingLine(pick.selection));
}
''',
    '''function fbEzpzRecordType(pick: EzpzPick, splits: DraftKingsSplit[], sport: Sport): FbRecordType | null {
  if (sport === "NFL") return pick.market;
  const split = fbPickSplit(pick, splits);
  return fbRecordTypeForSelection(pick.market, pick.market === "Total" ? split?.side || pick.selection : pick.selection, split?.line ?? fbTrailingLine(pick.selection));
}
''',
    "Make EZPZ record bucket sport aware",
)

replace_once(
    board,
    '''function fbTodayRecordMap(rows: SheetRow[], today: string) {
  return new Map<string, Summary>(FB_RECORD_TYPES.map((betType) => {
    const matching = rows.filter((row) => fbResult(row.Result || row.Status) && fbDate(row.Date) === today && fbTrackerRecordType(row) === betType);
    return [betType, fbSummary(betType, fbTotals(matching, today))];
  }));
}

function fbLastSevenBetsRecordMap(rows: SheetRow[], today: string) {
  return new Map<string, Summary>(FB_RECORD_TYPES.map((betType) => {
    const matching = rows
      .map((row, index) => ({ row, index, stamp: Date.parse(`${fbDate(row.Date)}T12:00:00Z`) || 0 }))
      .filter(({ row }) => fbResult(row.Result || row.Status) && fbTrackerRecordType(row) === betType)
      .sort((a, b) => b.stamp - a.stamp || b.index - a.index)
      .slice(0, 7)
      .map(({ row }) => row);
    return [betType, fbSummary(betType, fbTotals(matching, today))];
  }));
}
''',
    '''function fbTodayRecordMap(rows: SheetRow[], today: string, sport: Sport) {
  return new Map<string, Summary>(fbRecordTypes(sport).map((betType) => {
    const matching = rows.filter((row) => fbResult(row.Result || row.Status) && fbDate(row.Date) === today && fbTrackerRecordType(row, sport) === betType);
    return [betType, fbSummary(betType, fbTotals(matching, today))];
  }));
}

function fbLastSevenBetsRecordMap(rows: SheetRow[], today: string, sport: Sport) {
  return new Map<string, Summary>(fbRecordTypes(sport).map((betType) => {
    const matching = rows
      .map((row, index) => ({ row, index, stamp: Date.parse(`${fbDate(row.Date)}T12:00:00Z`) || 0 }))
      .filter(({ row }) => fbResult(row.Result || row.Status) && fbTrackerRecordType(row, sport) === betType)
      .sort((a, b) => b.stamp - a.stamp || b.index - a.index)
      .slice(0, 7)
      .map(({ row }) => row);
    return [betType, fbSummary(betType, fbTotals(matching, today))];
  }));
}
''',
    "Build form records with sport-specific buckets",
)

replace_once(
    board,
    'function BestPlayCard({ play, splits, index, recentByType, lastSevenBetsByType }: { play: Play; splits: DraftKingsSplit[]; index: number; recentByType: Map<string, Summary>; lastSevenBetsByType: Map<string, Summary> }) {\n',
    'function BestPlayCard({ play, splits, index, sport, recentByType, lastSevenBetsByType }: { play: Play; splits: DraftKingsSplit[]; index: number; sport: Sport; recentByType: Map<string, Summary>; lastSevenBetsByType: Map<string, Summary> }) {\n',
    "Pass sport into model-play tile",
)

replace_once(
    board,
    '  const recordType = fbBestPlayRecordType(play, split);\n',
    '  const recordType = fbBestPlayRecordType(play, split, sport);\n',
    "Use sport-aware model-play bucket",
)

replace_once(
    board,
    '  overallByType,\n}: {\n  pick: EzpzPick;\n',
    '  overallByType,\n  sport,\n}: {\n  pick: EzpzPick;\n',
    "Accept sport in EZPZ tile props",
)

replace_once(
    board,
    '  overallByType: Map<string, Summary>;\n}) {\n  const trendPlay = pick.source === "Trend Play" ? fbTrendPlayForPick(pick, trendPlays) : null;\n',
    '  overallByType: Map<string, Summary>;\n  sport: Sport;\n}) {\n  const trendPlay = pick.source !== "Best Play" ? fbTrendPlayForPick(pick, trendPlays) : null;\n',
    "Show trend evidence for Best + Trend picks",
)

replace_once(
    board,
    '  const recordType = pick.source !== "Trend Play" ? fbEzpzRecordType(pick, splits) : null;\n',
    '  const recordType = pick.source !== "Trend Play" ? fbEzpzRecordType(pick, splits, sport) : null;\n',
    "Use sport-aware EZPZ bucket",
)

replace_once(
    board,
    '  const todayByType = fbTodayRecordMap(trackerRows, data.today);\n  const lastSevenBetsByType = fbLastSevenBetsRecordMap(trackerRows, data.today);\n',
    '  const todayByType = fbTodayRecordMap(trackerRows, data.today, sport);\n  const lastSevenBetsByType = fbLastSevenBetsRecordMap(trackerRows, data.today, sport);\n',
    "Create sport-aware record maps",
)

replace_once(
    board,
    'play={play} splits={splits} index={index} recentByType={last7Map}',
    'play={play} splits={splits} index={index} sport={sport} recentByType={last7Map}',
    "Pass sport to Model Play cards",
)

replace_once(
    board,
    'overallByType={summaryMap} />',
    'overallByType={summaryMap} sport={sport} />',
    "Pass sport to EZPZ cards",
)

print("Football tile scoping fixed; Best + Trend now shows both evidence sections.")
