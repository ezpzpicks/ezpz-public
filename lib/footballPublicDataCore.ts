import {
  type FootballSport,
  type SheetRow,
  ensureSportWorksheet,
  readSportWorksheet,
  sportDatabaseLabel,
  upsertSportRows,
} from "./sportSheets";
import { readWeeklyFootballMarket } from "./footballWeeklyMarket";
import {
  SCORES_AND_ODDS_SOURCE,
  assessScoresAndOddsMarketCoverage,
  type ScoresAndOddsMarketCoverage,
  loadScoresAndOddsConsensus,
} from "./scoresAndOddsBettingSplits";

export type FootballMarket = "Spread" | "Total";
type Tone = "negative" | "caution" | "positive" | "neutral";
type ResultCode = "W" | "L" | "P";

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
  "Trend Sample Size", "History Source", "Fallback Reason", "Result Source",
  "Result Fallback Reason", "Result Match Key",
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

type TrendWindowRecords = { allTime: TrendRecord; last30: TrendRecord; last7: TrendRecord };

type TrendSignal = {
  signalType: "Public Split" | "Line Movement";
  signalKey: string;
  signal: string;
  tone: Tone;
  category: string;
  recordScope: string;
  exactSample: number;
  TrendSampleSize: number;
  HistorySource: string;
  FallbackReason: string;
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
  TrendSampleSize: number;
  HistorySource: string;
  FallbackReason: string;
  baseScore?: number;
  opponentScore?: number | null;
  comparisonGap?: number;
  comparisonWinner?: boolean;
  tier: "Pass" | "Good" | "Strong" | "Elite";
  signals: TrendSignal[];
  updatedAt: string;
  frozenAt?: string;
  lockWarning?: string;
  snapshotStatus?: "LIVE" | "FINAL_PREGAME" | "MISSED_LOCK";
  gradingVersion?: string;
};

type SignalHistoryRow = {
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
  historySource: string;
  fallbackReason: string;
};

const FROZEN_TREND_GRADING_VERSION = "football-frozen-h2h-v2-weekly-15m-lock";
const TREND_BROAD_FALLBACK_SCORE_CAP = 69;
const TREND_NO_HISTORY_SCORE = 50;

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
  // Legacy schedule rows use bare "LA" for the Rams. Keep this aligned with
  // footballWeeklyMarket's NFL aliases so coverage doesn't invent a second game.
  LAR: ["Los Angeles Rams", "LA Rams", "Rams", "LA"], MIA: ["Miami Dolphins", "Dolphins", "Miami"],
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

const NCAAF_TEAM_ALIASES: Record<string, string> = {
  "app state": "appalachian state",
  "fiu": "florida international",
  "florida intl": "florida international",
  "fau": "florida atlantic",
  "uconn": "connecticut",
  "southern miss": "southern mississippi",
  "mtsu": "middle tennessee",
  "middle tennessee state": "middle tennessee",
  "niu": "northern illinois",
  "ul lafayette": "louisiana",
  "louisiana lafayette": "louisiana",
  "la lafayette": "louisiana",
  "ul monroe": "louisiana monroe",
  "ulm": "louisiana monroe",
  "jax state": "jacksonville state",
  "ndsu": "north dakota state",
  "sac state": "sacramento state",
  "sjsu": "san jose state",
  "umass": "massachusetts",
  "nc state": "north carolina state",
  "usc": "southern california",
  "ucf": "central florida",
  "usf": "south florida",
  "smu": "southern methodist",
  "byu": "brigham young",
  "tcu": "texas christian",
  "utsa": "texas san antonio",
  "utep": "texas el paso",
  "lsu": "louisiana state",
  "ole miss": "mississippi",
  "cal": "california",
  "pitt": "pittsburgh",
};

function normalizeCollegeTeamKey(value: unknown) {
  let key = textKey(value)
    .replace(/\buniversity\b/g, "")
    .replace(/\bthe\b/g, "")
    .replace(/\baandm\b/g, "am")
    .replace(/\ba\s+m\b/g, "am")
    .replace(/\bst$/g, "state")
    .replace(/\s+/g, " ")
    .trim();
  return NCAAF_TEAM_ALIASES[key] || key;
}

function normalizeTeam(value: unknown, sport: FootballSport) {
  // Selections commonly arrive as "Team -3.5". Strip only a trailing spread
  // number so team matching remains identical for model rows and DraftKings rows.
  const raw = String(value || "")
    .trim()
    .replace(/\s+[+-]?\d+(?:\.\d+)?$/, "")
    .trim();
  const key = textKey(raw);
  if (!key) return "";
  if (sport === "NFL") {
    for (const [abbr, aliases] of Object.entries(NFL_ALIASES)) {
      if (textKey(abbr) === key || aliases.some((alias) => {
        const a = textKey(alias);
        return a === key || a.endsWith(key) || key.endsWith(a);
      })) return abbr;
    }
    return key;
  }
  return normalizeCollegeTeamKey(key);
}

function sameTeam(a: unknown, b: unknown, sport: FootballSport) {
  const left = normalizeTeam(a, sport);
  const right = normalizeTeam(b, sport);
  if (!left || !right) return false;
  if (left === right) return true;
  const compactLeft = left.replace(/\s+/g, "");
  const compactRight = right.replace(/\s+/g, "");
  // Compact equality safely handles formatting-only differences such as U C F vs UCF.
  // Do not use substring/token-overlap matching for college teams: Virginia/West Virginia,
  // Georgia/Georgia State, Utah/Utah State, etc. must never be treated as the same team.
  return compactLeft === compactRight;
}

function sameMatchup(row: SheetRow, split: DraftKingsSplit, sport: FootballSport) {
  const away = row["Away Team"];
  const home = row["Home Team"];
  const sameOrder = sameTeam(away, split.awayTeam, sport) && sameTeam(home, split.homeTeam, sport);
  const reversedOrder = sameTeam(away, split.homeTeam, sport) && sameTeam(home, split.awayTeam, sport);
  return sameOrder || reversedOrder;
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

function etKickoffParts(value: unknown) {
  const date = new Date(String(value || ""));
  if (!Number.isFinite(date.getTime())) return { date: "", time: "" };
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true,
  }).format(date);
  return { date: get("year") + "-" + get("month") + "-" + get("day"), time };
}

function nonEmptyMerge(base: SheetRow, next: SheetRow) {
  const out: SheetRow = { ...base };
  for (const [key, value] of Object.entries(next)) {
    if (String(value ?? "").trim() !== "") out[key] = String(value);
  }
  return out;
}

function footballScheduleKey(row: SheetRow, sport: FootballSport) {
  const id = String(row["Game ID"] || "").trim();
  if (id) return "id:" + id;
  const date = isoDate(row.Date || row["Game Date"] || "");
  return "team:" + date + "|" + normalizeTeam(row["Away Team"], sport) + "|" + normalizeTeam(row["Home Team"], sport);
}

function footballWeekDates(start: string, end: string) {
  const dates: string[] = [];
  let stamp = Date.parse(start + "T12:00:00Z");
  const endStamp = Date.parse(end + "T12:00:00Z");
  while (Number.isFinite(stamp) && stamp <= endStamp) {
    dates.push(new Date(stamp).toISOString().slice(0, 10));
    stamp += 86_400_000;
  }
  return dates;
}

async function loadFootballWeekSchedule(sport: FootballSport, start: string, end: string): Promise<SheetRow[]> {
  const league = sport === "NFL" ? "nfl" : "college-football";
  const payloads = await Promise.all(footballWeekDates(start, end).map(async (date) => {
    const url = new URL("https://site.api.espn.com/apis/site/v2/sports/football/" + league + "/scoreboard");
    url.searchParams.set("dates", date.replace(/-/g, ""));
    url.searchParams.set("limit", "1000");
    if (sport === "NCAAF") url.searchParams.set("groups", "80");
    try {
      const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
      if (!response.ok) return null;
      return await response.json() as any;
    } catch {
      return null;
    }
  }));
  const rows: SheetRow[] = [];
  const seen = new Set<string>();
  for (const payload of payloads) {
    for (const event of Array.isArray(payload?.events) ? payload.events : []) {
      const eventId = String(event?.id || "");
      if (eventId && seen.has(eventId)) continue;
      if (eventId) seen.add(eventId);
      const competition = Array.isArray(event?.competitions) ? event.competitions[0] : null;
      if (!competition) continue;
      const competitors = Array.isArray(competition?.competitors) ? competition.competitors : [];
      const home = competitors.find((entry: any) => String(entry?.homeAway || "").toLowerCase() === "home") || competitors[0];
      const away = competitors.find((entry: any) => String(entry?.homeAway || "").toLowerCase() === "away") || competitors[1];
      const teamName = (entry: any) => String(entry?.team?.displayName || entry?.team?.shortDisplayName || entry?.team?.name || "").trim();
      const awayTeam = teamName(away);
      const homeTeam = teamName(home);
      if (!awayTeam || !homeTeam) continue;
      const kickoff = etKickoffParts(competition?.date || event?.date);
      if (!kickoff.date) continue;
      const completed = Boolean(competition?.status?.type?.completed || event?.status?.type?.completed);
      rows.push({
        Date: kickoff.date,
        "Game Date": kickoff.date,
        "Game Time": kickoff.time,
        "Game ID": String(event?.id || competition?.id || ""),
        Game: awayTeam + " @ " + homeTeam,
        "Away Team": awayTeam,
        "Home Team": homeTeam,
        Completed: completed ? "TRUE" : "FALSE",
        "Away Score": completed ? String(away?.score ?? "") : "",
        "Home Score": completed ? String(home?.score ?? "") : "",
      });
    }
  }
  return rows;
}

function mergeFootballSchedules(saved: SheetRow[], live: SheetRow[], sport: FootballSport) {
  const merged = new Map<string, SheetRow>();

  if (sport === "NFL" && live.length) {
    const liveDates = new Set(
      live.map((row) => isoDate(row.Date || row["Game Date"] || "")).filter(Boolean),
    );

    // Live ESPN schedule rows are authoritative for NFL matchup identity.
    for (const row of live) {
      merged.set(footballScheduleKey(row, sport), row);
    }

    for (const row of saved) {
      const date = isoDate(row.Date || row["Game Date"] || "");
      if (date && liveDates.has(date)) {
        const liveMatch = live.find((candidate) => {
          const candidateDate = isoDate(candidate.Date || candidate["Game Date"] || "");
          return (
            candidateDate === date &&
            sameTeam(candidate["Away Team"], row["Away Team"], sport) &&
            sameTeam(candidate["Home Team"], row["Home Team"], sport)
          );
        });

        if (liveMatch) {
          const key = footballScheduleKey(liveMatch, sport);
          const enriched = nonEmptyMerge(row, liveMatch);
          merged.set(key, {
            ...enriched,
            Date: liveMatch.Date || enriched.Date || "",
            "Game Date": liveMatch["Game Date"] || liveMatch.Date || enriched["Game Date"] || "",
            "Game Time": liveMatch["Game Time"] || enriched["Game Time"] || "",
            "Game ID": liveMatch["Game ID"] || enriched["Game ID"] || "",
            Game: liveMatch.Game || enriched.Game || "",
            "Away Team": liveMatch["Away Team"] || enriched["Away Team"] || "",
            "Home Team": liveMatch["Home Team"] || enriched["Home Team"] || "",
          });
        }
        // When ESPN covers the date, unmatched saved rows are stale/phantom.
        continue;
      }

      merged.set(footballScheduleKey(row, sport), row);
    }

    return [...merged.values()];
  }

  for (const row of saved) merged.set(footballScheduleKey(row, sport), row);
  for (const row of live) {
    const key = footballScheduleKey(row, sport);
    merged.set(key, nonEmptyMerge(merged.get(key) || {}, row));
  }
  return [...merged.values()];
}

function mergeFootballTrackingSlate(projected: SheetRow[], schedule: SheetRow[], sport: FootballSport, referenceDate: string) {
  const merged = new Map<string, SheetRow>();
  const authoritativeSchedule = schedule.filter((entry) => inFootballTrackingWeek(entry, sport, referenceDate));
  const authoritativeKeys = new Set(authoritativeSchedule.map((row) => footballScheduleKey(row, sport)));
  const authoritativeDates = new Set(
    authoritativeSchedule.map((row) => isoDate(row.Date || row["Game Date"] || "")).filter(Boolean),
  );

  for (const row of authoritativeSchedule) {
    merged.set(footballScheduleKey(row, sport), row);
  }
  for (const row of projected.filter((entry) => inFootballTrackingWeek(entry, sport, referenceDate))) {
    const key = footballScheduleKey(row, sport);
    const date = isoDate(row.Date || row["Game Date"] || "");

    if (sport === "NFL" && date && authoritativeDates.has(date)) {
      const scheduleMatch = authoritativeSchedule.find((candidate) => {
        const candidateDate = isoDate(candidate.Date || candidate["Game Date"] || "");
        return (
          candidateDate === date &&
          sameTeam(candidate["Away Team"], row["Away Team"], sport) &&
          sameTeam(candidate["Home Team"], row["Home Team"], sport)
        );
      });

      // The real schedule is the only allowed NFL matchup skeleton for a date
      // it covers. Attach model/projection fields to that scheduled matchup even
      // if the saved row carries a stale Game string or different Game ID.
      if (scheduleMatch) {
        const scheduleKey = footballScheduleKey(scheduleMatch, sport);
        const enriched = nonEmptyMerge(scheduleMatch, row);
        merged.set(scheduleKey, {
          ...enriched,
          Date: scheduleMatch.Date || enriched.Date || "",
          "Game Date": scheduleMatch["Game Date"] || scheduleMatch.Date || enriched["Game Date"] || "",
          "Game Time": scheduleMatch["Game Time"] || enriched["Game Time"] || "",
          "Game ID": scheduleMatch["Game ID"] || enriched["Game ID"] || "",
          Game: scheduleMatch.Game || enriched.Game || "",
          "Away Team": scheduleMatch["Away Team"] || enriched["Away Team"] || "",
          "Home Team": scheduleMatch["Home Team"] || enriched["Home Team"] || "",
        });
      }

      // If it does not match a real scheduled NFL game on that date, drop it.
      // This prevents stale/mismapped rows such as a NYG/LA row labeled NYG @ ATL
      // from becoming an extra expected game or duplicate display row.
      continue;
    }

    const authoritative = merged.get(key);
    if (sport === "NFL" && authoritative && authoritativeKeys.has(key)) {
      const enriched = nonEmptyMerge(authoritative, row);
      merged.set(key, {
        ...enriched,
        Date: authoritative.Date || enriched.Date || "",
        "Game Date": authoritative["Game Date"] || authoritative.Date || enriched["Game Date"] || "",
        "Game Time": authoritative["Game Time"] || enriched["Game Time"] || "",
        "Game ID": authoritative["Game ID"] || enriched["Game ID"] || "",
        Game: authoritative.Game || enriched.Game || "",
        "Away Team": authoritative["Away Team"] || enriched["Away Team"] || "",
        "Home Team": authoritative["Home Team"] || enriched["Home Team"] || "",
      });
      continue;
    }

    merged.set(key, nonEmptyMerge(merged.get(key) || {}, row));
  }
  return [...merged.values()].sort((a, b) => {
    const dateCompare = isoDate(a.Date || a["Game Date"] || "").localeCompare(isoDate(b.Date || b["Game Date"] || ""));
    if (dateCompare) return dateCompare;
    return parseEventTimeKey(gameTime(a)).localeCompare(parseEventTimeKey(gameTime(b)));
  });
}

