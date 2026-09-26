import {
  type FootballSport,
  type SheetRow,
  appendSportRows,
  ensureSportWorksheet,
  readSportWorksheet,
  readSportWorksheetByDateKeys,
  upsertSportRows,
  writeSportWorksheet,
} from "./sportSheets";
import {
  SCORES_AND_ODDS_SOURCE,
  assessScoresAndOddsMarketCoverage,
  type ScoresAndOddsMarketCoverage,
  loadScoresAndOddsConsensus,
} from "./scoresAndOddsBettingSplits";

export type WeeklyFootballMarket = "Spread" | "Total";
type Tone = "negative" | "caution" | "positive" | "neutral";
type ResultCode = "W" | "L" | "P";

const POSTED_GAMES_TAB = "posted_games";
const WEEKLY_TRENDS_TAB = "weekly_market_trends";
const MARKET_HISTORY_TAB = "odds_snapshot";
const SCORES_AND_ODDS_CUTOVER_DATE = "2026-09-21";
const FOOTBALL_TRACKING_LOOKAHEAD_DAYS = 7;

function isScoresAndOddsCutoverRow(row: SheetRow) {
  const date = canonicalScheduleDate(row) || String(row.Date || "").trim();
  const source = String(row.Source || "").trim();
  if (!date) return source !== SCORES_AND_ODDS_SOURCE;

  // The source transition is event-date based:
  // - games before 2026-09-21 retain their true pregame legacy snapshots;
  // - games on/after 2026-09-21 use ScoresAndOdds only.
  // This also rejects retroactive ScoresAndOdds consensus rows for games that
  // had already finished before the source switch.
  if (date < SCORES_AND_ODDS_CUTOVER_DATE) return source !== SCORES_AND_ODDS_SOURCE;
  return source === SCORES_AND_ODDS_SOURCE;
}

