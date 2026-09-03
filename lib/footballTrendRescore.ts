import type { WeeklyTrendPlay } from "./footballWeeklyMarket";
import { readSportWorksheet, type FootballSport, type SheetRow } from "./sportSheets";

type ResultCode = "W" | "L" | "P";
type WeeklyFootballMarket = "Spread" | "Total";
type Tone = "negative" | "caution" | "positive" | "neutral";
type TrendSignal = WeeklyTrendPlay["signals"][number];

type TrendRecord = {
  record: string;
  totalBets: number;
  wins: number;
  losses: number;
  pushes: number;
  winPct: number;
  roiPct: number;
  unitsWon: number;
};

type WindowRecords = {
  allTime: TrendRecord;
  last30: TrendRecord;
  last7: TrendRecord;
};

type HistoryRow = {
  date: string;
  market: WeeklyFootballMarket;
  sideGroup: WeeklyTrendPlay["sideGroup"];
  signalKey: string;
  result: ResultCode;
  odds: number;
  units: number;
};

type TrendWindowMetrics = {
  score: number;
  roiPct: number;
  winPct: number;
  hasData: boolean;
};

type WeeklyMarketPayload = {
  trendPlays?: WeeklyTrendPlay[];
  [key: string]: unknown;
};

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

function normalizedDate(value: unknown) {
  const raw = String(value || "").trim();
  const iso = raw.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const us = raw.match(/(\d{1,2})\/(\d{1,2})\/(20\d{2})/);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  return raw;
}

function parseOdds(value: unknown) {
  const match = String(value || "").replace(/−/g, "-").match(/[+-]?\d{3,4}/);
  const parsed = match ? Number(match[0]) : -110;
  return Number.isFinite(parsed) ? parsed : -110;
}

