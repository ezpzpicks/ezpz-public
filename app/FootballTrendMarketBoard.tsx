"use client";

import { SelectionWithTeamLogo, TeamLogoName } from "./TeamLogoName";

type SheetRow = Record<string, string>;
type Sport = "NFL" | "NCAAF" | "MLB";
type TrendPlay = {
  date?: string;
  game: string;
  gameKey: string;
  gameTime?: string;
  market: "Moneyline" | "Spread" | "Run Line" | "Total";
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
  lineMovementSignal?: string;
  snapshotStatus?: "LIVE" | "FINAL_PREGAME" | "MISSED_LOCK";
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

function isSpreadMarket(market: TrendPlay["market"]) {
  return market === "Spread" || market === "Run Line";
}

function usesNflTrendRules(sport: Sport) {
  return sport === "NFL" || sport === "MLB";
}

function americanImpliedProbabilityPct(value: unknown) {
  const match = String(value ?? "").replace(/−/g, "-").match(/[+-]?\d+/);
  if (!match) return null;
  const odds = Number(match[0]);
  if (!Number.isFinite(odds) || Math.abs(odds) < 100) return null;
  const probability = odds < 0
    ? Math.abs(odds) / (Math.abs(odds) + 100)
    : 100 / (odds + 100);
  return Math.round(probability * 1000) / 10;
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

function compactSnapshotTime(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "-";
  const twelveHour = raw.match(/(?:^|[\s,])(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)\b/i);
  if (twelveHour) {
    return `${Number(twelveHour[1])}:${twelveHour[2]} ${twelveHour[3].toUpperCase()} ET`;
  }
  const stamp = Date.parse(raw);
  if (!Number.isFinite(stamp)) return raw;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(stamp)) + " ET";
}

function trendDateParts(value: unknown) {
  const raw = String(value || "").trim();
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slash) return { year: Number(slash[3]), month: Number(slash[1]), day: Number(slash[2]) };
  const stamp = Date.parse(raw);
  if (!Number.isFinite(stamp)) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date(stamp));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  const year = get("year");
  const month = get("month");
  const day = get("day");
  return year && month && day ? { year, month, day } : null;
}

function trendTimeMinutes(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return Number.POSITIVE_INFINITY;

  const twelveHour = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)\b/i);
  if (twelveHour) {
    let hour = Number(twelveHour[1]) % 12;
    if (twelveHour[3].toUpperCase() === "PM") hour += 12;
    return hour * 60 + Number(twelveHour[2]);
  }

  const twentyFourHour = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (twentyFourHour) {
    const hour = Number(twentyFourHour[1]);
    const minute = Number(twentyFourHour[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) return hour * 60 + minute;
  }

  const stamp = Date.parse(raw);
  if (!Number.isFinite(stamp)) return Number.POSITIVE_INFINITY;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(stamp));
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  return hour * 60 + minute;
}

function trendTimeLabel(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const minutes = trendTimeMinutes(raw);
  if (!Number.isFinite(minutes)) return raw;
  const hour24 = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function trendDateLabel(value: unknown) {
  const parts = trendDateParts(value);
  if (!parts) return String(value || "").trim();
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(date);
}

function trendGameDateTimeLabel(dateValue: unknown, timeValue: unknown) {
  const date = trendDateLabel(dateValue);
  const time = trendTimeLabel(timeValue);
  if (date && time) return `${date} • ${time}`;
  return date || time || "";
}

function trendGroupSortValue(group: Group) {
  const gameDate = group.plays.find((play) => play.date)?.date || "";
  const gameTime = group.plays.find((play) => play.gameTime)?.gameTime || "";
  const date = trendDateParts(gameDate);
  const minutes = trendTimeMinutes(gameTime);
  if (!date) return Number.POSITIVE_INFINITY;
  const safeMinutes = Number.isFinite(minutes) ? minutes : 24 * 60;
  return Date.UTC(date.year, date.month - 1, date.day) + safeMinutes * 60_000;
}

function lineLabel(play: TrendPlay, value: number | null | undefined) {
  if (play.market === "Moneyline") return play.odds || "-";
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  if (isSpreadMarket(play.market)) return `${n > 0 ? "+" : ""}${n}`;
  return String(n);
}

function pickLabel(play: TrendPlay) {
  if (play.market === "Total") return `${play.side} ${lineLabel(play, play.line)}`.trim();
  if (play.market === "Moneyline") return `${play.selection} Moneyline`.trim();
  return `${play.selection} ${lineLabel(play, play.line)}`.trim();
}

function compactMovementLine(play: TrendPlay, value: number | null | undefined) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  const display = isSpreadMarket(play.market) ? Math.abs(n) : n;
  return Number.isInteger(display) ? String(display) : display.toFixed(1);
}

