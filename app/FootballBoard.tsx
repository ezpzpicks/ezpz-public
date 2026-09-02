"use client";

import { useEffect, useMemo, useState } from "react";

type SheetRow = Record<string, string>;
type Tab = "Today’s Model Plays" | "Today’s Trend Plays" | "EZPZ Picks" | "Full Slate" | "Records";
type Sport = "NFL" | "NCAAF";

type RecordTotals = {
  record: string; totalBets: number; winPct: number; unitsWon: number; roiPct: number;
  wins: number; losses: number; pushes: number;
};

type Summary = RecordTotals & { betType: string; status: "WINNING" | "EVEN" | "LOSING" };

type Play = {
  playType: string; game: string; play: string; oddsLine: string; score: string | number;
  awayTeam: string; homeTeam: string; reliability?: string | number; role?: string;
};

type TrendSignal = {
  signal: string; score: number; exactSample: number; recordScope: string;
  records: { allTime: RecordTotals; last30: RecordTotals; last7: RecordTotals };
};

type TrendPlay = {
  date?: string; week?: string;
  game: string; gameKey: string; gameTime?: string; market: "Spread" | "Total"; selection: string;
  selectionTeam: string; side: "Over" | "Under" | ""; sideGroup?: string; line: number | null; odds: string;
  betsPct: number; moneyPct: number; gapPct: number; openingBetsPct?: number; openingMoneyPct?: number;
  publicMovementPct?: number; sharpMovementPct?: number; openingLine?: number | null; openingOdds?: string;
  openingImpliedPct?: number | null; currentImpliedPct?: number | null;
  comparisonGap?: number; opponentScore?: number | null; updatedAt?: string; frozenAt?: string;
  lockWarning?: string;
  snapshotStatus?: "LIVE" | "FINAL_PREGAME" | "MISSED_LOCK";
  score: number; tier: "Pass" | "Good" | "Strong" | "Elite";
  signals: TrendSignal[]; lineMovementSignal?: string; lineMovementBasis?: string; lineMovementValue?: number | null;
};


type EzpzPick = {
  source: "Best Play" | "Trend Play" | "Best + Trend";
  game: string;
  market: "Spread" | "Total";
  selection: string;
  odds: string;
  score: number;
  tier: string;
  qualification: string;
  record?: string;
};

type DraftKingsSplit = {
  game: string; awayTeam?: string; homeTeam?: string; market: "Spread" | "Total"; selection: string; selectionTeam: string;
  side: "Over" | "Under" | ""; line: number | null; odds: string; betsPct: number;
  moneyPct: number; gapPct: number; warning: string; lineMovementSignal?: string;
};

type FootballSignalHistoryRow = {
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
};

type FootballData = {
  today: string; lastUpdated: string; database?: string; bestPlays: Play[]; slateToday: SheetRow[];
  betTrackerRows?: SheetRow[]; trendRecordRows?: SheetRow[]; draftKingsSignalRows?: FootballSignalHistoryRow[];
  trendPlays?: TrendPlay[]; aiPicks?: EzpzPick[]; recordSummary?: Summary[];
  last7RecordSummary?: Summary[]; aiSelectorStatus?: { message?: string };
  draftKings?: { status: string; updatedAt: string; splits: DraftKingsSplit[]; errors?: string[] };
};

type WeeklyMarketData = {
  ok: boolean;
  games: SheetRow[];
  trendPlays: TrendPlay[];
  splits: DraftKingsSplit[];
  updatedAt?: string;
};

function pct(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const p = n <= 1 ? n * 100 : n;
  return `${p.toFixed(1)}%`;
}

function num(value: unknown, digits = 1) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : "—";
}

function textKey(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/−/g, "-")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sameSlateTeam(a: unknown, b: unknown) {
  const left = textKey(a);
  const right = textKey(b);
  if (!left || !right) return false;
  if (left === right || left.includes(right) || right.includes(left)) return true;
  const compactLeft = left.replace(/\s+/g, "");
  const compactRight = right.replace(/\s+/g, "");
  if (compactLeft.includes(compactRight) || compactRight.includes(compactLeft)) return true;
  const leftParts = left.split(" ").filter(Boolean);
  const rightParts = right.split(" ").filter(Boolean);
  const leftLast = leftParts[leftParts.length - 1] || "";
  const rightLast = rightParts[rightParts.length - 1] || "";
  return leftLast.length >= 3 && leftLast === rightLast;
}

function splitMatchesTeams(awayTeam: unknown, homeTeam: unknown, split: DraftKingsSplit) {
  return Boolean(split.awayTeam && split.homeTeam &&
    sameSlateTeam(awayTeam, split.awayTeam) && sameSlateTeam(homeTeam, split.homeTeam));
}

function slateIdentity(row: SheetRow) {
  const date = String(row.Date || row["Game Date"] || "").trim();
  const away = textKey(row["Away Team"]);
  const home = textKey(row["Home Team"]);
  if (date && away && home) return `${date}|${away}|${home}`;
  return textKey(row.Game || row["Game Key"] || row["Game ID"] || "");
}

function signedPct(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function marketLine(play: TrendPlay, value: number | null | undefined) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  if (play.market === "Spread") return `${n > 0 ? "+" : ""}${n}`;
  return `${n}`;
}

function impliedPctValue(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.abs(n) <= 1 ? n * 100 : n;
}

