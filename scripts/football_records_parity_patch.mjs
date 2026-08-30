import fs from "node:fs";

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

function patchBackend() {
  const path = "lib/footballPublicData.ts";
  let text = fs.readFileSync(path, "utf8");

  const helpers = `const CFB_SCHEDULE_HEADERS = [
  "Season", "Week", "Season Type", "Game Date", "Game Time", "Away Team", "Home Team",
  "Away Conference", "Home Conference", "Away Classification", "Home Classification",
  "Away Score", "Home Score", "Completed", "Neutral Site", "Conference Game", "Venue ID",
  "Stadium", "Location", "Latitude", "Longitude", "Elevation", "Capacity", "Roof", "Surface",
  "Away Rest", "Home Rest", "Away ML", "Home ML", "Opening Home Spread", "Opening Total",
  "Home Spread", "Total", "Line Provider", "Temperature", "Wind", "Precipitation Probability",
  "Weather Source", "Game ID",
];

const FOOTBALL_TRACKER_HEADERS = [
  "Date", "Season", "Week", "Game ID", "Game", "Bet Type", "Selection", "Odds/Line",
  "Model Probability", "Push Probability", "Implied Probability", "Edge", "Expected Value",
  "Grade", "Confluence", "Result", "Units", "Closing Line", "Closing Line Value", "Reliability",
  "Data Confidence", "Personnel Confidence", "Projected Away", "Projected Home", "Actual Away",
  "Actual Home", "Margin Residual", "Total Residual", "Model Version", "Notes",
];

type EspnFinalCompetitor = {
  homeAway?: string;
  score?: string;
  team?: { displayName?: string; shortDisplayName?: string; abbreviation?: string };
};

type EspnFinalEvent = {
  id?: string;
  status?: { type?: { completed?: boolean; state?: string } };
  competitions?: Array<{ competitors?: EspnFinalCompetitor[] }>;
};

const espnFinalCache = new Map<string, { at: number; rows: SheetRow[] }>();

async function loadEspnFinals(date: string, sport: FootballSport) {
  const cacheKey = `${sport}|${date}`;
  const cached = espnFinalCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 240_000) return cached.rows;
  const league = sport === "NCAAF" ? "college-football" : "nfl";
  const url = new URL(`https://site.api.espn.com/apis/site/v2/sports/football/${league}/scoreboard`);
  url.searchParams.set("dates", date.replace(/-/g, ""));
  url.searchParams.set("limit", sport === "NCAAF" ? "1000" : "100");
  const response = await fetch(url, {
    cache: "no-store",
    headers: { "User-Agent": "Mozilla/5.0 (compatible; EZPZ-Picks/1.0; +https://ezpzpicks.com)" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`ESPN ${sport} final-score request failed ${response.status}`);
  const payload = await response.json() as { events?: EspnFinalEvent[] };
  const rows: SheetRow[] = [];
  for (const event of payload.events || []) {
    const completed = event.status?.type?.completed === true || String(event.status?.type?.state || "").toLowerCase() === "post";
    if (!completed) continue;
    const competitors = event.competitions?.[0]?.competitors || [];
    const away = competitors.find((item) => item.homeAway === "away");
    const home = competitors.find((item) => item.homeAway === "home");
    const awayScore = Number(away?.score);
    const homeScore = Number(home?.score);
    if (!Number.isFinite(awayScore) || !Number.isFinite(homeScore)) continue;
    rows.push({
      "Game ID": String(event.id || ""),
      "Away Team": String(away?.team?.displayName || away?.team?.shortDisplayName || away?.team?.abbreviation || ""),
      "Home Team": String(home?.team?.displayName || home?.team?.shortDisplayName || home?.team?.abbreviation || ""),
      "Away Score": String(awayScore),
      "Home Score": String(homeScore),
      Completed: "True",
    });
  }
  espnFinalCache.set(cacheKey, { at: Date.now(), rows });
  return rows;
}

function finalMatch(row: SheetRow, final: SheetRow, sport: FootballSport) {
  const rowId = String(row["Game ID"] || row["Game Key"] || "").trim();
  const finalId = String(final["Game ID"] || final["Game Key"] || "").trim();
  if (rowId && finalId) return rowId === finalId;
  return sameTeam(row["Away Team"], final["Away Team"], sport) && sameTeam(row["Home Team"], final["Home Team"], sport);
}

async function refreshCollegeFinalScores(schedule: SheetRow[], tracker: SheetRow[], trends: SheetRow[], sport: FootballSport) {
  if (sport !== "NCAAF") return schedule;
  const today = todayET();
  const pendingDates = [...new Set([...tracker, ...trends]
    .filter((row) => !resultCode(row.Result || row.Status))
    .map((row) => isoDate(row.Date || row["Game Date"] || ""))
    .filter((date) => date && date <= today)
  )].filter((date) => {
    const stamp = Date.parse(`${date}T12:00:00Z`);
    const now = Date.parse(`${today}T12:00:00Z`);
    return Number.isFinite(stamp) && now - stamp <= 14 * 86_400_000;
  });
  if (!pendingDates.length) return schedule;

  const finals = (await Promise.all(pendingDates.map(async (date) => {
    try { return await loadEspnFinals(date, sport); }
    catch (error) { console.warn(`CFB final-score refresh failed for ${date}`, error); return [] as SheetRow[]; }
  }))).flat();
  if (!finals.length) return schedule;

  const updates: SheetRow[] = [];
  const next = schedule.map((row) => {
    if (truthy(row.Completed) && String(row["Away Score"] ?? "") !== "" && String(row["Home Score"] ?? "") !== "") return row;
    const final = finals.find((candidate) => finalMatch(row, candidate, sport));
    if (!final) return row;
    const updated = { ...row, "Away Score": final["Away Score"], "Home Score": final["Home Score"], Completed: "True" };
    updates.push(updated);
    return updated;
  });
  if (updates.length) {
    await upsertSportRows(sport, "schedule", CFB_SCHEDULE_HEADERS, updates, (row) => String(row["Game ID"] || ""));
  }
  return next;
}

function trailingLine(value: unknown) {
  const match = String(value || "").replace(/[−–—]/g, "-").match(/([+-]?\\d+(?:\\.\\d+)?)\\s*$/);
  const n = match ? Number(match[1]) : NaN;
  return Number.isFinite(n) ? n : null;
}

function trackerRowKey(row: SheetRow) {
  return `${isoDate(row.Date)}|${String(row["Game ID"] || row["Game Key"] || "")}|${textKey(row["Bet Type"] || row.Market)}|${textKey(row.Selection)}`;
}

function settleTrackerRows(rows: SheetRow[], schedule: SheetRow[], sport: FootballSport) {
  const finals = schedule.filter((row) => truthy(row.Completed) || (String(row["Away Score"] ?? "") !== "" && String(row["Home Score"] ?? "") !== ""));
  const changed: SheetRow[] = [];
  const settled = rows.map((row) => {
    if (resultCode(row.Result || row.Status)) return row;
    const game = finals.find((candidate) => finalMatch(row, candidate, sport));
    if (!game) return row;
    const away = Number(game["Away Score"]), home = Number(game["Home Score"]);
    if (!Number.isFinite(away) || !Number.isFinite(home)) return row;
    const betType = textKey(row["Bet Type"] || row.Market);
    const selection = String(row.Selection || "").trim();
    let result = "";
    if (betType.includes("spread")) {
      const line = trailingLine(selection);
      if (line == null) return row;
      const team = selection.replace(/\\s+[+-]?\\d+(?:\\.\\d+)?\\s*$/, "").trim();
      const selectedHome = sameTeam(team, game["Home Team"], sport);
      const selectedAway = sameTeam(team, game["Away Team"], sport);
      if (!selectedHome && !selectedAway) return row;
      const value = (selectedHome ? home - away : away - home) + line;
      result = value > 0 ? "Win" : value < 0 ? "Loss" : "Push";
    } else if (betType.includes("total")) {
      const line = trailingLine(selection);
      if (line == null) return row;
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

  text = insertBefore(text, "function decodeHtmlEntities", helpers, "football final-score helpers");

  const oldRead = '  const [slateAll,tracker,schedule,trendExisting,snapshotExisting]=await Promise.all([readSportWorksheet(sport,"daily_slate"),readSportWorksheet(sport,"bet_tracker"),readSportWorksheet(sport,"schedule"),readSportWorksheet(sport,"all_game_trends",ALL_GAME_TRENDS_HEADERS),readSportWorksheet(sport,"public_split_snapshots",PUBLIC_SPLIT_HEADERS)]);\n  const slate=slateAll.filter((row)=>{const date=isoDate(row.Date||row["Game Date"]||"");return !date||date===today;});\n  const trackingSlate=slateAll.filter((row)=>inFootballTrackingWeek(row,sport,today));\n  let trendRows=settleTrendRows(trendExisting,schedule,sport);';
  const newRead = '  const [slateAll,trackerRaw,scheduleRaw,trendExisting,snapshotExisting]=await Promise.all([readSportWorksheet(sport,"daily_slate"),readSportWorksheet(sport,"bet_tracker"),readSportWorksheet(sport,"schedule"),readSportWorksheet(sport,"all_game_trends",ALL_GAME_TRENDS_HEADERS),readSportWorksheet(sport,"public_split_snapshots",PUBLIC_SPLIT_HEADERS)]);\n  const schedule=await refreshCollegeFinalScores(scheduleRaw,trackerRaw,trendExisting,sport);\n  const trackerSettlement=settleTrackerRows(trackerRaw,schedule,sport); const tracker=trackerSettlement.settled;\n  if(trackerSettlement.changed.length) await upsertSportRows(sport,"bet_tracker",FOOTBALL_TRACKER_HEADERS,trackerSettlement.changed,trackerRowKey);\n  const slate=slateAll.filter((row)=>{const date=isoDate(row.Date||row["Game Date"]||"");return !date||date===today;});\n  const trackingSlate=slateAll.filter((row)=>inFootballTrackingWeek(row,sport,today));\n  let trendRows=settleTrendRows(trendExisting,schedule,sport);';
  if (!text.includes(newRead)) {
    const count = text.split(oldRead).length - 1;
    if (count !== 1) throw new Error(`football settled tracker wiring: expected 1 target, found ${count}`);
    text = text.replace(oldRead, newRead);
  }

  fs.writeFileSync(path, text);
}

function patchBoard() {
  const path = "app/FootballBoard.tsx";
  let text = fs.readFileSync(path, "utf8");

  const signalType = `type FootballSignalHistoryRow = {
  date: string; market: "Spread" | "Total"; sideGroup: string; signalKey: string;
  result: "W" | "L" | "P"; odds: number; units: number;
};`;
  text = insertBefore(text, "type FootballData = {", signalType, "football signal row type");

  const oldFields = '  betTrackerRows?: SheetRow[]; trendPlays?: TrendPlay[]; recordSummary?: Summary[];\n  last7RecordSummary?: Summary[]; aiSelectorStatus?: { message?: string };';
  const newFields = '  betTrackerRows?: SheetRow[]; trendRecordRows?: SheetRow[]; draftKingsSignalRows?: FootballSignalHistoryRow[];\n  trendPlays?: TrendPlay[]; recordSummary?: Summary[];\n  last7RecordSummary?: Summary[]; aiSelectorStatus?: { message?: string };';
  if (!text.includes(newFields)) {
    const count = text.split(oldFields).length - 1;
    if (count !== 1) throw new Error(`football record data fields: expected 1 target, found ${count}`);
    text = text.replace(oldFields, newFields);
  }

  const components = `function footballResult(value: unknown) {
  const key = String(value || "").trim().toUpperCase();
  if (["W", "WIN", "WON"].includes(key)) return "W";
  if (["L", "LOSS", "LOST"].includes(key)) return "L";
  if (["P", "PUSH"].includes(key)) return "P";
  return "";
}

function footballDate(value: unknown) {
  const raw = String(value || "").trim();
  const match = raw.match(/(20\\d{2})[-/](\\d{1,2})[-/](\\d{1,2})/);
  return match ? `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}` : raw;
}

function footballInWindow(date: unknown, today: string, days: number) {
  if (!days) return true;
  const end = Date.parse(`${today}T12:00:00Z`);
  const start = Date.parse(`${footballDate(date)}T12:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return false;
  const diff = Math.round((end - start) / 86_400_000);
  return diff >= 0 && diff < days;
}

function footballOdds(value: unknown) {
  const match = String(value || "").replace(/−/g, "-").match(/[+-]?\\d{3,4}/);
  const n = match ? Number(match[0]) : -110;
  return Number.isFinite(n) ? n : -110;
}

function footballWinUnits(odds: number) { return odds > 0 ? odds / 100 : odds < 0 ? 100 / Math.abs(odds) : 1; }

function footballTotals(rows: SheetRow[], today: string, days = 0, filter?: (row: SheetRow) => boolean): RecordTotals {
  let wins = 0, losses = 0, pushes = 0, units = 0;
  for (const row of rows) {
    if (filter && !filter(row)) continue;
    if (!footballInWindow(row.Date, today, days)) continue;
    const result = footballResult(row.Result || row.Status);
    if (!result) continue;
    const odds = footballOdds(row["Public Split Odds"] || row["Odds/Line"] || row.Odds || -110);
    if (result === "W") { wins += 1; units += footballWinUnits(odds); }
    else if (result === "L") { losses += 1; units -= 1; }
    else pushes += 1;
  }
  const totalBets = wins + losses + pushes;
  const decisions = wins + losses;
  return {
    record: `${wins}-${losses}-${pushes}`, totalBets, wins, losses, pushes,
    winPct: decisions ? Math.round((wins / decisions) * 1000) / 10 : 0,
    unitsWon: Math.round(units * 100) / 100,
    roiPct: totalBets ? Math.round((units / totalBets) * 1000) / 10 : 0,
  };
}

function footballSummary(label: string, totals: RecordTotals): Summary {
  return { betType: label, ...totals, status: totals.wins > totals.losses ? "WINNING" : totals.losses > totals.wins ? "LOSING" : "EVEN" };
}

function FootballRecordsTable({ rows }: { rows: Summary[] }) {
  return (
    <div className="tableWrap footballRecordsTableWrap">
      <table className="recordsTable footballRecordsTable">
        <thead><tr><th>Bet Type</th><th>Record</th><th>Win %</th><th>Units</th><th>ROI</th><th>Bets</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.betType}>
          <td><strong>{row.betType}</strong></td><td>{row.record}</td><td>{row.winPct.toFixed(1)}%</td>
          <td className={row.unitsWon > 0 ? "metricPositive" : row.unitsWon < 0 ? "metricNegative" : ""}>{row.unitsWon > 0 ? "+" : ""}{row.unitsWon.toFixed(2)}u</td>
          <td className={row.roiPct > 0 ? "metricPositive" : row.roiPct < 0 ? "metricNegative" : ""}>{row.roiPct > 0 ? "+" : ""}{row.roiPct.toFixed(1)}%</td>
          <td>{row.totalBets}</td>
        </tr>)}</tbody>
      </table>
    </div>
  );
}

function FootballRecordsDropdown({ title, subtitle, rows, defaultOpen = false }: { title: string; subtitle?: string; rows: Summary[]; defaultOpen?: boolean }) {
  return (
    <details className="recordsDropdown footballRecordsDropdown" open={defaultOpen || undefined}>
      <summary className="recordsSummary"><div><div className="recordsSummaryTitle">{title}</div>{subtitle ? <div className="recordsSummarySub">{subtitle}</div> : null}</div><span className="recordsCount">{rows.reduce((sum, row) => sum + row.totalBets, 0)} bets</span></summary>
      {rows.length ? <FootballRecordsTable rows={rows} /> : <div className="empty insideDropdown">No completed records are available yet.</div>}
    </details>
  );
}

function FootballTrendRecords({ rows, today }: { rows: SheetRow[]; today: string }) {
  const [period, setPeriod] = useState<"all" | "30" | "7">("all");
  const days = period === "7" ? 7 : period === "30" ? 30 : 0;
  const qualified = (row: SheetRow) => ["TRUE", "YES", "1"].includes(String(row["Trend Play"] || "").toUpperCase()) && !["", "PASS"].includes(String(row["Trend Tier"] || "").toUpperCase());
  const summaries = [
    footballSummary("All Trend Plays", footballTotals(rows, today, days, qualified)),
    ...["Elite", "Strong", "Good"].map((tier) => footballSummary(`${tier} Trend`, footballTotals(rows, today, days, (row) => qualified(row) && textKey(row["Trend Tier"]) === textKey(tier)))),
    footballSummary("Spread Trend", footballTotals(rows, today, days, (row) => qualified(row) && textKey(row.Market).includes("spread"))),
    footballSummary("Total Trend", footballTotals(rows, today, days, (row) => qualified(row) && textKey(row.Market).includes("total"))),
  ].filter((row) => row.totalBets > 0);
  return <details className="recordsDropdown footballRecordsDropdown"><summary className="recordsSummary"><div><div className="recordsSummaryTitle">Trend Tier Records</div><div className="recordsSummarySub">Good / Strong / Elite CFB trend results</div></div><span className="recordsCount">{summaries.find((row) => row.betType === "All Trend Plays")?.totalBets || 0} plays</span></summary><div className="footballRecordsBody"><div className="dkRecordFilters"><label><span>Period</span><select value={period} onChange={(event) => setPeriod(event.target.value as "all" | "30" | "7")}><option value="all">Overall</option><option value="30">Last 30 Days</option><option value="7">Last 7 Days</option></select></label></div>{summaries.length ? <FootballRecordsTable rows={summaries} /> : <div className="empty insideDropdown">No completed qualified Trend Plays are available for this period yet.</div>}</div></details>;
}

function looseTeamMatch(a: unknown, b: unknown) {
  const left = textKey(a), right = textKey(b);
  return Boolean(left && right && (left === right || left.includes(right) || right.includes(left)));
}

function FootballCombinationRecords({ trackerRows, trendRows, today }: { trackerRows: SheetRow[]; trendRows: SheetRow[]; today: string }) {
  const [period, setPeriod] = useState<"all" | "30" | "7">("all");
  const days = period === "7" ? 7 : period === "30" ? 30 : 0;
  const matches = trackerRows.flatMap((tracker) => {
    if (!footballResult(tracker.Result || tracker.Status) || !footballInWindow(tracker.Date, today, days)) return [];
    const market = textKey(tracker["Bet Type"] || tracker.Market).includes("total") ? "Total" : "Spread";
    const trackerGame = String(tracker["Game ID"] || tracker["Game Key"] || "");
    const selection = String(tracker.Selection || "").replace(/\\s+[+-]?\\d+(?:\\.\\d+)?\\s*$/, "").trim();
    const trend = trendRows.find((row) => {
      if (!footballResult(row.Result) || !["TRUE", "YES", "1"].includes(String(row["Trend Play"] || "").toUpperCase())) return false;
      if (["", "PASS"].includes(String(row["Trend Tier"] || "").toUpperCase())) return false;
      const trendGame = String(row["Game Key"] || row["Game ID"] || "");
      if (trackerGame && trendGame && trackerGame !== trendGame) return false;
      if (textKey(row.Market) !== textKey(market)) return false;
      return market === "Total" ? textKey(tracker.Selection).startsWith(textKey(row.Side || row.Selection)) : looseTeamMatch(selection, row.Selection);
    });
    return trend ? [{ tracker, tier: String(trend["Trend Tier"] || "") }] : [];
  });
  const rowsFor = (predicate: (match: { tracker: SheetRow; tier: string }) => boolean) => matches.filter(predicate).map((match) => match.tracker);
  const summaries = [
    footballSummary("Model + Trend Match", footballTotals(rowsFor(() => true), today)),
    ...["Elite", "Strong", "Good"].map((tier) => footballSummary(`Model + ${tier} Trend`, footballTotals(rowsFor((match) => textKey(match.tier) === textKey(tier)), today))),
    footballSummary("Spread + Any Trend", footballTotals(rowsFor((match) => textKey(match.tracker["Bet Type"] || match.tracker.Market).includes("spread")), today)),
    footballSummary("Total + Any Trend", footballTotals(rowsFor((match) => textKey(match.tracker["Bet Type"] || match.tracker.Market).includes("total")), today)),
  ].filter((row) => row.totalBets > 0);
  return <details className="recordsDropdown footballRecordsDropdown"><summary className="recordsSummary"><div><div className="recordsSummaryTitle">Combination Records</div><div className="recordsSummarySub">Model Best Plays that also matched a qualified Trend Play</div></div><span className="recordsCount">{matches.length} matched plays</span></summary><div className="footballRecordsBody"><div className="dkRecordFilters"><label><span>Period</span><select value={period} onChange={(event) => setPeriod(event.target.value as "all" | "30" | "7")}><option value="all">Overall</option><option value="30">Last 30 Days</option><option value="7">Last 7 Days</option></select></label></div>{summaries.length ? <FootballRecordsTable rows={summaries} /> : <div className="empty insideDropdown">No completed Model + Trend matches are available for this period yet.</div>}</div></details>;
}

function signalLabel(value: string) { return value.toLowerCase().split("_").filter(Boolean).map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" "); }

