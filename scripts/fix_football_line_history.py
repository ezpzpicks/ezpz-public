from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str):
    if new in text:
        print(f"{label}: already applied")
        return text
    if old not in text:
        raise SystemExit(f"Could not find patch target: {label}")
    print(f"{label}: applied")
    return text.replace(old, new, 1)


# 1) Add an append helper so market history is never rewritten/upserted.
path = Path("lib/sportSheets.ts")
text = path.read_text()
marker = 'export function sportDatabaseLabel(sport: FootballSport) {'
append_helper = '''export async function appendSportRows(
  sport: FootballSport,
  worksheetName: string,
  headers: string[],
  rows: SheetRow[],
) {
  if (!rows.length) return;
  await ensureSportWorksheet(sport, worksheetName, headers);
  const spreadsheetId = await resolveSportSpreadsheetId(sport);
  const sheets = await sheetsClient();
  const physicalName = physicalWorksheetName(sport, worksheetName);
  const values = rows.map((row) => headers.map((header) => String(row[header] ?? "")));
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${quoteSheetName(physicalName)}!A1`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });
  invalidateSportWorksheetReadCache(sport, worksheetName);
}

'''
if append_helper not in text:
    if marker not in text:
        raise SystemExit("Could not find sportSheets append insertion point")
    text = text.replace(marker, append_helper + marker, 1)
path.write_text(text)


# 2) Persist every changed football market state and derive movement from the full path.
path = Path("lib/footballWeeklyMarket.ts")
text = path.read_text()

text = replace_once(
    text,
    '  type SheetRow,\n  ensureSportWorksheet,\n  readSportWorksheet,\n  upsertSportRows,',
    '  type SheetRow,\n  appendSportRows,\n  ensureSportWorksheet,\n  readSportWorksheet,\n  upsertSportRows,',
    "appendSportRows import",
)

text = replace_once(
    text,
    'const POSTED_GAMES_TAB = "posted_games";\nconst WEEKLY_TRENDS_TAB = "weekly_market_trends";',
    'const POSTED_GAMES_TAB = "posted_games";\nconst WEEKLY_TRENDS_TAB = "weekly_market_trends";\nconst MARKET_HISTORY_TAB = "odds_snapshot";',
    "market history tab constant",
)

headers_marker = 'type Split = {'
history_headers = '''export const MARKET_HISTORY_HEADERS = [
  "Snapshot Time ET", "Date", "Week", "Game Key", "Game Time", "Game",
  "Away Team", "Home Team", "Market", "Selection", "Side", "Line", "Odds",
  "Bets %", "Handle %", "Public Gap %", "Warning", "Source", "Source URL",
  "State Signature",
];

'''
if history_headers not in text:
    if headers_marker not in text:
        raise SystemExit("Could not find market history headers insertion point")
    text = text.replace(headers_marker, history_headers + headers_marker, 1)

text = replace_once(
    text,
    '  lineMovementSignal?: string;\n  score: number;',
    '  lineMovementSignal?: string;\n  firstTrackedAt?: string;\n  lowLine?: number | null;\n  highLine?: number | null;\n  lineMoveCount?: number;\n  lastLineMoveAt?: string;\n  lineHistoryLabel?: string;\n  score: number;',
    "trend play market history fields",
)