function priceMove(play: TrendPlay) {
  const opening = impliedPctValue(play.openingImpliedPct);
  const current = impliedPctValue(play.currentImpliedPct);
  if (opening == null || current == null) return "—";
  const move = current - opening;
  return `${move > 0 ? "+" : ""}${move.toFixed(1)} implied pts`;
}

function scheduledLockTime(gameTime?: string) {
  const raw = String(gameTime || "");
  const match = raw.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return "—";
  let hour = Number(match[1]) % 12;
  if (match[3].toUpperCase() === "PM") hour += 12;
  const total = (hour * 60 + Number(match[2]) - 15 + 1440) % 1440;
  const lockHour24 = Math.floor(total / 60);
  const minute = total % 60;
  const suffix = lockHour24 >= 12 ? "PM" : "AM";
  const lockHour12 = lockHour24 % 12 || 12;
  return `${lockHour12}:${String(minute).padStart(2, "0")} ${suffix} ET`;
}

function gameTimeSortValue(gameTime?: string) {
  const raw = String(gameTime || "");
  const match = raw.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return Number.POSITIVE_INFINITY;
  let hour = Number(match[1]) % 12;
  if (match[3].toUpperCase() === "PM") hour += 12;
  return hour * 60 + Number(match[2]);
}

function compactTimestamp(value?: string) {
  const raw = String(value || "").trim();
  return raw || "—";
}

function selectedSplit(play: Play, splits: DraftKingsSplit[]) {
  const role = textKey(play.role || play.playType);
  const sameGame = (split: DraftKingsSplit) => textKey(split.game) === textKey(play.game) ||
    splitMatchesTeams(play.awayTeam, play.homeTeam, split);
  if (role.includes("total")) {
    const side = textKey(play.play).startsWith("under") ? "Under" : "Over";
    return splits.find((split) => split.market === "Total" && split.side === side && sameGame(split));
  }
  const selection = textKey(String(play.play).replace(/\s+[+-]?\d+(?:\.\d+)?(?:\s|$).*/, ""));
  return splits.find((split) => split.market === "Spread" && sameGame(split) &&
      (textKey(split.selectionTeam) === selection || sameSlateTeam(play.play, split.selectionTeam))) ||
    splits.find((split) => split.market === "Spread" && (textKey(play.play).includes(textKey(split.selectionTeam)) || textKey(split.selectionTeam).includes(selection)));
}

function weekLabel(play: TrendPlay) {
  return String(play.week || "").trim() || "Current Week";
}

function weekSort(label: string) {
  if (label === "Preseason") return -10;
  const match = label.match(/Week\s+(\d+)/i);
  if (match) return Number(match[1]);
  if (label === "Postseason") return 100;
  return 99;
}

function defaultWeek(trends: TrendPlay[], today: string) {
  const dated = [...trends].filter((play) => play.date).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const sameDay = dated.find((play) => play.date === today);
  if (sameDay) return weekLabel(sameDay);
  const next = dated.find((play) => String(play.date) > today);
  if (next) return weekLabel(next);
  if (dated.length) return weekLabel(dated[dated.length - 1]);
  return trends.length ? weekLabel(trends[0]) : "";
}

function defaultStoredWeek(games: SheetRow[], today: string) {
  const dated = [...games].filter((row) => row.Date && row.Week).sort((a, b) => String(a.Date).localeCompare(String(b.Date)));
  const todayGame = dated.find((row) => String(row.Date) === today);
  if (todayGame) return String(todayGame.Week || "");
  const next = dated.find((row) => String(row.Date) > today);
  if (next) return String(next.Week || "");
  return dated.length ? String(dated[dated.length - 1].Week || "") : "";
}

function RecordTile({ label, value }: { label: string; value: RecordTotals | undefined }) {
  const record = value || { record: "0-0-0", totalBets: 0, winPct: 0, unitsWon: 0, roiPct: 0, wins: 0, losses: 0, pushes: 0 };
  return (
    <div className="card fbRecordTile">
      <span>{label}</span>
      <strong>{record.record}</strong>
      <small>{record.winPct.toFixed(1)}% • {record.unitsWon.toFixed(2)}u • ROI {record.roiPct.toFixed(1)}%</small>
    </div>
  );
}

function fbResult(value: unknown) {
  const key = String(value || "").trim().toUpperCase();
  if (["W", "WIN", "WON"].includes(key)) return "W";
  if (["L", "LOSS", "LOST"].includes(key)) return "L";
  if (["P", "PUSH"].includes(key)) return "P";
  return "";
}

function fbDate(value: unknown) {
  const raw = String(value || "");
  const match = raw.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
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
  const match = String(value || "").replace(/−/g, "-").match(/[+-]?\d{3,4}/);
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
    const selection = textKey(String(play.Selection || "").replace(/\s+[+-]?\d+(?:\.\d+)?\s*$/, ""));
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
}

function FbTrendRecordExplorer({ rows, today }: { rows: SheetRow[]; today: string }) {
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
    const label = String(sample?.signal || key).replace(/_/g, " ").replace(/s+/g, " ").trim();
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
}

