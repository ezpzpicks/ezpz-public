"use client";

import { MatchupWithLogos, SelectionWithTeamLogo } from "./TeamLogoName";

type SheetRow = Record<string, string>;
type Sport = "NFL" | "NCAAF";
type TrendPlay = {
  date?: string;
  game: string;
  gameKey: string;
  gameTime?: string;
  market: "Spread" | "Total";
  selection: string;
  selectionTeam: string;
  side: "Over" | "Under" | "";
  sideGroup?: string;
  line: number | null;
  odds: string;
  betsPct: number;
  moneyPct: number;
  openingBetsPct?: number;
  openingMoneyPct?: number;
  publicMovementPct?: number;
  openingLine?: number | null;
  openingOdds?: string;
  lineMovementBasis?: string;
  lineMovementValue?: number | null;
  firstTrackedAt?: string;
  updatedAt?: string;
  movementHistory?: Array<{
    snapshotTime: string;
    line: number | null;
    odds: string;
    betsPct: number;
    moneyPct: number;
  }>;
};

type Group = { game: string; plays: TrendPlay[] };
type RecordTotals = {
  record: string;
  totalBets: number;
  wins: number;
  losses: number;
  pushes: number;
  winPct: number;
  unitsWon: number;
  roiPct: number;
};

function textKey(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\u2212/g, "-")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pct(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(1)}%` : "-";
}

function compactTime(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "-";
  const match = raw.match(/(\d{1,2}:\d{2})(?::\d{2})?\s*(AM|PM)/i);
  return match ? `${match[1]} ${match[2].toUpperCase()}` : raw;
}

function lineLabel(play: TrendPlay, value: number | null | undefined) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  if (play.market === "Spread") return `${n > 0 ? "+" : ""}${n}`;
  return String(n);
}

function pickLabel(play: TrendPlay) {
  if (play.market === "Total") return `${play.side} ${lineLabel(play, play.line)}`.trim();
  return `${play.selection} ${lineLabel(play, play.line)}`.trim();
}

function opposite(play: TrendPlay, plays: TrendPlay[]) {
  const own = play.market === "Total" ? textKey(play.side) : textKey(play.selection);
  return plays.find((candidate) => {
    if (candidate.market !== play.market) return false;
    const key = candidate.market === "Total" ? textKey(candidate.side) : textKey(candidate.selection);
    return key !== own;
  }) || null;
}

function labelsFor(play: TrendPlay, plays: TrendPlay[]) {
  const publicSide = opposite(play, plays);
  if (!publicSide) return [] as string[];
  const labels: string[] = [];

  const publicBets = Number(publicSide.betsPct);
  const publicMoney = Number(publicSide.moneyPct);
  if (
    Number.isFinite(publicBets) &&
    Number.isFinite(publicMoney) &&
    publicBets > 75 &&
    publicBets - publicMoney >= 55
  ) labels.push("Public Fade");

  const publicMove = Number(publicSide.publicMovementPct);
  const lineMove = Number(publicSide.lineMovementValue);
  if (
    play.market === "Spread" &&
    String(publicSide.lineMovementBasis || "").includes("Spread") &&
    Number.isFinite(publicMove) &&
    publicMove >= 5 &&
    Number.isFinite(lineMove) &&
    lineMove <= -1.5
  ) labels.push("Strong RLM");

  return labels;
}

function historyPoints(play: TrendPlay) {
  const saved = (play.movementHistory || []).filter((point) =>
    Number.isFinite(Number(point.betsPct)) && Number.isFinite(Number(point.moneyPct))
  );
  if (saved.length >= 2) return saved;
  return [
    {
      snapshotTime: play.firstTrackedAt || "Open",
      line: play.openingLine ?? play.line,
      odds: play.openingOdds || play.odds,
      betsPct: Number(play.openingBetsPct ?? play.betsPct),
      moneyPct: Number(play.openingMoneyPct ?? play.moneyPct),
    },
    {
      snapshotTime: play.updatedAt || "Current",
      line: play.line,
      odds: play.odds,
      betsPct: Number(play.betsPct),
      moneyPct: Number(play.moneyPct),
    },
  ];
}

function polyline(values: number[], width: number, height: number, min: number, max: number) {
  const spread = Math.max(0.001, max - min);
  return values.map((value, index) => {
    const x = values.length <= 1 ? width / 2 : (index / (values.length - 1)) * width;
    const y = height - ((value - min) / spread) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function MovementChart({ play }: { play: TrendPlay }) {
  const points = historyPoints(play);
  const width = 520;
  const height = 128;
  const bets = points.map((point) => Number(point.betsPct));
  const money = points.map((point) => Number(point.moneyPct));
  const finiteLines = points.map((point) => Number(point.line)).filter(Number.isFinite);
  const firstLine = finiteLines[0] ?? 0;
  const lines = points.map((point) => Number.isFinite(Number(point.line)) ? Number(point.line) : firstLine);
  const minLine = finiteLines.length ? Math.min(...finiteLines) : 0;
  const maxLine = finiteLines.length ? Math.max(...finiteLines) : 1;
  const latest = points[points.length - 1];

  return (
    <section className="dkMovementPanel">
      <div className="dkMovementHead">
        <div>
          <strong>{play.market === "Total" ? play.side : play.selection}</strong>
          <small>{points.length} saved snapshots - {play.market}</small>
        </div>
        <span>{lineLabel(play, latest?.line)} {latest?.odds || play.odds}</span>
      </div>

      <div className="dkMovementCharts">
        <div className="dkChartBlock">
          <div className="dkChartLabel">
            <span>Bet / Money %</span>
            <small>{pct(latest?.betsPct)} bets - {pct(latest?.moneyPct)} money</small>
          </div>
          <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Bet and money percentage movement">
            <line x1="0" y1={height / 2} x2={width} y2={height / 2} className="dkChartGrid" />
            <polyline points={polyline(bets, width, height, 0, 100)} className="dkChartBets" />
            <polyline points={polyline(money, width, height, 0, 100)} className="dkChartMoney" />
          </svg>
          <div className="dkChartLegend"><span className="bets">Bets %</span><span className="money">Money %</span></div>
        </div>

        <div className="dkChartBlock">
          <div className="dkChartLabel">
            <span>Line movement</span>
            <small>{lineLabel(play, points[0]?.line)} -&gt; {lineLabel(play, latest?.line)}</small>
          </div>
          <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Line movement">
            <line x1="0" y1={height / 2} x2={width} y2={height / 2} className="dkChartGrid" />
            <polyline
              points={polyline(lines, width, height, minLine, maxLine === minLine ? maxLine + 1 : maxLine)}
              className="dkChartLine"
            />
          </svg>
          <div className="dkChartAxis">
            <span>{compactTime(points[0]?.snapshotTime)}</span>
            <span>{compactTime(latest?.snapshotTime)}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function MarketRow({ play, plays, sport }: { play: TrendPlay; plays: TrendPlay[]; sport: Sport }) {
  const labels = labelsFor(play, plays);
  return (
    <div className={`dkTrendMarketRow ${labels.length ? "qualified" : ""}`}>
      <div className="dkTrendMarketName">
        <small>{play.market}{play.sideGroup ? ` - ${play.sideGroup}` : ""}</small>
        <strong><SelectionWithTeamLogo sport={sport} selection={pickLabel(play)} game={play.game} compact /></strong>
      </div>
      <div className="dkTrendPrice"><strong>{lineLabel(play, play.line)}</strong><small>{play.odds || "-"}</small></div>
      <div className="dkTrendPercent"><strong>{pct(play.betsPct)}</strong><small>Bets</small></div>
      <div className="dkTrendPercent"><strong>{pct(play.moneyPct)}</strong><small>Money</small></div>
      <div className="dkTrendBadges">
        {labels.map((label) => (
          <span className={`directTrendBadge ${label === "Public Fade" ? "fade" : "rlm"}`} key={label}>{label}</span>
        ))}
        {!labels.length ? <span className="directTrendNone">-</span> : null}
      </div>
    </div>
  );
}

function GameCard({ group, sport }: { group: Group; sport: Sport }) {
  const ordered = [...group.plays].sort((a, b) => {
    if (a.market !== b.market) return a.market === "Spread" ? -1 : 1;
    if (a.market === "Total" && a.side !== b.side) return a.side === "Over" ? -1 : 1;
    return pickLabel(a).localeCompare(pickLabel(b));
  });
  const qualifying = ordered.filter((play) => labelsFor(play, ordered).length > 0);
  const gameTime = ordered.find((play) => play.gameTime)?.gameTime || "";
  const gameDate = ordered.find((play) => play.date)?.date || "";
  const spreadRef = ordered.find((play) => play.market === "Spread");
  const totalRef = ordered.find((play) => play.market === "Total" && play.side === "Over")
    || ordered.find((play) => play.market === "Total");

  return (
    <article className={`dkTrendGame ${qualifying.length ? "hasSignal" : ""}`}>
      <div className="dkTrendGameHead">
        <div>
          <div className="dkTrendGameTitle"><MatchupWithLogos sport={sport} game={group.game} compact /></div>
          <small>{gameDate}{gameDate && gameTime ? " - " : ""}{gameTime}</small>
        </div>
        <span className={`dkSignalCount ${qualifying.length ? "" : "quiet"}`}>
          {qualifying.length ? `${qualifying.length} trend ${qualifying.length === 1 ? "play" : "plays"}` : "Market tracked"}
        </span>
      </div>

      <div className="dkTrendMarketBoard">
        <div className="dkTrendMarketHeader">
          <span>Market</span><span>Line / Odds</span><span>Bets</span><span>Money</span><span>Trend</span>
        </div>
        {ordered.map((play) => (
          <MarketRow
            key={`${play.gameKey}-${play.market}-${play.selection}-${play.side}-${play.line ?? ""}`}
            play={play}
            plays={ordered}
            sport={sport}
          />
        ))}
      </div>

      <details className="dkMovementDropdown">
        <summary><span>View market movement</span><small>Bets %, Money %, and line history</small></summary>
        <div className="dkMovementBody">
          {spreadRef ? <MovementChart play={spreadRef} /> : null}
          {totalRef ? <MovementChart play={totalRef} /> : null}
        </div>
      </details>
    </article>
  );
}

function resultCode(value: unknown) {
  const key = String(value || "").trim().toUpperCase();
  if (["W", "WIN", "WON"].includes(key)) return "W";
  if (["L", "LOSS", "LOST"].includes(key)) return "L";
  if (["P", "PUSH"].includes(key)) return "P";
  return "";
}

function oddsNumber(value: unknown) {
  const match = String(value || "").replace(/\u2212/g, "-").match(/[+-]?\d{3,4}/);
  const n = match ? Number(match[0]) : -110;
  return Number.isFinite(n) ? n : -110;
}

function winUnits(odds: number) {
  return odds > 0 ? odds / 100 : odds < 0 ? 100 / Math.abs(odds) : 1;
}

function recordTotals(rows: SheetRow[]): RecordTotals {
  let wins = 0, losses = 0, pushes = 0, units = 0;
  rows.forEach((row) => {
    const result = resultCode(row.Result || row.Status);
    if (!result) return;
    if (result === "W") { wins += 1; units += winUnits(oddsNumber(row["Public Split Odds"] || row.Odds)); }
    else if (result === "L") { losses += 1; units -= 1; }
    else pushes += 1;
  });
  const totalBets = wins + losses + pushes;
  const decisions = wins + losses;
  return {
    record: `${wins}-${losses}-${pushes}`,
    totalBets,
    wins,
    losses,
    pushes,
    winPct: decisions ? Math.round((wins / decisions) * 1000) / 10 : 0,
    unitsWon: Math.round(units * 100) / 100,
    roiPct: totalBets ? Math.round((units / totalBets) * 1000) / 10 : 0,
  };
}

function historicalSelectionKey(row: SheetRow) {
  return textKey(textKey(row.Market) === "total"
    ? row.Side || row.Selection
    : row["Public Split Selection"] || row.Selection);
}

function historicalGroupKey(row: SheetRow) {
  return `${String(row.Date || "")}|${String(row["Game Key"] || row["Game ID"] || row.Game || "")}|${textKey(row.Market)}`;
}

function historicalLabels(row: SheetRow, group: SheetRow[]) {
  const ownKey = historicalSelectionKey(row);
  const publicSide = group.find((candidate) => historicalSelectionKey(candidate) !== ownKey);
  if (!publicSide) return [] as string[];
  const labels: string[] = [];

  const publicBets = Number(publicSide["Public Bets %"] || publicSide["Current Public %"]);
  const publicMoney = Number(publicSide["Public Money %"] || publicSide["Current Sharp %"]);
  if (
    Number.isFinite(publicBets) &&
    Number.isFinite(publicMoney) &&
    publicBets > 75 &&
    publicBets - publicMoney >= 55
  ) labels.push("Public Fade");

  const publicMove = Number(publicSide["Public Change %"]);
  const lineMove = Number(publicSide["Line Movement Value"]);
  if (
    textKey(row.Market) === "spread" &&
    String(publicSide["Line Movement Basis"] || "").includes("Spread") &&
    Number.isFinite(publicMove) &&
    publicMove >= 5 &&
    Number.isFinite(lineMove) &&
    lineMove <= -1.5
  ) labels.push("Strong RLM");

  return labels;
}

function recordCategory(row: SheetRow) {
  if (textKey(row.Market) === "total") return textKey(row.Side || row.Selection).startsWith("under") ? "Under" : "Over";
  const line = Number(row["Public Split Line"] || row.Line);
  return Number.isFinite(line) && line > 0 ? "Underdog Spread" : "Favorite Spread";
}

function tone(record: RecordTotals) {
  if (record.wins > record.losses) return "green";
  if (record.losses > record.wins) return "red";
  return "yellow";
}

export function DirectTrendRecords({ rows }: { rows: SheetRow[]; today?: string }) {
  const grouped = new Map<string, SheetRow[]>();
  rows.forEach((row) => {
    if (!resultCode(row.Result || row.Status)) return;
    const key = historicalGroupKey(row);
    const existing = grouped.get(key);
    if (existing) existing.push(row); else grouped.set(key, [row]);
  });

  const labeled: Array<{ row: SheetRow; signal: string; category: string }> = [];
  grouped.forEach((group) => {
    group.forEach((row) => {
      historicalLabels(row, group).forEach((signal) => labeled.push({ row, signal, category: recordCategory(row) }));
    });
  });

  const summaries: Array<{ label: string; totals: RecordTotals }> = [];
  ["Public Fade", "Strong RLM"].forEach((signal) => {
    const signalRows = labeled.filter((item) => item.signal === signal);
    const overall = recordTotals(signalRows.map((item) => item.row));
    if (overall.totalBets) summaries.push({ label: `${signal} - Overall`, totals: overall });
    ["Favorite Spread", "Underdog Spread", "Over", "Under"].forEach((category) => {
      const totals = recordTotals(signalRows.filter((item) => item.category === category).map((item) => item.row));
      if (totals.totalBets) summaries.push({ label: `${signal} - ${category}`, totals });
    });
  });

  return (
    <details className="recordsDropdown directTrendRecords" open>
      <summary className="recordsSummary">
        <div>
          <div className="recordsSummaryTitle">Public Fade + Strong RLM Records</div>
          <div className="recordsSummarySub">Only the two active DraftKings rules, separated by market side</div>
        </div>
        <span className="recordsCount">{labeled.length} graded</span>
      </summary>
      {summaries.length ? (
        <div className="tableWrap">
          <table className="recordsTable">
            <thead><tr><th>Trend</th><th>Record</th><th>Win %</th><th>Units</th><th>ROI</th><th>Bets</th></tr></thead>
            <tbody>
              {summaries.map(({ label, totals }) => {
                const rowTone = tone(totals);
                return (
                  <tr className={`recordPerformanceRow ${rowTone}`} key={label}>
                    <td><strong>{label}</strong></td>
                    <td>{totals.record}</td>
                    <td><span className={`recordWinPctPill ${rowTone}`}>{totals.winPct.toFixed(1)}%</span></td>
                    <td>{totals.unitsWon > 0 ? "+" : ""}{totals.unitsWon.toFixed(2)}u</td>
                    <td>{totals.roiPct > 0 ? "+" : ""}{totals.roiPct.toFixed(1)}%</td>
                    <td>{totals.totalBets}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <div className="empty insideDropdown">No completed Public Fade or Strong RLM results are available yet.</div>}
    </details>
  );
}

export function FootballTrendMarketBoard({ groups, sport }: { groups: Group[]; sport: Sport }) {
  return groups.length
    ? <div className="dkTrendGameGrid">{groups.map((group) => <GameCard key={group.plays[0]?.gameKey || group.game} group={group} sport={sport} />)}</div>
    : null;
}