helper_marker = 'function resultCode(value: unknown): ResultCode | "" {'
history_helpers = '''function marketHistoryLogicalKey(row: SheetRow) {
  const market = String(row.Market || "");
  const selection = market === "Total" ? String(row.Side || row.Selection || "") : String(row.Selection || "");
  return `${String(row["Game Key"] || "")}|${textKey(market)}|${textKey(selection)}`;
}

function normalizedStateNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? String(Math.round(number * 10) / 10) : "";
}

function marketHistoryStateSignatureValues(line: number | null, odds: unknown, betsPct: unknown, handlePct: unknown) {
  return [
    line == null ? "" : normalizedStateNumber(line),
    String(odds || "").replace(/−/g, "-").trim(),
    normalizedStateNumber(betsPct),
    normalizedStateNumber(handlePct),
  ].join("|");
}

function marketHistoryStateSignature(row: SheetRow) {
  return String(row["State Signature"] || "").trim() || marketHistoryStateSignatureValues(
    numericLine(row.Line), row.Odds, row["Bets %"], row["Handle %"],
  );
}

function marketHistoryRowForSplit(split: Split, sport: FootballSport, canonicalRows: SheetRow[], snapshotTime: string): SheetRow {
  const selection = split.market === "Total" ? split.side : split.selectionTeam;
  return {
    "Snapshot Time ET": snapshotTime,
    Date: split.date,
    Week: storedFootballWeek(sport, split, canonicalRows),
    "Game Key": gameKey(split),
    "Game Time": split.eventTime,
    Game: split.game,
    "Away Team": split.awayTeam,
    "Home Team": split.homeTeam,
    Market: split.market,
    Selection: selection,
    Side: split.side,
    Line: split.line == null ? "" : String(split.line),
    Odds: split.odds,
    "Bets %": String(split.betsPct),
    "Handle %": String(split.moneyPct),
    "Public Gap %": String(split.gapPct),
    Warning: split.warning,
    Source: "DraftKings",
    "Source URL": DK_URL,
    "State Signature": marketHistoryStateSignatureValues(split.line, split.odds, split.betsPct, split.moneyPct),
  };
}

function marketHistorySeedRow(row: SheetRow, snapshotTime: string): SheetRow | null {
  const market = String(row.Market || "");
  if (market !== "Spread" && market !== "Total") return null;
  const line = numericLine(row["Opening Line"] || row.Line);
  const odds = String(row["Opening Odds"] || row.Odds || "").replace(/−/g, "-");
  const betsPct = Number(row["Opening Bets %"]);
  const handlePct = Number(row["Opening Handle %"]);
  const gap = Number.isFinite(betsPct) && Number.isFinite(handlePct)
    ? Math.round((handlePct - betsPct) * 10) / 10
    : Number(row["Public Gap %"] || 0);
  return {
    "Snapshot Time ET": snapshotTime,
    Date: String(row.Date || ""),
    Week: String(row.Week || ""),
    "Game Key": String(row["Game Key"] || ""),
    "Game Time": String(row["Game Time"] || ""),
    Game: String(row.Game || ""),
    "Away Team": String(row["Away Team"] || ""),
    "Home Team": String(row["Home Team"] || ""),
    Market: market,
    Selection: String(row.Selection || ""),
    Side: String(row.Side || ""),
    Line: line == null ? "" : String(line),
    Odds: odds,
    "Bets %": Number.isFinite(betsPct) ? String(betsPct) : "",
    "Handle %": Number.isFinite(handlePct) ? String(handlePct) : "",
    "Public Gap %": Number.isFinite(gap) ? String(gap) : "",
    Warning: String(row.Warning || ""),
    Source: "DraftKings",
    "Source URL": DK_URL,
    "State Signature": marketHistoryStateSignatureValues(line, odds, betsPct, handlePct),
  };
}

function historyLineLabel(market: WeeklyFootballMarket, line: number) {
  const value = Math.round(line * 10) / 10;
  return market === "Spread" && value > 0 ? `+${value}` : String(value);
}

function marketHistorySummary(split: Split, rows: SheetRow[]) {
  const key = splitTrendKey(split);
  const states = rows.filter((row) => marketHistoryLogicalKey(row) === key);
  if (!states.length) return null;
  const first = states[0];
  const linePath: number[] = [];
  let previousLine: number | null = null;
  let lineMoveCount = 0;
  let lastLineMoveDelta: number | null = null;
  let lastLineMoveAt = "";
  for (const row of states) {
    const line = numericLine(row.Line);
    if (line == null) continue;
    if (previousLine == null) {
      linePath.push(line);
    } else if (Math.abs(line - previousLine) >= 0.001) {
      lineMoveCount += 1;
      lastLineMoveDelta = Math.round((line - previousLine) * 10) / 10;
      lastLineMoveAt = String(row["Snapshot Time ET"] || "");
      linePath.push(line);
    }
    previousLine = line;
  }
  const visiblePath = linePath.length <= 8 ? linePath : [linePath[0], ...linePath.slice(-7)];
  const openingBetsPct = Number(first["Bets %"]);
  const openingMoneyPct = Number(first["Handle %"]);
  const numericLines = linePath.filter(Number.isFinite);
  return {
    firstTrackedAt: String(first["Snapshot Time ET"] || ""),
    openingLine: numericLine(first.Line),
    openingOdds: String(first.Odds || ""),
    openingBetsPct: Number.isFinite(openingBetsPct) ? openingBetsPct : split.betsPct,
    openingMoneyPct: Number.isFinite(openingMoneyPct) ? openingMoneyPct : split.moneyPct,
    lowLine: numericLines.length ? Math.min(...numericLines) : null,
    highLine: numericLines.length ? Math.max(...numericLines) : null,
    lineMoveCount,
    lastLineMoveDelta,
    lastLineMoveAt,
    lineHistoryLabel: visiblePath.map((line) => historyLineLabel(split.market, line)).join(" → "),
  };
}

'''
if history_helpers not in text:
    if helper_marker not in text:
        raise SystemExit("Could not find market history helper insertion point")
    text = text.replace(helper_marker, history_helpers + helper_marker, 1)