function BestPlayCard({ play, splits, index }: { play: Play; splits: DraftKingsSplit[]; index: number }) {
  const split = selectedSplit(play, splits);
  const roleKey = textKey(play.role || play.playType);
  const market = roleKey.includes("total") ? "Total" : "Spread";
  const scoreValue = Number(play.score);
  const scoreLabel = Number.isFinite(scoreValue)
    ? (scoreValue <= 1 ? scoreValue * 100 : scoreValue).toFixed(1)
    : "—";
  const odds = play.oddsLine || split?.odds || "—";
  const topPlay = index < 3;

  return (
    <article className={`card green fade-in best footballBestCard ${topPlay ? "top" : ""}`}>
      <div className="cardTop">
        <div className="rankBadge">#{index + 1}</div>
        <div className="scorePill" aria-label={`Model probability ${scoreLabel}%`}>
          <span className="scorePillLabel">MODEL</span>
          <strong>{scoreLabel}</strong>
          <span className="scorePillSub">WIN %</span>
        </div>
      </div>

      <div className="cardSub footballMatchup">{play.game}</div>

      <div className="projectionBlock footballProjectionBlock">
        <div className="projection footballProjection">{play.play}</div>
        <div className="grade">{play.playType}</div>
      </div>

      <div className="divider" />

      <div className="bubbleGrid footballBestMetrics">
        <MiniBubble label="Odds" value={odds} green />
        <MiniBubble label="Model Probability" value={pct(play.score)} green />
        <MiniBubble label="Reliability" value={play.reliability || "—"} green />
        <MiniBubble label="Market" value={market} green />
      </div>

      {split ? (
        <div className="publicSplitPanel footballPublicSplitPanel">
          <div className="publicSplitTitle">
            <span>DraftKings market</span>
            <strong>{split.selection || play.play}</strong>
          </div>
          <div className="footballSplitGrid">
            <MiniBubble label="Bets" value={`${split.betsPct}%`} />
            <MiniBubble label="Handle" value={`${split.moneyPct}%`} />
            <MiniBubble label="Handle − Bets" value={`${split.gapPct >= 0 ? "+" : ""}${split.gapPct}%`} />
          </div>
          {split.warning ? <div className="footballSplitSignal">{split.warning}</div> : null}
          {split.lineMovementSignal ? <div className="footballSplitSignal">{split.lineMovementSignal}</div> : null}
        </div>
      ) : (
        <div className="modelMeta footballModelMeta">
          <span>DraftKings selected-side split pending</span>
        </div>
      )}

      <div className="modelMeta footballModelMeta">
        <span>Regression model</span>
        <span>Spread + Total workflow</span>
      </div>
    </article>
  );
}

function MiniBubble({ label, value, green = false }: { label: string; value: string | number; green?: boolean }) {
  return (
    <div className={`miniBubble ${green ? "green" : ""}`}>
      <div className="miniLabel">{label}</div>
      <div className="miniValue">{value || "—"}</div>
    </div>
  );
}

function trendPickLabel(play: TrendPlay) {
  if (play.market === "Total") return `${play.side} ${play.line ?? ""}`.trim();
  const line = play.line == null ? "" : `${play.line > 0 ? "+" : ""}${play.line}`;
  return `${play.selection} ${line}`.trim();
}

function TrendSelectionRow({ play, selectionRank, initiallyOpen }: { play: TrendPlay; selectionRank: number; initiallyOpen: boolean }) {
  const primary = play.signals?.[0];
  const compactSignals = play.signals?.map((signal) => signal.signal).filter(Boolean).join(" • ") || "";
  return (
    <details className={`trendSelectionRow ${selectionRank === 1 ? "leader" : ""}`} open={initiallyOpen}>
      <summary className="trendSelectionSummary">
        <span className="trendSelectionRank">#{selectionRank}</span>
        <span className="trendSelectionIdentity">
          <strong>{trendPickLabel(play)}</strong>
          <small>{play.market}{play.sideGroup ? ` • ${play.sideGroup}` : ""}{compactSignals ? ` • ${compactSignals}` : ""}</small>
        </span>
        <span className="trendSelectionMarket">
          <small>{play.tier}</small>
          <strong>{Math.round(play.score)}</strong>
        </span>
        <span className="trendSelectionChevron" aria-hidden="true">⌄</span>
      </summary>

      <div className="trendSelectionBody">
        <div className="bubbleGrid trendSelectionMetrics">
          <MiniBubble label="Opening Bets" value={pct(play.openingBetsPct)} />
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
          <MiniBubble label="Price Move" value={priceMove(play)} />
        </div>

        <div className="trendRecordGrid">
          <div className="trendRecordCard"><span>All time</span><strong>{primary?.records.allTime.record || "0-0-0"}</strong></div>
          <div className="trendRecordCard"><span>Last 30</span><strong>{primary?.records.last30.record || "0-0-0"}</strong></div>
          <div className="trendRecordCard"><span>Last 7</span><strong>{primary?.records.last7.record || "0-0-0"}</strong></div>
        </div>

        {primary ? (
          <div className="trendSignalBox">
            <b>{primary.signal}</b>
            <span>{primary.recordScope} • exact sample {primary.exactSample}</span>
          </div>
        ) : null}
        {play.lineMovementSignal ? <div className="trendMovement">{play.lineMovementSignal}</div> : null}
        {play.lockWarning ? <div className="trendMovement">{play.lockWarning}</div> : null}
        <div className="trendTrackingStrip">
          <span>Bets {pct(play.openingBetsPct)} → {pct(play.betsPct)}</span>
          <span>Line {marketLine(play, play.openingLine)} → {marketLine(play, play.line)}</span>
          <span>Exact sample: {primary?.exactSample || 0} bets</span>
          <span>{play.snapshotStatus === "FINAL_PREGAME" ? "Locked" : play.snapshotStatus === "MISSED_LOCK" ? "Lock missed" : "Locks"} {scheduledLockTime(play.gameTime)}</span>
          <span>Updated {compactTimestamp(play.updatedAt)}</span>
        </div>
      </div>
    </details>
  );
}