function numericLine(value: unknown) {
  const matches = String(value || "").replace(/[−–—]/g, "-").match(/[+-]?\d+(?:\.\d+)?/g);
  const raw = matches?.length ? matches[matches.length - 1] : "";
  const number = raw ? Number(raw) : NaN;
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
  if (["W", "WIN", "WON"].includes(key)) return "W";
  if (["L", "LOSS", "LOST"].includes(key)) return "L";
  if (["P", "PUSH"].includes(key)) return "P";
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
    .replace(/<img\b[^>]*>/gi, " ")
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

function splitMatchesSlate(split: DraftKingsSplit, slate: SheetRow[], sport: FootballSport) {
  return slate.some((row) => {
    const rowDate = isoDate(row.Date || row["Game Date"] || "");
    return (!rowDate || !split.date || rowDate === split.date) && sameMatchup(row, split, sport);
  });
}

type LoadedDraftKingsSplits = {
  splits: DraftKingsSplit[];
  errors: string[];
  filter: {
    eventGroup: string;
    content: string;
    dateRange: string;
    label: string;
    source: string;
  };
  coverage: ScoresAndOddsMarketCoverage;
  missingPages: number[];
  retainedFallback?: boolean;
};

function splitCoverageGameKey(
  date: string,
  awayTeam: unknown,
  homeTeam: unknown,
  sport: FootballSport,
) {
  const teams = [normalizeTeam(awayTeam, sport), normalizeTeam(homeTeam, sport)]
    .filter(Boolean)
    .sort();
  return date && teams.length === 2 ? `${date}|${teams.join("|")}` : "";
}

function assessTrackingSlateCoverage(
  sport: FootballSport,
  splits: DraftKingsSplit[],
  slate: SheetRow[],
): ScoresAndOddsMarketCoverage {
  const today = todayET();
  const expected = new Map<string, string>();
  for (const row of slate) {
    const date = isoDate(row.Date || row["Game Date"] || "");
    if (!date || date < today) continue;
    const minutes = minutesUntilKickoff(row);
    if (date === today && (minutes == null || minutes <= 15)) continue;
    if (minutes != null && minutes <= 15) continue;
    const key = splitCoverageGameKey(date, row["Away Team"], row["Home Team"], sport);
    if (!key) continue;
    expected.set(key, `${String(row["Away Team"] || "")} @ ${String(row["Home Team"] || "")}`);
  }

  return assessScoresAndOddsMarketCoverage(
    expected,
    splits,
    (split) => splitCoverageGameKey(split.date, split.awayTeam, split.homeTeam, sport),
    (split) => split.market,
    (split) => split.market === "Spread"
      ? normalizeTeam(split.selectionTeam, sport)
      : split.side,
  );
}

function trackingCoverageFailure(report: ScoresAndOddsMarketCoverage) {
  return [
    report.missingGames.length ? `missing ${report.missingGames.join(", ")}` : "",
    report.incompleteGames.length ? `incomplete ${report.incompleteGames.join(", ")}` : "",
  ].filter(Boolean).join("; ") || "the returned NFL slate could not be verified as complete";
}

async function loadDraftKingsSplits(
  sport: FootballSport,
  slate: SheetRow[],
): Promise<LoadedDraftKingsSplits> {
  const sourceSport = sport === "NCAAF" ? "NCAAF" : "NFL";
  const loaded = await loadScoresAndOddsConsensus(sourceSport);
  const errors: string[] = [];
  const mapped: DraftKingsSplit[] = [];

  for (const source of loaded.splits) {
    if (source.market !== "Spread" && source.market !== "Total") continue;

    const probe: DraftKingsSplit = {
      date: "",
      eventTime: "",
      game: source.game,
      awayTeam: source.awayTeam,
      homeTeam: source.homeTeam,
      market: source.market,
      selection: source.selection,
      selectionTeam: source.selectionTeam,
      side: source.side,
      sideGroup: source.market === "Total"
        ? source.side
        : source.line != null && source.line < 0
          ? "Favorite"
          : source.line != null && source.line > 0
            ? "Underdog"
            : "",
      line: source.line,
      odds: source.odds,
      moneyPct: source.moneyPct,
      betsPct: source.betsPct,
      ...warningFor(source.betsPct, source.moneyPct),
      sourceUrl: source.sourceUrl,
    };
    const matched = slate.find((row) => sameMatchup(row, probe, sport));
    if (!matched) continue;

    const awayTeam = String(matched["Away Team"] || source.awayTeam).trim();
    const homeTeam = String(matched["Home Team"] || source.homeTeam).trim();
    const selectionTeam = source.market === "Spread"
      ? sameTeam(source.selectionTeam, source.awayTeam, sport)
        ? awayTeam
        : sameTeam(source.selectionTeam, source.homeTeam, sport)
          ? homeTeam
          : source.selectionTeam
      : "";
    const line = source.line;
    const selection = source.market === "Total"
      ? source.side
      : `${selectionTeam}${line == null ? "" : ` ${line > 0 ? "+" : ""}${line}`}`.trim();

    mapped.push({
      ...probe,
      date: isoDate(matched.Date || matched["Game Date"] || "") || source.date,
      eventTime: gameTime(matched),
      game: `${awayTeam} at ${homeTeam}`,
      awayTeam,
      homeTeam,
      selection,
      selectionTeam,
      sideGroup: source.market === "Total"
        ? source.side
        : line != null && line < 0
          ? "Favorite"
          : line != null && line > 0
            ? "Underdog"
            : "",
    });
  }

  const deduped = new Map<string, DraftKingsSplit>();
  for (const split of mapped) {
    const key =
      `${split.date}|${normalizeTeam(split.awayTeam, sport)}|${normalizeTeam(split.homeTeam, sport)}|` +
      `${split.market}|${normalizeTeam(split.market === "Total" ? split.side : split.selectionTeam, sport)}`;
    deduped.set(key, split);
  }
  const splits = [...deduped.values()];
  const coverage = assessTrackingSlateCoverage(sport, splits, slate);

  if (loaded.splits.length !== mapped.length) {
    errors.push(
      `ScoresAndOdds returned ${loaded.splits.length} parsed market sides; ${mapped.length} matched the tracked ${sport} slate before deduplication.`,
    );
  }

  const coverageAccepted = sport === "NFL" ? coverage.ok : splits.length > 0;
  if (!coverageAccepted) {
    const coverageFailure = sport === "NFL"
      ? trackingCoverageFailure(coverage)
      : "no NCAAF ScoresAndOdds market sides matched the tracked slate";
    throw new Error(
      `ScoresAndOdds ${sport} slate rejected: ${coverageFailure}. Received ${coverage.receivedGames} games and ${splits.length} usable market sides.`,
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
    coverage,
    missingPages: [],
  };
}

function snapshotKey(row: SheetRow) {
  const market = String(row.Market || "");
  const selection = market === "Total" ? String(row.Selection || row.Side || "") : String(row.Selection || "");
  return `${isoDate(row.Date)}|${textKey(row["Away Team"])}|${textKey(row["Home Team"])}|${textKey(market)}|${textKey(selection)}`;
}

function splitSnapshotKey(split: DraftKingsSplit) {
  return `${split.date}|${textKey(split.awayTeam)}|${textKey(split.homeTeam)}|${textKey(split.market)}|${textKey(split.market === "Total" ? split.side : split.selectionTeam)}`;
}

function rlmUsableBetsPct(value: unknown) {
  const parsed = Number(value);
  // 0% and 100% are immature first-scrape states, not usable RLM baselines.
  return Number.isFinite(parsed) && parsed > 0 && parsed < 100 ? parsed : null;
}

function movementForSplit(current: DraftKingsSplit, opening: SheetRow | undefined) {
  const savedOpeningPublicRaw = Number(opening?.["Opening Public %"]);
  const savedCurrentPublic = rlmUsableBetsPct(opening?.["Public Bets %"] ?? opening?.["Current Public %"]);
  const currentPublic = rlmUsableBetsPct(current.betsPct);
  const openingWasUnusable = !Number.isFinite(savedOpeningPublicRaw) || savedOpeningPublicRaw <= 0 || savedOpeningPublicRaw >= 100;

  // A 100% opening split is usually an immature first scrape, not a usable market baseline.
  // Advance the baseline to the earliest later non-100% snapshot and keep the line/price
  // from that same snapshot so bet-share movement and market movement are time-aligned.
  const useSavedCurrentAsOpening = openingWasUnusable && savedCurrentPublic != null;
  const useLiveCurrentAsOpening = openingWasUnusable && savedCurrentPublic == null && currentPublic != null;

  const openingLine = numericLine(
    useSavedCurrentAsOpening ? opening?.Line :
    useLiveCurrentAsOpening ? current.line :
    opening?.["Opening Line"] || opening?.Line || current.line
  );
  const openingOdds = String(
    useSavedCurrentAsOpening ? opening?.Odds :
    useLiveCurrentAsOpening ? current.odds :
    opening?.["Opening Odds"] || opening?.Odds || current.odds
  );
  const openingSnapshotTime = String(
    useSavedCurrentAsOpening ? opening?.["Snapshot Time ET"] :
    useLiveCurrentAsOpening ? current.snapshotTime || nowET() :
    opening?.["Opening Snapshot Time ET"] || opening?.["Snapshot Time ET"] || current.snapshotTime || nowET()
  );
  const openingPublic =
    useSavedCurrentAsOpening ? savedCurrentPublic! :
    useLiveCurrentAsOpening ? currentPublic! :
    rlmUsableBetsPct(opening?.["Opening Public %"]) ?? currentPublic ?? current.betsPct;
  const openingMoney = Number(
    useSavedCurrentAsOpening ? opening?.["Public Money %"] :
    useLiveCurrentAsOpening ? current.moneyPct :
    opening?.["Opening Sharp %"] || opening?.["Public Money %"] || current.moneyPct
  );

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
    // RLM baseline (all football): BET-SHARE CHANGE must move opposite the selected-side
    // market movement. Majority bet share by itself is never RLM.
    const canEvaluateRlm = currentPublic != null && openingPublic < 100;
    const opposite = canEvaluateRlm && Math.abs(publicMovementPct) >= 5 && publicMovementPct * value < 0;
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
    "Popularity Rank": "", Source: SCORES_AND_ODDS_SOURCE, "Match Confidence": "Weekly football market tracking", "Source URL": split.sourceUrl || "https://www.scoresandodds.com",
  };
}

function finiteSnapshotNumber(value: unknown) {
  if (value == null || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function draftKingsSplitFromStoredSnapshot(row: SheetRow, sport: FootballSport): DraftKingsSplit | null {
  const storedSource = String(row.Source || "").trim();
  if (storedSource && storedSource !== SCORES_AND_ODDS_SOURCE) return null;
  const date = isoDate(row.Date || row["Game Date"] || "");
  const awayTeam = String(row["Away Team"] || "").trim();
  const homeTeam = String(row["Home Team"] || "").trim();
  const marketKey = textKey(row.Market);
  const market: FootballMarket | null =
    marketKey === "spread" ? "Spread" :
    marketKey === "total" ? "Total" :
    null;
  const betsPct = finiteSnapshotNumber(row["Public Bets %"] ?? row["Current Public %"]);
  const moneyPct = finiteSnapshotNumber(row["Public Money %"] ?? row["Current Sharp %"]);
  if (!date || !awayTeam || !homeTeam || !market || betsPct == null || moneyPct == null) return null;

  const selection = String(row.Selection || "").trim();
  const line = numericLine(row.Line);
  const side: DraftKingsSplit["side"] = market === "Total"
    ? textKey(selection).startsWith("under") ? "Under" : textKey(selection).startsWith("over") ? "Over" : ""
    : "";
  const selectionTeam = market === "Spread" ? selection : "";
  if (market === "Total" && !side) return null;
  if (market === "Spread" && !selectionTeam) return null;

  const warning = warningFor(betsPct, moneyPct);
  const tone = String(row["Line Movement Tone"] || "").trim();
  const basis = String(row["Line Movement Basis"] || "").trim();
  return {
    date,
    eventTime: String(row["Game Time ET"] || row["Game Time"] || "").trim(),
    game: String(row.Game || `${awayTeam} at ${homeTeam}`).trim(),
    awayTeam,
    homeTeam,
    market,
    selection,
    selectionTeam,
    side,
    sideGroup: market === "Total"
      ? side
      : line != null && line < 0 ? "Favorite" : line != null && line > 0 ? "Underdog" : "",
    line,
    odds: String(row.Odds || "").trim(),
    moneyPct,
    betsPct,
    ...warning,
    openingLine: numericLine(row["Opening Line"]),
    openingOdds: String(row["Opening Odds"] || row.Odds || "").trim(),
    openingSnapshotTime: String(row["Opening Snapshot Time ET"] || row["Snapshot Time ET"] || "").trim(),
    openingBetsPct: finiteSnapshotNumber(row["Opening Public %"]) ?? betsPct,
    openingMoneyPct: finiteSnapshotNumber(row["Opening Sharp %"]) ?? moneyPct,
    openingImpliedPct: finiteSnapshotNumber(row["Opening Implied %"]),
    currentImpliedPct: finiteSnapshotNumber(row["Current Implied %"]),
    publicMovementPct: finiteSnapshotNumber(row["Public Change %"]) ?? 0,
    sharpMovementPct: finiteSnapshotNumber(row["Sharp Change %"]) ?? 0,
    lineMovementSignal: String(row["Line Movement Signal"] || "").trim(),
    lineMovementTone: (["negative", "caution", "positive", "neutral"].includes(tone) ? tone : "") as DraftKingsSplit["lineMovementTone"],
    lineMovementBasis: (["Implied Probability", "Spread Line", "Total Line"].includes(basis) ? basis : "") as DraftKingsSplit["lineMovementBasis"],
    lineMovementValue: finiteSnapshotNumber(row["Line Movement Value"]),
    snapshotTime: String(row["Snapshot Time ET"] || "").trim(),
    retained: true,
    sourceUrl: String(row["Source URL"] || "").trim() || "https://www.scoresandodds.com",
  };
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
  return rows.filter((row) => { const at = Date.parse(`${row.date}T12:00:00Z`); const diff = Math.round((ref - at) / 86400000); return Number.isFinite(diff) && diff > 0 && diff <= days; });
}
function windows(rows: SignalHistoryRow[], referenceDate: string): TrendWindowRecords {
  const prior = rows.filter((row) => Boolean(row.date) && row.date < referenceDate);
  return { allTime: trendRecord(prior), last30: trendRecord(withinDays(prior, referenceDate, 30)), last7: trendRecord(withinDays(prior, referenceDate, 7)) };
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
  if (!usable.length) return { score:TREND_NO_HISTORY_SCORE, hasData:false, roiPct:0, winPct:0 };
  const tw = usable.reduce((s,r)=>s+r.weight,0); const avg=(f:"roiPct"|"winPct")=>usable.reduce((s,r)=>s+r.record[f]*r.weight,0)/tw;
  const roiPct=avg("roiPct"), winPct=avg("winPct"); return { score: Math.max(0, Math.min(100, scaled(roiPct,ROI_POINTS)*.6 + scaled(winPct,WIN_POINTS)*.4)), hasData:true, roiPct, winPct };
}

function distinctText(values: unknown[]) {
  return [...new Set(values.map((value)=>String(value || "").trim()).filter(Boolean))];
}

function trendMarket(row: SheetRow): FootballMarket | null {
  const market = textKey(row.Market || row["Bet Type"]);
  if (market.includes("spread")) return "Spread";
  if (market.includes("total")) return "Total";
  return null;
}

function trendSideGroup(row: SheetRow, market: FootballMarket): TrendPlay["sideGroup"] {
  if (market === "Total") {
    const side = textKey(row.Side || row.Selection);
    return side.startsWith("under") ? "Under" : side.startsWith("over") ? "Over" : "";
  }
  const line = numericLine(row["Public Split Line"] || row.Line);
  return line == null || Math.abs(line) < 1e-9 ? "" : line < 0 ? "Favorite" : "Underdog";
}

function reconstructedTrendSignals(row: SheetRow) {
  const betsPct = Number(row["Public Bets %"]);
  const moneyPct = Number(row["Public Money %"]);
  const storedWarning = String(row["Public Warning"] || "").trim();
  if ((!Number.isFinite(betsPct) || !Number.isFinite(moneyPct)) && !storedWarning) return [];
  const warning = warningFor(
    Number.isFinite(betsPct) ? betsPct : 50,
    Number.isFinite(moneyPct) ? moneyPct : 50,
  );
  const signals: Array<{signalType:"Public Split"|"Line Movement";signalKey:string;signal:string;tone:Tone}> = [{
    signalType: "Public Split",
    signalKey: warning.warningKey,
    signal: storedWarning || warning.warning,
    tone: warning.warningTone,
  }];
  const movement = String(row["Line Movement Signal"] || "").trim();
  if (movement) {
    const storedTone = String(row["Line Movement Tone"] || "").trim().toLowerCase();
    signals.push({
      signalType: "Line Movement",
      signalKey: textKey(movement).toUpperCase().replace(/\s+/g, "_"),
      signal: movement,
      tone: storedTone === "positive" ? "positive" : storedTone === "caution" ? "caution" : "negative",
    });
  }
  return signals;
}

function historyFromTrendRows(rows: SheetRow[]): SignalHistoryRow[] {
  const output: SignalHistoryRow[] = [];
  for (const row of rows) {
    const result = resultCode(row.Result); if (!result) continue;
    const raw = String(row["Trend Score Details"] || "").trim();
    const resultSource = String(row["Result Source"] || "all_game_trends saved result").trim();
    const resultFallbackReason = String(row["Result Fallback Reason"] || "").trim();
    if (raw) {
      try {
        const play = JSON.parse(raw) as TrendPlay; const odds = parseOdds(row["Public Split Odds"] || row.Odds || play.odds);
        for (const signal of play.signals || []) output.push({
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
          historySource: `all_game_trends frozen signal + ${resultSource}`,
          fallbackReason: resultFallbackReason,
        });
        if ((play.signals || []).length) continue;
      } catch { /* reconstruct below from the saved split columns */ }
    }

    const market = trendMarket(row);
    if (!market) continue;
    const signals = reconstructedTrendSignals(row);
    if (!signals.length) continue;
    const sideGroup = trendSideGroup(row, market);
    const odds = parseOdds(row["Public Split Odds"] || row.Odds);
    for (const signal of signals) output.push({
      date: isoDate(row.Date),
      market,
      sideGroup,
      betType: String(row["Model Grade"] || row.Grade || market),
      modelVersion: String(row["Model Version"] || ""),
      qualified: ["TRUE", "YES", "1"].includes(String(row["Trend Play"] || row.Qualified || "").toUpperCase()) && !["", "PASS"].includes(String(row["Trend Tier"] || "").toUpperCase()),
      signalType: signal.signalType,
      signalKey: signal.signalKey,
      signal: signal.signal,
      tone: signal.tone,
      result,
      odds,
      units: result === "P" ? 0 : result === "L" ? -1 : profitUnits(odds),
      historySource: `all_game_trends saved split fields + ${resultSource}`,
      fallbackReason: distinctText([
        resultFallbackReason,
        "Trend Score Details missing; rebuilt the signal from saved public split fields.",
      ]).join(" • "),
    });
  }
  return output;
}

function signalBreakdown(signal: {signalType:"Public Split"|"Line Movement";signalKey:string;signal:string;tone:Tone}, market: FootballMarket, sideGroup: TrendPlay["sideGroup"], history: SignalHistoryRow[], referenceDate:string): TrendSignal {
  const same = history.filter((row)=>row.signalKey===signal.signalKey);
  const exactHistory = same.filter((row)=>row.market===market&&row.sideGroup===sideGroup);
  const marketHistory = same.filter((row)=>row.market===market);
  const exact=windows(exactHistory,referenceDate); const marketRows=windows(marketHistory,referenceDate); const overall=windows(same,referenceDate);
  const selectedHistory=exactHistory.length?exactHistory:marketHistory.length?marketHistory:same;
  const display=exact.allTime.totalBets?exact:marketRows.allTime.totalBets?marketRows:overall; const metrics=windowMetrics(display); const exactSample=exact.allTime.totalBets;
  const scopeFallback = exactSample
    ? ""
    : marketRows.allTime.totalBets
      ? `No exact ${market} • ${sideGroup || "side"} history; using ${market} history across both sides.`
      : overall.allTime.totalBets
        ? `No exact or ${market} history; using all tracked markets for this signal.`
        : "No settled history exists for this signal.";
  return { ...signal, tone: display.allTime.wins>display.allTime.losses?"positive":display.allTime.losses>display.allTime.wins?"negative":"neutral",
    category:`${signal.signal} • ${market} • ${sideGroup}`, recordScope: exactSample?`${market} • ${sideGroup}`:marketRows.allTime.totalBets?`${market} • all sides`:"All tracked markets", exactSample,
    TrendSampleSize:display.allTime.totalBets,
    HistorySource:distinctText(selectedHistory.map((row)=>row.historySource)).join(" + ")||"none",
    FallbackReason:distinctText([scopeFallback,...selectedHistory.map((row)=>row.fallbackReason)]).join(" • "),
    score:Math.round(exactSample?metrics.score:Math.min(metrics.score,TREND_BROAD_FALLBACK_SCORE_CAP)), weights:exactSample?{exact:1,market:0,overall:0}:marketRows.allTime.totalBets?{exact:0,market:1,overall:0}:overall.allTime.totalBets?{exact:0,market:0,overall:1}:{exact:0,market:0,overall:0}, records:display };
}

function buildTrendPlay(split: DraftKingsSplit, history: SignalHistoryRow[], referenceDate:string, row:SheetRow): TrendPlay {
  const primary=warningFor(split.betsPct,split.moneyPct); const active: Array<{signalType:"Public Split"|"Line Movement";signalKey:string;signal:string;tone:Tone}>=[{signalType:"Public Split",signalKey:primary.warningKey,signal:primary.warning,tone:primary.warningTone}];
  if(split.lineMovementSignal) active.push({signalType:"Line Movement",signalKey:textKey(split.lineMovementSignal).toUpperCase().replace(/\s+/g,"_"),signal:split.lineMovementSignal,tone:split.lineMovementTone==="positive"?"positive":"negative"});
  const signals=active.map((signal)=>signalBreakdown(signal,split.market,split.sideGroup,history,referenceDate)); const withHistory=signals.filter((signal)=>signal.records.allTime.totalBets>0); const baseScore=Math.round(withHistory.length?withHistory.reduce((s,x)=>s+x.score,0)/withHistory.length:TREND_NO_HISTORY_SCORE);
  const TrendSampleSize=Math.max(0,...signals.map((signal)=>signal.TrendSampleSize));
  const HistorySource=distinctText(signals.map((signal)=>signal.HistorySource)).join(" + ")||"none";
  const FallbackReason=distinctText(signals.map((signal)=>signal.FallbackReason)).join(" • ");
  const trendGameDate=isoDate(row.Date||row["Game Date"]||"")||split.date||referenceDate;
  return { date:trendGameDate, game:String(row.Game||`${row["Away Team"]} @ ${row["Home Team"]}`), gameKey:String(row["Game ID"]||row["Game Key"]||""), gameTime:gameTime(row), awayTeam:String(row["Away Team"]||""), homeTeam:String(row["Home Team"]||""), market:split.market,
    selection:split.market==="Total"?split.side:split.selectionTeam, selectionTeam:split.selectionTeam, side:split.side, sideGroup:split.sideGroup, line:split.line, odds:split.odds,
    betsPct:split.betsPct,moneyPct:split.moneyPct,gapPct:split.gapPct,openingBetsPct:split.openingBetsPct,openingMoneyPct:split.openingMoneyPct,publicMovementPct:split.publicMovementPct,sharpMovementPct:split.sharpMovementPct,openingLine:split.openingLine,openingOdds:split.openingOdds,openingImpliedPct:split.openingImpliedPct,currentImpliedPct:split.currentImpliedPct,lineMovementBasis:split.lineMovementBasis,lineMovementValue:split.lineMovementValue,score:baseScore,TrendSampleSize,HistorySource,FallbackReason,baseScore,tier:"Pass",signals,updatedAt:split.snapshotTime||nowET(),snapshotStatus:"LIVE" };
}

function footballTrendMetrics(play: TrendPlay) {
  const signals = (play.signals || [])
    .map((signal) => {
      const metrics = windowMetrics(signal.records);
      if (!metrics.hasData) return metrics;
      return {
        ...metrics,
        score: signal.exactSample > 0
          ? metrics.score
          : Math.min(metrics.score, TREND_BROAD_FALLBACK_SCORE_CAP),
      };
    })
    .filter((metrics) => metrics.hasData);
  if (!signals.length) return { score: play.baseScore ?? play.score ?? 0, roiPct: 0, winPct: 0, hasData: false };
  return {
    score: signals.reduce((sum, signal) => sum + signal.score, 0) / signals.length,
    roiPct: signals.reduce((sum, signal) => sum + signal.roiPct, 0) / signals.length,
    winPct: signals.reduce((sum, signal) => sum + signal.winPct, 0) / signals.length,
    hasData: true,
  };
}

function footballTrendRecordTone(record: TrendRecord): Tone {
  if (record.wins > record.losses) return "positive";
  if (record.losses > record.wins) return "negative";
  return "neutral";
}

function headToHead(plays: TrendPlay[]) {
  const baseRows = plays.map((play) => ({ play, metrics: footballTrendMetrics(play) }));
  return baseRows.map(({ play, metrics }) => {
    const opponents = baseRows
      .filter((candidate) =>
        candidate.play.gameKey === play.gameKey &&
        candidate.play.market === play.market &&
        textKey(candidate.play.selection) !== textKey(play.selection))
      .sort((a, b) =>
        b.metrics.score - a.metrics.score ||
        b.metrics.roiPct - a.metrics.roiPct ||
        b.metrics.winPct - a.metrics.winPct);
    const opponent = opponents[0];
    if (!opponent) return { ...play, baseScore: metrics.score, opponentScore: null, comparisonGap: 0, comparisonWinner: false, score: 0, tier: "Pass" as const };

    const rawGap = metrics.score - opponent.metrics.score;
    const comparisonGap = Math.abs(rawGap);
    const comparisonWinner = rawGap > 0.01;
    const candidateRoiPct = metrics.roiPct;
    const opponentRoiPct = opponent.metrics.roiPct;
    const netRoiAdvantage = candidateRoiPct - opponentRoiPct;
    const opponentLast7Green = opponent.play.signals.some(
      (signal) => footballTrendRecordTone(signal.records.last7) === "positive",
    );
    const allSignalsGreen = play.signals.length > 0 && play.signals.every((signal) => signal.tone === "positive");
    const eligible = Boolean(
      comparisonWinner &&
      metrics.hasData &&
      opponent.metrics.hasData &&
      candidateRoiPct > 0 &&
      netRoiAdvantage >= 15 &&
      !opponentLast7Green &&
      allSignalsGreen
    );
    const comparisonBonus = Math.min(5, comparisonGap / 5);
    const winnerScore = Math.min(100, metrics.score + comparisonBonus);
    const loserScore = Math.min(59, Math.max(0, metrics.score - comparisonBonus));
    const score = eligible ? winnerScore : loserScore;
    return {
      ...play,
      baseScore: metrics.score,
      opponentScore: opponent.metrics.score,
      comparisonGap,
      comparisonWinner,
      score,
      tier: !eligible || score < 60 ? "Pass" : score >= 85 ? "Elite" : score >= 69 ? "Strong" : "Good",
    };
  });
}

function findSlateForSplit(split:DraftKingsSplit,slate:SheetRow[],sport:FootballSport){return slate.find((row)=>(!isoDate(row.Date)||isoDate(row.Date)===split.date)&&sameMatchup(row,split,sport));}
function findSplitForSide(row:SheetRow,splits:DraftKingsSplit[],sport:FootballSport,market:FootballMarket,selection:string){return splits.find((split)=>split.market===market&&sameMatchup(row,split,sport)&&(market==="Total"?textKey(split.side)===textKey(selection):sameTeam(split.selectionTeam,selection,sport)));}

function modelTrendShells(row:SheetRow):SheetRow[]{
  const common={Date:isoDate(row.Date||row["Game Date"]||"")||todayET(),"Game Key":String(row["Game ID"]||row["Game Key"]||""),Game:String(row.Game||`${row["Away Team"]} @ ${row["Home Team"]}`),"Game Time":gameTime(row),"Away Team":String(row["Away Team"]||""),"Home Team":String(row["Home Team"]||""),"Model Version":String(row["Model Version"]||""),Result:"Pending"};
  const home=String(row["Home Team"]||""),away=String(row["Away Team"]||""); const spreadLine=Number(row["Market Home Spread"]||row["Home Spread"]||0); const totalLine=Number(row["Market Total"]||row.Total||0);
  const homeOdds=String(row["Home Spread Odds"]||row["Spread Odds"]||"-110"), awayOdds=String(row["Away Spread Odds"]||"-110"), overOdds=String(row["Total Over Odds"]||row["Total Odds"]||"-110"),underOdds=String(row["Total Under Odds"]||"-110");
  const spreadGrade=String(row["Spread Grade"]||"No Play"),totalGrade=String(row["Total Grade"]||"No Play"); const spreadPick=String(row["Spread Pick"]||""); const totalPick=String(row["Total Pick"]||"");
  return [
    {...common,Market:"Spread",Selection:home,Side:"",Line:String(spreadLine),Odds:homeOdds,"Odds/Line":`${spreadLine} / ${homeOdds}`,"Model Grade":sameTeam(spreadPick,home,"NCAAF" as FootballSport)?spreadGrade:"Research","Qualified":sameTeam(spreadPick,home,"NCAAF" as FootballSport)&&qualifiedFootballModelGrade(spreadGrade)?"TRUE":"FALSE","Model %":sameTeam(spreadPick,home,"NCAAF" as FootballSport)?String(row["Spread Probability"]||""):"","Edge %":sameTeam(spreadPick,home,"NCAAF" as FootballSport)?String(row["Spread Price Edge"]||row["Spread Edge"]||""):""},
    {...common,Market:"Spread",Selection:away,Side:"",Line:String(-spreadLine),Odds:awayOdds,"Odds/Line":`${-spreadLine} / ${awayOdds}`,"Model Grade":sameTeam(spreadPick,away,"NCAAF" as FootballSport)?spreadGrade:"Research","Qualified":sameTeam(spreadPick,away,"NCAAF" as FootballSport)&&qualifiedFootballModelGrade(spreadGrade)?"TRUE":"FALSE","Model %":sameTeam(spreadPick,away,"NCAAF" as FootballSport)?String(row["Spread Probability"]||""):"","Edge %":sameTeam(spreadPick,away,"NCAAF" as FootballSport)?String(row["Spread Price Edge"]||row["Spread Edge"]||""):""},
    {...common,Market:"Total",Selection:"Over",Side:"Over",Line:String(totalLine),Odds:overOdds,"Odds/Line":`${totalLine} / ${overOdds}`,"Model Grade":textKey(totalPick).startsWith("over")?totalGrade:"Research","Qualified":textKey(totalPick).startsWith("over")&&qualifiedFootballModelGrade(totalGrade)?"TRUE":"FALSE","Model %":textKey(totalPick).startsWith("over")?String(row["Total Probability"]||""):"","Edge %":textKey(totalPick).startsWith("over")?String(row["Total Price Edge"]||row["Total Edge"]||""):""},
    {...common,Market:"Total",Selection:"Under",Side:"Under",Line:String(totalLine),Odds:underOdds,"Odds/Line":`${totalLine} / ${underOdds}`,"Model Grade":textKey(totalPick).startsWith("under")?totalGrade:"Research","Qualified":textKey(totalPick).startsWith("under")&&qualifiedFootballModelGrade(totalGrade)?"TRUE":"FALSE","Model %":textKey(totalPick).startsWith("under")?String(row["Total Probability"]||""):"","Edge %":textKey(totalPick).startsWith("under")?String(row["Total Price Edge"]||row["Total Edge"]||""):""},
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

function resultLabel(code: ResultCode | "") {
  return code === "W" ? "Win" : code === "L" ? "Loss" : code === "P" ? "Push" : "";
}

function rowTeams(row: SheetRow) {
  const game = String(row.Game || row.Matchup || "").trim();
  const parts = game.split(/\s+@\s+/);
  return {
    away: String(row["Away Team"] || (parts.length === 2 ? parts[0] : "")).trim(),
    home: String(row["Home Team"] || (parts.length === 2 ? parts[1] : "")).trim(),
  };
}

function trendSettlementLine(row: SheetRow) {
  const publicLine = numericLine(row["Public Split Line"]);
  if (publicLine != null) return publicLine;
  const raw = String(row["Trend Score Details"] || "").trim();
  if (raw) {
    try {
      const savedLine = Number((JSON.parse(raw) as Partial<TrendPlay>).line);
      if (Number.isFinite(savedLine)) return savedLine;
    } catch { /* use the model row below */ }
  }
  return numericLine(row.Line);
}

function trendIdentitySelection(row: SheetRow, sport: FootballSport, market = trendMarket(row)) {
  if (market === "Total") {
    const side = textKey(row.Side || row.Selection);
    return side.startsWith("under") ? "under" : side.startsWith("over") ? "over" : "";
  }
  return market === "Spread" ? normalizeTeam(row.Selection, sport) : "";
}

function trendResultIdentity(row: SheetRow, sport: FootballSport) {
  const caseId = String(row["Case ID"] || row.CaseID || row["Candidate ID"] || "").trim();
  const gameId = String(row["Game ID"] || row["Game Key"] || "").trim();
  const market = trendMarket(row);
  const selection = trendIdentitySelection(row, sport, market) || "unknown";
  const teams = rowTeams(row);
  const gameIdentity = caseId
    ? `case:${caseId}`
    : gameId
      ? `game:${gameId}`
      : `teams:${isoDate(row.Date)}|${normalizeTeam(teams.away, sport)}|${normalizeTeam(teams.home, sport)}`;
  return `${gameIdentity}|${market || "unknown"}|${selection}`;
}

function gradeTrendRow(row: SheetRow, away: number, home: number, sport: FootballSport) {
  const market = trendMarket(row);
  const line = trendSettlementLine(row);
  if (!market || line == null) return "";
  if (market === "Spread") {
    const teams = rowTeams(row);
    const selectedHome = sameTeam(row.Selection, teams.home, sport);
    const selectedAway = sameTeam(row.Selection, teams.away, sport);
    if (!selectedHome && !selectedAway) return "";
    const value = (selectedHome ? home - away : away - home) + line;
    return value > 0 ? "Win" : value < 0 ? "Loss" : "Push";
  }
  const side = trendIdentitySelection(row, sport, market);
  if (!side) return "";
  const value = away + home - line;
  return Math.abs(value) < 1e-9
    ? "Push"
    : side === "under"
      ? value < 0 ? "Win" : "Loss"
      : value > 0 ? "Win" : "Loss";
}

function finalGameForTrend(row: SheetRow, finals: SheetRow[], sport: FootballSport) {
  const rowId = String(row["Game Key"] || row["Game ID"] || "").trim();
  const rowDate = isoDate(row.Date || row["Game Date"] || "");
  const rowMatchup = rowTeams(row);
  return finals.find((game)=>{
    const gameId = String(game["Game ID"] || game["Game Key"] || "").trim();
    if (rowId && gameId) return rowId === gameId;
    const gameDate = isoDate(game.Date || game["Game Date"] || "");
    if (rowDate && gameDate && rowDate !== gameDate) return false;
    return Boolean(
      rowMatchup.away && rowMatchup.home &&
      sameTeam(game["Away Team"], rowMatchup.away, sport) &&
      sameTeam(game["Home Team"], rowMatchup.home, sport)
    );
  });
}

function settleTrendRows(rows:SheetRow[],schedule:SheetRow[],sport:FootballSport){
  const finals=schedule.filter((row)=>truthy(row.Completed)||((row["Away Score"]??"")!==""&&(row["Home Score"]??"")!==""));
  return rows.map((row)=>{
    if(resultCode(row.Result)) return row;
    const game=finalGameForTrend(row,finals,sport);
    if(!game)return row;
    const away=finiteSnapshotNumber(game["Away Score"]),home=finiteSnapshotNumber(game["Home Score"]);
    if(away==null||home==null)return row;
    const result=gradeTrendRow(row,away,home,sport);
    if(!result)return row;
    return {...row,Result:result,"Actual Away Runs":String(away),"Actual Home Runs":String(home),"Actual Total":String(away+home),"Result Updated":nowET(),"Result Source":"schedule final","Result Fallback Reason":"","Result Match Key":trendResultIdentity(row,sport)};
  });
}

function trackerMatchesTrendRow(tracker: SheetRow, trend: SheetRow, sport: FootballSport) {
  const trackerCase = String(tracker["Case ID"] || tracker.CaseID || tracker["Candidate ID"] || "").trim();
  const trendCase = String(trend["Case ID"] || trend.CaseID || trend["Candidate ID"] || "").trim();
  const trackerId = String(tracker["Game ID"] || tracker["Game Key"] || "").trim();
  const trendId = String(trend["Game ID"] || trend["Game Key"] || "").trim();
  const identityMatches = trackerCase && trendCase
    ? trackerCase === trendCase
    : Boolean(trackerId && trendId && trackerId === trendId);
  if (!identityMatches) return false;

  const trackerMarket = trendMarket(tracker);
  const trendRowMarket = trendMarket(trend);
  if (!trackerMarket || trackerMarket !== trendRowMarket) return false;
  if (trackerMarket === "Total") {
    return trendIdentitySelection(tracker, sport, trackerMarket) === trendIdentitySelection(trend, sport, trendRowMarket);
  }
  return sameTeam(tracker.Selection, trend.Selection, sport);
}

function settleTrendRowsFromTracker(rows: SheetRow[], trackerRows: SheetRow[], sport: FootballSport) {
  const completedTrackerRows = trackerRows.filter((row)=>resultCode(row.Result || row.Status));
  return rows.map((row)=>{
    if (resultCode(row.Result)) return row;
    const tracker = completedTrackerRows.find((candidate)=>trackerMatchesTrendRow(candidate,row,sport));
    if (!tracker) return row;

    const away = finiteSnapshotNumber(tracker["Actual Away"] ?? tracker["Actual Away Runs"]);
    const home = finiteSnapshotNumber(tracker["Actual Home"] ?? tracker["Actual Home Runs"]);
    let result = away != null && home != null ? gradeTrendRow(row,away,home,sport) : "";
    let fallbackReason = "No completed schedule row; matched the settled tracker by Case ID or Game ID + market + side and regraded the exact trend line.";
    if (!result) {
      const trendLine = trendSettlementLine(row);
      const trackerLine = numericLine(tracker.Selection);
      if (trendLine == null || trackerLine == null || Math.abs(trendLine-trackerLine)>1e-9) return row;
      result = resultLabel(resultCode(tracker.Result || tracker.Status));
      fallbackReason = "No completed schedule scores; copied the settled tracker result after an exact Game ID + market + side + line match.";
    }
    if (!result) return row;
    return {
      ...row,
      Result: result,
      ...(away != null ? {"Actual Away Runs":String(away)} : {}),
      ...(home != null ? {"Actual Home Runs":String(home)} : {}),
      ...(away != null && home != null ? {"Actual Total":String(away+home)} : {}),
      "Result Updated":nowET(),
      "Result Source":"bet_tracker exact fallback",
      "Result Fallback Reason":fallbackReason,
      "Result Match Key":trendResultIdentity(row,sport),
    };
  });
}

const FOOTBALL_TRACKER_HEADERS = [
  "Date", "Season", "Week", "Game ID", "Game", "Bet Type", "Selection", "Odds/Line",
  "Model Probability", "Push Probability", "Implied Probability", "Edge", "Expected Value",
  "Grade", "Confluence", "Result", "Units", "Closing Line", "Closing Line Value", "Reliability",
  "Data Confidence", "Personnel Confidence", "Projected Away", "Projected Home", "Actual Away",
  "Actual Home", "Margin Residual", "Total Residual", "Model Version", "Notes",
];

function trackerLine(value: unknown) {
  const match = String(value || "").replace(/[−–—]/g, "-").match(/([+-]?\d+(?:\.\d+)?)\s*$/);
  const number = match ? Number(match[1]) : NaN;
  return Number.isFinite(number) ? number : null;
}

function cfbProjectionOnlySpread(row: SheetRow) {
  const marketKey = textKey(row["Bet Type"] || row.Market);
  if (marketKey && !marketKey.includes("spread")) return false;
  const savedMarketSpread = Number(row["Market Home Spread"]);
  if (Number.isFinite(savedMarketSpread)) return Math.abs(savedMarketSpread) >= 20;
  const line = trackerLine(row.Selection || row["Spread Pick"]);
  return line != null && Math.abs(line) >= 20;
}

function trackerKey(row: SheetRow) {
  return [isoDate(row.Date), String(row["Game ID"] || row["Game Key"] || ""), textKey(row["Bet Type"] || row.Market), textKey(row.Selection)].join("|");
}

function trackerFinal(row: SheetRow, schedule: SheetRow[], sport: FootballSport) {
  const rowId = String(row["Game ID"] || row["Game Key"] || "").trim();
  const gameLabel = String(row.Game || row.Matchup || "").trim();
  const parts = gameLabel.split(/\s+@\s+/);
  const rowAway = String(row["Away Team"] || (parts.length === 2 ? parts[0] : "")).trim();
  const rowHome = String(row["Home Team"] || (parts.length === 2 ? parts[1] : "")).trim();
  return schedule.find((game) => {
    const complete = truthy(game.Completed) || (String(game["Away Score"] ?? "") !== "" && String(game["Home Score"] ?? "") !== "");
    if (!complete) return false;
    const gameId = String(game["Game ID"] || game["Game Key"] || "").trim();
    if (rowId && gameId && rowId === gameId) return true;
    return Boolean(rowAway && rowHome && sameTeam(rowAway, game["Away Team"], sport) && sameTeam(rowHome, game["Home Team"], sport));
  });
}

function settleBestPlayTracker(rows: SheetRow[], schedule: SheetRow[], sport: FootballSport) {
  const changed: SheetRow[] = [];
  const settled: SheetRow[] = rows.map((row): SheetRow => {
    if (resultCode(row.Result || row.Status)) return row;
    const game = trackerFinal(row, schedule, sport);
    if (!game) return row;
    const away = Number(game["Away Score"]), home = Number(game["Home Score"]);
    if (!Number.isFinite(away) || !Number.isFinite(home)) return row;
    const market = textKey(row["Bet Type"] || row.Market);
    const selection = String(row.Selection || "").trim();
    const line = trackerLine(selection);
    if (line == null) return row;
    let result = "";
    if (market.includes("spread")) {
      const team = selection.replace(/\s+[+-]?\d+(?:\.\d+)?\s*$/, "").trim();
      const isHome = sameTeam(team, game["Home Team"], sport);
      const isAway = sameTeam(team, game["Away Team"], sport);
      if (!isHome && !isAway) return row;
      const value = (isHome ? home - away : away - home) + line;
      result = value > 0 ? "Win" : value < 0 ? "Loss" : "Push";
    } else if (market.includes("total")) {
      const value = away + home - line;
      const side = textKey(selection).startsWith("under") ? "under" : textKey(selection).startsWith("over") ? "over" : "";
      if (!side) return row;
      result = Math.abs(value) < 1e-9 ? "Push" : side === "under" ? (value < 0 ? "Win" : "Loss") : (value > 0 ? "Win" : "Loss");
    } else return row;
    const code = resultCode(result);
    const odds = parseOdds(row["Odds/Line"] || row.Odds || -110);
    const units = code === "W" ? profitUnits(odds) : code === "L" ? -1 : 0;
    const updated: SheetRow = { ...row, Result: result, Units: String(Math.round(units * 10000) / 10000), "Actual Away": String(away), "Actual Home": String(home) };
    changed.push(updated);
    return updated;
  });
  return { settled, changed };
}

function recordTotals(rows:SheetRow[],days?:number){
  const now=Date.parse(`${todayET()}T12:00:00Z`);let wins=0,losses=0,pushes=0,units=0;
  for(const row of rows){const result=resultCode(row.Result||row.Status);if(!result)continue;if(days){const d=Date.parse(`${isoDate(row.Date)}T12:00:00Z`);const diff=Math.round((now-d)/86400000);if(!Number.isFinite(diff)||diff<0||diff>=days)continue;}const odds=parseOdds(row.Odds||row["Odds/Line"]||-110);if(result==="W"){wins++;units+=profitUnits(odds);}else if(result==="L"){losses++;units-=1;}else pushes++;}
  const total=wins+losses+pushes,decisions=wins+losses;return{label:"",record:`${wins}-${losses}-${pushes}`,totalBets:total,winPct:decisions?Math.round(wins/decisions*1000)/10:0,unitsWon:Math.round(units*100)/100,roiPct:total?Math.round(units/total*1000)/10:0,wins,losses,pushes};
}

function qualifiedFootballModelGrade(value: unknown) {
  const grade = textKey(value);
  return Boolean(grade) &&
    !grade.includes("no play") &&
    !grade.includes("non edge") &&
    grade !== "research" &&
    grade !== "projection only" &&
    grade !== "no market line";
}

const NFL_YARDAGE_PROP_MARKETS = new Set(["passing yards", "rushing yards", "receiving yards"]);

function finitePropNumber(value: unknown) {
  const parsed = Number(String(value ?? "").replace("%", "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function isNflYardagePropRow(row: SheetRow) {
  return NFL_YARDAGE_PROP_MARKETS.has(textKey(row.Market || row["Bet Type"]));
}

function nflYardagePropMetrics(row: SheetRow) {
  if (!isNflYardagePropRow(row)) return null;
  const marketKey = textKey(row.Market || row["Bet Type"]);
  const marketLine = finitePropNumber(row["Market Line"] ?? row.Line ?? row["Prop Line"]);
  const probabilityEdgeRaw = finitePropNumber(row["Probability Edge"] ?? row.Edge);
  if (marketLine == null || marketLine <= 0 || probabilityEdgeRaw == null) return null;
  if ((marketKey === "receiving yards" || marketKey === "rushing yards") && marketLine > 200) return null;
  if (marketKey === "passing yards" && (marketLine < 100 || marketLine > 400)) return null;

  const storedProjectionEdge = finitePropNumber(row["Projection Edge"]);
  const projection = finitePropNumber(row.Projection);
  const projectionGap =
    storedProjectionEdge != null
      ? Math.abs(storedProjectionEdge)
      : projection != null
        ? Math.abs(projection - marketLine)
        : null;
  if (projectionGap == null) return null;

  const probabilityEdgePct = probabilityEdgeRaw <= 1 ? probabilityEdgeRaw * 100 : probabilityEdgeRaw;
  const projectionGapPct = (projectionGap / Math.abs(marketLine)) * 100;
  return { marketLine, probabilityEdgePct, projectionGap, projectionGapPct };
}

function nflYardagePropTier(row: SheetRow) {
  const metrics = nflYardagePropMetrics(row);
  if (!metrics) return "";
  if (metrics.projectionGapPct < 30 || metrics.probabilityEdgePct < 12) return "Non-Edge";
  if (metrics.probabilityEdgePct >= 30) return "Strong";
  if (metrics.probabilityEdgePct >= 16) return "Regular";
  return "Lean";
}

function applyNflYardagePropGrade(row: SheetRow): SheetRow {
  const tier = nflYardagePropTier(row);
  if (!tier) return row;
  const metrics = nflYardagePropMetrics(row);
  return {
    ...row,
    Grade: tier,
    "Yardage Prop Tier": tier,
    ...(metrics ? {
      "Projection Gap %": String(Math.round(metrics.projectionGapPct * 10) / 10),
      "Probability Edge %": String(Math.round(metrics.probabilityEdgePct * 10) / 10),
    } : {}),
  };
}

function qualifiedNflPropGrade(value: unknown) {
  const grade = textKey(value);
  return grade === "a prop" || grade === "b prop";
}

function qualifiedNflPropRow(row: SheetRow) {
  if (isNflYardagePropRow(row)) {
    const tier = nflYardagePropTier(row);
    return tier === "Strong" || tier === "Regular" || tier === "Lean";
  }
  return qualifiedNflPropGrade(row.Grade || row["Model Grade"]);
}

function nflEzpzYardagePropGrade(value: unknown) {
  const grade = textKey(value);
  return grade === "strong" || grade === "regular";
}

function playerPropTeams(row: SheetRow) {
  const game = String(row.Game || "").trim();
  const parts = game.split(/\s+(?:@|at)\s+/i).map((part) => part.trim()).filter(Boolean);
  if (parts.length === 2) return { away: parts[0], home: parts[1] };
  const team = String(row.Team || "").trim();
  const opponent = String(row.Opponent || "").trim();
  return textKey(row["Home/Away"]) === "home"
    ? { away: opponent, home: team }
    : { away: team, home: opponent };
}

function bestPlays(slate:SheetRow[],sport:FootballSport){
  const plays:any[]=[];for(const row of slate){const game=String(row.Game||`${row["Away Team"]} @ ${row["Home Team"]}`),away=String(row["Away Team"]||""),home=String(row["Home Team"]||"");
    const sg=String(row["Spread Grade"]||"");if(qualifiedFootballModelGrade(sg) && !(sport==="NCAAF" && cfbProjectionOnlySpread(row))){const pick=String(row["Spread Pick"]||"");plays.push({playType:sg,game,play:pick,oddsLine:String(row["Spread Odds"]||row["Market Home Spread"]||""),score:String(row["Spread Probability"]||""),isGreen:true,awayTeam:away,homeTeam:home,reliability:row.Reliability,selectedProbability:row["Spread Probability"],modelVersion:row["Model Version"],role:"Spread",publicBetsPct:row["Spread Public Bets %"],publicMoneyPct:row["Spread Public Money %"]});}
    const tg=String(row["Total Grade"]||"");if(qualifiedFootballModelGrade(tg)){plays.push({playType:tg,game,play:String(row["Total Pick"]||""),oddsLine:String(row["Total Odds"]||row["Market Total"]||""),score:String(row["Total Probability"]||""),isGreen:true,awayTeam:away,homeTeam:home,reliability:row.Reliability,selectedProbability:row["Total Probability"],modelVersion:row["Model Version"],role:"Total"});}
  }return plays;
}

function nflPlayerPropBestPlays(propRows: SheetRow[], slate: SheetRow[], today: string) {
  return propRows
    .filter((row) => isoDate(row.Date || row["Game Date"] || "") === today)
    .filter((row) => qualifiedNflPropRow(row))
    .filter((row) => {
      const gameId = String(row["Game ID"] || row["Game Key"] || "").trim();
      const teams = playerPropTeams(row);
      return slate.some((game) => {
        const slateId = String(game["Game ID"] || game["Game Key"] || "").trim();
        if (gameId && slateId && gameId === slateId) return true;
        return sameTeam(teams.away, game["Away Team"], "NFL") && sameTeam(teams.home, game["Home Team"], "NFL");
      });
    })
    .map((row) => {
      const teams = playerPropTeams(row);
      const market = String(row.Market || "Player Prop").trim();
      const player = String(row.Player || "").trim();
      const pick = String(row.Pick || "").trim();
      const grade = String(row.Grade || "").trim();
      return {
        playType: grade,
        game: `${teams.away} @ ${teams.home}`,
        play: `${player} ${market} ${pick}`.replace(/\s+/g, " ").trim(),
        oddsLine: String(row["Pick Odds"] || ""),
        score: String(row["Model Probability"] || ""),
        isGreen: true,
        awayTeam: teams.away,
        homeTeam: teams.home,
        reliability: row.Reliability,
        selectedProbability: row["Model Probability"],
        modelVersion: row["Model Version"],
        role: `Player Prop • ${market}`,
      };
    })
    .sort((a, b) => {
      const gradeRank = (value: unknown) => {
        const grade = textKey(value);
        if (grade === "strong") return 5;
        if (grade === "regular") return 4;
        if (grade === "lean") return 3;
        if (grade === "a prop") return 2;
        if (grade === "b prop") return 1;
        return 0;
      };
      const gradeDiff = gradeRank(b.playType) - gradeRank(a.playType);
      if (gradeDiff) return gradeDiff;
      return Number(b.score || 0) - Number(a.score || 0);
    });
}

function nflYardagePropRecordKey(row: SheetRow) {
  const tier = textKey(row.Grade || row["Yardage Prop Tier"] || nflYardagePropTier(row));
  const market = textKey(row.Market || row["Bet Type"]);
  const direction = textKey(row.Pick || row.Side || row.Selection).startsWith("under")
    ? "under"
    : textKey(row.Pick || row.Side || row.Selection).startsWith("over")
      ? "over"
      : "";
  return tier && market && direction ? `${tier}|${market}|${direction}` : "";
}

function nflYardagePropLastSevenRecord(rows: SheetRow[], current: SheetRow, beforeDate: string) {
  const key = nflYardagePropRecordKey(current);
  if (!key) return recordTotals([]);
  const completed = rows
    .map((row, index) => ({
      row,
      index,
      date: isoDate(row.Date || row["Game Date"] || ""),
      stamp: Date.parse(`${isoDate(row.Date || row["Game Date"] || "")}T12:00:00Z`) || 0,
    }))
    .filter(({ row, date }) =>
      Boolean(date && date < beforeDate && resultCode(row.Result || row.Status)) &&
      nflYardagePropRecordKey(row) === key
    )
    .sort((a, b) => b.stamp - a.stamp || b.index - a.index)
    .slice(0, 7)
    .map(({ row }) => row);
  return recordTotals(completed);
}

function nflPlayerPropEzpzPicks(propRows: SheetRow[], slate: SheetRow[], today: string): FootballEzpzPick[] {
  return propRows
    .filter((row) => isoDate(row.Date || row["Game Date"] || "") === today)
    .filter((row) => isNflYardagePropRow(row) && nflEzpzYardagePropGrade(row.Grade))
    .filter((row) => {
      const gameId = String(row["Game ID"] || row["Game Key"] || "").trim();
      const teams = playerPropTeams(row);
      return slate.some((game) => {
        const slateId = String(game["Game ID"] || game["Game Key"] || "").trim();
        if (gameId && slateId && gameId === slateId) return true;
        return sameTeam(teams.away, game["Away Team"], "NFL") && sameTeam(teams.home, game["Home Team"], "NFL");
      });
    })
    .map((row) => {
      const teams = playerPropTeams(row);
      const metrics = nflYardagePropMetrics(row);
      const rawProbability = finitePropNumber(row["Model Probability"]);
      const score = rawProbability == null ? 0 : rawProbability <= 1 ? rawProbability * 100 : rawProbability;
      const grade = String(row.Grade || "").trim();
      const player = String(row.Player || "").trim();
      const market = String(row.Market || "").trim();
      const pick = String(row.Pick || "").trim();
      const line = String(row["Market Line"] || "").trim();
      const side = textKey(pick).startsWith("under") ? "Under" : textKey(pick).startsWith("over") ? "Over" : "";
      const oddsValue = Number(row["Pick Odds"]);
      const odds = Number.isFinite(oddsValue) ? (oddsValue > 0 ? `+${oddsValue}` : String(oddsValue)) : String(row["Pick Odds"] || "");
      const lastSeven = nflYardagePropLastSevenRecord(propRows, row, today);
      return {
        source: "Best Play" as const,
        game: `${teams.away} @ ${teams.home}`,
        market: "Player Prop" as const,
        selection: pick,
        odds,
        score: Math.round(score * 10) / 10,
        tier: grade,
        qualification: `${grade} yardage prop • edge ${metrics ? metrics.probabilityEdgePct.toFixed(1) : "—"}% • projection gap ${metrics ? metrics.projectionGapPct.toFixed(1) : "—"}%`,
        record: lastSeven.record,
        playerName: player,
        playerTeam: String(row.Team || "").trim(),
        propMarket: market,
        propSide: side,
        propLine: line,
        propProjection: String(row.Projection || ""),
        modelGapPct: metrics ? Math.round(metrics.projectionGapPct * 10) / 10 : undefined,
        predictedWinPct: Math.round(score * 10) / 10,
        impliedProbabilityPct: (() => {
          const implied = finitePropNumber(row["Implied Probability"]);
          return implied == null ? undefined : Math.round((implied <= 1 ? implied * 100 : implied) * 10) / 10;
        })(),
      };
    })
    .sort((a, b) => {
      const rank = (tier: string) => textKey(tier) === "strong" ? 2 : 1;
      return rank(b.tier) - rank(a.tier) || b.score - a.score;
    });
}

type FootballEzpzPick = {
  source: "Best Play" | "Trend Play" | "Best + Trend";
  game: string;
  market: "Spread" | "Total" | "Player Prop";
  selection: string;
  odds: string;
  score: number;
  tier: string;
  qualification: string;
  record?: string;
  betsPct?: number;
  moneyPct?: number;
  gapPct?: number;
  publicSideBetsPct?: number;
  publicSideMoneyPct?: number;
  publicMovePct?: number;
  lineMoveValue?: number;
  playerName?: string;
  playerTeam?: string;
  propMarket?: string;
  propSide?: string;
  propLine?: string;
  propProjection?: string;
  modelGapPct?: number;
  predictedWinPct?: number;
  impliedProbabilityPct?: number;
};

function americanOddsText(value: unknown) {
  const raw = String(value || "").trim();
  const match = raw.match(/(?:^|\s)([+-]\d{3,})(?:\s|$)/);
  if (!match) return "";
  const odds = Number(match[1]);
  return Number.isFinite(odds) && Math.abs(odds) >= 100 ? match[1] : "";
}

type FootballBestRecordType = string;

const CFB_MODEL_RECORD_TYPES: FootballBestRecordType[] = [
  "A Spread Favorite",
  "A Spread Underdog",
  "A Points/Total Over",
  "A Points/Total Under",
  "B Spread Favorite",
  "B Spread Underdog",
  "B Points/Total Over",
  "B Points/Total Under",
];

function footballGradeBucket(value: unknown) {
  const grade = textKey(value);
  if (grade === "a" || grade.startsWith("a ")) return "A";
  if (grade === "b" || grade.startsWith("b ")) return "B";
  return "";
}

function footballCfbRecordType(base: FootballBestRecordType, gradeValue: unknown): FootballBestRecordType {
  const grade = footballGradeBucket(gradeValue);
  if (!grade) return base;
  if (base === "Favorite Spread") return `${grade} Spread Favorite`;
  if (base === "Underdog Spread") return `${grade} Spread Underdog`;
  if (base === "Over") return `${grade} Points/Total Over`;
  if (base === "Under") return `${grade} Points/Total Under`;
  return `${grade} ${base}`.trim();
}

function footballTrackerRecordType(row: SheetRow, sport: FootballSport): FootballBestRecordType | "" {
  const marketKey = textKey(row["Bet Type"] || row.Market);
  if (sport !== "NCAAF") return marketKey.includes("total") ? "Total" : marketKey.includes("spread") ? "Spread" : "";
  if (cfbProjectionOnlySpread(row)) return "";
  let base: FootballBestRecordType | "" = "";
  if (marketKey.includes("total")) {
    const side = textKey(row.Selection);
    base = side.startsWith("under") ? "Under" : side.startsWith("over") ? "Over" : "";
  } else if (marketKey.includes("spread")) {
    const line = trackerLine(row.Selection);
    base = line == null || Math.abs(line) < 1e-9 ? "" : line < 0 ? "Favorite Spread" : "Underdog Spread";
  }
  return base ? footballCfbRecordType(base, row.Grade || row["Model Grade"]) : "";
}

function footballLastSevenForType(rows: SheetRow[], recordType: FootballBestRecordType, sport: FootballSport, beforeDate: string) {
  const completed = rows
    .map((row, index) => ({ row, index, stamp: Date.parse(`${isoDate(row.Date)}T12:00:00Z`) || 0 }))
    .filter(({ row }) => {
      const rowDate = isoDate(row.Date || row["Game Date"] || "");
      return Boolean(resultCode(row.Result || row.Status))
        && footballTrackerRecordType(row, sport) === recordType
        && Boolean(rowDate && rowDate < beforeDate);
    })
    .sort((a, b) => b.stamp - a.stamp || b.index - a.index)
    .slice(0, 7)
    .map(({ row }) => row);
  return recordTotals(completed);
}

function footballBestForm(record: ReturnType<typeof recordTotals>) {
  if (record.totalBets < 7) return "SAMPLE" as const;
  if (record.wins >= 5) return "HOT" as const;
  if (record.losses >= 5) return "COLD" as const;
  return "NEUTRAL" as const;
}

function footballBestPlaySplit(play: any, splits: DraftKingsSplit[], sport: FootballSport) {
  const sameGame = (split: DraftKingsSplit) =>
    textKey(split.game) === textKey(play.game) ||
    (sameTeam(play.awayTeam, split.awayTeam, sport) && sameTeam(play.homeTeam, split.homeTeam, sport));
  const market = textKey(play.role || play.playType).includes("total") ? "Total" : "Spread";
  if (market === "Total") {
    const side = textKey(play.play).startsWith("under") ? "Under" : "Over";
    return splits.find((split) => split.market === "Total" && split.side === side && sameGame(split));
  }
  const selection = String(play.play || "").replace(/\s+[+-]?\d+(?:\.\d+)?\s*$/, "").trim();
  return splits.find((split) => split.market === "Spread" && sameGame(split) && sameTeam(split.selectionTeam, selection, sport));
}

function footballBestPlayRecordType(play: any, split: DraftKingsSplit | undefined, sport: FootballSport): FootballBestRecordType {
  const market: "Spread" | "Total" = textKey(play.role || play.playType).includes("total") ? "Total" : "Spread";
  if (sport !== "NCAAF") return market;
  let base: FootballBestRecordType;
  if (market === "Total") {
    base = split?.side === "Under" || textKey(play.play).startsWith("under") ? "Under" : "Over";
  } else if (split?.sideGroup === "Favorite" || split?.sideGroup === "Underdog") {
    base = `${split.sideGroup} Spread`;
  } else {
    const line = split?.line ?? trackerLine(play.play);
    base = line != null && line > 0 ? "Underdog Spread" : "Favorite Spread";
  }
  return footballCfbRecordType(base, play.playType || play.grade || play["Model Grade"]);
}

const PUBLIC_FADE_MIN_BETS_PCT = 75;
const PUBLIC_FADE_MIN_TICKET_MONEY_GAP_PCT = 55;
const RLM_MIN_PUBLIC_MOVE_PCT = 5;
const RLM_MIN_MARKET_MOVE_POINTS = 1.5;
const EZPZ_SHARP_MIN_MONEY_OVER_BETS_PCT: Record<FootballSport, number> = { NFL: 25, NCAAF: 40 };

function sameTrendSplitGame(play: TrendPlay, split: DraftKingsSplit, sport: FootballSport) {
  return sameTeam(play.awayTeam, split.awayTeam, sport)
    && sameTeam(play.homeTeam, split.homeTeam, sport);
}

function oppositeDraftKingsSplit(play: TrendPlay, splits: DraftKingsSplit[], sport: FootballSport) {
  const sideKey = play.market === "Total" ? textKey(play.side) : textKey(play.selection);
  return splits.find((candidate) => {
    if (!sameTrendSplitGame(play, candidate, sport) || candidate.market !== play.market) return false;
    const candidateSide = candidate.market === "Total"
      ? textKey(candidate.side)
      : textKey(candidate.selectionTeam);
    return candidateSide !== sideKey;
  });
}

function isPublicFadeSource(play: DraftKingsSplit, sport: FootballSport) {
  const bets = Number(play.betsPct);
  const money = Number(play.moneyPct);
  if (!Number.isFinite(bets) || !Number.isFinite(money)) return false;

  // NFL Public Fade is intentionally simple: fade any side/total drawing 80%+
  // of tickets. CFB keeps the stricter 75%+ / 55-point ticket-vs-money rule.
  if (sport === "NFL") return bets >= 80;
  return bets > PUBLIC_FADE_MIN_BETS_PCT
    && bets - money >= PUBLIC_FADE_MIN_TICKET_MONEY_GAP_PCT;
}

function isRlmSource(play: DraftKingsSplit) {
  const openingBets = Number(play.openingBetsPct);
  const publicMove = Number(play.publicMovementPct);
  const lineMove = Number(play.lineMovementValue);
  const basis = String(play.lineMovementBasis || "");
  const marketMatches =
    (play.market === "Spread" && basis.includes("Spread")) ||
    (play.market === "Total" && basis.includes("Total"));

  return marketMatches
    && openingBets > 0
    && openingBets < 100
    && Number.isFinite(publicMove)
    && publicMove >= RLM_MIN_PUBLIC_MOVE_PCT
    && Number.isFinite(lineMove)
    && lineMove <= -RLM_MIN_MARKET_MOVE_POINTS;
}

function isSharpSource(play: Pick<TrendPlay, "betsPct" | "moneyPct">, sport: FootballSport) {
  const bets = Number(play.betsPct);
  const money = Number(play.moneyPct);
  return Number.isFinite(bets)
    && Number.isFinite(money)
    && money - bets >= EZPZ_SHARP_MIN_MONEY_OVER_BETS_PCT[sport];
}

function directTrendQualification(
  play: TrendPlay,
  splits: DraftKingsSplit[],
  sport: FootballSport,
) {
  const labels: string[] = [];
  if (isSharpSource(play, sport)) labels.push("Sharp");

  const publicSide = oppositeDraftKingsSplit(play, splits, sport);
  if (publicSide) {
    if (isPublicFadeSource(publicSide, sport)) labels.push("Public Fade");
    if (isRlmSource(publicSide)) labels.push("RLM");
  }
  return { labels, publicSide };
}


type FootballEzpzRecordRow = {
  date: string;
  game: string;
  market: "Spread" | "Total" | "Player Prop";
  selection: string;
  odds: string;
  score: number;
  source: "Best Play" | "Trend Play" | "Best + Trend";
  qualification: string;
  selected: true;
  result: "W" | "L" | "P";
  units: number;
  tier?: string;
  playerName?: string;
  playerTeam?: string;
  propMarket?: string;
  propSide?: string;
  propLine?: string;
  propProjection?: string;
  modelGapPct?: number;
  predictedWinPct?: number;
  impliedProbabilityPct?: number;
};

function historicalTrendSplitFromRow(row: SheetRow, sport: FootballSport): DraftKingsSplit | null {
  const market = trendMarket(row);
  const date = isoDate(row.Date || row["Game Date"] || "");
  const teams = rowTeams(row);
  if (!market || !date || !teams.away || !teams.home) return null;
  const selection = String(row["Public Split Selection"] || row.Selection || "").trim();
  const side: DraftKingsSplit["side"] = market === "Total"
    ? textKey(row.Side || selection).startsWith("under") ? "Under"
      : textKey(row.Side || selection).startsWith("over") ? "Over"
      : ""
    : "";
  const selectionTeam = market === "Spread" ? String(row.Selection || selection).trim() : "";
  if (market === "Total" && !side) return null;
  if (market === "Spread" && !selectionTeam) return null;
  const line = finiteSnapshotNumber(row["Public Split Line"] ?? row.Line);
  const betsPct = finiteSnapshotNumber(row["Current Public %"] ?? row["Public Bets %"]);
  const moneyPct = finiteSnapshotNumber(row["Current Sharp %"] ?? row["Public Money %"]);
  if (betsPct == null || moneyPct == null) return null;
  const odds = String(row["Public Split Odds"] || row.Odds || "").trim();
  const warning = warningFor(betsPct, moneyPct);
  const basis = String(row["Line Movement Basis"] || "");
  const tone = String(row["Line Movement Tone"] || "");
  return {
    date,
    eventTime: String(row["Game Time"] || row["Game Time ET"] || ""),
    game: String(row.Game || `${teams.away} @ ${teams.home}`),
    awayTeam: teams.away,
    homeTeam: teams.home,
    market,
    selection,
    selectionTeam,
    side,
    sideGroup: market === "Total"
      ? side
      : line != null && line > 0 ? "Underdog" : line != null && line < 0 ? "Favorite" : "",
    line,
    odds,
    moneyPct,
    betsPct,
    ...warning,
    openingLine: finiteSnapshotNumber(row["Opening Public Split Line"]),
    openingOdds: String(row["Opening Public Split Odds"] || odds),
    openingSnapshotTime: String(row["Opening Public Split Snapshot Time"] || ""),
    openingBetsPct: finiteSnapshotNumber(row["Opening Public %"]) ?? betsPct,
    openingMoneyPct: finiteSnapshotNumber(row["Opening Sharp %"]) ?? moneyPct,
    openingImpliedPct: finiteSnapshotNumber(row["Opening Implied %"]),
    currentImpliedPct: finiteSnapshotNumber(row["Current Implied %"]),
    publicMovementPct: finiteSnapshotNumber(row["Public Change %"]) ?? 0,
    sharpMovementPct: finiteSnapshotNumber(row["Sharp Change %"]) ?? 0,
    lineMovementSignal: String(row["Line Movement Signal"] || ""),
    lineMovementTone: (["negative", "caution", "positive", "neutral"].includes(tone) ? tone : "") as DraftKingsSplit["lineMovementTone"],
    lineMovementBasis: (["Implied Probability", "Spread Line", "Total Line"].includes(basis) ? basis : "") as DraftKingsSplit["lineMovementBasis"],
    lineMovementValue: finiteSnapshotNumber(row["Line Movement Value"]),
    snapshotTime: String(row["Public Split Snapshot Time"] || ""),
  };
}

function buildFootballEzpzRecordRows(
  tracker: SheetRow[],
  trendRows: SheetRow[],
  sport: FootballSport,
): FootballEzpzRecordRow[] {
  const candidates: FootballEzpzRecordRow[] = [];

  for (const row of tracker) {
    const result = resultCode(row.Result || row.Status);
    const date = isoDate(row.Date || row["Game Date"] || "");
    if (!result || !date) continue;

    if (sport === "NFL" && isNflYardagePropRow(row)) {
      const grade = nflYardagePropTier(row);
      if (!nflEzpzYardagePropGrade(grade)) continue;
      const metrics = nflYardagePropMetrics(row);
      const rawProbability = finitePropNumber(row["Model Probability"]);
      const score = rawProbability == null ? 0 : rawProbability <= 1 ? rawProbability * 100 : rawProbability;
      const side = textKey(row.Pick).startsWith("under") ? "Under" : textKey(row.Pick).startsWith("over") ? "Over" : "";
      const oddsNumber = parseOdds(row["Pick Odds"] || row.Odds || row["Odds/Line"]);
      candidates.push({
        date,
        game: String(row.Game || ""),
        market: "Player Prop",
        selection: String(row.Pick || ""),
        odds: oddsNumber ? String(oddsNumber > 0 ? `+${oddsNumber}` : oddsNumber) : String(row["Pick Odds"] || ""),
        score: Math.round(score * 10) / 10,
        source: "Best Play",
        qualification: `${grade} yardage prop • edge ${metrics ? metrics.probabilityEdgePct.toFixed(1) : "—"}% • projection gap ${metrics ? metrics.projectionGapPct.toFixed(1) : "—"}%`,
        selected: true,
        result,
        units: result === "P" ? 0 : result === "L" ? -1 : profitUnits(oddsNumber || -110),
        tier: grade,
        playerName: String(row.Player || "").trim(),
        playerTeam: String(row.Team || "").trim(),
        propMarket: String(row.Market || row["Bet Type"] || "").trim(),
        propSide: side,
        propLine: String(row["Market Line"] || row.Line || "").trim(),
        propProjection: String(row.Projection || ""),
        modelGapPct: metrics ? Math.round(metrics.projectionGapPct * 10) / 10 : undefined,
        predictedWinPct: Math.round(score * 10) / 10,
        impliedProbabilityPct: (() => {
          const implied = finitePropNumber(row["Implied Probability"]);
          return implied == null ? undefined : Math.round((implied <= 1 ? implied * 100 : implied) * 10) / 10;
        })(),
      });
      continue;
    }

    if (!qualifiedFootballModelGrade(row.Grade || row["Model Grade"])) continue;
    if (sport === "NCAAF" && cfbProjectionOnlySpread(row)) continue;

    const recordType = footballTrackerRecordType(row, sport);
    if (!recordType) continue;
    const lastSeven = footballLastSevenForType(tracker, recordType, sport, date);
    if (footballBestForm(lastSeven) !== "HOT") continue;

    const oddsNumber = parseOdds(row.Odds || row["Odds/Line"]);
    if (!oddsNumber || oddsNumber < -150) continue;
    const marketKey = textKey(row["Bet Type"] || row.Market);
    const market: "Spread" | "Total" = marketKey.includes("total") ? "Total" : "Spread";
    const scoreRaw = Number(String(row["Model Probability"] || "").replace("%", ""));
    const score = Number.isFinite(scoreRaw) ? (scoreRaw <= 1 ? scoreRaw * 100 : scoreRaw) : 0;
    candidates.push({
      date,
      game: String(row.Game || ""),
      market,
      selection: String(row.Selection || ""),
      odds: String(oddsNumber > 0 ? `+${oddsNumber}` : oddsNumber),
      score,
      source: "Best Play",
      qualification: `HOT Last 7 ${recordType} Best Play (${lastSeven.record})`,
      selected: true,
      result,
      units: result === "P" ? 0 : result === "L" ? -1 : profitUnits(oddsNumber),
    });
  }

  const settledTrendRows = trendRows.filter((row) => Boolean(resultCode(row.Result || row.Status)));
  const splitGroups = new Map<string, DraftKingsSplit[]>();
  const rowByIdentity = new Map<string, SheetRow>();
  for (const row of settledTrendRows) {
    const split = historicalTrendSplitFromRow(row, sport);
    if (!split) continue;
    const groupKey = `${split.date}|${textKey(split.game)}|${split.market}`;
    const group = splitGroups.get(groupKey) || [];
    group.push(split);
    splitGroups.set(groupKey, group);
    const identity = `${groupKey}|${textKey(split.market === "Total" ? split.side : split.selectionTeam)}`;
    rowByIdentity.set(identity, row);
  }

  for (const [groupKey, splits] of splitGroups) {
    for (const split of splits) {
      const play: TrendPlay = {
        date: split.date,
        game: split.game,
        gameKey: "",
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
        openingBetsPct: split.openingBetsPct,
        openingMoneyPct: split.openingMoneyPct,
        publicMovementPct: split.publicMovementPct,
        sharpMovementPct: split.sharpMovementPct,
        openingLine: split.openingLine,
        openingOdds: split.openingOdds,
        openingImpliedPct: split.openingImpliedPct,
        currentImpliedPct: split.currentImpliedPct,
        lineMovementBasis: split.lineMovementBasis,
        lineMovementValue: split.lineMovementValue,
        score: 0,
        TrendSampleSize: 0,
        HistorySource: "historical EZPZ reconstruction",
        FallbackReason: "",
        tier: "Pass",
        signals: [],
        updatedAt: split.snapshotTime || "",
      };
      const direct = directTrendQualification(play, splits, sport);
      if (!direct.labels.length) continue;
      const oddsNumber = parseOdds(split.odds);
      if (!oddsNumber || oddsNumber < -150) continue;
      const row = rowByIdentity.get(
        `${groupKey}|${textKey(split.market === "Total" ? split.side : split.selectionTeam)}`,
      );
      const result = resultCode(row?.Result || row?.Status);
      if (!result) continue;
      const strengthScore = direct.labels.includes("RLM")
        ? Math.min(
            100,
            85 +
              Math.max(
                0,
                Math.abs(Number(direct.publicSide?.lineMovementValue || 0)) -
                  RLM_MIN_MARKET_MOVE_POINTS,
              ) *
                5,
          )
        : 85;
      candidates.push({
        date: split.date,
        game: split.game,
        market: split.market,
        selection: split.market === "Total"
          ? `${split.side} ${split.line ?? ""}`.trim()
          : `${split.selectionTeam} ${split.line == null ? "" : `${split.line > 0 ? "+" : ""}${split.line}`}`.trim(),
        odds: split.odds,
        score: Math.round(strengthScore * 10) / 10,
        source: "Trend Play",
        qualification: direct.labels.join(" • "),
        selected: true,
        result,
        units: result === "P" ? 0 : result === "L" ? -1 : profitUnits(oddsNumber),
      });
    }
  }

  const deduped = new Map<string, FootballEzpzRecordRow>();
  for (const candidate of candidates) {
    const key = `${candidate.date}|${textKey(candidate.game)}|${candidate.market}|${textKey(candidate.selection)}`;
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, candidate);
      continue;
    }
    deduped.set(key, {
      ...existing,
      source: "Best + Trend",
      score: Math.max(existing.score, candidate.score),
      qualification: `${existing.qualification} • ${candidate.qualification}`,
    });
  }

  const sorted = [...deduped.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || b.score - a.score || a.game.localeCompare(b.game),
  );
  if (sport !== "NCAAF") return sorted;

  const onePerGame = new Map<string, FootballEzpzRecordRow>();
  for (const candidate of sorted) {
    const key = `${candidate.date}|${textKey(candidate.game)}`;
    const existing = onePerGame.get(key);
    if (!existing || candidate.score > existing.score) onePerGame.set(key, candidate);
  }
  return [...onePerGame.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.game.localeCompare(b.game),
  );
}

function buildFootballEzpzPicks(
  best: any[],
  trends: TrendPlay[],
  tracker: SheetRow[],
  splits: DraftKingsSplit[],
  sport: FootballSport,
  referenceDate: string,
) {
  const picks: FootballEzpzPick[] = [];
  const formCache = new Map<FootballBestRecordType, ReturnType<typeof recordTotals>>();
  for (const play of best) {
    const market: "Spread" | "Total" = textKey(play.role || play.playType).includes("total") ? "Total" : "Spread";
    const split = footballBestPlaySplit(play, splits, sport);
    const recordType = footballBestPlayRecordType(play, split, sport);
    const lastSeven = formCache.get(recordType) || footballLastSevenForType(tracker, recordType, sport, referenceDate);
    formCache.set(recordType, lastSeven);
    if (footballBestForm(lastSeven) !== "HOT") continue;
    const odds = americanOddsText(split?.odds || play.oddsLine);
    if (!odds || Number(odds) < -150) continue;
    const rawScore = Number(play.score);
    const score = Number.isFinite(rawScore) ? (rawScore <= 1 ? rawScore * 100 : rawScore) : 0;
    picks.push({
      source: "Best Play",
      game: play.game,
      market,
      selection: play.play,
      odds,
      score,
      tier: play.playType || "Best Play",
      qualification: `HOT Last 7 ${recordType} Best Play (${lastSeven.record})`,
      record: lastSeven.record,
    });
  }

  for (const play of trends) {
    const direct = directTrendQualification(play, splits, sport);
    if (!direct.labels.length) continue;
    const odds = americanOddsText(play.odds);
    if (!odds || Number(odds) < -150) continue;

    const strengthScore = direct.labels.includes("RLM")
      ? Math.min(100, 85 + Math.max(0, Math.abs(Number(direct.publicSide?.lineMovementValue || 0)) - RLM_MIN_MARKET_MOVE_POINTS) * 5)
      : 85;

    picks.push({
      source: "Trend Play",
      game: play.game,
      market: play.market,
      selection: play.market === "Total"
        ? `${play.side} ${play.line ?? ""}`.trim()
        : `${play.selection} ${play.line == null ? "" : `${play.line > 0 ? "+" : ""}${play.line}`}`.trim(),
      odds,
      score: Math.round(strengthScore * 10) / 10,
      tier: direct.labels.join(" + "),
      qualification: direct.labels.join(" • "),
      betsPct: Number(play.betsPct),
      moneyPct: Number(play.moneyPct),
      gapPct: Math.round((Number(play.moneyPct) - Number(play.betsPct)) * 10) / 10,
      publicSideBetsPct: direct.publicSide ? Number(direct.publicSide.betsPct) : undefined,
      publicSideMoneyPct: direct.publicSide ? Number(direct.publicSide.moneyPct) : undefined,
      publicMovePct: direct.publicSide ? Number(direct.publicSide.publicMovementPct) : undefined,
      lineMoveValue: direct.publicSide ? Number(direct.publicSide.lineMovementValue) : undefined,
    });
  }

  const deduped = new Map<string, FootballEzpzPick>();
  for (const pick of picks) {
    const key = `${textKey(pick.game)}|${pick.market}|${textKey(pick.selection)}`;
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, pick);
      continue;
    }
    deduped.set(key, {
      ...existing,
      source: "Best + Trend",
      score: Math.max(existing.score, pick.score),
      tier: `${existing.tier} + ${pick.tier}`,
      qualification: `${existing.qualification} • ${pick.qualification}`,
    });
  }
  const sorted = [...deduped.values()].sort((a, b) => b.score - a.score || a.game.localeCompare(b.game));
  if (sport !== "NCAAF") return sorted;
  // One public CFB EZPZ pick per game. If multiple markets qualify, keep the
  // strongest scored pick; same-selection Best + Trend combinations are already merged above.
  const seenGames = new Set<string>();
  return sorted.filter((pick) => {
    const gameKey = textKey(pick.game);
    if (!gameKey || seenGames.has(gameKey)) return false;
    seenGames.add(gameKey);
    return true;
  });
}


async function buildFootballPublicDataFresh(sport:FootballSport,{persist=false}:{persist?:boolean}={}){
  const today=todayET(); const trackingWeek=footballWeekBounds(sport,today); if(persist) await Promise.all([ensureSportWorksheet(sport,"all_game_trends",ALL_GAME_TRENDS_HEADERS),ensureSportWorksheet(sport,"public_split_snapshots",PUBLIC_SPLIT_HEADERS)]);
  const [slateAll,trackerRaw,schedule,trendExisting,snapshotExisting,propProjectionRows]=await Promise.all([readSportWorksheet(sport,"daily_slate"),readSportWorksheet(sport,"bet_tracker"),readSportWorksheet(sport,"schedule"),readSportWorksheet(sport,"all_game_trends",ALL_GAME_TRENDS_HEADERS),readSportWorksheet(sport,"public_split_snapshots",PUBLIC_SPLIT_HEADERS),sport==="NFL"?readSportWorksheet(sport,"prop_projections"):Promise.resolve([] as SheetRow[])]);
  const liveSchedule=await loadFootballWeekSchedule(sport,trackingWeek.start,trackingWeek.end);
  const footballSchedule=mergeFootballSchedules(schedule,liveSchedule,sport);
  const pendingRecordDates=[...new Set([...trackerRaw,...trendExisting]
    .filter((row)=>!resultCode(row.Result||row.Status))
    .map((row)=>isoDate(row.Date||row["Game Date"]||""))
    .filter((date)=>{
      if(!date||date>today)return false;
      const current=Date.parse(today+"T12:00:00Z"),stamp=Date.parse(date+"T12:00:00Z");
      return Number.isFinite(current)&&Number.isFinite(stamp)&&current-stamp<=14*86_400_000;
    }))].sort();
  const pendingLiveSchedule=pendingRecordDates.length
    ? await loadFootballWeekSchedule(sport,pendingRecordDates[0],pendingRecordDates[pendingRecordDates.length-1])
    : [];
  const settlementSchedule=mergeFootballSchedules(footballSchedule,pendingLiveSchedule,sport);
  const trackingSlate=mergeFootballTrackingSlate(slateAll,footballSchedule,sport,today);
  const slate=trackingSlate;
  let trendRows=settleTrendRows(trendExisting,settlementSchedule,sport);
  const trackerSettlement=settleBestPlayTracker(trackerRaw,settlementSchedule,sport); const tracker=trackerSettlement.settled;
  trendRows=settleTrendRowsFromTracker(trendRows,tracker,sport);
  if(trackerSettlement.changed.length) await upsertSportRows(sport,"bet_tracker",FOOTBALL_TRACKER_HEADERS,trackerSettlement.changed,trackerKey); const shells=slate.flatMap(modelTrendShells); const merged=new Map(trendRows.map((row)=>[trendRowKey(row),row]));for(const shell of shells){const key=trendRowKey(shell);merged.set(key,{...(merged.get(key)||{}),...shell,Result:resultCode(merged.get(key)?.Result)?merged.get(key)!.Result:"Pending"});}trendRows=[...merged.values()];
  let dk: LoadedDraftKingsSplits;
  try {
    dk = await loadDraftKingsSplits(sport,trackingSlate);
  } catch (error) {
    const retained = snapshotExisting
      .map((row)=>draftKingsSplitFromStoredSnapshot(row,sport))
      .filter((split): split is DraftKingsSplit=>Boolean(split))
      .filter((split)=>splitMatchesSlate(split,trackingSlate,sport));
    if (sport !== "NFL" || !retained.length) throw error;

    const retainedBySide = new Map<string,DraftKingsSplit>();
    for (const split of retained) {
      const key = `${split.date}|${normalizeTeam(split.awayTeam,sport)}|${normalizeTeam(split.homeTeam,sport)}|${split.market}|${normalizeTeam(split.market==="Total"?split.side:split.selectionTeam,sport)}`;
      retainedBySide.set(key,split);
    }
    const splits=[...retainedBySide.values()];
    const errorMessage=error instanceof Error?error.message:String(error);
    dk={
      splits,
      errors:[
        `Live ScoresAndOdds refresh failed: ${errorMessage}`,
        `Serving ${splits.length} retained ScoresAndOdds market sides from the last successful snapshots instead of failing the public NFL payload.`,
      ],
      filter:{
        eventGroup:"stored-snapshots",
        content:"stored-snapshots",
        dateRange:"current-week",
        label:"Stored ScoresAndOdds snapshots",
        source:"option",
      },
      coverage:assessTrackingSlateCoverage(sport,splits,trackingSlate),
      missingPages:[],
      retainedFallback:true,
    };
    console.warn("Using retained NFL ScoresAndOdds snapshots after live partial-slate failure.",error);
  }
  const usingStoredDraftKingsFallback=dk.retainedFallback===true;
  const snapshotMap=new Map(
    snapshotExisting
      .filter((row)=>String(row.Source||"").trim()===SCORES_AND_ODDS_SOURCE)
      .map((row)=>[snapshotKey(row),row]),
  );
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
  const currentSnapshots=usingStoredDraftKingsFallback?[]:enrichedTrackingLive.flatMap((split)=>{
    const slateRow=findSlateForSplit(split,trackingSlate,sport);
    const minutesToKickoff=minutesUntilDraftKingsKickoff(split) ?? (slateRow?minutesUntilKickoff(slateRow):null);
    // Once a side has an authoritative FINAL_PREGAME trend, its persisted
    // market row is immutable. We never write new market snapshots after T-15;
    // delayed finalization uses only the saved pregame market state.
    if(splitHasAuthoritativeFinalTrend(trendExisting,split,sport)) return [];
    if(minutesToKickoff!=null&&minutesToKickoff<15) return [];
    return [snapshotRow({...split,snapshotTime:snapshotStamp})];
  });
  if(persist&&currentSnapshots.length) await upsertSportRows(sport,"public_split_snapshots",PUBLIC_SPLIT_HEADERS,currentSnapshots,snapshotKey);
  const enriched=enrichedTracking.filter((split)=>Boolean(findSlateForSplit(split,slate,sport)));
  const history=historyFromTrendRows(trendRows); const rawTrendPlays=enriched.map((split)=>{const row=findSlateForSplit(split,slate,sport);return row?buildTrendPlay(split,history,today,row):null;}).filter(Boolean) as TrendPlay[]; const trendPlays=headToHead(rawTrendPlays);
  const playMap=new Map(trendPlays.map((play)=>[`${play.gameKey}|${play.market}|${textKey(play.market==="Total"?play.side:play.selection)}`,play]));
  trendRows=trendRows.map((row)=>{
    if(!inFootballTrackingWeek(row,sport,today))return row;
    if(authoritativeFinalTrend(row)) return row;
    const split=findSplitForSide(row,enriched,sport,row.Market as FootballMarket,String(row.Market==="Total"?row.Side||row.Selection:row.Selection));if(!split)return row;
    // The canonical schedule time is the lock clock for ScoresAndOdds. Fall back to
    // the saved slate time only when the feed does not provide one.
    const minutesToKickoff=minutesUntilDraftKingsKickoff(split) ?? minutesUntilKickoff(row);
    const play=playMap.get(`${String(row["Game Key"]||"")}|${row.Market}|${textKey(row.Market==="Total"?row.Side||row.Selection:row.Selection)}`);const primary=play?.signals[0];
    const locked=minutesToKickoff!=null&&minutesToKickoff<=15;
    const stamp=nowET();
    const marketStamp=(usingStoredDraftKingsFallback||locked)&&split.snapshotTime?split.snapshotTime:stamp;
    return{...row,"Public Bets %":String(split.betsPct),"Public Money %":String(split.moneyPct),"Public Gap %":String(split.gapPct),"Public Warning":split.warning,"Public Warning Negative":split.warningNegative?"TRUE":"FALSE","Public Split Source":SCORES_AND_ODDS_SOURCE,"Public Split Market":split.market,"Public Split Selection":split.market==="Total"?split.side:split.selectionTeam,"Public Split Line":split.line==null?"":String(split.line),"Public Split Odds":split.odds,"Public Split Match Confidence":locked?"Final 15-minute football market lock":"Live weekly football market","Public Split Snapshot Time":marketStamp,"Opening Public %":String(split.openingBetsPct??split.betsPct),"Current Public %":String(split.betsPct),"Public Change %":String(split.publicMovementPct??0),"Opening Sharp %":String(split.openingMoneyPct??split.moneyPct),"Current Sharp %":String(split.moneyPct),"Sharp Change %":String(split.sharpMovementPct??0),"Opening Public Split Line":split.openingLine==null?"":String(split.openingLine),"Opening Public Split Odds":split.openingOdds||split.odds,"Opening Public Split Snapshot Time":split.openingSnapshotTime||String(snapshotMap.get(splitSnapshotKey(split))?.["Opening Snapshot Time ET"]||marketStamp),"Opening Implied %":split.openingImpliedPct==null?"":String(split.openingImpliedPct),"Current Implied %":split.currentImpliedPct==null?"":String(split.currentImpliedPct),"Line Movement Signal":split.lineMovementSignal||"","Line Movement Tone":split.lineMovementTone||"","Line Movement Basis":split.lineMovementBasis||"","Line Movement Value":split.lineMovementValue==null?"":String(split.lineMovementValue),"Trend Play":play?"TRUE":"FALSE","Trend Score":play?String(Math.round(play.score)):"","Trend Tier":play?.tier||"","Trend Signals":play?.signals.map(s=>s.signal).join(" | ")||"","Trend All Time Record":primary?.records.allTime.record||"","Trend Last 30 Record":primary?.records.last30.record||"","Trend Last 7 Record":primary?.records.last7.record||"","Trend Exact Sample":play?.signals.map(s=>s.exactSample).join(" | ")||"","Trend Sample Size":play?String(play.TrendSampleSize):"","History Source":play?.HistorySource||"","Fallback Reason":play?.FallbackReason||"","Trend Score Details":play?JSON.stringify({...play,frozenAt:locked?marketStamp:undefined,snapshotStatus:locked?"FINAL_PREGAME":"LIVE",gradingVersion:locked?FROZEN_TREND_GRADING_VERSION:undefined}):""};
  });
  if(persist) await upsertSportRows(sport,"all_game_trends",ALL_GAME_TRENDS_HEADERS,trendRows,trendRowKey);
  // The weekly market worksheet is the sole public trend source. It stores
  // the scored object and its immutable FINAL_PREGAME state.
  const weeklyMarket = await readWeeklyFootballMarket(sport);
  const displayTrendPlays = Array.isArray(weeklyMarket.trendPlays)
    ? weeklyMarket.trendPlays as unknown as TrendPlay[]
    : [];

  // all_game_trends can contain an older 0%/100% opening snapshot even when the
  // append-only weekly market history has a later real first snapshot. Overlay
  // the corrected weekly movement state for public record classification so a
  // placeholder opening can neither create nor erase an RLM result.
  const publicTrendKey = (
    date: unknown,
    _gameKey: unknown,
    game: unknown,
    market: unknown,
    selection: unknown,
  ) => [
    isoDate(date),
    textKey(game),
    textKey(market),
    textKey(selection),
  ].join("|");
  const weeklyMovementByKey = new Map(displayTrendPlays.map((play) => [
    publicTrendKey(
      play.date,
      play.gameKey,
      play.game,
      play.market,
      play.market === "Total" ? play.side || play.selection : play.selectionTeam || play.selection,
    ),
    play,
  ]));
  const publicTrendRows = trendRows.map((row) => {
    const market = String(row.Market || "");
    const selection = market === "Total"
      ? row.Side || row.Selection
      : row["Public Split Selection"] || row.Selection;
    const play = weeklyMovementByKey.get(publicTrendKey(
      row.Date,
      row["Game Key"],
      row.Game,
      market,
      selection,
    ));
    if (!play) return row;
    return {
      ...row,
      "Public Bets %": String(play.betsPct),
      "Public Money %": String(play.moneyPct),
      "Public Gap %": String(play.gapPct),
      "Public Split Line": play.line == null ? "" : String(play.line),
      "Public Split Odds": play.odds,
      "Opening Public %": String(play.openingBetsPct ?? play.betsPct),
      "Current Public %": String(play.betsPct),
      "Public Change %": String(play.publicMovementPct ?? 0),
      "Opening Sharp %": String(play.openingMoneyPct ?? play.moneyPct),
      "Current Sharp %": String(play.moneyPct),
      "Sharp Change %": String(play.sharpMovementPct ?? 0),
      "Opening Public Split Line": play.openingLine == null ? "" : String(play.openingLine),
      "Opening Public Split Odds": play.openingOdds || play.odds,
      "Opening Implied %": play.openingImpliedPct == null ? "" : String(play.openingImpliedPct),
      "Current Implied %": play.currentImpliedPct == null ? "" : String(play.currentImpliedPct),
      "Line Movement Basis": play.lineMovementBasis || "",
      "Line Movement Value": play.lineMovementValue == null ? "" : String(play.lineMovementValue),
    };
  });
  // EZPZ is a daily card, even though the football trend board tracks the full market week.
  // Keep the weekly trend payload for the Trend Plays tab, but only today's games may enter EZPZ.
  const liveTodaySchedule=liveSchedule.filter((row)=>isoDate(row.Date||row["Game Date"]||"")===today);
  const rawTodaySlate=slate
    .filter((row)=>isoDate(row.Date||row["Game Date"]||"")===today)
    .filter((row)=>{
      if(sport!=="NFL"||!liveTodaySchedule.length)return true;
      const recoveredShell=textKey(row.Notes||"").includes("schedule only shell recovered from");
      if(!recoveredShell)return true;
      return liveTodaySchedule.some((official)=>
        sameTeam(row["Away Team"],official["Away Team"],sport)&&
        sameTeam(row["Home Team"],official["Home Team"],sport)
      );
    });
  // A completed NFL model run can write its official projection/grade to the
  // tracker even when daily_slate still contains only the schedule shell.
  // Recover those model fields by matchup so Full Slate (and model best plays)
  // never go blank after a successful run.
  const trackerEnrichedTodaySlate=sport==="NFL"
    ? rawTodaySlate.map((row)=>{
      const matchingTracker=tracker.filter((trackerRow)=>{
        if(isoDate(trackerRow.Date||trackerRow["Game Date"]||"")!==today)return false;
        const teams=playerPropTeams(trackerRow);
        return sameTeam(teams.away,row["Away Team"],sport)&&sameTeam(teams.home,row["Home Team"],sport);
      });
      const projectionRow=matchingTracker.find((trackerRow)=>
        String(trackerRow["Projected Away"]||"").trim()!==""&&
        String(trackerRow["Projected Home"]||"").trim()!==""
      );
      if(!projectionRow)return row;

      const recovered:SheetRow={
        "Projected Away":String(projectionRow["Projected Away"]||""),
        "Projected Home":String(projectionRow["Projected Home"]||""),
        Reliability:String(projectionRow.Reliability||""),
        "Data Confidence":String(projectionRow["Data Confidence"]||""),
        "Personnel Confidence":String(projectionRow["Personnel Confidence"]||""),
        "Model Version":String(projectionRow["Model Version"]||""),
      };
      const projectedAwayRaw=String(projectionRow["Projected Away"]||"").trim();
      const projectedHomeRaw=String(projectionRow["Projected Home"]||"").trim();
      const projectedAway=projectedAwayRaw?Number(projectedAwayRaw):NaN;
      const projectedHome=projectedHomeRaw?Number(projectedHomeRaw):NaN;
      if(Number.isFinite(projectedAway)&&Number.isFinite(projectedHome)){
        recovered["Projected Margin"]=(projectedHome-projectedAway).toFixed(1);
        recovered["Projected Total"]=(projectedAway+projectedHome).toFixed(1);
      }

      const spreadRow=matchingTracker.find((trackerRow)=>textKey(trackerRow["Bet Type"]||trackerRow.Market).includes("spread"));
      if(spreadRow){
        recovered["Spread Grade"]=String(spreadRow.Grade||spreadRow["Model Grade"]||"");
        recovered["Spread Pick"]=String(spreadRow.Selection||"");
        recovered["Spread Probability"]=String(spreadRow["Model Probability"]||"");
        recovered["Spread Odds"]=String(spreadRow["Odds/Line"]||spreadRow.Odds||"");
      }
      const totalRow=matchingTracker.find((trackerRow)=>textKey(trackerRow["Bet Type"]||trackerRow.Market).includes("total"));
      if(totalRow){
        recovered["Total Grade"]=String(totalRow.Grade||totalRow["Model Grade"]||"");
        recovered["Total Pick"]=String(totalRow.Selection||"");
        recovered["Total Probability"]=String(totalRow["Model Probability"]||"");
        recovered["Total Odds"]=String(totalRow["Odds/Line"]||totalRow.Odds||"");
      }

      // Preserve any richer values already present in daily_slate.
      return nonEmptyMerge(recovered,row);
    })
    : rawTodaySlate;
  const todaySlate=sport==="NCAAF"
    ? trackerEnrichedTodaySlate.map((row)=>cfbProjectionOnlySpread(row)?{...row,"Spread Grade":"No Play"}:row)
    : trackerEnrichedTodaySlate;
  const effectiveTracker=sport==="NCAAF"
    ? tracker.map((row)=>cfbProjectionOnlySpread(row)?{...row,Grade:"No Play"}:row)
    : sport==="NFL"
      ? tracker.map(applyNflYardagePropGrade)
      : tracker;
  const effectivePropProjectionRows=sport==="NFL"
    ? propProjectionRows.map(applyNflYardagePropGrade)
    : propProjectionRows;
  const todayTrendPlays=displayTrendPlays.filter((play)=>isoDate(play.date)===today);
  const todayEnriched=enriched.filter((split)=>isoDate(split.date)===today);
  const modelBest=bestPlays(todaySlate,sport);
  const propBest=sport==="NFL"?nflPlayerPropBestPlays(effectivePropProjectionRows,todaySlate,today):[];
  const best=[...modelBest,...propBest];
  const baseAiPicks=buildFootballEzpzPicks(modelBest,todayTrendPlays,effectiveTracker,todayEnriched,sport,today);
  const propAiPicks=sport==="NFL"?nflPlayerPropEzpzPicks(effectivePropProjectionRows,todaySlate,today):[];
  const aiPicks=[...baseAiPicks,...propAiPicks].sort((a,b)=>b.score-a.score||a.game.localeCompare(b.game));
  // CFB projection-only / No Play rows stay in the tracker for audit and model
  // research, but they are not official graded plays and must not affect records.
  const recordTracker = sport === "NCAAF"
    ? effectiveTracker.filter((row) =>
        qualifiedFootballModelGrade(row.Grade || row["Model Grade"]) &&
        !cfbProjectionOnlySpread(row)
      )
    : effectiveTracker;
  const overall=recordTotals(recordTracker);const last7=recordTotals(recordTracker,7);const pending=recordTracker.filter((r)=>!resultCode(r.Result||r.Status)).length;
  const recordGroups = sport === "NCAAF"
    ? CFB_MODEL_RECORD_TYPES.map((betType) => ({
        betType,
        rows: recordTracker.filter((row) => footballTrackerRecordType(row, sport) === betType),
      }))
    : [
        { betType: "Spread", rows: effectiveTracker.filter((r) => textKey(r["Bet Type"] || r.Market).includes("spread")) },
        { betType: "Total", rows: effectiveTracker.filter((r) => textKey(r["Bet Type"] || r.Market).includes("total")) },
      ];
  const buildRecordSummary = (days?: number) => recordGroups.map(({ betType, rows }) => {
    const totals = recordTotals(rows, days);
    return { betType, status: totals.wins > totals.losses ? "WINNING" : totals.losses > totals.wins ? "LOSING" : "EVEN", ...totals };
  });
  const recordSummary = buildRecordSummary();
  const last7RecordSummary = buildRecordSummary(7);
  const aiPickRecordRows = buildFootballEzpzRecordRows(effectiveTracker, publicTrendRows, sport);
  return {ok:true,sport,database:sportDatabaseLabel(sport),today,lastUpdated:nowET(),tiles:{last7Days:last7,overallGreen:overall,handpickedLast7:last7,handpickedOverall:overall,pendingGreen:pending,bestPlaysToday:best.length},bestPlays:best,slateToday:todaySlate,betTrackerRows:effectiveTracker,draftKings:{ok:enriched.length>0,status:enriched.length?"LIVE":"UNAVAILABLE",updatedAt:nowET(),stale:usingStoredDraftKingsFallback,splits:enriched,props:[],errors:dk.errors,source:SCORES_AND_ODDS_SOURCE,filter:dk.filter,coverage:dk.coverage,displayMode:usingStoredDraftKingsFallback?"STALE_FALLBACK":"LIVE",trackingMode:"WEEKLY",trackingWeekStart:trackingWeek.start,trackingWeekEnd:trackingWeek.end,trackedGames:trackingSlate.length},draftKingsSignalRows:history,trendRecordRows:publicTrendRows.filter(r=>resultCode(r.Result)),trendPlays:displayTrendPlays,aiPicks,aiPickRecordRows,aiSelectorStatus:{mode:"LIVE",externalResearchConfigured:false,message:aiPicks.length?`${sport} EZPZ Picks are live for ${today}: ${sport === "NFL" ? "yardage props qualify directly at Strong or Regular; Lean is tracked but excluded from EZPZ Picks. " : ""}HOT game Best Plays remain FINAL immediately; Trend Plays qualify only through Public Fade, RLM, or Sharp. NFL Public Fade uses 80%+ bets; CFB Public Fade uses >75% bets with a 55+ point Bets%-Money% gap. RLM requires public bet share to rise at least 5 points while the market line moves 1.5+ points against that side. EZPZ Sharp requires money share over bet share by ${sport === "NFL" ? 25 : 40}+ points. Qualifying Trend Plays remain tied to the saved pregame market snapshot.`:`No ${sport} EZPZ Picks for ${today} currently qualify under the active game, prop, or trend rules.`,updatedAt:nowET(),candidateCount:modelBest.length+todayTrendPlays.length+propBest.length,selectedCount:aiPicks.length},recordSummary,last7RecordSummary,handpickedRecordSummary:recordSummary,handpickedLast7RecordSummary:last7RecordSummary};
}

const FOOTBALL_PUBLIC_DATA_CACHE_TTL_MS = 60_000;
const FOOTBALL_PUBLIC_DATA_STALE_MS = 30 * 60_000;
type FootballPublicPayload = Awaited<ReturnType<typeof buildFootballPublicDataFresh>>;
type FootballPublicCacheEntry = { savedAt: number; data: FootballPublicPayload };
const footballPublicDataCache = new Map<FootballSport, FootballPublicCacheEntry>();
const footballPublicDataInFlight = new Map<string, Promise<FootballPublicPayload>>();

export async function buildFootballPublicData(
  sport: FootballSport,
  options: { forceFresh?: boolean; persist?: boolean } = {},
) {
  const forceFresh = options.forceFresh === true;
  const persist = options.persist === true;
  const cached = footballPublicDataCache.get(sport);
  const now = Date.now();

  if (!forceFresh && cached && now - cached.savedAt < FOOTBALL_PUBLIC_DATA_CACHE_TTL_MS) {
    return cached.data;
  }

  const inFlightKey = `${sport}|${persist ? "persist" : "read"}`;
  const active = footballPublicDataInFlight.get(inFlightKey);
  if (active) return active;

  const operation = (async () => {
    try {
      const data = await buildFootballPublicDataFresh(sport, { persist });
      footballPublicDataCache.set(sport, { savedAt: Date.now(), data });
      return data;
    } catch (error) {
      const fallback = footballPublicDataCache.get(sport);
      if (fallback && Date.now() - fallback.savedAt < FOOTBALL_PUBLIC_DATA_STALE_MS) {
        console.warn(`Using last successful ${sport} public payload after refresh failure.`, error);
        return {
          ...fallback.data,
          stale: true,
          warning: error instanceof Error ? error.message : String(error),
          draftKings: fallback.data.draftKings
            ? { ...fallback.data.draftKings, stale: true }
            : fallback.data.draftKings,
        } as FootballPublicPayload;
      }
      throw error;
    }
  })();

  footballPublicDataInFlight.set(inFlightKey, operation);
  try {
    return await operation;
  } finally {
    if (footballPublicDataInFlight.get(inFlightKey) === operation) {
      footballPublicDataInFlight.delete(inFlightKey);
    }
  }
}

// Small pure exports used by CI to guarantee football follows the MLB trend contract.
export const __test__ = { warningFor, movementForSplit, trendRecord, windows, windowMetrics, signalBreakdown, headToHead, parseBettingSplits, footballWeekBounds, minutesUntilKickoff, settleTrendRows, settleTrendRowsFromTracker, historyFromTrendRows, buildTrendPlay };
