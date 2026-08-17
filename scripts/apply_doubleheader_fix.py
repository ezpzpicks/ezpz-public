from pathlib import Path


def one(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


def many(text: str, old: str, new: str, expected: int, label: str) -> str:
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{label}: expected {expected} matches, found {count}")
    return text.replace(old, new)


route_path = Path("app/api/public-data/route.ts")
s = route_path.read_text()

s = one(
    s,
    '  "Snapshot Time ET", "Opening Snapshot Time ET", "Date", "Game", "Away Team", "Home Team", "Data Type",',
    '  "Snapshot Time ET", "Opening Snapshot Time ET", "Date", "Game Time ET", "Game", "Away Team", "Home Team", "Data Type",',
    "public split headers",
)
s = one(
    s,
    'type DraftKingsSplit = {\n  date: string;\n  game: string;',
    'type DraftKingsSplit = {\n  date: string;\n  eventTime?: string;\n  game: string;',
    "split type",
)
s = one(
    s,
    'type DraftKingsProp = {\n  date: string;\n  game: string;',
    'type DraftKingsProp = {\n  date: string;\n  eventTime?: string;\n  game: string;',
    "prop type",
)
s = one(
    s,
    'function draftKingsSplitKey(row: DraftKingsSplit) {\n  const selectedSide =\n    row.market === "Total"\n      ? row.side || textKey(row.selection)\n      : teamFromSelection(row.selectionTeam || row.selection);\n  return `${row.date}|${row.game}|${row.market}|${textKey(selectedSide)}`;\n}',
    'function draftKingsMarketInstanceKey(row: { date: string; awayTeam: string; homeTeam: string; eventTime?: string }) {\n  return `${isoPublicDate(row.date)}|${normalizeTeam(row.awayTeam)}|${normalizeTeam(row.homeTeam)}|${parseEventTimeKey(row.eventTime || "")}`;\n}\n\nfunction draftKingsSplitKey(row: DraftKingsSplit) {\n  const selectedSide =\n    row.market === "Total"\n      ? row.side || textKey(row.selection)\n      : teamFromSelection(row.selectionTeam || row.selection);\n  return `${row.date}|${row.game}|${parseEventTimeKey(row.eventTime || "")}|${row.market}|${textKey(selectedSide)}`;\n}',
    "split key",
)
s = one(
    s,
    '    row.date,\n    row.game,\n    textKey(row.pitcher),',
    '    row.date,\n    row.game,\n    parseEventTimeKey(row.eventTime || ""),\n    textKey(row.pitcher),',
    "prop key",
)

time_helper = r'''function parseEventTimeKey(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const meridiem = raw.match(/(?:^|[,\s])(\d{1,2})(?::(\d{2}))\s*(AM|PM)\b/i);
  if (meridiem) {
    let hour = Number(meridiem[1]) % 12;
    if (meridiem[3].toUpperCase() === "PM") hour += 12;
    const minute = Number(meridiem[2] || 0);
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
  const twentyFour = raw.match(/(?:^|[,T\s])([01]?\d|2[0-3]):([0-5]\d)(?::\d{2})?(?:\s*(?:ET|EST|EDT))?\s*$/i);
  if (twentyFour) {
    return `${String(Number(twentyFour[1])).padStart(2, "0")}:${twentyFour[2]}`;
  }
  return "";
}

'''
s = one(s, "function numericLine(value: unknown) {", time_helper + "function numericLine(value: unknown) {", "event time helper")
s = one(
    s,
    '    const date = parseEventDate(dateToken);\n    const game = `${awayTeam} at ${homeTeam}`;',
    '    const date = parseEventDate(dateToken);\n    const eventTime = parseEventTimeKey(dateToken);\n    const game = `${awayTeam} at ${homeTeam}`;',
    "split event time parse",
)
s = one(
    s,
    '          date,\n          game,\n          awayTeam,\n          homeTeam,\n          market,',
    '          date,\n          eventTime,\n          game,\n          awayTeam,\n          homeTeam,\n          market,',
    "split event time row",
)
s = many(
    s,
    '`${row.date}|${row.game}|${row.market}|${textKey(row.selection)}`',
    '`${row.date}|${row.game}|${parseEventTimeKey(row.eventTime || "")}|${row.market}|${textKey(row.selection)}`',
    3,
    "split dedupe keys",
)
s = one(
    s,
    '      date: parseEventDate(dateText),\n      game: `${awayTeam} at ${homeTeam}`,',
    '      date: parseEventDate(dateText),\n      eventTime: parseEventTimeKey(dateText),\n      game: `${awayTeam} at ${homeTeam}`,',
    "prop event time row",
)
s = one(
    s,
    '    const key = `${row.date}|${row.game}|${textKey(row.pitcher)}|${row.listedLine}`;',
    '    const key = `${row.date}|${row.game}|${parseEventTimeKey(row.eventTime || "")}|${textKey(row.pitcher)}|${row.listedLine}`;',
    "prop payload dedupe",
)
s = one(
    s,
    'function sameDraftKingsGame(\n  row: SheetRow,\n  marketRow: { date: string; awayTeam: string; homeTeam: string },\n) {\n  const away = normalizeTeam(row["Away Team"] || "");\n  const home = normalizeTeam(row["Home Team"] || "");\n  if (away !== marketRow.awayTeam || home !== marketRow.homeTeam) return false;\n  const rowDate = isoPublicDate(row["Date"] || "");\n  const marketDate = isoPublicDate(marketRow.date);\n  return !rowDate || !marketDate || rowDate === marketDate;\n}',
    'function scheduledGameTimeKey(row: SheetRow) {\n  const start = scheduledGameStart(row);\n  if (start != null) {\n    const parts = new Intl.DateTimeFormat("en-US", {\n      timeZone: "America/New_York",\n      hour: "2-digit",\n      minute: "2-digit",\n      hourCycle: "h23",\n    }).formatToParts(new Date(start));\n    const hour = parts.find((part) => part.type === "hour")?.value || "";\n    const minute = parts.find((part) => part.type === "minute")?.value || "";\n    if (hour && minute) return `${hour}:${minute}`;\n  }\n  return parseEventTimeKey(firstValue(row, ["Game Time", "Game Start Time", "Scheduled Start", "Start Time", "Game Time ET"]));\n}\n\nfunction sameDraftKingsGame(\n  row: SheetRow,\n  marketRow: { date: string; awayTeam: string; homeTeam: string; eventTime?: string },\n) {\n  const away = normalizeTeam(row["Away Team"] || "");\n  const home = normalizeTeam(row["Home Team"] || "");\n  if (away !== marketRow.awayTeam || home !== marketRow.homeTeam) return false;\n  const rowDate = isoPublicDate(row["Date"] || "");\n  const marketDate = isoPublicDate(marketRow.date);\n  if (rowDate && marketDate && rowDate !== marketDate) return false;\n  const rowTime = scheduledGameTimeKey(row);\n  const marketTime = parseEventTimeKey(marketRow.eventTime || "");\n  return !rowTime || !marketTime || rowTime === marketTime;\n}',
    "same game matching",
)
s = many(
    s,
    '    Date: item.date,\n    Game: item.game,',
    '    Date: item.date,\n    "Game Time ET": parseEventTimeKey(item.eventTime || ""),\n    Game: item.game,',
    2,
    "snapshot event time",
)
s = one(
    s,
    '  return `${isoPublicDate(row.Date)}|${textKey(row.Game)}|${dataType}|${textKey(market)}|${selectedKey}`;',
    '  return `${isoPublicDate(row.Date)}|${parseEventTimeKey(row["Game Time ET"] || "")}|${textKey(row.Game)}|${dataType}|${textKey(market)}|${selectedKey}`;',
    "snapshot record key",
)
s = one(
    s,
    '    const date = isoPublicDate(row.Date);\n    const game = String(row.Game || `${awayTeam} at ${homeTeam}`);',
    '    const date = isoPublicDate(row.Date);\n    const eventTime = parseEventTimeKey(row["Game Time ET"] || "");\n    const game = String(row.Game || `${awayTeam} at ${homeTeam}`);',
    "snapshot load event time",
)
s = one(s, '      props.push({\n        date,\n        game,', '      props.push({\n        date,\n        eventTime,\n        game,', "snapshot prop event time")
s = one(s, '    const baseSplit: DraftKingsSplit = {\n      date,\n      game,', '    const baseSplit: DraftKingsSplit = {\n      date,\n      eventTime,\n      game,', "snapshot split event time")
s = one(
    s,
    'function draftKingsGameKey(row: SheetRow) {\n  return `${isoPublicDate(row.Date)}|${normalizeTeam(row["Away Team"] || "")}|${normalizeTeam(row["Home Team"] || "")}`;\n}',
    'function draftKingsGameKey(row: SheetRow) {\n  return `${isoPublicDate(row.Date)}|${normalizeTeam(row["Away Team"] || "")}|${normalizeTeam(row["Home Team"] || "")}|${scheduledGameTimeKey(row)}`;\n}',
    "slate game key",
)
old_display = '''  const finalMarketSplits = finalSnapshots.splits.filter(
    (split) =>
      split.snapshotStatus === "FINAL_PREGAME" &&
      (split.market === "Moneyline" || split.market === "Total"),
  );
  const lockedGameKeys = new Set(
    finalMarketSplits.map(
      (split) =>
        `${isoPublicDate(split.date)}|${normalizeTeam(split.awayTeam)}|${normalizeTeam(split.homeTeam)}`,
    ),
  );

  const splitMap = new Map<string, DraftKingsSplit>();
  for (const split of current.splits) {
    const gameKey =
      `${isoPublicDate(split.date)}|${normalizeTeam(split.awayTeam)}|${normalizeTeam(split.homeTeam)}`;
'''
new_display = '''  const finalMarketSplits = finalSnapshots.splits.flatMap((split) => {
    if (
      split.snapshotStatus !== "FINAL_PREGAME" ||
      (split.market !== "Moneyline" && split.market !== "Total")
    ) return [];
    if (parseEventTimeKey(split.eventTime || "")) return [split];
    const matchingSlateRows = slateRows.filter(
      (row) =>
        isoPublicDate(row.Date || "") === isoPublicDate(split.date) &&
        normalizeTeam(row["Away Team"] || "") === normalizeTeam(split.awayTeam) &&
        normalizeTeam(row["Home Team"] || "") === normalizeTeam(split.homeTeam),
    );
    // A legacy snapshot without a game time is safe only when the matchup occurs
    // once that day. For a doubleheader it is ambiguous, so ignore it instead of
    // letting Game 1 overwrite Game 2 (or vice versa).
    if (matchingSlateRows.length != 1) return [];
    return [{ ...split, eventTime: scheduledGameTimeKey(matchingSlateRows[0]) }];
  });
  const lockedGameKeys = new Set(
    finalMarketSplits.map((split) => draftKingsMarketInstanceKey(split)),
  );

  const splitMap = new Map<string, DraftKingsSplit>();
  for (const split of current.splits) {
    const gameKey = draftKingsMarketInstanceKey(split);
'''
s = one(s, old_display, new_display, "final snapshot doubleheader display")
s = one(
    s,
    '      normalizeTeam(split.homeTeam) === normalizeTeam(candidate.homeTeam) &&\n      split.market === candidate.market,',
    '      normalizeTeam(split.homeTeam) === normalizeTeam(candidate.homeTeam) &&\n      (!candidate.slateRow || sameDraftKingsGame(candidate.slateRow, split)) &&\n      split.market === candidate.market,',
    "AI market match time",
)
route_path.write_text(s)

cron_path = Path("app/api/cron/draftkings-snapshot/route.ts")
c = cron_path.read_text()
old_game_key = '''function gameKey(row: SheetRow) {
  return [
    normalizeDate(row.Date || ""),
    textKey(row["Away Team"] || ""),
    textKey(row["Home Team"] || ""),
  ].join("|");
}
'''
new_game_key = '''function gameTimeKey(row: SheetRow) {
  const raw = ["Game Time ET", "Game Time", "Game Start Time", "Scheduled Start", "Start Time"]
    .map((column) => String(row[column] || "").trim())
    .find(Boolean) || "";
  const meridiem = raw.match(/(\d{1,2})(?::(\d{2}))\s*(AM|PM)/i);
  if (meridiem) {
    let hour = Number(meridiem[1]) % 12;
    if (meridiem[3].toUpperCase() === "PM") hour += 12;
    return `${String(hour).padStart(2, "0")}:${String(Number(meridiem[2] || 0)).padStart(2, "0")}`;
  }
  const clock24 = raw.match(/(?:^|[T,\s])([01]?\d|2[0-3]):([0-5]\d)(?::\d{2})?(?:\s*(?:ET|EST|EDT))?\s*$/i);
  if (clock24) return `${String(Number(clock24[1])).padStart(2, "0")}:${clock24[2]}`;
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(parsed);
    const hour = parts.find((part) => part.type === "hour")?.value || "";
    const minute = parts.find((part) => part.type === "minute")?.value || "";
    if (hour && minute) return `${hour}:${minute}`;
  }
  return "";
}

function gameKey(row: SheetRow) {
  return [
    normalizeDate(row.Date || ""),
    textKey(row["Away Team"] || ""),
    textKey(row["Home Team"] || ""),
    gameTimeKey(row),
  ].join("|");
}
'''
c = one(c, old_game_key, new_game_key, "cron game key")
cron_path.write_text(c)

alert_path = Path("scripts/draftkings_odds_alerts.mjs")
a = alert_path.read_text()
time_js = r'''function parseEventTimeKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const meridiem = raw.match(/(?:^|[,\s])(\d{1,2})(?::(\d{2}))\s*(AM|PM)\b/i);
  if (meridiem) {
    let hour = Number(meridiem[1]) % 12;
    if (meridiem[3].toUpperCase() === "PM") hour += 12;
    return `${String(hour).padStart(2, "0")}:${String(Number(meridiem[2] || 0)).padStart(2, "0")}`;
  }
  const twentyFour = raw.match(/(?:^|[,T\s])([01]?\d|2[0-3]):([0-5]\d)(?::\d{2})?(?:\s*(?:ET|EST|EDT))?\s*$/i);
  if (twentyFour) return `${String(Number(twentyFour[1])).padStart(2, "0")}:${twentyFour[2]}`;
  return "";
}

'''
a = one(a, "function numericLine(value) {", time_js + "function numericLine(value) {", "alert time helper")
a = one(a, '    const date = parseEventDate(dateToken);\n    const game = `${awayTeam} at ${homeTeam}`;', '    const date = parseEventDate(dateToken);\n    const eventTime = parseEventTimeKey(dateToken);\n    const game = `${awayTeam} at ${homeTeam}`;', "alert parse time")
a = one(a, '          date,\n          game,\n          awayTeam,\n          homeTeam,\n          market,', '          date,\n          eventTime,\n          game,\n          awayTeam,\n          homeTeam,\n          market,', "alert row time")
a = many(a, '`${row.date}|${row.game}|${row.market}|${textKey(row.selection)}`', '`${row.date}|${row.game}|${parseEventTimeKey(row.eventTime || "")}|${row.market}|${textKey(row.selection)}`', 2, "alert dedupe time")
a = one(a, '  return `${row.date}|${row.game}|${row.market}|${textKey(selectionKey)}`;', '  return `${row.date}|${row.game}|${parseEventTimeKey(row.eventTime || "")}|${row.market}|${textKey(selectionKey)}`;', "alert state key")
a = one(a, '      date: current.date,\n      game: current.game,', '      date: current.date,\n      eventTime: parseEventTimeKey(current.eventTime || ""),\n      game: current.game,', "alert snapshot time")
a = one(a, '      current.game,\n      `${snapshotDisplay(previous)} → ${snapshotDisplay(current)}`,', '      `${current.game}${current.eventTime ? ` (${current.eventTime} ET)` : ""}`,\n      `${snapshotDisplay(previous)} → ${snapshotDisplay(current)}`,', "alert message time")
a = one(a, "parsed?.version === 1", "parsed?.version === 2", "state read version")
a = one(a, 'return { version: 1, date, markets: {}, updatedAt: "" };', 'return { version: 2, date, markets: {}, updatedAt: "" };', "state new version")
a = one(a, '  const opening = { ...over, odds: "-110", line: 7.5, betsPct: 55 };', '  const gameOne = { ...over, eventTime: "13:40" };\n  const gameTwo = { ...over, eventTime: "18:40" };\n  if (splitKey(gameOne) === splitKey(gameTwo)) throw new Error("Self-test doubleheader key collision");\n  if (parseEventTimeKey("8/17, 01:40PM") !== "13:40" || parseEventTimeKey("8/17, 06:40PM") !== "18:40") throw new Error("Self-test DraftKings event time parsing failed");\n  const opening = { ...over, odds: "-110", line: 7.5, betsPct: 55 };', "self test doubleheader keys")
alert_path.write_text(a)

print("Doubleheader patch applied to public route, snapshot cron, and odds monitor.")