function TrendGameCard({ game, plays }: { game: string; plays: TrendPlay[] }) {
  const ordered = [...plays].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.market !== b.market) return a.market === "Spread" ? -1 : 1;
    return trendPickLabel(a).localeCompare(trendPickLabel(b));
  });
  const topScore = Math.max(...ordered.map((play) => play.score), 0);
  const gameTime = ordered.find((play) => play.gameTime)?.gameTime || "";
  const gameDate = ordered.find((play) => play.date)?.date || "";
  const lockTime = scheduledLockTime(gameTime);
  const isLocked = ordered.some((play) => play.snapshotStatus === "FINAL_PREGAME");
  const lockMissed = !isLocked && ordered.some((play) => play.snapshotStatus === "MISSED_LOCK");

  return (
    <article className={`card trendGameCard ${topScore >= 75 ? "top" : ""}`}>
      <div className="trendGameHeader">
        <div className="cardTitle">{game}</div>
        {gameTime || gameDate ? <div className="trendGameTimeBox"><strong>{gameTime || "TBD"}</strong>{gameDate ? <small>{gameDate}</small> : null}<small>{isLocked ? "Locked" : lockMissed ? "Lock missed" : "Locks"} {lockTime}</small></div> : null}
      </div>
      <div className="trendSelectionStack">
        {ordered.map((play, index) => (
          <TrendSelectionRow
            key={`${play.gameKey}-${play.market}-${play.selection}-${play.side}-${play.line ?? ""}`}
            play={play}
            selectionRank={index + 1}
            initiallyOpen={false}
          />
        ))}
      </div>
    </article>
  );
}


function EzpzPickCard({ pick, index }: { pick: EzpzPick; index: number }) {
  return (
    <article className={`card green fade-in best footballBestCard ${index < 3 ? "top" : ""}`}>
      <div className="cardTop">
        <div className="rankBadge">#{index + 1}</div>
        <div className="scorePill" aria-label={`EZPZ qualification score ${pick.score.toFixed(1)}`}>
          <span className="scorePillLabel">EZPZ</span>
          <strong>{pick.score.toFixed(1)}</strong>
          <span className="scorePillSub">SCORE</span>
        </div>
      </div>
      <div className="cardSub footballMatchup">{pick.game}</div>
      <div className="projectionBlock footballProjectionBlock">
        <div className="projection footballProjection">{pick.selection}</div>
        <div className="grade">{pick.tier}</div>
      </div>
      <div className="divider" />
      <div className="bubbleGrid footballBestMetrics">
        <MiniBubble label="Odds" value={pick.odds} green />
        <MiniBubble label="Market" value={pick.market} green />
        <MiniBubble label="Source" value={pick.source} green />
        <MiniBubble label="Last 7" value={pick.record || "Trend"} green />
      </div>
      <div className="modelMeta footballModelMeta">
        <span>{pick.qualification}</span>
        <span>Max favorite price -150</span>
      </div>
    </article>
  );
}

function SlateCard({ row, splits }: { row: SheetRow; splits: DraftKingsSplit[] }) {
  const game = row.Game || `${row["Away Team"]} @ ${row["Home Team"]}`;
  const gameSplits = splits.filter((split) => textKey(split.game) === textKey(game) || splitMatchesTeams(row["Away Team"], row["Home Team"], split));
  return (
    <details className="card fbSlateCard">
      <summary><strong>{game}</strong><span>{row["Spread Grade"] || "No spread play"} • {row["Total Grade"] || "No total play"}</span></summary>
      <div className="fbSlateBody">
        <div className="fbScore"><span>{row["Away Team"]}</span><b>{num(row["Projected Away"], 1)}</b><span>{row["Home Team"]}</span><b>{num(row["Projected Home"], 1)}</b></div>
        <div className="fbMetrics">
          <div><span>Projected margin</span><strong>{num(row["Projected Margin"], 1)}</strong></div>
          <div><span>Projected total</span><strong>{num(row["Projected Total"], 1)}</strong></div>
          <div><span>Reliability</span><strong>{row.Reliability || "—"}</strong></div>
        </div>
        <div className="fbMarketRow"><b>Spread:</b> {row["Spread Pick"] || "—"} • {pct(row["Spread Probability"])} • {row["Spread Grade"] || "No Play"}</div>
        <div className="fbMarketRow"><b>Total:</b> {row["Total Pick"] || "—"} • {pct(row["Total Probability"])} • {row["Total Grade"] || "No Play"}</div>
        {gameSplits.length ? <div className="fbDkBox"><b>DraftKings</b>{gameSplits.map((split, i) => <span key={`${split.market}-${split.selection}-${i}`}>{split.market}: {split.selection} {split.odds} • {split.betsPct}% bets / {split.moneyPct}% handle • {split.warning}</span>)}</div> : null}
      </div>
    </details>
  );
}