# A line value is mutable state, never a market-side identity.
text = replace_once(
    text,
    '  for (const row of rows) map.set(`${row.date}|${textKey(row.game)}|${row.market}|${textKey(row.selection)}`, row);',
    '  for (const row of rows) map.set(`${row.date}|${textKey(row.game)}|${row.market}|${textKey(row.market === "Total" ? row.side : row.selectionTeam)}`, row);',
    "stable parsed split identity",
)
text = replace_once(
    text,
    '              const key = `${split.date}|${textKey(split.game)}|${split.market}|${textKey(split.selection)}`;\n              map.set(key, split);',
    '              const key = splitTrendKey(split);\n              map.set(key, split);',
    "stable discovered split identity",
)

movement_start_marker = 'function movement(split: Split, existing: SheetRow | undefined) {'
if movement_start_marker in text:
    movement_start = text.index(movement_start_marker)
    movement_end = text.index('\nfunction buildPlay(', movement_start)
    movement_new = '''function movement(split: Split, existing: SheetRow | undefined, marketRows: SheetRow[]) {
  const summary = marketHistorySummary(split, marketRows);
  const openingLine = summary?.openingLine ?? (existing ? numericLine(existing["Opening Line"]) ?? split.line : split.line);
  const openingOdds = summary?.openingOdds || String(existing?.["Opening Odds"] || split.odds);
  const openingBetsPct = summary?.openingBetsPct ?? existingNumber(existing, "Opening Bets %", split.betsPct);
  const openingMoneyPct = summary?.openingMoneyPct ?? existingNumber(existing, "Opening Handle %", split.moneyPct);
  const publicMovementPct = Math.round((split.betsPct - openingBetsPct) * 10) / 10;
  const sharpMovementPct = Math.round((split.moneyPct - openingMoneyPct) * 10) / 10;
  const openingImpliedPct = impliedPct(openingOdds);
  const currentImpliedPct = impliedPct(split.odds);
  let lineMovementBasis = "";
  let lineMovementValue: number | null = null;
  if (openingLine != null && split.line != null && Math.abs(split.line - openingLine) >= .5) {
    lineMovementBasis = split.market === "Total" ? "Total Line" : "Spread Line";
    lineMovementValue = Math.round((split.line - openingLine) * 10) / 10;
  } else if (summary?.lineMoveCount && summary.lastLineMoveDelta != null) {
    // A round trip (for example -28.5 -> -27.5 -> -28.5) is still real market
    // movement even when first and current happen to match.
    lineMovementBasis = split.market === "Total" ? "Total Line History" : "Spread Line History";
    lineMovementValue = summary.lastLineMoveDelta;
  } else if (openingImpliedPct != null && currentImpliedPct != null && Math.abs(currentImpliedPct - openingImpliedPct) >= 1.5) {
    lineMovementBasis = "Implied Probability";
    lineMovementValue = Math.round((currentImpliedPct - openingImpliedPct) * 10) / 10;
  }
  let lineMovementSignal = "";
  if (lineMovementValue != null) {
    const opposite = Math.abs(publicMovementPct) >= 5 && publicMovementPct * lineMovementValue < 0;
    if (opposite) lineMovementSignal = "Reverse Line Movement";
    else lineMovementSignal = lineMovementValue > 0 ? "Line Movement Confirmation" : "Adverse Line Movement";
  }
  return {
    openingLine, openingOdds, openingBetsPct, openingMoneyPct, publicMovementPct, sharpMovementPct,
    openingImpliedPct, currentImpliedPct, lineMovementBasis, lineMovementValue, lineMovementSignal,
    firstTrackedAt: summary?.firstTrackedAt || "",
    lowLine: summary?.lowLine ?? openingLine,
    highLine: summary?.highLine ?? openingLine,
    lineMoveCount: summary?.lineMoveCount || 0,
    lastLineMoveAt: summary?.lastLineMoveAt || "",
    lineHistoryLabel: summary?.lineHistoryLabel || (openingLine == null ? "" : historyLineLabel(split.market, openingLine)),
  };
}
'''
    text = text[:movement_start] + movement_new + text[movement_end:]
