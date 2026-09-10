from pathlib import Path

path = Path("lib/footballPublicData.ts")
text = path.read_text(encoding="utf-8")


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 match, found {count}")
    text = text.replace(old, new, 1)


replace_once(
'''function propRecordType(row: SheetRow) {
  const market = String(row.Market || "Player Prop").trim();
  const side = propSide(row);
  return `${market}${side ? ` ${side}` : ""}`.trim();
}''',
'''function propRecordType(row: SheetRow) {
  const market = String(row.Market || "Player Prop").trim();
  const key = textKey(market);
  if ((key.includes("passing") || key.includes("pass ") || key.startsWith("pass ")) && key.includes("yard")) return "Passing Yards";
  if ((key.includes("rushing") || key.includes("rush ") || key.startsWith("rush ")) && key.includes("yard")) return "Rushing Yards";
  if ((key.includes("receiving") || key.includes("receiv") || key.includes("rec ") || key.startsWith("rec ")) && key.includes("yard")) return "Receiving Yards";
  if (key.includes("reception")) return "Receptions";
  if ((key.includes("passing") || key.startsWith("pass ")) && key.includes("touchdown")) return "Passing TDs";
  if ((key.includes("rushing") || key.startsWith("rush ")) && key.includes("touchdown")) return "Rushing TDs";
  if ((key.includes("receiving") || key.includes("receiv")) && key.includes("touchdown")) return "Receiving TDs";
  if ((key.includes("passing") || key.startsWith("pass ")) && key.includes("attempt")) return "Pass Attempts";
  if (key.includes("completion")) return "Pass Completions";
  if ((key.includes("rushing") || key.startsWith("rush ")) && key.includes("attempt")) return "Rush Attempts";
  return market || "Player Prop";
}''',
"prop form bucket",
)

replace_once(
'''function gameBestRecordType(play: any) {
  return textKey(play.role || play.playType).includes("total") ? "Total" : "Spread";
}

function trackerMatchesGameBest(row: SheetRow, recordType: string) {
  const market = textKey(row["Bet Type"] || row.Market);
  return recordType === "Total" ? market.includes("total") : market.includes("spread");
}''',
'''function gameBestMarket(play: any): "Spread" | "Total" {
  return textKey(play.role || play.playType).includes("total") ? "Total" : "Spread";
}

function spreadLine(value: unknown) {
  const raw = String(value ?? "").replace(/−/g, "-");
  const matches = raw.match(/[+-]\\d+(?:\\.\\d+)?/g) || [];
  for (const match of matches) {
    const line = Number(match);
    if (Number.isFinite(line) && Math.abs(line) <= 60) return line;
  }
  const plain = raw.match(/(?:^|\\s)(-?\\d+(?:\\.\\d+)?)(?:\\s|$)/)?.[1];
  if (!plain) return null;
  const line = Number(plain);
  return Number.isFinite(line) && Math.abs(line) <= 60 ? line : null;
}

function gameBestRecordType(play: any, split?: any) {
  const market = gameBestMarket(play);
  if (market === "Total") {
    const side = textKey(split?.side || play.play);
    if (side.startsWith("under")) return "Under";
    if (side.startsWith("over")) return "Over";
    return "Total";
  }
  const splitGroup = textKey(split?.sideGroup || "");
  if (splitGroup === "favorite") return "Favorite Spread";
  if (splitGroup === "underdog") return "Underdog Spread";
  const line = spreadLine(split?.line) ?? spreadLine(play.play);
  if (line != null && line < 0) return "Favorite Spread";
  if (line != null && line > 0) return "Underdog Spread";
  return "Spread";
}

function trackerMatchesGameBest(row: SheetRow, recordType: string) {
  const market = textKey(row["Bet Type"] || row.Market);
  if (recordType === "Over" || recordType === "Under") {
    if (!market.includes("total")) return false;
    const side = textKey(row.Selection || row.Side || row.Pick);
    return side.startsWith(textKey(recordType));
  }
  if (recordType === "Favorite Spread" || recordType === "Underdog Spread") {
    if (!market.includes("spread")) return false;
    const line = spreadLine(row.Selection) ?? spreadLine(row["Odds/Line"]) ?? spreadLine(row.Line);
    if (line == null) return false;
    return recordType === "Favorite Spread" ? line < 0 : line > 0;
  }
  return recordType === "Total" ? market.includes("total") : market.includes("spread");
}''',
"game form buckets",
)

replace_once(
'''function splitForBestPlay(play: any, splits: any[]) {
  const recordType = gameBestRecordType(play);''',
'''function splitForBestPlay(play: any, splits: any[]) {
  const recordType = gameBestMarket(play);''',
"split broad market",
)

replace_once(
'''function annotateGameBestPlays(best: any[], tracker: SheetRow[], splits: any[]) {
  return best.map((play) => {
    const formType = gameBestRecordType(play);
    const form = formFromRows(tracker.filter((row) => trackerMatchesGameBest(row, formType)));
    const split = splitForBestPlay(play, splits);''',
'''function annotateGameBestPlays(best: any[], tracker: SheetRow[], splits: any[]) {
  return best.map((play) => {
    const split = splitForBestPlay(play, splits);
    const formType = gameBestRecordType(play, split);
    const form = formFromRows(tracker.filter((row) => trackerMatchesGameBest(row, formType)));''',
"game form annotation",
)

replace_once(
'''    market: isProp ? "Player Prop" : gameBestRecordType(play) as "Spread" | "Total",''',
'''    market: isProp ? "Player Prop" : gameBestMarket(play),''',
"EZPZ pick broad market",
)

path.write_text(text, encoding="utf-8")
print("Patched NFL form buckets: props by market; spreads by favorite/underdog; totals by over/under.")
