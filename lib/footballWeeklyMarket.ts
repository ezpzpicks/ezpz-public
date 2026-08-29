import {
  type FootballSport,
  type SheetRow,
  ensureSportWorksheet,
  readSportWorksheet,
  upsertSportRows,
} from "./sportSheets";

export type WeeklyFootballMarket = "Spread" | "Total";
type Tone = "negative" | "caution" | "positive" | "neutral";
type ResultCode = "W" | "L" | "P";

const DK_URL = "https://dknetwork.draftkings.com/draftkings-sportsbook-betting-splits/";
const POSTED_GAMES_TAB = "posted_games";
const WEEKLY_TRENDS_TAB = "weekly_market_trends";

export const POSTED_GAME_HEADERS = [
  "Date", "Week", "Game Key", "Game Time", "Game", "Away Team", "Home Team",
  "First Seen", "Last Seen", "Source", "Source URL",
];

export const WEEKLY_TREND_HEADERS = [
  "Date", "Week", "Game Key", "Game Time", "Game", "Away Team", "Home Team",
  "Market", "Selection", "Side", "Line", "Odds", "Opening Line", "Opening Odds",
  "Opening Bets %", "Current Bets %", "Bets Change %", "Opening Handle %",
  "Current Handle %", "Handle Change %", "Public Gap %", "Warning",
  "Line Movement Signal", "Trend Score", "Trend Tier", "Updated At", "Snapshot Status",
  "Details JSON",
];

type Split = {
  date: string;
  eventTime: string;
  game: string;
  awayTeam: string;
  homeTeam: string;
  market: WeeklyFootballMarket;
  selection: string;
  selectionTeam: string;
  side: "Over" | "Under" | "";
  sideGroup: "Favorite" | "Underdog" | "Over" | "Under" | "";
  line: number | null;
  odds: string;
  moneyPct: number;
  betsPct: number;
  gapPct: number;
  warningKey: string;
  warning: string;
  warningTone: Tone;
  warningNegative: boolean;
};

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

type WindowRecords = { allTime: TrendRecord; last30: TrendRecord; last7: TrendRecord };

type Signal = {
  signalType: "Public Split" | "Line Movement";
  signalKey: string;
  signal: string;
  tone: Tone;
  category: string;
  recordScope: string;
  exactSample: number;
  score: number;
  weights: { exact: number; market: number; overall: number };
  records: WindowRecords;
};

export type WeeklyTrendPlay = {
  date: string;
  week: string;
  game: string;
  gameKey: string;
  gameTime: string;
  awayTeam: string;
  homeTeam: string;
  market: WeeklyFootballMarket;
  selection: string;
  selectionTeam: string;
  side: "Over" | "Under" | "";
  sideGroup: "Favorite" | "Underdog" | "Over" | "Under" | "";
  line: number | null;
  odds: string;
  betsPct: number;
  moneyPct: number;
  gapPct: number;
  openingBetsPct?: number;
  openingMoneyPct?: number;
  publicMovementPct?: number;
  sharpMovementPct?: number;
  openingLine?: number | null;
  openingOdds?: string;
  openingImpliedPct?: number | null;
  currentImpliedPct?: number | null;
  lineMovementBasis?: string;
  lineMovementValue?: number | null;
  lineMovementSignal?: string;
  score: number;
  baseScore?: number;
  opponentScore?: number | null;
  comparisonGap?: number;
  comparisonWinner?: boolean;
  tier: "Pass" | "Good" | "Strong" | "Elite";
  signals: Signal[];
  updatedAt: string;
  frozenAt?: string;
  lockWarning?: string;
  snapshotStatus: "LIVE" | "FINAL_PREGAME" | "MISSED_LOCK";
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

function textKey(value: unknown) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/−/g, "-").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function todayET(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function nowET() {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short",
  }).format(new Date());
}

