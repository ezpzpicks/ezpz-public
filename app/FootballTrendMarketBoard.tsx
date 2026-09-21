"use client";

import { SelectionWithTeamLogo, TeamLogoName } from "./TeamLogoName";

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

function snapshotEpoch(value: unknown) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)/i);
  if (match) {
    const [, month, day, year, rawHour, minute, second = "0", meridiem] = match;
    let hour = Number(rawHour) % 12;
    if (meridiem.toUpperCase() === "PM") hour += 12;
    return Date.UTC(Number(year), Number(month) - 1, Number(day), hour, Number(minute), Number(second));
  }
  const stamp = Date.parse(raw);
  return Number.isFinite(stamp) ? stamp : Number.POSITIVE_INFINITY;
}

function compactDate(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "-";
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (match) return `${Number(match[1])}/${Number(match[2])}`;
  const stamp = Date.parse(raw);
  if (!Number.isFinite(stamp)) return raw;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "numeric",
    day: "numeric",
  }).format(new Date(stamp));
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

function compactMovementLine(play: TrendPlay, value: number | null | undefined) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  const display = play.market === "Spread" ? Math.abs(n) : n;
  return Number.isInteger(display) ? String(display) : display.toFixed(1);
}

function rlmBadgeSummary(play: TrendPlay) {
  if (play.openingBetsPct == null || play.openingLine == null || play.line == null) return null;
  const startBets = Number(play.openingBetsPct);
  const endBets = Number(play.betsPct);
  const startLine = Number(play.openingLine);
  const endLine = Number(play.line);
  if (![startBets, endBets, startLine, endLine].every((value) => Number.isFinite(value))) return null;
  if (startBets <= 0 || startBets >= 100) return null;
  return {
    startBets: `${Math.round(startBets)}%`,
    endBets: `${Math.round(endBets)}%`,
    startLine: compactMovementLine(play, startLine),
    endLine: compactMovementLine(play, endLine),
  };
}

function opposite(play: TrendPlay, plays: TrendPlay[]) {
  const own = play.market === "Total" ? textKey(play.side) : textKey(play.selection);
  return plays.find((candidate) => {
    if (candidate.market !== play.market) return false;
    const key = candidate.market === "Total" ? textKey(candidate.side) : textKey(candidate.selection);
    return key !== own;
  }) || null;
}

