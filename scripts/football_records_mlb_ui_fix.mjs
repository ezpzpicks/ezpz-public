import fs from "node:fs";

function replaceOnce(text, oldText, newText, label) {
  if (text.includes(newText)) return text;
  const count = text.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${label}: expected 1 target, found ${count}`);
  return text.replace(oldText, newText);
}

function insertBefore(text, marker, addition, label) {
  if (text.includes(addition.trim().slice(0, 96))) return text;
  const index = text.indexOf(marker);
  if (index < 0) throw new Error(`${label}: marker not found`);
  return text.slice(0, index) + addition + "\n\n" + text.slice(index);
}

// Enrich football signal-history rows so the CFB records controls can use the
// same Period / Market / Tracking Set / Side / Model Version filters as MLB.
const backendPath = "lib/footballPublicData.ts";
let backend = fs.readFileSync(backendPath, "utf8");

backend = replaceOnce(
  backend,
  `type SignalHistoryRow = {
  date: string;
  market: FootballMarket;
  sideGroup: TrendPlay["sideGroup"];
  signalKey: string;
  result: ResultCode;
  odds: number;
  units: number;
};`,
  `type SignalHistoryRow = {
  date: string;
  market: FootballMarket;
  sideGroup: TrendPlay["sideGroup"];
  betType: string;
  modelVersion: string;
  qualified: boolean;
  signalType: "Public Split" | "Line Movement";
  signalKey: string;
  signal: string;
  tone: Tone;
  result: ResultCode;
  odds: number;
  units: number;
};`,
  "enrich football signal-history type",
);

backend = replaceOnce(
  backend,
  `      for (const signal of play.signals || []) output.push({ date: isoDate(row.Date) || play.date, market: play.market, sideGroup: play.sideGroup, signalKey: signal.signalKey, result, odds, units: result === "P" ? 0 : result === "L" ? -1 : profitUnits(odds) });`,
  `      for (const signal of play.signals || []) output.push({
        date: isoDate(row.Date) || play.date,
        market: play.market,
        sideGroup: play.sideGroup,
        betType: String(row["Model Grade"] || row.Grade || play.market || ""),
        modelVersion: String(row["Model Version"] || play.gradingVersion || ""),
        qualified: ["TRUE", "YES", "1"].includes(String(row["Trend Play"] || row.Qualified || "").toUpperCase()) && !["", "PASS"].includes(String(row["Trend Tier"] || "").toUpperCase()),
        signalType: signal.signalType,
        signalKey: signal.signalKey,
        signal: signal.signal,
        tone: signal.tone,
        result,
        odds,
        units: result === "P" ? 0 : result === "L" ? -1 : profitUnits(odds),
      });`,
  "populate football signal-history metadata",
);

fs.writeFileSync(backendPath, backend);

const boardPath = "app/FootballBoard.tsx";
let board = fs.readFileSync(boardPath, "utf8");

board = replaceOnce(
  board,
  `type FootballSignalHistoryRow = {
  date: string; market: "Spread" | "Total"; sideGroup: string; signalKey: string;
  result: "W" | "L" | "P"; odds: number; units: number;
};`,
  `type FootballSignalHistoryRow = {
  date: string;
  market: "Spread" | "Total";
  sideGroup: "Favorite" | "Underdog" | "Over" | "Under" | "";
  betType: string;
  modelVersion: string;
  qualified: boolean;
  signalType: "Public Split" | "Line Movement";
  signalKey: string;
  signal: string;
  tone: "negative" | "caution" | "positive" | "neutral";
  result: "W" | "L" | "P";
  odds: number;
  units: number;
};`,
  "enrich CFB signal-history UI type",
);

const mlbStyleComponents = `function FbTrendRecordExplorer({ rows, today }: { rows: SheetRow[]; today: string }) {
  const [period, setPeriod] = useState<"all" | "30" | "7">("all");
  const [market, setMarket] = useState<"All" | "Spread" | "Total">("All");
  const days = period === "7" ? 7 : period === "30" ? 30 : 0;
  const marketOkay = (row: SheetRow) => market === "All" || textKey(row.Market) === textKey(market);
  const qualified = (row: SheetRow) => fbQualifiedTrend(row) && marketOkay(row);
  const summaries = [
    fbSummary("All Trend Plays", fbTotals(rows, today, days, qualified)),
    fbSummary("Elite Trend", fbTotals(rows, today, days, (row) => qualified(row) && textKey(row["Trend Tier"]) === "elite")),
    fbSummary("Strong Trend", fbTotals(rows, today, days, (row) => qualified(row) && textKey(row["Trend Tier"]) === "strong")),
    fbSummary("Good Trend", fbTotals(rows, today, days, (row) => qualified(row) && textKey(row["Trend Tier"]) === "good")),
  ].filter((row) => row.totalBets > 0);
  return (
    <details className="recordsDropdown fbMlbRecordsDropdown">
      <summary className="recordsSummary">
        <div><div className="recordsSummaryTitle">Trend Tier Records</div><div className="recordsSummarySub">Good / Strong / Elite CFB trend history</div></div>
        <span className="recordsCount">{summaries.find((row) => row.betType === "All Trend Plays")?.totalBets || 0} plays</span>
      </summary>
      <div className="fbMlbRecordsBody">
        <div className="fbMlbRecordFilters twoFilters">
          <label><span>Period</span><select value={period} onChange={(event) => setPeriod(event.target.value as "all" | "30" | "7")}><option value="all">Overall</option><option value="30">Last 30 Days</option><option value="7">Last 7 Days</option></select></label>
          <label><span>Market</span><select value={market} onChange={(event) => setMarket(event.target.value as "All" | "Spread" | "Total")}><option>All</option><option>Spread</option><option>Total</option></select></label>
        </div>
        {summaries.length ? <FbRecordTable rows={summaries} /> : <div className="empty insideDropdown">No completed qualified Trend Plays are available for these filters yet.</div>}
      </div>
    </details>
  );
}

function fbSignalTone(row: Summary) {
  if (!row.totalBets) return "neutral";
  if (row.winPct >= 55 || row.roiPct > 5) return "positive";
  if (row.winPct <= 45 || row.roiPct < -5) return "negative";
  return "neutral";
}

function FbDraftKingsSignalRecords({ rows, today }: { rows: FootballSignalHistoryRow[]; today: string }) {
  const [period, setPeriod] = useState<"all" | "30" | "7">("all");
  const [market, setMarket] = useState<"All" | "Spread" | "Total">("All");
  const [scope, setScope] = useState<"Qualified" | "All">("All");
  const [side, setSide] = useState<"All" | "Favorite" | "Underdog" | "Over" | "Under">("All");
  const [modelVersion, setModelVersion] = useState("All");
  const days = period === "7" ? 7 : period === "30" ? 30 : 0;
  const versions = ["All", ...Array.from(new Set(rows.map((row) => String(row.modelVersion || "").trim()).filter(Boolean))).sort().reverse()];
  const filtered = rows.filter((row) => {
    if (!fbWithin(row.date, today, days)) return false;
    if (market !== "All" && row.market !== market) return false;
    if (scope === "Qualified" && !row.qualified) return false;
    if (side !== "All" && row.sideGroup !== side) return false;
    if (modelVersion !== "All" && row.modelVersion !== modelVersion) return false;
    return true;
  });
  const keys = [...new Set(filtered.map((row) => row.signalKey))];
  const summaries = keys.map((key) => {
    const matching = filtered.filter((row) => row.signalKey === key);
    let wins = 0, losses = 0, pushes = 0, unitsWon = 0;
    matching.forEach((row) => { if (row.result === "W") wins += 1; else if (row.result === "L") losses += 1; else pushes += 1; unitsWon += Number(row.units || 0); });
    const totalBets = wins + losses + pushes;
    const decisions = wins + losses;
    const sample = matching[0];
    const label = String(sample?.signal || key).replace(/_/g, " ").replace(/\s+/g, " ").trim();
    return {
      summary: fbSummary(label, { record: [wins, losses, pushes].join("-"), totalBets, wins, losses, pushes, winPct: decisions ? Math.round(wins / decisions * 1000) / 10 : 0, unitsWon: Math.round(unitsWon * 100) / 100, roiPct: totalBets ? Math.round(unitsWon / totalBets * 1000) / 10 : 0 }),
      signalType: sample?.signalType || "Public Split",
    };
  }).sort((a, b) => b.summary.totalBets - a.summary.totalBets || a.summary.betType.localeCompare(b.summary.betType));
  return (
    <details className="recordsDropdown dkSignalRecordsDropdown fbMlbRecordsDropdown" open>
      <summary className="recordsSummary">
        <div><div className="recordsSummaryTitle">DraftKings Market Signals</div><div className="recordsSummarySub">Historical Bets / Handle and line-movement signal records</div></div>
        <span className="recordsCount">{summaries.length} signals</span>
      </summary>
      <div className="fbMlbRecordsBody">
        <div className="fbMlbRecordFilters">
          <label><span>Period</span><select value={period} onChange={(event) => setPeriod(event.target.value as "all" | "30" | "7")}><option value="all">Overall</option><option value="30">Last 30 Days</option><option value="7">Last 7 Days</option></select></label>
          <label><span>Market</span><select value={market} onChange={(event) => setMarket(event.target.value as "All" | "Spread" | "Total")}><option>All</option><option>Spread</option><option>Total</option></select></label>
          <label><span>Tracking Set</span><select value={scope} onChange={(event) => setScope(event.target.value as "Qualified" | "All")}><option value="All">All Tracked Sides</option><option value="Qualified">Qualified Plays</option></select></label>
          <label><span>Side</span><select value={side} onChange={(event) => setSide(event.target.value as "All" | "Favorite" | "Underdog" | "Over" | "Under")}><option>All</option><option>Favorite</option><option>Underdog</option><option>Over</option><option>Under</option></select></label>
          <label><span>Model Version</span><select value={modelVersion} onChange={(event) => setModelVersion(event.target.value)}>{versions.map((version) => <option key={version} value={version}>{version}</option>)}</select></label>
        </div>
        {summaries.length ? (
          <div className="tableWrap fbSignalTableWrap">
            <table className="recordsTable fbSignalTable">
              <thead><tr><th>Signal</th><th>Type</th><th>Record</th><th>Win %</th><th>Units</th><th>ROI</th><th>Bets</th></tr></thead>
              <tbody>{summaries.map(({ summary, signalType }) => <tr key={summary.betType}><td><span className={"fbSignalPill " + fbSignalTone(summary)}>{summary.betType}</span></td><td><strong>{signalType === "Public Split" ? "Bets / Handle" : "Line Movement"}</strong></td><td>{summary.record}</td><td>{summary.winPct.toFixed(1)}%</td><td>{summary.unitsWon > 0 ? "+" : ""}{summary.unitsWon.toFixed(2)}u</td><td>{summary.roiPct > 0 ? "+" : ""}{summary.roiPct.toFixed(1)}%</td><td>{summary.totalBets}</td></tr>)}</tbody>
            </table>
          </div>
        ) : <div className="empty insideDropdown">No completed DraftKings signal history is available for these filters yet.</div>}
      </div>
    </details>
  );
}`;

board = insertBefore(board, "function BestPlayCard(", mlbStyleComponents, "MLB-style CFB records controls");

board = replaceOnce(
  board,
  `      <div className="advancedRecordsStack">
        <FbTrendRecords rows={trendRows} today={data.today} />
        <FbCombinationRecords tracker={trackerRows} trends={trendRows} today={data.today} />
        <FbRecordDropdown title="DraftKings Market Signals - Last 7 Days" subtitle="Bets / handle and line-movement signal history" rows={fbSignalSummaries(data.draftKingsSignalRows || [], data.today, 7)} />
        <FbRecordDropdown title="DraftKings Market Signals - Overall" subtitle="Running CFB market-signal record" rows={fbSignalSummaries(data.draftKingsSignalRows || [], data.today, 0)} />
      </div>`,
  `      <div className="advancedRecordsStack">
        <FbTrendRecordExplorer rows={trendRows} today={data.today} />
        <FbCombinationRecords tracker={trackerRows} trends={trendRows} today={data.today} />
      </div>
      <div className="advancedRecordsStack">
        <FbDraftKingsSignalRecords rows={data.draftKingsSignalRows || []} today={data.today} />
      </div>`,
  "replace split CFB trend/signal records with MLB-style controls",
);

const styleMarker = '      `}</style>';
const styles = `
        .footballRecordsPage{width:100%;max-width:100%;min-width:0;overflow-x:hidden}.footballRecordsPage>*{min-width:0}.footballRecordsPage .sectionHead,.footballRecordsPage .advancedRecordsStack,.footballRecordsPage .recordsDropdown{width:100%;max-width:100%;min-width:0}.footballRecordsPage .recordsSummary{min-width:0}.footballRecordsPage .recordsSummary>div{min-width:0}.footballRecordsPage .recordsSummaryTitle,.footballRecordsPage .recordsSummarySub{overflow-wrap:anywhere}
        .fbMlbRecordsBody{display:grid;gap:14px;padding:14px 16px 16px;min-width:0}.fbMlbRecordFilters{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;min-width:0}.fbMlbRecordFilters.twoFilters{grid-template-columns:repeat(2,minmax(0,1fr))}.fbMlbRecordFilters label{display:grid;gap:6px;min-width:0}.fbMlbRecordFilters label span{color:var(--ez-muted);font-size:.72rem;font-weight:850;letter-spacing:.06em;text-transform:uppercase}.fbMlbRecordFilters select{width:100%;max-width:100%;min-width:0;border:1px solid rgba(92,138,202,.28);background:#081427;color:#f3f7ff;border-radius:11px;padding:10px 12px;font-weight:800;outline:none}.fbSignalTableWrap{max-width:100%;overflow-x:auto}.fbSignalTable{min-width:760px}.fbSignalPill{display:inline-flex;max-width:260px;border-radius:999px;padding:6px 10px;font-size:.75rem;font-weight:900;line-height:1.15}.fbSignalPill.positive{color:#a8f0bf;background:rgba(25,126,78,.18);border:1px solid rgba(57,201,120,.28)}.fbSignalPill.negative{color:#ffc0c6;background:rgba(146,34,54,.2);border:1px solid rgba(255,97,116,.28)}.fbSignalPill.neutral{color:#c4d4e8;background:rgba(77,104,140,.16);border:1px solid rgba(121,153,194,.2)}
        @media(max-width:700px){.footballRecordsPage{overflow-x:clip}.fbMlbRecordsBody{padding:12px}.fbMlbRecordFilters,.fbMlbRecordFilters.twoFilters{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.fbMlbRecordFilters label:last-child:nth-child(odd){grid-column:1/-1}.footballRecordsPage .recordsSummary{align-items:flex-start;gap:10px}.footballRecordsPage .recordsCount{flex:0 0 auto;white-space:nowrap}.fbSignalTableWrap,.footballRecordsPage .tableWrap{width:100%;max-width:100%;overflow-x:auto;overscroll-behavior-inline:contain}.footballRecordsPage table{max-width:none}}
`;
if (!board.includes(".fbMlbRecordsBody{display:grid")) {
  const index = board.indexOf(styleMarker);
  if (index < 0) throw new Error("CFB MLB records styles: style marker not found");
  board = board.slice(0, index) + styles + board.slice(index);
}

fs.writeFileSync(boardPath, board);
console.log("CFB Records now uses the MLB records layout, filters, and mobile overflow behavior.");