function FootballSignalRecords({ rows, today }: { rows: FootballSignalHistoryRow[]; today: string }) {
  const [period, setPeriod] = useState<"all" | "30" | "7">("all");
  const [market, setMarket] = useState<"All" | "Spread" | "Total">("All");
  const days = period === "7" ? 7 : period === "30" ? 30 : 0;
  const filtered = rows.filter((row) => (market === "All" || row.market === market) && footballInWindow(row.date, today, days));
  const keys = [...new Set(filtered.map((row) => row.signalKey))];
  const summaries = keys.map((key) => {
    const matching = filtered.filter((row) => row.signalKey === key);
    let wins = 0, losses = 0, pushes = 0, units = 0;
    for (const row of matching) { if (row.result === "W") wins += 1; else if (row.result === "L") losses += 1; else pushes += 1; units += Number(row.units || 0); }
    const totalBets = wins + losses + pushes, decisions = wins + losses;
    return footballSummary(signalLabel(key), { record: `${wins}-${losses}-${pushes}`, totalBets, wins, losses, pushes, winPct: decisions ? Math.round(wins / decisions * 1000) / 10 : 0, unitsWon: Math.round(units * 100) / 100, roiPct: totalBets ? Math.round(units / totalBets * 1000) / 10 : 0 });
  }).sort((a, b) => b.totalBets - a.totalBets || a.betType.localeCompare(b.betType));
  return <details className="recordsDropdown footballRecordsDropdown"><summary className="recordsSummary"><div><div className="recordsSummaryTitle">DraftKings Market Signals</div><div className="recordsSummarySub">Historical Bets / Handle and line-movement signal records</div></div><span className="recordsCount">{summaries.length} signals</span></summary><div className="footballRecordsBody"><div className="dkRecordFilters"><label><span>Period</span><select value={period} onChange={(event) => setPeriod(event.target.value as "all" | "30" | "7")}><option value="all">Overall</option><option value="30">Last 30 Days</option><option value="7">Last 7 Days</option></select></label><label><span>Market</span><select value={market} onChange={(event) => setMarket(event.target.value as "All" | "Spread" | "Total")}><option>All</option><option>Spread</option><option>Total</option></select></label></div>{summaries.length ? <FootballRecordsTable rows={summaries} /> : <div className="empty insideDropdown">No completed DraftKings signal history is available for these filters yet.</div>}</div></details>;
}

