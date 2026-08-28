import {
  type FootballSport,
  type SheetRow,
  ensureSportWorksheet,
  readSportWorksheet,
  sportDatabaseLabel,
  upsertSportRows,
} from "./sportSheets";

export type FootballMarket = "Spread" | "Total";
type Tone = "negative" | "caution" | "positive" | "neutral";
type ResultCode = "W" | "L" | "P";

const DK_BETTING_SPLITS_URL =
  "https://dknetwork.draftkings.com/draftkings-sportsbook-betting-splits/";

export const PUBLIC_SPLIT_HEADERS = [
  "Snapshot Time ET", "Opening Snapshot Time ET", "Date", "Game Time ET", "Game",
  "Away Team", "Home Team", "Data Type", "Market", "Selection", "Line", "Odds",
  "Opening Line", "Opening Odds", "Opening Implied %", "Current Implied %",
  "Opening Public %", "Current Public %", "Public Change %", "Opening Sharp %",
  "Current Sharp %", "Sharp Change %", "Public Bets %", "Public Money %",
  "Public Gap %", "Warning Key", "Warning", "Warning Tone", "Warning Negative",
  "Line Movement Signal", "Line Movement Tone", "Line Movement Basis",
  "Line Movement Value", "Popularity Rank", "Source", "Match Confidence", "Source URL",
];

export const ALL_GAME_TRENDS_HEADERS = [
  "Date", "Game Key", "Game", "Game Time", "Away Team", "Home Team",
  "Market", "Selection", "Side", "Line", "Odds", "Odds/Line",
  "Model Grade", "Qualified", "Model %", "Implied %", "Edge %",
  "Model Version", "Correlation Block", "Result", "Actual Away Runs", "Actual Home Runs",
  "Actual Total", "Result Updated", "Public Bets %", "Public Money %", "Public Gap %",
  "Public Warning", "Public Warning Negative", "Public Split Source", "Public Split Market",
  "Public Split Selection", "Public Split Line", "Public Split Odds",
  "Public Split Match Confidence", "Public Split Snapshot Time", "Opening Public %",
  "Current Public %", "Public Change %", "Opening Sharp %", "Current Sharp %",
  "Sharp Change %", "Opening Public Split Line", "Opening Public Split Odds",
  "Opening Public Split Snapshot Time", "Opening Implied %", "Current Implied %",
  "Line Movement Signal", "Line Movement Tone", "Line Movement Basis", "Line Movement Value",
  "Trend Play", "Trend Score", "Trend Tier", "Trend Signals", "Trend All Time Record",
  "Trend Last 30 Record", "Trend Last 7 Record", "Trend Exact Sample", "Trend Score Details",
];