elif 'function movement(split: Split, existing: SheetRow | undefined, marketRows: SheetRow[]) {' not in text:
    raise SystemExit("Could not find movement function")

text = replace_once(
    text,
    'function buildPlay(split: Split, existing: SheetRow | undefined, history: HistoryRow[]): WeeklyTrendPlay {\n  const move = movement(split, existing);',
    'function buildPlay(split: Split, existing: SheetRow | undefined, history: HistoryRow[], marketRows: SheetRow[]): WeeklyTrendPlay {\n  const move = movement(split, existing, marketRows);',
    "history-aware buildPlay",
)
text = replace_once(
    text,
    '    lineMovementSignal: move.lineMovementSignal,\n    score: baseScore,',
    '    lineMovementSignal: move.lineMovementSignal,\n    firstTrackedAt: move.firstTrackedAt,\n    lowLine: move.lowLine,\n    highLine: move.highLine,\n    lineMoveCount: move.lineMoveCount,\n    lastLineMoveAt: move.lastLineMoveAt,\n    lineHistoryLabel: move.lineHistoryLabel,\n    score: baseScore,',
    "persist history summary in play JSON",
)

text = replace_once(
    text,
    '''  await Promise.all([
    ensureSportWorksheet(sport, POSTED_GAMES_TAB, POSTED_GAME_HEADERS),
    ensureSportWorksheet(sport, WEEKLY_TRENDS_TAB, WEEKLY_TREND_HEADERS),
  ]);
  const [existingGames, existingTrends, allGameTrends, scheduleRows, slateRows] = await Promise.all([
    readSportWorksheet(sport, POSTED_GAMES_TAB, POSTED_GAME_HEADERS),
    readSportWorksheet(sport, WEEKLY_TRENDS_TAB, WEEKLY_TREND_HEADERS),
    readSportWorksheet(sport, "all_game_trends"),
    readSportWorksheet(sport, "schedule"),
    readSportWorksheet(sport, "daily_slate"),
  ]);''',
    '''  await Promise.all([
    ensureSportWorksheet(sport, POSTED_GAMES_TAB, POSTED_GAME_HEADERS),
    ensureSportWorksheet(sport, WEEKLY_TRENDS_TAB, WEEKLY_TREND_HEADERS),
    ensureSportWorksheet(sport, MARKET_HISTORY_TAB, MARKET_HISTORY_HEADERS),
  ]);
  const [existingGames, existingTrends, existingMarketHistory, allGameTrends, scheduleRows, slateRows] = await Promise.all([
    readSportWorksheet(sport, POSTED_GAMES_TAB, POSTED_GAME_HEADERS),
    readSportWorksheet(sport, WEEKLY_TRENDS_TAB, WEEKLY_TREND_HEADERS),
    readSportWorksheet(sport, MARKET_HISTORY_TAB, MARKET_HISTORY_HEADERS),
    readSportWorksheet(sport, "all_game_trends"),
    readSportWorksheet(sport, "schedule"),
    readSportWorksheet(sport, "daily_slate"),
  ]);''',
    "read append-only market history",
)