function labelsFor(play: TrendPlay, plays: TrendPlay[], sport: Sport) {
  const publicSide = opposite(play, plays);
  if (!publicSide) return [] as string[];
  const labels: string[] = [];

  const publicBets = Number(publicSide.betsPct);
  const publicMoney = Number(publicSide.moneyPct);
  const placeholderSplit =
    (publicBets === 100 && publicMoney === 100) ||
    (publicBets === 0 && publicMoney === 0);
  const publicFade = sport === "NFL"
    ? !placeholderSplit && Number.isFinite(publicBets) && publicBets >= 80
    : Number.isFinite(publicBets) &&
      Number.isFinite(publicMoney) &&
      publicBets > 75 &&
      publicBets - publicMoney >= 55;
  if (publicFade) labels.push("Public Fade");

  const openingPublicBets = Number(publicSide.openingBetsPct);
  const publicMove = Number(publicSide.publicMovementPct);
  const lineMove = Number(publicSide.lineMovementValue);
  if (
    play.market === "Spread" &&
    Number.isFinite(openingPublicBets) &&
    openingPublicBets > 0 &&
    openingPublicBets < 100 &&
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
  const fallback = [
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

  const ordered = [...(saved.length >= 2 ? saved : fallback)].sort(
    (a, b) => snapshotEpoch(a.snapshotTime) - snapshotEpoch(b.snapshotTime),
  );
  const firstRealIndex = ordered.findIndex((point) => {
    const bets = Number(point.betsPct);
    const money = Number(point.moneyPct);
    const placeholder100 = bets === 100 && money === 100;
    const placeholder0 = bets === 0 && money === 0;
    return !placeholder100 && !placeholder0;
  });

  return firstRealIndex >= 0 ? ordered.slice(firstRealIndex) : ordered;
}

function polyline(values: number[], width: number, height: number, min: number, max: number) {
  const spread = Math.max(0.001, max - min);
  return values.map((value, index) => {
    const x = values.length <= 1 ? width / 2 : (index / (values.length - 1)) * width;
    const y = height - ((value - min) / spread) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function clampPct(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}

function chartX(index: number, count: number, left: number, right: number) {
  if (count <= 1) return (left + right) / 2;
  return left + (index / (count - 1)) * (right - left);
}

function chartY(value: number, min: number, max: number, top: number, bottom: number) {
  const spread = Math.max(0.001, max - min);
  return bottom - ((value - min) / spread) * (bottom - top);
}

function chartPolyline(values: number[], left: number, right: number, top: number, bottom: number, min: number, max: number) {
  return values.map((value, index) =>
    `${chartX(index, values.length, left, right).toFixed(1)},${chartY(value, min, max, top, bottom).toFixed(1)}`
  ).join(" ");
}

function stepPolyline(values: number[], left: number, right: number, top: number, bottom: number, min: number, max: number) {
  if (!values.length) return "";
  const points: string[] = [];
  values.forEach((value, index) => {
    const x = chartX(index, values.length, left, right);
    const y = chartY(value, min, max, top, bottom);
    if (index === 0) {
      points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
      return;
    }
    const previousY = chartY(values[index - 1], min, max, top, bottom);
    points.push(`${x.toFixed(1)},${previousY.toFixed(1)}`);
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  });
  return points.join(" ");
}

function movementMarkerIndexes(values: number[]) {
  const indexes = values.reduce<number[]>((all, value, index) => {
    if (index === 0 || index === values.length - 1 || value !== values[index - 1]) all.push(index);
    return all;
  }, []);
  const unique = [...new Set(indexes)];
  if (unique.length <= 6) return unique;
  const chosen = [unique[0]];
  for (let slot = 1; slot < 5; slot += 1) {
    chosen.push(unique[Math.round((slot / 5) * (unique.length - 1))]);
  }
  chosen.push(unique[unique.length - 1]);
  return [...new Set(chosen)];
}

function dateAxis(points: ReturnType<typeof historyPoints>) {
  if (!points.length) return [] as string[];
  const indexes = [0, .25, .5, .75, 1]
    .map((ratio) => Math.round((points.length - 1) * ratio));
  return [...new Set(indexes)].map((index) => compactDate(points[index]?.snapshotTime));
}

function MovementChart({ play }: { play: TrendPlay }) {
  const points = historyPoints(play);
  const width = 560;
  const height = 156;
  const left = 38;
  const right = 500;
  const top = 12;
  const bottom = 132;
  const bets = points.map((point) => clampPct(point.betsPct));
  const money = points.map((point) => clampPct(point.moneyPct));
  const finiteLines = points.map((point) => Number(point.line)).filter(Number.isFinite);
  const firstLine = finiteLines[0] ?? 0;
  const lines = points.map((point) => Number.isFinite(Number(point.line)) ? Number(point.line) : firstLine);
  const rawMin = finiteLines.length ? Math.min(...finiteLines) : 0;
  const rawMax = finiteLines.length ? Math.max(...finiteLines) : 1;
  const padding = rawMax === rawMin ? 1 : Math.max(.5, (rawMax - rawMin) * .35);
  const minLine = rawMin - padding;
  const maxLine = rawMax + padding;
  const latest = points[points.length - 1];
  const markers = movementMarkerIndexes(lines);
  const dates = dateAxis(points);
  const lineTicks = Array.from({ length: 5 }, (_, index) => maxLine - ((maxLine - minLine) / 4) * index);

  const latestBetsY = chartY(clampPct(latest?.betsPct), 0, 100, top, bottom);
  const latestMoneyY = chartY(clampPct(latest?.moneyPct), 0, 100, top, bottom);

  return (
    <section className="dkMovementPanel">
      <div className="dkMovementHead">
        <div>
          <strong>{play.market === "Total" ? play.side : play.selection}</strong>
          <small>{play.market}</small>
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
            {[0, 25, 50, 75, 100].map((tick) => {
              const y = chartY(tick, 0, 100, top, bottom);
              return (
                <g key={tick}>
                  <line x1={left} y1={y} x2={right} y2={y} className="dkChartGrid" />
                  <text x="2" y={y + 3} className="dkChartTick">{tick}%</text>
                </g>
              );
            })}
            <polyline points={chartPolyline(bets, left, right, top, bottom, 0, 100)} className="dkChartBets" />
            <polyline points={chartPolyline(money, left, right, top, bottom, 0, 100)} className="dkChartMoney" />
            <g className="dkChartEndTag betsTag" transform={`translate(506 ${Math.max(2, Math.min(height - 22, latestBetsY - 10))})`}>
              <rect width="50" height="20" rx="7" />
              <text x="25" y="14" textAnchor="middle">{Math.round(clampPct(latest?.betsPct))}%</text>
            </g>
            <g className="dkChartEndTag moneyTag" transform={`translate(506 ${Math.max(2, Math.min(height - 22, latestMoneyY - 10))})`}>
              <rect width="50" height="20" rx="7" />
              <text x="25" y="14" textAnchor="middle">{Math.round(clampPct(latest?.moneyPct))}%</text>
            </g>
          </svg>
          <div className="dkChartTimeAxis">{dates.map((date, index) => <span key={`${date}-${index}`}>{date}</span>)}</div>
          <div className="dkChartLegend"><span className="bets">Bets %</span><span className="money">Money %</span></div>
        </div>

        <div className="dkChartBlock dkLineMovementBlock">
          <div className="dkChartLabel">
            <span>Line movement</span>
          </div>
          <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Line movement">
            {lineTicks.map((tick, index) => {
              const y = chartY(tick, minLine, maxLine, top, bottom);
              return (
                <g key={index}>
                  <line x1={left} y1={y} x2={right} y2={y} className="dkChartGrid" />
                  <text x="2" y={y + 3} className="dkChartTick">{lineLabel(play, Math.round(tick * 2) / 2)}</text>
                </g>
              );
            })}
            <polyline
              points={stepPolyline(lines, left, right, top, bottom, minLine, maxLine)}
              className="dkChartLine"
            />
            {markers.map((index) => {
              const x = chartX(index, lines.length, left, right);
              const y = chartY(lines[index], minLine, maxLine, top, bottom);
              const label = lineLabel(play, lines[index]);
              const ticketWidth = Math.max(38, label.length * 8 + 14);
              const ticketX = Math.max(left, Math.min(right - ticketWidth, x - ticketWidth / 2));
              const ticketY = Math.max(2, y - 31);
              return (
                <g className="dkLineTicket" key={`${index}-${label}`}>
                  <circle cx={x} cy={y} r="4" />
                  <g transform={`translate(${ticketX} ${ticketY})`}>
                    <rect width={ticketWidth} height="22" rx="7" />
                    <text x={ticketWidth / 2} y="15" textAnchor="middle">{label}</text>
                  </g>
                </g>
              );
            })}
          </svg>
          <div className="dkChartTimeAxis">{dates.map((date, index) => <span key={`${date}-${index}`}>{date}</span>)}</div>
        </div>
      </div>
    </section>
  );
}

function MarketRow({ play, plays, sport }: { play: TrendPlay; plays: TrendPlay[]; sport: Sport }) {
  const labels = labelsFor(play, plays, sport);
  const rlmSummary = labels.includes("Strong RLM") ? rlmBadgeSummary(play) : null;
  return (
    <div className={`dkTrendMarketRow ${labels.length ? "qualified" : ""}`}>
      <div className="dkTrendMarketName">
        <small>{play.market}{play.sideGroup ? ` - ${play.sideGroup}` : ""}</small>
        <strong><SelectionWithTeamLogo sport={sport} selection={pickLabel(play)} game={play.game} compact /></strong>
      </div>
      <div className="dkTrendPrice"><strong>{lineLabel(play, play.line)}</strong><small>{play.odds || "-"}</small></div>
      <div className="dkTrendFlow">
        <div className="dkTrendBarRow bets">
          <span>Bets</span>
          <div className="dkTrendBarTrack"><i style={{ width: `${clampPct(play.betsPct)}%` }} /></div>
          <strong>{pct(play.betsPct)}</strong>
        </div>
        <div className="dkTrendBarRow money">
          <span>Money</span>
          <div className="dkTrendBarTrack"><i style={{ width: `${clampPct(play.moneyPct)}%` }} /></div>
          <strong>{pct(play.moneyPct)}</strong>
        </div>
      </div>
      <div className="dkTrendBadges">
        {labels.map((label) => (
          <div className="dkTrendBadgeGroup" key={label}>
            <span className={`directTrendBadge ${label === "Public Fade" ? "fade" : "rlm"}`}>{label}</span>
            {label === "Strong RLM" && rlmSummary ? (
              <div
                className="rlmMovementMini"
                aria-label={`Strong RLM movement: bets ${rlmSummary.startBets} to ${rlmSummary.endBets}, line ${rlmSummary.startLine} to ${rlmSummary.endLine}`}
              >
                <span>
                  <b>Bets</b>
                  <span className="rlmMoveTrail">
                    <span className="rlmMoveValue">{rlmSummary.startBets}</span>
                    <span className="rlmMoveArrow">→</span>
                    <span className="rlmMoveValue">{rlmSummary.endBets}</span>
                  </span>
                </span>
                <span>
                  <b>Line</b>
                  <span className="rlmMoveTrail">
                    <span className="rlmMoveValue">{rlmSummary.startLine}</span>
                    <span className="rlmMoveArrow">→</span>
                    <span className="rlmMoveValue">{rlmSummary.endLine}</span>
                  </span>
                </span>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

const NFL_TEAM_PREFIXES = new Set([
  "ARI","ATL","BAL","BUF","CAR","CHI","CIN","CLE","DAL","DEN","DET","GB","HOU","IND","JAX","JAC",
  "KC","LV","LAC","LAR","LA","MIA","MIN","NE","NO","NY","NYG","NYJ","PHI","PIT","SEA","SF","TB","TEN","WAS"
]);

function cleanMatchupTeam(team: string, sport: Sport) {
  const raw = String(team || "").trim();
  if (sport !== "NFL") return raw;
  const parts = raw.split(/\s+/);
  if (parts.length > 1 && NFL_TEAM_PREFIXES.has(parts[0].toUpperCase())) return parts.slice(1).join(" ");
  return raw;
}

function matchupTeams(game: string, sport: Sport) {
  const raw = String(game || "").trim();
  const symbol = raw.split(/\s*@\s*/).map((part) => part.trim()).filter(Boolean);
  const words = symbol.length === 2
    ? symbol
    : raw.split(/\s+(?:at|vs\.?|versus)\s+/i).map((part) => part.trim()).filter(Boolean);
  if (words.length !== 2) return null;
  return {
    awayRaw: words[0],
    homeRaw: words[1],
    away: cleanMatchupTeam(words[0], sport),
    home: cleanMatchupTeam(words[1], sport),
  };
}

function GameCard({ group, sport }: { group: Group; sport: Sport }) {
  const ordered = [...group.plays].sort((a, b) => {
    if (a.market !== b.market) return a.market === "Spread" ? -1 : 1;
    if (a.market === "Total" && a.side !== b.side) return a.side === "Over" ? -1 : 1;
    return pickLabel(a).localeCompare(pickLabel(b));
  });
  const qualifying = ordered.filter((play) => labelsFor(play, ordered, sport).length > 0);
  const gameTime = ordered.find((play) => play.gameTime)?.gameTime || "";
  const gameDate = ordered.find((play) => play.date)?.date || "";
  const spreadRef = ordered.find((play) => play.market === "Spread");
  const totalRef = ordered.find((play) => play.market === "Total" && play.side === "Over")
    || ordered.find((play) => play.market === "Total");
  const matchup = matchupTeams(group.game, sport);

  return (
    <article className={`dkTrendGame ${qualifying.length ? "hasSignal" : ""}`}>
      <div className="dkTrendGameHead">
        <div className="dkTrendGameMatchupWrap">
          {matchup ? (
            <div className="dkTrendGameTitle dkTrendMatchupTitle">
              <TeamLogoName sport={sport} team={matchup.away} text={matchup.away} className="dkMatchupTeam" />
              <span className="dkTrendAt">at</span>
              <TeamLogoName sport={sport} team={matchup.home} text={matchup.home} className="dkMatchupTeam" />
            </div>
          ) : <div className="dkTrendGameTitle">{group.game}</div>}
          <small>{gameDate}{gameDate && gameTime ? " - " : ""}{gameTime}</small>
        </div>
        {qualifying.length ? (
          <span className="dkSignalCount">
            {qualifying.length} trend {qualifying.length === 1 ? "play" : "plays"}
          </span>
        ) : null}
      </div>

      <div className="dkTrendMarketBoard">
        <div className="dkTrendMarketHeader">
          <span>Market</span><span>Line / Odds</span><span>Bets / Money</span><span>Trend</span>
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

function historicalLabels(row: SheetRow, group: SheetRow[], sport: Sport) {
  const ownKey = historicalSelectionKey(row);
  const publicSide = group.find((candidate) => historicalSelectionKey(candidate) !== ownKey);
  if (!publicSide) return [] as string[];
  const labels: string[] = [];

  const publicBets = Number(publicSide["Public Bets %"] || publicSide["Current Public %"]);
  const publicMoney = Number(publicSide["Public Money %"] || publicSide["Current Sharp %"]);
  const placeholderSplit =
    (publicBets === 100 && publicMoney === 100) ||
    (publicBets === 0 && publicMoney === 0);
  const publicFade = sport === "NFL"
    ? !placeholderSplit && Number.isFinite(publicBets) && publicBets >= 80
    : Number.isFinite(publicBets) &&
      Number.isFinite(publicMoney) &&
      publicBets > 75 &&
      publicBets - publicMoney >= 55;
  if (publicFade) labels.push("Public Fade");

  const openingPublicBets = Number(publicSide["Opening Public %"] || publicSide["Opening Bets %"]);
  const publicMove = Number(publicSide["Public Change %"]);
  const lineMove = Number(publicSide["Line Movement Value"]);
  if (
    textKey(row.Market) === "spread" &&
    Number.isFinite(openingPublicBets) &&
    openingPublicBets > 0 &&
    openingPublicBets < 100 &&
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

export function DirectTrendRecords({ rows, sport }: { rows: SheetRow[]; today?: string; sport: Sport }) {
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
      historicalLabels(row, group, sport).forEach((signal) => labeled.push({ row, signal, category: recordCategory(row) }));
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
