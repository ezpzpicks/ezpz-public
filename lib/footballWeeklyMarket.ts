import {
  type FootballSport,
  type SheetRow,
  appendSportRows,
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
const MARKET_HISTORY_TAB = "odds_snapshot";

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

export const MARKET_HISTORY_HEADERS = [
  "Snapshot Time ET", "Date", "Week", "Game Key", "Game Time", "Game",
  "Away Team", "Home Team", "Market", "Selection", "Side", "Line", "Odds",
  "Bets %", "Handle %", "Public Gap %", "Warning", "Source", "Source URL",
  "State Signature",
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
  firstTrackedAt?: string;
  lowLine?: number | null;
  highLine?: number | null;
  lineMoveCount?: number;
  lastLineMoveAt?: string;
  lineHistoryLabel?: string;
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
  const matches = String(value || "").replace(/[−–—]/g, "-").match(/[+-]?\d+(?:\.\d+)?/g);
  const raw = matches?.length ? matches[matches.length - 1] : "";
  const n = raw ? Number(raw) : NaN;
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
  for (const row of rows) map.set(`${row.date}|${textKey(row.game)}|${row.market}|${textKey(row.market === "Total" ? row.side : row.selectionTeam)}`, row);
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

const NFL_MARKET_TEAM_ALIASES: Record<string, string[]> = {
  ARI: ["Arizona Cardinals", "Cardinals", "Arizona", "ARI", "ARZ"],
  ATL: ["Atlanta Falcons", "Falcons", "Atlanta", "ATL"],
  BAL: ["Baltimore Ravens", "Ravens", "Baltimore", "BAL", "BLT"],
  BUF: ["Buffalo Bills", "Bills", "Buffalo", "BUF"],
  CAR: ["Carolina Panthers", "Panthers", "Carolina", "CAR"],
  CHI: ["Chicago Bears", "Bears", "Chicago", "CHI"],
  CIN: ["Cincinnati Bengals", "Bengals", "Cincinnati", "CIN"],
  CLE: ["Cleveland Browns", "Browns", "Cleveland", "CLE", "CLV"],
  DAL: ["Dallas Cowboys", "Cowboys", "Dallas", "DAL"],
  DEN: ["Denver Broncos", "Broncos", "Denver", "DEN"],
  DET: ["Detroit Lions", "Lions", "Detroit", "DET"],
  GB: ["Green Bay Packers", "Packers", "Green Bay", "GB"],
  HOU: ["Houston Texans", "Texans", "Houston", "HOU", "HST"],
  IND: ["Indianapolis Colts", "Colts", "Indianapolis", "IND"],
  JAX: ["Jacksonville Jaguars", "Jaguars", "Jacksonville", "JAX", "JAC"],
  KC: ["Kansas City Chiefs", "Chiefs", "Kansas City", "KC"],
  LV: ["Las Vegas Raiders", "Raiders", "Las Vegas", "LV", "OAK"],
  LAC: ["Los Angeles Chargers", "LA Chargers", "Chargers", "LAC"],
  LAR: ["Los Angeles Rams", "LA Rams", "Rams", "LAR", "LA"],
  MIA: ["Miami Dolphins", "Dolphins", "Miami", "MIA"],
  MIN: ["Minnesota Vikings", "Vikings", "Minnesota", "MIN"],
  NE: ["New England Patriots", "Patriots", "New England", "NE"],
  NO: ["New Orleans Saints", "Saints", "New Orleans", "NO"],
  NYG: ["New York Giants", "NY Giants", "Giants", "NYG"],
  NYJ: ["New York Jets", "NY Jets", "Jets", "NYJ"],
  PHI: ["Philadelphia Eagles", "Eagles", "Philadelphia", "PHI"],
  PIT: ["Pittsburgh Steelers", "Steelers", "Pittsburgh", "PIT"],
  SEA: ["Seattle Seahawks", "Seahawks", "Seattle", "SEA"],
  SF: ["San Francisco 49ers", "49ers", "San Francisco", "SF"],
  TB: ["Tampa Bay Buccaneers", "Buccaneers", "Tampa Bay", "TB"],
  TEN: ["Tennessee Titans", "Titans", "Tennessee", "TEN"],
  WAS: ["Washington Commanders", "Commanders", "Washington", "WAS", "WSH"],
};

function nflMarketTeamCode(value: unknown) {
  const key = textKey(value);
  if (!key) return "";
  for (const [code, aliases] of Object.entries(NFL_MARKET_TEAM_ALIASES)) {
    if (textKey(code) === key || aliases.some((alias) => {
      const aliasKey = textKey(alias);
      return aliasKey === key || aliasKey.endsWith(` ${key}`) || key.endsWith(` ${aliasKey}`);
    })) return code;
  }
  return "";
}

function canonicalScheduleDate(row: SheetRow) {
  const raw = String(row.Date || row["Game Date"] || "").trim();
  const iso = raw.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const us = raw.match(/(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?/);
  if (us) return `${us[3] || todayET().slice(0, 4)}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  return "";
}

function collegeMarketTeamMatch(leftValue: unknown, rightValue: unknown) {
  const left = textKey(leftValue).replace(/\buniversity\b/g, "").replace(/\bthe\b/g, "").replace(/\s+/g, " ").trim();
  const right = textKey(rightValue).replace(/\buniversity\b/g, "").replace(/\bthe\b/g, "").replace(/\s+/g, " ").trim();
  if (!left || !right) return false;
  if (left === right || left.endsWith(` ${right}`) || right.endsWith(` ${left}`)) return true;
  const l = new Set(left.split(" ").filter((token) => token.length > 2));
  const r = new Set(right.split(" ").filter((token) => token.length > 2));
  const overlap = [...l].filter((token) => r.has(token)).length;
  return overlap >= Math.min(2, Math.max(1, Math.min(l.size, r.size)));
}

function canonicalGameRow(split: Pick<Split, "date" | "awayTeam" | "homeTeam">, sport: FootballSport, rows: SheetRow[]) {
  return rows.find((row) => {
    if (canonicalScheduleDate(row) !== split.date) return false;
    if (sport === "NFL") {
      const rowAway = nflMarketTeamCode(row["Away Team"]);
      const rowHome = nflMarketTeamCode(row["Home Team"]);
      const splitAway = nflMarketTeamCode(split.awayTeam);
      const splitHome = nflMarketTeamCode(split.homeTeam);
      return !!rowAway && !!rowHome && !!splitAway && !!splitHome && rowAway === splitAway && rowHome === splitHome;
    }
    return collegeMarketTeamMatch(row["Away Team"], split.awayTeam) && collegeMarketTeamMatch(row["Home Team"], split.homeTeam);
  });
}

function validFootballMarketSplit(split: Split, sport: FootballSport, rows: SheetRow[]) {
  const matched = canonicalGameRow(split, sport, rows);
  // Every football market — NFL and CFB alike — must match a real stored matchup.
  // Team nickname aliases alone are not sufficient because a mixed DK feed can
  // contain non-football clubs with names such as Lions or Eagles.
  if (!matched) return false;
  if (sport === "NFL") {
    const awayCode = nflMarketTeamCode(split.awayTeam);
    const homeCode = nflMarketTeamCode(split.homeTeam);
    if (!awayCode || !homeCode || awayCode === homeCode) return false;
  }

  if (split.market === "Spread") {
    if (split.line == null || Math.abs(split.line) > 60) return false;
    if (sport === "NFL") {
      const selectionCode = nflMarketTeamCode(split.selectionTeam);
      return !!selectionCode && [nflMarketTeamCode(split.awayTeam), nflMarketTeamCode(split.homeTeam)].includes(selectionCode);
    }
    return collegeMarketTeamMatch(split.selectionTeam, split.awayTeam) || collegeMarketTeamMatch(split.selectionTeam, split.homeTeam);
  }

  if (split.side !== "Over" && split.side !== "Under") return false;
  return split.line != null && split.line >= 20 && split.line <= 100;
}

function storedFootballWeek(sport: FootballSport, split: Pick<Split, "date" | "awayTeam" | "homeTeam">, rows: SheetRow[]) {
  const matched = canonicalGameRow(split, sport, rows);
  const rawWeek = String(matched?.Week || "").trim();
  if (sport === "NCAAF" && /^\d+$/.test(rawWeek)) return `Week ${Number(rawWeek)}`;
  if (sport === "NFL" && /^\d+$/.test(rawWeek)) return `Week ${Number(rawWeek)}`;
  return footballWeekLabel(sport, split.date);
}

async function loadPostedSplits(sport: FootballSport, canonicalRows: SheetRow[]) {
  const groups = sport === "NFL" ? ["84240"] : ["NCAA Football"];
  const map = new Map<string, Split>();
  const errors: string[] = [];
  const horizons = sport === "NFL" ? ["n7days"] : ["n30days"];
  const marketFilters = sport === "NFL" ? ["Spread", "Total"] : [""];
  for (const group of groups) {
    for (const horizon of horizons) {
      for (const marketFilter of marketFilters) {
        try {
          for (let page = 1; page <= 10; page += 1) {
            const parsed = parseBettingSplits(await fetchHtml({
              itm_content: group,
              tb_eg: group,
              tb_page: String(page),
              ...(horizon ? { tb_edate: horizon } : {}),
              ...(marketFilter ? { tb_emt: marketFilter } : {}),
            }));
            if (!parsed.length) break;
            for (const split of parsed) {
              const key = splitTrendKey(split);
              map.set(key, split);
            }
          }
        } catch (error) {
          errors.push(`${group}${horizon ? `/${horizon}` : ""}${marketFilter ? `/${marketFilter}` : ""}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }
  const discovered = [...map.values()];
  const validated = discovered.filter((split) => validFootballMarketSplit(split, sport, canonicalRows));
  if (validated.length !== discovered.length) {
    errors.push(`Football validation rejected ${discovered.length - validated.length} non-${sport} or malformed market sides.`);
  }
  return { splits: validated, errors };
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

function marketHistoryLogicalKey(row: SheetRow) {
  const market = String(row.Market || "");
  const selection = market === "Total" ? String(row.Side || row.Selection || "") : String(row.Selection || "");
  return `${String(row["Game Key"] || "")}|${textKey(market)}|${textKey(selection)}`;
}

function normalizedStateNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? String(Math.round(number * 10) / 10) : "";
}

function marketHistoryStateSignatureValues(line: number | null, odds: unknown, betsPct: unknown, handlePct: unknown) {
  return [
    line == null ? "" : normalizedStateNumber(line),
    String(odds || "").replace(/−/g, "-").trim(),
    normalizedStateNumber(betsPct),
    normalizedStateNumber(handlePct),
  ].join("|");
}

function marketHistoryStateSignature(row: SheetRow) {
  return String(row["State Signature"] || "").trim() || marketHistoryStateSignatureValues(
    numericLine(row.Line), row.Odds, row["Bets %"], row["Handle %"],
  );
}

function marketHistoryRowForSplit(split: Split, sport: FootballSport, canonicalRows: SheetRow[], snapshotTime: string): SheetRow {
  const selection = split.market === "Total" ? split.side : split.selectionTeam;
  return {
    "Snapshot Time ET": snapshotTime,
    Date: split.date,
    Week: storedFootballWeek(sport, split, canonicalRows),
    "Game Key": gameKey(split),
    "Game Time": split.eventTime,
    Game: split.game,
    "Away Team": split.awayTeam,
    "Home Team": split.homeTeam,
    Market: split.market,
    Selection: selection,
    Side: split.side,
    Line: split.line == null ? "" : String(split.line),
    Odds: split.odds,
    "Bets %": String(split.betsPct),
    "Handle %": String(split.moneyPct),
    "Public Gap %": String(split.gapPct),
    Warning: split.warning,
    Source: "DraftKings",
    "Source URL": DK_URL,
    "State Signature": marketHistoryStateSignatureValues(split.line, split.odds, split.betsPct, split.moneyPct),
  };
}

function marketHistorySeedRow(row: SheetRow, snapshotTime: string): SheetRow | null {
  const market = String(row.Market || "");
  if (market !== "Spread" && market !== "Total") return null;
  const line = numericLine(row["Opening Line"] || row.Line);
  const odds = String(row["Opening Odds"] || row.Odds || "").replace(/−/g, "-");
  const betsPct = Number(row["Opening Bets %"]);
  const handlePct = Number(row["Opening Handle %"]);
  const gap = Number.isFinite(betsPct) && Number.isFinite(handlePct)
    ? Math.round((handlePct - betsPct) * 10) / 10
    : Number(row["Public Gap %"] || 0);
  return {
    "Snapshot Time ET": snapshotTime,
    Date: String(row.Date || ""),
    Week: String(row.Week || ""),
    "Game Key": String(row["Game Key"] || ""),
    "Game Time": String(row["Game Time"] || ""),
    Game: String(row.Game || ""),
    "Away Team": String(row["Away Team"] || ""),
    "Home Team": String(row["Home Team"] || ""),
    Market: market,
    Selection: String(row.Selection || ""),
    Side: String(row.Side || ""),
    Line: line == null ? "" : String(line),
    Odds: odds,
    "Bets %": Number.isFinite(betsPct) ? String(betsPct) : "",
    "Handle %": Number.isFinite(handlePct) ? String(handlePct) : "",
    "Public Gap %": Number.isFinite(gap) ? String(gap) : "",
    Warning: String(row.Warning || ""),
    Source: "DraftKings",
    "Source URL": DK_URL,
    "State Signature": marketHistoryStateSignatureValues(line, odds, betsPct, handlePct),
  };
}

function historyLineLabel(market: WeeklyFootballMarket, line: number) {
  const value = Math.round(line * 10) / 10;
  return market === "Spread" && value > 0 ? `+${value}` : String(value);
}

function marketHistorySummary(split: Split, rows: SheetRow[]) {
  const key = splitTrendKey(split);
  const states = rows.filter((row) => marketHistoryLogicalKey(row) === key);
  if (!states.length) return null;
  const first = states[0];
  const linePath: number[] = [];
  let previousLine: number | null = null;
  let lineMoveCount = 0;
  let lastLineMoveDelta: number | null = null;
  let lastLineMoveAt = "";
  for (const row of states) {
    const line = numericLine(row.Line);
    if (line == null) continue;
    if (previousLine == null) {
      linePath.push(line);
    } else if (Math.abs(line - previousLine) >= 0.001) {
      lineMoveCount += 1;
      lastLineMoveDelta = Math.round((line - previousLine) * 10) / 10;
      lastLineMoveAt = String(row["Snapshot Time ET"] || "");
      linePath.push(line);
    }
    previousLine = line;
  }
  const visiblePath = linePath.length <= 8 ? linePath : [linePath[0], ...linePath.slice(-7)];
  const openingBetsPct = Number(first["Bets %"]);
  const openingMoneyPct = Number(first["Handle %"]);
  const numericLines = linePath.filter(Number.isFinite);
  return {
    firstTrackedAt: String(first["Snapshot Time ET"] || ""),
    openingLine: numericLine(first.Line),
    openingOdds: String(first.Odds || ""),
    openingBetsPct: Number.isFinite(openingBetsPct) ? openingBetsPct : split.betsPct,
    openingMoneyPct: Number.isFinite(openingMoneyPct) ? openingMoneyPct : split.moneyPct,
    lowLine: numericLines.length ? Math.min(...numericLines) : null,
    highLine: numericLines.length ? Math.max(...numericLines) : null,
    lineMoveCount,
    lastLineMoveDelta,
    lastLineMoveAt,
    lineHistoryLabel: visiblePath.map((line) => historyLineLabel(split.market, line)).join(" → "),
  };
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
  const line = numericLine(row["Public Split Line"] || row.Line);
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

function reconstructedHistorySignals(row: SheetRow) {
  const betsPct = Number(String(row["Public Bets %"] || "").replace("%", ""));
  const moneyPct = Number(String(row["Public Money %"] || "").replace("%", ""));
  const storedWarning = String(row["Public Warning"] || row.Warning || "").trim();
  if ((!Number.isFinite(betsPct) || !Number.isFinite(moneyPct)) && !storedWarning) return [] as Array<{ signalKey: string }>;

  const warning = Number.isFinite(betsPct) && Number.isFinite(moneyPct)
    ? warningFor(betsPct, moneyPct)
    : null;
  const signals: Array<{ signalKey: string }> = [{
    signalKey: warning?.warningKey || publicSplitSignalKey(storedWarning),
  }];

  const movement = String(row["Line Movement Signal"] || "").trim();
  if (movement) signals.push({ signalKey: movementSignalKey(movement) });
  return signals.filter((signal) => signal.signalKey);
}

function historyFromAllGameTrends(rows: SheetRow[]): HistoryRow[] {
  const output: HistoryRow[] = [];
  for (const row of rows) {
    const result = resultCode(row.Result);
    if (!result) continue;

    const raw = String(row["Trend Score Details"] || "").trim();
    if (raw) {
      try {
        const play = JSON.parse(raw) as WeeklyTrendPlay;
        const odds = parseOdds(row["Public Split Odds"] || row.Odds || play.odds);
        const savedSignals = play.signals || [];
        for (const signal of savedSignals) {
          output.push({
            date: canonicalScheduleDate(row) || String(row.Date || play.date || ""),
            market: play.market,
            sideGroup: play.sideGroup,
            signalKey: signal.signalType === "Line Movement"
              ? movementSignalKey(signal.signal || signal.signalKey)
              : signal.signalKey || publicSplitSignalKey(signal.signal),
            result,
            odds,
            units: result === "P" ? 0 : result === "L" ? -1 : profitUnits(odds),
          });
        }
        if (savedSignals.length) continue;
      } catch { /* reconstruct legacy rows from saved columns below */ }
    }

    const market = historyMarket(row);
    if (!market) continue;
    const signals = reconstructedHistorySignals(row);
    if (!signals.length) continue;
    const sideGroup = historySideGroup(row, market);
    const odds = parseOdds(row["Public Split Odds"] || row.Odds);
    for (const signal of signals) {
      output.push({
        date: canonicalScheduleDate(row) || String(row.Date || ""),
        market,
        sideGroup,
        signalKey: signal.signalKey,
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

function movement(split: Split, existing: SheetRow | undefined, marketRows: SheetRow[]) {
  const summary = marketHistorySummary(split, marketRows);
  const openingLine = summary?.openingLine ?? (existing ? numericLine(existing["Opening Line"]) ?? split.line : split.line);
  const openingOdds = summary?.openingOdds || String(existing?.["Opening Odds"] || split.odds);
  const openingBetsPct = summary?.openingBetsPct ?? existingNumber(existing, "Opening Bets %", split.betsPct);
  const openingMoneyPct = summary?.openingMoneyPct ?? existingNumber(existing, "Opening Handle %", split.moneyPct);
  const publicMovementPct = Math.round((split.betsPct - openingBetsPct) * 10) / 10;
  const sharpMovementPct = Math.round((split.moneyPct - openingMoneyPct) * 10) / 10;
  const openingImpliedPct = impliedPct(openingOdds);
  const currentImpliedPct = impliedPct(split.odds);
  let lineMovementBasis = "";
  let lineMovementValue: number | null = null;
  if (openingLine != null && split.line != null && Math.abs(split.line - openingLine) >= .5) {
    lineMovementBasis = split.market === "Total" ? "Total Line" : "Spread Line";
    lineMovementValue = Math.round((split.line - openingLine) * 10) / 10;
  } else if (summary?.lineMoveCount && summary.lastLineMoveDelta != null) {
    // A round trip (for example -28.5 -> -27.5 -> -28.5) is still real market
    // movement even when first and current happen to match.
    lineMovementBasis = split.market === "Total" ? "Total Line History" : "Spread Line History";
    lineMovementValue = summary.lastLineMoveDelta;
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
  return {
    openingLine, openingOdds, openingBetsPct, openingMoneyPct, publicMovementPct, sharpMovementPct,
    openingImpliedPct, currentImpliedPct, lineMovementBasis, lineMovementValue, lineMovementSignal,
    firstTrackedAt: summary?.firstTrackedAt || "",
    lowLine: summary?.lowLine ?? openingLine,
    highLine: summary?.highLine ?? openingLine,
    lineMoveCount: summary?.lineMoveCount || 0,
    lastLineMoveAt: summary?.lastLineMoveAt || "",
    lineHistoryLabel: summary?.lineHistoryLabel || (openingLine == null ? "" : historyLineLabel(split.market, openingLine)),
  };
}

function buildPlay(split: Split, existing: SheetRow | undefined, history: HistoryRow[], marketRows: SheetRow[]): WeeklyTrendPlay {
  const move = movement(split, existing, marketRows);
  const primary = signalBreakdown(split.warningKey, split.warning, split.warningTone, split.market, split.sideGroup, history, split.date);
  const signals: Signal[] = [primary];
  if (move.lineMovementSignal) {
    const signalKey = movementSignalKey(move.lineMovementSignal);
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
    firstTrackedAt: move.firstTrackedAt,
    lowLine: move.lowLine,
    highLine: move.highLine,
    lineMoveCount: move.lineMoveCount,
    lastLineMoveAt: move.lastLineMoveAt,
    lineHistoryLabel: move.lineHistoryLabel,
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
    ensureSportWorksheet(sport, MARKET_HISTORY_TAB, MARKET_HISTORY_HEADERS),
  ]);
  const [existingGames, existingTrends, existingMarketHistory, allGameTrends, scheduleRows, slateRows] = await Promise.all([
    readSportWorksheet(sport, POSTED_GAMES_TAB, POSTED_GAME_HEADERS),
    readSportWorksheet(sport, WEEKLY_TRENDS_TAB, WEEKLY_TREND_HEADERS),
    readSportWorksheet(sport, MARKET_HISTORY_TAB, MARKET_HISTORY_HEADERS),
    readSportWorksheet(sport, "all_game_trends"),
    readSportWorksheet(sport, "schedule"),
    readSportWorksheet(sport, "daily_slate"),
  ]);
  const canonicalRows = [...scheduleRows, ...slateRows, ...allGameTrends];
  const dk = await loadPostedSplits(sport, canonicalRows);
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
      Week: storedFootballWeek(sport, split, canonicalRows),
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

  // Build a durable, append-only tape. Existing weekly rows seed the first
  // tracked state once, then every distinct DraftKings state is appended.
  // We append only on change, not every five-minute heartbeat.
  const marketHistoryRows = [...existingMarketHistory];
  const marketHistoryRowsToAppend: SheetRow[] = [];
  const existingHistoryKeys = new Set(existingMarketHistory.map(marketHistoryLogicalKey).filter(Boolean));
  const latestHistoryByKey = new Map<string, SheetRow>();
  for (const row of existingMarketHistory) {
    const key = marketHistoryLogicalKey(row);
    if (key) latestHistoryByKey.set(key, row);
  }
  const postedStateRows = [...existingGames, ...postedRows];
  const firstSeenByGame = new Map(postedStateRows.map((row) => [String(row["Game Key"] || ""), String(row["First Seen"] || now)]));

  for (const split of dk.splits) {
    const key = splitTrendKey(split);
    if (!existingHistoryKeys.has(key)) {
      const existing = existingTrendMap.get(key);
      const seed = existing ? marketHistorySeedRow(existing, firstSeenByGame.get(gameKey(split)) || now) : null;
      if (seed) {
        marketHistoryRows.push(seed);
        marketHistoryRowsToAppend.push(seed);
        latestHistoryByKey.set(key, seed);
        existingHistoryKeys.add(key);
      }
    }
    const current = marketHistoryRowForSplit(split, sport, canonicalRows, now);
    const previous = latestHistoryByKey.get(key);
    if (!previous || marketHistoryStateSignature(previous) !== current["State Signature"]) {
      marketHistoryRows.push(current);
      marketHistoryRowsToAppend.push(current);
      latestHistoryByKey.set(key, current);
      existingHistoryKeys.add(key);
    }
  }

  let marketHistoryRowsAppended = 0;
  if (marketHistoryRowsToAppend.length) {
    try {
      await appendSportRows(sport, MARKET_HISTORY_TAB, MARKET_HISTORY_HEADERS, marketHistoryRowsToAppend);
      marketHistoryRowsAppended = marketHistoryRowsToAppend.length;
    } catch (error) {
      dk.errors.push(`Market history append failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const liveCandidates: WeeklyTrendPlay[] = [];
  const handledLockKeys = new Set<string>();
  for (const split of dk.splits) {
    const key = splitTrendKey(split);
    const existing = existingTrendMap.get(key);
    const minutes = minutesUntil(split);
    if (minutes != null && minutes <= 15) {
      handledLockKeys.add(key);

      // Never rebuild a final lock after kickoff. If DraftKings still exposes a
      // game after its listed start, preserve/finalize only the last verified
      // pregame state so post-kick data cannot leak into the trend record.
      if (minutes < 0) {
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
                  : "Finalized from the last verified pregame snapshot after DraftKings stopped updating.",
              });
            }
          } catch { /* keep malformed existing row unchanged */ }
        }
        continue;
      }

      // A split returned by DraftKings while 0-15 minutes remain is itself a
      // verified near-lock snapshot. Rebuild from that current split instead
      // of judging freshness from the older saved card. This also allows a
      // prematurely marked MISSED_LOCK row to recover to FINAL_PREGAME.
      if (existing && String(existing["Details JSON"] || "").trim()) {
        try {
          const saved = JSON.parse(String(existing["Details JSON"])) as WeeklyTrendPlay;
          if (saved.snapshotStatus === "FINAL_PREGAME") continue;
        } catch { /* rebuild from the current verified split */ }
      }
      const freshLock = buildPlay(split, existing, history, marketHistoryRows);
      liveCandidates.push({
        ...freshLock,
        week: footballWeekLabel(sport, split.date),
        snapshotStatus: "FINAL_PREGAME" as const,
        frozenAt: freshLock.updatedAt,
        lockWarning: undefined,
      });
      continue;
    }
    liveCandidates.push({ ...buildPlay(split, existing, history, marketHistoryRows), week: footballWeekLabel(sport, split.date) });
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
    marketHistoryRowsAppended,
    marketHistoryRowsStored: marketHistoryRows.length,
    errors: dk.errors,
    updatedAt: now,
  };
}

export async function readWeeklyFootballMarket(sport: FootballSport) {
  await Promise.all([
    ensureSportWorksheet(sport, POSTED_GAMES_TAB, POSTED_GAME_HEADERS),
    ensureSportWorksheet(sport, WEEKLY_TRENDS_TAB, WEEKLY_TREND_HEADERS),
  ]);
  const [games, rows, scheduleRows, slateRows, allGameTrends] = await Promise.all([
    readSportWorksheet(sport, POSTED_GAMES_TAB, POSTED_GAME_HEADERS),
    readSportWorksheet(sport, WEEKLY_TRENDS_TAB, WEEKLY_TREND_HEADERS),
    readSportWorksheet(sport, "schedule"),
    readSportWorksheet(sport, "daily_slate"),
    readSportWorksheet(sport, "all_game_trends"),
  ]);
  const canonicalRows = [...scheduleRows, ...slateRows, ...allGameTrends];
  const trendPlays: WeeklyTrendPlay[] = [];
  for (const row of rows) {
    const raw = String(row["Details JSON"] || "").trim();
    if (!raw) continue;
    try {
      const play = JSON.parse(raw) as WeeklyTrendPlay;
      const storedSplit = {
        date: play.date, eventTime: play.gameTime, game: play.game, awayTeam: play.awayTeam, homeTeam: play.homeTeam,
        market: play.market, selection: play.selection, selectionTeam: play.selectionTeam, side: play.side, sideGroup: play.sideGroup,
        line: play.line, odds: play.odds, moneyPct: play.moneyPct, betsPct: play.betsPct, gapPct: play.gapPct,
        warningKey: "", warning: "", warningTone: "neutral" as Tone, warningNegative: false,
      } as Split;
      if (!validFootballMarketSplit(storedSplit, sport, canonicalRows)) continue;
      trendPlays.push({ ...play, week: String(row.Week || play.week || storedFootballWeek(sport, play, canonicalRows)) });
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
  const validGames = games.filter((row) => {
    const probe = {
      date: canonicalScheduleDate(row), awayTeam: String(row["Away Team"] || ""), homeTeam: String(row["Home Team"] || ""),
    };
    return !!probe.date && !!canonicalGameRow(probe, sport, canonicalRows);
  });
  return { ok: true, sport, games: validGames, trendPlays, splits, updatedAt: nowET() };
}