prep_old = '''  const existingTrendMap = new Map(existingTrends.map((row) => [trendKey(row), row]));
  const history = historyFromAllGameTrends(allGameTrends);
  const liveCandidates: WeeklyTrendPlay[] = [];'''
prep_new = '''  const existingTrendMap = new Map(existingTrends.map((row) => [trendKey(row), row]));
  const history = historyFromAllGameTrends(allGameTrends);

  // Build a durable, append-only tape. Existing weekly rows seed the first
  // tracked state once, then every distinct DraftKings state is appended.
  // We append only on change, not every five-minute heartbeat.
  const marketHistoryRows = [...existingMarketHistory];
  const marketHistoryRowsToAppend: SheetRow[] = [];
  const existingHistoryKeys = new Set(existingMarketHistory.map(marketHistoryLogicalKey).filter(Boolean));
  const latestHistoryByKey = new Map<string, SheetRow>();
  for (const row of existingMarketHistory) {
    const key = marketHistoryLogicalKey(row);
    if (key) latestHistoryByKey.set(key, row);
  }
  const postedStateRows = [...existingGames, ...postedRows];
  const firstSeenByGame = new Map(postedStateRows.map((row) => [String(row["Game Key"] || ""), String(row["First Seen"] || now)]));

  for (const split of dk.splits) {
    const key = splitTrendKey(split);
    if (!existingHistoryKeys.has(key)) {
      const existing = existingTrendMap.get(key);
      const seed = existing ? marketHistorySeedRow(existing, firstSeenByGame.get(gameKey(split)) || now) : null;
      if (seed) {
        marketHistoryRows.push(seed);
        marketHistoryRowsToAppend.push(seed);
        latestHistoryByKey.set(key, seed);
        existingHistoryKeys.add(key);
      }
    }
    const current = marketHistoryRowForSplit(split, sport, canonicalRows, now);
    const previous = latestHistoryByKey.get(key);
    if (!previous || marketHistoryStateSignature(previous) !== current["State Signature"]) {
      marketHistoryRows.push(current);
      marketHistoryRowsToAppend.push(current);
      latestHistoryByKey.set(key, current);
      existingHistoryKeys.add(key);
    }
  }

  let marketHistoryRowsAppended = 0;
  if (marketHistoryRowsToAppend.length) {
    try {
      await appendSportRows(sport, MARKET_HISTORY_TAB, MARKET_HISTORY_HEADERS, marketHistoryRowsToAppend);
      marketHistoryRowsAppended = marketHistoryRowsToAppend.length;
    } catch (error) {
      dk.errors.push(`Market history append failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const liveCandidates: WeeklyTrendPlay[] = [];'''
text = replace_once(text, prep_old, prep_new, "prepare append-only market tape")