function RecentFootballResults({ rows }: { rows: SheetRow[] }) {
  const completed = rows.filter((row) => footballResult(row.Result || row.Status)).sort((a, b) => String(b.Date || "").localeCompare(String(a.Date || ""))).slice(0, 30);
  return <details className="recordsDropdown footballRecordsDropdown"><summary className="recordsSummary"><div><div className="recordsSummaryTitle">Recent Graded Plays</div><div className="recordsSummarySub">Individual CFB Best Play results used in the records above</div></div><span className="recordsCount">{completed.length} results</span></summary>{completed.length ? <div className="tableWrap footballRecentTableWrap"><table className="recordsTable footballRecentTable"><thead><tr><th>Date</th><th>Game</th><th>Type</th><th>Play</th><th>Result</th><th>Units</th></tr></thead><tbody>{completed.map((row, index) => { const result = footballResult(row.Result || row.Status); const units = Number(row.Units || (result === "W" ? footballWinUnits(footballOdds(row["Odds/Line"] || row.Odds)) : result === "L" ? -1 : 0)); return <tr key={`${row.Date}-${row["Game ID"]}-${row["Bet Type"]}-${row.Selection}-${index}`}><td>{row.Date || "—"}</td><td>{row.Game || "—"}</td><td>{row["Bet Type"] || row.Market || "—"}</td><td><strong>{row.Selection || "—"}</strong></td><td><span className={`footballResultChip ${result === "W" ? "win" : result === "L" ? "loss" : "push"}`}>{row.Result || result}</span></td><td className={units > 0 ? "metricPositive" : units < 0 ? "metricNegative" : ""}>{units > 0 ? "+" : ""}{Number.isFinite(units) ? units.toFixed(2) : "0.00"}u</td></tr>; })}</tbody></table></div> : <div className="empty insideDropdown">Completed Best Plays will appear here automatically as games go final.</div>}</details>;
}`;
  text = insertBefore(text, "function BestPlayCard(", components, "football records components");

  const recordsStart = '  } else {\n    content = <>\n      <div className="fbRecordsGrid">';
  const recordsEnd = '\n  const displayTab =';
  if (!text.includes('recordsSummaryTitle">Trend Tier Records')) {
    const replacement = `  } else {
    const trackerRows = data.betTrackerRows || [];
    const trendRecordRows = data.trendRecordRows || [];
    const overallBest = footballTotals(trackerRows, data.today);
    const last7Best = footballTotals(trackerRows, data.today, 7);
    content = <div className="footballRecordsPage">
      <div className="sectionHead footballRecordsHead"><div><h2>All Qualified Plays</h2><p>Official graded CFB model plays only</p></div></div>
      <div className="qualifiedGrid footballQualifiedGrid">
        <RecordTile label="Best Plays - Last 7 Days" value={last7Best} />
        <RecordTile label="Best Plays - Running Total" value={overallBest} />
        <RecordTile label="Spread - Running Total" value={summaryMap.get("Spread")} />
        <RecordTile label="Total - Running Total" value={summaryMap.get("Total")} />
      </div>

      <div className="sectionHead footballRecordsHead"><div><h2>Trend Records</h2><p>Sport-specific DraftKings trend history</p></div></div>
      <div className="advancedRecordsStack footballAdvancedRecords">
        <FootballTrendRecords rows={trendRecordRows} today={data.today} />
        <FootballCombinationRecords trackerRows={trackerRows} trendRows={trendRecordRows} today={data.today} />
        <FootballSignalRecords rows={data.draftKingsSignalRows || []} today={data.today} />
      </div>

      <div className="sectionHead footballRecordsHead"><div><h2>Bet Type Records</h2><p>Spread and Total Best Play performance</p></div></div>
      <div className="advancedRecordsStack footballAdvancedRecords">
        <FootballRecordsDropdown title="Last 7 Days Best Plays" subtitle="Spread + Total qualified model records" rows={data.last7RecordSummary || []} defaultOpen />
        <FootballRecordsDropdown title="Overall Best Plays" subtitle="Running Spread + Total records" rows={data.recordSummary || []} />
        <RecentFootballResults rows={trackerRows} />
      </div>
      <div className="card fbInfo"><b>Record grading database:</b> {data.database || `${sport} Model Database`}<br />Best Plays, trend tiers, market signals, and Model + Trend combinations are graded only from this sport’s own completed history.</div>
    </div>;
  }