function isWeeklyTrendSourceRow(row: SheetRow, sport: FootballSport) {
  const date = canonicalScheduleDate(row) || String(row.Date || "").trim();
  const source = String(row.Source || "").trim();
  if (!date) return source !== SCORES_AND_ODDS_SOURCE;
  if (date >= SCORES_AND_ODDS_CUTOVER_DATE) return source === SCORES_AND_ODDS_SOURCE;
  if (source !== SCORES_AND_ODDS_SOURCE) return true;

  // Older NFL weekly rows were repaired before the source migration was fully
  // isolated, which could re-tag their Source while leaving the original
  // legacy game identity and full pregame history intact. Preserve those rows
  // and reject the retroactive ScoresAndOdds copy of the completed matchup.
  if (sport !== "NFL") return false;
  const away = nflMarketTeamCode(row["Away Team"]);
  const home = nflMarketTeamCode(row["Home Team"]);
  if (!away || !home) return false;
  const scoresAndOddsGameKey = `${date}|${textKey(away)}|${textKey(home)}`;
  return String(row["Game Key"] || "").trim() !== scoresAndOddsGameKey;
}

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
  "Source", "Source URL", "Details JSON",
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
  sourceUrl?: string;
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
  movementHistory?: Array<{
    snapshotTime: string;
    line: number | null;
    odds: string;
    betsPct: number;
    moneyPct: number;
  }>;
  movementVersion?: string;
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
  const twelveHour = raw.match(/(?:^|[,\s])(\d{1,2})(?::(\d{2}))\s*(AM|PM)\b/i);
  if (twelveHour) {
    return `${Number(twelveHour[1])}:${twelveHour[2]} ${twelveHour[3].toUpperCase()}`;
  }
  const twentyFourHour = raw.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (!twentyFourHour) return "";
  const hour24 = Number(twentyFourHour[1]);
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${twentyFourHour[2]} ${suffix}`;
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
    .replace(/<img\b[^>]*>/gi, " ")
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

function isWithinFootballTrackingWindow(date: string) {
  if (!date) return false;
  const start = Date.parse(`${todayET()}T12:00:00Z`);
  const target = Date.parse(`${date}T12:00:00Z`);
  return Number.isFinite(start) && Number.isFinite(target) &&
    target >= start &&
    target <= start + FOOTBALL_TRACKING_LOOKAHEAD_DAYS * 86_400_000;
}

function keepStoredFootballTrackingRow(row: SheetRow) {
  const date = canonicalScheduleDate(row) || String(row.Date || "").trim();
  if (!date) return true;
  return date <= todayET() || isWithinFootballTrackingWindow(date);
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

type LoadedPostedSplits = {
  splits: Split[];
  errors: string[];
  filter: {
    eventGroup: string;
    content: string;
    dateRange: string;
    label: string;
    source: string;
  };
  pagesScanned: number;
  pagesWithRows: number[];
  missingPages: number[];
  coverage: ScoresAndOddsMarketCoverage;
};

function coverageGameKey(
  sport: FootballSport,
  date: string,
  awayTeam: unknown,
  homeTeam: unknown,
) {
  if (sport === "NFL") {
    const away = nflMarketTeamCode(awayTeam);
    const home = nflMarketTeamCode(homeTeam);
    return date && away && home ? `${date}|${away}|${home}` : "";
  }
  const away = textKey(awayTeam);
  const home = textKey(homeTeam);
  return date && away && home ? `${date}|${away}|${home}` : "";
}

function rowEventTime(row: SheetRow) {
  return String(
    row["Game Time"] ||
    row["Game Time ET"] ||
    row["Kickoff Time"] ||
    row.Kickoff ||
    row.Time ||
    "",
  ).trim();
}

function expectedActiveGames(
  sport: FootballSport,
  rows: SheetRow[],
) {
  const expected = new Map<string, string>();
  const today = todayET();
  const currentWeek = footballWeekLabel(sport, today);
  const candidates: Array<{
    key: string;
    label: string;
    date: string;
    week: string;
  }> = [];
  for (const row of rows) {
    const date = canonicalScheduleDate(row);
    const awayTeam = String(row["Away Team"] || "").trim();
    const homeTeam = String(row["Home Team"] || "").trim();
    const key = coverageGameKey(sport, date, awayTeam, homeTeam);
    if (!key || !date || date < today || !isWithinFootballTrackingWindow(date)) continue;
    const minutes = sport === "NCAAF"
      ? ncaafMinutesUntilEvent(date, rowEventTime(row))
      : minutesUntilEvent(date, rowEventTime(row));
    // Missing same-day kickoff times cannot safely prove that a game is still pregame.
    if (date === today && (minutes == null || minutes <= 15)) continue;
    if (minutes != null && minutes <= 15) continue;
    candidates.push({
      key,
      label: `${awayTeam} @ ${homeTeam}`,
      date,
      week: footballWeekLabel(sport, date),
    });
  }

  // Stay on the current market week while any pregame matchup remains. After
  // the final kickoff, validate the nearest upcoming week instead of accepting
  // an empty expected slate until Tuesday.
  const activeWeek = candidates.some((game) => game.week === currentWeek)
    ? currentWeek
    : candidates.sort((left, right) => left.date.localeCompare(right.date))[0]?.week;
  for (const game of candidates) {
    if (game.week === activeWeek) expected.set(game.key, game.label);
  }
  return expected;
}

function assessScoresAndOddsCoverage(
  sport: FootballSport,
  splits: Split[],
  expectedRows: SheetRow[],
): ScoresAndOddsMarketCoverage {
  const expected = expectedActiveGames(sport, expectedRows);
  return assessScoresAndOddsMarketCoverage(
    expected,
    splits,
    (split) => coverageGameKey(sport, split.date, split.awayTeam, split.homeTeam),
    (split) => split.market,
    (split) => split.market === "Spread"
      ? sport === "NFL" ? nflMarketTeamCode(split.selectionTeam) : textKey(split.selectionTeam)
      : split.side,
  );
}

function coverageFailureMessage(report: ScoresAndOddsMarketCoverage) {
  const details = [
    report.expectedGames === 0 ? "no canonical pregame games were available for validation" : "",
    report.missingGames.length ? `missing ${report.missingGames.join(", ")}` : "",
    report.incompleteGames.length ? `incomplete ${report.incompleteGames.join(", ")}` : "",
  ].filter(Boolean).join("; ");
  return details || "the returned NFL slate could not be verified as complete";
}

async function loadPostedSplits(
  sport: FootballSport,
  canonicalRows: SheetRow[],
  existingGames: SheetRow[] = [],
  kickoffAuthorityRows: SheetRow[] = canonicalRows,
): Promise<LoadedPostedSplits> {
  const sourceSport = sport === "NCAAF" ? "NCAAF" : "NFL";
  const loaded = await loadScoresAndOddsConsensus(sourceSport);
  const errors: string[] = [];
  const expectedRows = [...existingGames, ...canonicalRows];
  const mapped: Split[] = [];
  const today = todayET();
  const todayStamp = Date.parse(`${today}T12:00:00Z`);

  function matchesSourceTeams(row: SheetRow, away: string, home: string) {
    if (sport === "NFL") {
      const rowAway = nflMarketTeamCode(row["Away Team"]);
      const rowHome = nflMarketTeamCode(row["Home Team"]);
      const sourceAway = nflMarketTeamCode(away);
      const sourceHome = nflMarketTeamCode(home);
      return !!rowAway && !!rowHome && !!sourceAway && !!sourceHome &&
        rowAway === sourceAway && rowHome === sourceHome;
    }
    return collegeMarketTeamMatch(row["Away Team"], away) &&
      collegeMarketTeamMatch(row["Home Team"], home);
  }

  const sourceMatchRows = sport === "NCAAF" ? kickoffAuthorityRows : canonicalRows;
  for (const source of loaded.splits) {
    if (source.market !== "Spread" && source.market !== "Total") continue;
    const candidates = sourceMatchRows
      .filter((row) =>
        matchesSourceTeams(row, source.awayTeam, source.homeTeam) &&
        isWithinFootballTrackingWindow(canonicalScheduleDate(row))
      )
      .map((row) => {
        const date = canonicalScheduleDate(row);
        const stamp = date ? Date.parse(`${date}T12:00:00Z`) : Number.NaN;
        return {
          row,
          date,
          distance: Number.isFinite(stamp) && Number.isFinite(todayStamp)
            ? Math.abs(stamp - todayStamp)
            : Number.POSITIVE_INFINITY,
        };
      })
      .filter((candidate) => candidate.date)
      .sort((left, right) => {
        if (sport === "NCAAF") {
          const leftReliable = Number.isFinite(ncaafKickoffEpoch(left.date, rowEventTime(left.row)));
          const rightReliable = Number.isFinite(ncaafKickoffEpoch(right.date, rowEventTime(right.row)));
          if (leftReliable !== rightReliable) return rightReliable ? 1 : -1;
        }
        return left.distance - right.distance;
      });
    const matched = candidates[0]?.row;
    if (!matched) continue;

    const awayTeam = String(matched["Away Team"] || source.awayTeam).trim();
    const homeTeam = String(matched["Home Team"] || source.homeTeam).trim();
    const selectionTeam = source.market === "Spread"
      ? sport === "NFL"
        ? nflMarketTeamCode(source.selectionTeam) === nflMarketTeamCode(source.awayTeam)
          ? awayTeam
          : nflMarketTeamCode(source.selectionTeam) === nflMarketTeamCode(source.homeTeam)
            ? homeTeam
            : source.selectionTeam
        : collegeMarketTeamMatch(source.selectionTeam, source.awayTeam)
          ? awayTeam
          : collegeMarketTeamMatch(source.selectionTeam, source.homeTeam)
            ? homeTeam
            : source.selectionTeam
      : "";
    const line = source.line;
    const warning = warningFor(source.betsPct, source.moneyPct);
    mapped.push({
      date: canonicalScheduleDate(matched),
      eventTime: rowEventTime(matched),
      game: `${awayTeam} @ ${homeTeam}`,
      awayTeam,
      homeTeam,
      market: source.market,
      selection: source.market === "Total"
        ? source.side
        : `${selectionTeam}${line == null ? "" : ` ${line > 0 ? "+" : ""}${line}`}`.trim(),
      selectionTeam,
      side: source.side,
      sideGroup: source.market === "Total"
        ? source.side
        : line != null && line < 0
          ? "Favorite"
          : line != null && line > 0
            ? "Underdog"
            : "",
      line,
      odds: source.odds,
      moneyPct: source.moneyPct,
      betsPct: source.betsPct,
      ...warning,
      sourceUrl: source.sourceUrl,
    });
  }

  const validated = mapped.filter((split) => validFootballMarketSplit(split, sport, canonicalRows));
  if (validated.length !== mapped.length) {
    errors.push(
      `Football validation rejected ${mapped.length - validated.length} malformed ${sport} ScoresAndOdds market sides.`,
    );
  }
  if (loaded.splits.length !== mapped.length) {
    errors.push(
      `ScoresAndOdds returned ${loaded.splits.length} parsed market sides; ${mapped.length} matched the current ${sport} canonical schedule before validation.`,
    );
  }

  const deduped = new Map<string, Split>();
  for (const split of validated) deduped.set(splitTrendKey(split), split);
  const splits = [...deduped.values()];
  const coverage = assessScoresAndOddsCoverage(sport, splits, expectedRows);
  const coverageAccepted = sport === "NFL" ? coverage.ok : splits.length > 0;
  if (!coverageAccepted) {
    const coverageFailure = sport === "NFL"
      ? coverageFailureMessage(coverage)
      : "no NCAAF market sides matched the tracked slate";
    throw new Error(
      `ScoresAndOdds ${sport} partial slate rejected: ${coverageFailure}. Received ${coverage.receivedGames} games and ${splits.length} market sides.`,
    );
  }

  return {
    splits,
    errors,
    filter: {
      eventGroup: sourceSport,
      content: "scoresandodds-consensus",
      dateRange: "current",
      label: `ScoresAndOdds ${sourceSport} Consensus`,
      source: "scoresandodds",
    },
    pagesScanned: 1,
    pagesWithRows: splits.length ? [1] : [],
    missingPages: [],
    coverage,
  };
}

export async function inspectPostedFootballMarkets(sport: FootballSport) {
  const [existingGames, allGameTrends, scheduleRows, slateRows] = await Promise.all([
    readSportWorksheet(sport, POSTED_GAMES_TAB, POSTED_GAME_HEADERS),
    readSportWorksheet(sport, "all_game_trends"),
    readSportWorksheet(sport, "schedule"),
    readSportWorksheet(sport, "daily_slate"),
  ]);
  const liveKickoffRows = sport === "NCAAF" ? await loadNcaafLiveKickoffAuthorityRows() : [];
  const kickoffAuthorityRows = [...liveKickoffRows, ...scheduleRows, ...slateRows];
  const canonicalRows = [...kickoffAuthorityRows, ...allGameTrends];
  const result = await loadPostedSplits(sport, canonicalRows, existingGames, kickoffAuthorityRows);
  const games = [...new Set(result.splits.map((split) => split.game))].sort();
  return {
    ok: true,
    dryRun: true,
    sport,
    filter: result.filter,
    coverage: result.coverage,
    pagesScanned: result.pagesScanned,
    pagesWithRows: result.pagesWithRows,
    missingPages: result.missingPages,
    games,
    marketSidesFound: result.splits.length,
    splits: result.splits.map((split) => ({
      date: split.date,
      game: split.game,
      market: split.market,
      selection: split.market === "Total" ? split.side : split.selectionTeam,
      line: split.line,
      odds: split.odds,
      betsPct: split.betsPct,
      handlePct: split.moneyPct,
    })),
    warnings: result.errors,
    checkedAt: nowET(),
  };
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

function indexMarketHistoryBySide(rows: SheetRow[]) {
  const index = new Map<string, SheetRow[]>();
  for (const row of rows) {
    const key = marketHistoryLogicalKey(row);
    const group = index.get(key) || [];
    group.push(row);
    index.set(key, group);
  }
  return index;
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
    Source: SCORES_AND_ODDS_SOURCE,
    "Source URL": split.sourceUrl || "https://www.scoresandodds.com",
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
    Source: SCORES_AND_ODDS_SOURCE,
    "Source URL": "https://www.scoresandodds.com",
    "State Signature": marketHistoryStateSignatureValues(line, odds, betsPct, handlePct),
  };
}

function historyLineLabel(market: WeeklyFootballMarket, line: number) {
  const value = Math.round(line * 10) / 10;
  return market === "Spread" && value > 0 ? `+${value}` : String(value);
}

function marketHistorySummary(split: Split, rows: SheetRow[]) {
  const key = splitTrendKey(split);
  const trackedStates = rows.filter((row) => marketHistoryLogicalKey(row) === key);
  if (!trackedStates.length) return null;

  // An immature 0%/100% ticket split is not a usable RLM baseline.
  // Start both bet-share and line
  // movement from the first real ticket-share snapshot so the two movements
  // are measured over the exact same window.
  const firstRealIndex = trackedStates.findIndex((row) => {
    const bets = Number(row["Bets %"]);
    return Number.isFinite(bets) && bets > 0 && bets < 100;
  });
  if (firstRealIndex < 0) return null;

  const states = trackedStates.slice(firstRealIndex);
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
  if (key.includes("strong reverse line movement support")) return "STRONG_REVERSE_LINE_MOVEMENT_SUPPORT";
  if (key.includes("reverse line movement support")) return "REVERSE_LINE_MOVEMENT_SUPPORT";
  if (key.includes("strong reverse line movement against")) return "STRONG_REVERSE_LINE_MOVEMENT_AGAINST";
  if (key.includes("reverse line movement against")) return "REVERSE_LINE_MOVEMENT_AGAINST";
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
      } catch { }
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
    return Number.isFinite(diff) && diff > 0 && diff <= days;
  });
}

function windows(rows: HistoryRow[], referenceDate: string): WindowRecords {
  const prior = rows.filter((row) => Boolean(row.date) && row.date < referenceDate);
  return { allTime: record(prior), last30: record(withinDays(prior, referenceDate, 30)), last7: record(withinDays(prior, referenceDate, 7)) };
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
const MAX_LOCK_FALLBACK_AGE_MINUTES = 18 * 60;
// DraftKings can remove a game from the splits table hours before kickoff.
// At lock, preserve the last real pregame snapshot instead of discarding it solely because DK stopped publishing it.

function storedSnapshotEpoch(value: unknown) {
  return Date.parse(String(value || "").trim().replace(/ EDT$/, " -0400").replace(/ EST$/, " -0500"));
}

function ncaafWallClockEpoch(date: string, hour: number, minute: number) {
  const [year, month, day] = date.split("-").map(Number);
  const wallClock = Date.UTC(year, month - 1, day, hour, minute);
  let epoch = wallClock;
  // Resolve an ET wall clock using the offset on the game date, including DST.
  for (let pass = 0; pass < 2; pass++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(epoch));
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    const local = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
    epoch += wallClock - local;
  }
  return epoch;
}

function ncaafKickoffEpoch(date: string, eventTime: string) {
  const raw = String(eventTime || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Number.NaN;

  // Full source timestamps sometimes carry the prior slate's calendar date.
  // Keep the ET kickoff clock, but bind it to the canonical stored game date so
  // a future game can never be finalized from yesterday's timestamp.
  if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
    const parsed = Date.parse(raw);
    if (!Number.isFinite(parsed)) return Number.NaN;
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(parsed));
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    const sourceDate = `${get("year")}-${String(get("month")).padStart(2, "0")}-${String(get("day")).padStart(2, "0")}`;
    const hour = get("hour");
    const minute = get("minute");
    // 00:00 is the builder's unknown-time placeholder for many CFB rows.
    // It must never be interpreted as a real kickoff or trigger a final lock.
    if (hour === 0 && minute === 0) return Number.NaN;
    if (sourceDate === date) return parsed;
    return ncaafWallClockEpoch(date, hour, minute);
  }

  const twelve = raw.match(/^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?\s*(AM|PM)(?:\s+(?:ET|EDT|EST))?$/i);
  const clock = raw.match(/^(?:\d{4}-\d{2}-\d{2}T)?([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?(?:\s+(?:ET|EDT|EST))?$/i);
  if (!twelve && !clock) return Number.NaN;
  if (twelve && (Number(twelve[1]) < 1 || Number(twelve[1]) > 12)) return Number.NaN;
  const hour = twelve ? Number(twelve[1]) % 12 + (twelve[3].toUpperCase() === "PM" ? 12 : 0) : Number(clock![1]);
  const minute = Number((twelve || clock)![2]);
  if (hour === 0 && minute === 0) return Number.NaN;
  return ncaafWallClockEpoch(date, hour, minute);
}
function ncaafMinutesUntilEvent(date: string, eventTime: string) {
  const kickoff = ncaafKickoffEpoch(date, eventTime);
  return Number.isFinite(kickoff) ? (kickoff - Date.now()) / 60_000 : null;
}

function ncaafAuthoritativeGameTime(
  play: Pick<WeeklyTrendPlay, "date" | "gameTime" | "awayTeam" | "homeTeam">,
  rows: SheetRow[],
) {
  const matches = rows.filter((row) =>
    canonicalScheduleDate(row) === play.date &&
    collegeMarketTeamMatch(row["Away Team"], play.awayTeam) &&
    collegeMarketTeamMatch(row["Home Team"], play.homeTeam)
  );
  for (const row of matches) {
    const eventTime = rowEventTime(row);
    if (Number.isFinite(ncaafKickoffEpoch(play.date, eventTime))) return eventTime;
  }
  // A current/future game without a verified canonical kickoff must remain
  // live. Never fall back to a stale kickoff saved on an older market row.
  return play.date >= todayET() ? "" : play.gameTime;
}

async function loadNcaafLiveKickoffAuthorityRows(): Promise<SheetRow[]> {
  if (typeof fetch !== "function") return [];
  const targetDate = todayET();
  const url = new URL("https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard");
  url.searchParams.set("dates", targetDate.replace(/-/g, ""));
  url.searchParams.set("groups", "80");
  url.searchParams.set("limit", "1000");

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return [];
    const payload = await response.json() as any;
    const rows: SheetRow[] = [];
    for (const event of Array.isArray(payload?.events) ? payload.events : []) {
      const competition = Array.isArray(event?.competitions) ? event.competitions[0] : null;
      if (!competition) continue;
      const rawKickoff = String(competition?.date || event?.date || "").trim();
      const parsed = Date.parse(rawKickoff);
      if (!Number.isFinite(parsed)) continue;
      const dateParts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(new Date(parsed));
      const get = (type: string) => dateParts.find((part) => part.type === type)?.value || "";
      const eventDate = `${get("year")}-${get("month")}-${get("day")}`;
      if (eventDate !== targetDate) continue;

      const competitors = Array.isArray(competition?.competitors) ? competition.competitors : [];
      const away = competitors.find((entry: any) => String(entry?.homeAway || "").toLowerCase() === "away");
      const home = competitors.find((entry: any) => String(entry?.homeAway || "").toLowerCase() === "home");
      const teamName = (entry: any) => String(
        entry?.team?.displayName || entry?.team?.shortDisplayName || entry?.team?.name || "",
      ).trim();
      const awayTeam = teamName(away);
      const homeTeam = teamName(home);
      if (!awayTeam || !homeTeam) continue;

      rows.push({
        Date: eventDate,
        "Game Time": rawKickoff,
        Game: `${awayTeam} @ ${homeTeam}`,
        "Away Team": awayTeam,
        "Home Team": homeTeam,
      });
    }
    return rows;
  } catch {
    return [];
  }
}

function ncaafDisplayGameTime(
  play: Pick<WeeklyTrendPlay, "date" | "gameTime" | "awayTeam" | "homeTeam">,
  authorityRows: SheetRow[],
  fallbackRows: SheetRow[] = [],
) {
  const authoritative = ncaafAuthoritativeGameTime(play, authorityRows);
  if (authoritative) return authoritative;

  // Lock/finalization must only trust schedule/slate rows, but the UI can still
  // show a same-day kickoff recovered from stored market/model rows. This keeps
  // display metadata intact without letting a stale display time finalize a game.
  const matches = fallbackRows.filter((row) =>
    canonicalScheduleDate(row) === play.date &&
    collegeMarketTeamMatch(row["Away Team"], play.awayTeam) &&
    collegeMarketTeamMatch(row["Home Team"], play.homeTeam)
  ).reverse();
  for (const row of matches) {
    const eventTime = rowEventTime(row);
    if (Number.isFinite(ncaafKickoffEpoch(play.date, eventTime))) return eventTime;
  }

  return play.gameTime;
}

function ncaafHistoryForPlay(play: WeeklyTrendPlay, rows: SheetRow[]) {
  const end = storedSnapshotEpoch(play.snapshotStatus === "FINAL_PREGAME" ? play.frozenAt || play.updatedAt : play.updatedAt);
  return rows.filter((row) => {
    const rowDate = canonicalScheduleDate(row) || String(row.Date || "").trim();
    const stamp = storedSnapshotEpoch(row["Snapshot Time ET"]);
    return rowDate === play.date && Number.isFinite(stamp) && Number.isFinite(end) && stamp <= end;
  }).sort((a, b) => storedSnapshotEpoch(a["Snapshot Time ET"]) - storedSnapshotEpoch(b["Snapshot Time ET"]));
}
function resolveNcaafSnapshot(play: WeeklyTrendPlay, rows: SheetRow[], history: HistoryRow[]): WeeklyTrendPlay {
  if (play.date < SCORES_AND_ODDS_CUTOVER_DATE) return play;
  const kickoff = ncaafKickoffEpoch(play.date, play.gameTime);
  if (!Number.isFinite(kickoff)) {
    if (play.date < todayET()) {
      return play.snapshotStatus === "FINAL_PREGAME"
        ? play
        : { ...play, snapshotStatus: "MISSED_LOCK", frozenAt: undefined, lockWarning: "Kickoff time unavailable; final snapshot cannot be verified." };
    }
    const candidates = rows.filter((row) => {
      const rowDate = canonicalScheduleDate(row) || String(row.Date || "").trim();
      const stamp = storedSnapshotEpoch(row["Snapshot Time ET"]);
      return rowDate === play.date && Number.isFinite(stamp) && stamp <= Date.now() &&
        String(row["Bets %"] ?? "").trim() !== "" && String(row["Handle %"] ?? "").trim() !== "" &&
        Number.isFinite(Number(row["Bets %"])) && Number.isFinite(Number(row["Handle %"]));
    }).sort((a, b) => storedSnapshotEpoch(a["Snapshot Time ET"]) - storedSnapshotEpoch(b["Snapshot Time ET"]));
    const latest = candidates[candidates.length - 1];
    if (!latest) {
      return {
        ...play,
        snapshotStatus: "LIVE",
        frozenAt: undefined,
        lockWarning: "Kickoff time is not verified yet; snapshot remains live.",
      };
    }
    const line = numericLine(latest.Line);
    const betsPct = Number(latest["Bets %"]);
    const moneyPct = Number(latest["Handle %"]);
    const split: Split = {
      ...play,
      eventTime: play.gameTime,
      line,
      odds: String(latest.Odds || ""),
      betsPct,
      moneyPct,
      sideGroup: play.market === "Total" ? play.side : line != null && line < 0 ? "Favorite" : line != null && line > 0 ? "Underdog" : "",
      ...warningFor(betsPct, moneyPct),
    };
    const rebuilt = buildPlay(split, undefined, history, candidates);
    return {
      ...rebuilt,
      week: play.week,
      updatedAt: String(latest["Snapshot Time ET"]),
      snapshotStatus: "LIVE",
      frozenAt: undefined,
      lockWarning: "Kickoff time is not verified yet; snapshot remains live.",
    };
  }
  const cutoff = kickoff - 15 * 60_000;
  const locked = Date.now() >= cutoff;
  const frozen = storedSnapshotEpoch(play.frozenAt || play.updatedAt);
  // Preserve genuine pregame locks, but repair the old midnight/UTC-offset locks.
  if (locked && play.snapshotStatus === "FINAL_PREGAME" &&
      frozen >= kickoff - MAX_MISSED_LOCK_FRESHNESS_MINUTES * 60_000 && frozen < kickoff) {
    return { ...play, updatedAt: play.frozenAt || play.updatedAt };
  }
  const end = locked ? cutoff : Date.now();
  const candidates = rows.filter((row) => {
    const rowDate = canonicalScheduleDate(row) || String(row.Date || "").trim();
    const stamp = storedSnapshotEpoch(row["Snapshot Time ET"]);
    return rowDate === play.date && Number.isFinite(stamp) && stamp <= end &&
      String(row["Bets %"] ?? "").trim() !== "" && String(row["Handle %"] ?? "").trim() !== "" &&
      Number.isFinite(Number(row["Bets %"])) && Number.isFinite(Number(row["Handle %"]));
  }).sort((a, b) => storedSnapshotEpoch(a["Snapshot Time ET"]) - storedSnapshotEpoch(b["Snapshot Time ET"]));
  const latest = candidates[candidates.length - 1];
  if (!latest) {
    return { ...play, snapshotStatus: "MISSED_LOCK", frozenAt: undefined, lockWarning: "No verified snapshot available before the pregame cutoff." };
  }
  const line = numericLine(latest.Line);
  const betsPct = Number(latest["Bets %"]);
  const moneyPct = Number(latest["Handle %"]);
  const split: Split = {
    ...play, eventTime: play.gameTime, line, odds: String(latest.Odds || ""), betsPct, moneyPct,
    sideGroup: play.market === "Total" ? play.side : line != null && line < 0 ? "Favorite" : line != null && line > 0 ? "Underdog" : "",
    ...warningFor(betsPct, moneyPct),
  };
  const rebuilt = buildPlay(split, undefined, history, candidates);
  const updatedAt = String(latest["Snapshot Time ET"]);
  const missed = locked && storedSnapshotEpoch(updatedAt) < kickoff - MAX_MISSED_LOCK_FRESHNESS_MINUTES * 60_000;
  return {
    ...rebuilt, week: play.week, updatedAt,
    snapshotStatus: !locked ? "LIVE" : missed ? "MISSED_LOCK" : "FINAL_PREGAME",
    frozenAt: locked && !missed ? updatedAt : undefined,
    lockWarning: missed ? `Lock capture missed — last verified ${updatedAt}.` : undefined,
  };
}

function minutesUntilEvent(date: string, eventTime: string) {
  if (!date || !eventTime) return null;

  const raw = String(eventTime).trim();
  const twelveHour = raw.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  let hour: number;
  let minute: number;

  if (twelveHour) {
    hour = Number(twelveHour[1]) % 12;
    if (twelveHour[3].toUpperCase() === "PM") hour += 12;
    minute = Number(twelveHour[2]);
  } else {
    const twentyFourHour = raw.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    if (!twentyFourHour) return null;
    hour = Number(twentyFourHour[1]);
    minute = Number(twentyFourHour[2]);
  }

  const [year, month, day] = date.split("-").map(Number);
  const kickoff = Date.UTC(year, month - 1, day, hour, minute);
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

const SELECTED_SIDE_MOVEMENT_VERSION = "football-selected-side-v2";

function selectedSideLineMove(
  market: WeeklyFootballMarket,
  side: unknown,
  fromLine: number,
  toLine: number,
) {
  const rawMove = toLine - fromLine;
  if (market === "Spread") return Math.round(-rawMove * 10) / 10;
  const totalSide = textKey(side);
  return Math.round((totalSide.startsWith("under") ? -rawMove : rawMove) * 10) / 10;
}

function selectedSideRawLineDelta(
  market: WeeklyFootballMarket,
  side: unknown,
  rawDelta: number,
) {
  if (market === "Spread") return Math.round(-rawDelta * 10) / 10;
  return Math.round((textKey(side).startsWith("under") ? -rawDelta : rawDelta) * 10) / 10;
}

function movementThresholds(basis: string) {
  return basis === "Implied Probability"
    ? { standard: 1.5, strong: 3 }
    : { standard: 0.5, strong: 1 };
}

function classifySelectedSideMovement(
  publicMovementPct: number,
  lineMovementValue: number | null,
  basis: string,
) {
  if (lineMovementValue == null) {
    return { lineMovementSignal: "", lineMovementTone: "" as Tone | "" };
  }
  const thresholds = movementThresholds(basis);
  const opposite =
    Math.abs(publicMovementPct) >= 5 &&
    publicMovementPct * lineMovementValue < 0 &&
    Math.abs(lineMovementValue) >= thresholds.standard;
  if (opposite) {
    const isStrong =
      Math.abs(publicMovementPct) >= 10 &&
      Math.abs(lineMovementValue) >= thresholds.strong;
    const support = lineMovementValue > 0;
    return {
      lineMovementSignal: support
        ? isStrong
          ? "Strong Reverse Line Movement Support"
          : "Reverse Line Movement Support"
        : isStrong
          ? "Strong Reverse Line Movement Against"
          : "Reverse Line Movement Against",
      lineMovementTone: (support ? "positive" : "negative") as Tone,
    };
  }
  return lineMovementValue > 0
    ? { lineMovementSignal: "Line Movement Confirmation", lineMovementTone: "positive" as Tone }
    : { lineMovementSignal: "Adverse Line Movement", lineMovementTone: "negative" as Tone };
}

function movement(split: Split, existing: SheetRow | undefined, marketRows: SheetRow[]) {
  const summary = marketHistorySummary(split, marketRows);
  const openingLine = summary?.openingLine ?? (existing ? numericLine(existing["Opening Line"]) ?? split.line : split.line);
  const openingOdds = summary?.openingOdds || String(existing?.["Opening Odds"] || split.odds);
  const openingBetsPct = summary?.openingBetsPct ?? existingNumber(existing, "Opening Bets %", split.betsPct);
  const openingMoneyPct = summary?.openingMoneyPct ?? existingNumber(existing, "Opening Handle %", split.moneyPct);
  const usableRlmOpening = Number.isFinite(openingBetsPct) && openingBetsPct > 0 && openingBetsPct < 100;
  const publicMovementPct = usableRlmOpening
    ? Math.round((split.betsPct - openingBetsPct) * 10) / 10
    : 0;
  const sharpMovementPct = Math.round((split.moneyPct - openingMoneyPct) * 10) / 10;
  const openingImpliedPct = impliedPct(openingOdds);
  const currentImpliedPct = impliedPct(split.odds);
  let lineMovementBasis = "";
  let lineMovementValue: number | null = null;

  if (openingLine != null && split.line != null && Math.abs(split.line - openingLine) >= .5) {
    lineMovementBasis = split.market === "Total" ? "Total Line" : "Spread Line";
    lineMovementValue = selectedSideLineMove(split.market, split.side, openingLine, split.line);
  } else if (summary?.lineMoveCount && summary.lastLineMoveDelta != null) {
    lineMovementBasis = split.market === "Total" ? "Total Line History" : "Spread Line History";
    lineMovementValue = selectedSideRawLineDelta(split.market, split.side, summary.lastLineMoveDelta);
  } else if (openingImpliedPct != null && currentImpliedPct != null && Math.abs(currentImpliedPct - openingImpliedPct) >= 1.5) {
    lineMovementBasis = "Implied Probability";
    lineMovementValue = Math.round((currentImpliedPct - openingImpliedPct) * 10) / 10;
  }

  const classification = usableRlmOpening
    ? classifySelectedSideMovement(
        publicMovementPct,
        lineMovementValue,
        lineMovementBasis,
      )
    : { lineMovementSignal: "", lineMovementTone: "" as Tone | "" };
  return {
    openingLine, openingOdds, openingBetsPct, openingMoneyPct, publicMovementPct, sharpMovementPct,
    openingImpliedPct, currentImpliedPct, lineMovementBasis, lineMovementValue,
    ...classification,
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
    movementVersion: SELECTED_SIDE_MOVEMENT_VERSION,
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


function finiteStoredNumber(value: unknown) {
  if (value == null || String(value).trim() === "") return null;
  const number = Number(String(value).replace("%", ""));
  return Number.isFinite(number) ? number : null;
}

function historicalLineMoveFromLabel(
  market: WeeklyFootballMarket,
  side: unknown,
  label: unknown,
) {
  const lines = String(label || "")
    .split("→")
    .map((part) => numericLine(part))
    .filter((line): line is number => line != null);
  if (lines.length < 2) return null;
  return selectedSideLineMove(market, side, lines[lines.length - 2], lines[lines.length - 1]);
}

function correctedStoredMovement(row: SheetRow, details: Record<string, any>) {
  const marketText = String(row.Market || details.market || "").trim();
  const market: WeeklyFootballMarket | null =
    marketText === "Spread" ? "Spread" : marketText === "Total" ? "Total" : null;
  if (!market) return null;
  const side = market === "Total"
    ? String(row.Side || row.Selection || details.side || details.selection || "")
    : "";
  const currentLine = numericLine(
    row["Public Split Line"] || row.Line || details.line,
  );
  const openingLine = numericLine(
    row["Opening Public Split Line"] ||
    row["Opening Line"] ||
    details.openingLine,
  );
  const openingBets = finiteStoredNumber(
    row["Opening Public %"] ??
    row["Opening Bets %"] ??
    details.openingBetsPct,
  );
  const currentBets = finiteStoredNumber(
    row["Current Public %"] ??
    row["Public Bets %"] ??
    row["Current Bets %"] ??
    details.betsPct,
  );
  const storedPublicMove = finiteStoredNumber(
    row["Public Change %"] ??
    row["Bets Change %"] ??
    details.publicMovementPct,
  );
  const publicMovementPct = storedPublicMove ??
    (openingBets != null && currentBets != null
      ? Math.round((currentBets - openingBets) * 10) / 10
      : 0);

  const storedBasis = String(
    row["Line Movement Basis"] || details.lineMovementBasis || "",
  );
  const storedValue = finiteStoredNumber(
    row["Line Movement Value"] ?? details.lineMovementValue,
  );
  let lineMovementBasis = "";
  let lineMovementValue: number | null = null;

  if (
    openingLine != null &&
    currentLine != null &&
    Math.abs(currentLine - openingLine) >= 0.5
  ) {
    lineMovementBasis = market === "Total" ? "Total Line" : "Spread Line";
    lineMovementValue = selectedSideLineMove(market, side, openingLine, currentLine);
  } else {
    const historyValue = historicalLineMoveFromLabel(
      market,
      side,
      details.lineHistoryLabel,
    );
    if (historyValue != null && Math.abs(historyValue) >= 0.5) {
      lineMovementBasis = market === "Total" ? "Total Line History" : "Spread Line History";
      lineMovementValue = historyValue;
    } else if (storedBasis.includes("Line") && storedValue != null) {
      lineMovementBasis = storedBasis;
      lineMovementValue =
        details.movementVersion === SELECTED_SIDE_MOVEMENT_VERSION
          ? storedValue
          : selectedSideRawLineDelta(market, side, storedValue);
    }
  }

  const openingImpliedPct = finiteStoredNumber(
    row["Opening Implied %"] ?? details.openingImpliedPct,
  ) ?? impliedPct(
    row["Opening Public Split Odds"] ||
    row["Opening Odds"] ||
    details.openingOdds,
  );
  const currentImpliedPct = finiteStoredNumber(
    row["Current Implied %"] ?? details.currentImpliedPct,
  ) ?? impliedPct(
    row["Public Split Odds"] ||
    row.Odds ||
    details.odds,
  );

  if (
    lineMovementValue == null &&
    openingImpliedPct != null &&
    currentImpliedPct != null &&
    Math.abs(currentImpliedPct - openingImpliedPct) >= 1.5
  ) {
    lineMovementBasis = "Implied Probability";
    lineMovementValue = Math.round((currentImpliedPct - openingImpliedPct) * 10) / 10;
  }

  const classification = classifySelectedSideMovement(
    publicMovementPct,
    lineMovementValue,
    lineMovementBasis,
  );
  return {
    market,
    side,
    openingLine,
    currentLine,
    publicMovementPct,
    lineMovementBasis,
    lineMovementValue,
    ...classification,
  };
}

function repairedTrendDetails(
  details: Record<string, any>,
  movementState: NonNullable<ReturnType<typeof correctedStoredMovement>>,
) {
  const originalSignals = Array.isArray(details.signals) ? details.signals : [];
  let replaced = false;
  const signals = originalSignals.flatMap((signal: any) => {
    if (String(signal?.signalType || "") !== "Line Movement") return [signal];
    replaced = true;
    if (!movementState.lineMovementSignal) return [];
    return [{
      ...signal,
      signalType: "Line Movement",
      signalKey: movementSignalKey(movementState.lineMovementSignal),
      signal: movementState.lineMovementSignal,
      tone: movementState.lineMovementTone || signal.tone || "neutral",
    }];
  });
  if (movementState.lineMovementSignal && !replaced) {
    signals.push({
      signalType: "Line Movement",
      signalKey: movementSignalKey(movementState.lineMovementSignal),
      signal: movementState.lineMovementSignal,
      tone: movementState.lineMovementTone || "neutral",
    });
  }
  return {
    ...details,
    publicMovementPct: movementState.publicMovementPct,
    lineMovementBasis: movementState.lineMovementBasis,
    lineMovementValue: movementState.lineMovementValue,
    lineMovementSignal: movementState.lineMovementSignal,
    movementVersion: SELECTED_SIDE_MOVEMENT_VERSION,
    signals,
  };
}

function repairAllGameTrendMovementRows(rows: SheetRow[]) {
  let changed = 0;
  const repaired = rows.map((row) => {
    const raw = String(row["Trend Score Details"] || "").trim();
    let details: Record<string, any> = {};
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) details = parsed;
      } catch {}
    }
    const movementState = correctedStoredMovement(row, details);
    if (!movementState) return row;

    const nextDetails = raw ? repairedTrendDetails(details, movementState) : details;
    const nextSignals = Array.isArray(nextDetails.signals)
      ? nextDetails.signals.map((signal: any) => String(signal?.signal || "")).filter(Boolean).join(" | ")
      : String(row["Trend Signals"] || "");
    const next: SheetRow = {
      ...row,
      "Public Change %": String(movementState.publicMovementPct),
      "Line Movement Signal": movementState.lineMovementSignal,
      "Line Movement Tone": movementState.lineMovementTone,
      "Line Movement Basis": movementState.lineMovementBasis,
      "Line Movement Value": movementState.lineMovementValue == null ? "" : String(movementState.lineMovementValue),
      "Trend Signals": nextSignals,
      "Trend Score Details": raw ? JSON.stringify(nextDetails) : raw,
    };
    const keys = [
      "Public Change %", "Line Movement Signal", "Line Movement Tone",
      "Line Movement Basis", "Line Movement Value", "Trend Signals", "Trend Score Details",
    ];
    if (keys.some((key) => String(next[key] || "") !== String(row[key] || ""))) changed += 1;
    return next;
  });
  return { rows: repaired, changed };
}

function repairWeeklyTrendRows(rows: SheetRow[], history: HistoryRow[]) {
  const candidates: WeeklyTrendPlay[] = [];
  const sourceByKey = new Map<string, SheetRow>();
  for (const row of rows) {
    const raw = String(row["Details JSON"] || "").trim();
    if (!raw) continue;
    try {
      const play = JSON.parse(raw) as WeeklyTrendPlay;
      const pseudoRow: SheetRow = {
        Market: play.market,
        Selection: play.selection,
        Side: play.side,
        Line: play.line == null ? "" : String(play.line),
        Odds: play.odds,
        "Public Split Line": play.line == null ? "" : String(play.line),
        "Public Split Odds": play.odds,
        "Opening Public Split Line": play.openingLine == null ? "" : String(play.openingLine),
        "Opening Public Split Odds": play.openingOdds || play.odds,
        "Opening Public %": String(play.openingBetsPct ?? play.betsPct),
        "Current Public %": String(play.betsPct),
        "Public Change %": String(play.publicMovementPct ?? 0),
        "Opening Implied %": play.openingImpliedPct == null ? "" : String(play.openingImpliedPct),
        "Current Implied %": play.currentImpliedPct == null ? "" : String(play.currentImpliedPct),
        "Line Movement Basis": String(play.lineMovementBasis || ""),
        "Line Movement Value": play.lineMovementValue == null ? "" : String(play.lineMovementValue),
      };
      const movementState = correctedStoredMovement(pseudoRow, play as Record<string, any>);
      if (!movementState) continue;
      const primaryWarning = warningFor(play.betsPct, play.moneyPct);
      const signals: Signal[] = [
        signalBreakdown(
          primaryWarning.warningKey,
          primaryWarning.warning,
          primaryWarning.warningTone,
          play.market,
          play.sideGroup,
          history,
          play.date,
        ),
      ];
      if (movementState.lineMovementSignal) {
        const lineSignal = signalBreakdown(
          movementSignalKey(movementState.lineMovementSignal),
          movementState.lineMovementSignal,
          movementState.lineMovementTone === "positive" ? "positive" : "negative",
          play.market,
          play.sideGroup,
          history,
          play.date,
        );
        signals.push({ ...lineSignal, signalType: "Line Movement" });
      }
      const withHistory = signals.filter((signal) => signal.records.allTime.totalBets > 0);
      const baseScore = Math.round(
        withHistory.length
          ? withHistory.reduce((sum, signal) => sum + signal.score, 0) / withHistory.length
          : 50,
      );
      const repairedPlay = {
        ...play,
        publicMovementPct: movementState.publicMovementPct,
        lineMovementBasis: movementState.lineMovementBasis,
        lineMovementValue: movementState.lineMovementValue,
        lineMovementSignal: movementState.lineMovementSignal,
        movementVersion: SELECTED_SIDE_MOVEMENT_VERSION,
        signals,
        baseScore,
        score: baseScore,
        tier: "Pass" as const,
      };
      candidates.push(repairedPlay);
      sourceByKey.set(trendKey(weeklyRow(repairedPlay)), row);
    } catch {}
  }
  if (!candidates.length) return { rows, changed: 0 };

  const scored = headToHead(candidates);
  const scoredByKey = new Map(scored.map((play) => [trendKey(weeklyRow(play)), play]));
  let changed = 0;
  const repairedRows = rows.map((row) => {
    const play = scoredByKey.get(trendKey(row));
    if (!play) return row;
    const next = { ...row, ...weeklyRow(play) };
    // Repair scoring/movement fields without rewriting the historical source
    // identity of pre-cutover rows.
    if (String(row.Source || "").trim()) next.Source = row.Source;
    if (String(row["Source URL"] || "").trim()) next["Source URL"] = row["Source URL"];
    if (
      String(next["Details JSON"] || "") !== String(row["Details JSON"] || "") ||
      String(next["Line Movement Signal"] || "") !== String(row["Line Movement Signal"] || "") ||
      String(next["Trend Score"] || "") !== String(row["Trend Score"] || "") ||
      String(next["Trend Tier"] || "") !== String(row["Trend Tier"] || "")
    ) changed += 1;
    return next;
  });
  return { rows: repairedRows, changed };
}

function allRowHeaders(rows: SheetRow[]) {
  const headers: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (seen.has(key)) continue;
      seen.add(key);
      headers.push(key);
    }
  }
  return headers;
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
    Source: SCORES_AND_ODDS_SOURCE,
    "Source URL": "https://www.scoresandodds.com",
    "Details JSON": JSON.stringify(play),
  };
}

export async function syncPostedFootballMarkets(sport: FootballSport) {
  await Promise.all([
    ensureSportWorksheet(sport, POSTED_GAMES_TAB, POSTED_GAME_HEADERS),
    ensureSportWorksheet(sport, WEEKLY_TRENDS_TAB, WEEKLY_TREND_HEADERS),
    ensureSportWorksheet(sport, MARKET_HISTORY_TAB, MARKET_HISTORY_HEADERS),
  ]);
  const [existingGames, existingTrends, allGameTrends, scheduleRows, slateRows] = await Promise.all([
    readSportWorksheet(sport, POSTED_GAMES_TAB, POSTED_GAME_HEADERS),
    readSportWorksheet(sport, WEEKLY_TRENDS_TAB, WEEKLY_TREND_HEADERS),
    readSportWorksheet(sport, "all_game_trends"),
    readSportWorksheet(sport, "schedule"),
    readSportWorksheet(sport, "daily_slate"),
  ]);
  const sourceFilteredExistingGames = existingGames.filter(
    (row) => isScoresAndOddsCutoverRow(row) && keepStoredFootballTrackingRow(row),
  );
  const removedLegacyGameRows = existingGames.length - sourceFilteredExistingGames.length;
  const sourceFilteredExistingTrends = existingTrends.filter(
    (row) => isWeeklyTrendSourceRow(row, sport) && keepStoredFootballTrackingRow(row),
  );
  const removedLegacyTrendRows = existingTrends.length - sourceFilteredExistingTrends.length;
  const allGameRepair = sport === "NFL"
    ? repairAllGameTrendMovementRows(allGameTrends)
    : { rows: allGameTrends, changed: 0 };
  const effectiveAllGameTrends = allGameRepair.rows;
  if (allGameRepair.changed) {
    const headers = allRowHeaders(effectiveAllGameTrends);
    if (headers.length) {
      await writeSportWorksheet(sport, "all_game_trends", headers, effectiveAllGameTrends);
    }
  }
  const repairedHistory = historyFromAllGameTrends(effectiveAllGameTrends);
  const weeklyRepair = sport === "NFL"
    ? repairWeeklyTrendRows(sourceFilteredExistingTrends, repairedHistory)
    : { rows: sourceFilteredExistingTrends, changed: 0 };
  const effectiveExistingTrends = weeklyRepair.rows;
  if (weeklyRepair.changed || removedLegacyTrendRows > 0) {
    await writeSportWorksheet(sport, WEEKLY_TRENDS_TAB, WEEKLY_TREND_HEADERS, effectiveExistingTrends);
  }
  if (removedLegacyGameRows > 0) {
    await writeSportWorksheet(sport, POSTED_GAMES_TAB, POSTED_GAME_HEADERS, sourceFilteredExistingGames);
  }

  const liveKickoffRows = sport === "NCAAF" ? await loadNcaafLiveKickoffAuthorityRows() : [];
  const kickoffAuthorityRows = [...liveKickoffRows, ...scheduleRows, ...slateRows];
  const canonicalRows = [...kickoffAuthorityRows, ...effectiveAllGameTrends];
  // A partial ScoresAndOdds response must fail before any market/snapshot writes occur.
  const dk = await loadPostedSplits(sport, canonicalRows, sourceFilteredExistingGames, kickoffAuthorityRows);
  const activeSourceSplits = dk.splits.filter(
    (split) => split.date >= SCORES_AND_ODDS_CUTOVER_DATE,
  );
  const activeMarketDates = [...new Set([
    ...activeSourceSplits.map((split) => split.date),
    // Retained NCAAF games need their own history even after leaving the feed.
    ...(sport === "NCAAF" ? effectiveExistingTrends.map((row) => canonicalScheduleDate(row))
      .filter((date) => date >= SCORES_AND_ODDS_CUTOVER_DATE) : []),
  ].filter(Boolean))];
  const existingMarketHistory = activeMarketDates.length
    ? (await readSportWorksheetByDateKeys(sport, MARKET_HISTORY_TAB, activeMarketDates, MARKET_HISTORY_HEADERS))
        .filter((row) => String(row.Source || "").trim() === SCORES_AND_ODDS_SOURCE)
    : [];
  const now = nowET();
  const gameMap = new Map(sourceFilteredExistingGames.map((row) => [postedGameKey(row), row]));
  const postedRows: SheetRow[] = [];
  const uniqueGames = new Map<string, Split>();
  for (const split of activeSourceSplits) if (!uniqueGames.has(gameKey(split))) uniqueGames.set(gameKey(split), split);
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
      Source: SCORES_AND_ODDS_SOURCE,
      "Source URL": split.sourceUrl || "https://www.scoresandodds.com",
    });
  }
  if (postedRows.length) await upsertSportRows(sport, POSTED_GAMES_TAB, POSTED_GAME_HEADERS, postedRows, postedGameKey);

  const existingTrendMap = new Map(effectiveExistingTrends.map((row) => [trendKey(row), row]));
  const history = repairedHistory;

  const marketHistoryRows = [...existingMarketHistory];
  const marketHistoryRowsToAppend: SheetRow[] = [];
  const postedStateRows = [...sourceFilteredExistingGames, ...postedRows];
  const firstSeenByGame = new Map(postedStateRows.map((row) => [String(row["Game Key"] || ""), String(row["First Seen"] || now)]));

  for (const split of activeSourceSplits) {
    if (sport === "NCAAF") {
      const minutes = ncaafMinutesUntilEvent(split.date, split.eventTime);
      // Freeze only when a verified kickoff reaches T-15. Unknown/placeholder
      // kickoff times must keep collecting live snapshots until a real time is available.
      if (minutes != null && minutes <= 15) continue;
    }
    const current = marketHistoryRowForSplit(split, sport, canonicalRows, now);
    marketHistoryRows.push(current);
    marketHistoryRowsToAppend.push(current);
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
  const ncaafHistory = sport === "NCAAF" ? indexMarketHistoryBySide(marketHistoryRows) : new Map<string, SheetRow[]>();
  const ncaafCanonicalHistory = sport === "NCAAF"
    ? indexNcaafMarketHistoryByCanonicalSide(marketHistoryRows, canonicalRows)
    : new Map<string, SheetRow[]>();
  const canonicalNcaafSideHistory = (play: WeeklyTrendPlay, fallback: SheetRow[]) => {
    if (sport !== "NCAAF") return fallback;
    const canonicalKey = ncaafCanonicalMarketSideIdentity(play, canonicalRows);
    const aliasHistory = canonicalKey ? ncaafCanonicalHistory.get(canonicalKey) || [] : [];
    return aliasHistory.length ? normalizeNcaafHistoryForPlay(play, aliasHistory) : fallback;
  };
  const withPersistedNcaafMovementHistory = (play: WeeklyTrendPlay, rows: SheetRow[]) => {
    if (sport !== "NCAAF") return play;
    const bounded = ncaafHistoryForPlay(play, rows);
    return {
      ...play,
      movementHistory: movementHistoryForPlay(play, bounded),
    };
  };
  for (const split of activeSourceSplits) {
    const key = splitTrendKey(split);
    const existing = existingTrendMap.get(key);
    if (sport === "NCAAF") {
      handledLockKeys.add(key);
      let sideHistory = ncaafHistory.get(key) || [];
      let saved: WeeklyTrendPlay | undefined;
      try { saved = JSON.parse(String(existing?.["Details JSON"] || "")); } catch { }
      if (!saved && !sideHistory.length) continue;
      const base = saved
        ? {
            ...saved,
            date: split.date,
            gameKey: gameKey(split),
            gameTime: split.eventTime,
            game: split.game,
            awayTeam: split.awayTeam,
            homeTeam: split.homeTeam,
          }
        : { ...buildPlay(split, existing, history, sideHistory), week: footballWeekLabel(sport, split.date) };
      sideHistory = canonicalNcaafSideHistory(base, sideHistory);
      const resolved = resolveNcaafSnapshot(base, sideHistory, history);
      const persisted = withPersistedNcaafMovementHistory(resolved, sideHistory);
      if (JSON.stringify(persisted) !== String(existing?.["Details JSON"] || "")) liveCandidates.push(persisted);
      continue;
    }
    const minutes = minutesUntil(split);
    if (minutes != null && minutes <= 15) {
      handledLockKeys.add(key);
      if (minutes < 0) {
        if (existing && String(existing["Details JSON"] || "").trim()) {
          try {
            const saved = JSON.parse(String(existing["Details JSON"])) as WeeklyTrendPlay;
            if (saved.snapshotStatus !== "FINAL_PREGAME") {
              const ageMinutes = snapshotAgeMinutes(saved);
              const missedLock = ageMinutes == null || ageMinutes > (sport === "NFL" ? MAX_LOCK_FALLBACK_AGE_MINUTES : MAX_MISSED_LOCK_FRESHNESS_MINUTES);
              liveCandidates.push({
                ...saved,
                week: footballWeekLabel(sport, saved.date),
                snapshotStatus: missedLock ? "MISSED_LOCK" as const : "FINAL_PREGAME" as const,
                frozenAt: missedLock ? undefined : saved.updatedAt,
                lockWarning: missedLock
                  ? `Lock capture missed — last verified ${saved.updatedAt}.`
                  : "Finalized from the last verified pregame snapshot after ScoresAndOdds stopped updating.",
              });
            }
          } catch { }
        }
        continue;
      }
      if (existing && String(existing["Details JSON"] || "").trim()) {
        try {
          const saved = JSON.parse(String(existing["Details JSON"])) as WeeklyTrendPlay;
          if (saved.snapshotStatus === "FINAL_PREGAME") continue;
        } catch { }
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

  for (const row of effectiveExistingTrends) {
    const key = trendKey(row);
    if (handledLockKeys.has(key)) continue;
    const raw = String(row["Details JSON"] || "").trim();
    if (!raw) continue;
    try {
      const saved = JSON.parse(raw) as WeeklyTrendPlay;
      if (sport === "NCAAF") {
        const authoritativeGameTime = ncaafAuthoritativeGameTime(saved, kickoffAuthorityRows);
        const displayGameTime = ncaafDisplayGameTime(
          saved,
          kickoffAuthorityRows,
          [...effectiveAllGameTrends, ...sourceFilteredExistingGames, ...marketHistoryRows],
        );
        const authoritative = { ...saved, gameTime: authoritativeGameTime };
        const sideHistory = canonicalNcaafSideHistory(authoritative, ncaafHistory.get(key) || []);
        const resolved = resolveNcaafSnapshot(
          authoritative,
          sideHistory,
          history,
        );
        const displayed = withPersistedNcaafMovementHistory(
          { ...resolved, gameTime: displayGameTime },
          sideHistory,
        );
        if (JSON.stringify(displayed) !== raw) liveCandidates.push(displayed);
        continue;
      }
      if (saved.snapshotStatus === "FINAL_PREGAME") continue;
      // Re-check today's NFL MISSED_LOCK rows too so a source-dropout fallback can repair them.
      if (saved.snapshotStatus === "MISSED_LOCK" && sport !== "NFL") continue;
      if (saved.date !== todayET()) continue;
      const minutes = minutesUntilPlay(saved);
      if (minutes == null || minutes > 15) continue;
      const ageMinutes = snapshotAgeMinutes(saved);
      const missedLock = ageMinutes == null || ageMinutes > (sport === "NFL" ? MAX_LOCK_FALLBACK_AGE_MINUTES : MAX_MISSED_LOCK_FRESHNESS_MINUTES);
      liveCandidates.push({
        ...saved,
        week: footballWeekLabel(sport, saved.date),
        snapshotStatus: missedLock ? "MISSED_LOCK" as const : "FINAL_PREGAME" as const,
        frozenAt: missedLock ? undefined : saved.updatedAt,
        lockWarning: missedLock
          ? `Lock capture missed — last verified ${saved.updatedAt}.`
          : "ScoresAndOdds was unavailable at lock; finalized from the last verified pregame snapshot.",
      });
    } catch { }
  }
  const scored = headToHead(liveCandidates);
  const rows = scored.map(weeklyRow);
  if (rows.length) await upsertSportRows(sport, WEEKLY_TRENDS_TAB, WEEKLY_TREND_HEADERS, rows, trendKey);

  return {
    ok: true,
    sport,
    postedGamesFound: uniqueGames.size,
    marketSidesFound: dk.splits.length,
    filter: dk.filter,
    coverage: dk.coverage,
    pagesScanned: dk.pagesScanned,
    pagesWithRows: dk.pagesWithRows,
    missingPages: dk.missingPages,
    trendRowsUpdated: rows.length,
    marketHistoryRowsAppended,
    marketHistoryRowsStored: marketHistoryRows.length,
    errors: dk.errors,
    updatedAt: now,
  };
}

function movementHistoryForPlay(play: WeeklyTrendPlay, rows: SheetRow[]) {
  const selectionKey = textKey(play.market === "Total" ? play.side : play.selectionTeam || play.selection);
  const points = rows
    .filter((row) => {
      if (String(row["Game Key"] || "") !== play.gameKey) return false;
      if (String(row.Market || "") !== play.market) return false;
      const rowSelection = textKey(play.market === "Total" ? row.Side || row.Selection : row.Selection);
      return rowSelection === selectionKey;
    })
    .map((row) => ({
      snapshotTime: String(row["Snapshot Time ET"] || ""),
      line: numericLine(row.Line),
      odds: String(row.Odds || ""),
      betsPct: percent(row["Bets %"]),
      moneyPct: percent(row["Handle %"]),
    }))
    .filter((row) => Number.isFinite(row.betsPct) && Number.isFinite(row.moneyPct));

  const firstRealIndex = points.findIndex((point) => point.betsPct > 0 && point.betsPct < 100);
  // Charts should retain the full path from the first valid saved snapshot.
  return firstRealIndex >= 0 ? points.slice(firstRealIndex) : [];
}

function ncaafCanonicalMarketSideIdentity(
  play: WeeklyTrendPlay,
  canonicalRows: SheetRow[],
) {
  const matched = canonicalGameRow(
    { date: play.date, awayTeam: play.awayTeam, homeTeam: play.homeTeam },
    "NCAAF",
    canonicalRows,
  );
  const awayTeam = String(matched?.["Away Team"] || play.awayTeam || "").trim();
  const homeTeam = String(matched?.["Home Team"] || play.homeTeam || "").trim();
  if (!play.date || !awayTeam || !homeTeam) return "";

  const selected = play.market === "Total"
    ? textKey(play.side || play.selection)
    : collegeMarketTeamMatch(play.selectionTeam || play.selection, awayTeam)
      ? "away"
      : collegeMarketTeamMatch(play.selectionTeam || play.selection, homeTeam)
        ? "home"
        : textKey(play.selectionTeam || play.selection);
  if (!selected) return "";

  return [
    play.date,
    textKey(awayTeam),
    textKey(homeTeam),
    play.market,
    selected,
  ].join("|");
}

function ncaafCanonicalMarketHistoryIdentity(
  row: SheetRow,
  canonicalRows: SheetRow[],
) {
  const date = canonicalScheduleDate(row) || String(row.Date || "").trim();
  const marketText = String(row.Market || "").trim();
  const market: WeeklyFootballMarket | null =
    marketText === "Spread" ? "Spread" :
    marketText === "Total" ? "Total" :
    null;
  const rowAway = String(row["Away Team"] || "").trim();
  const rowHome = String(row["Home Team"] || "").trim();
  if (!date || !market || !rowAway || !rowHome) return "";

  const matched = canonicalGameRow(
    { date, awayTeam: rowAway, homeTeam: rowHome },
    "NCAAF",
    canonicalRows,
  );
  const awayTeam = String(matched?.["Away Team"] || rowAway).trim();
  const homeTeam = String(matched?.["Home Team"] || rowHome).trim();
  const selected = market === "Total"
    ? textKey(row.Side || row.Selection)
    : collegeMarketTeamMatch(row.Selection, awayTeam)
      ? "away"
      : collegeMarketTeamMatch(row.Selection, homeTeam)
        ? "home"
        : textKey(row.Selection);
  if (!selected) return "";

  return [
    date,
    textKey(awayTeam),
    textKey(homeTeam),
    market,
    selected,
  ].join("|");
}

function indexNcaafMarketHistoryByCanonicalSide(
  rows: SheetRow[],
  canonicalRows: SheetRow[],
) {
  const index = new Map<string, SheetRow[]>();
  // odds_snapshot contains hundreds of thousands of five-minute rows, but only
  // a few hundred distinct game/market/side identities. Canonical game matching
  // is comparatively expensive, so resolve each stored identity once instead
  // of rescanning the schedule for every historical snapshot.
  const identityCache = new Map<string, string>();
  for (const row of rows) {
    const lookupKey = [
      canonicalScheduleDate(row) || String(row.Date || "").trim(),
      textKey(row["Away Team"]),
      textKey(row["Home Team"]),
      textKey(row.Market),
      textKey(row.Selection),
      textKey(row.Side),
    ].join("|");
    let key = identityCache.get(lookupKey);
    if (key === undefined) {
      key = ncaafCanonicalMarketHistoryIdentity(row, canonicalRows);
      identityCache.set(lookupKey, key);
    }
    if (!key) continue;
    const group = index.get(key) || [];
    group.push(row);
    index.set(key, group);
  }
  for (const group of index.values()) {
    group.sort(
      (left, right) =>
        storedSnapshotEpoch(left["Snapshot Time ET"]) -
        storedSnapshotEpoch(right["Snapshot Time ET"]),
    );
  }
  return index;
}

function normalizeNcaafHistoryForPlay(
  play: WeeklyTrendPlay,
  rows: SheetRow[],
) {
  const seen = new Set<string>();
  const normalized: SheetRow[] = [];
  for (const row of rows) {
    const item: SheetRow = {
      ...row,
      "Game Key": play.gameKey,
      Game: play.game,
      "Away Team": play.awayTeam,
      "Home Team": play.homeTeam,
      Market: play.market,
      Selection: play.market === "Total"
        ? String(row.Selection || play.side || play.selection)
        : String(play.selectionTeam || play.selection),
      Side: play.market === "Total" ? play.side : String(row.Side || ""),
    };
    const signature = [
      String(item["Snapshot Time ET"] || ""),
      marketHistoryStateSignature(item),
    ].join("|");
    if (seen.has(signature)) continue;
    seen.add(signature);
    normalized.push(item);
  }
  return normalized.sort(
    (left, right) =>
      storedSnapshotEpoch(left["Snapshot Time ET"]) -
      storedSnapshotEpoch(right["Snapshot Time ET"]),
  );
}

function ncaafReadDuplicatePriority(
  play: WeeklyTrendPlay,
  canonicalRows: SheetRow[],
) {
  const matched = canonicalGameRow(
    { date: play.date, awayTeam: play.awayTeam, homeTeam: play.homeTeam },
    "NCAAF",
    canonicalRows,
  );
  const canonicalAway = textKey(matched?.["Away Team"]);
  const canonicalHome = textKey(matched?.["Home Team"]);
  const exactCanonicalNames =
    !!canonicalAway &&
    !!canonicalHome &&
    textKey(play.awayTeam) === canonicalAway &&
    textKey(play.homeTeam) === canonicalHome;
  const teamLabelDetail =
    textKey(play.awayTeam).split(" ").filter(Boolean).length +
    textKey(play.homeTeam).split(" ").filter(Boolean).length;
  const normalizedUpdatedAt = String(play.updatedAt || "")
    .replace(/ EDT$/, " -0400")
    .replace(/ EST$/, " -0500");
  const updatedAt = Date.parse(normalizedUpdatedAt);

  return (
    (play.snapshotStatus === "FINAL_PREGAME" ? 1_000_000_000_000_000 : 0) +
    (exactCanonicalNames ? 1_000_000_000_000 : 0) +
    teamLabelDetail * 1_000_000_000 +
    Math.min(500, play.movementHistory?.length || 0) * 1_000_000 +
    (Number.isFinite(updatedAt) ? updatedAt / 1e9 : 0)
  );
}

function dedupeNcaafReadTrendPlays(
  plays: WeeklyTrendPlay[],
  canonicalRows: SheetRow[],
) {
  const deduped = new Map<string, WeeklyTrendPlay>();
  for (const play of plays) {
    const identity = ncaafCanonicalMarketSideIdentity(play, canonicalRows);
    if (!identity) {
      deduped.set(
        `fallback|${play.gameKey}|${play.market}|${textKey(play.market === "Total" ? play.side : play.selectionTeam || play.selection)}`,
        play,
      );
      continue;
    }
    const existing = deduped.get(identity);
    if (
      !existing ||
      ncaafReadDuplicatePriority(play, canonicalRows) >
        ncaafReadDuplicatePriority(existing, canonicalRows)
    ) {
      deduped.set(identity, play);
    }
  }
  return [...deduped.values()];
}

export async function readWeeklyFootballMarket(
  sport: FootballSport,
  options: { dateKeys?: string[]; hydrateHistory?: boolean } = {},
) {
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
  const requestedDates = new Set(
    (options.dateKeys || []).map((value) => String(value || "").trim()).filter(Boolean),
  );
  // Public NCAAF reads can use the movement history already persisted in
  // weekly_market_trends. Raw odds_snapshot hydration is reserved for the
  // background market tracker/audit path, where the full archive is actually
  // needed. This keeps the public page from downloading hundreds of thousands
  // of snapshot rows on every refresh.
  const hydrateHistory = options.hydrateHistory !== false;
  const sourceGames = games
    .filter(isScoresAndOddsCutoverRow)
    .filter((row) => !requestedDates.size || requestedDates.has(canonicalScheduleDate(row) || String(row.Date || "").trim()));
  const sourceRows = rows
    .filter((row) => isWeeklyTrendSourceRow(row, sport))
    .filter((row) => !requestedDates.size || requestedDates.has(String(row.Date || "").trim()));
  const marketDates = [...new Set([
    ...sourceRows.map((row) => String(row.Date || "")),
    ...sourceGames.map((row) => canonicalScheduleDate(row) || String(row.Date || "")),
  ].filter(Boolean))];
  const marketHistoryRows = hydrateHistory && marketDates.length
    ? (await readSportWorksheetByDateKeys(sport, MARKET_HISTORY_TAB, marketDates, MARKET_HISTORY_HEADERS))
        .filter(isScoresAndOddsCutoverRow)
    : [];
  const liveKickoffRows = sport === "NCAAF" ? await loadNcaafLiveKickoffAuthorityRows() : [];
  const kickoffAuthorityRows = [...liveKickoffRows, ...scheduleRows, ...slateRows];
  const canonicalRows = [...kickoffAuthorityRows, ...allGameTrends];
  // Index once instead of rebuilding every row's normalized identity for every
  // market side. The full history grows by hundreds of rows every five minutes.
  const historyBySide = indexMarketHistoryBySide(marketHistoryRows);
  // NCAAF team labels can change from a short ScoresAndOdds name to the full
  // canonical schedule name during the day. Keep a second index by physical
  // game + market side so earlier snapshots remain attached after that rename.
  const ncaafHistoryByCanonicalSide = sport === "NCAAF"
    ? indexNcaafMarketHistoryByCanonicalSide(marketHistoryRows, canonicalRows)
    : new Map<string, SheetRow[]>();
  const ncaafRecordHistory = sport === "NCAAF" ? historyFromAllGameTrends(allGameTrends) : [];
  const trendPlays: WeeklyTrendPlay[] = [];
  for (const row of sourceRows) {
    const raw = String(row["Details JSON"] || "").trim();
    if (!raw) continue;
    try {
      let play = JSON.parse(raw) as WeeklyTrendPlay;
      let ncaafDisplayTime = "";
      if (sport === "NCAAF") {
        ncaafDisplayTime = ncaafDisplayGameTime(
          play,
          kickoffAuthorityRows,
          [...allGameTrends, ...sourceGames, ...marketHistoryRows],
        );
        play = {
          ...play,
          gameTime: ncaafAuthoritativeGameTime(play, kickoffAuthorityRows),
        };
      }
      const storedSplit = {
        date: play.date, eventTime: play.gameTime, game: play.game, awayTeam: play.awayTeam, homeTeam: play.homeTeam,
        market: play.market, selection: play.selection, selectionTeam: play.selectionTeam, side: play.side, sideGroup: play.sideGroup,
        line: play.line, odds: play.odds, moneyPct: play.moneyPct, betsPct: play.betsPct, gapPct: play.gapPct,
        warningKey: "", warning: "", warningTone: "neutral" as Tone, warningNegative: false,
      } as Split;
      if (!validFootballMarketSplit(storedSplit, sport, canonicalRows)) continue;
      if (!hydrateHistory) {
        if (sport === "NCAAF") {
          play = {
            ...play,
            gameTime: ncaafDisplayTime || play.gameTime,
          };
        }
        trendPlays.push({
          ...play,
          week: String(row.Week || play.week || storedFootballWeek(sport, play, canonicalRows)),
          movementHistory: Array.isArray(play.movementHistory) ? play.movementHistory : [],
        });
        continue;
      }
      let sideHistory = historyBySide.get(splitTrendKey(storedSplit)) || [];
      if (sport === "NCAAF") {
        const canonicalHistoryKey = ncaafCanonicalMarketSideIdentity(play, canonicalRows);
        const aliasHistory = canonicalHistoryKey
          ? ncaafHistoryByCanonicalSide.get(canonicalHistoryKey) || []
          : [];
        if (aliasHistory.length) {
          sideHistory = normalizeNcaafHistoryForPlay(play, aliasHistory);
        }
        play = resolveNcaafSnapshot(play, sideHistory, ncaafRecordHistory);
        play = { ...play, gameTime: ncaafDisplayTime };
        Object.assign(storedSplit, {
          eventTime: play.gameTime,
          line: play.line, odds: play.odds, betsPct: play.betsPct, moneyPct: play.moneyPct,
          gapPct: play.gapPct, sideGroup: play.sideGroup,
        });
        sideHistory = ncaafHistoryForPlay(play, sideHistory);
      }
      const correctedMove = movement(storedSplit, row, sideHistory);
      trendPlays.push({
        ...play,
        week: String(row.Week || play.week || storedFootballWeek(sport, play, canonicalRows)),
        openingBetsPct: correctedMove.openingBetsPct,
        openingMoneyPct: correctedMove.openingMoneyPct,
        publicMovementPct: correctedMove.publicMovementPct,
        sharpMovementPct: correctedMove.sharpMovementPct,
        openingLine: correctedMove.openingLine,
        openingOdds: correctedMove.openingOdds,
        openingImpliedPct: correctedMove.openingImpliedPct,
        currentImpliedPct: correctedMove.currentImpliedPct,
        lineMovementBasis: correctedMove.lineMovementBasis,
        lineMovementValue: correctedMove.lineMovementValue,
        lineMovementSignal: correctedMove.lineMovementSignal,
        firstTrackedAt: correctedMove.firstTrackedAt || play.firstTrackedAt,
        lowLine: correctedMove.lowLine,
        highLine: correctedMove.highLine,
        lineMoveCount: correctedMove.lineMoveCount,
        lastLineMoveAt: correctedMove.lastLineMoveAt,
        lineHistoryLabel: correctedMove.lineHistoryLabel,
        movementVersion: SELECTED_SIDE_MOVEMENT_VERSION,
        movementHistory: movementHistoryForPlay(play, sideHistory),
      });
    } catch { }
  }

  if (sport === "NFL") {
    const fallbackByIdentity = new Map<string, WeeklyTrendPlay>();

    function fallbackIdentity(play: WeeklyTrendPlay) {
      const away = nflMarketTeamCode(play.awayTeam);
      const home = nflMarketTeamCode(play.homeTeam);
      const selected = play.market === "Total"
        ? textKey(play.side || play.selection)
        : nflMarketTeamCode(play.selectionTeam || play.selection);
      if (!play.date || !away || !home || !selected) return "";
      return [play.date, away, home, play.market, selected].join("|");
    }

    function fallbackPriority(play: WeeklyTrendPlay) {
      const finalBonus = play.snapshotStatus === "FINAL_PREGAME" ? 1_000_000 : 0;
      // Preserve the existing tie-break weight now that chart history is uncapped.
      const historyBonus = Math.min(80, play.movementHistory?.length || 0) * 1_000;
      const normalized = String(play.updatedAt || "")
        .replace(/ EDT$/, " -0400")
        .replace(/ EST$/, " -0500");
      const stamp = Date.parse(normalized);
      return finalBonus + historyBonus + (Number.isFinite(stamp) ? stamp / 1e9 : 0);
    }

    const completedRecordHistory = historyFromAllGameTrends(allGameTrends);
    const legacyHistoryGroups = new Map<string, SheetRow[]>();

    // Group the retained legacy snapshots once by canonical physical market side.
    // Building one play per group avoids repeatedly scanning the entire odds
    // history (thousands of rows) for every single snapshot.
    for (const row of marketHistoryRows) {
      const date = canonicalScheduleDate(row) || String(row.Date || "").trim();
      if (!date || date >= SCORES_AND_ODDS_CUTOVER_DATE) continue;
      const marketText = String(row.Market || "").trim();
      if (marketText !== "Spread" && marketText !== "Total") continue;

      const away = nflMarketTeamCode(row["Away Team"]);
      const home = nflMarketTeamCode(row["Home Team"]);
      const selected = marketText === "Total"
        ? textKey(row.Side || row.Selection)
        : nflMarketTeamCode(row.Selection);
      if (!away || !home || !selected) continue;

      const identity = [date, away, home, marketText, selected].join("|");
      const group = legacyHistoryGroups.get(identity) || [];
      group.push(row);
      legacyHistoryGroups.set(identity, group);
    }

    for (const groupRows of legacyHistoryGroups.values()) {
      groupRows.sort((a, b) => {
        const aStamp = Date.parse(
          String(a["Snapshot Time ET"] || "").replace(/ EDT$/, " -0400").replace(/ EST$/, " -0500"),
        );
        const bStamp = Date.parse(
          String(b["Snapshot Time ET"] || "").replace(/ EDT$/, " -0400").replace(/ EST$/, " -0500"),
        );
        if (Number.isFinite(aStamp) && Number.isFinite(bStamp)) return aStamp - bStamp;
        return String(a["Snapshot Time ET"] || "").localeCompare(String(b["Snapshot Time ET"] || ""));
      });
      const row = groupRows.at(-1);
      if (!row) continue;

      const date = canonicalScheduleDate(row) || String(row.Date || "").trim();
      const marketText = String(row.Market || "").trim();
      const market = marketText as WeeklyFootballMarket;
      const awayTeam = String(row["Away Team"] || "").trim();
      const homeTeam = String(row["Home Team"] || "").trim();
      if (!date || !awayTeam || !homeTeam) continue;

      const betsPct = percent(row["Bets %"]);
      const moneyPct = percent(row["Handle %"]);
      if (!Number.isFinite(betsPct) || !Number.isFinite(moneyPct)) continue;

      const rawSelection = String(row.Selection || row.Side || "").trim();
      const sideKey = textKey(row.Side || row.Selection);
      const side: "Over" | "Under" | "" = market === "Total"
        ? sideKey.startsWith("over")
          ? "Over"
          : sideKey.startsWith("under")
            ? "Under"
            : ""
        : "";
      if (market === "Total" && !side) continue;

      const line = numericLine(row.Line);
      const warning = warningFor(betsPct, moneyPct);
      const split: Split = {
        date,
        eventTime: String(row["Game Time"] || "").trim(),
        game: String(row.Game || `${awayTeam} at ${homeTeam}`).trim(),
        awayTeam,
        homeTeam,
        market,
        selection: market === "Total" ? side : rawSelection,
        selectionTeam: market === "Spread" ? rawSelection : "",
        side,
        sideGroup: market === "Total"
          ? side
          : line == null || Math.abs(line) < 1e-9
            ? ""
            : line < 0
              ? "Favorite"
              : "Underdog",
        line,
        odds: String(row.Odds || "").replace(/−/g, "-").trim(),
        betsPct,
        moneyPct,
        gapPct: warning.gapPct,
        warningKey: warning.warningKey,
        warning: warning.warning,
        warningTone: warning.warningTone,
        warningNegative: warning.warningNegative,
        sourceUrl: String(row["Source URL"] || "").trim(),
      };
      if (!validFootballMarketSplit(split, sport, canonicalRows)) continue;

      // Pass only this market side's retained snapshots into buildPlay. This
      // preserves the original opening/current movement calculations without
      // the O(history²) route cost that caused NFL reads to time out.
      const built = buildPlay(split, undefined, completedRecordHistory, groupRows);
      const gameKeyFromHistory = String(row["Game Key"] || built.gameKey).trim();
      const updatedAt = String(row["Snapshot Time ET"] || built.updatedAt).trim();
      const candidate: WeeklyTrendPlay = {
        ...built,
        gameKey: gameKeyFromHistory,
        week: footballWeekLabel(sport, date),
        updatedAt,
        snapshotStatus: "FINAL_PREGAME",
        frozenAt: updatedAt,
      };
      candidate.movementHistory = movementHistoryForPlay(candidate, groupRows);

      const identity = fallbackIdentity(candidate);
      if (!identity) continue;
      const current = fallbackByIdentity.get(identity);
      if (!current || fallbackPriority(candidate) > fallbackPriority(current)) {
        fallbackByIdentity.set(identity, candidate);
      }
    }

    for (const row of allGameTrends) {
      const date = canonicalScheduleDate(row) || String(row.Date || "").trim();
      if (!date || date >= SCORES_AND_ODDS_CUTOVER_DATE) continue;
      const raw = String(row["Trend Score Details"] || "").trim();
      if (!raw) continue;
      try {
        const play = JSON.parse(raw) as WeeklyTrendPlay;
        const storedSplit = {
          date: play.date || date,
          eventTime: play.gameTime,
          game: play.game,
          awayTeam: play.awayTeam,
          homeTeam: play.homeTeam,
          market: play.market,
          selection: play.selection,
          selectionTeam: play.selectionTeam,
          side: play.side,
          sideGroup: play.sideGroup,
          line: play.line,
          odds: play.odds,
          moneyPct: play.moneyPct,
          betsPct: play.betsPct,
          gapPct: play.gapPct,
          warningKey: "",
          warning: "",
          warningTone: "neutral" as Tone,
          warningNegative: false,
        } as Split;
        if (!validFootballMarketSplit(storedSplit, sport, canonicalRows)) continue;

        const away = nflMarketTeamCode(play.awayTeam);
        const home = nflMarketTeamCode(play.homeTeam);
        if (!away || !home) continue;
        const candidate: WeeklyTrendPlay = {
          ...play,
          date,
          week: footballWeekLabel(sport, date),
          gameKey: `${date}|${textKey(away)}|${textKey(home)}`,
          snapshotStatus: play.snapshotStatus || "FINAL_PREGAME",
        };
        const identity = fallbackIdentity(candidate);
        if (!identity) continue;
        const current = fallbackByIdentity.get(identity);
        if (!current || fallbackPriority(candidate) > fallbackPriority(current)) {
          fallbackByIdentity.set(identity, candidate);
        }
      } catch {}
    }

    const liveIdentities = new Set(trendPlays.map(fallbackIdentity).filter(Boolean));
    for (const [identity, play] of fallbackByIdentity) {
      if (!liveIdentities.has(identity)) trendPlays.push(play);
    }
  }

  // Old NCAAF rows can survive under a short team label while a newer canonical
  // row uses the full ESPN/schedule name for the same physical market side.
  // Collapse those storage aliases at read time so the public board never renders
  // duplicate games. Prefer the verified final snapshot, then the canonical/full
  // team-name row and the richer/newer movement history.
  const displayTrendPlays = sport === "NCAAF"
    ? dedupeNcaafReadTrendPlays(trendPlays, canonicalRows)
    : trendPlays;

  const splits = displayTrendPlays.map((play) => ({
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
  const validGames = sourceGames.filter((row) => {
    const probe = {
      date: canonicalScheduleDate(row), awayTeam: String(row["Away Team"] || ""), homeTeam: String(row["Home Team"] || ""),
    };
    return !!probe.date && !!canonicalGameRow(probe, sport, canonicalRows);
  });
  return { ok: true, sport, games: validGames, trendPlays: displayTrendPlays, splits, updatedAt: nowET() };
}


// ---- External sportsbook market tracker (shared DraftKings rules) ----

export type ExternalFootballMarketSplit = Split;

export type ExternalFootballMarketSourceConfig = {
  source: string;
  sourceUrl: string;
  postedGamesTab: string;
  weeklyTrendsTab: string;
  marketHistoryTab: string;
  resultHistoryTab: string;
};

export function footballPublicSplitWarning(betsPct: number, moneyPct: number) {
  return warningFor(betsPct, moneyPct);
}

const EXTERNAL_TREND_RESULT_HEADERS = [
  "Date", "Week", "Game Key", "Game Time", "Game", "Away Team", "Home Team",
  "Market", "Selection", "Side", "Public Split Line", "Public Split Odds",
  "Public Bets %", "Public Money %", "Public Gap %", "Public Warning",
  "Line Movement Signal", "Trend Score", "Trend Tier", "Snapshot Status",
  "Final Away Score", "Final Home Score", "Result", "Units", "Source",
  "Source URL", "Graded At", "Trend Score Details",
];

function externalSourceUrl(config: ExternalFootballMarketSourceConfig, split?: Split) {
  return String(split?.sourceUrl || config.sourceUrl || "").trim();
}

function externalMarketHistoryRowForSplit(
  split: Split,
  sport: FootballSport,
  canonicalRows: SheetRow[],
  snapshotTime: string,
  config: ExternalFootballMarketSourceConfig,
): SheetRow {
  return {
    ...marketHistoryRowForSplit(split, sport, canonicalRows, snapshotTime),
    Source: config.source,
    "Source URL": externalSourceUrl(config, split),
  };
}

function externalMarketHistorySeedRow(
  row: SheetRow,
  snapshotTime: string,
  config: ExternalFootballMarketSourceConfig,
) {
  const seed = marketHistorySeedRow(row, snapshotTime);
  return seed ? { ...seed, Source: config.source, "Source URL": config.sourceUrl } : null;
}

function externalFinalScore(
  play: WeeklyTrendPlay,
  sport: FootballSport,
  scheduleRows: SheetRow[],
) {
  const matched = canonicalGameRow(play, sport, scheduleRows);
  if (!matched) return null;
  const awayRaw = String(matched["Away Score"] ?? "").trim();
  const homeRaw = String(matched["Home Score"] ?? "").trim();
  if (!awayRaw || !homeRaw) return null;
  const awayScore = Number(awayRaw);
  const homeScore = Number(homeRaw);
  if (!Number.isFinite(awayScore) || !Number.isFinite(homeScore)) return null;
  const completed = ["TRUE", "YES", "Y", "1", "COMPLETED", "FINAL"].includes(
    String(matched.Completed || matched.Status || "").trim().toUpperCase(),
  );
  if (!completed) return null;
  return { awayScore, homeScore };
}

function externalSelectionIsAway(play: WeeklyTrendPlay, sport: FootballSport) {
  if (sport === "NFL") {
    const selected = nflMarketTeamCode(play.selectionTeam || play.selection);
    return !!selected && selected === nflMarketTeamCode(play.awayTeam);
  }
  return collegeMarketTeamMatch(play.selectionTeam || play.selection, play.awayTeam);
}

function externalSelectionIsHome(play: WeeklyTrendPlay, sport: FootballSport) {
  if (sport === "NFL") {
    const selected = nflMarketTeamCode(play.selectionTeam || play.selection);
    return !!selected && selected === nflMarketTeamCode(play.homeTeam);
  }
  return collegeMarketTeamMatch(play.selectionTeam || play.selection, play.homeTeam);
}

function gradeExternalTrendPlay(
  play: WeeklyTrendPlay,
  sport: FootballSport,
  scheduleRows: SheetRow[],
): { result: ResultCode; units: number; awayScore: number; homeScore: number } | null {
  if (play.snapshotStatus !== "FINAL_PREGAME") return null;
  const final = externalFinalScore(play, sport, scheduleRows);
  if (!final || play.line == null) return null;

  let result: ResultCode;
  if (play.market === "Spread") {
    const isAway = externalSelectionIsAway(play, sport);
    const isHome = externalSelectionIsHome(play, sport);
    if (!isAway && !isHome) return null;
    const selectedScore = isAway ? final.awayScore : final.homeScore;
    const opponentScore = isAway ? final.homeScore : final.awayScore;
    const margin = selectedScore + play.line - opponentScore;
    result = Math.abs(margin) < 1e-9 ? "P" : margin > 0 ? "W" : "L";
  } else {
    const difference = final.awayScore + final.homeScore - play.line;
    const side = textKey(play.side || play.selection);
    if (!side.startsWith("over") && !side.startsWith("under")) return null;
    result = Math.abs(difference) < 1e-9
      ? "P"
      : side.startsWith("under")
        ? difference < 0 ? "W" : "L"
        : difference > 0 ? "W" : "L";
  }

  const odds = parseOdds(play.odds) || -110;
  const units = result === "W" ? profitUnits(odds) : result === "L" ? -1 : 0;
  return { result, units, ...final };
}

function externalTrendResultRow(
  play: WeeklyTrendPlay,
  grade: NonNullable<ReturnType<typeof gradeExternalTrendPlay>>,
  config: ExternalFootballMarketSourceConfig,
): SheetRow {
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
    "Public Split Line": play.line == null ? "" : String(play.line),
    "Public Split Odds": play.odds,
    "Public Bets %": String(play.betsPct),
    "Public Money %": String(play.moneyPct),
    "Public Gap %": String(play.gapPct),
    "Public Warning": play.signals[0]?.signal || "",
    "Line Movement Signal": play.lineMovementSignal || "",
    "Trend Score": String(Math.round(play.score)),
    "Trend Tier": play.tier,
    "Snapshot Status": play.snapshotStatus,
    "Final Away Score": String(grade.awayScore),
    "Final Home Score": String(grade.homeScore),
    Result: grade.result,
    Units: String(Math.round(grade.units * 10_000) / 10_000),
    Source: config.source,
    "Source URL": config.sourceUrl,
    "Graded At": nowET(),
    "Trend Score Details": JSON.stringify(play),
  };
}

async function settleExternalTrendResults(
  sport: FootballSport,
  config: ExternalFootballMarketSourceConfig,
  trendRows: SheetRow[],
  existingResults: SheetRow[],
  scheduleRows: SheetRow[],
) {
  const existingKeys = new Set(existingResults.map(trendKey));
  const additions: SheetRow[] = [];
  for (const row of trendRows) {
    const key = trendKey(row);
    if (!key || existingKeys.has(key)) continue;
    const raw = String(row["Details JSON"] || "").trim();
    if (!raw) continue;
    try {
      const play = JSON.parse(raw) as WeeklyTrendPlay;
      const grade = gradeExternalTrendPlay(play, sport, scheduleRows);
      if (!grade) continue;
      const result = externalTrendResultRow(play, grade, config);
      additions.push(result);
      existingKeys.add(key);
    } catch { }
  }
  if (additions.length) {
    await upsertSportRows(
      sport,
      config.resultHistoryTab,
      EXTERNAL_TREND_RESULT_HEADERS,
      additions,
      trendKey,
    );
  }
  return { rows: [...existingResults, ...additions], settled: additions.length };
}

export async function syncExternalFootballMarkets(
  sport: FootballSport,
  config: ExternalFootballMarketSourceConfig,
  suppliedSplits: ExternalFootballMarketSplit[],
  sourceErrors: string[] = [],
) {
  await Promise.all([
    ensureSportWorksheet(sport, config.postedGamesTab, POSTED_GAME_HEADERS),
    ensureSportWorksheet(sport, config.weeklyTrendsTab, WEEKLY_TREND_HEADERS),
    ensureSportWorksheet(sport, config.marketHistoryTab, MARKET_HISTORY_HEADERS),
    ensureSportWorksheet(sport, config.resultHistoryTab, EXTERNAL_TREND_RESULT_HEADERS),
  ]);

  const [existingGames, existingTrends, resultHistory, scheduleRows, slateRows] = await Promise.all([
    readSportWorksheet(sport, config.postedGamesTab, POSTED_GAME_HEADERS),
    readSportWorksheet(sport, config.weeklyTrendsTab, WEEKLY_TREND_HEADERS),
    readSportWorksheet(sport, config.resultHistoryTab, EXTERNAL_TREND_RESULT_HEADERS),
    readSportWorksheet(sport, "schedule"),
    readSportWorksheet(sport, "daily_slate"),
  ]);

  const settlement = await settleExternalTrendResults(
    sport,
    config,
    existingTrends,
    resultHistory,
    scheduleRows,
  );
  const effectiveResultHistory = settlement.rows;
  const canonicalRows = [...scheduleRows, ...slateRows, ...effectiveResultHistory];
  const errors = [...sourceErrors];
  const splits = suppliedSplits.filter((split) => validFootballMarketSplit(split, sport, canonicalRows));
  if (splits.length !== suppliedSplits.length) {
    errors.push(
      `Football validation rejected ${suppliedSplits.length - splits.length} non-${sport} or malformed ${config.source} market sides.`,
    );
  }

  const activeMarketDates = [...new Set(splits.map((split) => split.date).filter(Boolean))];
  const existingMarketHistory = activeMarketDates.length
    ? await readSportWorksheetByDateKeys(
        sport,
        config.marketHistoryTab,
        activeMarketDates,
        MARKET_HISTORY_HEADERS,
      )
    : [];

  const now = nowET();
  const gameMap = new Map(existingGames.map((row) => [postedGameKey(row), row]));
  const postedRows: SheetRow[] = [];
  const uniqueGames = new Map<string, Split>();
  for (const split of splits) if (!uniqueGames.has(gameKey(split))) uniqueGames.set(gameKey(split), split);

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
      Source: config.source,
      "Source URL": externalSourceUrl(config, split),
    });
  }
  if (postedRows.length) {
    await upsertSportRows(
      sport,
      config.postedGamesTab,
      POSTED_GAME_HEADERS,
      postedRows,
      postedGameKey,
    );
  }

  const existingTrendMap = new Map(existingTrends.map((row) => [trendKey(row), row]));
  const history = historyFromAllGameTrends(effectiveResultHistory);
  const marketHistoryRows = [...existingMarketHistory];
  const marketHistoryRowsToAppend: SheetRow[] = [];
  const existingHistoryKeys = new Set(existingMarketHistory.map(marketHistoryLogicalKey).filter(Boolean));
  const latestHistoryByKey = new Map<string, SheetRow>();
  for (const row of existingMarketHistory) {
    const key = marketHistoryLogicalKey(row);
    if (key) latestHistoryByKey.set(key, row);
  }
  const postedStateRows = [...existingGames, ...postedRows];
  const firstSeenByGame = new Map(
    postedStateRows.map((row) => [
      String(row["Game Key"] || ""),
      String(row["First Seen"] || now),
    ]),
  );

  for (const split of splits) {
    const key = splitTrendKey(split);
    if (!existingHistoryKeys.has(key)) {
      const existing = existingTrendMap.get(key);
      const seed = existing
        ? externalMarketHistorySeedRow(
            existing,
            firstSeenByGame.get(gameKey(split)) || now,
            config,
          )
        : null;
      if (seed) {
        marketHistoryRows.push(seed);
        marketHistoryRowsToAppend.push(seed);
        latestHistoryByKey.set(key, seed);
        existingHistoryKeys.add(key);
      }
    }

    const current = externalMarketHistoryRowForSplit(
      split,
      sport,
      canonicalRows,
      now,
      config,
    );
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
      await appendSportRows(
        sport,
        config.marketHistoryTab,
        MARKET_HISTORY_HEADERS,
        marketHistoryRowsToAppend,
      );
      marketHistoryRowsAppended = marketHistoryRowsToAppend.length;
    } catch (error) {
      errors.push(
        `${config.source} market history append failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const liveCandidates: WeeklyTrendPlay[] = [];
  const handledLockKeys = new Set<string>();
  for (const split of splits) {
    const key = splitTrendKey(split);
    const existing = existingTrendMap.get(key);
    const minutes = minutesUntil(split);
    if (minutes != null && minutes <= 15) {
      handledLockKeys.add(key);
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
                  : `Finalized from the last verified pregame snapshot after ${config.source} stopped updating.`,
              });
            }
          } catch { }
        }
        continue;
      }

      if (existing && String(existing["Details JSON"] || "").trim()) {
        try {
          const saved = JSON.parse(String(existing["Details JSON"])) as WeeklyTrendPlay;
          if (saved.snapshotStatus === "FINAL_PREGAME") continue;
        } catch { }
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

    liveCandidates.push({
      ...buildPlay(split, existing, history, marketHistoryRows),
      week: footballWeekLabel(sport, split.date),
    });
  }

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
          : `${config.source} was unavailable at lock; finalized from the last verified pregame snapshot.`,
      });
    } catch { }
  }

  const scored = headToHead(liveCandidates);
  const rows = scored.map(weeklyRow);
  if (rows.length) {
    await upsertSportRows(
      sport,
      config.weeklyTrendsTab,
      WEEKLY_TREND_HEADERS,
      rows,
      trendKey,
    );
  }

  return {
    ok: true,
    sport,
    source: config.source,
    postedGamesFound: uniqueGames.size,
    marketSidesFound: splits.length,
    trendRowsUpdated: rows.length,
    resultsSettled: settlement.settled,
    marketHistoryRowsAppended,
    marketHistoryRowsStored: marketHistoryRows.length,
    errors,
    updatedAt: now,
  };
}