function numericLine(value: unknown) {
  const matches = String(value || "").replace(/[−–—]/g, "-").match(/[+-]?\d+(?:\.\d+)?/g);
  const raw = matches?.length ? matches[matches.length - 1] : "";
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function resultCode(value: unknown): ResultCode | "" {
  const key = String(value || "").trim().toUpperCase();
  if (["W", "WIN", "WON"].includes(key)) return "W";
  if (["L", "LOSS", "LOST"].includes(key)) return "L";
  if (["P", "PUSH", "VOID", "CANCELLED", "CANCELED"].includes(key)) return "P";
  return "";
}

function profitUnits(odds: number) {
  return odds > 0 ? odds / 100 : odds < 0 ? 100 / Math.abs(odds) : 1;
}

function historyMarket(row: SheetRow): WeeklyFootballMarket | null {
  const market = textKey(row.Market || row["Bet Type"]);
  if (market.includes("spread")) return "Spread";
  if (market.includes("total")) return "Total";
  return null;
}

function historySideGroup(row: SheetRow, market: WeeklyFootballMarket): WeeklyTrendPlay["sideGroup"] {
  if (market === "Total") {
    const side = textKey(row.Side || row.Selection);
    return side.startsWith("under") ? "Under" : side.startsWith("over") ? "Over" : "";
  }
  const line = numericLine(row["Public Split Line"] || row.Line || row.Selection);
  return line == null || Math.abs(line) < 1e-9 ? "" : line < 0 ? "Favorite" : "Underdog";
}

function publicSplitSignalKey(label: unknown) {
  const key = textKey(label);
  if (key.includes("extreme bets") && key.includes("handle")) return "EXTREME_PUBLIC_SHARP_AGREEMENT";
  if (key.includes("heavy bets") && key.includes("handle")) return "HEAVY_PUBLIC_SHARP_AGREEMENT";
  if (key.includes("strong handle below bets")) return "STRONG_SHARP_REJECTION";
  if (key.includes("handle below bets")) return "SHARP_REJECTION";
  if (key.includes("strong handle above bets")) return "STRONG_SHARP_SUPPORT";
  if (key.includes("handle above bets")) return "SHARP_SUPPORT";
  if (key.includes("balanced bets") || key.includes("balanced public")) return "BALANCED_PUBLIC_SHARP_SPLIT";
  return key.toUpperCase().replace(/\s+/g, "_");
}

function movementSignalKey(value: unknown) {
  const key = textKey(value);
  if (key.includes("reverse line movement")) return "REVERSE_LINE_MOVEMENT";
  if (key.includes("line movement confirmation")) return "LINE_MOVEMENT_CONFIRMATION";
  if (key.includes("adverse line movement")) return "ADVERSE_LINE_MOVEMENT";
  return key.toUpperCase().replace(/\s+/g, "_");
}

function warningSignalKey(betsPct: number, moneyPct: number) {
  const gapPct = moneyPct - betsPct;
  if (betsPct >= 90 && moneyPct >= 90) return "EXTREME_PUBLIC_SHARP_AGREEMENT";
  if (betsPct >= 80 && moneyPct >= 80) return "HEAVY_PUBLIC_SHARP_AGREEMENT";
  if (gapPct <= -20) return "STRONG_SHARP_REJECTION";
  if (gapPct <= -10) return "SHARP_REJECTION";
  if (gapPct >= 20) return "STRONG_SHARP_SUPPORT";
  if (gapPct >= 10) return "SHARP_SUPPORT";
  return "BALANCED_PUBLIC_SHARP_SPLIT";
}

function reconstructedHistorySignals(row: SheetRow) {
  const betsPct = Number(String(row["Public Bets %"] || "").replace("%", ""));
  const moneyPct = Number(String(row["Public Money %"] || "").replace("%", ""));
  const storedWarning = String(row["Public Warning"] || row.Warning || "").trim();
  const signals: string[] = [];

  if (Number.isFinite(betsPct) && Number.isFinite(moneyPct)) {
    signals.push(warningSignalKey(betsPct, moneyPct));
  } else if (storedWarning) {
    signals.push(publicSplitSignalKey(storedWarning));
  }

  const movement = String(row["Line Movement Signal"] || "").trim();
  if (movement) signals.push(movementSignalKey(movement));
  return signals.filter(Boolean);
}

function historyFromAllGameTrends(rows: SheetRow[]) {
  const output: HistoryRow[] = [];
  for (const row of rows) {
    const result = resultCode(row.Result || row.Status);
    if (!result) continue;

    const raw = String(row["Trend Score Details"] || "").trim();
    if (raw) {
      try {
        const play = JSON.parse(raw) as WeeklyTrendPlay;
        const odds = parseOdds(row["Public Split Odds"] || row.Odds || play.odds);
        const savedSignals = play.signals || [];
        for (const signal of savedSignals) {
          const signalKey = signal.signalType === "Line Movement"
            ? movementSignalKey(signal.signal || signal.signalKey)
            : signal.signalKey || publicSplitSignalKey(signal.signal);
          if (!signalKey) continue;
          output.push({
            date: normalizedDate(row.Date || play.date),
            market: play.market,
            sideGroup: play.sideGroup,
            signalKey,
            result,
            odds,
            units: result === "P" ? 0 : result === "L" ? -1 : profitUnits(odds),
          });
        }
        if (savedSignals.length) continue;
      } catch {
        // Legacy rows are reconstructed from their stored market columns below.
      }
    }

    const market = historyMarket(row);
    if (!market) continue;
    const signalKeys = reconstructedHistorySignals(row);
    if (!signalKeys.length) continue;
    const sideGroup = historySideGroup(row, market);
    const odds = parseOdds(row["Public Split Odds"] || row.Odds);
    for (const signalKey of signalKeys) {
      output.push({
        date: normalizedDate(row.Date),
        market,
        sideGroup,
        signalKey,
        result,
        odds,
        units: result === "P" ? 0 : result === "L" ? -1 : profitUnits(odds),
      });
    }
  }
  return output;
}

function emptyRecord(): TrendRecord {
  return { record: "0-0-0", totalBets: 0, wins: 0, losses: 0, pushes: 0, winPct: 0, roiPct: 0, unitsWon: 0 };
}

function record(rows: HistoryRow[]): TrendRecord {
  if (!rows.length) return emptyRecord();
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let unitsWon = 0;
  for (const row of rows) {
    if (row.result === "W") wins += 1;
    else if (row.result === "L") losses += 1;
    else pushes += 1;
    unitsWon += row.units;
  }
  const totalBets = wins + losses + pushes;
  const decisions = wins + losses;
  return {
    record: `${wins}-${losses}-${pushes}`,
    totalBets,
    wins,
    losses,
    pushes,
    winPct: decisions ? Math.round((wins / decisions) * 1000) / 10 : 0,
    roiPct: totalBets ? Math.round((unitsWon / totalBets) * 1000) / 10 : 0,
    unitsWon: Math.round(unitsWon * 100) / 100,
  };
}

function withinDays(rows: HistoryRow[], referenceDate: string, days: number) {
  const reference = Date.parse(`${normalizedDate(referenceDate)}T12:00:00Z`);
  return rows.filter((row) => {
    const at = Date.parse(`${normalizedDate(row.date)}T12:00:00Z`);
    const diff = Math.round((reference - at) / 86_400_000);
    return Number.isFinite(diff) && diff >= 0 && diff < days;
  });
}

function windows(rows: HistoryRow[], referenceDate: string): WindowRecords {
  return {
    allTime: record(rows),
    last30: record(withinDays(rows, referenceDate, 30)),
    last7: record(withinDays(rows, referenceDate, 7)),
  };
}

type TrendScorePoint = readonly [number, number];

// These are intentionally identical to the MLB public-data trend score curves.
const TREND_ROI_SCORE_POINTS: TrendScorePoint[] = [
  [-100, 0], [-75, 3], [-50, 8], [-40, 13], [-30, 20], [-20, 28], [-10, 38], [-5, 44],
  [0, 50], [5, 56], [10, 62], [20, 72], [25, 80], [30, 86], [40, 92], [50, 96], [75, 99], [100, 100],
];

const TREND_WIN_SCORE_POINTS: TrendScorePoint[] = [
  [0, 0], [15, 0], [20, 4], [25, 9], [30, 16], [35, 24], [40, 33], [45, 42], [50, 50],
  [55, 58], [60, 67], [65, 79], [70, 89], [75, 95], [80, 98], [85, 100], [100, 100],
];

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 50));
}