type DraftKingsSplit = {
  date: string;
  eventTime: string;
  game: string;
  awayTeam: string;
  homeTeam: string;
  market: FootballMarket;
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
  openingLine?: number | null;
  openingOdds?: string;
  openingSnapshotTime?: string;
  openingBetsPct?: number;
  openingMoneyPct?: number;
  openingImpliedPct?: number | null;
  currentImpliedPct?: number | null;
  publicMovementPct?: number;
  sharpMovementPct?: number;
  lineMovementSignal?: string;
  lineMovementTone?: Tone | "";
  lineMovementBasis?: "Implied Probability" | "Spread Line" | "Total Line" | "";
  lineMovementValue?: number | null;
  snapshotTime?: string;
  retained?: boolean;
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

type TrendWindowRecords = { allTime: TrendRecord; last30: TrendRecord; last7: TrendRecord };

type TrendSignal = {
  signalType: "Public Split" | "Line Movement";
  signalKey: string;
  signal: string;
  tone: Tone;
  category: string;
  recordScope: string;
  exactSample: number;
  score: number;
  weights: { exact: number; market: number; overall: number };
  records: TrendWindowRecords;
};

type TrendPlay = {
  date: string;
  game: string;
  gameKey: string;
  gameTime: string;
  awayTeam: string;
  homeTeam: string;
  market: FootballMarket;
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
  score: number;
  baseScore?: number;
  opponentScore?: number | null;
  comparisonGap?: number;
  comparisonWinner?: boolean;
  tier: "Pass" | "Good" | "Strong" | "Elite";
  signals: TrendSignal[];
  updatedAt: string;
  frozenAt?: string;
  snapshotStatus?: "LIVE" | "FINAL_PREGAME";
  gradingVersion?: string;
};

type SignalHistoryRow = {
  date: string;
  market: FootballMarket;
  sideGroup: TrendPlay["sideGroup"];
  signalKey: string;
  result: ResultCode;
  odds: number;
  units: number;
};

const FROZEN_TREND_GRADING_VERSION = "football-frozen-h2h-v2-weekly-15m-lock";
const TREND_BROAD_FALLBACK_SCORE_CAP = 69;

const NFL_ALIASES: Record<string, string[]> = {
  ARI: ["Arizona Cardinals", "Cardinals", "Arizona"], ATL: ["Atlanta Falcons", "Falcons", "Atlanta"],
  BAL: ["Baltimore Ravens", "Ravens", "Baltimore"], BUF: ["Buffalo Bills", "Bills", "Buffalo"],
  CAR: ["Carolina Panthers", "Panthers", "Carolina"], CHI: ["Chicago Bears", "Bears", "Chicago"],
  CIN: ["Cincinnati Bengals", "Bengals", "Cincinnati"], CLE: ["Cleveland Browns", "Browns", "Cleveland"],
  DAL: ["Dallas Cowboys", "Cowboys", "Dallas"], DEN: ["Denver Broncos", "Broncos", "Denver"],
  DET: ["Detroit Lions", "Lions", "Detroit"], GB: ["Green Bay Packers", "Packers", "Green Bay"],
  HOU: ["Houston Texans", "Texans", "Houston"], IND: ["Indianapolis Colts", "Colts", "Indianapolis"],
  JAX: ["Jacksonville Jaguars", "Jaguars", "Jacksonville"], KC: ["Kansas City Chiefs", "Chiefs", "Kansas City"],
  LV: ["Las Vegas Raiders", "Raiders", "Las Vegas"], LAC: ["Los Angeles Chargers", "LA Chargers", "Chargers"],
  LAR: ["Los Angeles Rams", "LA Rams", "Rams"], MIA: ["Miami Dolphins", "Dolphins", "Miami"],
  MIN: ["Minnesota Vikings", "Vikings", "Minnesota"], NE: ["New England Patriots", "Patriots", "New England"],
  NO: ["New Orleans Saints", "Saints", "New Orleans"], NYG: ["New York Giants", "NY Giants", "Giants"],
  NYJ: ["New York Jets", "NY Jets", "Jets"], PHI: ["Philadelphia Eagles", "Eagles", "Philadelphia"],
  PIT: ["Pittsburgh Steelers", "Steelers", "Pittsburgh"], SEA: ["Seattle Seahawks", "Seahawks", "Seattle"],
  SF: ["San Francisco 49ers", "49ers", "San Francisco"], TB: ["Tampa Bay Buccaneers", "Buccaneers", "Tampa Bay"],
  TEN: ["Tennessee Titans", "Titans", "Tennessee"], WAS: ["Washington Commanders", "Commanders", "Washington"],
};

function textKey(value: unknown) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/−/g, "-").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeTeam(value: unknown, sport: FootballSport) {
  const raw = String(value || "").trim();
  const key = textKey(raw);
  if (!key) return "";
  if (sport === "NFL") {
    for (const [abbr, aliases] of Object.entries(NFL_ALIASES)) {
      if (textKey(abbr) === key || aliases.some((alias) => {
        const a = textKey(alias);
        return a === key || a.endsWith(key) || key.endsWith(a);
      })) return abbr;
    }
  }
  return key
    .replace(/\buniversity\b/g, "")
    .replace(/\bthe\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sameTeam(a: unknown, b: unknown, sport: FootballSport) {
  const left = normalizeTeam(a, sport);
  const right = normalizeTeam(b, sport);
  if (!left || !right) return false;
  if (left === right) return true;
  if (sport === "NFL") return false;
  const l = new Set(left.split(" ").filter((token) => token.length > 2));
  const r = new Set(right.split(" ").filter((token) => token.length > 2));
  const overlap = [...l].filter((token) => r.has(token)).length;
  return overlap >= Math.min(2, Math.max(1, Math.min(l.size, r.size)));
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

function isoDate(value: unknown) {
  const raw = String(value || "").trim();
  const match = raw.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  const us = raw.match(/(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?/);
  if (us) return `${us[3] || todayET().slice(0, 4)}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  return "";
}

function footballWeekBounds(sport: FootballSport, referenceDate = todayET()) {
  const reference = Date.parse(`${referenceDate}T12:00:00Z`);
  const day = new Date(reference).getUTCDay();
  // NFL market weeks run Tuesday-Monday; college football uses Sunday-Saturday.
  // This keeps Thursday/Sunday/Monday NFL games and midweek/Saturday CFB games
  // attached to one market cycle while still allowing the public UI to stay daily.
  const weekStartDay = sport === "NFL" ? 2 : 0;
  const offset = (day - weekStartDay + 7) % 7;
  const startStamp = reference - offset * 86_400_000;
  const endStamp = startStamp + 6 * 86_400_000;
  return {
    start: new Date(startStamp).toISOString().slice(0, 10),
    end: new Date(endStamp).toISOString().slice(0, 10),
  };
}

function inFootballTrackingWeek(row: SheetRow, sport: FootballSport, referenceDate = todayET()) {
  const date = isoDate(row.Date || row["Game Date"] || "");
  if (!date) return true;
  const { start, end } = footballWeekBounds(sport, referenceDate);
  return date >= start && date <= end;
}

function nowEtMinuteStamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
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

function parseEventTimeKey(value: unknown) {
  const raw = String(value || "").trim();
  const meridiem = raw.match(/(?:^|[,\s])(\d{1,2})(?::(\d{2}))\s*(AM|PM)\b/i);
  if (meridiem) {
    let hour = Number(meridiem[1]) % 12;
    if (meridiem[3].toUpperCase() === "PM") hour += 12;
    return `${String(hour).padStart(2, "0")}:${meridiem[2]}`;
  }
  const twentyFour = raw.match(/(?:^|[,T\s])([01]?\d|2[0-3]):([0-5]\d)/);
  return twentyFour ? `${String(Number(twentyFour[1])).padStart(2, "0")}:${twentyFour[2]}` : "";
}

function gameTime(row: SheetRow) {
  return String(row["Game Time"] || row["Game Date"] || row.Time || "").trim();
}

function minutesUntilKickoff(row: SheetRow, now = new Date()) {
  const date = isoDate(row.Date || row["Game Date"] || "");
  const time = parseEventTimeKey(gameTime(row));
  if (!date || !time) return null;
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;
  const kickoffStamp = Date.UTC(year, month - 1, day, hour, minute);
  return (kickoffStamp - nowEtMinuteStamp(now)) / 60_000;
}

function minutesUntilDraftKingsKickoff(split: DraftKingsSplit, now = new Date()) {
  const date = isoDate(split.date);
  const time = parseEventTimeKey(split.eventTime);
  if (!date || !time) return null;
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;
  const kickoffStamp = Date.UTC(year, month - 1, day, hour, minute);
  return (kickoffStamp - nowEtMinuteStamp(now)) / 60_000;
}

function numericLine(value: unknown) {
  const match = String(value || "").replace(/[−–—]/g, "-").match(/[+-]?\d+(?:\.\d+)?/);
  const number = match ? Number(match[0]) : NaN;
  return Number.isFinite(number) ? number : null;
}

function parseOdds(value: unknown) {
  const match = String(value || "").replace(/−/g, "-").match(/[+-]?\d{3,4}/);
  const odds = match ? Number(match[0]) : 0;
  return Number.isFinite(odds) ? odds : 0;
}

function impliedPct(value: unknown) {
  const odds = parseOdds(value);
  if (!odds) return null;
  return Math.round((odds < 0 ? Math.abs(odds) / (Math.abs(odds) + 100) : 100 / (odds + 100)) * 1000) / 10;
}

function profitUnits(odds: number) {
  return odds > 0 ? odds / 100 : odds < 0 ? 100 / Math.abs(odds) : 1;
}

function truthy(value: unknown) {
  return ["TRUE", "YES", "Y", "1", "COMPLETED", "FINAL"].includes(String(value || "").trim().toUpperCase());
}

function resultCode(value: unknown): ResultCode | "" {
  const key = String(value || "").trim().toUpperCase();
  if (key.startsWith("W")) return "W";
  if (key.startsWith("L")) return "L";
  if (key.startsWith("P")) return "P";
  return "";
}

function decodeHtmlEntities(value: string) {
  return value.replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
}

function htmlTokens(rawHtml: string) {
  const cleaned = String(rawHtml || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, "\n");
  return decodeHtmlEntities(cleaned).split(/\r?\n/)
    .map((item) => item.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
}

function isOdds(value: unknown) {
  return /^[+-]?\d{3,4}$/.test(String(value || "").replace(/−/g, "-").trim());
}
function isPercent(value: unknown) {
  return /^\d{1,3}(?:\.\d+)?%$/.test(String(value || "").trim());
}
function percent(value: unknown) {
  const number = Number(String(value || "").replace("%", ""));
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : NaN;
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

function parseBettingSplits(rawHtml: string): DraftKingsSplit[] {
  const tokens = htmlTokens(rawHtml);
  const rows: DraftKingsSplit[] = [];
  const marketNames: Record<string, FootballMarket | "Ignore"> = {
    Moneyline: "Ignore", "Run Line": "Spread", Spread: "Spread", Total: "Total",
  };
  let i = 0;
  while (i + 1 < tokens.length) {
    const gameToken = tokens[i] || "";
    const dateToken = tokens[i + 1] || "";
    if (!gameToken.includes(" @ ") || !/\d{1,2}\/\d{1,2}/.test(dateToken)) { i += 1; continue; }
    const [awayRaw = "", homeRaw = ""] = gameToken.split(" @ ", 2).map((part) => part.trim());
    const date = parseEventDate(dateToken);
    const eventTime = parseEventTimeKey(dateToken);
    i += 2;
    while (i < tokens.length) {
      if (i + 1 < tokens.length && String(tokens[i]).includes(" @ ") && /\d{1,2}\/\d{1,2}/.test(tokens[i + 1] || "")) break;
      const rawMarket = tokens[i] || "";
      const mapped = marketNames[rawMarket];
      if (!mapped) { i += 1; continue; }
      let j = i + 1;
      while (["Odds", "% Handle", "% Bets"].includes(tokens[j] || "")) j += 1;
      let parsedRows = 0;
      while (j + 3 < tokens.length) {
        if (marketNames[tokens[j] || ""]) break;
        if (String(tokens[j] || "").includes(" @ ") && /\d{1,2}\/\d{1,2}/.test(tokens[j + 1] || "")) break;
        const [selection = "", rawOdds = "", rawMoney = "", rawBets = ""] = tokens.slice(j, j + 4);
        if (!(isOdds(rawOdds) && isPercent(rawMoney) && isPercent(rawBets))) break;
        if (mapped !== "Ignore") {
          const moneyPct = percent(rawMoney); const betsPct = percent(rawBets);
          const side = selection.toLowerCase().startsWith("over") ? "Over" : selection.toLowerCase().startsWith("under") ? "Under" : "";
          const selectionTeam = mapped === "Total" ? "" : selection.replace(/\s+[+-]?\d+(?:\.\d+)?$/, "").trim();
          const line = numericLine(selection);
          const warning = warningFor(betsPct, moneyPct);
          rows.push({
            date, eventTime, game: `${awayRaw} at ${homeRaw}`, awayTeam: awayRaw, homeTeam: homeRaw,
            market: mapped, selection, selectionTeam, side,
            sideGroup: mapped === "Total" ? side : line != null && line < 0 ? "Favorite" : line != null && line > 0 ? "Underdog" : "",
            line, odds: rawOdds.replace(/−/g, "-"), moneyPct, betsPct, ...warning,
          });
        }
        parsedRows += 1; j += 4; if (parsedRows >= 2) break;
      }
      i = Math.max(i + 1, j);
    }
  }
  const map = new Map<string, DraftKingsSplit>();
  for (const row of rows) map.set(`${row.date}|${textKey(row.game)}|${row.market}|${textKey(row.selection)}`, row);
  return [...map.values()];
}

async function fetchHtml(url: string, params: Record<string, string>) {
  const target = new URL(url);
  Object.entries(params).forEach(([key, value]) => target.searchParams.set(key, value));
  const response = await fetch(target, {
    cache: "no-store",
    headers: { "User-Agent": "Mozilla/5.0 (compatible; EZPZ-Picks/1.0; +https://ezpzpicks.com)", Accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`DraftKings splits request failed ${response.status}`);
  return response.text();
}

function splitMatchesSlate(split: DraftKingsSplit, slate: SheetRow[], sport: FootballSport) {
  return slate.some((row) => {
    const rowDate = isoDate(row.Date || row["Game Date"] || "");
    return (!rowDate || !split.date || rowDate === split.date) &&
      sameTeam(row["Away Team"], split.awayTeam, sport) && sameTeam(row["Home Team"], split.homeTeam, sport);
  });
}

async function loadDraftKingsSplits(sport: FootballSport, slate: SheetRow[]) {
  const queries = sport === "NFL" ? ["NFL"] : ["College Football", "NCAAF", "CFB"];
  const map = new Map<string, DraftKingsSplit>();
  const errors: string[] = [];
  for (const group of queries) {
    try {
      for (let page = 1; page <= 8; page += 1) {
        const parsed = parseBettingSplits(await fetchHtml(DK_BETTING_SPLITS_URL, {
          itm_content: group, tb_edate: "n7days", tb_eg: group, tb_page: String(page),
        }));
        let added = 0;
        for (const split of parsed.filter((item) => splitMatchesSlate(item, slate, sport))) {
          const key = `${split.date}|${textKey(split.game)}|${split.market}|${textKey(split.selection)}`;
          if (!map.has(key)) { map.set(key, split); added += 1; }
        }
        if (!parsed.length || added === 0) break;
      }
      if (map.size) break;
    } catch (error) { errors.push(`${group}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  if (!map.size) {
    try {
      const parsed = parseBettingSplits(await fetchHtml(DK_BETTING_SPLITS_URL, {}));
      for (const split of parsed.filter((item) => splitMatchesSlate(item, slate, sport))) {
        map.set(`${split.date}|${textKey(split.game)}|${split.market}|${textKey(split.selection)}`, split);
      }
    } catch (error) { errors.push(`fallback: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return { splits: [...map.values()], errors };
}

function snapshotKey(row: SheetRow) {
  const market = String(row.Market || "");
  const selection = market === "Total" ? String(row.Selection || row.Side || "") : String(row.Selection || "");
  return `${isoDate(row.Date)}|${textKey(row["Away Team"])}|${textKey(row["Home Team"])}|${textKey(market)}|${textKey(selection)}`;
}

function splitSnapshotKey(split: DraftKingsSplit) {
  return `${split.date}|${textKey(split.awayTeam)}|${textKey(split.homeTeam)}|${textKey(split.market)}|${textKey(split.market === "Total" ? split.side : split.selectionTeam)}`;
}

function movementForSplit(current: DraftKingsSplit, opening: SheetRow | undefined) {
  const openingLine = numericLine(opening?.["Opening Line"] || opening?.Line || current.line);
  const openingOdds = String(opening?.["Opening Odds"] || opening?.Odds || current.odds);
  const openingSnapshotTime = String(opening?.["Opening Snapshot Time ET"] || opening?.["Snapshot Time ET"] || current.snapshotTime || nowET());
  const openingPublic = Number(opening?.["Opening Public %"] || opening?.["Public Bets %"] || current.betsPct);
  const openingMoney = Number(opening?.["Opening Sharp %"] || opening?.["Public Money %"] || current.moneyPct);
  const openingImplied = impliedPct(openingOdds);
  const currentImplied = impliedPct(current.odds);
  const publicMovementPct = Math.round((current.betsPct - openingPublic) * 10) / 10;
  const sharpMovementPct = Math.round((current.moneyPct - openingMoney) * 10) / 10;
  let basis: DraftKingsSplit["lineMovementBasis"] = "";
  let value: number | null = null;
  let standard = 1.5; let strong = 3;
  if (openingLine != null && current.line != null) {
    if (current.market === "Total" && current.side) {
      const move = current.side === "Over" ? current.line - openingLine : openingLine - current.line;
      if (Math.abs(move) >= 0.5) { basis = "Total Line"; value = Math.round(move * 10) / 10; standard = 0.5; strong = 1; }
    } else if (current.market === "Spread") {
      const move = openingLine - current.line;
      if (Math.abs(move) >= 0.5) { basis = "Spread Line"; value = Math.round(move * 10) / 10; standard = 0.5; strong = 1; }
    }
  }
  if (value == null && openingImplied != null && currentImplied != null) {
    const move = Math.round((currentImplied - openingImplied) * 10) / 10;
    if (Math.abs(move) >= 1.5) { basis = "Implied Probability"; value = move; }
  }
  let lineMovementSignal = ""; let lineMovementTone: Tone | "" = "";
  if (value != null) {
    const opposite = Math.abs(publicMovementPct) >= 5 && publicMovementPct * value < 0;
    if (opposite && Math.abs(value) >= standard) {
      const isStrong = Math.abs(publicMovementPct) >= 10 && Math.abs(value) >= strong;
      lineMovementSignal = value > 0
        ? isStrong ? "Strong Reverse Line Movement Support" : "Reverse Line Movement Support"
        : isStrong ? "Strong Reverse Line Movement Against" : "Reverse Line Movement Against";
      lineMovementTone = value > 0 ? "positive" : "negative";
    } else if (value > 0) { lineMovementSignal = "Line Movement Confirmation"; lineMovementTone = "positive"; }
    else { lineMovementSignal = "Adverse Line Movement"; lineMovementTone = "negative"; }
  }
  return {
    ...current, openingLine, openingOdds, openingSnapshotTime, openingBetsPct: openingPublic, openingMoneyPct: openingMoney,
    openingImpliedPct: openingImplied, currentImpliedPct: currentImplied, publicMovementPct,
    sharpMovementPct, lineMovementBasis: basis, lineMovementValue: value,
    lineMovementSignal, lineMovementTone,
  };
}

function snapshotRow(split: DraftKingsSplit): SheetRow {
  return {
    "Snapshot Time ET": split.snapshotTime || nowET(),
    "Opening Snapshot Time ET": split.openingSnapshotTime || split.snapshotTime || nowET(), Date: split.date,
    "Game Time ET": split.eventTime, Game: split.game, "Away Team": split.awayTeam, "Home Team": split.homeTeam,
    "Data Type": "Game Market", Market: split.market, Selection: split.market === "Total" ? split.side : split.selectionTeam,
    Line: split.line == null ? "" : String(split.line), Odds: split.odds,
    "Opening Line": split.openingLine == null ? "" : String(split.openingLine), "Opening Odds": split.openingOdds || split.odds,
    "Opening Implied %": split.openingImpliedPct == null ? "" : String(split.openingImpliedPct),
    "Current Implied %": split.currentImpliedPct == null ? "" : String(split.currentImpliedPct),
    "Opening Public %": String(split.openingBetsPct ?? split.betsPct), "Current Public %": String(split.betsPct),
    "Public Change %": String(split.publicMovementPct ?? 0), "Opening Sharp %": String(split.openingMoneyPct ?? split.moneyPct),
    "Current Sharp %": String(split.moneyPct), "Sharp Change %": String(split.sharpMovementPct ?? 0),
    "Public Bets %": String(split.betsPct), "Public Money %": String(split.moneyPct), "Public Gap %": String(split.gapPct),
    "Warning Key": split.warningKey, Warning: split.warning, "Warning Tone": split.warningTone,
    "Warning Negative": split.warningNegative ? "TRUE" : "FALSE", "Line Movement Signal": split.lineMovementSignal || "",
    "Line Movement Tone": split.lineMovementTone || "", "Line Movement Basis": split.lineMovementBasis || "",
    "Line Movement Value": split.lineMovementValue == null ? "" : String(split.lineMovementValue),
    "Popularity Rank": "", Source: "DraftKings", "Match Confidence": "Weekly football market tracking", "Source URL": DK_BETTING_SPLITS_URL,
  };
}

function finiteSnapshotNumber(value: unknown) {
  if (value == null || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function splitFromPersistedSnapshot(split: DraftKingsSplit, snapshot: SheetRow | undefined): DraftKingsSplit | null {
  if (!snapshot) return null;
  const betsPct = finiteSnapshotNumber(snapshot["Public Bets %"] ?? snapshot["Current Public %"]) ?? split.betsPct;
  const moneyPct = finiteSnapshotNumber(snapshot["Public Money %"] ?? snapshot["Current Sharp %"]) ?? split.moneyPct;
  const warning = warningFor(betsPct, moneyPct);
  const odds = String(snapshot.Odds || split.odds);
  const movementTone = String(snapshot["Line Movement Tone"] || "");
  const movementBasis = String(snapshot["Line Movement Basis"] || "");
  return {
    ...split,
    line: numericLine(snapshot.Line) ?? split.line,
    odds,
    betsPct,
    moneyPct,
    gapPct: finiteSnapshotNumber(snapshot["Public Gap %"]) ?? Math.round((moneyPct - betsPct) * 10) / 10,
    ...warning,
    openingLine: numericLine(snapshot["Opening Line"]) ?? split.openingLine,
    openingOdds: String(snapshot["Opening Odds"] || split.openingOdds || odds),
    openingSnapshotTime: String(snapshot["Opening Snapshot Time ET"] || split.openingSnapshotTime || snapshot["Snapshot Time ET"] || ""),
    openingBetsPct: finiteSnapshotNumber(snapshot["Opening Public %"]) ?? split.openingBetsPct ?? betsPct,
    openingMoneyPct: finiteSnapshotNumber(snapshot["Opening Sharp %"]) ?? split.openingMoneyPct ?? moneyPct,
    openingImpliedPct: finiteSnapshotNumber(snapshot["Opening Implied %"]) ?? split.openingImpliedPct ?? impliedPct(snapshot["Opening Odds"] || odds),
    currentImpliedPct: finiteSnapshotNumber(snapshot["Current Implied %"]) ?? impliedPct(odds),
    publicMovementPct: finiteSnapshotNumber(snapshot["Public Change %"]) ?? split.publicMovementPct ?? 0,
    sharpMovementPct: finiteSnapshotNumber(snapshot["Sharp Change %"]) ?? split.sharpMovementPct ?? 0,
    lineMovementSignal: String(snapshot["Line Movement Signal"] || ""),
    lineMovementTone: (["negative", "caution", "positive", "neutral"].includes(movementTone) ? movementTone : "") as Tone | "",
    lineMovementBasis: (["Implied Probability", "Spread Line", "Total Line"].includes(movementBasis) ? movementBasis : "") as DraftKingsSplit["lineMovementBasis"],
    lineMovementValue: finiteSnapshotNumber(snapshot["Line Movement Value"]),
    snapshotTime: String(snapshot["Snapshot Time ET"] || split.snapshotTime || ""),
  };
}

function emptyRecord(): TrendRecord { return { record: "0-0-0", totalBets: 0, wins: 0, losses: 0, pushes: 0, winPct: 0, roiPct: 0, unitsWon: 0 }; }
function trendRecord(rows: SignalHistoryRow[]) {
  if (!rows.length) return emptyRecord();
  let wins = 0, losses = 0, pushes = 0, unitsWon = 0;
  for (const row of rows) { if (row.result === "W") wins++; else if (row.result === "L") losses++; else pushes++; unitsWon += row.units; }
  const totalBets = wins + losses + pushes; const decisions = wins + losses;
  return { record: `${wins}-${losses}-${pushes}`, totalBets, wins, losses, pushes,
    winPct: decisions ? Math.round((wins / decisions) * 1000) / 10 : 0,
    roiPct: totalBets ? Math.round((unitsWon / totalBets) * 1000) / 10 : 0,
    unitsWon: Math.round(unitsWon * 100) / 100 };
}
function withinDays(rows: SignalHistoryRow[], referenceDate: string, days: number) {
  const ref = Date.parse(`${referenceDate}T12:00:00Z`);
  return rows.filter((row) => { const at = Date.parse(`${row.date}T12:00:00Z`); const diff = Math.round((ref - at) / 86400000); return Number.isFinite(diff) && diff >= 0 && diff < days; });
}
function windows(rows: SignalHistoryRow[], referenceDate: string): TrendWindowRecords {
  return { allTime: trendRecord(rows), last30: trendRecord(withinDays(rows, referenceDate, 30)), last7: trendRecord(withinDays(rows, referenceDate, 7)) };
}

type ScorePoint = readonly [number, number];
const ROI_POINTS: ScorePoint[] = [[-100,0],[-75,3],[-50,8],[-40,13],[-30,20],[-20,28],[-10,38],[-5,44],[0,50],[5,56],[10,62],[20,72],[25,80],[30,86],[40,92],[50,96],[75,99],[100,100]];
const WIN_POINTS: ScorePoint[] = [[0,0],[15,0],[20,4],[25,9],[30,16],[35,24],[40,33],[45,42],[50,50],[55,58],[60,67],[65,79],[70,89],[75,95],[80,98],[85,100],[100,100]];
function scaled(value: number, points: ScorePoint[]) {
  if (value <= points[0][0]) return points[0][1]; const last = points.at(-1)!; if (value >= last[0]) return last[1];
  for (let i = 1; i < points.length; i++) { if (value > points[i][0]) continue; const [loV, loS] = points[i-1]; const [hiV, hiS] = points[i]; return loS + (hiS-loS) * ((value-loV)/(hiV-loV)); }
  return last[1];
}
function windowWeights(records: TrendWindowRecords) {
  const last7Decisions = records.last7.wins + records.last7.losses; const last7 = Math.min(0.5, Math.max(0, last7Decisions) * 0.1); const carry = (0.5-last7)/2;
  return [{ key: "allTime" as const, weight: .25+carry }, { key: "last30" as const, weight: .25+carry }, { key: "last7" as const, weight: last7 }];
}
function windowMetrics(records: TrendWindowRecords) {
  const usable = windowWeights(records).map(({key,weight}) => records[key].totalBets ? { record: records[key], weight } : null).filter(Boolean) as {record:TrendRecord;weight:number}[];
  if (!usable.length) return { score:50, hasData:false, roiPct:0, winPct:0 };
  const tw = usable.reduce((s,r)=>s+r.weight,0); const avg=(f:"roiPct"|"winPct")=>usable.reduce((s,r)=>s+r.record[f]*r.weight,0)/tw;
  const roiPct=avg("roiPct"), winPct=avg("winPct"); return { score: Math.max(0, Math.min(100, scaled(roiPct,ROI_POINTS)*.6 + scaled(winPct,WIN_POINTS)*.4)), hasData:true, roiPct, winPct };
}

function historyFromTrendRows(rows: SheetRow[]): SignalHistoryRow[] {
  const output: SignalHistoryRow[] = [];
  for (const row of rows) {
    const result = resultCode(row.Result); if (!result) continue;
    const raw = String(row["Trend Score Details"] || "").trim(); if (!raw) continue;
    try {
      const play = JSON.parse(raw) as TrendPlay; const odds = parseOdds(row["Public Split Odds"] || row.Odds || play.odds);
      for (const signal of play.signals || []) output.push({ date: isoDate(row.Date) || play.date, market: play.market, sideGroup: play.sideGroup, signalKey: signal.signalKey, result, odds, units: result === "P" ? 0 : result === "L" ? -1 : profitUnits(odds) });
    } catch { /* legacy/no frozen signal JSON */ }
  }
  return output;
}

function signalBreakdown(signal: {signalType:"Public Split"|"Line Movement";signalKey:string;signal:string;tone:Tone}, market: FootballMarket, sideGroup: TrendPlay["sideGroup"], history: SignalHistoryRow[], referenceDate:string): TrendSignal {
  const same = history.filter((row)=>row.signalKey===signal.signalKey); const exact=windows(same.filter((row)=>row.market===market&&row.sideGroup===sideGroup),referenceDate); const marketRows=windows(same.filter((row)=>row.market===market),referenceDate); const overall=windows(same,referenceDate);
  const display=exact.allTime.totalBets?exact:marketRows.allTime.totalBets?marketRows:overall; const metrics=windowMetrics(display); const exactSample=exact.allTime.totalBets;
  return { ...signal, tone: display.allTime.wins>display.allTime.losses?"positive":display.allTime.losses>display.allTime.wins?"negative":"neutral",
    category:`${signal.signal} • ${market} • ${sideGroup}`, recordScope: exactSample?`${market} • ${sideGroup}`:marketRows.allTime.totalBets?`${market} • all sides`:"All tracked markets", exactSample,
    score:Math.round(exactSample?metrics.score:Math.min(metrics.score,TREND_BROAD_FALLBACK_SCORE_CAP)), weights:exactSample?{exact:1,market:0,overall:0}:marketRows.allTime.totalBets?{exact:0,market:1,overall:0}:overall.allTime.totalBets?{exact:0,market:0,overall:1}:{exact:0,market:0,overall:0}, records:display };
}

function buildTrendPlay(split: DraftKingsSplit, history: SignalHistoryRow[], referenceDate:string, row:SheetRow): TrendPlay {
  const primary=warningFor(split.betsPct,split.moneyPct); const active=[{signalType:"Public Split" as const,signalKey:primary.warningKey,signal:primary.warning,tone:primary.warningTone}];
  if(split.lineMovementSignal) active.push({signalType:"Line Movement",signalKey:textKey(split.lineMovementSignal).toUpperCase().replace(/\s+/g,"_"),signal:split.lineMovementSignal,tone:split.lineMovementTone==="positive"?"positive":"negative"});
  const signals=active.map((signal)=>signalBreakdown(signal,split.market,split.sideGroup,history,referenceDate)); const withHistory=signals.filter((signal)=>signal.records.allTime.totalBets>0); const baseScore=Math.round(withHistory.length?withHistory.reduce((s,x)=>s+x.score,0)/withHistory.length:50);
  return { date:referenceDate, game:String(row.Game||`${row["Away Team"]} @ ${row["Home Team"]}`), gameKey:String(row["Game ID"]||row["Game Key"]||""), gameTime:gameTime(row), awayTeam:String(row["Away Team"]||""), homeTeam:String(row["Home Team"]||""), market:split.market,
    selection:split.market==="Total"?split.side:split.selectionTeam, selectionTeam:split.selectionTeam, side:split.side, sideGroup:split.sideGroup, line:split.line, odds:split.odds,
    betsPct:split.betsPct,moneyPct:split.moneyPct,gapPct:split.gapPct,openingBetsPct:split.openingBetsPct,openingMoneyPct:split.openingMoneyPct,publicMovementPct:split.publicMovementPct,sharpMovementPct:split.sharpMovementPct,openingLine:split.openingLine,openingOdds:split.openingOdds,openingImpliedPct:split.openingImpliedPct,currentImpliedPct:split.currentImpliedPct,lineMovementBasis:split.lineMovementBasis,lineMovementValue:split.lineMovementValue,score:baseScore,baseScore,tier:"Pass",signals,updatedAt:split.snapshotTime||nowET(),snapshotStatus:"LIVE" };
}

function headToHead(plays: TrendPlay[]) {
  return plays.map((play)=>{
    const opponents=plays.filter((x)=>x.gameKey===play.gameKey&&x.market===play.market&&textKey(x.selection)!==textKey(play.selection));
    const opponent=opponents.sort((a,b)=>(b.baseScore||b.score)-(a.baseScore||a.score))[0]; if(!opponent) return {...play,score:0,tier:"Pass" as const};
    const own=play.baseScore||play.score, other=opponent.baseScore||opponent.score, gap=own-other, eligible=gap>0.01&&play.signals.some(s=>s.records.allTime.totalBets>0)&&opponent.signals.some(s=>s.records.allTime.totalBets>0), bonus=Math.min(5,Math.abs(gap)/5); const score=eligible?Math.min(100,own+bonus):Math.min(59,Math.max(0,own-bonus));
    return {...play,opponentScore:other,comparisonGap:Math.abs(gap),comparisonWinner:gap>0.01,score,tier:!eligible||score<60?"Pass":score>=85?"Elite":score>=69?"Strong":"Good"};
  });
}

function findSlateForSplit(split:DraftKingsSplit,slate:SheetRow[],sport:FootballSport){return slate.find((row)=>(!isoDate(row.Date)||isoDate(row.Date)===split.date)&&sameTeam(row["Away Team"],split.awayTeam,sport)&&sameTeam(row["Home Team"],split.homeTeam,sport));}
function findSplitForSide(row:SheetRow,splits:DraftKingsSplit[],sport:FootballSport,market:FootballMarket,selection:string){return splits.find((split)=>split.market===market&&sameTeam(row["Away Team"],split.awayTeam,sport)&&sameTeam(row["Home Team"],split.homeTeam,sport)&&(market==="Total"?textKey(split.side)===textKey(selection):sameTeam(split.selectionTeam,selection,sport)));}

function modelTrendShells(row:SheetRow):SheetRow[]{
  const common={Date:isoDate(row.Date||row["Game Date"]||"")||todayET(),"Game Key":String(row["Game ID"]||row["Game Key"]||""),Game:String(row.Game||`${row["Away Team"]} @ ${row["Home Team"]}`),"Game Time":gameTime(row),"Away Team":String(row["Away Team"]||""),"Home Team":String(row["Home Team"]||""),"Model Version":String(row["Model Version"]||""),Result:"Pending"};
  const home=String(row["Home Team"]||""),away=String(row["Away Team"]||""); const spreadLine=Number(row["Market Home Spread"]||row["Home Spread"]||0); const totalLine=Number(row["Market Total"]||row.Total||0);
  const homeOdds=String(row["Home Spread Odds"]||row["Spread Odds"]||"-110"), awayOdds=String(row["Away Spread Odds"]||"-110"), overOdds=String(row["Total Over Odds"]||row["Total Odds"]||"-110"),underOdds=String(row["Total Under Odds"]||"-110");
  const spreadGrade=String(row["Spread Grade"]||"No Play"),totalGrade=String(row["Total Grade"]||"No Play"); const spreadPick=String(row["Spread Pick"]||""); const totalPick=String(row["Total Pick"]||"");
  return [
    {...common,Market:"Spread",Selection:home,Side:"",Line:String(spreadLine),Odds:homeOdds,"Odds/Line":`${spreadLine} / ${homeOdds}`,"Model Grade":sameTeam(spreadPick,home,"NCAAF" as FootballSport)?spreadGrade:"Research","Qualified":sameTeam(spreadPick,home,"NCAAF" as FootballSport)&&spreadGrade!=="No Play"?"TRUE":"FALSE","Model %":sameTeam(spreadPick,home,"NCAAF" as FootballSport)?String(row["Spread Probability"]||""):"","Edge %":sameTeam(spreadPick,home,"NCAAF" as FootballSport)?String(row["Spread Price Edge"]||row["Spread Edge"]||""):""},
    {...common,Market:"Spread",Selection:away,Side:"",Line:String(-spreadLine),Odds:awayOdds,"Odds/Line":`${-spreadLine} / ${awayOdds}`,"Model Grade":sameTeam(spreadPick,away,"NCAAF" as FootballSport)?spreadGrade:"Research","Qualified":sameTeam(spreadPick,away,"NCAAF" as FootballSport)&&spreadGrade!=="No Play"?"TRUE":"FALSE","Model %":sameTeam(spreadPick,away,"NCAAF" as FootballSport)?String(row["Spread Probability"]||""):"","Edge %":sameTeam(spreadPick,away,"NCAAF" as FootballSport)?String(row["Spread Price Edge"]||row["Spread Edge"]||""):""},
    {...common,Market:"Total",Selection:"Over",Side:"Over",Line:String(totalLine),Odds:overOdds,"Odds/Line":`${totalLine} / ${overOdds}`,"Model Grade":textKey(totalPick).startsWith("over")?totalGrade:"Research","Qualified":textKey(totalPick).startsWith("over")&&totalGrade!=="No Play"?"TRUE":"FALSE","Model %":textKey(totalPick).startsWith("over")?String(row["Total Probability"]||""):"","Edge %":textKey(totalPick).startsWith("over")?String(row["Total Price Edge"]||row["Total Edge"]||""):""},
    {...common,Market:"Total",Selection:"Under",Side:"Under",Line:String(totalLine),Odds:underOdds,"Odds/Line":`${totalLine} / ${underOdds}`,"Model Grade":textKey(totalPick).startsWith("under")?totalGrade:"Research","Qualified":textKey(totalPick).startsWith("under")&&totalGrade!=="No Play"?"TRUE":"FALSE","Model %":textKey(totalPick).startsWith("under")?String(row["Total Probability"]||""):"","Edge %":textKey(totalPick).startsWith("under")?String(row["Total Price Edge"]||row["Total Edge"]||""):""},
  ];
}

function trendRowKey(row:SheetRow){return `${isoDate(row.Date)}|${textKey(row["Game Key"]||row.Game)}|${textKey(row.Market)}|${textKey(row.Market==="Total"?row.Side||row.Selection:row.Selection)}`;}

function authoritativeFinalTrend(row: SheetRow) {
  const raw = String(row["Trend Score Details"] || "").trim();
  if (!raw) return false;
  try {
    const play = JSON.parse(raw) as TrendPlay;
    return play.snapshotStatus === "FINAL_PREGAME" && play.gradingVersion === FROZEN_TREND_GRADING_VERSION;
  } catch {
    return false;
  }
}

function splitHasAuthoritativeFinalTrend(rows: SheetRow[], split: DraftKingsSplit, sport: FootballSport) {
  return rows.some((row) => {
    if (!authoritativeFinalTrend(row) || isoDate(row.Date) !== split.date) return false;
    if (!sameTeam(row["Away Team"], split.awayTeam, sport) || !sameTeam(row["Home Team"], split.homeTeam, sport)) return false;
    if (String(row.Market || "") !== split.market) return false;
    return split.market === "Total"
      ? textKey(row.Side || row.Selection) === textKey(split.side)
      : sameTeam(row.Selection, split.selectionTeam, sport);
  });
}

function settleTrendRows(rows:SheetRow[],schedule:SheetRow[],sport:FootballSport){
  const finals=schedule.filter((row)=>truthy(row.Completed)||((row["Away Score"]??"")!==""&&(row["Home Score"]??"")!==""));
  return rows.map((row)=>{
    if(resultCode(row.Result)) return row; const game=finals.find((g)=>{const gid=String(g["Game ID"]||"");const rid=String(row["Game Key"]||"");return gid&&rid?gid===rid:sameTeam(g["Away Team"],row["Away Team"],sport)&&sameTeam(g["Home Team"],row["Home Team"],sport);}); if(!game)return row;
    const away=Number(game["Away Score"]),home=Number(game["Home Score"]); if(!Number.isFinite(away)||!Number.isFinite(home))return row; const line=numericLine(row["Public Split Line"]||row.Line); if(line==null)return row; let result="";
    if(row.Market==="Spread"){const selectedHome=sameTeam(row.Selection,row["Home Team"],sport);const margin=selectedHome?home-away:away-home;const value=margin+line;result=value>0?"Win":value<0?"Loss":"Push";} else {const value=away+home-line;result=Math.abs(value)<1e-9?"Push":textKey(row.Side||row.Selection)==="under"?(value<0?"Win":"Loss"):(value>0?"Win":"Loss");}
    return {...row,Result:result,"Actual Away Runs":String(away),"Actual Home Runs":String(home),"Actual Total":String(away+home),"Result Updated":nowET()};
  });
}

function recordTotals(rows:SheetRow[],days?:number){
  const now=Date.parse(`${todayET()}T12:00:00Z`);let wins=0,losses=0,pushes=0,units=0;
  for(const row of rows){const result=resultCode(row.Result||row.Status);if(!result)continue;if(days){const d=Date.parse(`${isoDate(row.Date)}T12:00:00Z`);const diff=Math.round((now-d)/86400000);if(!Number.isFinite(diff)||diff<0||diff>=days)continue;}const odds=parseOdds(row.Odds||row["Odds/Line"]||-110);if(result==="W"){wins++;units+=profitUnits(odds);}else if(result==="L"){losses++;units-=1;}else pushes++;}
  const total=wins+losses+pushes,decisions=wins+losses;return{label:"",record:`${wins}-${losses}-${pushes}`,totalBets:total,winPct:decisions?Math.round(wins/decisions*1000)/10:0,unitsWon:Math.round(units*100)/100,roiPct:total?Math.round(units/total*1000)/10:0,wins,losses,pushes};
}

function bestPlays(slate:SheetRow[],sport:FootballSport){
  const plays:any[]=[];for(const row of slate){const game=String(row.Game||`${row["Away Team"]} @ ${row["Home Team"]}`),away=String(row["Away Team"]||""),home=String(row["Home Team"]||"");
    const sg=String(row["Spread Grade"]||"");if(sg&&sg!=="No Play"){const pick=String(row["Spread Pick"]||"");plays.push({playType:sg,game,play:pick,oddsLine:String(row["Spread Odds"]||row["Market Home Spread"]||""),score:String(row["Spread Probability"]||""),isGreen:true,awayTeam:away,homeTeam:home,reliability:row.Reliability,selectedProbability:row["Spread Probability"],modelVersion:row["Model Version"],role:"Spread",publicBetsPct:row["Spread Public Bets %"],publicMoneyPct:row["Spread Public Money %"]});}
    const tg=String(row["Total Grade"]||"");if(tg&&tg!=="No Play"){plays.push({playType:tg,game,play:String(row["Total Pick"]||""),oddsLine:String(row["Total Odds"]||row["Market Total"]||""),score:String(row["Total Probability"]||""),isGreen:true,awayTeam:away,homeTeam:home,reliability:row.Reliability,selectedProbability:row["Total Probability"],modelVersion:row["Model Version"],role:"Total"});}
  }return plays;
}

export async function buildFootballPublicData(sport:FootballSport){
  const today=todayET(); const trackingWeek=footballWeekBounds(sport,today); await Promise.all([ensureSportWorksheet(sport,"all_game_trends",ALL_GAME_TRENDS_HEADERS),ensureSportWorksheet(sport,"public_split_snapshots",PUBLIC_SPLIT_HEADERS)]);
  const [slateAll,tracker,schedule,trendExisting,snapshotExisting]=await Promise.all([readSportWorksheet(sport,"daily_slate"),readSportWorksheet(sport,"bet_tracker"),readSportWorksheet(sport,"schedule"),readSportWorksheet(sport,"all_game_trends",ALL_GAME_TRENDS_HEADERS),readSportWorksheet(sport,"public_split_snapshots",PUBLIC_SPLIT_HEADERS)]);
  const slate=slateAll.filter((row)=>{const date=isoDate(row.Date||row["Game Date"]||"");return !date||date===today;});
  const trackingSlate=slateAll.filter((row)=>inFootballTrackingWeek(row,sport,today));
  let trendRows=settleTrendRows(trendExisting,schedule,sport); const shells=slate.flatMap(modelTrendShells); const merged=new Map(trendRows.map((row)=>[trendRowKey(row),row]));for(const shell of shells){const key=trendRowKey(shell);merged.set(key,{...(merged.get(key)||{}),...shell,Result:resultCode(merged.get(key)?.Result)?merged.get(key)!.Result:"Pending"});}trendRows=[...merged.values()];
  const dk=await loadDraftKingsSplits(sport,trackingSlate); const snapshotMap=new Map(snapshotExisting.map((row)=>[snapshotKey(row),row]));
  const enrichedTrackingLive=dk.splits.map((split)=>movementForSplit(split,snapshotMap.get(splitSnapshotKey(split))));
  // A scheduled run can drift a few minutes. Once it is past T-15, do not
  // use the new scrape: reconstruct the market from the last stored snapshot.
  const enrichedTracking=enrichedTrackingLive.flatMap((split)=>{
    const slateRow=findSlateForSplit(split,trackingSlate,sport);
    const minutesToKickoff=minutesUntilDraftKingsKickoff(split) ?? (slateRow?minutesUntilKickoff(slateRow):null);
    if(minutesToKickoff!=null&&minutesToKickoff<15){
      const persisted=splitFromPersistedSnapshot(split,snapshotMap.get(splitSnapshotKey(split)));
      return persisted?[persisted]:[];
    }
    return [split];
  });
  const snapshotStamp=nowET();
  const currentSnapshots=enrichedTrackingLive.flatMap((split)=>{
    const slateRow=findSlateForSplit(split,trackingSlate,sport);
    const minutesToKickoff=minutesUntilDraftKingsKickoff(split) ?? (slateRow?minutesUntilKickoff(slateRow):null);
    // Once a side has an authoritative FINAL_PREGAME trend, its persisted
    // market row is immutable. After kickoff we also refuse to write a late
    // snapshot and falsely call it a verified pregame lock.
    if(splitHasAuthoritativeFinalTrend(trendExisting,split,sport)) return [];
    if(minutesToKickoff!=null&&minutesToKickoff<15) return [];
    return [snapshotRow({...split,snapshotTime:snapshotStamp})];
  });
  if(currentSnapshots.length) await upsertSportRows(sport,"public_split_snapshots",PUBLIC_SPLIT_HEADERS,currentSnapshots,snapshotKey);
  const enriched=enrichedTracking.filter((split)=>Boolean(findSlateForSplit(split,slate,sport)));
  const history=historyFromTrendRows(trendRows); const rawTrendPlays=enriched.map((split)=>{const row=findSlateForSplit(split,slate,sport);return row?buildTrendPlay(split,history,today,row):null;}).filter(Boolean) as TrendPlay[]; const trendPlays=headToHead(rawTrendPlays);
  const playMap=new Map(trendPlays.map((play)=>[`${play.gameKey}|${play.market}|${textKey(play.market==="Total"?play.side:play.selection)}`,play]));
  trendRows=trendRows.map((row)=>{
    if(isoDate(row.Date)!==today)return row;
    if(authoritativeFinalTrend(row)) return row;
    const split=findSplitForSide(row,enriched,sport,row.Market as FootballMarket,String(row.Market==="Total"?row.Side||row.Selection:row.Selection));if(!split)return row;
    // DraftKings event time is the best available lock clock. Fall back to
    // the saved slate time only when the feed does not provide one.
    const minutesToKickoff=minutesUntilDraftKingsKickoff(split) ?? minutesUntilKickoff(row);
    if(minutesToKickoff!=null&&minutesToKickoff<0)return row;
    const play=playMap.get(`${String(row["Game Key"]||"")}|${row.Market}|${textKey(row.Market==="Total"?row.Side||row.Selection:row.Selection)}`);const primary=play?.signals[0];
    const locked=minutesToKickoff!=null&&minutesToKickoff<=15&&minutesToKickoff>=0;
    const stamp=nowET();
    const marketStamp=locked&&split.snapshotTime?split.snapshotTime:stamp;
    return{...row,"Public Bets %":String(split.betsPct),"Public Money %":String(split.moneyPct),"Public Gap %":String(split.gapPct),"Public Warning":split.warning,"Public Warning Negative":split.warningNegative?"TRUE":"FALSE","Public Split Source":"DraftKings","Public Split Market":split.market,"Public Split Selection":split.market==="Total"?split.side:split.selectionTeam,"Public Split Line":split.line==null?"":String(split.line),"Public Split Odds":split.odds,"Public Split Match Confidence":locked?"Final 15-minute football market lock":"Live weekly football market","Public Split Snapshot Time":marketStamp,"Opening Public %":String(split.openingBetsPct??split.betsPct),"Current Public %":String(split.betsPct),"Public Change %":String(split.publicMovementPct??0),"Opening Sharp %":String(split.openingMoneyPct??split.moneyPct),"Current Sharp %":String(split.moneyPct),"Sharp Change %":String(split.sharpMovementPct??0),"Opening Public Split Line":split.openingLine==null?"":String(split.openingLine),"Opening Public Split Odds":split.openingOdds||split.odds,"Opening Public Split Snapshot Time":split.openingSnapshotTime||String(snapshotMap.get(splitSnapshotKey(split))?.["Opening Snapshot Time ET"]||marketStamp),"Opening Implied %":split.openingImpliedPct==null?"":String(split.openingImpliedPct),"Current Implied %":split.currentImpliedPct==null?"":String(split.currentImpliedPct),"Line Movement Signal":split.lineMovementSignal||"","Line Movement Tone":split.lineMovementTone||"","Line Movement Basis":split.lineMovementBasis||"","Line Movement Value":split.lineMovementValue==null?"":String(split.lineMovementValue),"Trend Play":play?"TRUE":"FALSE","Trend Score":play?String(Math.round(play.score)):"","Trend Tier":play?.tier||"","Trend Signals":play?.signals.map(s=>s.signal).join(" | ")||"","Trend All Time Record":primary?.records.allTime.record||"","Trend Last 30 Record":primary?.records.last30.record||"","Trend Last 7 Record":primary?.records.last7.record||"","Trend Exact Sample":play?.signals.map(s=>s.exactSample).join(" | ")||"","Trend Score Details":play?JSON.stringify({...play,frozenAt:locked?marketStamp:undefined,snapshotStatus:locked?"FINAL_PREGAME":"LIVE",gradingVersion:locked?FROZEN_TREND_GRADING_VERSION:undefined}):""};
  });
  await upsertSportRows(sport,"all_game_trends",ALL_GAME_TRENDS_HEADERS,trendRows,trendRowKey);
  // The public board must render the same frozen object that was persisted.
  // Otherwise the UI recalculates a LIVE play after lock and shows an Updated
  // timestamp later than the advertised final-lock time.
  const displayTrendMap=new Map<string,TrendPlay>();
  const displayTrendKey=(play:TrendPlay)=>`${play.gameKey||textKey(play.game)}|${play.market}|${textKey(play.market==="Total"?play.side:play.selection)}`;
  for(const rawPlay of trendPlays){const play=rawPlay as TrendPlay;displayTrendMap.set(displayTrendKey(play),play);}
  for(const row of trendRows){
    if(isoDate(row.Date)!==today||!authoritativeFinalTrend(row)) continue;
    try{
      const play=JSON.parse(String(row["Trend Score Details"]||"")) as TrendPlay;
      displayTrendMap.set(displayTrendKey(play),play);
    }catch{/* ignore malformed legacy JSON */}
  }
  const displayTrendPlays=[...displayTrendMap.values()];
  const best=bestPlays(slate,sport);const overall=recordTotals(tracker);const last7=recordTotals(tracker,7);const pending=tracker.filter((r)=>!resultCode(r.Result||r.Status)).length;
  const recordSummary=[{betType:"Spread",status:"EVEN",...recordTotals(tracker.filter(r=>textKey(r["Bet Type"]||r.Market).includes("spread")))},{betType:"Total",status:"EVEN",...recordTotals(tracker.filter(r=>textKey(r["Bet Type"]||r.Market).includes("total")))}].map((r:any)=>({...r,status:r.wins>r.losses?"WINNING":r.losses>r.wins?"LOSING":"EVEN"}));
  const last7RecordSummary=[{betType:"Spread",status:"EVEN",...recordTotals(tracker.filter(r=>textKey(r["Bet Type"]||r.Market).includes("spread")),7)},{betType:"Total",status:"EVEN",...recordTotals(tracker.filter(r=>textKey(r["Bet Type"]||r.Market).includes("total")),7)}].map((r:any)=>({...r,status:r.wins>r.losses?"WINNING":r.losses>r.wins?"LOSING":"EVEN"}));
  return {ok:true,sport,database:sportDatabaseLabel(sport),today,lastUpdated:nowET(),tiles:{last7Days:last7,overallGreen:overall,handpickedLast7:last7,handpickedOverall:overall,pendingGreen:pending,bestPlaysToday:best.length},bestPlays:best,slateToday:slate,betTrackerRows:tracker,draftKings:{ok:enriched.length>0,status:enriched.length?"LIVE":"UNAVAILABLE",updatedAt:nowET(),stale:false,splits:enriched,props:[],errors:dk.errors,displayMode:"LIVE",trackingMode:"WEEKLY",trackingWeekStart:trackingWeek.start,trackingWeekEnd:trackingWeek.end,trackedGames:trackingSlate.length},draftKingsSignalRows:history,trendRecordRows:trendRows.filter(r=>resultCode(r.Result)),trendPlays:displayTrendPlays,aiPicks:[],aiPickRecordRows:[],aiSelectorStatus:{mode:"LIVE_PREVIEW",externalResearchConfigured:false,message:`${sport} AI selector is not enabled yet; model and trend records are live.`,updatedAt:nowET(),candidateCount:0,selectedCount:0},recordSummary,last7RecordSummary,handpickedRecordSummary:recordSummary,handpickedLast7RecordSummary:last7RecordSummary};
}

// Small pure exports used by CI to guarantee football follows the MLB trend contract.
export const __test__ = { warningFor, movementForSplit, trendRecord, windows, windowMetrics, signalBreakdown, headToHead, parseBettingSplits, footballWeekBounds, minutesUntilKickoff };