export async function readExternalFootballMarket(
  sport: FootballSport,
  config: ExternalFootballMarketSourceConfig,
) {
  await Promise.all([
    ensureSportWorksheet(sport, config.postedGamesTab, POSTED_GAME_HEADERS),
    ensureSportWorksheet(sport, config.weeklyTrendsTab, WEEKLY_TREND_HEADERS),
    ensureSportWorksheet(sport, config.resultHistoryTab, EXTERNAL_TREND_RESULT_HEADERS),
  ]);
  const [games, rows, scheduleRows, slateRows, resultRows] = await Promise.all([
    readSportWorksheet(sport, config.postedGamesTab, POSTED_GAME_HEADERS),
    readSportWorksheet(sport, config.weeklyTrendsTab, WEEKLY_TREND_HEADERS),
    readSportWorksheet(sport, "schedule"),
    readSportWorksheet(sport, "daily_slate"),
    readSportWorksheet(sport, config.resultHistoryTab, EXTERNAL_TREND_RESULT_HEADERS),
  ]);
  const canonicalRows = [...scheduleRows, ...slateRows, ...resultRows];
  const trendPlays: WeeklyTrendPlay[] = [];

  for (const row of rows) {
    const raw = String(row["Details JSON"] || "").trim();
    if (!raw) continue;
    try {
      const play = JSON.parse(raw) as WeeklyTrendPlay;
      const storedSplit = {
        date: play.date,
        eventTime: play.gameTime,
        game: play.game,
        awayTeam: play.awayTeam,
        homeTeam: play.homeTeam,
        market: play.market,
        selection: play.selection,
        selectionTeam: play.selectionTeam,
        side: play.side,
        sideGroup: play.sideGroup,
        line: play.line,
        odds: play.odds,
        moneyPct: play.moneyPct,
        betsPct: play.betsPct,
        gapPct: play.gapPct,
        warningKey: "",
        warning: "",
        warningTone: "neutral" as Tone,
        warningNegative: false,
      } as Split;
      if (!validFootballMarketSplit(storedSplit, sport, canonicalRows)) continue;
      trendPlays.push({
        ...play,
        week: String(row.Week || play.week || storedFootballWeek(sport, play, canonicalRows)),
      });
    } catch { }
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
    snapshotStatus: play.snapshotStatus,
  }));

  const validGames = games.filter((row) => {
    const probe = {
      date: canonicalScheduleDate(row),
      awayTeam: String(row["Away Team"] || ""),
      homeTeam: String(row["Home Team"] || ""),
    };
    return !!probe.date && !!canonicalGameRow(probe, sport, canonicalRows);
  });

  return {
    ok: true,
    sport,
    source: config.source,
    games: validGames,
    trendPlays,
    splits,
    resultRows: resultRows.filter((row) => Boolean(resultCode(row.Result))),
    updatedAt: nowET(),
  };
}
