import fs from "node:fs";

function replaceOnce(text, oldText, newText, label) {
  if (text.includes(newText)) return text;
  const count = text.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${label}: expected 1 target, found ${count}`);
  return text.replace(oldText, newText);
}

function insertBefore(text, marker, addition, label) {
  if (text.includes(addition.trim().slice(0, 80))) return text;
  const index = text.indexOf(marker);
  if (index < 0) throw new Error(`${label}: marker not found`);
  return text.slice(0, index) + addition + "\n\n" + text.slice(index);
}

function replaceBetween(text, startMarker, endMarker, replacement, label) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) throw new Error(`${label}: markers not found`);
  return text.slice(0, start) + replacement + text.slice(end);
}

const backendPath = "lib/footballPublicData.ts";
let backend = fs.readFileSync(backendPath, "utf8");

const backendHelpers = `const FOOTBALL_TRACKER_HEADERS = [
  "Date", "Season", "Week", "Game ID", "Game", "Bet Type", "Selection", "Odds/Line",
  "Model Probability", "Push Probability", "Implied Probability", "Edge", "Expected Value",
  "Grade", "Confluence", "Result", "Units", "Closing Line", "Closing Line Value", "Reliability",
  "Data Confidence", "Personnel Confidence", "Projected Away", "Projected Home", "Actual Away",
  "Actual Home", "Margin Residual", "Total Residual", "Model Version", "Notes",
];

function trackerLine(value: unknown) {
  const match = String(value || "").replace(/[−–—]/g, "-").match(/([+-]?\\d+(?:\\.\\d+)?)\\s*$/);
  const number = match ? Number(match[1]) : NaN;
  return Number.isFinite(number) ? number : null;
}

function trackerKey(row: SheetRow) {
  return [isoDate(row.Date), String(row["Game ID"] || row["Game Key"] || ""), textKey(row["Bet Type"] || row.Market), textKey(row.Selection)].join("|");
}

function trackerFinal(row: SheetRow, schedule: SheetRow[], sport: FootballSport) {
  const rowId = String(row["Game ID"] || row["Game Key"] || "").trim();
  return schedule.find((game) => {
    const complete = truthy(game.Completed) || (String(game["Away Score"] ?? "") !== "" && String(game["Home Score"] ?? "") !== "");
    if (!complete) return false;
    const gameId = String(game["Game ID"] || game["Game Key"] || "").trim();
    if (rowId && gameId) return rowId === gameId;
    return sameTeam(row["Away Team"], game["Away Team"], sport) && sameTeam(row["Home Team"], game["Home Team"], sport);
  });
}

function settleBestPlayTracker(rows: SheetRow[], schedule: SheetRow[], sport: FootballSport) {
  const changed: SheetRow[] = [];
  const settled = rows.map((row) => {
    if (resultCode(row.Result || row.Status)) return row;
    const game = trackerFinal(row, schedule, sport);
    if (!game) return row;
    const away = Number(game["Away Score"]), home = Number(game["Home Score"]);
    if (!Number.isFinite(away) || !Number.isFinite(home)) return row;
    const market = textKey(row["Bet Type"] || row.Market);
    const selection = String(row.Selection || "").trim();
    const line = trackerLine(selection);
    if (line == null) return row;
    let result = "";
    if (market.includes("spread")) {
      const team = selection.replace(/\\s+[+-]?\\d+(?:\\.\\d+)?\\s*$/, "").trim();
      const isHome = sameTeam(team, game["Home Team"], sport);
      const isAway = sameTeam(team, game["Away Team"], sport);
      if (!isHome && !isAway) return row;
      const value = (isHome ? home - away : away - home) + line;
      result = value > 0 ? "Win" : value < 0 ? "Loss" : "Push";
    } else if (market.includes("total")) {
      const value = away + home - line;
      const side = textKey(selection).startsWith("under") ? "under" : textKey(selection).startsWith("over") ? "over" : "";
      if (!side) return row;
      result = Math.abs(value) < 1e-9 ? "Push" : side === "under" ? (value < 0 ? "Win" : "Loss") : (value > 0 ? "Win" : "Loss");
    } else return row;
    const code = resultCode(result);
    const odds = parseOdds(row["Odds/Line"] || row.Odds || -110);
    const units = code === "W" ? profitUnits(odds) : code === "L" ? -1 : 0;
    const updated = { ...row, Result: result, Units: String(Math.round(units * 10000) / 10000), "Actual Away": String(away), "Actual Home": String(home) };
    changed.push(updated);
    return updated;
  });
  return { settled, changed };
}`;
backend = insertBefore(backend, "function recordTotals", backendHelpers, "best-play tracker settlement helpers");
backend = replaceOnce(
  backend,
  '  const [slateAll,tracker,schedule,trendExisting,snapshotExisting]=await Promise.all([',
  '  const [slateAll,trackerRaw,schedule,trendExisting,snapshotExisting]=await Promise.all([',
  "rename football tracker source",
);
const settleAnchor = '  let trendRows=settleTrendRows(trendExisting,footballSchedule,sport);';
const settleWiring = settleAnchor + '\n  const trackerSettlement=settleBestPlayTracker(trackerRaw,footballSchedule,sport); const tracker=trackerSettlement.settled;\n  if(trackerSettlement.changed.length) await upsertSportRows(sport,"bet_tracker",FOOTBALL_TRACKER_HEADERS,trackerSettlement.changed,trackerKey);';
backend = replaceOnce(backend, settleAnchor, settleWiring, "wire completed football Best Play grading");
fs.writeFileSync(backendPath, backend);

const boardPath = "app/FootballBoard.tsx";
let board = fs.readFileSync(boardPath, "utf8");

const signalType = `type FootballSignalHistoryRow = {
  date: string; market: "Spread" | "Total"; sideGroup: string; signalKey: string;
  result: "W" | "L" | "P"; odds: number; units: number;
};`;
board = insertBefore(board, "type FootballData = {", signalType, "football record signal type");
board = replaceOnce(
  board,
  '  betTrackerRows?: SheetRow[]; trendPlays?: TrendPlay[]; recordSummary?: Summary[];\n  last7RecordSummary?: Summary[]; aiSelectorStatus?: { message?: string };',
  '  betTrackerRows?: SheetRow[]; trendRecordRows?: SheetRow[]; draftKingsSignalRows?: FootballSignalHistoryRow[];\n  trendPlays?: TrendPlay[]; recordSummary?: Summary[];\n  last7RecordSummary?: Summary[]; aiSelectorStatus?: { message?: string };',
  "football records response fields",
);

const recordComponents = `function fbResult(value: unknown) {
  const key = String(value || "").trim().toUpperCase();
  if (["W", "WIN", "WON"].includes(key)) return "W";
  if (["L", "LOSS", "LOST"].includes(key)) return "L";
  if (["P", "PUSH"].includes(key)) return "P";
  return "";
}

function fbDate(value: unknown) {
  const raw = String(value || "");
  const match = raw.match(/(20\\d{2})[-/](\\d{1,2})[-/](\\d{1,2})/);
  return match ? match[1] + "-" + match[2].padStart(2, "0") + "-" + match[3].padStart(2, "0") : raw;
}

function fbWithin(date: unknown, today: string, days = 0) {
  if (!days) return true;
  const end = Date.parse(today + "T12:00:00Z"), start = Date.parse(fbDate(date) + "T12:00:00Z");
  if (!Number.isFinite(end) || !Number.isFinite(start)) return false;
  const diff = Math.round((end - start) / 86400000);
  return diff >= 0 && diff < days;
}

function fbOdds(value: unknown) {
  const match = String(value || "").replace(/−/g, "-").match(/[+-]?\\d{3,4}/);
  const number = match ? Number(match[0]) : -110;
  return Number.isFinite(number) ? number : -110;
}

function fbWinUnits(odds: number) { return odds > 0 ? odds / 100 : odds < 0 ? 100 / Math.abs(odds) : 1; }

function fbTotals(rows: SheetRow[], today: string, days = 0, filter?: (row: SheetRow) => boolean): RecordTotals {
  let wins = 0, losses = 0, pushes = 0, units = 0;
  for (const row of rows) {
    if (filter && !filter(row)) continue;
    if (!fbWithin(row.Date, today, days)) continue;
    const result = fbResult(row.Result || row.Status);
    if (!result) continue;
    const odds = fbOdds(row["Public Split Odds"] || row["Odds/Line"] || row.Odds || -110);
    if (result === "W") { wins += 1; units += fbWinUnits(odds); }
    else if (result === "L") { losses += 1; units -= 1; }
    else pushes += 1;
  }
  const totalBets = wins + losses + pushes, decisions = wins + losses;
  return { record: [wins, losses, pushes].join("-"), totalBets, wins, losses, pushes, winPct: decisions ? Math.round(wins / decisions * 1000) / 10 : 0, unitsWon: Math.round(units * 100) / 100, roiPct: totalBets ? Math.round(units / totalBets * 1000) / 10 : 0 };
}

function fbSummary(label: string, totals: RecordTotals): Summary {
  return { betType: label, ...totals, status: totals.wins > totals.losses ? "WINNING" : totals.losses > totals.wins ? "LOSING" : "EVEN" };
}

function FbRecordTable({ rows }: { rows: Summary[] }) {
  return <div className="tableWrap"><table className="recordsTable"><thead><tr><th>Bet Type</th><th>Record</th><th>Win %</th><th>Units</th><th>ROI</th><th>Bets</th></tr></thead><tbody>{rows.map((row) => <tr key={row.betType}><td><strong>{row.betType}</strong></td><td>{row.record}</td><td>{row.winPct.toFixed(1)}%</td><td>{row.unitsWon > 0 ? "+" : ""}{row.unitsWon.toFixed(2)}u</td><td>{row.roiPct > 0 ? "+" : ""}{row.roiPct.toFixed(1)}%</td><td>{row.totalBets}</td></tr>)}</tbody></table></div>;
}

function FbRecordDropdown({ title, subtitle, rows, defaultOpen = false }: { title: string; subtitle: string; rows: Summary[]; defaultOpen?: boolean }) {
  return <details className="recordsDropdown" open={defaultOpen || undefined}><summary className="recordsSummary"><div><div className="recordsSummaryTitle">{title}</div><div className="recordsSummarySub">{subtitle}</div></div><span className="recordsCount">{rows.reduce((sum, row) => sum + row.totalBets, 0)} bets</span></summary>{rows.length ? <FbRecordTable rows={rows} /> : <div className="empty insideDropdown">No completed results yet.</div>}</details>;
}

function fbQualifiedTrend(row: SheetRow) {
  return ["TRUE", "YES", "1"].includes(String(row["Trend Play"] || "").toUpperCase()) && !["", "PASS"].includes(String(row["Trend Tier"] || "").toUpperCase());
}

function FbTrendRecords({ rows, today }: { rows: SheetRow[]; today: string }) {
  const build = (days: number) => [
    fbSummary("All Trend Plays", fbTotals(rows, today, days, fbQualifiedTrend)),
    fbSummary("Elite Trend", fbTotals(rows, today, days, (row) => fbQualifiedTrend(row) && textKey(row["Trend Tier"]) === "elite")),
    fbSummary("Strong Trend", fbTotals(rows, today, days, (row) => fbQualifiedTrend(row) && textKey(row["Trend Tier"]) === "strong")),
    fbSummary("Good Trend", fbTotals(rows, today, days, (row) => fbQualifiedTrend(row) && textKey(row["Trend Tier"]) === "good")),
    fbSummary("Spread Trend", fbTotals(rows, today, days, (row) => fbQualifiedTrend(row) && textKey(row.Market).includes("spread"))),
    fbSummary("Total Trend", fbTotals(rows, today, days, (row) => fbQualifiedTrend(row) && textKey(row.Market).includes("total"))),
  ].filter((row) => row.totalBets > 0);
  return <><FbRecordDropdown title="Trend Tier Records - Last 7 Days" subtitle="Good / Strong / Elite CFB trend history" rows={build(7)} /><FbRecordDropdown title="Trend Tier Records - Overall" subtitle="Running sport-specific trend history" rows={build(0)} /></>;
}

function fbSignalSummaries(rows: FootballSignalHistoryRow[], today: string, days: number) {
  const filtered = rows.filter((row) => fbWithin(row.date, today, days));
  return [...new Set(filtered.map((row) => row.signalKey))].map((key) => {
    const matches = filtered.filter((row) => row.signalKey === key);
    let wins = 0, losses = 0, pushes = 0, units = 0;
    matches.forEach((row) => { if (row.result === "W") wins += 1; else if (row.result === "L") losses += 1; else pushes += 1; units += Number(row.units || 0); });
    const totalBets = wins + losses + pushes, decisions = wins + losses;
    const label = key.toLowerCase().split("_").map((part) => part ? part[0].toUpperCase() + part.slice(1) : "").join(" ");
    return fbSummary(label, { record: [wins, losses, pushes].join("-"), totalBets, wins, losses, pushes, winPct: decisions ? Math.round(wins / decisions * 1000) / 10 : 0, unitsWon: Math.round(units * 100) / 100, roiPct: totalBets ? Math.round(units / totalBets * 1000) / 10 : 0 });
  }).sort((a, b) => b.totalBets - a.totalBets).slice(0, 20);
}

function FbCombinationRecords({ tracker, trends, today }: { tracker: SheetRow[]; trends: SheetRow[]; today: string }) {
  const matched = tracker.filter((play) => {
    if (!fbResult(play.Result || play.Status)) return false;
    const gameId = String(play["Game ID"] || play["Game Key"] || "");
    const market = textKey(play["Bet Type"] || play.Market).includes("total") ? "total" : "spread";
    const selection = textKey(String(play.Selection || "").replace(/\\s+[+-]?\\d+(?:\\.\\d+)?\\s*$/, ""));
    return trends.some((trend) => {
      if (!fbQualifiedTrend(trend) || !fbResult(trend.Result)) return false;
      const trendId = String(trend["Game Key"] || trend["Game ID"] || "");
      if (gameId && trendId && gameId !== trendId) return false;
      if (textKey(trend.Market) !== market) return false;
      const trendSelection = textKey(market === "total" ? trend.Side || trend.Selection : trend.Selection);
      return market === "total" ? textKey(play.Selection).startsWith(trendSelection) : Boolean(selection && trendSelection && (selection.includes(trendSelection) || trendSelection.includes(selection)));
    });
  });
  const rows = [fbSummary("Model + Trend Match", fbTotals(matched, today)), fbSummary("Spread + Trend", fbTotals(matched, today, 0, (row) => textKey(row["Bet Type"] || row.Market).includes("spread"))), fbSummary("Total + Trend", fbTotals(matched, today, 0, (row) => textKey(row["Bet Type"] || row.Market).includes("total")))].filter((row) => row.totalBets > 0);
  return <FbRecordDropdown title="Combination Records" subtitle="Best Plays that also matched a qualified Trend Play" rows={rows} />;
}

function FbRecentResults({ rows }: { rows: SheetRow[] }) {
  const completed = rows.filter((row) => fbResult(row.Result || row.Status)).sort((a, b) => String(b.Date || "").localeCompare(String(a.Date || ""))).slice(0, 25);
  return <details className="recordsDropdown"><summary className="recordsSummary"><div><div className="recordsSummaryTitle">Recent Graded Plays</div><div className="recordsSummarySub">The individual Best Plays behind the record</div></div><span className="recordsCount">{completed.length} results</span></summary>{completed.length ? <div className="tableWrap"><table className="recordsTable"><thead><tr><th>Date</th><th>Game</th><th>Type</th><th>Play</th><th>Result</th><th>Units</th></tr></thead><tbody>{completed.map((row, index) => <tr key={[row.Date, row["Game ID"], row["Bet Type"], row.Selection, index].join("-")}><td>{row.Date}</td><td>{row.Game}</td><td>{row["Bet Type"] || row.Market}</td><td><strong>{row.Selection}</strong></td><td>{row.Result}</td><td>{Number(row.Units || 0) > 0 ? "+" : ""}{Number(row.Units || 0).toFixed(2)}u</td></tr>)}</tbody></table></div> : <div className="empty insideDropdown">Completed Best Plays will populate here automatically.</div>}</details>;
}`;
board = insertBefore(board, "function BestPlayCard(", recordComponents, "CFB records components");

const recordsStart = '  } else {\n    content = <>\n      <div className="fbRecordsGrid">';
const recordsEnd = '\n  const displayTab =';
if (!board.includes('recordsSummaryTitle">Combination Records')) {
  const recordsPage = `  } else {
    const trackerRows = data.betTrackerRows || [];
    const trendRows = data.trendRecordRows || [];
    const overallBest = fbTotals(trackerRows, data.today);
    const last7Best = fbTotals(trackerRows, data.today, 7);
    content = <div className="footballRecordsPage">
      <div className="sectionHead"><div><h2>All Qualified Plays</h2><p>Official graded CFB model plays</p></div></div>
      <div className="qualifiedGrid">
        <RecordTile label="Best Plays - Last 7 Days" value={last7Best} />
        <RecordTile label="Best Plays - Running Total" value={overallBest} />
        <RecordTile label="Spread - Running Total" value={summaryMap.get("Spread")} />
        <RecordTile label="Total - Running Total" value={summaryMap.get("Total")} />
      </div>
      <div className="sectionHead"><div><h2>Trend Records</h2><p>Same record system used on MLB, adapted for CFB Spread + Total trends</p></div></div>
      <div className="advancedRecordsStack">
        <FbTrendRecords rows={trendRows} today={data.today} />
        <FbCombinationRecords tracker={trackerRows} trends={trendRows} today={data.today} />
        <FbRecordDropdown title="DraftKings Market Signals - Last 7 Days" subtitle="Bets / handle and line-movement signal history" rows={fbSignalSummaries(data.draftKingsSignalRows || [], data.today, 7)} />
        <FbRecordDropdown title="DraftKings Market Signals - Overall" subtitle="Running CFB market-signal record" rows={fbSignalSummaries(data.draftKingsSignalRows || [], data.today, 0)} />
      </div>
      <div className="sectionHead"><div><h2>Bet Type Records</h2><p>Spread and Total Best Play performance</p></div></div>
      <div className="advancedRecordsStack">
        <FbRecordDropdown title="Last 7 Days Best Plays" subtitle="Spread + Total qualified model records" rows={data.last7RecordSummary || []} defaultOpen />
        <FbRecordDropdown title="Overall Best Plays" subtitle="Running Spread + Total records" rows={data.recordSummary || []} />
        <FbRecentResults rows={trackerRows} />
      </div>
      <div className="card fbInfo"><b>Record grading database:</b> {data.database || (sport + " Model Database")}<br />Best Plays and trend signals are graded only after a completed game has a verified final score.</div>
    </div>;
  }
`;
  board = replaceBetween(board, recordsStart, recordsEnd, recordsPage, "MLB-style football records page");
}
fs.writeFileSync(boardPath, board);
console.log("Applied stable MLB-style CFB Records page and automatic Best Play final grading.");