text = replace_once(
    text,
    '    liveCandidates.push({ ...buildPlay(split, existing, history), week: footballWeekLabel(sport, split.date) });',
    '    liveCandidates.push({ ...buildPlay(split, existing, history, marketHistoryRows), week: footballWeekLabel(sport, split.date) });',
    "score from full market history",
)
text = replace_once(
    text,
    '    trendRowsUpdated: rows.length,\n    errors: dk.errors,',
    '    trendRowsUpdated: rows.length,\n    marketHistoryRowsAppended,\n    marketHistoryRowsStored: marketHistoryRows.length,\n    errors: dk.errors,',
    "report market history persistence",
)

path.write_text(text)


# 3) Show what actually happened instead of implying first-tracked == sportsbook opener.
path = Path("app/FootballBoard.tsx")
text = path.read_text()
text = replace_once(
    text,
    '  signals: TrendSignal[]; lineMovementSignal?: string; lineMovementBasis?: string; lineMovementValue?: number | null;\n};',
    '  signals: TrendSignal[]; lineMovementSignal?: string; lineMovementBasis?: string; lineMovementValue?: number | null;\n  firstTrackedAt?: string; lowLine?: number | null; highLine?: number | null; lineMoveCount?: number;\n  lastLineMoveAt?: string; lineHistoryLabel?: string;\n};',
    "FootballBoard trend history fields",
)
text = replace_once(
    text,
    '''          <MiniBubble label="Opening Bets" value={pct(play.openingBetsPct)} />
          <MiniBubble label="Current Bets" value={pct(play.betsPct)} />
          <MiniBubble label="Bets Change" value={signedPct(play.publicMovementPct)} />
          <MiniBubble label="Opening Handle" value={pct(play.openingMoneyPct)} />
          <MiniBubble label="Current Handle" value={pct(play.moneyPct)} />
          <MiniBubble label="Handle Change" value={signedPct(play.sharpMovementPct)} />
          <MiniBubble label="Handle − Bets" value={`${play.gapPct >= 0 ? "+" : ""}${Number(play.gapPct || 0).toFixed(1)}%`} />
          <MiniBubble label="Opening Odds" value={play.openingOdds || "—"} />
          <MiniBubble label="Current Odds" value={play.odds || "—"} />
          <MiniBubble label="Opening Line" value={marketLine(play, play.openingLine)} />
          <MiniBubble label="Current Line" value={marketLine(play, play.line)} />
          <MiniBubble label="Price Move" value={priceMove(play)} />''',
    '''          <MiniBubble label="First Tracked Bets" value={pct(play.openingBetsPct)} />
          <MiniBubble label="Current Bets" value={pct(play.betsPct)} />
          <MiniBubble label="Bets Change" value={signedPct(play.publicMovementPct)} />
          <MiniBubble label="First Tracked Handle" value={pct(play.openingMoneyPct)} />
          <MiniBubble label="Current Handle" value={pct(play.moneyPct)} />
          <MiniBubble label="Handle Change" value={signedPct(play.sharpMovementPct)} />
          <MiniBubble label="Handle − Bets" value={`${play.gapPct >= 0 ? "+" : ""}${Number(play.gapPct || 0).toFixed(1)}%`} />
          <MiniBubble label="First Tracked Odds" value={play.openingOdds || "—"} />
          <MiniBubble label="Current Odds" value={play.odds || "—"} />
          <MiniBubble label="First Tracked Line" value={marketLine(play, play.openingLine)} />
          <MiniBubble label="Current Line" value={marketLine(play, play.line)} />
          <MiniBubble label="Line Low" value={marketLine(play, play.lowLine)} />
          <MiniBubble label="Line High" value={marketLine(play, play.highLine)} />
          <MiniBubble label="Line Moves" value={String(play.lineMoveCount ?? 0)} />
          <MiniBubble label="Line Path" value={play.lineHistoryLabel || "—"} />
          <MiniBubble label="Price Move" value={priceMove(play)} />''',
    "display full line path",
)
path.write_text(text)
