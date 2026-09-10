from pathlib import Path
import re


def replace_once(text: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 match, found {count}")
    return updated


lib_path = Path("lib/footballPublicData.ts")
lib = lib_path.read_text(encoding="utf-8")

prop_helpers = r'''function nflGradeLabel(value: unknown) {
  const key = textKey(value);
  if (key === "a" || key === "a grade" || key === "a prop" || key.startsWith("a grade ") || key.startsWith("a prop ")) return "A";
  if (key === "b" || key === "b grade" || key === "b prop" || key.startsWith("b grade ") || key.startsWith("b prop ")) return "B";
  return "";
}

function propBaseRecordType(row: SheetRow) {
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
}

function propRecordType(row: SheetRow) {
  const grade = nflGradeLabel(row.Grade || row["Model Grade"]);
  const market = propBaseRecordType(row);
  const side = propSide(row);
  return [grade, market, side].filter(Boolean).join(" ").trim();
}'''
lib = replace_once(
    lib,
    r'function propRecordType\(row: SheetRow\) \{.*?\n\}\n\nfunction propMarketLine',
    prop_helpers + '\n\nfunction propMarketLine',
    "NFL prop exact subset helper",
)

game_helpers = r'''function gameBestRecordType(play: any, split?: any) {
  const grade = nflGradeLabel(play.playType || play.grade || play["Model Grade"]);
  const market = gameBestMarket(play);
  let subtype = market;
  if (market === "Total") {
    const side = textKey(split?.side || play.play);
    if (side.startsWith("under")) subtype = "Under";
    else if (side.startsWith("over")) subtype = "Over";
  } else {
    const splitGroup = textKey(split?.sideGroup || "");
    if (splitGroup === "favorite") subtype = "Favorite Spread";
    else if (splitGroup === "underdog") subtype = "Underdog Spread";
    else {
      const line = spreadLine(split?.line) ?? spreadLine(play.play);
      if (line != null && line < 0) subtype = "Favorite Spread";
      else if (line != null && line > 0) subtype = "Underdog Spread";
    }
  }
  return [grade, subtype].filter(Boolean).join(" ").trim();
}

function gameTrackerRecordType(row: SheetRow) {
  const market = textKey(row["Bet Type"] || row.Market);
  const grade = nflGradeLabel(row["Model Grade"] || row.Grade || row["Bet Type"]);
  if (market.includes("total")) {
    const side = textKey(row.Selection || row.Side || row.Pick);
    const subtype = side.startsWith("under") ? "Under" : side.startsWith("over") ? "Over" : "Total";
    return [grade, subtype].filter(Boolean).join(" ").trim();
  }
  if (market.includes("spread")) {
    const line = spreadLine(row.Selection) ?? spreadLine(row["Odds/Line"]) ?? spreadLine(row.Line);
    const subtype = line != null && line < 0 ? "Favorite Spread" : line != null && line > 0 ? "Underdog Spread" : "Spread";
    return [grade, subtype].filter(Boolean).join(" ").trim();
  }
  return "";
}

function trackerMatchesGameBest(row: SheetRow, recordType: string) {
  return textKey(gameTrackerRecordType(row)) === textKey(recordType);
}'''
lib = replace_once(
    lib,
    r'function gameBestRecordType\(play: any, split\?: any\) \{.*?\n\}\n\nfunction trackerMatchesGameBest\(row: SheetRow, recordType: string\) \{.*?\n\}',
    game_helpers,
    "NFL game exact subset helper",
)

exact_summaries = r'''const exactRecordTypeForRow = (row: SheetRow) => {
    const market = textKey(row["Bet Type"] || row.Market);
    if (market.includes("spread") || market.includes("total")) return gameTrackerRecordType(row);
    if (qualifiedNflPropGrade(row.Grade || row["Model Grade"])) return propRecordType(row);
    return "";
  };
  const recordOrder = [
    "Favorite Spread", "Underdog Spread", "Over", "Under",
    "Passing Yards Over", "Passing Yards Under",
    "Rushing Yards Over", "Rushing Yards Under",
    "Receiving Yards Over", "Receiving Yards Under",
    "Receptions Over", "Receptions Under",
    "Pass Attempts Over", "Pass Attempts Under",
    "Pass Completions Over", "Pass Completions Under",
    "Rush Attempts Over", "Rush Attempts Under",
    "Passing TDs Over", "Passing TDs Under",
    "Rushing TDs Over", "Rushing TDs Under",
    "Receiving TDs Over", "Receiving TDs Under",
  ];
  const nflRecordTypeSort = (left: string, right: string) => {
    const leftGrade = left.startsWith("A ") ? 0 : left.startsWith("B ") ? 1 : 2;
    const rightGrade = right.startsWith("A ") ? 0 : right.startsWith("B ") ? 1 : 2;
    if (leftGrade !== rightGrade) return leftGrade - rightGrade;
    const strip = (value: string) => value.replace(/^[AB]\s+/, "");
    const leftType = strip(left);
    const rightType = strip(right);
    const leftRank = recordOrder.indexOf(leftType);
    const rightRank = recordOrder.indexOf(rightType);
    if (leftRank !== rightRank) return (leftRank < 0 ? 999 : leftRank) - (rightRank < 0 ? 999 : rightRank);
    return left.localeCompare(right);
  };
  const exactRecordTypes = [...new Set(combinedBestPlayTracker.map(exactRecordTypeForRow).filter(Boolean))].sort(nflRecordTypeSort);
  const nflRecordSummary = exactRecordTypes.map((betType) =>
    nflSummaryRow(betType, combinedBestPlayTracker.filter((row) => exactRecordTypeForRow(row) === betType)),
  );
  const nflLast7RecordSummary = exactRecordTypes.map((betType) =>
    nflSummaryRow(betType, combinedBestPlayTracker.filter((row) => exactRecordTypeForRow(row) === betType), 7),
  );
  const nflOverallBestRecord = nflRecordTotals(combinedBestPlayTracker);
  const nflLast7BestRecord = nflRecordTotals(combinedBestPlayTracker, 7);
  const nflPendingBestPlays = combinedBestPlayTracker.filter((row) => !resultCode(row.Result || row.Status)).length;'''
lib = replace_once(
    lib,
    r'const nflRecordSummary = \[.*?const nflPendingBestPlays = combinedBestPlayTracker\.filter\(\(row\) => !resultCode\(row\.Result \|\| row\.Status\)\)\.length;',
    exact_summaries,
    "NFL exact record summaries",
)

lib = replace_once(
    lib,
    r'(return \{\n    \.\.\.legacy,\n    bestPlays,)',
    r'\1\n    betTrackerRows: combinedBestPlayTracker,',
    "NFL combined tracker payload",
)

lib_path.write_text(lib, encoding="utf-8")

ui_path = Path("app/FootballBoardLegacy.tsx")
ui = ui_path.read_text(encoding="utf-8")
ui = ui.replace(
    '<div className="sectionHead"><div><h2>All Qualified Plays</h2><p>Official graded CFB model plays</p></div></div>',
    '<div className="sectionHead"><div><h2>All Qualified Plays</h2><p>{sport === "NFL" ? "Official graded NFL game + player-prop plays" : "Official graded CFB model plays"}</p></div></div>',
    1,
)
old_tiles = '''{sport === "NCAAF" ? <>
          <RecordTile label="Favorite Spread - Running Total" value={summaryMap.get("Favorite Spread")} />
          <RecordTile label="Underdog Spread - Running Total" value={summaryMap.get("Underdog Spread")} />
          <RecordTile label="Over - Running Total" value={summaryMap.get("Over")} />
          <RecordTile label="Under - Running Total" value={summaryMap.get("Under")} />
        </> : <>
          <RecordTile label="Spread - Running Total" value={summaryMap.get("Spread")} />
          <RecordTile label="Total - Running Total" value={summaryMap.get("Total")} />
        </>}'''
new_tiles = '''{sport === "NCAAF" ? <>
          <RecordTile label="Favorite Spread - Running Total" value={summaryMap.get("Favorite Spread")} />
          <RecordTile label="Underdog Spread - Running Total" value={summaryMap.get("Underdog Spread")} />
          <RecordTile label="Over - Running Total" value={summaryMap.get("Over")} />
          <RecordTile label="Under - Running Total" value={summaryMap.get("Under")} />
        </> : (data.recordSummary || []).map((row) =>
          <RecordTile key={row.betType} label={`${row.betType} - Running Total`} value={row} />
        )}'''
if old_tiles not in ui:
    raise SystemExit("NFL records summary tiles: expected exact block was not found")
ui = ui.replace(old_tiles, new_tiles, 1)
ui = ui.replace(
    '<div className="sectionHead"><div><h2>Trend Records</h2><p>Same record system used on MLB, adapted for CFB Spread + Total trends</p></div></div>',
    '<div className="sectionHead"><div><h2>Trend Records</h2><p>Same MLB-style record system, using sport-specific football trend history</p></div></div>',
    1,
)
ui = ui.replace(
    '<div className="sectionHead"><div><h2>Bet Type Records</h2><p>Spread and Total Best Play performance</p></div></div>',
    '<div className="sectionHead"><div><h2>Bet Type Records</h2><p>{sport === "NFL" ? "Exact A/B grade + market + direction subsets used by HOT / COLD / SMALL SAMPLE" : "Spread and Total Best Play performance"}</p></div></div>',
    1,
)
ui = ui.replace(
    '<FbRecordDropdown title="Last 7 Days Best Plays" subtitle="Spread + Total qualified model records" rows={data.last7RecordSummary || []} defaultOpen />',
    '<FbRecordDropdown title="Last 7 Days Best Plays" subtitle={sport === "NFL" ? "Exact NFL grade / market / direction records" : "Spread + Total qualified model records"} rows={data.last7RecordSummary || []} defaultOpen />',
    1,
)
ui = ui.replace(
    '<FbRecordDropdown title="Overall Best Plays" subtitle="Running Spread + Total records" rows={data.recordSummary || []} />',
    '<FbRecordDropdown title="Overall Best Plays" subtitle={sport === "NFL" ? "Running exact NFL grade / market / direction records" : "Running Spread + Total records"} rows={data.recordSummary || []} />',
    1,
)
ui = ui.replace('Good / Strong / Elite CFB trend history', 'Good / Strong / Elite football trend history')
ui_path.write_text(ui, encoding="utf-8")

print("Applied approved records repair: combined NFL game + prop records and exact grade/market/direction subsets.")