`;
    text = replaceBetween(text, recordsStart, recordsEnd, replacement, "football MLB-style records page");
  }

  const styleMarker = '      `}</style>';
  const styles = `
        .footballRecordsPage{display:grid;gap:18px}.footballRecordsHead{margin:2px 0 -4px}.footballRecordsHead h2{margin:0 0 4px}.footballRecordsHead p{margin:0;color:var(--ez-muted)}
        .footballQualifiedGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}.footballAdvancedRecords{display:grid;gap:12px}.footballRecordsBody{display:grid;gap:12px;padding-top:12px}
        .footballRecordsTableWrap,.footballRecentTableWrap{overflow-x:auto}.footballRecordsTable,.footballRecentTable{min-width:680px;width:100%}.footballRecentTable{min-width:820px}.footballRecordsDropdown .recordsSummary{gap:12px}
        .footballResultChip{display:inline-flex;border-radius:999px;padding:4px 8px;font-size:.72rem;font-weight:900}.footballResultChip.win{color:#5de28f;background:rgba(43,216,117,.1)}.footballResultChip.loss{color:#ff8a8a;background:rgba(255,90,90,.1)}.footballResultChip.push{color:#b5c4d8;background:rgba(150,170,200,.1)}
        @media(max-width:720px){.footballQualifiedGrid{grid-template-columns:1fr}.footballRecordsPage{gap:15px}.footballRecordsHead h2{font-size:1.35rem}.footballRecordsDropdown .recordsSummary{align-items:flex-start}.footballRecordsDropdown .recordsCount{white-space:nowrap}}
`;
  if (!text.includes('.footballRecordsPage{display:grid')) {
    const index = text.indexOf(styleMarker);
    if (index < 0) throw new Error("football records styles: style marker not found");
    text = text.slice(0, index) + styles + text.slice(index);
  }

  fs.writeFileSync(path, text);
}

patchBackend();
patchBoard();
console.log("Football Records now mirrors MLB structure and grades completed CFB games from refreshed finals.");