export default function FootballBoard({ sport, tab, data }: { sport: Sport; tab: Tab; data: FootballData }) {
  const [weeklyData, setWeeklyData] = useState<WeeklyMarketData | null>(null);
  const [selectedWeek, setSelectedWeek] = useState("");

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    fetch(`/api/football-weekly-market?sport=${sport}`, { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((result) => { if (active && result?.ok) setWeeklyData(result as WeeklyMarketData); })
      .catch(() => undefined);
    return () => { active = false; controller.abort(); };
  }, [sport, data.lastUpdated]);

  const splits = useMemo(() => {
    const map = new Map<string, DraftKingsSplit>();
    for (const split of [...(data.draftKings?.splits || []), ...(weeklyData?.splits || [])]) {
      const key = `${textKey(split.game)}|${split.market}|${textKey(split.market === "Total" ? split.side : split.selectionTeam)}`;
      map.set(key, split);
    }
    return [...map.values()];
  }, [data.draftKings?.splits, weeklyData?.splits]);

  const trends = weeklyData?.trendPlays?.length ? weeklyData.trendPlays : (data.trendPlays || []);
  const trendWeeks = useMemo(() => [...new Set([
    ...trends.map(weekLabel),
    ...(weeklyData?.games || []).map((row) => String(row.Week || "").trim()).filter(Boolean),
  ])].sort((a, b) => weekSort(a) - weekSort(b) || a.localeCompare(b)), [trends, weeklyData?.games]);
  const fallbackWeek = defaultWeek(trends, data.today) || defaultStoredWeek(weeklyData?.games || [], data.today);
  const activeWeek = selectedWeek && trendWeeks.includes(selectedWeek) ? selectedWeek : fallbackWeek;
  const weekTrends = activeWeek ? trends.filter((play) => weekLabel(play) === activeWeek) : trends;
  const filteredTrends = weekTrends;
  const storedGamesForWeek = (weeklyData?.games || []).filter((row) => !activeWeek || String(row.Week || "") === activeWeek);

  const trendGroups = [...filteredTrends].reduce((map, play) => {
    const key = play.gameKey || play.game;
    const existing = map.get(key);
    if (existing) existing.plays.push(play);
    else map.set(key, { game: play.game, plays: [play] });
    return map;
  }, new Map<string, { game: string; plays: TrendPlay[] }>());
  const displayedTrendGroups = [...trendGroups.values()].sort((a, b) => {
    const aDate = a.plays.find((play) => play.date)?.date || "";
    const bDate = b.plays.find((play) => play.date)?.date || "";
    if (aDate !== bDate) return aDate.localeCompare(bDate);
    const aTime = gameTimeSortValue(a.plays.find((play) => play.gameTime)?.gameTime);
    const bTime = gameTimeSortValue(b.plays.find((play) => play.gameTime)?.gameTime);
    return aTime - bTime || a.game.localeCompare(b.game);
  });

  const slateRows = useMemo(() => {
    const map = new Map<string, SheetRow>();
    for (const row of weeklyData?.games || []) {
      if (String(row.Date || "") !== data.today) continue;
      const key = slateIdentity(row);
      if (key) map.set(key, row);
    }
    for (const row of data.slateToday || []) {
      const key = slateIdentity(row);
      if (key) map.set(key, row);
    }
    return [...map.values()];
  }, [weeklyData?.games, data.slateToday, data.today]);

  const summaryMap = new Map((data.recordSummary || []).map((row) => [row.betType, row]));
  const last7Map = new Map((data.last7RecordSummary || []).map((row) => [row.betType, row]));

  let content;
  if (tab === "Today’s Model Plays") {
    content = data.bestPlays.length ? <div className="fbGrid">{data.bestPlays.map((play, index) => <BestPlayCard key={`${play.game}-${play.play}-${index}`} play={play} splits={splits} index={index} />)}</div> : <div className="empty footballEmpty">No graded {sport} Best Plays are saved for {data.today}.</div>;
  } else if (tab === "Today’s Trend Plays") {
    content = <>
      <div className="trendWeekControls">
        <label><span>View market week</span><select value={activeWeek} onChange={(event) => setSelectedWeek(event.target.value)} disabled={!trendWeeks.length}>{trendWeeks.length ? trendWeeks.map((week) => <option key={week} value={week}>{week}</option>) : <option value="">No weeks yet</option>}</select></label>
        <div><strong>{activeWeek || "Waiting for DraftKings"}</strong><small>{storedGamesForWeek.length} games stored • all 4 Spread/Total sides show with their live tier</small></div>
      </div>
      {displayedTrendGroups.length ? <div className="trendGameGrid">{displayedTrendGroups.map((group) => <TrendGameCard key={group.plays[0]?.gameKey || group.game} game={group.game} plays={group.plays} />)}</div> : <div className="empty footballEmpty">No {sport} DraftKings Spread/Total markets are stored for {activeWeek || "this week"} yet. Pass, Good, Strong, and Elite rows all display once the market is stored.</div>}
    </>;
  } else if (tab === "EZPZ Picks") {
    content = <>
      <div className="sectionHead"><div><h2>{sport} EZPZ Picks</h2><p>{data.aiSelectorStatus?.message || "HOT Best Plays and qualifying Strong/Elite Trend Plays only."}</p></div></div>
      {data.aiPicks?.length ? <div className="fbGrid">{data.aiPicks.map((pick, index) => <EzpzPickCard key={`${pick.game}-${pick.market}-${pick.selection}-${index}`} pick={pick} index={index} />)}</div> : <div className="empty footballEmpty">No {sport} EZPZ Picks qualify right now.</div>}
    </>;
  } else if (tab === "Full Slate") {
    content = slateRows.length ? <div className="fbSlateStack">{slateRows.map((row, index) => <SlateCard key={`${row["Game Key"] || row["Game ID"] || row.Game}-${index}`} row={row} splits={splits} />)}</div> : <div className="empty footballEmpty">No {sport} games are posted for {data.today} yet.</div>;
  } else {
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
        <FbTrendRecordExplorer rows={trendRows} today={data.today} />
        <FbCombinationRecords tracker={trackerRows} trends={trendRows} today={data.today} />
      </div>
      <div className="advancedRecordsStack">
        <FbDraftKingsSignalRecords rows={data.draftKingsSignalRows || []} today={data.today} />
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

  const displayTab = tab === "Today’s Trend Plays" ? "Trend Plays" : String(tab) === "EZPZ AI Picks" ? "EZPZ Picks" : tab;
  return (
    <section className="footballBoard">
      <div className="fbHead">
        <div>
          <h2>{sport === "NFL" ? "NFL" : "College Football"} {displayTab}</h2>
          <p>Regression projections • Spread + Total • sport-specific DraftKings trends</p>
        </div>
        <div className="fbHeadActions">
          {tab === "Today’s Model Plays" ? <span className="countPill">{data.bestPlays.length} plays</span> : null}
          {tab === "Today’s Trend Plays" ? <span className="countPill">{displayedTrendGroups.length} games</span> : null}
          {tab === "Full Slate" ? <span className="countPill">{slateRows.length} games</span> : null}
          <span className={`fbStatus ${data.draftKings?.status === "LIVE" || weeklyData?.trendPlays?.length ? "live" : ""}`}>
            {data.draftKings?.status === "LIVE" || weeklyData?.trendPlays?.length ? "DraftKings live" : "DraftKings pending"}
          </span>
        </div>
      </div>
      {content}
      <style jsx global>{`
        .footballBoard{display:grid;gap:18px}.fbHead{display:flex;justify-content:space-between;gap:16px;align-items:flex-end}.fbHead h2{margin:0 0 4px}.fbHead p,.fbMuted{color:var(--ez-muted);margin:0}.fbStatus{border:1px solid var(--ez-border);border-radius:999px;padding:7px 11px;color:var(--ez-muted)}.fbStatus.live{color:var(--ez-green);border-color:rgba(43,216,117,.35)}
        .fbGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(285px,1fr));gap:14px}.fbCard,.fbSlateCard,.fbRecordTile,.fbInfo,.fbEmpty{border:1px solid var(--ez-border);background:linear-gradient(145deg,var(--ez-panel),var(--ez-panel-2));border-radius:20px;padding:16px}.fbCardTop{display:flex;justify-content:space-between;gap:8px;color:var(--ez-muted);font-size:.82rem}.fbGrade{color:var(--ez-blue-soft);font-weight:800;text-transform:uppercase}.fbCard h3{font-size:1.28rem;margin:12px 0}.fbMetrics{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.fbMetrics div{background:rgba(255,255,255,.025);border:1px solid var(--ez-border);border-radius:12px;padding:9px}.fbMetrics span{display:block;color:var(--ez-muted);font-size:.72rem}.fbMetrics strong{display:block;margin-top:4px}.fbDkBox{display:grid;gap:4px;margin-top:12px;border-left:3px solid var(--ez-blue);padding:9px 10px;background:rgba(47,140,255,.07);border-radius:10px}.fbDkBox span{color:var(--ez-muted);font-size:.82rem}
        .trendWeekControls{display:flex;align-items:end;justify-content:space-between;gap:14px;border:1px solid rgba(78,145,255,.22);background:linear-gradient(145deg,rgba(9,20,39,.88),rgba(5,13,26,.9));border-radius:18px;padding:13px 15px}.trendWeekControls label{display:grid;gap:6px}.trendWeekControls label span,.trendWeekControls small{color:var(--ez-muted);font-size:.74rem}.trendWeekControls select{min-width:150px;border:1px solid rgba(92,138,202,.28);background:#081427;color:#f3f7ff;border-radius:11px;padding:9px 12px;font-weight:850;outline:none}.trendWeekControls>div{display:grid;justify-items:end;gap:3px;text-align:right}.trendWeekControls strong{color:#f2f7ff;font-size:1rem}
        .trendGameGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,350px),1fr));gap:17px;align-items:start}.card{position:relative;overflow:hidden;min-width:0;border-radius:24px;border:1px solid var(--ez-border);padding:18px;background:linear-gradient(145deg,var(--ez-panel),var(--ez-panel-2))}.trendGameCard{border-color:rgba(78,145,255,.25)}.trendGameCard::before{content:"";position:absolute;inset:14px auto 14px 0;width:3px;border-radius:0 3px 3px 0;background:linear-gradient(180deg,#7c8cff,var(--ez-blue));box-shadow:0 0 22px rgba(91,123,255,.34)}.trendGameHeader{position:relative;z-index:2;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:13px}.cardTitle{color:#f4f8ff;font-size:18px;font-weight:950;line-height:1.2}.trendGameTimeBox{flex:0 0 auto;display:grid;gap:2px;border:1px solid rgba(91,143,214,.18);border-radius:13px;padding:7px 9px;background:rgba(8,19,36,.68);color:rgba(188,210,238,.88);font-size:10px}.trendGameTimeBox small{color:rgba(113,184,255,.92);font-size:9px;font-weight:900}.trendSelectionStack{position:relative;z-index:2;display:grid;gap:9px}.trendSelectionRow{overflow:hidden;border:1px solid rgba(100,139,190,.15);border-radius:17px;background:rgba(4,11,23,.62)}.trendSelectionRow.leader{border-color:rgba(70,155,255,.3);background:rgba(7,22,46,.72)}.trendSelectionSummary{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;align-items:center;gap:10px;padding:11px 12px;cursor:pointer;list-style:none}.trendSelectionSummary::-webkit-details-marker{display:none}.trendSelectionRank{display:grid;place-items:center;width:34px;height:34px;border-radius:11px;color:#c8d9ee;background:rgba(29,76,139,.18);font-size:12px;font-weight:950}.trendSelectionIdentity{display:grid;gap:4px;min-width:0}.trendSelectionIdentity strong{overflow:hidden;color:#f2f7ff;font-size:15px;font-weight:950;text-overflow:ellipsis;white-space:nowrap}.trendSelectionIdentity small{overflow:hidden;color:rgba(145,174,209,.72);font-size:9px;line-height:1.25;text-overflow:ellipsis;white-space:nowrap}.trendSelectionMarket{display:grid;justify-items:end;gap:2px;min-width:88px}.trendSelectionMarket small{color:rgba(154,182,215,.74);font-size:8px;font-weight:900;letter-spacing:.04em;text-transform:uppercase}.trendSelectionMarket strong{color:#f4f8ff;font-size:24px;font-weight:950;line-height:1}.trendSelectionChevron{color:rgba(163,191,225,.68);font-size:18px;transition:transform .2s ease}.trendSelectionRow[open] .trendSelectionChevron{transform:rotate(180deg)}.trendSelectionBody{border-top:1px solid rgba(100,139,190,.12);padding:12px}.bubbleGrid{display:grid;gap:8px}.trendSelectionMetrics{grid-template-columns:repeat(4,minmax(0,1fr))}.miniBubble{min-width:0;border-radius:15px;padding:11px 12px;background:linear-gradient(145deg,rgba(12,22,39,.82),rgba(6,13,25,.84));border:1px solid rgba(108,142,187,.14);box-shadow:inset 0 1px 0 rgba(255,255,255,.018)}.miniLabel{color:rgba(142,169,203,.68);font-size:8px;font-weight:800;letter-spacing:.03em;text-transform:uppercase}.miniValue{margin-top:4px;color:#eef5ff;font-size:13px;font-weight:900;white-space:nowrap}.trendRecordGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:10px}.trendRecordCard{border:1px solid rgba(100,139,190,.13);border-radius:13px;padding:9px 10px;background:rgba(6,14,27,.64)}.trendRecordCard span{display:block;color:rgba(145,174,209,.65);font-size:8px;font-weight:800;text-transform:uppercase}.trendRecordCard strong{display:block;margin-top:3px;color:#f0f6ff;font-size:13px}.trendSignalBox{display:grid;gap:3px;margin-top:10px;border-left:3px solid var(--ez-blue);padding:9px 10px;border-radius:10px;background:rgba(47,140,255,.07)}.trendSignalBox b{color:#f3f7ff;font-size:12px}.trendSignalBox span,.trendMovement{color:var(--ez-muted);font-size:10px}.trendMovement{margin-top:8px}.trendTrackingStrip{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px;padding-top:12px;border-top:1px solid rgba(100,139,190,.10)}.trendTrackingStrip span{border:1px solid rgba(100,139,190,.14);border-radius:999px;padding:6px 9px;background:rgba(8,18,34,.6);color:rgba(153,181,214,.76);font-size:9px;font-weight:800}
        .fbSlateStack{display:grid;gap:10px}.fbSlateCard{padding:0;overflow:hidden}.fbSlateCard summary{cursor:pointer;list-style:none;padding:15px;display:flex;justify-content:space-between;gap:10px}.fbSlateCard summary span{color:var(--ez-muted);font-size:.8rem}.fbSlateBody{display:grid;gap:12px;padding:0 15px 15px}.fbScore{display:grid;grid-template-columns:1fr auto;gap:7px 12px}.fbScore b{font-size:1.25rem}.fbMarketRow{padding:9px;border-radius:10px;background:rgba(255,255,255,.025)}.fbRecordsGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.fbRecordTile{display:grid;gap:6px}.fbRecordTile span,.fbRecordTile small{color:var(--ez-muted)}.fbRecordTile strong{font-size:1.45rem}.fbInfo{color:var(--ez-muted);line-height:1.7}.fbEmpty{color:var(--ez-muted);text-align:center;padding:30px}
        @media(max-width:620px){.fbHead{align-items:flex-start;flex-direction:column}.fbMetrics{grid-template-columns:1fr}.fbSlateCard summary{flex-direction:column}.trendWeekControls{align-items:stretch;flex-direction:column}.trendWeekControls>div{justify-items:start;text-align:left}.trendWeekControls select{width:100%}.card{border-radius:22px;padding:16px}.trendGameHeader{gap:9px}.trendSelectionRank{width:30px;height:30px}.trendSelectionIdentity strong{font-size:13px}.trendSelectionMarket{min-width:66px}.trendSelectionMarket small{max-width:70px;text-align:right}.trendSelectionMarket strong{font-size:21px}.trendSelectionChevron{display:none}.trendSelectionMetrics{grid-template-columns:repeat(2,minmax(0,1fr))}.trendRecordGrid{grid-template-columns:1fr}}

        /* MLB visual system alignment for NFL + College Football */
        .footballBoard .fbHead{align-items:flex-end;margin:2px 0 2px}.footballBoard .fbHead h2{font-size:clamp(1.35rem,4vw,2.25rem);letter-spacing:-.04em}.footballBoard .fbHeadActions{display:flex;flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:8px}.footballBoard .fbGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.footballBestCard{min-width:0;border-color:rgba(34,197,94,.42);box-shadow:0 0 0 1px rgba(34,197,94,.12),0 0 22px rgba(34,197,94,.18),0 24px 70px rgba(0,0,0,.28)}.footballBestCard .footballMatchup{margin-top:4px;color:var(--ez-muted);font-size:.82rem;font-weight:800}.footballBestCard .footballProjectionBlock{margin-top:16px}.footballBestCard .footballProjection{font-size:clamp(1.75rem,5vw,2.65rem);line-height:1;letter-spacing:-.045em;text-transform:none;overflow-wrap:anywhere}.footballBestCard .footballBestMetrics{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.footballBestCard .miniBubble.green{border-color:rgba(43,216,117,.17);background:linear-gradient(145deg,rgba(9,31,42,.72),rgba(7,15,29,.9))}.footballBestCard .miniLabel{font-size:9px;font-weight:900;letter-spacing:.07em}.footballBestCard .miniValue{white-space:normal;overflow-wrap:anywhere;font-size:14px}.footballPublicSplitPanel{margin-top:15px}.footballSplitGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.footballSplitSignal{margin-top:9px;padding-top:9px;border-top:1px solid rgba(100,139,190,.12);color:var(--ez-muted);font-size:.78rem;font-weight:750;line-height:1.35}.footballModelMeta{margin-top:12px}.footballBoard .fbSlateCard{padding:0}.footballBoard .fbRecordTile{padding:18px}.footballBoard .footballEmpty{border-radius:22px;padding:28px}.footballBoard .trendGameCard{box-shadow:0 24px 70px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,.035)}
        @media(max-width:850px){.footballBoard .fbGrid{grid-template-columns:1fr}}
        @media(max-width:620px){.footballBoard .fbHeadActions{justify-content:flex-start}.footballBestCard .footballProjection{font-size:clamp(1.65rem,8vw,2.35rem)}.footballSplitGrid{grid-template-columns:1fr}.footballBoard .fbGrid{grid-template-columns:1fr}}

        .footballRecordsPage{width:100%;max-width:100%;min-width:0;overflow-x:hidden}.footballRecordsPage>*{min-width:0}.footballRecordsPage .sectionHead,.footballRecordsPage .advancedRecordsStack,.footballRecordsPage .recordsDropdown{width:100%;max-width:100%;min-width:0}.footballRecordsPage .recordsSummary{min-width:0}.footballRecordsPage .recordsSummary>div{min-width:0}.footballRecordsPage .recordsSummaryTitle,.footballRecordsPage .recordsSummarySub{overflow-wrap:anywhere}
        .fbMlbRecordsBody{display:grid;gap:14px;padding:14px 16px 16px;min-width:0}.fbMlbRecordFilters{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;min-width:0}.fbMlbRecordFilters.twoFilters{grid-template-columns:repeat(2,minmax(0,1fr))}.fbMlbRecordFilters label{display:grid;gap:6px;min-width:0}.fbMlbRecordFilters label span{color:var(--ez-muted);font-size:.72rem;font-weight:850;letter-spacing:.06em;text-transform:uppercase}.fbMlbRecordFilters select{width:100%;max-width:100%;min-width:0;border:1px solid rgba(92,138,202,.28);background:#081427;color:#f3f7ff;border-radius:11px;padding:10px 12px;font-weight:800;outline:none}.fbSignalTableWrap{max-width:100%;overflow-x:auto}.fbSignalTable{min-width:760px}.fbSignalPill{display:inline-flex;max-width:260px;border-radius:999px;padding:6px 10px;font-size:.75rem;font-weight:900;line-height:1.15}.fbSignalPill.positive{color:#a8f0bf;background:rgba(25,126,78,.18);border:1px solid rgba(57,201,120,.28)}.fbSignalPill.negative{color:#ffc0c6;background:rgba(146,34,54,.2);border:1px solid rgba(255,97,116,.28)}.fbSignalPill.neutral{color:#c4d4e8;background:rgba(77,104,140,.16);border:1px solid rgba(121,153,194,.2)}
        @media(max-width:700px){.footballRecordsPage{overflow-x:clip}.fbMlbRecordsBody{padding:12px}.fbMlbRecordFilters,.fbMlbRecordFilters.twoFilters{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.fbMlbRecordFilters label:last-child:nth-child(odd){grid-column:1/-1}.footballRecordsPage .recordsSummary{align-items:flex-start;gap:10px}.footballRecordsPage .recordsCount{flex:0 0 auto;white-space:nowrap}.fbSignalTableWrap,.footballRecordsPage .tableWrap{width:100%;max-width:100%;overflow-x:auto;overscroll-behavior-inline:contain}.footballRecordsPage table{max-width:none}}
      `}</style>
    </section>
  );
}