function rlmBadgeSummary(play: TrendPlay) {
  if (play.openingBetsPct == null) return null;
  const startBets = Number(play.openingBetsPct);
  const endBets = Number(play.betsPct);
  if (![startBets, endBets].every((value) => Number.isFinite(value))) return null;
  if (startBets <= 0 || startBets >= 100) return null;

  if (play.market === "Moneyline") {
    if (!play.openingOdds || !play.odds) return null;
    return {
      startBets: `${Math.round(startBets)}%`,
      endBets: `${Math.round(endBets)}%`,
      startLine: play.openingOdds,
      endLine: play.odds,
      movementLabel: "ML",
    };
  }

  if (play.openingLine == null || play.line == null) return null;
  const startLine = Number(play.openingLine);
  const endLine = Number(play.line);
  if (![startLine, endLine].every((value) => Number.isFinite(value))) return null;
  return {
    startBets: `${Math.round(startBets)}%`,
    endBets: `${Math.round(endBets)}%`,
    startLine: compactMovementLine(play, startLine),
    endLine: compactMovementLine(play, endLine),
    movementLabel: "Line",
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

const SHARP_MIN_MONEY_OVER_BETS = { NFL: 20, NCAAF: 25, MLB: 20 } as const;

function labelsFor(play: TrendPlay, plays: TrendPlay[], sport: Sport) {
  const labels: string[] = [];
  const ownBets = Number(play.betsPct);
  const ownMoney = Number(play.moneyPct);
  if (
    Number.isFinite(ownBets) &&
    Number.isFinite(ownMoney) &&
    ownMoney - ownBets >= SHARP_MIN_MONEY_OVER_BETS[sport]
  ) labels.push("Sharp");

  const publicSide = opposite(play, plays);
  if (!publicSide) return labels;

  const publicBets = Number(publicSide.betsPct);
  const publicMoney = Number(publicSide.moneyPct);
  const placeholderSplit =
    (publicBets === 100 && publicMoney === 100) ||
    (publicBets === 0 && publicMoney === 0);
  const publicFade = usesNflTrendRules(sport)
    ? !placeholderSplit && Number.isFinite(publicBets) && publicBets >= 80
    : Number.isFinite(publicBets) &&
      Number.isFinite(publicMoney) &&
      publicBets > 75 &&
      publicBets - publicMoney >= 55;
  if (publicFade) labels.push("Public Fade");

  const openingPublicBets = Number(publicSide.openingBetsPct);
  const publicMove = Number(publicSide.publicMovementPct);
  const lineMove = Number(publicSide.lineMovementValue);
  const footballLineRlm =
    sport !== "MLB" &&
    (
      (isSpreadMarket(play.market) &&
        (String(publicSide.lineMovementBasis || "").includes("Spread") ||
          String(publicSide.lineMovementBasis || "").includes("Run Line"))) ||
      (play.market === "Total" &&
        String(publicSide.lineMovementBasis || "").includes("Total Line"))
    );
  const mlbMoneylineRlm =
    sport === "MLB" &&
    play.market === "Moneyline" &&
    String(publicSide.lineMovementBasis || "").includes("Implied Probability");
  const mlbTotalRlm =
    sport === "MLB" &&
    play.market === "Total" &&
    String(publicSide.lineMovementBasis || "").includes("Total Line");
  if (
    (footballLineRlm || mlbMoneylineRlm || mlbTotalRlm) &&
    Number.isFinite(openingPublicBets) &&
    openingPublicBets > 0 &&
    openingPublicBets < 100 &&
    Number.isFinite(publicMove) &&
    publicMove >= 5 &&
    Number.isFinite(lineMove) &&
    lineMove <= -1.5
  ) labels.push("RLM");

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

  const base = [...(saved.length >= 2 ? saved : fallback)];
  // Some retained games store the opening snapshot separately from the series.
  // Include that recorded point without filling missing opening values from now.
  const openingEpoch = snapshotEpoch(play.firstTrackedAt);
  const firstSavedEpoch = saved.reduce((earliest, point) => {
    const epoch = snapshotEpoch(point.snapshotTime);
    return Number.isFinite(epoch) ? Math.min(earliest, epoch) : earliest;
  }, Number.POSITIVE_INFINITY);
  const hasOpeningValues =
    play.openingBetsPct != null && Number.isFinite(Number(play.openingBetsPct)) &&
    play.openingMoneyPct != null && Number.isFinite(Number(play.openingMoneyPct)) &&
    (play.market === "Moneyline"
      ? americanImpliedProbabilityPct(play.openingOdds) != null
      : play.openingLine != null && Number.isFinite(Number(play.openingLine)));
  if (saved.length >= 2 && hasOpeningValues && Number.isFinite(openingEpoch) && openingEpoch < firstSavedEpoch) {
    base.unshift({
      snapshotTime: play.firstTrackedAt!,
      line: play.openingLine ?? null,
      odds: play.openingOdds || "",
      betsPct: Number(play.openingBetsPct),
      moneyPct: Number(play.openingMoneyPct),
    });
  }
  const heartbeatTime = String(play.updatedAt || "").trim();
  if (heartbeatTime) {
    const heartbeatEpoch = snapshotEpoch(heartbeatTime);
    const lastEpoch = base.reduce((latest, point) => {
      const epoch = snapshotEpoch(point.snapshotTime);
      return Number.isFinite(epoch) ? Math.max(latest, epoch) : latest;
    }, Number.NEGATIVE_INFINITY);
    if (Number.isFinite(heartbeatEpoch) && heartbeatEpoch > lastEpoch) {
      base.push({
        snapshotTime: heartbeatTime,
        line: play.line,
        odds: play.odds,
        betsPct: Number(play.betsPct),
        moneyPct: Number(play.moneyPct),
      });
    }
  }

  const ordered = base.sort(
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
  const moneylineSeries = play.market === "Moneyline";
  const finiteLines = moneylineSeries
    ? points.map((point) => americanImpliedProbabilityPct(point.odds)).filter((value): value is number => value != null)
    : points.map((point) => Number(point.line)).filter(Number.isFinite);
  const firstLine = finiteLines[0] ?? 0;
  const lines = points.map((point) => {
    if (moneylineSeries) return americanImpliedProbabilityPct(point.odds) ?? firstLine;
    return Number.isFinite(Number(point.line)) ? Number(point.line) : firstLine;
  });
  const rawMin = finiteLines.length ? Math.min(...finiteLines) : 0;
  const rawMax = finiteLines.length ? Math.max(...finiteLines) : 1;
  const padding = rawMax === rawMin ? (moneylineSeries ? 1 : 1) : Math.max(moneylineSeries ? .75 : .5, (rawMax - rawMin) * .35);
  const minLine = rawMin - padding;
  const maxLine = rawMax + padding;
  const latest = points[points.length - 1];
  const latestSnapshotRaw = String(latest?.snapshotTime || "").trim();
  const latestSnapshotHasTime =
    /(?:^|[\\s,])\\d{1,2}:\\d{2}(?::\\d{2})?\\s*(?:AM|PM)\\b/i.test(latestSnapshotRaw) ||
    Number.isFinite(Date.parse(latestSnapshotRaw));
  const lastSnapshotDisplay = compactSnapshotTime(
    latestSnapshotHasTime ? latestSnapshotRaw : play.updatedAt,
  );
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
        <div className="dkMovementHeadMeta">
          <span className="dkMovementCurrentPrice">{play.market === "Moneyline" ? (latest?.odds || play.odds) : `${lineLabel(play, latest?.line)} ${latest?.odds || play.odds}`}</span>
          <span
            className="dkSnapshotHeartbeat"
            title={play.snapshotStatus === "FINAL_PREGAME"
              ? "Official frozen final pregame ScoresAndOdds snapshot for this market"
              : "Most recent successful ScoresAndOdds snapshot for this market"}
          >
            <i aria-hidden="true" />
            {play.snapshotStatus === "FINAL_PREGAME" ? "Final snapshot" : "Last snapshot"} {lastSnapshotDisplay}
          </span>
        </div>
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
            <span>{play.market === "Moneyline" ? "Moneyline movement" : "Line movement"}</span>
          </div>
          <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Line movement">
            {lineTicks.map((tick, index) => {
              const y = chartY(tick, minLine, maxLine, top, bottom);
              return (
                <g key={index}>
                  <line x1={left} y1={y} x2={right} y2={y} className="dkChartGrid" />
                  <text x="2" y={y + 3} className="dkChartTick">{play.market === "Moneyline" ? `${tick.toFixed(1)}%` : lineLabel(play, Math.round(tick * 2) / 2)}</text>
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
              const label = play.market === "Moneyline"
                ? (points[index]?.odds || "-")
                : lineLabel(play, lines[index]);
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
  const rlmPublicSide = labels.includes("RLM") ? opposite(play, plays) : null;
  const rlmSummary = rlmPublicSide ? rlmBadgeSummary(rlmPublicSide) : null;
  return (
    <div className={`dkTrendMarketRow ${labels.length ? "qualified" : ""}`}>
      <div className="dkTrendMarketName">
        <small>{play.market}{play.sideGroup ? ` - ${play.sideGroup}` : ""}</small>
        <strong><SelectionWithTeamLogo sport={sport} selection={pickLabel(play)} game={play.game} compact /></strong>
      </div>
      <div className="dkTrendPrice">
        <strong>{play.market === "Moneyline" ? (play.odds || "-") : lineLabel(play, play.line)}</strong>
        <small>{play.market === "Moneyline" ? "ML" : (play.odds || "-")}</small>
      </div>
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
            <span className={`directTrendBadge ${label === "Public Fade" ? "fade" : label === "RLM" ? "rlm" : "sharp"}`}>{label}</span>
            {label === "RLM" && rlmSummary ? (
              <div
                className="rlmMovementMini"
                aria-label={`RLM movement: bets ${rlmSummary.startBets} to ${rlmSummary.endBets}, line ${rlmSummary.startLine} to ${rlmSummary.endLine}`}
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
                  <b>{rlmSummary.movementLabel || "Line"}</b>
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

const NFL_TEAM_DISPLAY: Record<string, string> = {
  ari: "Cardinals", arizona: "Cardinals", cardinals: "Cardinals", "arizona cardinals": "Cardinals",
  atl: "Falcons", atlanta: "Falcons", falcons: "Falcons", "atlanta falcons": "Falcons",
  bal: "Ravens", baltimore: "Ravens", ravens: "Ravens", "baltimore ravens": "Ravens",
  buf: "Bills", buffalo: "Bills", bills: "Bills", "buffalo bills": "Bills",
  car: "Panthers", carolina: "Panthers", panthers: "Panthers", "carolina panthers": "Panthers",
  chi: "Bears", chicago: "Bears", bears: "Bears", "chicago bears": "Bears",
  cin: "Bengals", cincinnati: "Bengals", bengals: "Bengals", "cincinnati bengals": "Bengals",
  cle: "Browns", clv: "Browns", cleveland: "Browns", browns: "Browns", "cleveland browns": "Browns",
  dal: "Cowboys", dallas: "Cowboys", cowboys: "Cowboys", "dallas cowboys": "Cowboys",
  den: "Broncos", denver: "Broncos", broncos: "Broncos", "denver broncos": "Broncos",
  det: "Lions", detroit: "Lions", lions: "Lions", "detroit lions": "Lions",
  gb: "Packers", "green bay": "Packers", packers: "Packers", "green bay packers": "Packers",
  hou: "Texans", hst: "Texans", houston: "Texans", texans: "Texans", "houston texans": "Texans",
  ind: "Colts", indianapolis: "Colts", colts: "Colts", "indianapolis colts": "Colts",
  jac: "Jaguars", jax: "Jaguars", jacksonville: "Jaguars", jaguars: "Jaguars", "jacksonville jaguars": "Jaguars",
  kc: "Chiefs", "kansas city": "Chiefs", chiefs: "Chiefs", "kansas city chiefs": "Chiefs",
  lv: "Raiders", oak: "Raiders", "las vegas": "Raiders", raiders: "Raiders", "las vegas raiders": "Raiders",
  lac: "Chargers", sd: "Chargers", chargers: "Chargers", "los angeles chargers": "Chargers",
  la: "Rams", lar: "Rams", stl: "Rams", rams: "Rams", "la rams": "Rams", "lar rams": "Rams", "los angeles rams": "Rams",
  mia: "Dolphins", miami: "Dolphins", dolphins: "Dolphins", "miami dolphins": "Dolphins",
  min: "Vikings", minnesota: "Vikings", vikings: "Vikings", "minnesota vikings": "Vikings",
  ne: "Patriots", "new england": "Patriots", patriots: "Patriots", "new england patriots": "Patriots",
  no: "Saints", "new orleans": "Saints", saints: "Saints", "new orleans saints": "Saints",
  nyg: "Giants", giants: "Giants", "ny giants": "Giants", "new york giants": "Giants",
  nyj: "Jets", jets: "Jets", "ny jets": "Jets", "new york jets": "Jets",
  phi: "Eagles", philadelphia: "Eagles", eagles: "Eagles", "philadelphia eagles": "Eagles",
  pit: "Steelers", pittsburgh: "Steelers", steelers: "Steelers", "pittsburgh steelers": "Steelers",
  sea: "Seahawks", seattle: "Seahawks", seahawks: "Seahawks", "seattle seahawks": "Seahawks",
  sf: "49ers", "san francisco": "49ers", "49ers": "49ers", "san francisco 49ers": "49ers",
  tb: "Buccaneers", tampa: "Buccaneers", "tampa bay": "Buccaneers", buccaneers: "Buccaneers", "tampa bay buccaneers": "Buccaneers",
  ten: "Titans", tennessee: "Titans", titans: "Titans", "tennessee titans": "Titans",
  was: "Commanders", wsh: "Commanders", washington: "Commanders", commanders: "Commanders", "washington commanders": "Commanders",
};

function cleanMatchupTeam(team: string, sport: Sport) {
  const raw = String(team || "").trim();
  if (sport !== "NFL") return raw;

  const exact = NFL_TEAM_DISPLAY[textKey(raw)];
  if (exact) return exact;

  const parts = raw.split(/\s+/);
  if (parts.length > 1 && NFL_TEAM_PREFIXES.has(parts[0].toUpperCase())) {
    const stripped = parts.slice(1).join(" ");
    return NFL_TEAM_DISPLAY[textKey(stripped)] || stripped;
  }
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
    if (a.market !== b.market) return isSpreadMarket(a.market) ? -1 : 1;
    if (a.market === "Total" && a.side !== b.side) return a.side === "Over" ? -1 : 1;
    return pickLabel(a).localeCompare(pickLabel(b));
  });
  const qualifying = ordered.filter((play) => labelsFor(play, ordered, sport).length > 0);
  const gameTime = ordered.find((play) => play.gameTime)?.gameTime || "";
  const gameDate = ordered.find((play) => play.date)?.date || "";
  const sideMarketRefs = ordered.filter((play) => isSpreadMarket(play.market) || play.market === "Moneyline");
  const totalRefs = ordered.filter((play) => play.market === "Total");
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
          <small className="dkTrendGameDateTime">{trendGameDateTimeLabel(gameDate, gameTime)}</small>
        </div>
        {qualifying.length ? (
          <span className="dkSignalCount">
            {qualifying.length} split {qualifying.length === 1 ? "signal" : "signals"}
          </span>
        ) : null}
      </div>

      <div className="dkTrendMarketBoard">
        <div className="dkTrendMarketHeader">
          <span>Market</span><span>Line / Odds</span><span>Bets / Money</span><span>Split Signal</span>
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
          {sideMarketRefs.map((play) => (
            <MovementChart
              key={`${play.gameKey}-movement-${play.market}-${play.selection}-${play.side}`}
              play={play}
            />
          ))}
          {totalRefs.map((play) => (
            <MovementChart
              key={`${play.gameKey}-movement-${play.market}-${play.selection}-${play.side}`}
              play={play}
            />
          ))}
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
  const directKey = String(row["Direct Trend Group Key"] || "").trim();
  if (directKey) return directKey;
  return `${String(row.Date || "")}|${String(row["Game Key"] || row["Game ID"] || row.Game || "")}|${textKey(row.Market)}`;
}

function sameHistoricalTrendSelection(row: SheetRow, play: TrendPlay) {
  const rowKey = historicalSelectionKey(row);
  const playKey = textKey(play.market === "Total"
    ? play.side || play.selection
    : play.selectionTeam || play.selection);
  if (!rowKey || !playKey) return false;
  if (rowKey === playKey || rowKey.includes(playKey) || playKey.includes(rowKey)) return true;
  const rowParts = rowKey.split(" ").filter(Boolean);
  const playParts = playKey.split(" ").filter(Boolean);
  const rowLast = rowParts[rowParts.length - 1] || "";
  const playLast = playParts[playParts.length - 1] || "";
  return rowLast.length >= 3 && rowLast === playLast;
}

function settledHistoricalRowForTrendPlay(play: TrendPlay, rows: SheetRow[]) {
  const dateKey = textKey(play.date);
  const marketKey = textKey(play.market);
  const candidates = rows.filter((row) =>
    resultCode(row.Result || row.Status) &&
    textKey(row.Date) === dateKey &&
    textKey(row.Market) === marketKey &&
    sameHistoricalTrendSelection(row, play)
  );
  if (!candidates.length) return null;
  const playLine = Number(play.line);
  return [...candidates].sort((a, b) => {
    const aLine = Number(a["Public Split Line"] || a.Line);
    const bLine = Number(b["Public Split Line"] || b.Line);
    const aExact = Number.isFinite(playLine) && Number.isFinite(aLine) && Math.abs(aLine - playLine) < 0.001 ? 1 : 0;
    const bExact = Number.isFinite(playLine) && Number.isFinite(bLine) && Math.abs(bLine - playLine) < 0.001 ? 1 : 0;
    if (aExact !== bExact) return bExact - aExact;
    const aUseful = Number.isFinite(aLine) && aLine !== 0 ? 1 : 0;
    const bUseful = Number.isFinite(bLine) && bLine !== 0 ? 1 : 0;
    return bUseful - aUseful;
  })[0];
}

function historicalLabels(row: SheetRow, group: SheetRow[], sport: Sport) {
  const labels: string[] = [];
  const ownBets = Number(row["Public Bets %"] || row["Current Public %"]);
  const ownMoney = Number(row["Public Money %"] || row["Current Sharp %"]);
  if (
    Number.isFinite(ownBets) &&
    Number.isFinite(ownMoney) &&
    ownMoney - ownBets >= SHARP_MIN_MONEY_OVER_BETS[sport]
  ) labels.push("Sharp");

  const ownKey = historicalSelectionKey(row);
  const publicSide = group.find((candidate) => historicalSelectionKey(candidate) !== ownKey);
  if (!publicSide) return labels;

  const publicBets = Number(publicSide["Public Bets %"] || publicSide["Current Public %"]);
  const publicMoney = Number(publicSide["Public Money %"] || publicSide["Current Sharp %"]);
  const placeholderSplit =
    (publicBets === 100 && publicMoney === 100) ||
    (publicBets === 0 && publicMoney === 0);
  const publicFade = usesNflTrendRules(sport)
    ? !placeholderSplit && Number.isFinite(publicBets) && publicBets >= 80
    : Number.isFinite(publicBets) &&
      Number.isFinite(publicMoney) &&
      publicBets > 75 &&
      publicBets - publicMoney >= 55;
  if (publicFade) labels.push("Public Fade");

  const openingPublicBets = Number(publicSide["Opening Public %"] || publicSide["Opening Bets %"]);
  const publicMove = Number(publicSide["Public Change %"]);
  const lineMove = Number(publicSide["Line Movement Value"]);
  const marketKey = textKey(row.Market);
  const footballLineRlm =
    sport !== "MLB" &&
    (
      ((marketKey === "spread" || marketKey === "run line") &&
        (String(publicSide["Line Movement Basis"] || "").includes("Spread") ||
          String(publicSide["Line Movement Basis"] || "").includes("Run Line"))) ||
      (marketKey === "total" &&
        String(publicSide["Line Movement Basis"] || "").includes("Total Line"))
    );
  const mlbMoneylineRlm =
    sport === "MLB" &&
    marketKey === "moneyline" &&
    String(publicSide["Line Movement Basis"] || "").includes("Implied Probability");
  const mlbTotalRlm =
    sport === "MLB" &&
    marketKey === "total" &&
    String(publicSide["Line Movement Basis"] || "").includes("Total Line");
  if (
    (footballLineRlm || mlbMoneylineRlm || mlbTotalRlm) &&
    Number.isFinite(openingPublicBets) &&
    openingPublicBets > 0 &&
    openingPublicBets < 100 &&
    Number.isFinite(publicMove) &&
    publicMove >= 5 &&
    Number.isFinite(lineMove) &&
    lineMove <= -1.5
  ) labels.push("RLM");

  return labels;
}

function recordCategory(row: SheetRow) {
  const market = textKey(row.Market);
  if (market === "total") return textKey(row.Side || row.Selection).startsWith("under") ? "Under" : "Over";
  if (market === "moneyline") {
    const odds = Number(String(row.Odds || "").replace(/[^0-9+-]/g, ""));
    return Number.isFinite(odds) && odds < 0 ? "Favorite Moneyline" : "Underdog Moneyline";
  }
  const line = Number(row["Public Split Line"] || row.Line);
  return Number.isFinite(line) && line > 0 ? "Underdog Spread" : "Favorite Spread";
}

function tone(record: RecordTotals) {
  if (record.wins > record.losses) return "green";
  if (record.losses > record.wins) return "red";
  return "yellow";
}

type DirectTrendPickRecord = {
  candidateId?: string;
  date?: string;
  gameKey?: string;
  gameTime?: string;
  game?: string;
  market?: string;
  play?: string;
  selection?: string;
  line?: string;
  odds?: string;
  trendTier?: string;
  tier?: string;
  qualification?: string;
  source?: string;
  confidenceReason?: string[];
  selected?: boolean;
  protectionStatus?: string;
  snapshotStatus?: string;
  result?: string;
  selectorVersion?: string;
};

export function DirectTrendRecords({
  rows,
  trendPlays = [],
  aiPickRows = [],
  sport,
}: {
  rows: SheetRow[];
  trendPlays?: TrendPlay[];
  aiPickRows?: DirectTrendPickRecord[];
  today?: string;
  sport: Sport;
}) {
  const grouped = new Map<string, SheetRow[]>();
  rows.forEach((row) => {
    if (!resultCode(row.Result || row.Status)) return;
    const key = historicalGroupKey(row);
    const existing = grouped.get(key);
    if (existing) existing.push(row); else grouped.set(key, [row]);
  });

  const labeled: Array<{ row: SheetRow; signal: string; category: string }> = [];
  grouped.forEach((group) => {
    // Multiple storage identities can represent the same completed game (for example,
    // model game IDs and ESPN IDs). Collapse those duplicates to one row per market
    // side before grading direct trends so one result is never counted twice.
    const uniqueBySelection = new Map<string, SheetRow>();
    group.forEach((row) => {
      const sideKey = historicalSelectionKey(row);
      if (sideKey && !uniqueBySelection.has(sideKey)) uniqueBySelection.set(sideKey, row);
    });
    const uniqueGroup = [...uniqueBySelection.values()];
    uniqueGroup.forEach((row) => {
      historicalLabels(row, uniqueGroup, sport).forEach((signal) => labeled.push({ row, signal, category: recordCategory(row) }));
    });
  });

  // Recover completed direct-trend results from finalized pregame snapshots using
  // ONLY the current Public Fade, RLM, and Sharp definitions. This avoids
  // legacy signal labels while still handling historical rows stored under
  // different game IDs.
  if (trendPlays.length) {
    const finalized = trendPlays.filter((play) => play.snapshotStatus === "FINAL_PREGAME");
    finalized.forEach((play) => {
      const siblings = finalized.filter((candidate) =>
        textKey(candidate.date) === textKey(play.date) &&
        textKey(candidate.game) === textKey(play.game)
      );
      const directLabels = labelsFor(play, siblings, sport);
      if (!directLabels.length) return;

      const settled = settledHistoricalRowForTrendPlay(play, rows);
      if (!settled) return;

      const recovered: SheetRow = {
        ...settled,
        "Public Split Line": Number.isFinite(Number(play.line))
          ? String(play.line)
          : String(settled["Public Split Line"] || settled.Line || ""),
        "Public Bets %": String(play.betsPct),
        "Public Money %": String(play.moneyPct),
        "Opening Public %": play.openingBetsPct == null ? "" : String(play.openingBetsPct),
        "Public Change %": play.publicMovementPct == null ? "" : String(play.publicMovementPct),
        "Line Movement Basis": String(play.lineMovementBasis || ""),
        "Line Movement Value": play.lineMovementValue == null ? "" : String(play.lineMovementValue),
      };

      directLabels.forEach((signal) => {
        const alreadyTracked = labeled.some((item) =>
          item.signal === signal &&
          textKey(item.row.Date) === textKey(play.date) &&
          textKey(item.row.Market) === textKey(play.market) &&
          sameHistoricalTrendSelection(item.row, play)
        );
        if (!alreadyTracked) labeled.push({ row: recovered, signal, category: recordCategory(recovered) });
      });
    });
  }

  // Finalized direct-trend EZPZ picks are the durable source of truth for the
  // new MLB Public Fade / RLM / Sharp system. They are stored in
  // aiPickRecordRows, while legacy trendRecordRows may have no row at all.
  // Merge those finalized picks into the trend-record ledger and de-duplicate
  // against any historical row that already represents the same decision.
  if (aiPickRows.length) {
    const activeSignals = ["Public Fade", "RLM", "Sharp"] as const;
    aiPickRows.forEach((pick) => {
      if (!resultCode(pick.result)) return;

      if (sport === "MLB") {
        // Preserve the MLB recovery path exactly: only finalized, selected
        // direct-trend picks from the current selector are eligible.
        if (
          !pick.selected ||
          pick.protectionStatus !== "PASSED" ||
          pick.snapshotStatus !== "FINAL_PREGAME" ||
          !String(pick.selectorVersion || "").startsWith("mlb-direct-trends")
        ) return;
      } else {
        // Football EZPZ history is already the durable ledger of picks that
        // were actually published. Recover only saved Trend Play / Best + Trend
        // decisions once they have a verified grade.
        const sourceKey = textKey(pick.source);
        const isSavedTrendPick =
          sourceKey === textKey("Trend Play") ||
          sourceKey === textKey("Best + Trend");
        if (!isSavedTrendPick) return;
        if (
          pick.selected === false ||
          textKey(pick.protectionStatus) === "blocked"
        ) return;
      }

      const signalSources = [
        String(pick.trendTier || ""),
        String(pick.tier || ""),
        String(pick.qualification || ""),
        ...(pick.confidenceReason || []).map((value) => String(value || "")),
      ].map(textKey);
      const signals = activeSignals.filter((signal) =>
        signalSources.some((value) => value.includes(textKey(signal)))
      );
      if (!signals.length) return;

      const market = String(pick.market || "");
      const marketKey = textKey(market);
      const selectionText = String(pick.selection || pick.play || "");
      const totalSide =
        marketKey === "total"
          ? (textKey(selectionText).startsWith("under") ? "Under" : "Over")
          : "";
      const inlineLine =
        (marketKey === "spread" || marketKey === "run line")
          ? selectionText.match(/\s([+-]?\d+(?:\.\d+)?)\s*$/)?.[1] || ""
          : "";
      const recoveredLine = String(pick.line || inlineLine || "");
      const recoveredSelectionText =
        marketKey === "spread" || marketKey === "run line"
          ? selectionText.replace(/\s+[+-]?\d+(?:\.\d+)?\s*$/, "").trim()
          : selectionText;
      const recovered: SheetRow = {
        Date: String(pick.date || ""),
        Game: String(pick.game || ""),
        "Game Key": String(pick.gameKey || ""),
        "Game Time": String(pick.gameTime || ""),
        Market: market,
        Selection: marketKey === "total" ? totalSide : recoveredSelectionText,
        Side: totalSide,
        Line: recoveredLine,
        "Public Split Line": recoveredLine,
        Odds: String(pick.odds || ""),
        "Public Split Odds": String(pick.odds || ""),
        Result: String(pick.result || ""),
      };

      const recoveredSelection = historicalSelectionKey(recovered);
      signals.forEach((signal) => {
        const alreadyTracked = labeled.some((item) => {
          if (
            item.signal !== signal ||
            textKey(item.row.Date) !== textKey(recovered.Date) ||
            textKey(item.row.Market) !== textKey(recovered.Market) ||
            historicalSelectionKey(item.row) !== recoveredSelection
          ) return false;

          const itemGameKey = textKey(item.row["Game Key"] || item.row["Game ID"]);
          const recoveredGameKey = textKey(recovered["Game Key"]);
          if (itemGameKey && recoveredGameKey && itemGameKey === recoveredGameKey) return true;

          const itemGameTime = textKey(item.row["Game Time"]);
          const recoveredGameTime = textKey(recovered["Game Time"]);
          if (itemGameTime && recoveredGameTime) {
            return (
              itemGameTime === recoveredGameTime &&
              textKey(item.row.Game) === textKey(recovered.Game)
            );
          }

          return textKey(item.row.Game) === textKey(recovered.Game);
        });

        if (!alreadyTracked) {
          labeled.push({
            row: recovered,
            signal,
            category: recordCategory(recovered),
          });
        }
      });
    });
  }

  const summaries: Array<{ label: string; totals: RecordTotals }> = [];
  ["Public Fade", "RLM", "Sharp"].forEach((signal) => {
    let signalRows = labeled.filter((item) => item.signal === signal);
    if (signal === "RLM") {
      // RLM is side-specific. A team can appear twice in historical storage
      // under different game IDs, so use one settled result per team/date.
      const unique = new Map<string, (typeof signalRows)[number]>();
      signalRows.forEach((item) => {
        const key = `${String(item.row.Date || "")}|${historicalSelectionKey(item.row)}`;
        if (!unique.has(key)) unique.set(key, item);
      });
      signalRows = [...unique.values()];
    }
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
          <div className="recordsSummaryTitle">Public Fade + RLM + Sharp Records</div>
        </div>
        <span className="recordsCount">{labeled.length} graded</span>
      </summary>
      {summaries.length ? (
        <div className="tableWrap">
          <table className="recordsTable">
            <thead><tr><th>Split Signal</th><th>Record</th><th>Win %</th><th>Units</th><th>ROI</th><th>Bets</th></tr></thead>
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
      ) : <div className="empty insideDropdown">No completed Public Fade, RLM, or Sharp results are available yet.</div>}
    </details>
  );
}

export function FootballTrendMarketBoard({ groups, sport }: { groups: Group[]; sport: Sport }) {
  const sortedGroups = [...groups].sort((a, b) => {
    const timeDifference = trendGroupSortValue(a) - trendGroupSortValue(b);
    if (Number.isFinite(timeDifference) && timeDifference !== 0) return timeDifference;
    return a.game.localeCompare(b.game);
  });
  return sortedGroups.length
    ? <div className="dkTrendGameGrid">{sortedGroups.map((group) => <GameCard key={group.plays[0]?.gameKey || group.game} group={group} sport={sport} />)}</div>
    : null;
}