function trendScaledScore(value: number, points: TrendScorePoint[]) {
  if (!Number.isFinite(value)) return 50;
  if (value <= points[0][0]) return points[0][1];
  const last = points[points.length - 1];
  if (value >= last[0]) return last[1];
  for (let index = 1; index < points.length; index += 1) {
    const [upperValue, upperScore] = points[index];
    if (value > upperValue) continue;
    const [lowerValue, lowerScore] = points[index - 1];
    const span = upperValue - lowerValue;
    const ratio = span > 0 ? (value - lowerValue) / span : 0;
    return lowerScore + (upperScore - lowerScore) * ratio;
  }
  return last[1];
}

function trendWindowWeights() {
  // Exact MLB policy: all-time is display context; scoring is 1/3 last 30 + 2/3 last 7.
  return [
    { key: "allTime" as const, weight: 0 },
    { key: "last30" as const, weight: 1 / 3 },
    { key: "last7" as const, weight: 2 / 3 },
  ];
}

function trendRecordScore(recordValue: TrendRecord) {
  if (!recordValue.totalBets) return null;
  return {
    roiScore: trendScaledScore(recordValue.roiPct, TREND_ROI_SCORE_POINTS),
    winScore: trendScaledScore(recordValue.winPct, TREND_WIN_SCORE_POINTS),
    roiPct: recordValue.roiPct,
    winPct: recordValue.winPct,
  };
}

function trendRecordTone(recordValue: TrendRecord): Tone {
  if (recordValue.wins > recordValue.losses) return "positive";
  if (recordValue.losses > recordValue.wins) return "negative";
  return "neutral";
}