function parseEventDate(value: unknown) {
  const match = String(value || "").match(/(\d{1,2})\/(\d{1,2})/);
  if (!match) return "";
  const today = new Date(`${todayET()}T12:00:00Z`);
  const month = Number(match[1]);
  const day = Number(match[2]);
  const years = [today.getUTCFullYear() - 1, today.getUTCFullYear(), today.getUTCFullYear() + 1];
  const year = years.sort((a, b) =>
    Math.abs(Date.UTC(a, month - 1, day) - today.getTime()) - Math.abs(Date.UTC(b, month - 1, day) - today.getTime()),
  )[0];
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseEventTime(value: unknown) {
  const raw = String(value || "").trim();
  const match = raw.match(/(?:^|[,\s])(\d{1,2})(?::(\d{2}))\s*(AM|PM)\b/i);
  if (!match) return "";
  return `${Number(match[1])}:${match[2]} ${match[3].toUpperCase()}`;
}

function numericLine(value: unknown) {
  const match = String(value || "").replace(/[−–—]/g, "-").match(/[+-]?\d+(?:\.\d+)?/);
  const n = match ? Number(match[0]) : NaN;
  return Number.isFinite(n) ? n : null;
}

function parseOdds(value: unknown) {
  const match = String(value || "").replace(/−/g, "-").match(/[+-]?\d{3,4}/);
  const n = match ? Number(match[0]) : 0;
  return Number.isFinite(n) ? n : 0;
}

function impliedPct(value: unknown) {
  const odds = parseOdds(value);
  if (!odds) return null;
  return Math.round((odds < 0 ? Math.abs(odds) / (Math.abs(odds) + 100) : 100 / (odds + 100)) * 1000) / 10;
}

function percent(value: unknown) {
  const n = Number(String(value || "").replace("%", ""));
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : NaN;
}

function isOdds(value: unknown) {
  return /^[+-]?\d{3,4}$/.test(String(value || "").replace(/−/g, "-").trim());
}

function isPercent(value: unknown) {
  return /^\d{1,3}(?:\.\d+)?%$/.test(String(value || "").trim());
}

function decodeHtml(value: string) {
  return value.replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
}

function tokens(raw: string) {
  return decodeHtml(String(raw || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, "\n"))
    .split(/\r?\n/).map((item) => item.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
}

function warningFor(betsPct: number, moneyPct: number) {
  const gapPct = Math.round((moneyPct - betsPct) * 10) / 10;
  if (betsPct >= 90 && moneyPct >= 90) return { warningKey: "EXTREME_PUBLIC_SHARP_AGREEMENT", warning: "Extreme Bets + Handle Agreement", warningTone: "negative" as Tone, warningNegative: true, gapPct };
  if (betsPct >= 80 && moneyPct >= 80) return { warningKey: "HEAVY_PUBLIC_SHARP_AGREEMENT", warning: "Heavy Bets + Handle Agreement", warningTone: "caution" as Tone, warningNegative: true, gapPct };
  if (gapPct <= -20) return { warningKey: "STRONG_SHARP_REJECTION", warning: "Strong Handle Below Bets", warningTone: "negative" as Tone, warningNegative: true, gapPct };
  if (gapPct <= -10) return { warningKey: "SHARP_REJECTION", warning: "Handle Below Bets", warningTone: "negative" as Tone, warningNegative: true, gapPct };
  if (gapPct >= 20) return { warningKey: "STRONG_SHARP_SUPPORT", warning: "Strong Handle Above Bets", warningTone: "positive" as Tone, warningNegative: false, gapPct };
  if (gapPct >= 10) return { warningKey: "SHARP_SUPPORT", warning: "Handle Above Bets", warningTone: "positive" as Tone, warningNegative: false, gapPct };
  return { warningKey: "BALANCED_PUBLIC_SHARP_SPLIT", warning: "Balanced Bets / Handle", warningTone: "neutral" as Tone, warningNegative: false, gapPct };
}

function parseBettingSplits(rawHtml: string): Split[] {
  const input = tokens(rawHtml);
  const rows: Split[] = [];
  const markets: Record<string, WeeklyFootballMarket | "Ignore"> = {
    Moneyline: "Ignore", "Run Line": "Spread", Spread: "Spread", Total: "Total",
  };
  let i = 0;
  while (i + 1 < input.length) {
    const gameToken = input[i] || "";
    const dateToken = input[i + 1] || "";
    if (!gameToken.includes(" @ ") || !/\d{1,2}\/\d{1,2}/.test(dateToken)) { i += 1; continue; }
    const [awayRaw = "", homeRaw = ""] = gameToken.split(" @ ", 2).map((part) => part.trim());
    const date = parseEventDate(dateToken);
    const eventTime = parseEventTime(dateToken);
    i += 2;
    while (i < input.length) {
      if (i + 1 < input.length && String(input[i]).includes(" @ ") && /\d{1,2}\/\d{1,2}/.test(input[i + 1] || "")) break;
      const mapped = markets[input[i] || ""];
      if (!mapped) { i += 1; continue; }
      let j = i + 1;
      while (["Odds", "% Handle", "% Bets"].includes(input[j] || "")) j += 1;
      let parsed = 0;
      while (j + 3 < input.length) {
        if (markets[input[j] || ""]) break;
        if (String(input[j] || "").includes(" @ ") && /\d{1,2}\/\d{1,2}/.test(input[j + 1] || "")) break;
        const [selection = "", rawOdds = "", rawMoney = "", rawBets = ""] = input.slice(j, j + 4);
        if (!(isOdds(rawOdds) && isPercent(rawMoney) && isPercent(rawBets))) break;
        if (mapped !== "Ignore") {
          const moneyPct = percent(rawMoney);
          const betsPct = percent(rawBets);
          const side = selection.toLowerCase().startsWith("over") ? "Over" : selection.toLowerCase().startsWith("under") ? "Under" : "";
          const selectionTeam = mapped === "Total" ? "" : selection.replace(/\s+[+-]?\d+(?:\.\d+)?$/, "").trim();
          const line = numericLine(selection);
          rows.push({
            date, eventTime, game: `${awayRaw} @ ${homeRaw}`, awayTeam: awayRaw, homeTeam: homeRaw,
            market: mapped, selection, selectionTeam, side,
            sideGroup: mapped === "Total" ? side : line != null && line < 0 ? "Favorite" : line != null && line > 0 ? "Underdog" : "",
            line, odds: rawOdds.replace(/−/g, "-"), moneyPct, betsPct, ...warningFor(betsPct, moneyPct),
          });
        }
        parsed += 1;
        j += 4;
        if (parsed >= 2) break;
      }
      i = Math.max(i + 1, j);
    }
  }
  const map = new Map<string, Split>();
  for (const row of rows) map.set(`${row.date}|${textKey(row.game)}|${row.market}|${textKey(row.selection)}`, row);
  return [...map.values()];
}

async function fetchHtml(params: Record<string, string>) {
  const target = new URL(DK_URL);
  Object.entries(params).forEach(([key, value]) => target.searchParams.set(key, value));
  const response = await fetch(target, {
    cache: "no-store",
    headers: { "User-Agent": "Mozilla/5.0 (compatible; EZPZ-Picks/1.0; +https://ezpzpicks.com)", Accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`DraftKings market discovery failed ${response.status}`);
  return response.text();
}

async function loadPostedSplits(sport: FootballSport) {
  const groups = sport === "NFL" ? ["NFL"] : ["College Football", "NCAAF", "CFB"];
  const map = new Map<string, Split>();
  const errors: string[] = [];
  for (const group of groups) {
    for (const horizon of ["n7days", ""]) {
      try {
        for (let page = 1; page <= 10; page += 1) {
          const parsed = parseBettingSplits(await fetchHtml({
            itm_content: group,
            tb_eg: group,
            tb_page: String(page),
            ...(horizon ? { tb_edate: horizon } : {}),
          }));
          if (!parsed.length) break;
          for (const split of parsed) {
            const key = `${split.date}|${textKey(split.game)}|${split.market}|${textKey(split.selection)}`;
            map.set(key, split);
          }
        }
      } catch (error) {
        errors.push(`${group}${horizon ? `/${horizon}` : ""}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return { splits: [...map.values()], errors };
}

function firstMondayOfSeptember(year: number) {
  const first = new Date(Date.UTC(year, 8, 1, 12));
  const offset = (8 - first.getUTCDay()) % 7;
  return new Date(first.getTime() + offset * 86_400_000);
}

function firstSaturdayOfSeptember(year: number) {
  const first = new Date(Date.UTC(year, 8, 1, 12));
  const offset = (6 - first.getUTCDay() + 7) % 7;
  return new Date(first.getTime() + offset * 86_400_000);
}

export function footballWeekLabel(sport: FootballSport, date: string) {
  const stamp = Date.parse(`${date}T12:00:00Z`);
  if (!Number.isFinite(stamp)) return "Upcoming";
  const year = new Date(stamp).getUTCFullYear();
  if (sport === "NFL") {
    const laborDay = firstMondayOfSeptember(year);
    const weekOneStart = laborDay.getTime() + 86_400_000; // Tuesday market-cycle start.
    const diff = Math.floor((stamp - weekOneStart) / (7 * 86_400_000));
    if (diff < 0) return "Preseason";
    if (diff <= 17) return `Week ${diff + 1}`;
    return "Postseason";
  }
  const firstSaturday = firstSaturdayOfSeptember(year);
  const weekOneStart = firstSaturday.getTime() - 6 * 86_400_000; // Sunday-Saturday college week.
  const diff = Math.floor((stamp - weekOneStart) / (7 * 86_400_000));
  return diff < 0 ? "Week 0" : `Week ${diff + 1}`;
}

function gameKey(split: Pick<Split, "date" | "awayTeam" | "homeTeam">) {
  return `${split.date}|${textKey(split.awayTeam)}|${textKey(split.homeTeam)}`;
}

function trendKey(row: SheetRow) {
  return `${String(row["Game Key"] || "")}|${textKey(row.Market)}|${textKey(row.Market === "Total" ? row.Side || row.Selection : row.Selection)}`;
}

function splitTrendKey(split: Split) {
  return `${gameKey(split)}|${textKey(split.market)}|${textKey(split.market === "Total" ? split.side : split.selectionTeam)}`;
}

function resultCode(value: unknown): ResultCode | "" {
  const key = String(value || "").trim().toUpperCase();
  if (["W", "WIN", "WON"].includes(key)) return "W";
  if (["L", "LOSS", "LOST"].includes(key)) return "L";
  if (["P", "PUSH", "VOID", "CANCELLED", "CANCELED"].includes(key)) return "P";
  // PENDING and every other unfinished status must never enter trend history.
  return "";
}

function profitUnits(odds: number) {
  return odds > 0 ? odds / 100 : odds < 0 ? 100 / Math.abs(odds) : 1;
}

function historyFromAllGameTrends(rows: SheetRow[]): HistoryRow[] {
  const output: HistoryRow[] = [];
  for (const row of rows) {
    const result = resultCode(row.Result);
    const raw = String(row["Trend Score Details"] || "").trim();
    if (!result || !raw) continue;
    try {
      const play = JSON.parse(raw) as WeeklyTrendPlay;
      const odds = parseOdds(row["Public Split Odds"] || row.Odds || play.odds);
      for (const signal of play.signals || []) {
        output.push({
          date: String(row.Date || play.date || ""),
          market: play.market,
          sideGroup: play.sideGroup,
          signalKey: signal.signalKey,
          result,
          odds,
          units: result === "P" ? 0 : result === "L" ? -1 : profitUnits(odds),
        });
      }
    } catch { /* legacy row */ }
  }
  return output;
}

function emptyRecord(): TrendRecord {
  return { record: "0-0-0", totalBets: 0, wins: 0, losses: 0, pushes: 0, winPct: 0, roiPct: 0, unitsWon: 0 };
}

function record(rows: HistoryRow[]) {
  if (!rows.length) return emptyRecord();
  let wins = 0, losses = 0, pushes = 0, unitsWon = 0;
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
    totalBets, wins, losses, pushes,
    winPct: decisions ? Math.round((wins / decisions) * 1000) / 10 : 0,
    roiPct: totalBets ? Math.round((unitsWon / totalBets) * 1000) / 10 : 0,
    unitsWon: Math.round(unitsWon * 100) / 100,
  };
}

function withinDays(rows: HistoryRow[], referenceDate: string, days: number) {
  const ref = Date.parse(`${referenceDate}T12:00:00Z`);
  return rows.filter((row) => {
    const at = Date.parse(`${row.date}T12:00:00Z`);
    const diff = Math.round((ref - at) / 86_400_000);
    return Number.isFinite(diff) && diff >= 0 && diff < days;
  });
}

function windows(rows: HistoryRow[], referenceDate: string): WindowRecords {
  return { allTime: record(rows), last30: record(withinDays(rows, referenceDate, 30)), last7: record(withinDays(rows, referenceDate, 7)) };
}

type ScorePoint = readonly [number, number];
const ROI_POINTS: ScorePoint[] = [[-100,0],[-50,8],[-30,20],[-20,28],[-10,38],[0,50],[10,62],[20,72],[25,80],[30,86],[40,92],[50,96],[100,100]];
const WIN_POINTS: ScorePoint[] = [[0,0],[25,9],[35,24],[40,33],[45,42],[50,50],[55,58],[60,67],[65,79],[70,89],[75,95],[85,100],[100,100]];

function scaled(value: number, points: ScorePoint[]) {
  if (value <= points[0][0]) return points[0][1];
  const last = points.at(-1)!;
  if (value >= last[0]) return last[1];
  for (let i = 1; i < points.length; i += 1) {
    if (value > points[i][0]) continue;
    const [loV, loS] = points[i - 1];
    const [hiV, hiS] = points[i];
    return loS + (hiS - loS) * ((value - loV) / (hiV - loV));
  }
  return last[1];
}

function scoreRecord(records: WindowRecords) {
  const candidates = [
    { record: records.allTime, weight: .25 },
    { record: records.last30, weight: .25 },
    { record: records.last7, weight: .5 },
  ].filter((item) => item.record.totalBets > 0);
  if (!candidates.length) return 50;
  const totalWeight = candidates.reduce((sum, item) => sum + item.weight, 0);
  const roi = candidates.reduce((sum, item) => sum + item.record.roiPct * item.weight, 0) / totalWeight;
  const win = candidates.reduce((sum, item) => sum + item.record.winPct * item.weight, 0) / totalWeight;
  return Math.max(0, Math.min(100, scaled(roi, ROI_POINTS) * .6 + scaled(win, WIN_POINTS) * .4));
}

function signalBreakdown(signalKey: string, signal: string, tone: Tone, market: WeeklyFootballMarket, sideGroup: WeeklyTrendPlay["sideGroup"], history: HistoryRow[], date: string): Signal {
  const same = history.filter((row) => row.signalKey === signalKey);
  const exact = windows(same.filter((row) => row.market === market && row.sideGroup === sideGroup), date);
  const marketRows = windows(same.filter((row) => row.market === market), date);
  const overall = windows(same, date);
  const display = exact.allTime.totalBets ? exact : marketRows.allTime.totalBets ? marketRows : overall;
  const exactSample = exact.allTime.totalBets;
  const rawScore = scoreRecord(display);
  return {
    signalType: "Public Split",
    signalKey, signal,
    tone: display.allTime.wins > display.allTime.losses ? "positive" : display.allTime.losses > display.allTime.wins ? "negative" : tone,
    category: `${signal} • ${market} • ${sideGroup}`,
    recordScope: exactSample ? `${market} • ${sideGroup}` : marketRows.allTime.totalBets ? `${market} • all sides` : "All tracked markets",
    exactSample,
    score: Math.round(exactSample ? rawScore : Math.min(rawScore, 69)),
    weights: exactSample ? { exact: 1, market: 0, overall: 0 } : marketRows.allTime.totalBets ? { exact: 0, market: 1, overall: 0 } : overall.allTime.totalBets ? { exact: 0, market: 0, overall: 1 } : { exact: 0, market: 0, overall: 0 },
    records: display,
  };
}

const MAX_MISSED_LOCK_FRESHNESS_MINUTES = 20;

function minutesUntilEvent(date: string, eventTime: string) {
  if (!date || !eventTime) return null;
  const match = eventTime.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return null;
  let hour = Number(match[1]) % 12;
  if (match[3].toUpperCase() === "PM") hour += 12;
  const [year, month, day] = date.split("-").map(Number);
  const kickoff = Date.UTC(year, month - 1, day, hour, Number(match[2]));
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  const nowStamp = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return (kickoff - nowStamp) / 60_000;
}

function minutesUntil(split: Split) {
  return minutesUntilEvent(split.date, split.eventTime);
}

function minutesUntilPlay(play: Pick<WeeklyTrendPlay, "date" | "gameTime">) {
  return minutesUntilEvent(play.date, play.gameTime);
}

function snapshotAgeMinutes(play: Pick<WeeklyTrendPlay, "updatedAt">) {
  const normalized = String(play.updatedAt || "")
    .replace(/ EDT$/, " -0400")
    .replace(/ EST$/, " -0500");
  const stamp = Date.parse(normalized);
  if (!Number.isFinite(stamp)) return null;
  return Math.max(0, (Date.now() - stamp) / 60_000);
}

function existingNumber(row: SheetRow | undefined, field: string, fallback: number) {
  if (!row || String(row[field] ?? "").trim() === "") return fallback;
  const n = Number(row[field]);
  return Number.isFinite(n) ? n : fallback;
}

function movement(split: Split, existing: SheetRow | undefined) {
  const openingLine = existing ? numericLine(existing["Opening Line"]) ?? split.line : split.line;
  const openingOdds = String(existing?.["Opening Odds"] || split.odds);
  const openingBetsPct = existingNumber(existing, "Opening Bets %", split.betsPct);
  const openingMoneyPct = existingNumber(existing, "Opening Handle %", split.moneyPct);
  const publicMovementPct = Math.round((split.betsPct - openingBetsPct) * 10) / 10;
  const sharpMovementPct = Math.round((split.moneyPct - openingMoneyPct) * 10) / 10;
  const openingImpliedPct = impliedPct(openingOdds);
  const currentImpliedPct = impliedPct(split.odds);
  let lineMovementBasis = "";
  let lineMovementValue: number | null = null;
  if (openingLine != null && split.line != null && Math.abs(split.line - openingLine) >= .5) {
    lineMovementBasis = split.market === "Total" ? "Total Line" : "Spread Line";
    lineMovementValue = Math.round((split.line - openingLine) * 10) / 10;
  } else if (openingImpliedPct != null && currentImpliedPct != null && Math.abs(currentImpliedPct - openingImpliedPct) >= 1.5) {
    lineMovementBasis = "Implied Probability";
    lineMovementValue = Math.round((currentImpliedPct - openingImpliedPct) * 10) / 10;
  }
  let lineMovementSignal = "";
  if (lineMovementValue != null) {
    const opposite = Math.abs(publicMovementPct) >= 5 && publicMovementPct * lineMovementValue < 0;
    if (opposite) lineMovementSignal = "Reverse Line Movement";
    else lineMovementSignal = lineMovementValue > 0 ? "Line Movement Confirmation" : "Adverse Line Movement";
  }
  return { openingLine, openingOdds, openingBetsPct, openingMoneyPct, publicMovementPct, sharpMovementPct, openingImpliedPct, currentImpliedPct, lineMovementBasis, lineMovementValue, lineMovementSignal };
}

function buildPlay(split: Split, existing: SheetRow | undefined, history: HistoryRow[]): WeeklyTrendPlay {
  const move = movement(split, existing);
  const primary = signalBreakdown(split.warningKey, split.warning, split.warningTone, split.market, split.sideGroup, history, split.date);
  const signals: Signal[] = [primary];
  if (move.lineMovementSignal) {
    const signalKey = textKey(move.lineMovementSignal).toUpperCase().replace(/\s+/g, "_");
    const lineSignal = signalBreakdown(signalKey, move.lineMovementSignal, move.lineMovementValue != null && move.lineMovementValue > 0 ? "positive" : "negative", split.market, split.sideGroup, history, split.date);
    signals.push({ ...lineSignal, signalType: "Line Movement" });
  }
  const withHistory = signals.filter((signal) => signal.records.allTime.totalBets > 0);
  const baseScore = Math.round(withHistory.length ? withHistory.reduce((sum, signal) => sum + signal.score, 0) / withHistory.length : 50);
  return {
    date: split.date,
    week: footballWeekLabel("NFL", split.date),
    game: split.game,
    gameKey: gameKey(split),
    gameTime: split.eventTime,
    awayTeam: split.awayTeam,
    homeTeam: split.homeTeam,
    market: split.market,
    selection: split.market === "Total" ? split.side : split.selectionTeam,
    selectionTeam: split.selectionTeam,
    side: split.side,
    sideGroup: split.sideGroup,
    line: split.line,
    odds: split.odds,
    betsPct: split.betsPct,
    moneyPct: split.moneyPct,
    gapPct: split.gapPct,
    openingBetsPct: move.openingBetsPct,
    openingMoneyPct: move.openingMoneyPct,
    publicMovementPct: move.publicMovementPct,
    sharpMovementPct: move.sharpMovementPct,
    openingLine: move.openingLine,
    openingOdds: move.openingOdds,
    openingImpliedPct: move.openingImpliedPct,
    currentImpliedPct: move.currentImpliedPct,
    lineMovementBasis: move.lineMovementBasis,
    lineMovementValue: move.lineMovementValue,
    lineMovementSignal: move.lineMovementSignal,
    score: baseScore,
    baseScore,
    tier: "Pass",
    signals,
    updatedAt: nowET(),
    snapshotStatus: "LIVE",
  };
}

function headToHead(plays: WeeklyTrendPlay[]) {
  return plays.map((play) => {
    const opponent = plays
      .filter((other) => other.gameKey === play.gameKey && other.market === play.market && textKey(other.selection) !== textKey(play.selection))
      .sort((a, b) => (b.baseScore || b.score) - (a.baseScore || a.score))[0];
    if (!opponent) return { ...play, score: 0, tier: "Pass" as const };
    const own = play.baseScore || play.score;
    const other = opponent.baseScore || opponent.score;
    const gap = own - other;
    const eligible = gap > .01 && play.signals.some((signal) => signal.records.allTime.totalBets > 0) && opponent.signals.some((signal) => signal.records.allTime.totalBets > 0);
    const bonus = Math.min(5, Math.abs(gap) / 5);
    const score = eligible ? Math.min(100, own + bonus) : Math.min(59, Math.max(0, own - bonus));
    return { ...play, opponentScore: other, comparisonGap: Math.abs(gap), comparisonWinner: gap > .01, score, tier: !eligible || score < 60 ? "Pass" as const : score >= 85 ? "Elite" as const : score >= 69 ? "Strong" as const : "Good" as const };
  });
}

function postedGameKey(row: SheetRow) {
  return String(row["Game Key"] || "");
}

function weeklyRow(play: WeeklyTrendPlay): SheetRow {
  return {
    Date: play.date,
    Week: play.week,
    "Game Key": play.gameKey,
    "Game Time": play.gameTime,
    Game: play.game,
    "Away Team": play.awayTeam,
    "Home Team": play.homeTeam,
    Market: play.market,
    Selection: play.selection,
    Side: play.side,
    Line: play.line == null ? "" : String(play.line),
    Odds: play.odds,
    "Opening Line": play.openingLine == null ? "" : String(play.openingLine),
    "Opening Odds": play.openingOdds || play.odds,
    "Opening Bets %": String(play.openingBetsPct ?? play.betsPct),
    "Current Bets %": String(play.betsPct),
    "Bets Change %": String(play.publicMovementPct ?? 0),
    "Opening Handle %": String(play.openingMoneyPct ?? play.moneyPct),
    "Current Handle %": String(play.moneyPct),
    "Handle Change %": String(play.sharpMovementPct ?? 0),
    "Public Gap %": String(play.gapPct),
    Warning: play.signals[0]?.signal || "",
    "Line Movement Signal": play.lineMovementSignal || "",
    "Trend Score": String(Math.round(play.score)),
    "Trend Tier": play.tier,
    "Updated At": play.updatedAt,
    "Snapshot Status": play.snapshotStatus,
    "Details JSON": JSON.stringify(play),
  };
}

export async function syncPostedFootballMarkets(sport: FootballSport) {
  await Promise.all([
    ensureSportWorksheet(sport, POSTED_GAMES_TAB, POSTED_GAME_HEADERS),
    ensureSportWorksheet(sport, WEEKLY_TRENDS_TAB, WEEKLY_TREND_HEADERS),
  ]);
  const [existingGames, existingTrends, allGameTrends, dk] = await Promise.all([
    readSportWorksheet(sport, POSTED_GAMES_TAB, POSTED_GAME_HEADERS),
    readSportWorksheet(sport, WEEKLY_TRENDS_TAB, WEEKLY_TREND_HEADERS),
    readSportWorksheet(sport, "all_game_trends"),
    loadPostedSplits(sport),
  ]);
  const now = nowET();
  const gameMap = new Map(existingGames.map((row) => [postedGameKey(row), row]));
  const postedRows: SheetRow[] = [];
  const uniqueGames = new Map<string, Split>();
  for (const split of dk.splits) if (!uniqueGames.has(gameKey(split))) uniqueGames.set(gameKey(split), split);
  for (const split of uniqueGames.values()) {
    const key = gameKey(split);
    const existing = gameMap.get(key);
    postedRows.push({
      Date: split.date,
      Week: footballWeekLabel(sport, split.date),
      "Game Key": key,
      "Game Time": split.eventTime,
      Game: split.game,
      "Away Team": split.awayTeam,
      "Home Team": split.homeTeam,
      "First Seen": String(existing?.["First Seen"] || now),
      "Last Seen": now,
      Source: "DraftKings",
      "Source URL": DK_URL,
    });
  }
  if (postedRows.length) await upsertSportRows(sport, POSTED_GAMES_TAB, POSTED_GAME_HEADERS, postedRows, postedGameKey);

  const existingTrendMap = new Map(existingTrends.map((row) => [trendKey(row), row]));
  const history = historyFromAllGameTrends(allGameTrends);
  const liveCandidates: WeeklyTrendPlay[] = [];
  const handledLockKeys = new Set<string>();
  for (const split of dk.splits) {
    const key = splitTrendKey(split);
    const existing = existingTrendMap.get(key);
    const minutes = minutesUntil(split);
    if (minutes != null && minutes <= 15) {
      handledLockKeys.add(key);
      if (existing && String(existing["Details JSON"] || "").trim()) {
        try {
          const saved = JSON.parse(String(existing["Details JSON"])) as WeeklyTrendPlay;
          if (saved.snapshotStatus !== "FINAL_PREGAME") {
            const ageMinutes = snapshotAgeMinutes(saved);
            const missedLock = ageMinutes == null || ageMinutes > MAX_MISSED_LOCK_FRESHNESS_MINUTES;
            liveCandidates.push({
              ...saved,
              week: footballWeekLabel(sport, saved.date),
              snapshotStatus: missedLock ? "MISSED_LOCK" as const : "FINAL_PREGAME" as const,
              frozenAt: missedLock ? undefined : saved.updatedAt,
              lockWarning: missedLock
                ? `Lock capture missed — last verified ${saved.updatedAt}.`
                : minutes < 0
                  ? "Finalized from the last verified pregame snapshot after DraftKings stopped updating."
                  : undefined,
            });
          }
        } catch { /* keep existing row unchanged */ }
      }
      continue;
    }
    liveCandidates.push({ ...buildPlay(split, existing, history), week: footballWeekLabel(sport, split.date) });
  }

  // DraftKings can remove or suspend a game before the T-15 capture. Walk
  // the stored rows as a second lock pass so the card never disappears.
  // A snapshot no more than 20 minutes old is safe to freeze as the last
  // verified pregame state; older data remains visible but is explicitly
  // marked MISSED_LOCK and is not treated as a verified final lock.
  for (const row of existingTrends) {
    const key = trendKey(row);
    if (handledLockKeys.has(key)) continue;
    const raw = String(row["Details JSON"] || "").trim();
    if (!raw) continue;
    try {
      const saved = JSON.parse(raw) as WeeklyTrendPlay;
      if (saved.snapshotStatus !== "LIVE") continue;
      const minutes = minutesUntilPlay(saved);
      if (minutes == null || minutes > 15) continue;
      const ageMinutes = snapshotAgeMinutes(saved);
      const missedLock = ageMinutes == null || ageMinutes > MAX_MISSED_LOCK_FRESHNESS_MINUTES;
      liveCandidates.push({
        ...saved,
        week: footballWeekLabel(sport, saved.date),
        snapshotStatus: missedLock ? "MISSED_LOCK" as const : "FINAL_PREGAME" as const,
        frozenAt: missedLock ? undefined : saved.updatedAt,
        lockWarning: missedLock
          ? `Lock capture missed — last verified ${saved.updatedAt}.`
          : "DraftKings was unavailable at lock; finalized from the last verified pregame snapshot.",
      });
    } catch { /* keep malformed legacy row unchanged */ }
  }
  const scored = headToHead(liveCandidates);
  const rows = scored.map(weeklyRow);
  if (rows.length) await upsertSportRows(sport, WEEKLY_TRENDS_TAB, WEEKLY_TREND_HEADERS, rows, trendKey);

  return {
    ok: true,
    sport,
    postedGamesFound: uniqueGames.size,
    marketSidesFound: dk.splits.length,
    trendRowsUpdated: rows.length,
    errors: dk.errors,
    updatedAt: now,
  };
}

export async function readWeeklyFootballMarket(sport: FootballSport) {
  await Promise.all([
    ensureSportWorksheet(sport, POSTED_GAMES_TAB, POSTED_GAME_HEADERS),
    ensureSportWorksheet(sport, WEEKLY_TRENDS_TAB, WEEKLY_TREND_HEADERS),
  ]);
  const [games, rows] = await Promise.all([
    readSportWorksheet(sport, POSTED_GAMES_TAB, POSTED_GAME_HEADERS),
    readSportWorksheet(sport, WEEKLY_TRENDS_TAB, WEEKLY_TREND_HEADERS),
  ]);
  const trendPlays: WeeklyTrendPlay[] = [];
  for (const row of rows) {
    const raw = String(row["Details JSON"] || "").trim();
    if (!raw) continue;
    try {
      const play = JSON.parse(raw) as WeeklyTrendPlay;
      trendPlays.push({ ...play, week: String(row.Week || play.week || footballWeekLabel(sport, play.date)) });
    } catch { /* ignore malformed display row */ }
  }
  const splits = trendPlays.map((play) => ({
    game: play.game,
    market: play.market,
    selection: play.selection,
    selectionTeam: play.selectionTeam,
    side: play.side,
    line: play.line,
    odds: play.odds,
    betsPct: play.betsPct,
    moneyPct: play.moneyPct,
    gapPct: play.gapPct,
    warning: play.signals[0]?.signal || "",
    lineMovementSignal: play.lineMovementSignal || "",
  }));
  return { ok: true, sport, games, trendPlays, splits, updatedAt: nowET() };
}