function trendWindowMetrics(records: WindowRecords): TrendWindowMetrics {
  const active = trendWindowWeights()
    .map(({ key, weight }) => {
      const metrics = trendRecordScore(records[key]);
      return metrics && weight > 0 ? { ...metrics, weight } : null;
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  if (!active.length) return { score: 50, roiPct: 0, winPct: 0, hasData: false };
  const totalWeight = active.reduce((sum, item) => sum + item.weight, 0);
  const average = (field: "roiScore" | "winScore" | "roiPct" | "winPct") =>
    active.reduce((sum, item) => sum + item[field] * item.weight, 0) / totalWeight;

  return {
    score: clampScore(average("roiScore") * 0.6 + average("winScore") * 0.4),
    roiPct: average("roiPct"),
    winPct: average("winPct"),
    hasData: true,
  };
}

const TREND_BROAD_FALLBACK_SCORE_CAP = 69;
const MINIMUM_NET_ROI_ADVANTAGE = 10;

function hasRecent(records: WindowRecords) {
  return records.last30.totalBets > 0 || records.last7.totalBets > 0;
}

function signalBreakdown(
  source: TrendSignal,
  signalKey: string,
  history: HistoryRow[],
  play: WeeklyTrendPlay,
): TrendSignal {
  const sameSignal = history.filter((row) => row.signalKey === signalKey);
  const exact = windows(
    sameSignal.filter((row) => row.market === play.market && row.sideGroup === play.sideGroup),
    play.date,
  );
  const marketRecords = windows(sameSignal.filter((row) => row.market === play.market), play.date);
  const overall = windows(sameSignal, play.date);
  const displayRecords = hasRecent(exact) ? exact : hasRecent(marketRecords) ? marketRecords : overall;
  const weights = hasRecent(exact)
    ? { exact: 1, market: 0, overall: 0 }
    : hasRecent(marketRecords)
      ? { exact: 0, market: 1, overall: 0 }
      : hasRecent(overall)
        ? { exact: 0, market: 0, overall: 1 }
        : { exact: 0, market: 0, overall: 0 };
  const metrics = trendWindowMetrics(displayRecords);
  const exactSample = exact.allTime.totalBets;

  return {
    ...source,
    signalKey,
    tone: trendRecordTone(displayRecords.allTime),
    category: `${source.signal} • ${play.market} • ${play.sideGroup}`,
    recordScope: hasRecent(exact)
      ? `${play.market} • ${play.sideGroup}`
      : hasRecent(marketRecords)
        ? `${play.market} • all sides`
        : "All tracked markets",
    exactSample,
    score: Math.round(exactSample > 0 ? metrics.score : Math.min(metrics.score, TREND_BROAD_FALLBACK_SCORE_CAP)),
    weights,
    records: displayRecords,
  };
}

function rescoreSignals(play: WeeklyTrendPlay, history: HistoryRow[]) {
  const signals = (play.signals || []).map((signal) => {
    const key = signal.signalType === "Line Movement"
      ? movementSignalKey(signal.signal || signal.signalKey)
      : signal.signalKey || publicSplitSignalKey(signal.signal);
    return signalBreakdown(signal, key, history, play);
  });
  const metrics = signals
    .map((signal) => trendWindowMetrics(signal.records))
    .filter((item) => item.hasData);
  const baseScore = metrics.length
    ? metrics.reduce((sum, item) => sum + item.score, 0) / metrics.length
    : 50;
  return { ...play, signals, baseScore, score: baseScore };
}

function frozenTrendPlayMetrics(play: WeeklyTrendPlay): TrendWindowMetrics {
  const signals = (play.signals || [])
    .map((signal) => {
      const metrics = trendWindowMetrics(signal.records);
      if (!metrics.hasData) return metrics;
      return {
        ...metrics,
        score: signal.exactSample > 0
          ? metrics.score
          : Math.min(metrics.score, TREND_BROAD_FALLBACK_SCORE_CAP),
      };
    })
    .filter((metrics) => metrics.hasData);

  if (!signals.length) {
    return {
      score: clampScore(play.baseScore ?? play.score ?? 0),
      roiPct: 0,
      winPct: 0,
      hasData: false,
    };
  }

  return {
    score: signals.reduce((sum, metrics) => sum + metrics.score, 0) / signals.length,
    roiPct: signals.reduce((sum, metrics) => sum + metrics.roiPct, 0) / signals.length,
    winPct: signals.reduce((sum, metrics) => sum + metrics.winPct, 0) / signals.length,
    hasData: true,
  };
}

function trendTier(score: number, eligible = true): WeeklyTrendPlay["tier"] {
  if (!eligible || score < 60) return "Pass";
  if (score >= 85) return "Elite";
  if (score >= 69) return "Strong";
  return "Good";
}

function scoreHeadToHeadTrendPlays(plays: WeeklyTrendPlay[]) {
  const baseRows = plays.map((play) => ({ play, metrics: frozenTrendPlayMetrics(play) }));
  return baseRows.map(({ play, metrics }) => {
    const sameGameMarket = baseRows.filter((candidate) =>
      candidate.play.gameKey === play.gameKey && candidate.play.market === play.market,
    );
    const sideKey = play.market === "Total" ? textKey(play.side) : textKey(play.selection);
    const opponents = sameGameMarket
      .filter((candidate) => {
        const candidateSide = candidate.play.market === "Total"
          ? textKey(candidate.play.side)
          : textKey(candidate.play.selection);
        return candidateSide !== sideKey;
      })
      .sort((left, right) => {
        if (right.metrics.score !== left.metrics.score) return right.metrics.score - left.metrics.score;
        if (right.metrics.roiPct !== left.metrics.roiPct) return right.metrics.roiPct - left.metrics.roiPct;
        return right.metrics.winPct - left.metrics.winPct;
      });
    const opponent = opponents[0];

    if (!opponent) {
      return {
        ...play,
        baseScore: metrics.score,
        opponentScore: null,
        comparisonGap: 0,
        comparisonWinner: false,
        score: 0,
        tier: "Pass" as const,
      };
    }

    const rawGap = metrics.score - opponent.metrics.score;
    const comparisonGap = Math.abs(rawGap);
    const comparisonWinner = rawGap > 0.01;
    const candidateRoiPct = metrics.roiPct;
    const opponentRoiPct = opponent.metrics.roiPct;
    const netRoiAdvantage = candidateRoiPct - opponentRoiPct;
    const opponentLast7Green = opponent.play.signals.some(
      (signal) => trendRecordTone(signal.records.last7) === "positive",
    );
    const eligible = Boolean(
      comparisonWinner
      && metrics.hasData
      && opponent.metrics.hasData
      && candidateRoiPct > 0
      && netRoiAdvantage >= MINIMUM_NET_ROI_ADVANTAGE
      && !opponentLast7Green,
    );
    const comparisonBonus = Math.min(5, comparisonGap / 5);
    const winnerScore = clampScore(metrics.score + comparisonBonus);
    const loserScore = Math.min(59, clampScore(metrics.score - comparisonBonus));
    const finalScore = eligible ? winnerScore : loserScore;

    return {
      ...play,
      baseScore: metrics.score,
      opponentScore: opponent.metrics.score,
      comparisonGap,
      comparisonWinner,
      score: finalScore,
      tier: trendTier(finalScore, eligible),
    };
  });
}

/**
 * Re-score NCAAF market plays using the same trend record curves, recency weights,
 * broad-fallback behavior, and head-to-head eligibility used by MLB.
 * NFL is intentionally left untouched.
 */
export async function rescoreNcaafWeeklyMarket<T extends WeeklyMarketPayload>(
  sport: FootballSport,
  payload: T,
): Promise<T> {
  if (sport !== "NCAAF" || !Array.isArray(payload.trendPlays) || !payload.trendPlays.length) return payload;

  const allGameTrends = await readSportWorksheet(sport, "all_game_trends");
  const history = historyFromAllGameTrends(allGameTrends);
  const rescored = scoreHeadToHeadTrendPlays(
    payload.trendPlays.map((play) => rescoreSignals(play, history)),
  );

  return { ...payload, trendPlays: rescored } as T;
}
