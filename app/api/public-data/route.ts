import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { readWorksheet as readWorksheetUncached } from "../../../lib/googleSheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type SheetRow = Record<string, string>;

type RecordTotals = {
  label: string;
  record: string;
  totalBets: number;
  winPct: number;
  unitsWon: number;
  roiPct: number;
  wins: number;
  losses: number;
  pushes: number;
};

type Summary = {
  betType: string;
  status: "WINNING" | "EVEN" | "LOSING";
  wins: number;
  losses: number;
  pushes: number;
  totalBets: number;
  winPct: number;
  unitsWon: number;
  roiPct: number;
};

type Play = {
  playType: string;
  game: string;
  play: string;
  oddsLine: string;
  score: string | number;
  isGreen: boolean;
  awayTeam: string;
  homeTeam: string;
  headshotUrl?: string;
  playerTeam?: string;
  moneylinePct?: string;
  projectedKs?: string | number;
  sixInningKs?: string | number;
  volatility?: string;
  altLine?: string | number;
  altOdds?: string | number;
  favoritePick?: string;
  favoriteRank?: string | number;
  favoriteTag?: string;
  favoriteNotes?: string;
};

type UfcRecordRow = {
  Category: string;
  Period: string;
  Bets: string | number;
  Wins: string | number;
  Losses: string | number;
  Pushes: string | number;
  "Win %": string;
  Units: string | number;
  "ROI %": string;
};

type UfcData = {
  bestPlays: SheetRow[];
  predictions: SheetRow[];
  records: UfcRecordRow[];
  tiles: {
    bestPlaysToday: number;
    overall: RecordTotals;
    last7: RecordTotals;
    handpickedOverall: RecordTotals;
    handpickedLast7: RecordTotals;
    pending: number;
  };
};

const DK_BETTING_SPLITS_URL =
  "https://dknetwork.draftkings.com/draftkings-sportsbook-betting-splits/";
const DK_PLAYER_PROPS_URL =
  "https://dknetwork.draftkings.com/draftkings-sportsbook-player-props/";
const CACHE_TTL_MS = 45_000;
const STALE_FALLBACK_MS = 30 * 60_000;
const PUBLIC_SPLIT_TAB = "public_split_snapshots";
const PUBLIC_SPLIT_HEADERS = [
  "Snapshot Time ET", "Opening Snapshot Time ET", "Date", "Game", "Away Team", "Home Team", "Data Type",
  "Market", "Selection", "Line", "Odds", "Opening Line", "Opening Odds",
  "Opening Implied %", "Current Implied %",
  "Opening Public %", "Current Public %", "Public Change %",
  "Opening Sharp %", "Current Sharp %", "Sharp Change %",
  "Public Bets %", "Public Money %", "Public Gap %",
  "Warning Key", "Warning", "Warning Tone", "Warning Negative",
  "Line Movement Signal", "Line Movement Tone", "Line Movement Basis", "Line Movement Value",
  "Popularity Rank", "Source", "Match Confidence", "Source URL",
];
const ALL_GAME_TRENDS_TAB = "all_game_trends";
const ALL_GAME_TRENDS_HEADERS = [
  "Date", "Game Key", "Game", "Game Time", "Away Team", "Home Team",
  "Market", "Selection", "Side", "Line", "Odds", "Odds/Line",
  "Model Grade", "Qualified", "Model %", "Implied %", "Edge %",
  "Model Version", "Correlation Block",
  "Result", "Actual Away Runs", "Actual Home Runs", "Actual Total", "Result Updated",
  "Public Bets %", "Public Money %", "Public Gap %", "Public Warning",
  "Public Warning Negative", "Public Split Source", "Public Split Market",
  "Public Split Selection", "Public Split Line", "Public Split Odds",
  "Public Split Match Confidence", "Public Split Snapshot Time",
  "Opening Public %", "Current Public %", "Public Change %",
  "Opening Sharp %", "Current Sharp %", "Sharp Change %",
  "Opening Public Split Line", "Opening Public Split Odds",
  "Opening Public Split Snapshot Time", "Opening Implied %", "Current Implied %",
  "Line Movement Signal", "Line Movement Tone", "Line Movement Basis",
  "Line Movement Value",
  "Trend Play", "Trend Score", "Trend Tier", "Trend Signals",
  "Trend All Time Record", "Trend Last 30 Record", "Trend Last 7 Record",
  "Trend Exact Sample", "Trend Score Details",
];

const AI_PICK_SELECTOR_TAB = "ai_pick_selector";
const AI_PICK_SELECTOR_VERSION = "hybrid-web-context-v1";
const AI_PICK_SELECTOR_HEADERS = [
  "Date", "Candidate ID", "Game Key", "Game Time", "Game", "Away Team", "Home Team",
  "Market", "Play", "Selection", "Line", "Odds", "Source",
  "Best Play Type", "Trend Tier", "Model Score", "Trend Score",
  "AI Score", "Estimated Probability", "Market Implied Probability", "Estimated Advantage",
  "Selected", "Protection Status", "Rejection Reason", "Why Selected", "Risks",
  "Data Status", "External Review Status", "Snapshot Status", "Locked At", "Updated At",
  "Result", "Units", "Result Updated", "Selector Version", "Details JSON",
];


type PublicSignalTone = "negative" | "caution" | "positive" | "neutral";

type DraftKingsSignalResult = {
  date: string;
  game: string;
  market: "Moneyline" | "Total";
  selection: string;
  sideGroup: "Favorite" | "Underdog" | "Over" | "Under" | "";
  betType: string;
  modelVersion: string;
  qualified: boolean;
  signalType: "Public Split" | "Line Movement";
  signalKey: string;
  signal: string;
  tone: PublicSignalTone;
  result: "W" | "L" | "P";
  odds: number;
  units: number;
};

type TrendRecordResult = {
  date: string;
  game: string;
  gameKey: string;
  gameTime: string;
  market: "Moneyline" | "Total";
  selection: string;
  result: "W" | "L" | "P";
  odds: number;
  units: number;
  frozenTier: "Good" | "Strong" | "Elite";
  frozenScore: number;
  frozenAt: string;
  snapshotStatus: "FINAL_PREGAME";
  trendScoreDetails: string;
  recoveredFromHistoricalOverride?: boolean;
  recoveryNote?: string;
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

type TrendWindowRecords = {
  allTime: TrendRecord;
  last30: TrendRecord;
  last7: TrendRecord;
};

type TrendDatasetWeights = {
  exact: number;
  market: number;
  overall: number;
};

type TrendSignalBreakdown = {
  signalType: "Public Split" | "Line Movement";
  signalKey: string;
  signal: string;
  tone: PublicSignalTone;
  category: string;
  recordScope: string;
  exactSample: number;
  score: number;
  weights: TrendDatasetWeights;
  records: TrendWindowRecords;
};

type TrendPlay = {
  game: string;
  awayTeam: string;
  homeTeam: string;
  market: "Moneyline" | "Total";
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
  lineMovementBasis?: "Implied Probability" | "Total Line" | "";
  lineMovementValue?: number | null;
  score: number;
  tier: "Pass" | "Good" | "Strong" | "Elite";
  signals: TrendSignalBreakdown[];
  updatedAt: string;
  baseScore?: number;
  opponentScore?: number | null;
  comparisonGap?: number;
  comparisonWinner?: boolean;
  rank?: number;
  frozenAt?: string;
  snapshotStatus?: "LIVE" | "FINAL_PREGAME";
  gradingVersion?: string;
  recordDate?: string;
  recordGameKey?: string;
  recordGameTime?: string;
};

type AiPickSource = "Best Play" | "Trend Play" | "Best + Trend";
type AiPickMarket = "Moneyline" | "Total" | "Pitcher Strikeouts" | "First Inning";
type AiPickSnapshotStatus = "LIVE" | "FINAL_PREGAME";
type AiPickExternalStatus =
  | "PENDING_FINAL_REVIEW"
  | "WEB_REVIEWED"
  | "NO_VERIFIED_CONTEXT"
  | "NOT_CONFIGURED"
  | "REVIEW_ERROR";

type AiPick = {
  candidateId: string;
  date: string;
  gameKey: string;
  gameTime: string;
  game: string;
  awayTeam: string;
  homeTeam: string;
  market: AiPickMarket;
  play: string;
  selection: string;
  line: string;
  odds: string;
  source: AiPickSource;
  bestPlayType: string;
  trendTier: string;
  modelScore: number;
  trendScore: number;
  aiScore: number;
  estimatedProbability: number;
  marketImpliedProbability: number;
  estimatedAdvantage: number;
  selected: boolean;
  protectionStatus: "PASSED" | "BLOCKED";
  rejectionReason: string;
  confidenceReason: string[];
  whySelected: string[];
  historicalNotes: string[];
  risks: string[];
  researchSummary: string;
  verdict: string;
  dataStatus: string[];
  externalReviewStatus: AiPickExternalStatus;
  snapshotStatus: AiPickSnapshotStatus;
  lockedAt: string;
  updatedAt: string;
  result: "W" | "L" | "P" | "";
  units: number;
  resultUpdated: string;
  selectorVersion: string;
};

type AiSelectorStatus = {
  mode: "LIVE_PREVIEW" | "FINAL_PREGAME";
  externalResearchConfigured: boolean;
  message: string;
  updatedAt: string;
  candidateCount: number;
  selectedCount: number;
};

type AiSelectorCandidate = AiPick & {
  slateRow: SheetRow | null;
  bestPlay: Play | null;
  trendPlay: TrendPlay | null;
  baselineProbability: number;
  scoreAdjustment: number;
  probabilityAdjustment: number;
  protectionReasons: string[];
};

type AiExternalReview = {
  candidateId: string;
  adjustment: number;
  criticalConflict: boolean;
  criticalConflictReason: string;
  confidenceReason: string[];
  why: string[];
  historicalNotes: string[];
  risks: string[];
  researchSummary: string;
  verdict: string;
  contextSummary: string;
};

const FROZEN_TREND_GRADING_VERSION = "frozen-h2h-display-v5";

type DraftKingsSplit = {
  date: string;
  game: string;
  awayTeam: string;
  homeTeam: string;
  market: "Moneyline" | "Run Line" | "Total";
  selection: string;
  selectionTeam: string;
  side: "Over" | "Under" | "";
  line: number | null;
  odds: string;
  moneyPct: number;
  betsPct: number;
  gapPct: number;
  warningKey: string;
  warning: string;
  warningTone: PublicSignalTone;
  warningNegative: boolean;
  openingLine?: number | null;
  openingOdds?: string;
  openingBetsPct?: number;
  openingMoneyPct?: number;
  publicMovementPct?: number;
  sharpMovementPct?: number;
  openingImpliedPct?: number | null;
  currentImpliedPct?: number | null;
  openingSnapshotTime?: string;
  lineMovementSignal?: string;
  lineMovementTone?: PublicSignalTone | "";
  lineMovementBasis?: "Implied Probability" | "Total Line" | "";
  lineMovementValue?: number | null;
  retained?: boolean;
  lastSeenAt?: string;
  snapshotStatus?: "LIVE" | "FINAL_PREGAME";
  snapshotTime?: string;
};

type DraftKingsProp = {
  date: string;
  game: string;
  awayTeam: string;
  homeTeam: string;
  pitcher: string;
  market: string;
  listedLine: string;
  side: "Over" | "Under" | "";
  line: number | null;
  odds: string;
  rank: number;
  retained?: boolean;
  lastSeenAt?: string;
};

type DraftKingsPersistence = {
  status: "SAVED" | "NO_CHANGES" | "SKIPPED" | "ERROR";
  updatedAt: string;
  snapshotRowsUpdated: number;
  slateRowsUpdated: number;
  trackerRowsUpdated: number;
  allGameTrendRowsUpdated: number;
  finalPregameRows: number;
  error?: string;
};

type DraftKingsPayload = {
  ok: boolean;
  status: "LIVE" | "PARTIAL" | "UNAVAILABLE";
  updatedAt: string;
  stale: boolean;
  splits: DraftKingsSplit[];
  props: DraftKingsProp[];
  errors: string[];
  retainedCount?: number;
  persistence?: DraftKingsPersistence;
  displayMode?: "LIVE" | "MIXED" | "FINAL_PREGAME";
  finalSnapshotGames?: number;
};

type CacheEntry = {
  savedAt: number;
  payload: DraftKingsPayload;
};

let draftKingsCacheEntry: CacheEntry | null = null;
let draftKingsPersistenceCache: {
  key: string;
  savedAt: number;
  result: DraftKingsPersistence;
} | null = null;
let allGameTrendResultSyncCache: {
  key: string;
  savedAt: number;
  updated: number;
} | null = null;

// Google Sheets permits only a limited number of read requests per minute for
// one service-account user. Keep successful worksheet reads briefly and share
// an in-flight request so simultaneous page loads do not each hit the API.
const WORKSHEET_READ_CACHE_TTL_MS = 60_000;
const WORKSHEET_READ_STALE_MS = 30 * 60_000;

type WorksheetReadCacheEntry = {
  savedAt: number;
  rows: SheetRow[];
};

const worksheetReadCache = new Map<string, WorksheetReadCacheEntry>();
const worksheetReadInFlight = new Map<string, Promise<SheetRow[]>>();

function cloneSheetRows(rows: SheetRow[]) {
  return rows.map((row) => ({ ...row }));
}

function isRetryableSheetsReadError(error: unknown) {
  const candidate = error as {
    code?: number | string;
    status?: number | string;
    response?: { status?: number; data?: unknown };
    message?: string;
  };
  const status = Number(
    candidate?.response?.status ?? candidate?.status ?? candidate?.code ?? 0,
  );
  const message = `${candidate?.message || ""} ${JSON.stringify(
    candidate?.response?.data || "",
  )}`.toUpperCase();
  return (
    status === 429 ||
    status >= 500 ||
    message.includes("RESOURCE_EXHAUSTED") ||
    message.includes("RATE_LIMIT_EXCEEDED") ||
    message.includes("QUOTA EXCEEDED")
  );
}

async function readWorksheet(tabName: string): Promise<SheetRow[]> {
  const key = textKey(tabName);
  const now = Date.now();
  const cached = worksheetReadCache.get(key);

  if (cached && now - cached.savedAt < WORKSHEET_READ_CACHE_TTL_MS) {
    return cloneSheetRows(cached.rows);
  }

  const inFlight = worksheetReadInFlight.get(key);
  if (inFlight) return cloneSheetRows(await inFlight);

  const request = (async () => {
    try {
      const rows = (await readWorksheetUncached(tabName)) as SheetRow[];
      const storedRows = cloneSheetRows(rows);
      worksheetReadCache.set(key, { savedAt: Date.now(), rows: storedRows });
      return storedRows;
    } catch (error) {
      if (
        cached &&
        now - cached.savedAt < WORKSHEET_READ_STALE_MS &&
        isRetryableSheetsReadError(error)
      ) {
        console.warn(
          `Using stale Google Sheets data for ${tabName} after a temporary read failure.`,
        );
        return cached.rows;
      }
      throw error;
    } finally {
      worksheetReadInFlight.delete(key);
    }
  })();

  worksheetReadInFlight.set(key, request);
  return cloneSheetRows(await request);
}

type CachedPublicRouteResponse = {
  savedAt: number;
  body: string;
  status: number;
  contentType: string;
};

const PUBLIC_ROUTE_CACHE_TTL_MS = 45_000;
const PUBLIC_ROUTE_STALE_MS = 30 * 60_000;
let publicRouteCache: CachedPublicRouteResponse | null = null;
let publicRouteInFlight: Promise<CachedPublicRouteResponse> | null = null;

const MLB_TEAM_ALIASES: Record<string, string[]> = {
  "Arizona Diamondbacks": ["ARI Diamondbacks", "Diamondbacks", "Arizona"],
  "Atlanta Braves": ["ATL Braves", "Braves", "Atlanta"],
  "Baltimore Orioles": ["BAL Orioles", "Orioles", "Baltimore"],
  "Boston Red Sox": ["BOS Red Sox", "Red Sox", "Boston"],
  "Chicago Cubs": ["CHI Cubs", "CHC Cubs", "Cubs"],
  "Chicago White Sox": ["CHI White Sox", "CWS White Sox", "White Sox"],
  "Cincinnati Reds": ["CIN Reds", "Reds", "Cincinnati"],
  "Cleveland Guardians": ["CLE Guardians", "Guardians", "Cleveland"],
  "Colorado Rockies": ["COL Rockies", "Rockies", "Colorado"],
  "Detroit Tigers": ["DET Tigers", "Tigers", "Detroit"],
  "Houston Astros": ["HOU Astros", "Astros", "Houston"],
  "Kansas City Royals": ["KC Royals", "KCR Royals", "Royals", "Kansas City"],
  "Los Angeles Angels": ["LA Angels", "LAA Angels", "Angels", "Los Angeles Angels"],
  "Los Angeles Dodgers": ["LA Dodgers", "LAD Dodgers", "Dodgers", "Los Angeles Dodgers"],
  "Miami Marlins": ["MIA Marlins", "Marlins", "Miami"],
  "Milwaukee Brewers": ["MIL Brewers", "Brewers", "Milwaukee"],
  "Minnesota Twins": ["MIN Twins", "Twins", "Minnesota"],
  "New York Mets": ["NY Mets", "NYM Mets", "Mets", "New York Mets"],
  "New York Yankees": ["NY Yankees", "NYY Yankees", "Yankees", "New York Yankees"],
  Athletics: ["Athletics", "OAK Athletics", "ATH Athletics", "Oakland Athletics"],
  "Philadelphia Phillies": ["PHI Phillies", "Phillies", "Philadelphia"],
  "Pittsburgh Pirates": ["PIT Pirates", "Pirates", "Pittsburgh"],
  "San Diego Padres": ["SD Padres", "SDP Padres", "Padres", "San Diego"],
  "San Francisco Giants": ["SF Giants", "SFG Giants", "Giants", "San Francisco"],
  "Seattle Mariners": ["SEA Mariners", "Mariners", "Seattle"],
  "St. Louis Cardinals": ["STL Cardinals", "Cardinals", "St Louis Cardinals", "St. Louis"],
  "Tampa Bay Rays": ["TB Rays", "TBR Rays", "Rays", "Tampa Bay"],
  "Texas Rangers": ["TEX Rangers", "Rangers", "Texas"],
  "Toronto Blue Jays": ["TOR Blue Jays", "Blue Jays", "Toronto"],
  "Washington Nationals": ["WAS Nationals", "WSH Nationals", "Nationals", "Washington"],
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

const ALIAS_LOOKUP = new Map<string, string>();
for (const [canonical, aliases] of Object.entries(MLB_TEAM_ALIASES)) {
  for (const alias of [canonical, ...aliases]) ALIAS_LOOKUP.set(textKey(alias), canonical);
}

function normalizeTeam(value: unknown) {
  const key = textKey(value);
  if (!key) return "";
  const exact = ALIAS_LOOKUP.get(key);
  if (exact) return exact;

  const contained = [...ALIAS_LOOKUP.entries()]
    .filter(([alias]) => alias && (key.endsWith(alias) || alias.endsWith(key)))
    .sort((a, b) => b[0].length - a[0].length);
  return contained[0]?.[1] || String(value || "").trim();
}

function draftKingsNowET() {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(new Date());
}

function draftKingsDateET(date = new Date()) {
  const parts = easternDateParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function draftKingsSplitKey(row: DraftKingsSplit) {
  const selectedSide =
    row.market === "Total"
      ? row.side || textKey(row.selection)
      : row.selectionTeam || normalizeTeam(row.selection);
  return `${row.date}|${row.game}|${row.market}|${textKey(selectedSide)}`;
}

function draftKingsPropKey(row: DraftKingsProp) {
  return `${row.date}|${row.game}|${textKey(row.pitcher)}`;
}

function mergeDraftKingsPayload(
  current: DraftKingsPayload,
  previous?: DraftKingsPayload | null,
): DraftKingsPayload {
  const today = draftKingsDateET();
  const splitMap = new Map<string, DraftKingsSplit>();
  const propMap = new Map<string, DraftKingsProp>();
  const previousSplits = new Map<string, DraftKingsSplit>();
  const previousProps = new Map<string, DraftKingsProp>();

  for (const row of previous?.splits || []) previousSplits.set(draftKingsSplitKey(row), row);
  for (const row of previous?.props || []) previousProps.set(draftKingsPropKey(row), row);

  current.splits.forEach((row) => {
    const key = draftKingsSplitKey(row);
    splitMap.set(key, enrichDraftKingsSplit(row, previousSplits.get(key), current.updatedAt));
  });
  current.props.forEach((row) => {
    const key = draftKingsPropKey(row);
    propMap.set(key, {
      ...row,
      retained: row.retained === true,
      lastSeenAt: row.lastSeenAt || current.updatedAt,
    });
  });

  for (const row of previous?.splits || []) {
    const key = draftKingsSplitKey(row);
    if (row.date === today && !splitMap.has(key)) {
      splitMap.set(key, {
        ...row,
        retained: true,
        lastSeenAt: row.lastSeenAt || previous?.updatedAt || current.updatedAt,
      });
    }
  }
  for (const row of previous?.props || []) {
    const key = draftKingsPropKey(row);
    if (row.date === today && !propMap.has(key)) {
      propMap.set(key, {
        ...row,
        retained: true,
        lastSeenAt: row.lastSeenAt || previous?.updatedAt || current.updatedAt,
      });
    }
  }

  const splits = [...splitMap.values()];
  const props = [...propMap.values()].sort((a, b) => a.rank - b.rank);
  const retainedCount =
    splits.filter((row) => row.retained).length +
    props.filter((row) => row.retained).length;

  return { ...current, splits, props, retainedCount };
}

function easternDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return {
    year: Number(parts.find((part) => part.type === "year")?.value || 0),
    month: Number(parts.find((part) => part.type === "month")?.value || 0),
    day: Number(parts.find((part) => part.type === "day")?.value || 0),
  };
}

function parseEventDate(value: unknown) {
  const match = String(value || "").match(/(\d{1,2})\/(\d{1,2})/);
  if (!match) return "";
  const month = Number(match[1]);
  const day = Number(match[2]);
  const today = easternDateParts();
  const todayUtc = Date.UTC(today.year, today.month - 1, today.day);
  const candidates = [today.year - 1, today.year, today.year + 1]
    .map((year) => ({
      year,
      distance: Math.abs(Date.UTC(year, month - 1, day) - todayUtc),
    }))
    .sort((a, b) => a.distance - b.distance);
  const year = candidates[0]?.year || today.year;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function numericLine(value: unknown) {
  const match = String(value || "").match(/-?\d+(?:\.\d+)?/);
  const parsed = match ? Number(match[0]) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function percent(value: unknown) {
  const parsed = Number(String(value || "").replace("%", "").trim());
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : NaN;
}

function isOdds(value: unknown) {
  return /^[+-]?\d{3,4}$/.test(String(value || "").replace(/−/g, "-").trim());
}

function isPercent(value: unknown) {
  return /^\d{1,3}(?:\.\d+)?%$/.test(String(value || "").trim());
}

function warningFor(betsPct: number, moneyPct: number) {
  const gapPct = Math.round((moneyPct - betsPct) * 10) / 10;
  if (betsPct >= 90 && moneyPct >= 90) {
    return {
      warningKey: "EXTREME_PUBLIC_SHARP_AGREEMENT",
      warning: "Extreme Public + Sharp Agreement",
      warningTone: "negative" as const,
      warningNegative: true,
      gapPct,
    };
  }
  if (betsPct >= 80 && moneyPct >= 80) {
    return {
      warningKey: "HEAVY_PUBLIC_SHARP_AGREEMENT",
      warning: "Heavy Public + Sharp Agreement",
      warningTone: "caution" as const,
      warningNegative: true,
      gapPct,
    };
  }
  if (gapPct <= -20) {
    return {
      warningKey: "STRONG_SHARP_REJECTION",
      warning: "Strong Sharp Rejection",
      warningTone: "negative" as const,
      warningNegative: true,
      gapPct,
    };
  }
  if (gapPct <= -10) {
    return {
      warningKey: "SHARP_REJECTION",
      warning: "Sharp Rejection",
      warningTone: "negative" as const,
      warningNegative: true,
      gapPct,
    };
  }
  if (gapPct >= 20) {
    return {
      warningKey: "STRONG_SHARP_SUPPORT",
      warning: "Strong Sharp Support",
      warningTone: "positive" as const,
      warningNegative: false,
      gapPct,
    };
  }
  if (gapPct >= 10) {
    return {
      warningKey: "SHARP_SUPPORT",
      warning: "Sharp Support",
      warningTone: "positive" as const,
      warningNegative: false,
      gapPct,
    };
  }
  return {
    warningKey: "BALANCED_PUBLIC_SHARP_SPLIT",
    warning: "Balanced Public / Sharp Split",
    warningTone: "neutral" as const,
    warningNegative: false,
    gapPct,
  };
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

const RLM_PUBLIC_MOVE_MIN = 5;
const RLM_PUBLIC_MOVE_STRONG = 10;
const RLM_IMPLIED_MOVE_MIN = 1.5;
const RLM_IMPLIED_MOVE_STRONG = 3;
const RLM_TOTAL_MOVE_MIN = 0.5;
const RLM_TOTAL_MOVE_STRONG = 1;

function movementForSplit(
  current: DraftKingsSplit,
  openingLine: number | null,
  openingOdds: string,
  openingPublicPct: number,
) {
  const openingImpliedPct = americanImpliedProbabilityPct(openingOdds);
  const currentImpliedPct = americanImpliedProbabilityPct(current.odds);
  const publicMovementPct = Math.round((current.betsPct - openingPublicPct) * 10) / 10;
  let signal = "";
  let tone: PublicSignalTone | "" = "";
  let basis: "Implied Probability" | "Total Line" | "" = "";
  let value: number | null = null;
  let standardPriceThreshold = RLM_IMPLIED_MOVE_MIN;
  let strongPriceThreshold = RLM_IMPLIED_MOVE_STRONG;

  if (
    current.market === "Total" &&
    openingLine != null &&
    current.line != null &&
    current.side
  ) {
    const selectedSideMove = current.side === "Over"
      ? current.line - openingLine
      : openingLine - current.line;
    if (Math.abs(selectedSideMove) >= RLM_TOTAL_MOVE_MIN) {
      basis = "Total Line";
      value = Math.round(selectedSideMove * 10) / 10;
      standardPriceThreshold = RLM_TOTAL_MOVE_MIN;
      strongPriceThreshold = RLM_TOTAL_MOVE_STRONG;
    }
  }

  if (value == null && openingImpliedPct != null && currentImpliedPct != null) {
    const impliedMove = Math.round((currentImpliedPct - openingImpliedPct) * 10) / 10;
    if (Math.abs(impliedMove) >= RLM_IMPLIED_MOVE_MIN) {
      basis = "Implied Probability";
      value = impliedMove;
    }
  }

  if (value != null) {
    const meaningfulPublicMove = Math.abs(publicMovementPct) >= RLM_PUBLIC_MOVE_MIN;
    const oppositeDirections = publicMovementPct * value < 0;
    if (
      meaningfulPublicMove &&
      oppositeDirections &&
      Math.abs(value) >= standardPriceThreshold
    ) {
      const strong =
        Math.abs(publicMovementPct) >= RLM_PUBLIC_MOVE_STRONG &&
        Math.abs(value) >= strongPriceThreshold;
      const supportedSide = value > 0;
      signal = supportedSide
        ? strong
          ? "Strong Reverse Line Movement Support"
          : "Reverse Line Movement Support"
        : strong
          ? "Strong Reverse Line Movement Against"
          : "Reverse Line Movement Against";
      tone = supportedSide ? "positive" : "negative";
    } else if (value > 0) {
      signal = "Line Movement Confirmation";
      tone = "positive";
    } else {
      signal = "Adverse Line Movement";
      tone = "negative";
    }
  }

  return {
    openingImpliedPct,
    currentImpliedPct,
    publicMovementPct,
    lineMovementSignal: signal,
    lineMovementTone: tone,
    lineMovementBasis: basis,
    lineMovementValue: value,
  };
}

function enrichDraftKingsSplit(
  current: DraftKingsSplit,
  previous?: DraftKingsSplit | null,
  updatedAt = "",
): DraftKingsSplit {
  const primary = warningFor(current.betsPct, current.moneyPct);
  const openingLine = previous?.openingLine ?? previous?.line ?? current.openingLine ?? current.line;
  const openingOdds = previous?.openingOdds || previous?.odds || current.openingOdds || current.odds;
  const openingBetsPct =
    previous?.openingBetsPct ?? previous?.betsPct ?? current.openingBetsPct ?? current.betsPct;
  const openingMoneyPct =
    previous?.openingMoneyPct ?? previous?.moneyPct ?? current.openingMoneyPct ?? current.moneyPct;
  const openingSnapshotTime =
    previous?.openingSnapshotTime ||
    previous?.lastSeenAt ||
    current.openingSnapshotTime ||
    updatedAt;
  const movement = movementForSplit(
    current,
    openingLine ?? null,
    openingOdds || current.odds,
    openingBetsPct,
  );
  const sharpMovementPct = Math.round((current.moneyPct - openingMoneyPct) * 10) / 10;

  return {
    ...current,
    ...primary,
    openingLine: openingLine ?? null,
    openingOdds: openingOdds || current.odds,
    openingBetsPct,
    openingMoneyPct,
    sharpMovementPct,
    openingSnapshotTime,
    ...movement,
    retained: current.retained === true,
    lastSeenAt: current.lastSeenAt || updatedAt,
  };
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&#(\d+);/g, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    )
    .replace(/&nbsp;|&ensp;|&emsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function htmlTokens(rawHtml: string) {
  const cleaned = String(rawHtml || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, "\n");

  return decodeHtmlEntities(cleaned)
    .split(/\r?\n/)
    .map((item) => item.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function parseBettingSplits(rawHtml: string) {
  const tokens = htmlTokens(rawHtml);
  const rows: DraftKingsSplit[] = [];
  const marketNames: Record<string, DraftKingsSplit["market"]> = {
    Moneyline: "Moneyline",
    "Run Line": "Run Line",
    Spread: "Run Line",
    Total: "Total",
  };

  let i = 0;
  while (i < tokens.length - 1) {
    const gameToken = tokens[i];
    const dateToken = tokens[i + 1] || "";
    if (!gameToken.includes(" @ ") || !/\d{1,2}\/\d{1,2}/.test(dateToken)) {
      i += 1;
      continue;
    }

    const [awayRaw, homeRaw] = gameToken.split(" @ ", 2).map((part) => part.trim());
    const awayTeam = normalizeTeam(awayRaw);
    const homeTeam = normalizeTeam(homeRaw);
    if (!(awayTeam in MLB_TEAM_ALIASES) || !(homeTeam in MLB_TEAM_ALIASES)) {
      i += 2;
      continue;
    }

    const date = parseEventDate(dateToken);
    const game = `${awayTeam} at ${homeTeam}`;
    i += 2;

    while (i < tokens.length) {
      if (
        i + 1 < tokens.length &&
        tokens[i].includes(" @ ") &&
        /\d{1,2}\/\d{1,2}/.test(tokens[i + 1])
      )
        break;

      const market = marketNames[tokens[i]];
      if (!market) {
        i += 1;
        continue;
      }

      let j = i + 1;
      while (["Odds", "% Handle", "% Bets"].includes(tokens[j])) j += 1;

      let parsedMarketRows = 0;
      while (j + 3 < tokens.length) {
        if (marketNames[tokens[j]]) break;
        if (
          j + 1 < tokens.length &&
          tokens[j].includes(" @ ") &&
          /\d{1,2}\/\d{1,2}/.test(tokens[j + 1])
        )
          break;

        const [selection, rawOdds, rawMoneyPct, rawBetsPct] = tokens.slice(j, j + 4);
        if (!(isOdds(rawOdds) && isPercent(rawMoneyPct) && isPercent(rawBetsPct))) break;

        const moneyPct = percent(rawMoneyPct);
        const betsPct = percent(rawBetsPct);
        if (!Number.isFinite(moneyPct) || !Number.isFinite(betsPct)) break;
        const warning = warningFor(betsPct, moneyPct);
        const side = selection.toLowerCase().startsWith("over")
          ? "Over"
          : selection.toLowerCase().startsWith("under")
            ? "Under"
            : "";
        const selectionTeam =
          market === "Total"
            ? ""
            : normalizeTeam(selection.replace(/\s+[+-]?\d+(?:\.\d+)?$/, ""));

        rows.push({
          date,
          game,
          awayTeam,
          homeTeam,
          market,
          selection,
          selectionTeam,
          side,
          line: market === "Moneyline" ? null : numericLine(selection),
          odds: rawOdds.replace(/−/g, "-"),
          moneyPct,
          betsPct,
          ...warning,
        });

        parsedMarketRows += 1;
        j += 4;
        if (parsedMarketRows >= 2) break;
      }
      i = Math.max(i + 1, j);
    }
  }

  const deduped = new Map<string, DraftKingsSplit>();
  for (const row of rows) {
    deduped.set(`${row.date}|${row.game}|${row.market}|${textKey(row.selection)}`, row);
  }
  return [...deduped.values()];
}

function propSideAndLine(value: unknown) {
  const text = String(value || "").trim();
  const lower = text.toLowerCase();
  if (!text) return { side: "" as const, line: null };
  if (lower.includes("under")) return { side: "Under" as const, line: numericLine(text) };
  if (text.endsWith("+")) {
    const threshold = numericLine(text);
    return { side: "Over" as const, line: threshold == null ? null : threshold - 0.5 };
  }
  if (lower.includes("over")) return { side: "Over" as const, line: numericLine(text) };
  return { side: "" as const, line: numericLine(text) };
}

function parsePlayerProps(rawHtml: string, rankOffset = 0) {
  const rawRows: string[][] = [];
  const tokens = htmlTokens(rawHtml);
  let i = 0;
  while (i + 4 < tokens.length) {
    if (
      tokens[i].includes(" @ ") &&
      /\d{1,2}\/\d{1,2}/.test(tokens[i + 1]) &&
      isOdds(tokens[i + 4])
    ) {
      rawRows.push(tokens.slice(i, i + 5));
      i += 5;
    } else {
      i += 1;
    }
  }

  const rows: DraftKingsProp[] = [];
  rawRows.forEach(([event, dateText, market, listedLine, rawOdds], index) => {
    if (!event.includes(" @ ") || !market.toLowerCase().includes("strikeout")) return;
    const [awayRaw, homeRaw] = event.split(" @ ", 2).map((part) => part.trim());
    const awayTeam = normalizeTeam(awayRaw);
    const homeTeam = normalizeTeam(homeRaw);
    if (!(awayTeam in MLB_TEAM_ALIASES) || !(homeTeam in MLB_TEAM_ALIASES)) return;

    const pitcher = market
      .replace(/\s+Strikeouts?(?:\s+Thrown)?\s*$/i, "")
      .replace(/\s+/g, " ")
      .trim();
    const parsed = propSideAndLine(listedLine);
    rows.push({
      date: parseEventDate(dateText),
      game: `${awayTeam} at ${homeTeam}`,
      awayTeam,
      homeTeam,
      pitcher,
      market,
      listedLine,
      side: parsed.side,
      line: parsed.line,
      odds: rawOdds.replace(/−/g, "-"),
      rank: rankOffset + index + 1,
    });
  });
  return { rows, rawCount: rawRows.length };
}

async function fetchHtml(url: string, params: Record<string, string>) {
  const target = new URL(url);
  Object.entries(params).forEach(([key, value]) => target.searchParams.set(key, value));
  const response = await fetch(target, {
    cache: "no-store",
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; EZPZ-Picks/1.0; +https://ezpzpicks.com)",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

async function buildDraftKingsPayload(): Promise<DraftKingsPayload> {
  const errors: string[] = [];
  let splits: DraftKingsSplit[] = [];
  let props: DraftKingsProp[] = [];

  const seenSplitKeys = new Set<string>();
  const maxBettingSplitPages = 10;

  for (let page = 1; page <= maxBettingSplitPages; page += 1) {
    try {
      const html = await fetchHtml(DK_BETTING_SPLITS_URL, {
        itm_content: "MLB",
        tb_edate: "n7days",
        tb_eg: "MLB",
        tb_page: String(page),
      });
      const pageSplits = parseBettingSplits(html);
      let newRows = 0;

      for (const row of pageSplits) {
        const key = `${row.date}|${row.game}|${row.market}|${textKey(row.selection)}`;
        if (seenSplitKeys.has(key)) continue;
        seenSplitKeys.add(key);
        splits.push(row);
        newRows += 1;
      }

      // DraftKings can repeat the final page when a page number is out of range.
      // Stop when the page is empty or contributes no new markets.
      if (!pageSplits.length || newRows === 0) break;
    } catch (error) {
      errors.push(
        `Betting splits page ${page}: ${error instanceof Error ? error.message : String(error)}`,
      );
      break;
    }
  }

  if (!splits.length) {
    try {
      splits = parseBettingSplits(await fetchHtml(DK_BETTING_SPLITS_URL, {}));
    } catch (fallbackError) {
      errors.push(
        `Betting splits fallback: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`,
      );
    }
  }

  let rankOffset = 0;
  for (const page of [1, 2]) {
    try {
      const html = await fetchHtml(DK_PLAYER_PROPS_URL, {
        itm_content: "MLB",
        tb_edate: "n7days",
        tb_eg: "MLB",
        tb_page: String(page),
      });
      const parsed = parsePlayerProps(html, rankOffset);
      props.push(...parsed.rows);
      rankOffset += Math.max(25, parsed.rawCount);
    } catch (error) {
      errors.push(`Player props page ${page}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const splitMap = new Map<string, DraftKingsSplit>();
  splits.forEach((row) =>
    splitMap.set(`${row.date}|${row.game}|${row.market}|${textKey(row.selection)}`, row),
  );
  splits = [...splitMap.values()];

  const propMap = new Map<string, DraftKingsProp>();
  props.forEach((row) => {
    const key = `${row.date}|${row.game}|${textKey(row.pitcher)}|${row.listedLine}`;
    const existing = propMap.get(key);
    if (!existing || row.rank < existing.rank) propMap.set(key, row);
  });
  props = [...propMap.values()].sort((a, b) => a.rank - b.rank);

  const status = splits.length ? "LIVE" : props.length ? "PARTIAL" : "UNAVAILABLE";
  return {
    ok: true,
    status,
    updatedAt: draftKingsNowET(),
    stale: false,
    splits,
    props,
    errors,
  };
}

async function loadDraftKingsData(): Promise<DraftKingsPayload> {
  const now = Date.now();
  if (
    draftKingsCacheEntry &&
    now - draftKingsCacheEntry.savedAt < CACHE_TTL_MS
  ) {
    return draftKingsCacheEntry.payload;
  }

  try {
    const payload = await buildDraftKingsPayload();
    if (payload.status !== "UNAVAILABLE") {
      const mergedPayload = mergeDraftKingsPayload(
        payload,
        draftKingsCacheEntry?.payload,
      );
      draftKingsCacheEntry = { savedAt: now, payload: mergedPayload };
      return mergedPayload;
    }

    if (
      payload.status === "UNAVAILABLE" &&
      draftKingsCacheEntry &&
      now - draftKingsCacheEntry.savedAt < STALE_FALLBACK_MS
    ) {
      return {
        ...draftKingsCacheEntry.payload,
        stale: true,
        errors: [
          ...draftKingsCacheEntry.payload.errors,
          ...payload.errors,
        ],
      };
    }

    return payload;
  } catch (error) {
    if (
      draftKingsCacheEntry &&
      now - draftKingsCacheEntry.savedAt < STALE_FALLBACK_MS
    ) {
      return {
        ...draftKingsCacheEntry.payload,
        stale: true,
        errors: [
          ...draftKingsCacheEntry.payload.errors,
          `Live refresh failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ],
      };
    }

    return {
      ok: false,
      status: "UNAVAILABLE",
      updatedAt: draftKingsNowET(),
      stale: false,
      splits: [],
      props: [],
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

type WorksheetMatrixRow = {
  sheetRow: number;
  values: string[];
  object: SheetRow;
};

type WorksheetMatrix = {
  headers: string[];
  rows: WorksheetMatrixRow[];
};

type SheetBlockUpdate = {
  sheetRow: number;
  fields: SheetRow;
};

function mainSpreadsheetId() {
  return (
    process.env.GOOGLE_SHEET_ID ||
    process.env.GOOGLE_SPREADSHEET_ID ||
    process.env.SPREADSHEET_ID ||
    ""
  ).trim();
}

function escapedSheetName(value: string) {
  return String(value || "").replace(/'/g, "''");
}

function columnLetter(indexZeroBased: number) {
  let value = indexZeroBased + 1;
  let output = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    output = String.fromCharCode(65 + remainder) + output;
    value = Math.floor((value - 1) / 26);
  }
  return output;
}

function mainSheetsClient() {
  const spreadsheetId = mainSpreadsheetId();
  const { clientEmail, privateKey } = serviceAccountFromEnv();
  if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEET_ID for pregame DraftKings persistence.");
  if (!clientEmail || !privateKey) {
    throw new Error("Missing Google service-account credentials for pregame DraftKings persistence.");
  }
  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return {
    spreadsheetId,
    sheets: google.sheets({ version: "v4", auth }),
  };
}

function matrixFromValues(values: unknown[][]): WorksheetMatrix {
  const headers = (values[0] || []).map((value) => String(value ?? "").trim());
  const rows: WorksheetMatrixRow[] = [];
  for (let index = 1; index < values.length; index += 1) {
    const raw = (values[index] || []).map((value) => String(value ?? ""));
    if (!raw.some((value) => value.trim())) continue;
    const object: SheetRow = {};
    headers.forEach((header, columnIndex) => {
      if (header) object[header] = raw[columnIndex] || "";
    });
    rows.push({ sheetRow: index + 1, values: raw, object });
  }
  return { headers, rows };
}

async function ensureWorksheet(
  sheets: any,
  spreadsheetId: string,
  tabName: string,
  headers: string[] = [],
) {
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.title",
  });
  const exists = (metadata.data.sheets || []).some(
    (sheet: any) => String(sheet?.properties?.title || "") === tabName,
  );
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] },
    });
  }
  if (headers.length) {
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${escapedSheetName(tabName)}'!1:1`,
    });
    const currentHeaders = (result.data.values?.[0] || []).map((value: unknown) =>
      String(value ?? "").trim(),
    );
    const mergedHeaders = currentHeaders.length
      ? [
          ...currentHeaders,
          ...headers.filter((header) => !currentHeaders.includes(header)),
        ]
      : headers;
    if (mergedHeaders.length !== currentHeaders.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${escapedSheetName(tabName)}'!A1:${columnLetter(mergedHeaders.length - 1)}1`,
        valueInputOption: "RAW",
        requestBody: { values: [mergedHeaders] },
      });
    }
  }
}

async function readWorksheetMatrixWithClient(
  sheets: any,
  spreadsheetId: string,
  tabName: string,
  createHeaders: string[] = [],
): Promise<WorksheetMatrix> {
  if (createHeaders.length) {
    await ensureWorksheet(sheets, spreadsheetId, tabName, createHeaders);
  }
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${escapedSheetName(tabName)}'!A:ZZ`,
  });
  return matrixFromValues((result.data.values || []) as unknown[][]);
}

async function writeWholeWorksheet(
  sheets: any,
  spreadsheetId: string,
  tabName: string,
  headers: string[],
  rows: SheetRow[],
) {
  await ensureWorksheet(sheets, spreadsheetId, tabName, headers);
  const values = [
    headers,
    ...rows.map((row) => headers.map((header) => String(row[header] ?? ""))),
  ];
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `'${escapedSheetName(tabName)}'!A:ZZ`,
    requestBody: {},
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${escapedSheetName(tabName)}'!A1`,
    valueInputOption: "RAW",
    requestBody: { values },
  });
}

async function writeWorksheetBlocks(
  sheets: any,
  spreadsheetId: string,
  tabName: string,
  matrix: WorksheetMatrix,
  updates: SheetBlockUpdate[],
  startHeader: string,
  endHeader: string,
) {
  if (!updates.length) return;
  const startIndex = matrix.headers.indexOf(startHeader);
  const endIndex = matrix.headers.indexOf(endHeader);
  if (startIndex < 0 || endIndex < startIndex) {
    throw new Error(`${tabName} is missing the DraftKings columns from ${startHeader} through ${endHeader}.`);
  }

  const data = updates.map((update) => {
    const existing = matrix.rows.find((row) => row.sheetRow === update.sheetRow);
    const fullRow = Array.from({ length: matrix.headers.length }, (_, index) =>
      String(existing?.values[index] ?? ""),
    );
    for (const [header, value] of Object.entries(update.fields)) {
      const index = matrix.headers.indexOf(header);
      if (index >= startIndex && index <= endIndex) fullRow[index] = String(value ?? "");
    }
    return {
      range: `'${escapedSheetName(tabName)}'!${columnLetter(startIndex)}${update.sheetRow}:${columnLetter(endIndex)}${update.sheetRow}`,
      values: [fullRow.slice(startIndex, endIndex + 1)],
    };
  });

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: "RAW", data },
  });
}

function isoPublicDate(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const us = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2}|\d{4})$/);
  if (us) {
    const year = us[3].length === 2 ? `20${us[3]}` : us[3];
    return `${year}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : draftKingsDateET(parsed);
}

function sameDraftKingsGame(
  row: SheetRow,
  marketRow: { date: string; awayTeam: string; homeTeam: string },
) {
  const away = normalizeTeam(row["Away Team"] || "");
  const home = normalizeTeam(row["Home Team"] || "");
  if (away !== marketRow.awayTeam || home !== marketRow.homeTeam) return false;
  const rowDate = isoPublicDate(row["Date"] || "");
  const marketDate = isoPublicDate(marketRow.date);
  return !rowDate || !marketDate || rowDate === marketDate;
}

function teamFromSelection(value: unknown) {
  const key = textKey(value);
  if (!key) return "";
  const matches = Object.keys(MLB_TEAM_ALIASES)
    .filter((team) => key.includes(textKey(team)))
    .sort((a, b) => b.length - a.length);
  return matches[0] || normalizeTeam(value);
}

function scheduledGameStart(row: SheetRow) {
  const value = firstValue(row, [
    "Game Time",
    "Game Start Time",
    "Scheduled Start",
    "Start Time",
    "Game Time ET",
  ]);
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function isPregameRow(row: SheetRow, now = Date.now()) {
  const start = scheduledGameStart(row);
  return start == null || now < start;
}

function availableSplitsForGame(
  row: SheetRow,
  payload: DraftKingsPayload,
  market?: DraftKingsSplit["market"],
) {
  return payload.splits.filter(
    (item) => sameDraftKingsGame(row, item) && (!market || item.market === market),
  );
}

function availablePropsForGame(row: SheetRow, payload: DraftKingsPayload) {
  return payload.props.filter((item) => sameDraftKingsGame(row, item));
}

function selectedMoneylineSplit(row: SheetRow, payload: DraftKingsPayload) {
  const selectedTeam = teamFromSelection(row["Better ML"] || "");
  if (!selectedTeam) return null;
  return (
    availableSplitsForGame(row, payload, "Moneyline").find(
      (item) => item.selectionTeam === selectedTeam,
    ) || null
  );
}

function selectedTotalSplit(row: SheetRow, payload: DraftKingsPayload) {
  const grade = normalizeType(row["Total Runs Grade"] || row["Total Grade"] || "");
  const side = grade.includes("UNDER") ? "Under" : grade.includes("OVER") ? "Over" : "";
  if (!side) return null;
  return availableSplitsForGame(row, payload, "Total").find((item) => item.side === side) || null;
}

function selectedRunLineSplit(row: SheetRow, payload: DraftKingsPayload) {
  const selectedTeam = teamFromSelection(row["Better ML"] || "");
  if (!selectedTeam) return null;
  return (
    availableSplitsForGame(row, payload, "Run Line").find(
      (item) => item.selectionTeam === selectedTeam,
    ) || null
  );
}

function selectedPitcherProp(summary: unknown, row: SheetRow, payload: DraftKingsPayload) {
  const parsed = parseKSummary(String(summary || ""));
  const pitcher = textKey(parsed.pitcherName);
  if (!pitcher) return null;
  const options = availablePropsForGame(row, payload).filter(
    (item) => textKey(item.pitcher) === pitcher,
  );
  if (!options.length) return null;
  const modelLine = Number(parsed.line);
  if (Number.isFinite(modelLine) && modelLine > 0) {
    const exact = options.find(
      (item) => item.line != null && Math.abs(item.line - modelLine) < 0.01,
    );
    if (exact) return exact;
  }
  return options[0];
}

function splitSlateFields(prefix: string, item: DraftKingsSplit | null, updatedAt: string) {
  if (!item) return {};
  const snapshotTime = item.lastSeenAt || updatedAt;
  return {
    [`${prefix} Public Bets %`]: String(item.betsPct),
    [`${prefix} Public Money %`]: String(item.moneyPct),
    [`${prefix} Public Gap %`]: String(item.gapPct),
    [`${prefix} Public Warning`]: item.warning,
    [`${prefix} Public Warning Negative`]: item.warningNegative ? "TRUE" : "FALSE",
    [`${prefix} Public Split Selection`]: item.selection,
    [`${prefix} Public Split Line`]: item.line == null ? "" : String(item.line),
    [`${prefix} Public Split Odds`]: item.odds,
    [`${prefix} Public Split Source`]: "DraftKings",
    [`${prefix} Public Match Confidence`]: item.retained
      ? "Last-known retained selected-side match"
      : "Final-pregame selected-side match",
    "Public Data Updated": snapshotTime,
  } as SheetRow;
}

function propSlateFields(prefix: string, item: DraftKingsProp | null, updatedAt: string, summary: unknown) {
  if (!item) return {};
  const snapshotTime = item.lastSeenAt || updatedAt;
  const parsed = parseKSummary(String(summary || ""));
  const grade = normalizeType(summary);
  const modelSide = grade.includes("UNDER") ? "Under" : grade.includes("OVER") ? "Over" : "";
  const modelLine = Number(parsed.line);
  const exactSide = !modelSide || !item.side || modelSide === item.side;
  const exactLine = !Number.isFinite(modelLine) || modelLine <= 0 || item.line == null || Math.abs(modelLine - item.line) < 0.01;
  return {
    [`${prefix} Prop Popularity Rank`]: String(item.rank),
    [`${prefix} Prop Popularity Flag`]: exactSide && exactLine ? "TRUE" : "FALSE",
    [`${prefix} Prop Popularity Market`]: item.market,
    [`${prefix} Prop Popularity Line`]: item.listedLine,
    [`${prefix} Prop Popularity Odds`]: item.odds,
    [`${prefix} Prop Popularity Source`]: "DraftKings",
    [`${prefix} Prop Popularity Updated`]: snapshotTime,
    [`${prefix} Prop Popularity Match Confidence`]: item.retained
      ? exactSide && exactLine
        ? "Last-known retained exact pitcher side/line match"
        : "Last-known retained pitcher match"
      : exactSide && exactLine
        ? "Final-pregame exact pitcher side/line match"
        : "Final-pregame pitcher match",
    "Public Data Updated": snapshotTime,
  } as SheetRow;
}

function trackerSplitFields(item: DraftKingsSplit, updatedAt: string) {
  const snapshotTime = item.lastSeenAt || updatedAt;
  return {
    "Public Bets %": String(item.betsPct),
    "Public Money %": String(item.moneyPct),
    "Public Gap %": String(item.gapPct),
    "Public Warning": item.warning,
    "Public Warning Negative": item.warningNegative ? "TRUE" : "FALSE",
    "Public Split Source": "DraftKings",
    "Public Split Market": item.market,
    "Public Split Selection": item.selection,
    "Public Split Line": item.line == null ? "" : String(item.line),
    "Public Split Odds": item.odds,
    "Public Split Match Confidence": item.retained
      ? "Last-known retained selected-side match"
      : "Final-pregame selected-side match",
    "Public Split Snapshot Time": snapshotTime,
  } as SheetRow;
}

function trackerPropFields(item: DraftKingsProp, updatedAt: string, exactMatch: boolean) {
  const snapshotTime = item.lastSeenAt || updatedAt;
  return {
    "Most Bet Prop": exactMatch ? "TRUE" : "FALSE",
    "Most Bet Prop Rank": String(item.rank),
    "Prop Popularity Market": item.market,
    "Prop Popularity Line": item.listedLine,
    "Prop Popularity Odds": item.odds,
    "Prop Popularity Source": "DraftKings",
    "Prop Popularity Match Confidence": item.retained
      ? exactMatch
        ? "Last-known retained exact pitcher side/line match"
        : "Last-known retained pitcher match"
      : exactMatch
        ? "Final-pregame exact pitcher side/line match"
        : "Final-pregame pitcher match",
    "Prop Popularity Snapshot Time": snapshotTime,
  } as SheetRow;
}

function snapshotRecordFromSplit(
  item: DraftKingsSplit,
  snapshotTime: string,
  captureMode: SnapshotCaptureMode = "live",
): SheetRow {
  return {
    "Snapshot Time ET": snapshotTime,
    "Opening Snapshot Time ET": item.openingSnapshotTime || snapshotTime,
    Date: item.date,
    Game: item.game,
    "Away Team": item.awayTeam,
    "Home Team": item.homeTeam,
    "Data Type": "Game Market",
    Market: item.market,
    Selection: item.selection,
    Line: item.line == null ? "" : String(item.line),
    Odds: item.odds,
    "Opening Line": item.openingLine == null ? "" : String(item.openingLine),
    "Opening Odds": item.openingOdds || item.odds,
    "Opening Implied %": item.openingImpliedPct == null ? "" : String(item.openingImpliedPct),
    "Current Implied %": item.currentImpliedPct == null ? "" : String(item.currentImpliedPct),
    "Opening Public %": String(item.openingBetsPct ?? item.betsPct),
    "Current Public %": String(item.betsPct),
    "Public Change %": String(item.publicMovementPct ?? 0),
    "Opening Sharp %": String(item.openingMoneyPct ?? item.moneyPct),
    "Current Sharp %": String(item.moneyPct),
    "Sharp Change %": String(item.sharpMovementPct ?? 0),
    "Public Bets %": String(item.betsPct),
    "Public Money %": String(item.moneyPct),
    "Public Gap %": String(item.gapPct),
    "Warning Key": item.warningKey,
    Warning: item.warning,
    "Warning Tone": item.warningTone,
    "Warning Negative": item.warningNegative ? "TRUE" : "FALSE",
    "Line Movement Signal": item.lineMovementSignal || "",
    "Line Movement Tone": item.lineMovementTone || "",
    "Line Movement Basis": item.lineMovementBasis || "",
    "Line Movement Value": item.lineMovementValue == null ? "" : String(item.lineMovementValue),
    "Popularity Rank": "",
    Source: "DraftKings",
    "Match Confidence": captureMode === "tracking"
      ? item.retained
        ? "15-minute tracking snapshot (last-known retained market)"
        : "15-minute tracking snapshot (live market)"
      : captureMode === "scheduled"
        ? item.retained
          ? "Scheduled pregame snapshot (last-known retained market)"
          : "Scheduled pregame market snapshot"
        : item.retained
          ? "Last-known retained pregame market snapshot"
          : "Live-site pregame market snapshot",
    "Source URL": DK_BETTING_SPLITS_URL,
  };
}

function snapshotRecordFromProp(
  item: DraftKingsProp,
  snapshotTime: string,
  captureMode: SnapshotCaptureMode = "live",
): SheetRow {
  return {
    "Snapshot Time ET": snapshotTime,
    "Opening Snapshot Time ET": snapshotTime,
    Date: item.date,
    Game: item.game,
    "Away Team": item.awayTeam,
    "Home Team": item.homeTeam,
    "Data Type": "Player Prop Popularity",
    Market: item.market,
    Selection: item.pitcher,
    Line: item.listedLine,
    Odds: item.odds,
    "Opening Line": "",
    "Opening Odds": "",
    "Opening Implied %": "",
    "Current Implied %": "",
    "Opening Public %": "",
    "Current Public %": "",
    "Public Change %": "",
    "Opening Sharp %": "",
    "Current Sharp %": "",
    "Sharp Change %": "",
    "Public Bets %": "",
    "Public Money %": "",
    "Public Gap %": "",
    "Warning Key": "POPULAR_PLAYER_PROP",
    Warning: "Popular Player Prop",
    "Warning Tone": "caution",
    "Warning Negative": "",
    "Line Movement Signal": "",
    "Line Movement Tone": "",
    "Line Movement Basis": "",
    "Line Movement Value": "",
    "Popularity Rank": String(item.rank),
    Source: "DraftKings",
    "Match Confidence": captureMode === "tracking"
      ? item.retained
        ? "15-minute tracking snapshot (last-known retained pitcher popularity)"
        : "15-minute tracking snapshot (pitcher popularity)"
      : captureMode === "scheduled"
        ? item.retained
          ? "Scheduled pitcher popularity snapshot (last-known retained)"
          : "Scheduled pitcher popularity snapshot"
        : item.retained
          ? "Last-known retained pitcher popularity snapshot"
          : "Live-site pitcher popularity snapshot",
    "Source URL": DK_PLAYER_PROPS_URL,
  };
}

function trackerSplitFieldsFromSnapshot(row: SheetRow) {
  return {
    "Public Bets %": String(row["Public Bets %"] || ""),
    "Public Money %": String(row["Public Money %"] || ""),
    "Public Gap %": String(row["Public Gap %"] || ""),
    "Public Warning": String(row.Warning || ""),
    "Public Warning Negative": truthyValue(row["Warning Negative"]) ? "TRUE" : "FALSE",
    "Public Split Source": String(row.Source || "DraftKings"),
    "Public Split Market": String(row.Market || ""),
    "Public Split Selection": String(row.Selection || ""),
    "Public Split Line": String(row.Line || ""),
    "Public Split Odds": String(row.Odds || ""),
    "Public Split Match Confidence": String(
      row["Match Confidence"] || "Saved final-pregame snapshot",
    ),
    "Public Split Snapshot Time": String(row["Snapshot Time ET"] || ""),
  } as SheetRow;
}

function allGameTrendFieldsFromSplit(
  item: DraftKingsSplit,
  updatedAt: string,
  confidence: string,
) {
  return {
    ...trackerSplitFields(item, updatedAt),
    "Public Split Match Confidence": confidence,
    "Opening Public %": String(item.openingBetsPct ?? item.betsPct),
    "Current Public %": String(item.betsPct),
    "Public Change %": String(item.publicMovementPct ?? 0),
    "Opening Sharp %": String(item.openingMoneyPct ?? item.moneyPct),
    "Current Sharp %": String(item.moneyPct),
    "Sharp Change %": String(item.sharpMovementPct ?? 0),
    "Opening Public Split Line": item.openingLine == null ? "" : String(item.openingLine),
    "Opening Public Split Odds": item.openingOdds || item.odds,
    "Opening Public Split Snapshot Time": item.openingSnapshotTime || "",
    "Opening Implied %": item.openingImpliedPct == null ? "" : String(item.openingImpliedPct),
    "Current Implied %": item.currentImpliedPct == null ? "" : String(item.currentImpliedPct),
    "Line Movement Signal": item.lineMovementSignal || "",
    "Line Movement Tone": item.lineMovementTone || "",
    "Line Movement Basis": item.lineMovementBasis || "",
    "Line Movement Value":
      item.lineMovementValue == null ? "" : String(item.lineMovementValue),
  } as SheetRow;
}

function allGameTrendFieldsFromSnapshot(row: SheetRow) {
  return {
    ...trackerSplitFieldsFromSnapshot(row),
    "Opening Public %": String(row["Opening Public %"] || row["Public Bets %"] || ""),
    "Current Public %": String(row["Current Public %"] || row["Public Bets %"] || ""),
    "Public Change %": String(row["Public Change %"] || "0"),
    "Opening Sharp %": String(row["Opening Sharp %"] || row["Public Money %"] || ""),
    "Current Sharp %": String(row["Current Sharp %"] || row["Public Money %"] || ""),
    "Sharp Change %": String(row["Sharp Change %"] || "0"),
    "Opening Public Split Line": String(row["Opening Line"] || ""),
    "Opening Public Split Odds": String(row["Opening Odds"] || ""),
    "Opening Public Split Snapshot Time": String(row["Opening Snapshot Time ET"] || ""),
    "Opening Implied %": String(row["Opening Implied %"] || ""),
    "Current Implied %": String(row["Current Implied %"] || ""),
    "Line Movement Signal": String(row["Line Movement Signal"] || ""),
    "Line Movement Tone": String(row["Line Movement Tone"] || ""),
    "Line Movement Basis": String(row["Line Movement Basis"] || ""),
    "Line Movement Value": String(row["Line Movement Value"] || ""),
  } as SheetRow;
}

function draftKingsGameKey(row: SheetRow) {
  return `${isoPublicDate(row.Date)}|${normalizeTeam(row["Away Team"] || "")}|${normalizeTeam(row["Home Team"] || "")}`;
}

function minutesBeforeScheduledStart(row: SheetRow, now = Date.now()) {
  const start = scheduledGameStart(row);
  return start == null ? null : (start - now) / 60_000;
}

function isFifteenMinuteTrackingWindow(row: SheetRow, now = Date.now()) {
  const minutes = minutesBeforeScheduledStart(row, now);
  // GitHub wakes the route near common MLB start times. The tolerance handles
  // uncommon start minutes and normal scheduler delay while still creating
  // exactly one dedicated tracking snapshot per game.
  return minutes != null && minutes >= 7 && minutes <= 23;
}

function isFifteenMinuteTrackingSnapshot(row: SheetRow | undefined | null) {
  return textKey(row?.["Match Confidence"] || "").includes("15 minute tracking snapshot");
}

function isPregameMarketSnapshot(row: SheetRow | undefined | null) {
  const confidence = textKey(row?.["Match Confidence"] || "");
  return (
    isFifteenMinuteTrackingSnapshot(row) ||
    confidence.includes("pregame market snapshot") ||
    confidence.includes("scheduled pregame snapshot")
  );
}

function slateHasFinalPregameSnapshot(row: SheetRow | undefined | null) {
  return textKey(row?.["Public Data Status"] || "").includes("final pregame");
}

function isOfficialTrendSnapshotConfidence(value: unknown) {
  const confidence = textKey(value);
  return (
    confidence.includes("15 minute tracking snapshot") ||
    confidence.includes("final pregame fallback snapshot")
  );
}

function snapshotRecordKey(row: SheetRow) {
  const dataType = textKey(row["Data Type"] || "");
  const market = String(row.Market || "");
  const selection = String(row.Selection || "");
  let selectedKey = textKey(selection);
  if (dataType.includes("game market")) {
    if (textKey(market) === "total") {
      selectedKey = textKey(selection).startsWith("under") ? "under" : "over";
    } else {
      selectedKey = textKey(teamFromSelection(selection));
    }
  } else {
    selectedKey = textKey(selection);
  }
  return `${isoPublicDate(row.Date)}|${textKey(row.Game)}|${dataType}|${textKey(market)}|${selectedKey}`;
}

function snapshotPayloadFromRows(rows: SheetRow[], today: string): DraftKingsPayload {
  const todayIso = isoPublicDate(today);
  const splits: DraftKingsSplit[] = [];
  const props: DraftKingsProp[] = [];
  let latest = "";
  for (const row of rows) {
    if (isoPublicDate(row.Date) !== todayIso) continue;
    const awayTeam = normalizeTeam(row["Away Team"] || "");
    const homeTeam = normalizeTeam(row["Home Team"] || "");
    if (!awayTeam || !homeTeam) continue;
    const date = isoPublicDate(row.Date);
    const game = String(row.Game || `${awayTeam} at ${homeTeam}`);
    const snapshotTime = String(row["Snapshot Time ET"] || "");
    if (snapshotTime) latest = snapshotTime;
    const dataType = textKey(row["Data Type"] || "");
    if (dataType.includes("player prop")) {
      const sideLine = propSideAndLine(row.Line || "");
      props.push({
        date,
        game,
        awayTeam,
        homeTeam,
        pitcher: String(row.Selection || ""),
        market: String(row.Market || ""),
        listedLine: String(row.Line || ""),
        side: sideLine.side,
        line: sideLine.line,
        odds: String(row.Odds || ""),
        rank: Math.max(1, toNumber(row["Popularity Rank"]) || 999),
        retained: true,
        lastSeenAt: snapshotTime,
      });
      continue;
    }

    const marketText = textKey(row.Market || "");
    const market: DraftKingsSplit["market"] = marketText.includes("run line")
      ? "Run Line"
      : marketText.includes("total")
        ? "Total"
        : "Moneyline";
    const selection = String(row.Selection || "");
    const side = selection.toLowerCase().startsWith("under")
      ? "Under"
      : selection.toLowerCase().startsWith("over")
        ? "Over"
        : "";
    const betsPct = Math.max(
      0,
      Math.min(100, toNumber(row["Current Public %"] || row["Public Bets %"])),
    );
    const moneyPct = Math.max(
      0,
      Math.min(100, toNumber(row["Current Sharp %"] || row["Public Money %"])),
    );
    const openingBetsPct = Math.max(
      0,
      Math.min(100, toNumber(row["Opening Public %"] || row["Public Bets %"])),
    );
    const openingMoneyPct = Math.max(
      0,
      Math.min(100, toNumber(row["Opening Sharp %"] || row["Public Money %"])),
    );
    const baseSplit: DraftKingsSplit = {
      date,
      game,
      awayTeam,
      homeTeam,
      market,
      selection,
      selectionTeam: market === "Total" ? "" : teamFromSelection(selection),
      side,
      line: market === "Moneyline" ? null : numericLine(row.Line || selection),
      odds: String(row.Odds || ""),
      betsPct,
      moneyPct,
      gapPct: 0,
      warningKey: "",
      warning: "",
      warningTone: "neutral",
      warningNegative: false,
      openingLine: row["Opening Line"] === "" ? null : numericLine(row["Opening Line"]),
      openingOdds: String(row["Opening Odds"] || row.Odds || ""),
      openingBetsPct,
      openingMoneyPct,
      openingSnapshotTime: String(row["Opening Snapshot Time ET"] || snapshotTime),
      retained: true,
      lastSeenAt: snapshotTime,
      snapshotStatus: isFifteenMinuteTrackingSnapshot(row)
        ? "FINAL_PREGAME"
        : "LIVE",
      snapshotTime,
    };
    const openingReference: DraftKingsSplit = {
      ...baseSplit,
      line: baseSplit.openingLine ?? baseSplit.line,
      odds: baseSplit.openingOdds || baseSplit.odds,
      openingLine: baseSplit.openingLine ?? baseSplit.line,
      openingOdds: baseSplit.openingOdds || baseSplit.odds,
      betsPct: openingBetsPct,
      moneyPct: openingMoneyPct,
      openingBetsPct,
      openingMoneyPct,
      openingSnapshotTime: baseSplit.openingSnapshotTime,
    };
    splits.push({
      ...enrichDraftKingsSplit(baseSplit, openingReference, snapshotTime),
      retained: true,
    });
  }
  return {
    ok: true,
    status: splits.length ? "LIVE" : props.length ? "PARTIAL" : "UNAVAILABLE",
    updatedAt: latest || draftKingsNowET(),
    stale: false,
    splits,
    props,
    errors: [],
  };
}

function publicDisplayDraftKingsPayload(
  current: DraftKingsPayload,
  finalSnapshots: DraftKingsPayload,
  slateRows: SheetRow[],
): DraftKingsPayload {
  const finalMarketSplits = finalSnapshots.splits.filter(
    (split) =>
      split.snapshotStatus === "FINAL_PREGAME" &&
      (split.market === "Moneyline" || split.market === "Total"),
  );
  const lockedGameKeys = new Set(
    finalMarketSplits.map(
      (split) =>
        `${isoPublicDate(split.date)}|${normalizeTeam(split.awayTeam)}|${normalizeTeam(split.homeTeam)}`,
    ),
  );

  const splitMap = new Map<string, DraftKingsSplit>();
  for (const split of current.splits) {
    const gameKey =
      `${isoPublicDate(split.date)}|${normalizeTeam(split.awayTeam)}|${normalizeTeam(split.homeTeam)}`;
    if (
      lockedGameKeys.has(gameKey) &&
      (split.market === "Moneyline" || split.market === "Total")
    ) {
      continue;
    }
    splitMap.set(draftKingsSplitKey(split), {
      ...split,
      snapshotStatus: split.snapshotStatus || "LIVE",
      snapshotTime: split.snapshotTime || split.lastSeenAt || current.updatedAt,
    });
  }

  for (const split of finalMarketSplits) {
    splitMap.set(draftKingsSplitKey(split), {
      ...split,
      snapshotStatus: "FINAL_PREGAME",
      snapshotTime: split.snapshotTime || split.lastSeenAt || finalSnapshots.updatedAt,
    });
  }

  const slateGameKeys = new Set(
    slateRows
      .filter((row) => isoPublicDate(row.Date || "") === draftKingsDateET())
      .map((row) => draftKingsGameKey(row)),
  );
  const finalSnapshotGames = [...lockedGameKeys].filter((key) =>
    slateGameKeys.size ? slateGameKeys.has(key) : true,
  ).length;
  const totalSlateGames = slateGameKeys.size;
  const displayMode: DraftKingsPayload["displayMode"] =
    finalSnapshotGames === 0
      ? "LIVE"
      : totalSlateGames > 0 && finalSnapshotGames >= totalSlateGames
        ? "FINAL_PREGAME"
        : "MIXED";

  return {
    ...current,
    splits: [...splitMap.values()],
    displayMode,
    finalSnapshotGames,
  };
}

function truthyValue(value: unknown) {
  return ["TRUE", "YES", "Y", "1"].includes(String(value ?? "").trim().toUpperCase());
}

async function safeReadPublicSplitRows(): Promise<SheetRow[]> {
  try {
    return await readWorksheet(PUBLIC_SPLIT_TAB);
  } catch {
    return [];
  }
}

async function safeReadAllGameTrendRows(): Promise<SheetRow[]> {
  try {
    const { spreadsheetId, sheets } = mainSheetsClient();
    const matrix = await readWorksheetMatrixWithClient(
      sheets,
      spreadsheetId,
      ALL_GAME_TRENDS_TAB,
      ALL_GAME_TRENDS_HEADERS,
    );
    return matrix.rows.map((row) => row.object);
  } catch {
    return [];
  }
}

async function safeReadAiPickRows(): Promise<SheetRow[]> {
  try {
    return await readWorksheet(AI_PICK_SELECTOR_TAB);
  } catch {
    return [];
  }
}

type SnapshotCaptureMode = "live" | "scheduled" | "tracking" | "scheduled_tracking";

async function persistFinalPregameDraftKings(
  livePayload: DraftKingsPayload,
  today: string,
  captureMode: SnapshotCaptureMode = "live",
): Promise<DraftKingsPersistence> {
  const trackingCapture =
    captureMode === "tracking" || captureMode === "scheduled_tracking";
  const scheduledCapture =
    captureMode === "scheduled" || captureMode === "scheduled_tracking";
  const todayIso = isoPublicDate(today);
  const persistenceKey = `${captureMode.toUpperCase()}|${todayIso}|${livePayload.updatedAt}|${livePayload.splits.length}|${livePayload.props.length}`;
  if (
    draftKingsPersistenceCache &&
    draftKingsPersistenceCache.key === persistenceKey &&
    Date.now() - draftKingsPersistenceCache.savedAt < CACHE_TTL_MS
  ) {
    return draftKingsPersistenceCache.result;
  }

  const result: DraftKingsPersistence = {
    status: "SKIPPED",
    updatedAt: draftKingsNowET(),
    snapshotRowsUpdated: 0,
    slateRowsUpdated: 0,
    trackerRowsUpdated: 0,
    allGameTrendRowsUpdated: 0,
    finalPregameRows: 0,
  };

  // Persist every usable current or retained pregame value. This is deliberate:
  // when DraftKings temporarily removes a market, the last value still visible on
  // the public site must remain available for the tracker and historical records.
  const availableSplits = livePayload.splits.filter(
    (item) => isoPublicDate(item.date) === todayIso,
  );
  const availableProps = livePayload.props.filter(
    (item) => isoPublicDate(item.date) === todayIso,
  );
  if (!availableSplits.length && !availableProps.length) {
    draftKingsPersistenceCache = { key: persistenceKey, savedAt: Date.now(), result };
    return result;
  }

  try {
    const { spreadsheetId, sheets } = mainSheetsClient();
    const [slateMatrix, trackerMatrix, trendMatrix, snapshotMatrix] = await Promise.all([
      readWorksheetMatrixWithClient(sheets, spreadsheetId, "daily_slate"),
      readWorksheetMatrixWithClient(sheets, spreadsheetId, "bet_tracker"),
      readWorksheetMatrixWithClient(
        sheets,
        spreadsheetId,
        ALL_GAME_TRENDS_TAB,
        ALL_GAME_TRENDS_HEADERS,
      ),
      readWorksheetMatrixWithClient(
        sheets,
        spreadsheetId,
        PUBLIC_SPLIT_TAB,
        PUBLIC_SPLIT_HEADERS,
      ),
    ]);

    const now = Date.now();
    const slateUpdates: SheetBlockUpdate[] = [];
    const trackerUpdates: SheetBlockUpdate[] = [];
    const trendUpdates: SheetBlockUpdate[] = [];
    const snapshotRecords: SheetRow[] = [];
    const slateObjects = slateMatrix.rows.map((row) => row.object);
    const savedSnapshotObjects = snapshotMatrix.rows.map((row) => row.object);
    const alreadyCapturedGameKeys = new Set(
      savedSnapshotObjects
        .filter((row) => isFifteenMinuteTrackingSnapshot(row))
        .filter((row) => textKey(row["Data Type"] || "") === "game market")
        .filter((row) => String(row["Public Bets %"] || "").trim() !== "")
        .filter((row) => String(row["Public Money %"] || "").trim() !== "")
        .map((row) => draftKingsGameKey(row)),
    );
    const trackingGameKeys = new Set(
      slateObjects
        .filter((row) => isoPublicDate(row.Date) === todayIso)
        .filter((row) => isFifteenMinuteTrackingWindow(row, now))
        .map((row) => draftKingsGameKey(row))
        .filter((key) => key && !alreadyCapturedGameKeys.has(key)),
    );

    if (trackingCapture && !scheduledCapture && !trackingGameKeys.size) {
      draftKingsPersistenceCache = { key: persistenceKey, savedAt: Date.now(), result };
      return result;
    }

    for (const matrixRow of slateMatrix.rows) {
      const row = matrixRow.object;
      if (isoPublicDate(row.Date) !== todayIso) continue;
      const trackingTarget = trackingGameKeys.has(draftKingsGameKey(row));
      if (trackingCapture && !scheduledCapture && !trackingTarget) continue;
      const rowCaptureMode: SnapshotCaptureMode = trackingTarget
        ? "tracking"
        : scheduledCapture
          ? "scheduled"
          : "live";
      const pregame = isPregameRow(row, now);
      const matchingSplits = availableSplits.filter((item) => sameDraftKingsGame(row, item));
      const matchingProps = availableProps.filter((item) => sameDraftKingsGame(row, item));
      if (!pregame) {
        const hasSaved = Boolean(
          firstValue(row, ["Public Data Updated", "ML Public Bets %", "Total Public Bets %"]),
        );
        if (hasSaved && row["Public Data Status"] !== "FINAL PREGAME") {
          slateUpdates.push({
            sheetRow: matrixRow.sheetRow,
            fields: { "Public Data Status": "FINAL PREGAME" },
          });
          result.finalPregameRows += 1;
        }
        continue;
      }
      if (!matchingSplits.length && !matchingProps.length) continue;

      matchingSplits.forEach((item) =>
        snapshotRecords.push(
          snapshotRecordFromSplit(
            item,
            item.lastSeenAt || livePayload.updatedAt,
            rowCaptureMode,
          ),
        ),
      );
      matchingProps.forEach((item) =>
        snapshotRecords.push(
          snapshotRecordFromProp(
            item,
            item.lastSeenAt || livePayload.updatedAt,
            rowCaptureMode,
          ),
        ),
      );

      const hasLiveMarket =
        matchingSplits.some((item) => !item.retained) ||
        matchingProps.some((item) => !item.retained);
      const latestAvailableTime = [...matchingSplits, ...matchingProps]
        .map((item) => item.lastSeenAt || "")
        .filter(Boolean)
        .sort()
        .at(-1) || livePayload.updatedAt;
      const fields: SheetRow = {
        "Public Data Status": trackingTarget
          ? hasLiveMarket
            ? "TRACKING SNAPSHOT ~15M LIVE"
            : "TRACKING SNAPSHOT ~15M RETAINED"
          : scheduledCapture
            ? hasLiveMarket
              ? "SCHEDULED PREGAME LIVE"
              : "SCHEDULED PREGAME RETAINED"
            : hasLiveMarket
              ? "PREGAME LIVE"
              : "PREGAME RETAINED",
        "Public Data Updated": latestAvailableTime,
        "Public Data Error": livePayload.errors.join(" | "),
        ...splitSlateFields("ML", selectedMoneylineSplit(row, livePayload), livePayload.updatedAt),
        ...splitSlateFields("Total", selectedTotalSplit(row, livePayload), livePayload.updatedAt),
        ...splitSlateFields("Run Line", selectedRunLineSplit(row, livePayload), livePayload.updatedAt),
        ...propSlateFields(
          "Away Pitcher",
          selectedPitcherProp(row["Away Pitcher K + Grade"], row, livePayload),
          livePayload.updatedAt,
          row["Away Pitcher K + Grade"],
        ),
        ...propSlateFields(
          "Home Pitcher",
          selectedPitcherProp(row["Home Pitcher K + Grade"], row, livePayload),
          livePayload.updatedAt,
          row["Home Pitcher K + Grade"],
        ),
        ...propSlateFields(
          "Away Bulk",
          selectedPitcherProp(row["Away Bulk Pitcher K + Grade"], row, livePayload),
          livePayload.updatedAt,
          row["Away Bulk Pitcher K + Grade"],
        ),
        ...propSlateFields(
          "Home Bulk",
          selectedPitcherProp(row["Home Bulk Pitcher K + Grade"], row, livePayload),
          livePayload.updatedAt,
          row["Home Bulk Pitcher K + Grade"],
        ),
      };
      slateUpdates.push({ sheetRow: matrixRow.sheetRow, fields });
    }

    for (const matrixRow of trackerMatrix.rows) {
      const row = matrixRow.object;
      if (isoPublicDate(row.Date) !== todayIso) continue;

      const slateRow = trackerSlateMatch(row, slateObjects);
      if (!slateRow) continue;

      const market = textKey(row.Market || "");
      const betType = normalizeType(row["Bet Type"] || "");
      const pregame = isPregameRow(slateRow, now);
      const trackingTarget = trackingGameKeys.has(draftKingsGameKey(slateRow));
      const trackerAlreadyLocked = textKey(
        row["Public Split Match Confidence"] || "",
      ).includes("15 minute tracking snapshot");
      let fields: SheetRow = {};

      // A normal website visit can show fresh live data, but it must not keep
      // changing the historical tracker. Moneyline and total tracker fields are
      // locked only by the one dedicated ~15-minute background capture.
      if (!pregame && (market.includes("moneyline") || betType.includes("MONEYLINE") ||
          market.includes("game total") || betType.includes("TOTAL"))) {
        if (!trackerAlreadyLocked) {
          const savedSnapshot = snapshotForTrackerRow(
            row,
            slateObjects,
            savedSnapshotObjects,
          );
          if (savedSnapshot && isFifteenMinuteTrackingSnapshot(savedSnapshot)) {
            fields = trackerSplitFieldsFromSnapshot(savedSnapshot);
          }
        }
      } else if (
        trackingCapture &&
        trackingTarget &&
        !trackerAlreadyLocked &&
        (market.includes("moneyline") || betType.includes("MONEYLINE"))
      ) {
        const targetTeam = teamFromSelection(row.Team || row.Selection || "");
        const item = availableSplitsForGame(slateRow, livePayload, "Moneyline").find(
          (split) => split.selectionTeam === targetTeam,
        );
        if (item) {
          fields = {
            ...trackerSplitFields(item, livePayload.updatedAt),
            "Public Split Match Confidence": item.retained
              ? "15-minute tracking snapshot (last-known retained selected-side match)"
              : "15-minute tracking snapshot (live selected-side match)",
          };
        }
      } else if (
        trackingCapture &&
        trackingTarget &&
        !trackerAlreadyLocked &&
        (market.includes("game total") || betType.includes("TOTAL"))
      ) {
        const side = betType.includes("UNDER") ? "Under" : "Over";
        const item = availableSplitsForGame(slateRow, livePayload, "Total").find(
          (split) => split.side === side,
        );
        if (item) {
          fields = {
            ...trackerSplitFields(item, livePayload.updatedAt),
            "Public Split Match Confidence": item.retained
              ? "15-minute tracking snapshot (last-known retained total-side match)"
              : "15-minute tracking snapshot (live total-side match)",
          };
        }
      } else if (pregame && market.includes("pitcher strikeout")) {
        const pitcher = textKey(extractPitcherFromSelection(row.Selection || ""));
        const props = availablePropsForGame(slateRow, livePayload).filter(
          (item) => textKey(item.pitcher) === pitcher,
        );
        if (props.length) {
          const line = numericLine(String(row["Odds/Line"] || "").split("/")[0]);
          const exact = props.find(
            (item) => line != null && item.line != null && Math.abs(item.line - line) < 0.01,
          );
          fields = trackerPropFields(exact || props[0], livePayload.updatedAt, Boolean(exact));
        }
      }

      if (Object.keys(fields).length) {
        trackerUpdates.push({ sheetRow: matrixRow.sheetRow, fields });
      }
    }

    // Build historical signal records once so the dedicated tracking snapshot can
    // freeze the Trend Play score without touching any model calculations.
    const completedTrendHistoryRows = trendMatrix.rows
      .map((matrixRow) => matrixRow.object)
      .filter((row) => isCompletedResult(row.Result));
    const trendHistoryRows = [...completedTrendHistoryRows];
    const trendHistoryKeys = new Set(
      trendHistoryRows.map((row) => draftKingsSignalSourceKey(row)),
    );
    for (const trackerRow of trackerMatrix.rows.map((matrixRow) => matrixRow.object)) {
      if (!isCompletedResult(trackerRow.Result) || !trackerMarket(trackerRow)) continue;
      const key = draftKingsSignalSourceKey(trackerRow);
      if (trendHistoryKeys.has(key)) continue;
      trendHistoryRows.push(trackerRow);
      trendHistoryKeys.add(key);
    }
    const trendSignalHistory = buildDraftKingsSignalRows(
      trendHistoryRows,
      slateObjects,
      savedSnapshotObjects,
    );
    const trackingSlateObjects = slateObjects.filter((row) =>
      trackingGameKeys.has(draftKingsGameKey(row)),
    );
    const trackingTrendSplits = availableSplits.filter((item) => {
      const key = `${isoPublicDate(item.date)}|${normalizeTeam(item.awayTeam)}|${normalizeTeam(
        item.homeTeam,
      )}`;
      return (
        trackingGameKeys.has(key) &&
        (item.market === "Moneyline" || item.market === "Total")
      );
    });
    const frozenTrackingTrendPlays = rankTrendPlays(
      buildTrendPlays(
        trackingTrendSplits,
        trendSignalHistory,
        trackingSlateObjects,
        todayIso,
        livePayload.updatedAt,
      ),
      { frozen: true },
    );
    const existingFrozenTrendPlays = frozenTrendPlaysFromRows(
      trendMatrix.rows.map((matrixRow) => matrixRow.object),
      todayIso,
    );
    const finalPregameSlateGameKeys = new Set(
      slateObjects
        .filter(slateHasFinalPregameSnapshot)
        .map((row) => draftKingsGameKey(row)),
    );
    const savedFinalSnapshotObjects = savedSnapshotObjects.filter(
      (row) =>
        isFifteenMinuteTrackingSnapshot(row) ||
        (finalPregameSlateGameKeys.has(draftKingsGameKey(row)) &&
          isPregameMarketSnapshot(row)),
    );
    const savedFinalPayload = snapshotPayloadFromRows(
      savedFinalSnapshotObjects,
      todayIso,
    );
    const savedFinalGameKeys = new Set(
      savedFinalPayload.splits.map(
        (split) =>
          `${isoPublicDate(split.date)}|${normalizeTeam(split.awayTeam)}|${normalizeTeam(
            split.homeTeam,
          )}`,
      ),
    );
    const savedFinalSlateObjects = slateObjects.filter((row) =>
      savedFinalGameKeys.has(draftKingsGameKey(row)),
    );
    const fallbackSavedTrendPlays = rankTrendPlays(
      buildTrendPlays(
        savedFinalPayload.splits,
        trendSignalHistory,
        savedFinalSlateObjects,
        todayIso,
        savedFinalPayload.updatedAt,
      ),
      { frozen: true },
    );

    // Lock the same dedicated ~15-minute snapshot into the separate all-side
    // research table. Normal public-site refreshes never overwrite it.
    for (const matrixRow of trendMatrix.rows) {
      const row = matrixRow.object;
      if (isoPublicDate(row.Date) !== todayIso) continue;

      const slateRow = trackerSlateMatch(row, slateObjects);
      if (!slateRow) continue;

      const market = trackerMarket(row);
      if (!market) continue;

      const trackingTarget = trackingGameKeys.has(draftKingsGameKey(slateRow));
      const alreadyLocked = isOfficialTrendSnapshotConfidence(
        row["Public Split Match Confidence"] || "",
      );
      // A row marked as the dedicated 15-minute snapshot is immutable. Earlier
      // repair versions rewrote Trend Tier / Trend Score after the game, which
      // caused the Records page to diverge from the actual pregame board.
      if (alreadyLocked) continue;

      const savedSnapshot = snapshotForTrackerRow(
        row,
        slateObjects,
        savedSnapshotObjects,
      );
      const savedSnapshotIsFinal = Boolean(
        savedSnapshot &&
          (isFifteenMinuteTrackingSnapshot(savedSnapshot) ||
            (slateHasFinalPregameSnapshot(slateRow) &&
              isPregameMarketSnapshot(savedSnapshot))),
      );
      if (savedSnapshot && savedSnapshotIsFinal) {
        const matchedFrozenPlay =
          trendPlayForAllGameRow(
            row,
            slateRow,
            existingFrozenTrendPlays,
          ) ||
          trendPlayForAllGameRow(
            row,
            slateRow,
            fallbackSavedTrendPlays,
          );
        const frozenPlay = applyHistoricalTrendOverride(
          row,
          matchedFrozenPlay,
          savedSnapshot,
        );
        const snapshotFields = allGameTrendFieldsFromSnapshot(savedSnapshot);
        if (!isFifteenMinuteTrackingSnapshot(savedSnapshot)) {
          snapshotFields["Public Split Match Confidence"] =
            "Final-pregame fallback snapshot (saved pregame market)";
        }
        trendUpdates.push({
          sheetRow: matrixRow.sheetRow,
          fields: {
            ...snapshotFields,
            ...trendSnapshotFields(frozenPlay),
          },
        });
        continue;
      }

      if (!trackingCapture || !trackingTarget) {
        continue;
      }

      let item: DraftKingsSplit | undefined;
      if (market === "Moneyline") {
        const targetTeam = teamFromSelection(row.Selection || row.Team || "");
        item = availableSplitsForGame(slateRow, livePayload, "Moneyline").find(
          (split) => split.selectionTeam === targetTeam,
        );
      } else {
        const side = trackerTotalSide(row);
        item = availableSplitsForGame(slateRow, livePayload, "Total").find(
          (split) => split.side === side,
        );
      }
      if (!item) continue;

      const confidence = item.retained
        ? market === "Moneyline"
          ? "15-minute tracking snapshot (last-known retained selected-side match)"
          : "15-minute tracking snapshot (last-known retained total-side match)"
        : market === "Moneyline"
          ? "15-minute tracking snapshot (live selected-side match)"
          : "15-minute tracking snapshot (live total-side match)";
      const frozenTrendPlay = applyHistoricalTrendOverride(
        row,
        trendPlayForAllGameRow(
          row,
          slateRow,
          frozenTrackingTrendPlays,
        ),
      );
      trendUpdates.push({
        sheetRow: matrixRow.sheetRow,
        fields: {
          ...allGameTrendFieldsFromSplit(item, livePayload.updatedAt, confidence),
          ...trendSnapshotFields(frozenTrendPlay),
        },
      });
    }

    if (snapshotRecords.length) {
      const snapshotMap = new Map<string, SheetRow>();
      snapshotMatrix.rows.forEach((row) =>
        snapshotMap.set(snapshotRecordKey(row.object), row.object),
      );
      snapshotRecords.forEach((row) => {
        const key = snapshotRecordKey(row);
        const existing = snapshotMap.get(key);
        // Once the dedicated tracking snapshot is captured, scheduled or live
        // refreshes may display newer data but cannot overwrite the historical row.
        const incomingTracking = isFifteenMinuteTrackingSnapshot(row);
        if (!incomingTracking && isFifteenMinuteTrackingSnapshot(existing)) return;
        snapshotMap.set(key, row);
      });
      await writeWholeWorksheet(
        sheets,
        spreadsheetId,
        PUBLIC_SPLIT_TAB,
        PUBLIC_SPLIT_HEADERS,
        [...snapshotMap.values()],
      );
      result.snapshotRowsUpdated = snapshotRecords.length;
    }

    await writeWorksheetBlocks(
      sheets,
      spreadsheetId,
      "daily_slate",
      slateMatrix,
      slateUpdates,
      "Public Data Status",
      "Home Bulk Prop Popularity Match Confidence",
    );
    await writeWorksheetBlocks(
      sheets,
      spreadsheetId,
      "bet_tracker",
      trackerMatrix,
      trackerUpdates,
      "Public Bets %",
      "Prop Popularity Snapshot Time",
    );
    await writeWorksheetBlocks(
      sheets,
      spreadsheetId,
      ALL_GAME_TRENDS_TAB,
      trendMatrix,
      trendUpdates,
      "Public Bets %",
      trendMatrix.headers.at(-1) || "Trend Score Details",
    );

    result.slateRowsUpdated = slateUpdates.length;
    result.trackerRowsUpdated = trackerUpdates.length;
    result.allGameTrendRowsUpdated = trendUpdates.length;
    result.status =
      snapshotRecords.length || slateUpdates.length || trackerUpdates.length || trendUpdates.length
        ? "SAVED"
        : "NO_CHANGES";
    draftKingsPersistenceCache = { key: persistenceKey, savedAt: Date.now(), result };
    return result;
  } catch (error) {
    const failedResult: DraftKingsPersistence = {
      ...result,
      status: "ERROR",
      error: error instanceof Error ? error.message : String(error),
    };
    draftKingsPersistenceCache = {
      key: persistenceKey,
      savedAt: Date.now(),
      result: failedResult,
    };
    return failedResult;
  }
}


type MlbFinalGame = {
  gameKey: string;
  awayTeam: string;
  homeTeam: string;
  awayRuns: number;
  homeRuns: number;
};

async function finalMlbGamesForDate(dateIso: string): Promise<Map<string, MlbFinalGame>> {
  const output = new Map<string, MlbFinalGame>();
  const url = new URL("https://statsapi.mlb.com/api/v1/schedule");
  url.searchParams.set("sportId", "1");
  url.searchParams.set("date", dateIso);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return output;
  const payload = (await response.json()) as any;
  for (const day of payload?.dates || []) {
    for (const game of day?.games || []) {
      const state = `${String(game?.status?.detailedState || "")} ${String(
        game?.status?.abstractGameState || "",
      )}`.toLowerCase();
      if (!state.includes("final")) continue;
      const gameKey = String(game?.gamePk || "").replace(/\.0$/, "");
      if (!gameKey) continue;
      output.set(gameKey, {
        gameKey,
        awayTeam: normalizeTeam(game?.teams?.away?.team?.name || ""),
        homeTeam: normalizeTeam(game?.teams?.home?.team?.name || ""),
        awayRuns: Number(game?.teams?.away?.score || 0),
        homeRuns: Number(game?.teams?.home?.score || 0),
      });
    }
  }
  return output;
}

function allGameTrendResultFields(row: SheetRow, game: MlbFinalGame): SheetRow | null {
  const market = trackerMarket(row);
  if (!market) return null;

  let result = "";
  if (market === "Moneyline") {
    const selectedTeam = teamFromSelection(row.Selection || row.Team || "");
    const winner = game.homeRuns > game.awayRuns ? game.homeTeam : game.awayTeam;
    if (!selectedTeam || !winner) return null;
    result = selectedTeam === winner ? "Win" : "Loss";
  } else {
    const side = trackerTotalSide(row);
    // Grade the wager that was actually frozen on the public board. The market
    // can move from the builder line before first pitch, so Public Split Line is
    // authoritative whenever it exists.
    const line = numericLine(
      row["Public Split Line"] || row.Line || row["Odds/Line"] || "",
    );
    if (!side || line == null) return null;
    const actualTotal = game.awayRuns + game.homeRuns;
    if (actualTotal === line) result = "Push";
    else if (side === "Over") result = actualTotal > line ? "Win" : "Loss";
    else result = actualTotal < line ? "Win" : "Loss";
  }

  return {
    Result: result,
    "Actual Away Runs": String(game.awayRuns),
    "Actual Home Runs": String(game.homeRuns),
    "Actual Total": String(game.awayRuns + game.homeRuns),
    "Result Updated": draftKingsNowET(),
  };
}

async function syncAllGameTrendResults(today: string) {
  const todayIso = isoPublicDate(today);
  const cacheKey = todayIso;
  if (
    allGameTrendResultSyncCache &&
    allGameTrendResultSyncCache.key === cacheKey &&
    Date.now() - allGameTrendResultSyncCache.savedAt < 5 * 60_000
  ) {
    return allGameTrendResultSyncCache.updated;
  }

  try {
    const { spreadsheetId, sheets } = mainSheetsClient();
    const matrix = await readWorksheetMatrixWithClient(
      sheets,
      spreadsheetId,
      ALL_GAME_TRENDS_TAB,
      ALL_GAME_TRENDS_HEADERS,
    );
    const pending = matrix.rows.filter((matrixRow) => {
      const row = matrixRow.object;
      const rowDate = isoPublicDate(row.Date || "");
      const gameKey = String(row["Game Key"] || "").trim();
      if (!rowDate || rowDate > todayIso || !gameKey) return false;

      if (!isCompletedResult(row.Result)) return true;

      // Reconcile completed totals when the final public line differs from the
      // builder line. This repairs cases such as Under 8 being graded against
      // the earlier 7.5 instead of pushing at eight runs.
      if (trackerMarket(row) === "Total" && row["Public Split Line"] !== "") {
        const corrected = trendRecordResultCode(row);
        return Boolean(corrected && corrected !== resultCode(row.Result));
      }
      return false;
    });
    if (!pending.length) {
      allGameTrendResultSyncCache = { key: cacheKey, savedAt: Date.now(), updated: 0 };
      return 0;
    }

    const dates = [...new Set(pending.map((row) => isoPublicDate(row.object.Date)))]
      .filter(Boolean)
      .sort()
      .reverse()
      .slice(0, 14);
    const resultsByDate = new Map<string, Map<string, MlbFinalGame>>();
    await Promise.all(
      dates.map(async (dateIso) => {
        resultsByDate.set(dateIso, await finalMlbGamesForDate(dateIso));
      }),
    );

    const updates: SheetBlockUpdate[] = [];
    for (const matrixRow of pending) {
      const row = matrixRow.object;
      const rowDate = isoPublicDate(row.Date || "");
      const gameKey = String(row["Game Key"] || "").trim().replace(/\.0$/, "");
      const game = resultsByDate.get(rowDate)?.get(gameKey);
      if (!game) continue;
      const fields = allGameTrendResultFields(row, game);
      if (fields) updates.push({ sheetRow: matrixRow.sheetRow, fields });
    }

    await writeWorksheetBlocks(
      sheets,
      spreadsheetId,
      ALL_GAME_TRENDS_TAB,
      matrix,
      updates,
      "Result",
      "Result Updated",
    );
    allGameTrendResultSyncCache = {
      key: cacheKey,
      savedAt: Date.now(),
      updated: updates.length,
    };
    return updates.length;
  } catch (error) {
    console.error("All-game trend result sync failed", error);
    allGameTrendResultSyncCache = { key: cacheKey, savedAt: Date.now(), updated: 0 };
    return 0;
  }
}

const EMPTY_TOTALS: RecordTotals = {
  label: "",
  record: "0-0-0",
  totalBets: 0,
  winPct: 0,
  unitsWon: 0,
  roiPct: 0,
  wins: 0,
  losses: 0,
  pushes: 0,
};

const MONEYLINE_GRADES = new Set(["A MONEYLINE", "B MONEYLINE"]);
const GREEN_TYPES = new Set([
  "A MONEYLINE",
  "B MONEYLINE",
  "ELITE NRFI",
  "STRONG NRFI",
  "LEAN NRFI",
  "NRFI",
  "YRFI",
  "STRONG OVER",
  "OVER",
  "LEAN OVER",
  "STRONG UNDER",
  "UNDER",
  "LEAN UNDER",
]);

function todayET() {
  return new Date().toLocaleDateString("en-US", {
    timeZone: "America/New_York",
  });
}

function nowET() {
  return new Date().toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function normalizeDate(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  // Google Sheets may send dates as YYYY-MM-DD, M/D/YYYY, or M/D/YY.
  // Normalize all of those to the same format as todayET(): M/D/YYYY.
  const isoMatch = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${Number(m)}/${Number(d)}/${y}`;
  }

  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (slashMatch) {
    const [, m, d, y] = slashMatch;
    const fullYear = y.length === 2 ? `20${y}` : y;
    return `${Number(m)}/${Number(d)}/${fullYear}`;
  }

  const date = new Date(raw);
  if (!Number.isNaN(date.getTime())) {
    return date.toLocaleDateString("en-US", { timeZone: "America/New_York" });
  }

  return raw;
}

function parseNormalizedDate(value: unknown) {
  const normalized = normalizeDate(value);
  const match = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const [, m, d, y] = match;
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
}

function isTrueValue(value: unknown) {
  // Only a literal TRUE in the Favorite Pick cell should count as handpicked.
  // This prevents tags, notes, stars, or other non-empty values from accidentally qualifying.
  return (
    String(value ?? "")
      .trim()
      .toUpperCase() === "TRUE"
  );
}

function normalizeType(value: unknown) {
  const text = String(value || "")
    .toUpperCase()
    .trim();

  if (text.includes("STRONG OVER")) return "STRONG OVER";
  if (text.includes("LEAN OVER")) return "LEAN OVER";
  if (/\bOVER\b/.test(text)) return "OVER";
  if (text.includes("STRONG UNDER")) return "STRONG UNDER";
  if (text.includes("LEAN UNDER")) return "LEAN UNDER";
  if (/\bUNDER\b/.test(text)) return "UNDER";
  if (text.includes("ELITE NRFI")) return "ELITE NRFI";
  if (text.includes("STRONG NRFI")) return "STRONG NRFI";
  if (text.includes("LEAN NRFI")) return "LEAN NRFI";
  if (text.includes("YRFI")) return "YRFI";
  if (text === "NRFI" || text.includes(" NRFI")) return "NRFI";
  if (text.includes("A MONEYLINE")) return "A MONEYLINE";
  if (text.includes("B MONEYLINE")) return "B MONEYLINE";
  if (text.includes("NON-EDGE MONEYLINE")) return "NON-EDGE MONEYLINE";
  if (text.includes("PASS")) return "PASS";

  return text;
}

function isGreenType(value: unknown) {
  const type = normalizeType(value);
  return (
    GREEN_TYPES.has(type) && type !== "NON-EDGE MONEYLINE" && type !== "PASS"
  );
}

function toNumber(value: unknown) {
  const n = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function parseScore(value: unknown) {
  const n = toNumber(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 50;
}

function scoreValueFromRaw(value: unknown) {
  const n = toNumber(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 0 && n <= 1 ? n * 100 : n;
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizePercentValue(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const n = toNumber(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 0 && n <= 1 ? n * 100 : n;
}

function calculateMoneylineEZPZScore(row: SheetRow, playType: unknown) {
  const modelPct = normalizePercentValue(
    firstValue(row, [
      "Model %",
      "Win %",
      "Moneyline %",
      "ML %",
      "Better ML %",
      "Better Moneyline %",
      "Model Win %",
      "Model Moneyline %",
      "ML Model %",
      "Better ML",
      "Better Moneyline",
    ]),
  );
  const edgePct = toNumber(
    firstValue(row, ["Edge %", "ML Edge %", "Moneyline Edge %", "Edge"]),
  );
  const directScore = scoreValueFromRaw(
    firstValue(row, [
      "EZPZ Score",
      "Moneyline Score",
      "ML Score",
      "Best Play Score",
      "Rank Score",
    ]),
  );

  if (directScore) return clampScore(directScore);

  const type = normalizeType(playType);
  const gradeBoost =
    type === "A MONEYLINE" ? 4 : type === "B MONEYLINE" ? 0 : -4;

  // Moneyline win probability naturally lives in the 52-60% range, so it cannot be used directly as a score.
  // This rescales model edge and sportsbook edge onto a true 0-100 betting score.
  if (modelPct || edgePct) {
    const modelComponent = modelPct ? (modelPct - 50) * 2.2 : 0;
    const edgeComponent = edgePct ? edgePct * 3.5 : 0;
    return clampScore(50 + modelComponent + edgeComponent + gradeBoost);
  }

  return type === "A MONEYLINE" ? 72 : type === "B MONEYLINE" ? 66 : 50;
}

function calculatePitcherKEZPZScore(
  summary: string,
  rawScore: unknown,
  playType: unknown,
) {
  const directScore = scoreValueFromRaw(rawScore);
  if (directScore) return clampScore(directScore);

  const type = normalizeType(playType);
  const parsed = parseKSummary(summary);
  const projected = toNumber(parsed.projected);
  const line = toNumber(parsed.line);
  const edge = projected && line ? Math.abs(projected - line) : 0;

  let base = 64;
  if (type.includes("STRONG")) base = 78;
  else if (type.includes("LEAN")) base = 64;
  else if (type === "OVER" || type === "UNDER") base = 70;

  const edgeBoost = Math.min(16, edge * 8);
  return clampScore(base + edgeBoost);
}

function parseAmericanOdds(value: unknown) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/[+-]?\d+/);
  if (!match) return 0;
  const odds = Number(match[0]);
  return Number.isFinite(odds) && Math.abs(odds) >= 100 ? odds : 0;
}

function unitsFromResult(row: SheetRow) {
  const result = String(row["Result"] || "")
    .toUpperCase()
    .trim();
  const odds = parseAmericanOdds(row.Odds || row["Odds/Line"]);

  if (result.includes("PUSH")) return 0;
  if (result.includes("LOSS") || result === "L") return -1;
  if (!(result.includes("WIN") || result === "W")) return 0;

  if (odds > 0) return odds / 100;
  if (odds < 0) return 100 / Math.abs(odds);
  return 1;
}

function buildSummary(rows: SheetRow[]): Summary[] {
  const map = new Map<string, Summary>();

  for (const row of rows) {
    const type = normalizeType(row["Bet Type"] || row["Market"] || "");
    if (!type || type === "PASS") continue;

    const result = String(row["Result"] || "")
      .toUpperCase()
      .trim();
    if (!result) continue;

    if (!map.has(type)) {
      map.set(type, {
        betType: type,
        status: "EVEN",
        wins: 0,
        losses: 0,
        pushes: 0,
        totalBets: 0,
        winPct: 0,
        unitsWon: 0,
        roiPct: 0,
      });
    }

    const summary = map.get(type)!;
    if (result.includes("WIN") || result === "W") summary.wins += 1;
    else if (result.includes("LOSS") || result === "L") summary.losses += 1;
    else if (result.includes("PUSH") || result === "P") summary.pushes += 1;
    else continue;

    summary.totalBets += 1;
    summary.unitsWon += unitsFromResult(row);
  }

  const summaries = [...map.values()].map((summary) => {
    const decisions = summary.wins + summary.losses;
    const winPct = decisions > 0 ? round1((summary.wins / decisions) * 100) : 0;
    const roiPct =
      summary.totalBets > 0
        ? round1((summary.unitsWon / summary.totalBets) * 100)
        : 0;
    const unitsWon = round1(summary.unitsWon);
    const status: Summary["status"] =
      summary.wins > summary.losses
        ? "WINNING"
        : summary.wins === summary.losses
          ? "EVEN"
          : "LOSING";

    return { ...summary, status, winPct, roiPct, unitsWon };
  });

  return summaries.sort(
    (a, b) => b.winPct - a.winPct || b.totalBets - a.totalBets,
  );
}

function buildTotals(label: string, rows: SheetRow[]): RecordTotals {
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let unitsWon = 0;

  for (const row of rows) {
    const result = String(row["Result"] || "")
      .toUpperCase()
      .trim();
    if (!result) continue;

    if (result.includes("WIN") || result === "W") wins += 1;
    else if (result.includes("LOSS") || result === "L") losses += 1;
    else if (result.includes("PUSH") || result === "P") pushes += 1;
    else continue;

    unitsWon += unitsFromResult(row);
  }

  const totalBets = wins + losses + pushes;
  const decisions = wins + losses;
  const winPct = decisions > 0 ? round1((wins / decisions) * 100) : 0;
  const roiPct = totalBets > 0 ? round1((unitsWon / totalBets) * 100) : 0;

  return {
    label,
    record: `${wins}-${losses}-${pushes}`,
    totalBets,
    winPct,
    unitsWon: round1(unitsWon),
    roiPct,
    wins,
    losses,
    pushes,
  };
}


function resultCode(value: unknown): "W" | "L" | "P" | "" {
  const result = String(value || "").trim().toUpperCase();
  if (result === "W" || result.includes("WIN")) return "W";
  if (result === "L" || result.includes("LOSS")) return "L";
  if (result === "P" || result.includes("PUSH")) return "P";
  return "";
}

function publicPercentOrNull(value: unknown) {
  const raw = String(value ?? "").replace("%", "").trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : null;
}

function trackerMarket(row: SheetRow): "Moneyline" | "Total" | "" {
  const market = textKey(row.Market || "");
  const betType = normalizeType(row["Bet Type"] || "");
  if (market.includes("moneyline") || betType.includes("MONEYLINE")) return "Moneyline";
  if (
    market.includes("game total") ||
    market === "total" ||
    ["STRONG OVER", "OVER", "LEAN OVER", "STRONG UNDER", "UNDER", "LEAN UNDER"].includes(betType)
  ) {
    return "Total";
  }
  return "";
}

function trackerTotalSide(row: SheetRow): "Over" | "Under" | "" {
  const type = normalizeType(
    row["Model Grade"] || row["Bet Type"] || row.Market || "",
  );
  const explicitSide = textKey(row.Side || "");
  const selection = textKey(row.Selection || row.Team || "");
  if (explicitSide === "under" || type.includes("UNDER") || selection.startsWith("under")) return "Under";
  if (explicitSide === "over" || type.includes("OVER") || selection.startsWith("over")) return "Over";
  return "";
}

function draftKingsSignalSourceKey(row: SheetRow) {
  const gameKey = String(row["Game Key"] || "").trim().replace(/\.0$/, "");
  const market = trackerMarket(row);
  const selectionKey = market === "Total"
    ? trackerTotalSide(row)
    : normalizeTeam(teamFromSelection(row.Selection || row.Team || row.Pick || ""));
  if (gameKey) return `${isoPublicDate(row.Date)}|${gameKey}|${market}|${selectionKey}`;
  const away = normalizeTeam(row["Away Team"] || "");
  const home = normalizeTeam(row["Home Team"] || "");
  const fallbackGame = away && home
    ? `${away}|${home}`
    : textKey(row.Game || row.Team || row.Selection || "");
  return `${isoPublicDate(row.Date)}|${fallbackGame}|${market}|${selectionKey}`;
}

function trackerSlateMatch(row: SheetRow, slateRows: SheetRow[]) {
  const gameKey = String(row["Game Key"] || "").trim();
  if (gameKey) {
    const exact = slateRows.find((item) => String(item["Game Key"] || "").trim() === gameKey);
    if (exact) return exact;
  }
  const date = normalizeDate(row.Date || "");
  const game = textKey(row.Game || "");
  return slateRows.find(
    (item) => normalizeDate(item.Date || "") === date && textKey(item.Game || "") === game,
  );
}

function snapshotForTrackerRow(
  row: SheetRow,
  slateRows: SheetRow[],
  snapshotRows: SheetRow[],
) {
  const market = trackerMarket(row);
  if (!market) return null;
  const date = isoPublicDate(row.Date || "");
  const slate = trackerSlateMatch(row, slateRows);
  const targetTeam = market === "Moneyline"
    ? teamFromSelection(row.Team || row.Selection || row.Pick || "")
    : "";
  const targetSide = market === "Total" ? trackerTotalSide(row) : "";

  return snapshotRows.find((snapshot) => {
    if (isoPublicDate(snapshot.Date || "") !== date) return false;
    if (textKey(snapshot["Data Type"] || "") !== "game market") return false;
    if (textKey(snapshot.Market || "") !== textKey(market)) return false;
    if (slate) {
      if (normalizeTeam(snapshot["Away Team"] || "") !== normalizeTeam(slate["Away Team"] || "")) return false;
      if (normalizeTeam(snapshot["Home Team"] || "") !== normalizeTeam(slate["Home Team"] || "")) return false;
    } else if (textKey(snapshot.Game || "") !== textKey(row.Game || "")) {
      return false;
    }
    if (market === "Moneyline") return teamFromSelection(snapshot.Selection || "") === targetTeam;
    const snapshotSide = textKey(snapshot.Selection || "").startsWith("under") ? "Under" : "Over";
    return snapshotSide === targetSide;
  }) || null;
}

function buildDraftKingsSignalRows(
  completedRows: SheetRow[],
  slateRows: SheetRow[],
  snapshotRows: SheetRow[],
): DraftKingsSignalResult[] {
  const output: DraftKingsSignalResult[] = [];
  for (const row of completedRows) {
    const market = trackerMarket(row);
    if (!market) continue;
    const result = resultCode(row.Result);
    if (!result) continue;
    const snapshot = snapshotForTrackerRow(row, slateRows, snapshotRows);
    const betsPct =
      publicPercentOrNull(row["Public Bets %"]) ??
      publicPercentOrNull(snapshot?.["Public Bets %"]);
    const moneyPct =
      publicPercentOrNull(row["Public Money %"]) ??
      publicPercentOrNull(snapshot?.["Public Money %"]);
    if (betsPct == null || moneyPct == null) continue;

    const primary = warningFor(betsPct, moneyPct);
    const odds = parseAmericanOdds(
      row["Public Split Odds"] || snapshot?.Odds || row.Odds || row["Odds/Line"],
    );
    const sideGroup: DraftKingsSignalResult["sideGroup"] = market === "Total"
      ? trackerTotalSide(row)
      : odds < 0
        ? "Favorite"
        : odds > 0
          ? "Underdog"
          : "";
    const common = {
      date: isoPublicDate(row.Date || ""),
      game: String(row.Game || snapshot?.Game || ""),
      market,
      selection: String(row.Selection || row.Team || snapshot?.Selection || ""),
      sideGroup,
      betType: normalizeType(
        row["Model Grade"] || row["Bet Type"] || row.Market || "",
      ),
      modelVersion: String(row["Model Version"] || ""),
      qualified: String(row.Qualified || "").trim()
        ? truthyValue(row.Qualified)
        : isGreenType(row["Bet Type"] || row.Market || ""),
      result,
      odds,
      units:
        result === "P"
          ? 0
          : result === "L"
            ? -1
            : odds > 0
              ? odds / 100
              : odds < 0
                ? 100 / Math.abs(odds)
                : 1,
    };

    output.push({
      ...common,
      signalType: "Public Split",
      signalKey: primary.warningKey,
      signal: primary.warning,
      tone: primary.warningTone,
    });

    const movementSignal = String(
      row["Line Movement Signal"] || snapshot?.["Line Movement Signal"] || "",
    ).trim();
    if (movementSignal) {
      const toneRaw = String(
        row["Line Movement Tone"] || snapshot?.["Line Movement Tone"] || "",
      ).trim();
      const tone: PublicSignalTone = toneRaw === "positive" ? "positive" : "negative";
      output.push({
        ...common,
        signalType: "Line Movement",
        signalKey: textKey(movementSignal).toUpperCase().replace(/\s+/g, "_"),
        signal: movementSignal,
        tone,
      });
    }
  }
  return output;
}

type HistoricalTrendTierOverride = {
  tier: "Good" | "Strong" | "Elite";
  score: number;
  note: string;
};

// These eight 2026-08-02 plays were visible on the locked final board, but the
// all_game_trends rows were never populated because their saved market rows were
// labeled "Live-site pregame market snapshot" instead of the dedicated 15-minute
// label. The user verified the official tiers from the final board. Keeping this
// small, explicit recovery map preserves the real historical record without
// re-grading those games after the results were known.
const HISTORICAL_TREND_TIER_OVERRIDES = new Map<string, HistoricalTrendTierOverride>([
  ["2026-08-02|824163|Moneyline|Houston Astros", { tier: "Elite", score: 88, note: "Confirmed final-board recovery" }],
  ["2026-08-02|824163|Total|Over", { tier: "Elite", score: 88, note: "Confirmed final-board recovery" }],
  ["2026-08-02|824648|Moneyline|New York Yankees", { tier: "Elite", score: 88, note: "Confirmed final-board recovery" }],
  ["2026-08-02|824648|Total|Under", { tier: "Elite", score: 88, note: "Confirmed final-board recovery" }],
  ["2026-08-02|824323|Moneyline|Colorado Rockies", { tier: "Elite", score: 88, note: "Confirmed final-board recovery" }],
  ["2026-08-02|824323|Total|Under", { tier: "Elite", score: 88, note: "Confirmed final-board recovery" }],
  ["2026-08-02|823996|Total|Over", { tier: "Elite", score: 88, note: "Confirmed final-board recovery" }],
  ["2026-08-02|823996|Moneyline|Los Angeles Angels", { tier: "Good", score: 60, note: "Confirmed final-board recovery" }],
]);

function historicalTrendOverrideForRow(row: SheetRow) {
  const market = trackerMarket(row);
  if (!market) return null;
  const gameKey = String(row["Game Key"] || "").trim().replace(/\.0$/, "");
  const selectionKey =
    market === "Moneyline"
      ? normalizeTeam(teamFromSelection(row.Selection || row.Team || row.Pick || ""))
      : trackerTotalSide(row);
  if (!gameKey || !selectionKey) return null;
  return (
    HISTORICAL_TREND_TIER_OVERRIDES.get(
      `${isoPublicDate(row.Date || "")}|${gameKey}|${market}|${selectionKey}`,
    ) || null
  );
}

function trendRecordResultCode(row: SheetRow): "W" | "L" | "P" | "" {
  const market = trackerMarket(row);
  if (!market) return "";

  if (market === "Total") {
    const actualTotal = Number(row["Actual Total"]);
    const line = numericLine(
      row["Public Split Line"] || row.Line || row["Odds/Line"] || "",
    );
    const side = trackerTotalSide(row);
    if (Number.isFinite(actualTotal) && line != null && side) {
      if (actualTotal === line) return "P";
      if (side === "Over") return actualTotal > line ? "W" : "L";
      return actualTotal < line ? "W" : "L";
    }
  }

  return resultCode(row.Result);
}

function applyHistoricalTrendOverride(
  row: SheetRow,
  play: TrendPlay | null,
  snapshot?: SheetRow | null,
): TrendPlay | null {
  const override = historicalTrendOverrideForRow(row);
  if (!override) return play;

  const market = trackerMarket(row);
  if (!market) return play;
  const selection = String(row.Selection || row.Team || row.Pick || play?.selection || "");
  const side = market === "Total" ? trackerTotalSide(row) : "";
  const snapshotTime = String(
    snapshot?.["Snapshot Time ET"] || row["Public Split Snapshot Time"] || "2026-08-02 FINAL PREGAME",
  );
  const odds = String(snapshot?.Odds || row["Public Split Odds"] || row.Odds || row["Odds/Line"] || "");
  const line =
    market === "Total"
      ? numericLine(snapshot?.Line || row["Public Split Line"] || row.Line || row["Odds/Line"] || "")
      : null;
  const normalized: TrendPlay = play
    ? {
        ...play,
        selection,
        selectionTeam: market === "Moneyline" ? normalizeTeam(teamFromSelection(selection)) : "",
        side,
        line,
        odds,
        score: override.score,
        baseScore: override.score,
        tier: override.tier,
        frozenAt: snapshotTime,
        snapshotStatus: "FINAL_PREGAME",
        gradingVersion: FROZEN_TREND_GRADING_VERSION,
      }
    : {
        game: String(row.Game || ""),
        awayTeam: String(row["Away Team"] || ""),
        homeTeam: String(row["Home Team"] || ""),
        market,
        selection,
        selectionTeam: market === "Moneyline" ? normalizeTeam(teamFromSelection(selection)) : "",
        side,
        sideGroup:
          market === "Total"
            ? side
            : parseAmericanOdds(odds) < 0
              ? "Favorite"
              : "Underdog",
        line,
        odds,
        betsPct: publicPercentOrNull(snapshot?.["Public Bets %"] || row["Public Bets %"]) ?? 0,
        moneyPct: publicPercentOrNull(snapshot?.["Public Money %"] || row["Public Money %"]) ?? 0,
        gapPct: publicPercentOrNull(snapshot?.["Public Gap %"] || row["Public Gap %"]) ?? 0,
        score: override.score,
        baseScore: override.score,
        tier: override.tier,
        signals: [],
        updatedAt: snapshotTime,
        frozenAt: snapshotTime,
        snapshotStatus: "FINAL_PREGAME",
        gradingVersion: FROZEN_TREND_GRADING_VERSION,
      };
  return normalized;
}

function buildTrendRecordRows(
  completedRows: SheetRow[],
  authoritativeFrozenPlays: TrendPlay[],
  slateRows: SheetRow[],
  snapshotRows: SheetRow[],
): TrendRecordResult[] {
  const normalizeSavedTier = (value: unknown): "Good" | "Strong" | "Elite" | null => {
    const key = textKey(value);
    if (key.includes("elite")) return "Elite";
    if (key.includes("strong")) return "Strong";
    if (key.includes("good")) return "Good";
    return null;
  };

  const rowGameIdentity = (row: SheetRow, storedPlay?: TrendPlay | null) => {
    const savedGameKey = String(row["Game Key"] || "")
      .trim()
      .replace(/\.0$/, "");
    if (savedGameKey) return savedGameKey;
    const away = normalizeTeam(row["Away Team"] || storedPlay?.awayTeam || "");
    const home = normalizeTeam(row["Home Team"] || storedPlay?.homeTeam || "");
    const gameTime = textKey(row["Game Time"] || row.Game || storedPlay?.game || "");
    return `${away}|${home}|${gameTime}`;
  };

  const playRecordKey = (play: TrendPlay) => {
    const date = isoPublicDate(play.recordDate || "");
    const gameIdentity =
      String(play.recordGameKey || "").trim().replace(/\.0$/, "") ||
      `${trendGameComparisonKey(play)}|${textKey(play.recordGameTime || play.game || "")}`;
    return `${date}|${gameIdentity}|${trendMarketComparisonKey(play)}|${trendSideComparisonKey(play)}`;
  };

  const officialByKey = new Map<string, TrendPlay>();
  for (const play of authoritativeFrozenPlays) {
    officialByKey.set(playRecordKey(play), play);
  }

  const output: TrendRecordResult[] = [];

  for (const row of completedRows) {
    const market = trackerMarket(row);
    const result = trendRecordResultCode(row);
    if (!market || !result) continue;

    const historicalOverride = historicalTrendOverrideForRow(row);
    const recoverySnapshot = snapshotForTrackerRow(row, slateRows, snapshotRows);
    const storedPlay = parseStoredTrendPlay(row);
    const date = isoPublicDate(row.Date || "");
    const rowSelectionPlay: TrendPlay | null = storedPlay
      ? {
          ...storedPlay,
          market,
          selection: String(row.Selection || row.Team || row.Pick || storedPlay.selection || ""),
          selectionTeam:
            market === "Moneyline"
              ? teamFromSelection(row.Selection || row.Team || row.Pick || storedPlay.selection || "")
              : "",
          side: market === "Total" ? trackerTotalSide(row) : "",
          line:
            market === "Total"
              ? numericLine(row.Line || row["Odds/Line"] || storedPlay.line || "")
              : null,
        }
      : {
          game: String(row.Game || ""),
          awayTeam: String(row["Away Team"] || ""),
          homeTeam: String(row["Home Team"] || ""),
          market,
          selection: String(row.Selection || row.Team || row.Pick || ""),
          selectionTeam:
            market === "Moneyline"
              ? teamFromSelection(row.Selection || row.Team || row.Pick || "")
              : "",
          side: market === "Total" ? trackerTotalSide(row) : "",
          sideGroup: "",
          line: market === "Total" ? numericLine(row.Line || row["Odds/Line"] || "") : null,
          odds: String(row["Public Split Odds"] || row.Odds || row["Odds/Line"] || ""),
          betsPct: 0,
          moneyPct: 0,
          gapPct: 0,
          score: 0,
          tier: "Pass",
          signals: [],
          updatedAt: "",
        };

    const officialKey = `${date}|${rowGameIdentity(row, storedPlay)}|${trendMarketComparisonKey(
      rowSelectionPlay,
    )}|${trendSideComparisonKey(rowSelectionPlay)}`;
    const authoritativePlay = officialByKey.get(officialKey) || null;

    const confidence = textKey(row["Public Split Match Confidence"] || "");
    const finalSnapshot =
      isOfficialTrendSnapshotConfidence(confidence) ||
      Boolean(historicalOverride) ||
      authoritativePlay?.snapshotStatus === "FINAL_PREGAME" ||
      storedPlay?.snapshotStatus === "FINAL_PREGAME";
    if (!finalSnapshot) continue;

    // For legacy snapshots, the exact same frozen-play collection used by the
    // public board is authoritative. This makes the Records page count the same
    // Good / Strong / Elite tiles that were shown from the final pregame data.
    // The saved sheet tier is used only when no authoritative frozen play can
    // be matched.
    const frozenTier =
      historicalOverride?.tier ||
      normalizeSavedTier(authoritativePlay?.tier) ||
      normalizeSavedTier(row["Trend Tier"]) ||
      normalizeSavedTier(storedPlay?.tier);
    if (!frozenTier) continue;

    const authoritativeScore = Number(authoritativePlay?.score);
    const rowScore = Number(row["Trend Score"]);
    const storedScore = Number(storedPlay?.score);
    const frozenScore = historicalOverride
      ? historicalOverride.score
      : Number.isFinite(authoritativeScore)
        ? authoritativeScore
        : Number.isFinite(rowScore)
          ? rowScore
          : Number.isFinite(storedScore)
            ? storedScore
            : 0;
    const frozenAt = String(
      authoritativePlay?.frozenAt ||
        recoverySnapshot?.["Snapshot Time ET"] ||
        row["Public Split Snapshot Time"] ||
        storedPlay?.frozenAt ||
        storedPlay?.updatedAt ||
        row["Result Updated"] ||
        "",
    ).trim();
    const odds = parseAmericanOdds(
      row["Public Split Odds"] || recoverySnapshot?.Odds || row.Odds || row["Odds/Line"],
    );
    const selection = String(
      row.Selection ||
        row.Team ||
        row.Pick ||
        authoritativePlay?.selection ||
        storedPlay?.selection ||
        "",
    );
    const side = market === "Total" ? trackerTotalSide(row) : "";
    const sideGroup: TrendPlay["sideGroup"] =
      authoritativePlay?.sideGroup ||
      (market === "Total"
        ? side
        : odds < 0
          ? "Favorite"
          : odds > 0
            ? "Underdog"
            : storedPlay?.sideGroup || "");

    const officialPlay: TrendPlay = authoritativePlay
      ? {
          ...authoritativePlay,
          selection,
          score: frozenScore,
          tier: frozenTier,
          frozenAt,
          snapshotStatus: "FINAL_PREGAME",
          gradingVersion: FROZEN_TREND_GRADING_VERSION,
        }
      : storedPlay
        ? {
            ...storedPlay,
            score: frozenScore,
            tier: frozenTier,
            frozenAt,
            snapshotStatus: "FINAL_PREGAME",
          }
        : {
            game: String(row.Game || ""),
            awayTeam: String(row["Away Team"] || ""),
            homeTeam: String(row["Home Team"] || ""),
            market,
            selection,
            selectionTeam: market === "Moneyline" ? teamFromSelection(selection) : "",
            side,
            sideGroup,
            line:
              market === "Total"
                ? numericLine(
                    row["Public Split Line"] ||
                      recoverySnapshot?.Line ||
                      row.Line ||
                      row["Odds/Line"] ||
                      "",
                  )
                : null,
            odds: String(
              row["Public Split Odds"] || recoverySnapshot?.Odds || row.Odds || row["Odds/Line"] || "",
            ),
            betsPct: publicPercentOrNull(row["Public Bets %"]) ?? 0,
            moneyPct: publicPercentOrNull(row["Public Money %"]) ?? 0,
            gapPct: publicPercentOrNull(row["Public Gap %"]) ?? 0,
            score: frozenScore,
            tier: frozenTier,
            signals: [],
            updatedAt: frozenAt,
            frozenAt,
            snapshotStatus: "FINAL_PREGAME",
          };

    const finalOfficialPlay = applyHistoricalTrendOverride(
      row,
      officialPlay,
      recoverySnapshot,
    ) || officialPlay;

    output.push({
      date,
      game: String(row.Game || officialPlay.game || ""),
      gameKey: String(row["Game Key"] || "").trim().replace(/\.0$/, ""),
      gameTime: String(row["Game Time"] || "").trim(),
      market,
      selection,
      result,
      odds,
      units:
        result === "P"
          ? 0
          : result === "L"
            ? -1
            : odds > 0
              ? odds / 100
              : odds < 0
                ? 100 / Math.abs(odds)
                : 1,
      frozenTier,
      frozenScore,
      frozenAt,
      snapshotStatus: "FINAL_PREGAME",
      trendScoreDetails: JSON.stringify(finalOfficialPlay),
      recoveredFromHistoricalOverride: Boolean(historicalOverride),
      recoveryNote: historicalOverride?.note,
    });
  }

  return output;
}

function emptyTrendRecord(): TrendRecord {
  return {
    record: "0-0-0",
    totalBets: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    winPct: 0,
    roiPct: 0,
    unitsWon: 0,
  };
}

function trendRecord(rows: DraftKingsSignalResult[]): TrendRecord {
  if (!rows.length) return emptyTrendRecord();
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let unitsWon = 0;
  for (const row of rows) {
    if (row.result === "W") wins += 1;
    else if (row.result === "L") losses += 1;
    else if (row.result === "P") pushes += 1;
    unitsWon += Number(row.units || 0);
  }
  const totalBets = wins + losses + pushes;
  const decisions = wins + losses;
  return {
    record: `${wins}-${losses}-${pushes}`,
    totalBets,
    wins,
    losses,
    pushes,
    winPct: decisions ? round1((wins / decisions) * 100) : 0,
    roiPct: totalBets ? round1((unitsWon / totalBets) * 100) : 0,
    unitsWon: round1(unitsWon),
  };
}

function signalRowsWithinDays(
  rows: DraftKingsSignalResult[],
  referenceDate: string,
  days: number,
) {
  const reference = parseNormalizedDate(referenceDate);
  if (!reference) return [];
  const oneDayMs = 24 * 60 * 60 * 1000;
  return rows.filter((row) => {
    const rowDate = parseNormalizedDate(row.date);
    if (!rowDate) return false;
    const diffDays = Math.round((reference.getTime() - rowDate.getTime()) / oneDayMs);
    return diffDays >= 0 && diffDays < days;
  });
}

function trendWindows(
  rows: DraftKingsSignalResult[],
  referenceDate: string,
): TrendWindowRecords {
  return {
    allTime: trendRecord(rows),
    last30: trendRecord(signalRowsWithinDays(rows, referenceDate, 30)),
    last7: trendRecord(signalRowsWithinDays(rows, referenceDate, 7)),
  };
}

const TREND_WINDOW_WEIGHTS: Array<{
  key: keyof TrendWindowRecords;
  weight: number;
}> = [
  { key: "allTime", weight: 0.4 },
  { key: "last30", weight: 0.35 },
  { key: "last7", weight: 0.25 },
];

function trendRecordScore(record: TrendRecord) {
  if (!record.totalBets) return null;

  // Bet count is shown for context but never shrinks or disqualifies a trend.
  const roiScore = clampScore(50 + record.roiPct * 1.25);
  const winScore = clampScore(50 + (record.winPct - 50) * 2);
  return {
    roiScore,
    winScore,
    roiPct: record.roiPct,
    winPct: record.winPct,
  };
}

function trendRecordTone(record: TrendRecord): PublicSignalTone {
  if (record.wins > record.losses) return "positive";
  if (record.losses > record.wins) return "negative";
  return "neutral";
}

function trendWindowMetrics(records: TrendWindowRecords) {
  const windows = TREND_WINDOW_WEIGHTS.map(({ key, weight }) => {
    const metrics = trendRecordScore(records[key]);
    return metrics ? { ...metrics, weight } : null;
  }).filter(
    (window): window is NonNullable<typeof window> => Boolean(window),
  );

  if (!windows.length) {
    return { score: 50, roiPct: 0, winPct: 0, hasData: false };
  }

  const totalWeight = windows.reduce((sum, window) => sum + window.weight, 0);
  const weightedAverage = (field: "roiScore" | "winScore" | "roiPct" | "winPct") =>
    windows.reduce((sum, window) => sum + window[field] * window.weight, 0) /
    totalWeight;
  const windowScores = windows.map(
    (window) => window.roiScore * 0.7 + window.winScore * 0.3,
  );
  const consistencyScore =
    windowScores.length <= 1
      ? 100
      : clampScore(
          100 - (Math.max(...windowScores) - Math.min(...windowScores)) * 1.5,
        );

  return {
    score: clampScore(
      weightedAverage("roiScore") * 0.6 +
        weightedAverage("winScore") * 0.25 +
        consistencyScore * 0.15,
    ),
    roiPct: weightedAverage("roiPct"),
    winPct: weightedAverage("winPct"),
    hasData: true,
  };
}

function buildTrendSignalBreakdown(
  signal: {
    signalType: "Public Split" | "Line Movement";
    signalKey: string;
    signal: string;
    tone: PublicSignalTone;
  },
  market: "Moneyline" | "Total",
  sideGroup: TrendPlay["sideGroup"],
  history: DraftKingsSignalResult[],
  referenceDate: string,
): TrendSignalBreakdown {
  const sameSignal = history.filter((row) => row.signalKey === signal.signalKey);
  const exactRows = sameSignal.filter(
    (row) => row.market === market && row.sideGroup === sideGroup,
  );
  const marketRows = sameSignal.filter((row) => row.market === market);
  const exact = trendWindows(exactRows, referenceDate);
  const marketRecords = trendWindows(marketRows, referenceDate);
  const overall = trendWindows(sameSignal, referenceDate);

  // Exact market + side history receives full weight regardless of bet count.
  // Broader history is only a fallback when the exact category has no results.
  const displayRecords = exact.allTime.totalBets
    ? exact
    : marketRecords.allTime.totalBets
      ? marketRecords
      : overall;
  const weights: TrendDatasetWeights = exact.allTime.totalBets
    ? { exact: 1, market: 0, overall: 0 }
    : marketRecords.allTime.totalBets
      ? { exact: 0, market: 1, overall: 0 }
      : overall.allTime.totalBets
        ? { exact: 0, market: 0, overall: 1 }
        : { exact: 0, market: 0, overall: 0 };
  const metrics = trendWindowMetrics(displayRecords);
  const recordScope = exact.allTime.totalBets
    ? `${market} • ${sideGroup}`
    : marketRecords.allTime.totalBets
      ? `${market} • all sides`
      : "All tracked markets";

  return {
    ...signal,
    // The displayed color follows the selected category's actual all-time
    // record: winning = green, losing = red, even/no decisions = neutral.
    tone: trendRecordTone(displayRecords.allTime),
    category: `${signal.signal} • ${market} • ${sideGroup}`,
    recordScope,
    exactSample: exact.allTime.totalBets,
    score: Math.round(metrics.score),
    weights,
    records: displayRecords,
  };
}

function trendTier(score: number, eligible = true): TrendPlay["tier"] {
  if (!eligible || score < 60) return "Pass";
  if (score >= 88) return "Elite";
  if (score >= 75) return "Strong";
  return "Good";
}

function buildTrendPlayForSplit(
  split: DraftKingsSplit,
  history: DraftKingsSignalResult[],
  referenceDate: string,
  updatedAt = "",
): TrendPlay | null {
  if (split.market !== "Moneyline" && split.market !== "Total") return null;
  const sideGroup: TrendPlay["sideGroup"] = split.market === "Total"
    ? split.side
    : parseAmericanOdds(split.odds) < 0
      ? "Favorite"
      : parseAmericanOdds(split.odds) > 0
        ? "Underdog"
        : "";
  if (!sideGroup) return null;

  const primary = warningFor(split.betsPct, split.moneyPct);
  const activeSignals: Array<{
    signalType: "Public Split" | "Line Movement";
    signalKey: string;
    signal: string;
    tone: PublicSignalTone;
  }> = [
    {
      signalType: "Public Split",
      signalKey: primary.warningKey,
      signal: primary.warning,
      tone: primary.warningTone,
    },
  ];
  if (split.lineMovementSignal) {
    activeSignals.push({
      signalType: "Line Movement",
      signalKey: textKey(split.lineMovementSignal).toUpperCase().replace(/\s+/g, "_"),
      signal: split.lineMovementSignal,
      tone: split.lineMovementTone === "positive" ? "positive" : "negative",
    });
  }

  // Every current moneyline and total selection remains visible. Signals with
  // history receive full weight; signals without history are ignored rather
  // than pulling the score toward neutral.
  const signals = activeSignals.map((signal) =>
    buildTrendSignalBreakdown(
      signal,
      split.market as "Moneyline" | "Total",
      sideGroup,
      history,
      referenceDate,
    ),
  );
  const signalsWithHistory = signals.filter(
    (signal) => signal.records.allTime.totalBets > 0,
  );
  const score = Math.round(
    signalsWithHistory.length
      ? signalsWithHistory.reduce((sum, signal) => sum + signal.score, 0) /
          signalsWithHistory.length
      : 50,
  );

  return {
    game: split.game,
    awayTeam: split.awayTeam,
    homeTeam: split.homeTeam,
    market: split.market,
    selection: split.selection,
    selectionTeam: split.selectionTeam,
    side: split.side,
    sideGroup,
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
    score,
    tier: "Pass",
    signals,
    updatedAt,
  };
}

function trendPlayHasData(play: TrendPlay) {
  return play.signals.some((signal) => signal.records.allTime.totalBets > 0);
}

function trendPickLabel(play: TrendPlay) {
  return play.market === "Total"
    ? `${play.side} ${play.line ?? ""}`.trim()
    : play.selectionTeam || play.selection;
}

function trendMarketComparisonKey(play: TrendPlay) {
  if (play.market === "Moneyline") return "Moneyline";
  const line = Number(play.line);
  return `Total|${Number.isFinite(line) ? line : ""}`;
}

function trendSideComparisonKey(play: TrendPlay) {
  return play.market === "Moneyline"
    ? normalizeTeam(play.selectionTeam || play.selection)
    : play.side.toLowerCase();
}

function trendGameComparisonKey(play: TrendPlay) {
  return `${normalizeTeam(play.awayTeam)}|${normalizeTeam(play.homeTeam)}`;
}

function frozenTrendPlayMetrics(play: TrendPlay) {
  const signals = play.signals
    .map((signal) => trendWindowMetrics(signal.records))
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
    score:
      signals.reduce((sum, signal) => sum + signal.score, 0) / signals.length,
    roiPct:
      signals.reduce((sum, signal) => sum + signal.roiPct, 0) / signals.length,
    winPct:
      signals.reduce((sum, signal) => sum + signal.winPct, 0) / signals.length,
    hasData: true,
  };
}

function scoreHeadToHeadTrendPlays(plays: TrendPlay[]) {
  // This intentionally mirrors the page.tsx scoring function exactly. The
  // frozen signal records are the source of truth; a rounded/stale play.score
  // is never used to recover an official pregame tier.
  const baseRows = plays.map((play) => ({
    play,
    metrics: frozenTrendPlayMetrics(play),
  }));

  return baseRows.map(({ play, metrics }) => {
    const sameGameMarket = baseRows.filter(
      (candidate) =>
        trendGameComparisonKey(candidate.play) === trendGameComparisonKey(play) &&
        trendMarketComparisonKey(candidate.play) === trendMarketComparisonKey(play),
    );
    const sideKey = trendSideComparisonKey(play);
    const opponents = sameGameMarket
      .filter(
        (candidate) => trendSideComparisonKey(candidate.play) !== sideKey,
      )
      .sort((a, b) => {
        if (b.metrics.score !== a.metrics.score) {
          return b.metrics.score - a.metrics.score;
        }
        if (b.metrics.roiPct !== a.metrics.roiPct) {
          return b.metrics.roiPct - a.metrics.roiPct;
        }
        return b.metrics.winPct - a.metrics.winPct;
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
    const eligible = Boolean(
      comparisonWinner && metrics.hasData && opponent.metrics.hasData,
    );
    const winnerScore = clampScore(
      50 + comparisonGap + (metrics.score - 50) * 0.5,
    );
    const loserScore = Math.min(
      59,
      clampScore(50 - comparisonGap + (metrics.score - 50) * 0.25),
    );
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

function rankTrendPlays(
  plays: TrendPlay[],
  options?: { frozen?: boolean; frozenAt?: string },
) {
  const byGame = new Map<string, TrendPlay[]>();
  for (const play of plays) {
    const key = trendGameComparisonKey(play);
    const current = byGame.get(key) || [];
    current.push(play);
    byGame.set(key, current);
  }

  const rankBySelection = new Map<string, number>();
  for (const [gameKey, gamePlays] of byGame.entries()) {
    [...gamePlays]
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return trendPickLabel(a).localeCompare(trendPickLabel(b));
      })
      .forEach((play, index) => {
        rankBySelection.set(
          `${gameKey}|${trendMarketComparisonKey(play)}|${trendSideComparisonKey(play)}`,
          index + 1,
        );
      });
  }

  return plays.map((play) => ({
    ...play,
    rank:
      rankBySelection.get(
        `${trendGameComparisonKey(play)}|${trendMarketComparisonKey(play)}|${trendSideComparisonKey(play)}`,
      ) || play.rank,
    frozenAt: options?.frozen
      ? options.frozenAt || play.updatedAt
      : play.frozenAt,
    snapshotStatus: options?.frozen
      ? ("FINAL_PREGAME" as const)
      : play.snapshotStatus || ("LIVE" as const),
    gradingVersion: options?.frozen
      ? FROZEN_TREND_GRADING_VERSION
      : play.gradingVersion,
  }));
}

function trendPlayForAllGameRow(
  row: SheetRow,
  slateRow: SheetRow,
  plays: TrendPlay[],
) {
  const market = trackerMarket(row);
  if (!market) return null;
  const gameKey = `${normalizeTeam(slateRow["Away Team"] || "")}|${normalizeTeam(
    slateRow["Home Team"] || "",
  )}`;
  const candidates = plays.filter(
    (play) =>
      trendGameComparisonKey(play) === gameKey &&
      play.market === market,
  );

  if (market === "Moneyline") {
    const selectedTeam = teamFromSelection(row.Selection || row.Team || "");
    return (
      candidates.find(
        (play) =>
          normalizeTeam(play.selectionTeam || play.selection) === selectedTeam,
      ) || null
    );
  }

  const side = trackerTotalSide(row);
  const line = numericLine(row.Line || row["Odds/Line"] || "");
  return (
    candidates.find(
      (play) =>
        play.side === side &&
        (line == null || play.line == null || Math.abs(play.line - line) < 0.01),
    ) ||
    candidates.find((play) => play.side === side) ||
    null
  );
}

function buildTrendPlays(
  splits: DraftKingsSplit[],
  history: DraftKingsSignalResult[],
  slateRows: SheetRow[],
  referenceDate: string,
  updatedAt: string,
) {
  const slateOrder = new Map(
    slateRows.map((row, index) => [
      `${normalizeTeam(row["Away Team"] || "")}|${normalizeTeam(row["Home Team"] || "")}`,
      index,
    ]),
  );
  const rawPlays = splits
    .filter(
      (split) =>
        isoPublicDate(split.date) === isoPublicDate(referenceDate) &&
        (split.market === "Moneyline" || split.market === "Total") &&
        slateOrder.has(
          `${normalizeTeam(split.awayTeam)}|${normalizeTeam(split.homeTeam)}`,
        ),
    )
    .map((split) =>
      buildTrendPlayForSplit(
        split,
        history,
        referenceDate,
        split.snapshotTime || split.lastSeenAt || updatedAt,
      ),
    )
    .filter((play): play is TrendPlay => Boolean(play));

  return scoreHeadToHeadTrendPlays(rawPlays).sort((a, b) => {
    const aGame = trendGameComparisonKey(a);
    const bGame = trendGameComparisonKey(b);
    const gameOrder =
      (slateOrder.get(aGame) ?? Number.POSITIVE_INFINITY) -
      (slateOrder.get(bGame) ?? Number.POSITIVE_INFINITY);
    if (gameOrder) return gameOrder;
    if (b.score !== a.score) return b.score - a.score;
    return trendPickLabel(a).localeCompare(trendPickLabel(b));
  });
}

function trendSnapshotFields(play: TrendPlay | null): SheetRow {
  if (!play) {
    return {
      "Trend Play": "FALSE",
      "Trend Score": "",
      "Trend Tier": "",
      "Trend Signals": "",
      "Trend All Time Record": "",
      "Trend Last 30 Record": "",
      "Trend Last 7 Record": "",
      "Trend Exact Sample": "",
      "Trend Score Details": "",
    };
  }
  const primary = play.signals[0];
  return {
    "Trend Play": "TRUE",
    "Trend Score": String(play.score),
    "Trend Tier": play.tier,
    "Trend Signals": play.signals.map((signal) => signal.signal).join(" | "),
    "Trend All Time Record": primary?.records.allTime.record || "",
    "Trend Last 30 Record": primary?.records.last30.record || "",
    "Trend Last 7 Record": primary?.records.last7.record || "",
    "Trend Exact Sample": play.signals.map((signal) => signal.exactSample).join(" | "),
    "Trend Score Details": JSON.stringify(play),
  };
}

function parseStoredTrendPlay(row: SheetRow): TrendPlay | null {
  const raw = String(row["Trend Score Details"] || "").trim();
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<TrendPlay>;
    if (
      (parsed.market !== "Moneyline" && parsed.market !== "Total") ||
      !parsed.game ||
      !parsed.awayTeam ||
      !parsed.homeTeam ||
      !Array.isArray(parsed.signals)
    ) {
      return null;
    }

    const snapshotTime = String(
      row["Public Split Snapshot Time"] ||
        row["Result Updated"] ||
        parsed.frozenAt ||
        parsed.updatedAt ||
        "",
    );
    const validTier =
      parsed.tier === "Good" ||
      parsed.tier === "Strong" ||
      parsed.tier === "Elite" ||
      parsed.tier === "Pass"
        ? parsed.tier
        : "Pass";

    return {
      ...(parsed as TrendPlay),
      score: Number.isFinite(Number(parsed.score)) ? Number(parsed.score) : 0,
      tier: validTier,
      signals: parsed.signals as TrendSignalBreakdown[],
      updatedAt: String(parsed.updatedAt || snapshotTime),
      frozenAt: parsed.frozenAt ? String(parsed.frozenAt) : undefined,
      snapshotStatus:
        parsed.snapshotStatus === "FINAL_PREGAME"
          ? "FINAL_PREGAME"
          : parsed.snapshotStatus === "LIVE"
            ? "LIVE"
            : undefined,
    };
  } catch {
    return null;
  }
}

function frozenTrendPlaysFromRows(
  rows: SheetRow[],
  referenceDate?: string,
): TrendPlay[] {
  const parsedRows = rows
    .filter(
      (row) =>
        !referenceDate ||
        isoPublicDate(row.Date || "") === isoPublicDate(referenceDate),
    )
    .filter((row) =>
      isOfficialTrendSnapshotConfidence(row["Public Split Match Confidence"] || ""),
    )
    .map((row) => ({ row, play: parseStoredTrendPlay(row) }))
    .filter(
      (item): item is { row: SheetRow; play: TrendPlay } => Boolean(item.play),
    );

  const byGame = new Map<string, Array<{ row: SheetRow; play: TrendPlay }>>();
  for (const item of parsedRows) {
    const savedGameKey = String(item.row["Game Key"] || "")
      .trim()
      .replace(/\.0$/, "");
    const matchupKey = trendGameComparisonKey(item.play);
    const gameTime = textKey(item.row["Game Time"] || item.row.Game || "");
    const key = `${isoPublicDate(item.row.Date || "")}|${
      savedGameKey || `${matchupKey}|${gameTime}`
    }`;
    const current = byGame.get(key) || [];
    current.push(item);
    byGame.set(key, current);
  }

  const output: TrendPlay[] = [];
  for (const gameItems of byGame.values()) {
    const gamePlays = gameItems.map(({ row, play }) => ({
      ...play,
      recordDate: isoPublicDate(row.Date || ""),
      recordGameKey: String(row["Game Key"] || "").trim().replace(/\.0$/, ""),
      recordGameTime: String(row["Game Time"] || "").trim(),
    }));
    const fullyFinal = gamePlays.every(
      (play) =>
        play.snapshotStatus === "FINAL_PREGAME" &&
        Boolean(play.frozenAt) &&
        play.baseScore != null &&
        play.gradingVersion === FROZEN_TREND_GRADING_VERSION,
    );
    const scored = fullyFinal
      ? gamePlays
      : scoreHeadToHeadTrendPlays(gamePlays);

    output.push(
      ...rankTrendPlays(scored, {
        frozen: true,
      }),
    );
  }

  return output;
}

function overlayFrozenTrendPlays(
  livePlays: TrendPlay[],
  frozenPlays: TrendPlay[],
  slateRows: SheetRow[],
) {
  if (!frozenPlays.length) return livePlays;

  const frozenGameKeys = new Set(
    frozenPlays.map((play) => trendGameComparisonKey(play)),
  );
  const combined = [
    ...livePlays.filter(
      (play) => !frozenGameKeys.has(trendGameComparisonKey(play)),
    ),
    ...frozenPlays,
  ];
  const slateOrder = new Map(
    slateRows.map((row, index) => [
      `${normalizeTeam(row["Away Team"] || "")}|${normalizeTeam(row["Home Team"] || "")}`,
      index,
    ]),
  );

  return combined.sort((a, b) => {
    const aGame = trendGameComparisonKey(a);
    const bGame = trendGameComparisonKey(b);
    const gameOrder =
      (slateOrder.get(aGame) ?? Number.POSITIVE_INFINITY) -
      (slateOrder.get(bGame) ?? Number.POSITIVE_INFINITY);
    if (gameOrder) return gameOrder;
    if (b.score !== a.score) return b.score - a.score;
    return trendPickLabel(a).localeCompare(trendPickLabel(b));
  });
}

function rowsFromLast7Days(rows: SheetRow[]) {
  // Use Eastern calendar dates, not a rolling 168-hour JavaScript Date window.
  // This makes the range include today plus the previous 6 calendar days.
  const todayDate = parseNormalizedDate(todayET());
  if (!todayDate) return [];
  const oneDayMs = 24 * 60 * 60 * 1000;

  return rows.filter((row) => {
    const rowDate = parseNormalizedDate(row["Date"] || row["date"] || "");
    if (!rowDate) return false;
    const diffDays = Math.round(
      (todayDate.getTime() - rowDate.getTime()) / oneDayMs,
    );
    return diffDays >= 0 && diffDays <= 6;
  });
}

function formatMoneylinePct(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "—";
  return raw.includes("%") ? raw : `${raw}%`;
}

function firstValue(row: SheetRow | undefined, keys: string[]) {
  if (!row) return "";
  for (const key of keys) {
    const value = String(row[key] ?? "").trim();
    if (value) return value;
  }
  return "";
}

function normalizeProbability(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const n = toNumber(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1 ? n / 100 : n;
}

function calculateNRFIScoreFromProbability(
  probability: number,
  playType: unknown,
) {
  if (!probability || !Number.isFinite(probability)) return 0;
  const nrfiScore = Math.max(
    0,
    Math.min(100, 50 + (probability - 0.515) * 450),
  );
  return normalizeType(playType) === "YRFI" ? 100 - nrfiScore : nrfiScore;
}

function fallbackNRFIScore(playType: unknown) {
  const type = normalizeType(playType);
  if (type.includes("ELITE")) return 88;
  if (type.includes("STRONG")) return 78;
  if (type.includes("LEAN")) return 68;
  // If the sheet does not provide a true NRFI/YRFI score or probability, do not invent a generic score.
  // This prevents unknown generic NRFI/YRFI plays from clustering at 65/66.
  return 0;
}

function calculateNRFIPlayScore(row: SheetRow, playType: unknown) {
  const directKeys = [
    "NRFI Score",
    "YRFI Score",
    "NRFI/YRFI Score",
    "First Inning Score",
    "1st Inning Score",
    "NRFI Rank Score",
    "YRFI Rank Score",
    "NRFI Model Score",
    "YRFI Model Score",
    "Best Play Score",
  ];

  for (const key of directKeys) {
    const raw = String(row[key] ?? "").trim();
    if (!raw) continue;
    let score = scoreValueFromRaw(raw);
    if (!score) continue;
    const lowerKey = key.toLowerCase();
    if (
      normalizeType(playType) === "YRFI" &&
      lowerKey.includes("nrfi") &&
      !lowerKey.includes("yrfi")
    ) {
      score = 100 - score;
    }
    return clampScore(score);
  }

  // Future-proof scan: accept any NRFI/YRFI score-style column without needing an exact header.
  for (const [key, rawValue] of Object.entries(row)) {
    const lowerKey = key.toLowerCase();
    if (
      !(
        lowerKey.includes("nrfi") ||
        lowerKey.includes("yrfi") ||
        lowerKey.includes("first inning") ||
        lowerKey.includes("1st inning")
      )
    )
      continue;
    if (
      !(
        lowerKey.includes("score") ||
        lowerKey.includes("rank") ||
        lowerKey.includes("model")
      )
    )
      continue;
    if (
      lowerKey.includes("grade") ||
      lowerKey.includes("odds") ||
      lowerKey.includes("line")
    )
      continue;

    let score = scoreValueFromRaw(rawValue);
    if (!score) continue;
    if (
      normalizeType(playType) === "YRFI" &&
      lowerKey.includes("nrfi") &&
      !lowerKey.includes("yrfi")
    ) {
      score = 100 - score;
    }
    return clampScore(score);
  }

  const probabilityKeys = [
    "NRFI %",
    "NRFI%",
    "NRFI Probability",
    "NRFI Prob",
    "NRFI Model %",
    "NRFI Model",
    "NRFI Projection",
    "NRFI Projected %",
  ];

  let probability = normalizeProbability(firstValue(row, probabilityKeys));

  if (!probability) {
    for (const [key, rawValue] of Object.entries(row)) {
      const lowerKey = key.toLowerCase();
      if (!lowerKey.includes("nrfi")) continue;
      if (
        !(
          lowerKey.includes("%") ||
          lowerKey.includes("prob") ||
          lowerKey.includes("projection")
        )
      )
        continue;
      if (
        lowerKey.includes("grade") ||
        lowerKey.includes("odds") ||
        lowerKey.includes("line")
      )
        continue;
      probability = normalizeProbability(rawValue);
      if (probability) break;
    }
  }

  const calculated = calculateNRFIScoreFromProbability(probability, playType);
  return calculated ? clampScore(calculated) : fallbackNRFIScore(playType);
}

function cleanTeamName(value: unknown) {
  return String(value ?? "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\b\d+(?:\.\d+)?%/g, "")
    .replace(/\bMoneyline\b/gi, "")
    .replace(/\bA\+?\b|\bB\+?\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanPitcherName(value: unknown) {
  return String(value ?? "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\bLine\b.*$/i, "")
    .replace(/\d+(?:\.\d+)?/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function oddsFromLineCell(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  // Keep the whole "5.5 / -150" string so the frontend can show line and odds separately.
  if (/\d+(?:\.\d+)?\s*\/\s*[+-]?\d{3,}/.test(raw)) return raw;
  const signed = raw.match(/[+-]\d{3,}/)?.[0];
  if (signed) return signed;
  return raw;
}

function findTrackerOddsForPitcher(
  trackerRows: SheetRow[],
  today: string,
  game: string,
  pitcherName: string,
) {
  const pitcher = normalizeText(pitcherName);
  if (!pitcher) return "";

  for (const row of trackerRows) {
    if (normalizeDate(row["Date"] || row["date"]) !== today) continue;
    const type = normalizeType(
      row["Bet Type"] || row["Market"] || row["Type"] || "",
    );
    if (
      ![
        "OVER",
        "UNDER",
        "LEAN OVER",
        "LEAN UNDER",
        "STRONG OVER",
        "STRONG UNDER",
      ].includes(type)
    )
      continue;

    const rowGame = normalizeText(
      row["Game"] || row["Game Label"] || row["Matchup"] || "",
    );
    const gameOk =
      !rowGame ||
      rowGame === normalizeText(game) ||
      normalizeText(game).includes(rowGame) ||
      rowGame.includes(normalizeText(game));
    const haystack = normalizeText(
      [
        row["Play"],
        row["Pick"],
        row["Selection"],
        row["Player"],
        row["Pitcher"],
        row["Name"],
      ].join(" "),
    );

    if (gameOk && haystack.includes(pitcher)) {
      return oddsFromLineCell(
        firstValue(row, ["Odds/Line", "Odds", "Line", "Prop Odds", "K Odds"]),
      );
    }
  }

  return "";
}

function parseKSummary(summary: string) {
  const raw = String(summary || "").trim();
  const explicitLine = raw.match(/\bLine\s*([0-9]+(?:\.[0-9]+)?)/i)?.[1];
  const beforeGrade = raw.split("(")[0] || raw;
  const projectedMatches = [
    ...beforeGrade.matchAll(/([0-9]+(?:\.[0-9]+)?)/g),
  ].map((match) => match[1]);
  const projected = projectedMatches.length
    ? projectedMatches[projectedMatches.length - 1]
    : "";
  const afterGrade = raw.includes(")") ? raw.split(")").slice(1).join(")") : "";
  const afterGradeNumber = afterGrade.match(/([0-9]+(?:\.[0-9]+)?)/)?.[1];

  return {
    pitcherName: cleanPitcherName(raw),
    projected: projected || "",
    line: explicitLine || afterGradeNumber || "",
  };
}

function extractPitcherFromSelection(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const match = text.match(/^(.*?)(?=\s+\d+(?:\.\d+)?)/);
  return (match ? match[1] : text.split("(", 1)[0]).trim();
}

function pitcherNameTokens(value: unknown) {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length >= 2)
    .filter(
      (token) =>
        ![
          "over",
          "under",
          "lean",
          "strong",
          "line",
          "odds",
          "pitcher",
          "strikeouts",
          "strikeout",
          "so",
          "ks",
          "k",
          "projected",
          "alt",
          "prop",
        ].includes(token),
    );
}

function namesShareAtLeastTwoTokens(a: unknown, b: unknown) {
  const aTokens = new Set(pitcherNameTokens(a));
  const bTokens = pitcherNameTokens(b);
  if (!aTokens.size || !bTokens.length) return false;
  let shared = 0;
  for (const token of bTokens) {
    if (aTokens.has(token)) shared += 1;
  }
  return (
    shared >= 2 || (shared >= 1 && (aTokens.size === 1 || bTokens.length === 1))
  );
}

function isPitcherKType(value: unknown) {
  return [
    "OVER",
    "UNDER",
    "LEAN OVER",
    "LEAN UNDER",
    "STRONG OVER",
    "STRONG UNDER",
  ].includes(normalizeType(value));
}

function isCompletedResult(value: unknown) {
  const result = String(value || "")
    .trim()
    .toUpperCase();
  return (
    result === "W" ||
    result === "L" ||
    result === "P" ||
    result.includes("WIN") ||
    result.includes("LOSS") ||
    result.includes("PUSH")
  );
}

function favoriteValue(row: SheetRow) {
  // Active display badge must come only from the actual Favorite Pick column.
  return String(row["Favorite Pick"] ?? "").trim();
}

function handpickedRecordValue(row: SheetRow) {
  // Permanent historical tracker. New app.py sets Handpicked Record = TRUE
  // when you handpick a play. Favorite Pick is included so older rows still count.
  return firstValue(row, [
    "Handpicked Record",
    "Was Handpicked",
    "Handpicked",
    "Handpicked Pick",
    "Favorite Pick",
  ]);
}

function isFavoriteRow(row: SheetRow) {
  return isTrueValue(favoriteValue(row));
}

function favoriteMeta(row: SheetRow) {
  return {
    favoritePick: "TRUE",
    favoriteRank: firstValue(row, ["Favorite Rank"]),
    favoriteTag: firstValue(row, ["Favorite Tag"]),
    favoriteNotes: firstValue(row, ["Favorite Notes"]),
  };
}

function clearFavoriteMeta(play: Play): Play {
  return {
    ...play,
    favoritePick: "",
    favoriteRank: "",
    favoriteTag: "",
    favoriteNotes: "",
  };
}

function favoriteKeyPart(value: unknown) {
  return normalizeText(value)
    .replace(/\bvs\b/g, " at ")
    .replace(/\s+/g, " ")
    .trim();
}

function isNRFIType(value: unknown) {
  const type = normalizeType(value);
  return type.includes("NRFI") || type === "YRFI";
}

function trackerFavoriteKey(row: SheetRow) {
  const type = normalizeType(row["Bet Type"] || row["Market"] || "");
  const market = String(row["Market"] || "")
    .trim()
    .toUpperCase();
  const selection = String(
    row["Selection"] || row["Pick"] || row["Play"] || "",
  ).trim();
  const rowIsMoneyline = type.includes("MONEYLINE") || market === "MONEYLINE";
  const rowIsNrfi =
    isNRFIType(type) || ["NRFI/YRFI", "NRFI", "YRFI"].includes(market);
  const rowIsPitcherK =
    isPitcherKType(type) ||
    market.includes("STRIKEOUT") ||
    market.includes("PITCHER");

  if (rowIsMoneyline) {
    return `ML|${favoriteKeyPart(selection)}`;
  }

  if (rowIsNrfi) {
    // Exact game + exact NRFI/YRFI grade. This prevents a TRUE Elite NRFI from badging every Elite NRFI.
    return `NRFI|${type}|${favoriteKeyPart(selection)}`;
  }

  if (rowIsPitcherK) {
    // Pitcher props key off the pitcher identity only inside pitcher-strikeout rows.
    const pitcher = extractPitcherFromSelection(selection) || selection;
    return `PK|${favoriteKeyPart(pitcher)}`;
  }

  return "";
}

function playFavoriteKey(play: Play) {
  const playType = normalizeType(play.playType);
  const playIsMoneyline = playType.includes("MONEYLINE");
  const playIsNrfi = isNRFIType(playType);
  const playIsPitcherK = isPitcherKType(playType);

  if (playIsMoneyline) {
    return `ML|${favoriteKeyPart(play.playerTeam || play.play)}`;
  }

  if (playIsNrfi) {
    return `NRFI|${playType}|${favoriteKeyPart(play.game)}`;
  }

  if (playIsPitcherK) {
    return `PK|${favoriteKeyPart(play.play)}`;
  }

  return "";
}

function applyFavoriteInfoToPlays(
  plays: Play[],
  trackerRows: SheetRow[],
  today: string,
) {
  // Nuclear-safe approach:
  // 1) Clear favorite metadata from every play first.
  // 2) Build keys ONLY from today's tracker rows where Favorite Pick is literally TRUE.
  // 3) Attach each TRUE row to at most one exact play-family key.
  // No fallback, no game/team spillover, no index-based matching.
  const cleanPlays = plays.map(clearFavoriteMeta);
  const favoriteRows = trackerRows
    .map((row, index) => ({ row, index, key: trackerFavoriteKey(row) }))
    .filter(
      ({ row, key }) =>
        normalizeDate(row["Date"] || row["date"] || "") === today &&
        isFavoriteRow(row) &&
        Boolean(key),
    );

  const usedFavoriteIndexes = new Set<number>();

  return cleanPlays.map((play) => {
    const key = playFavoriteKey(play);
    if (!key) return play;

    const match = favoriteRows.find(
      ({ index, key: rowKey }) =>
        !usedFavoriteIndexes.has(index) && rowKey === key,
    );
    if (!match) return play;

    usedFavoriteIndexes.add(match.index);
    return {
      ...play,
      ...favoriteMeta(match.row),
    };
  });
}

function buildBestPlaysFromSlate(
  rows: SheetRow[],
  today: string,
  trackerRows: SheetRow[] = [],
): Play[] {
  const todaysRows = rows.filter((row) => normalizeDate(row["Date"]) === today);
  const plays: Play[] = [];

  for (const row of todaysRows) {
    const game =
      row["Game Label"] ||
      `${row["Away Team"] || ""} at ${row["Home Team"] || ""}`.trim();
    const awayTeam = row["Away Team"] || "";
    const homeTeam = row["Home Team"] || "";

    const mlGrade = normalizeType(row["ML Grade"] || "");
    if (MONEYLINE_GRADES.has(mlGrade)) {
      const betterTeam = cleanTeamName(
        firstValue(row, ["Better ML", "Moneyline Team", "ML Team"]),
      );
      plays.push({
        playType: mlGrade,
        game,
        play: "Moneyline",
        oddsLine: firstValue(row, [
          "ML Odds",
          "Moneyline Odds",
          "Odds",
          "Odds/Line",
        ]),
        score: calculateMoneylineEZPZScore(row, mlGrade),
        isGreen: true,
        awayTeam,
        homeTeam,
        playerTeam: betterTeam,
        moneylinePct: formatMoneylinePct(
          firstValue(row, [
            "Model %",
            "Win %",
            "Moneyline %",
            "ML %",
            "Model Win %",
            "Model Moneyline %",
            "ML Model %",
            "Better ML %",
            "Better Moneyline %",
            "Better ML",
            "Better Moneyline",
          ]),
        ),
      });
    }

    const nrfiGrade = normalizeType(row["NRFI Grade"] || "");
    if (isGreenType(nrfiGrade)) {
      plays.push({
        playType: nrfiGrade,
        game,
        play: nrfiGrade.includes("YRFI") ? "YRFI" : "NRFI",
        oddsLine: firstValue(row, [
          "NRFI Odds",
          "YRFI Odds",
          "First Inning Odds",
          "NRFI Line/Odds",
          "Odds/Line",
        ]),
        score: calculateNRFIPlayScore(row, nrfiGrade),
        isGreen: true,
        awayTeam,
        homeTeam,
      });
    }

    const kMarkets = [
      {
        summary: row["Away Pitcher K + Grade"] || "",
        score:
          row["Away Pitcher K Score"] ||
          row["Away K Score"] ||
          row["Away Pitcher Score"] ||
          "",
        team: awayTeam,
        odds: firstValue(row, [
          "Away Pitcher K Odds",
          "Away K Odds",
          "Away Pitcher Odds",
          "Away Pitcher Prop Odds",
          "Away Pitcher Odds/Line",
        ]),
        headshotUrl: firstValue(row, [
          "Away Pitcher Headshot",
          "Away Pitcher Headshot URL",
          "Away Pitcher Image",
          "Away Pitcher Photo",
          "Away Headshot",
        ]),
      },
      {
        summary: row["Home Pitcher K + Grade"] || "",
        score:
          row["Home Pitcher K Score"] ||
          row["Home K Score"] ||
          row["Home Pitcher Score"] ||
          "",
        team: homeTeam,
        odds: firstValue(row, [
          "Home Pitcher K Odds",
          "Home K Odds",
          "Home Pitcher Odds",
          "Home Pitcher Prop Odds",
          "Home Pitcher Odds/Line",
        ]),
        headshotUrl: firstValue(row, [
          "Home Pitcher Headshot",
          "Home Pitcher Headshot URL",
          "Home Pitcher Image",
          "Home Pitcher Photo",
          "Home Headshot",
        ]),
      },
    ];

    for (const market of kMarkets) {
      const type = normalizeType(market.summary);
      if (!isGreenType(type)) continue;
      const parsed = parseKSummary(market.summary);
      const pitcherName =
        parsed.pitcherName || cleanPitcherName(market.summary);
      const trackerOdds = findTrackerOddsForPitcher(
        trackerRows,
        today,
        game,
        pitcherName,
      );
      const odds = oddsFromLineCell(
        market.odds ||
          trackerOdds ||
          (parsed.line ? `Line ${parsed.line}` : ""),
      );

      plays.push({
        playType: type,
        game,
        play: pitcherName || market.summary,
        oddsLine: odds,
        score: calculatePitcherKEZPZScore(market.summary, market.score, type),
        isGreen: true,
        awayTeam,
        homeTeam,
        headshotUrl: market.headshotUrl,
        playerTeam: market.team,
        projectedKs: parsed.projected,
        altLine: parsed.line,
        altOdds: odds,
      });
    }
  }

  const sorted = plays.sort(
    (a, b) => parseScore(b.score) - parseScore(a.score),
  );
  return applyFavoriteInfoToPlays(sorted, trackerRows, today);
}


function aiRound(value: number, digits = 1) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function aiClamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function aiImpliedProbability(value: unknown) {
  const odds = parseAmericanOdds(value);
  if (!odds) return 0;
  return odds > 0
    ? aiRound((100 / (odds + 100)) * 100, 1)
    : aiRound((Math.abs(odds) / (Math.abs(odds) + 100)) * 100, 1);
}

function aiBestPlayMarket(play: Play): AiPickMarket | "" {
  const raw = String(play.playType || "").toUpperCase();
  const type = normalizeType(play.playType);
  if (raw.includes("TOTAL")) return "Total";
  if (type.includes("MONEYLINE")) return "Moneyline";
  if (["STRONG OVER", "OVER", "LEAN OVER", "STRONG UNDER", "UNDER", "LEAN UNDER"].includes(type)) {
    return "Pitcher Strikeouts";
  }
  if (type.includes("NRFI") || type.includes("YRFI")) return "First Inning";
  return "";
}

function aiSlateRowForPlay(play: Play, slateRows: SheetRow[]) {
  const away = normalizeTeam(play.awayTeam || "");
  const home = normalizeTeam(play.homeTeam || "");
  return (
    slateRows.find(
      (row) =>
        normalizeTeam(row["Away Team"] || "") === away &&
        normalizeTeam(row["Home Team"] || "") === home,
    ) ||
    slateRows.find((row) => textKey(row["Game Label"] || row.Game || "") === textKey(play.game)) ||
    null
  );
}

function aiGameTime(row: SheetRow | null) {
  if (!row) return "";
  return firstValue(row, [
    "Game Time",
    "Game Start Time",
    "Scheduled Start",
    "Start Time",
    "Game Time ET",
  ]);
}

function aiBestPlayIdentity(play: Play, row: SheetRow | null) {
  const market = aiBestPlayMarket(play);
  const type = normalizeType(play.playType);
  if (market === "Moneyline") {
    const selection = cleanTeamName(play.playerTeam || play.play || firstValue(row || {}, ["Better ML"]));
    return { market, selection, line: "", playLabel: `${selection} Moneyline`.trim() };
  }
  if (market === "Total") {
    const rawType = String(play.playType || "").toUpperCase();
    const side = rawType.includes("UNDER") || type.includes("UNDER") ? "Under" : "Over";
    const line = String(
      play.altLine ||
        firstValue(row || {}, ["Total Runs Line", "Total Line", "Game Total Line", "O/U Line"]) ||
        String(play.oddsLine || "").split("/")[0].trim(),
    ).trim();
    return { market, selection: side, line, playLabel: `${side} ${line}`.trim() };
  }
  if (market === "Pitcher Strikeouts") {
    const side = type.includes("UNDER") ? "Under" : "Over";
    const parsed = parseKSummary(play.play || "");
    const pitcher = parsed.pitcherName || cleanPitcherName(play.play || "");
    const line = String(play.altLine || parsed.line || "").trim();
    return {
      market,
      selection: `${pitcher}|${side}`,
      line,
      playLabel: `${pitcher} ${side} ${line} Strikeouts`.replace(/\s+/g, " ").trim(),
    };
  }
  const firstInning = type.includes("YRFI") ? "YRFI" : "NRFI";
  return { market, selection: firstInning, line: "", playLabel: firstInning };
}

function aiCandidateId(
  date: string,
  gameKey: string,
  market: AiPickMarket,
  selection: string,
  line: string,
) {
  return [
    isoPublicDate(date),
    gameKey || "unknown-game",
    textKey(market),
    textKey(selection),
    String(line || "").trim(),
  ].join("|");
}

function aiTrendProbability(play: TrendPlay) {
  let weightedWins = 0;
  let weightedDecisions = 0;
  let weightedRaw = 0;
  let totalWeight = 0;
  const windows: Array<[keyof TrendWindowRecords, number]> = [
    ["allTime", 0.4],
    ["last30", 0.35],
    ["last7", 0.25],
  ];
  for (const signal of play.signals || []) {
    for (const [window, weight] of windows) {
      const record = signal.records?.[window];
      if (!record) continue;
      const decisions = Number(record.wins || 0) + Number(record.losses || 0);
      if (!decisions) continue;
      weightedWins += Number(record.wins || 0) * weight;
      weightedDecisions += decisions * weight;
      weightedRaw += Number(record.winPct || 0) * weight;
      totalWeight += weight;
    }
  }
  if (!weightedDecisions || !totalWeight) {
    return aiClamp(50 + (Number(play.score || 50) - 50) * 0.3, 45, 70);
  }
  const rawPct = weightedRaw / totalWeight;
  const effectiveSample = weightedDecisions / Math.max(1, (play.signals || []).length);
  const shrink = effectiveSample / (effectiveSample + 12);
  const shrunk = 50 + (rawPct - 50) * shrink;
  return aiClamp(shrunk, 42, 74);
}

function aiBestProbability(play: Play) {
  const moneyline = normalizePercentValue(play.moneylinePct || "");
  if (aiBestPlayMarket(play) === "Moneyline" && moneyline > 0) {
    return aiClamp(moneyline, 40, 82);
  }
  const score = parseScore(play.score);
  return aiClamp(50 + (score - 50) * 0.35, 44, 74);
}

function aiFindMarketSplit(candidate: AiSelectorCandidate, draftKings: DraftKingsPayload) {
  if (candidate.market !== "Moneyline" && candidate.market !== "Total") return null;
  const options = draftKings.splits.filter(
    (split) =>
      normalizeTeam(split.awayTeam) === normalizeTeam(candidate.awayTeam) &&
      normalizeTeam(split.homeTeam) === normalizeTeam(candidate.homeTeam) &&
      split.market === candidate.market,
  );
  if (candidate.market === "Moneyline") {
    return options.find(
      (split) => normalizeTeam(split.selectionTeam || split.selection) === normalizeTeam(candidate.selection),
    ) || null;
  }
  return options.find((split) => split.side === candidate.selection) || null;
}

function aiCanonicalBestPlayType(value: unknown) {
  const raw = String(value || "").toUpperCase();
  if (raw.includes("TOTAL") && raw.includes("UNDER")) return "TOTAL UNDER";
  if (raw.includes("TOTAL") && raw.includes("OVER")) return "TOTAL OVER";
  if (raw.includes("ELITE YRFI")) return "ELITE YRFI";
  return normalizeType(value);
}

function aiPendingTotalBestPlays(trackerRows: SheetRow[], today: string): Play[] {
  const output: Play[] = [];
  for (const row of trackerRows) {
    if (normalizeDate(row.Date || row.date || row["Bet Date"] || "") !== today) continue;
    if (resultCode(row.Result || row.Status || "")) continue;
    if (trackerMarket(row) !== "Total") continue;
    const side = trackerTotalSide(row);
    if (!side) continue;
    const game = String(row.Game || row["Game Label"] || row.Matchup || "Game Total");
    const parts = game.split(/\s+(?:at|@|vs\.?|v\.?|versus)\s+/i);
    const lineCell = String(row["Odds/Line"] || row.Odds || "");
    const line = String(
      row.Line || row["Total Line"] || row["Game Total Line"] || lineCell.split("/")[0] || "",
    ).trim();
    const projection = toNumber(
      firstValue(row, [
        "Projected Total",
        "Total Projection",
        "Total Runs Projection",
        "Model Projection",
        "Predicted Total",
        "Projection",
      ]),
    );
    const numericLine = toNumber(line);
    const explicitScore = toNumber(firstValue(row, ["EZPZ Score", "AI Score", "Score", "Model Score"]));
    const score = explicitScore > 20
      ? explicitScore
      : projection && numericLine
        ? aiClamp(65 + Math.abs(projection - numericLine) * 8, 60, 92)
        : 72;
    output.push({
      playType: `TOTAL ${side.toUpperCase()}`,
      game,
      play: `${side} ${line}`.trim(),
      oddsLine: lineCell,
      score,
      isGreen: true,
      awayTeam: cleanTeamName(parts[0] || row["Away Team"] || ""),
      homeTeam: cleanTeamName(parts[1] || row["Home Team"] || ""),
      altLine: line,
    });
  }
  return output;
}

function aiSummaryForType(rows: SheetRow[], type: string) {
  const normalized = aiCanonicalBestPlayType(type);
  const matching = rows.filter((row) => {
    if (normalized === "TOTAL OVER" || normalized === "TOTAL UNDER") {
      return trackerMarket(row) === "Total" && trackerTotalSide(row).toUpperCase() === normalized.replace("TOTAL ", "");
    }
    if (["OVER", "UNDER", "LEAN OVER", "LEAN UNDER", "STRONG OVER", "STRONG UNDER"].includes(normalized)) {
      return trackerMarket(row) !== "Total" && normalizeType(row["Bet Type"] || row.Market || "") === normalized;
    }
    return aiCanonicalBestPlayType(row["Bet Type"] || row.Market || "") === normalized;
  });
  return buildTotals(normalized || "Play", matching);
}

function aiRecordAdjustments(candidate: AiSelectorCandidate, completedTrackerRows: SheetRow[]) {
  if (!candidate.bestPlayType) return;
  const overall = aiSummaryForType(completedTrackerRows, candidate.bestPlayType);
  const recent = aiSummaryForType(rowsFromLast7Days(completedTrackerRows), candidate.bestPlayType);
  const overallDecisions = overall.wins + overall.losses;
  const recentDecisions = recent.wins + recent.losses;
  if (overallDecisions) {
    const shrunken = (overall.wins + 6) / (overallDecisions + 12);
    const adjustment = aiClamp((shrunken - 0.5) * 10, -2.5, 2.5);
    candidate.probabilityAdjustment += adjustment;
    candidate.scoreAdjustment += adjustment * 1.2;
    if (overall.wins > overall.losses) {
      candidate.whySelected.push(
        `${candidate.bestPlayType} is ${overall.wins}-${overall.losses}-${overall.pushes} in the running record`,
      );
    } else if (overall.losses > overall.wins) {
      candidate.risks.push(
        `${candidate.bestPlayType} has a losing ${overall.wins}-${overall.losses}-${overall.pushes} running record`,
      );
    }
  }
  if (recentDecisions) {
    const shrunken = (recent.wins + 4) / (recentDecisions + 8);
    const adjustment = aiClamp((shrunken - 0.5) * 8, -2, 2);
    candidate.probabilityAdjustment += adjustment;
    candidate.scoreAdjustment += adjustment;
    if (recent.wins > recent.losses) {
      candidate.whySelected.push(
        `Recent ${candidate.bestPlayType} form is ${recent.wins}-${recent.losses}-${recent.pushes}`,
      );
    } else if (recent.losses > recent.wins) {
      candidate.risks.push(
        `Recent ${candidate.bestPlayType} form is ${recent.wins}-${recent.losses}-${recent.pushes}`,
      );
    }
  }
}

function aiApplyMarketContext(candidate: AiSelectorCandidate, draftKings: DraftKingsPayload) {
  if (candidate.market !== "Moneyline" && candidate.market !== "Total") return;
  const split = aiFindMarketSplit(candidate, draftKings);
  if (!split) {
    candidate.protectionReasons.push("No matching DraftKings market snapshot was available");
    candidate.dataStatus.push("DraftKings selected-side match unavailable");
    return;
  }
  candidate.dataStatus.push(
    split.snapshotStatus === "FINAL_PREGAME"
      ? `Final pregame market snapshot ${split.snapshotTime || split.lastSeenAt || draftKings.updatedAt}`
      : `Live market data updated ${split.lastSeenAt || draftKings.updatedAt}`,
  );
  if (draftKings.stale && split.snapshotStatus !== "FINAL_PREGAME") {
    candidate.protectionReasons.push("Current DraftKings market data is stale");
  }
  if (split.warningTone === "positive") {
    candidate.scoreAdjustment += 1.5;
    candidate.probabilityAdjustment += 0.7;
    candidate.whySelected.push(split.warning || "Public-money profile supports the selection");
  } else if (split.warningTone === "negative") {
    candidate.scoreAdjustment -= 3;
    candidate.probabilityAdjustment -= 1.5;
    candidate.risks.push(split.warning || "Public-money profile conflicts with the selection");
  }
  if (split.lineMovementTone === "positive") {
    candidate.scoreAdjustment += 2;
    candidate.probabilityAdjustment += 1;
    candidate.whySelected.push(split.lineMovementSignal || "Market movement supports the selection");
  } else if (split.lineMovementTone === "negative") {
    candidate.scoreAdjustment -= 2.5;
    candidate.probabilityAdjustment -= 1.2;
    candidate.risks.push(split.lineMovementSignal || "Market movement conflicts with the selection");
  }
  if (split.betsPct >= 85 && split.moneyPct >= 80) {
    candidate.scoreAdjustment -= 2;
    candidate.probabilityAdjustment -= 1;
    candidate.risks.push(
      `Heavy public concentration: ${split.betsPct.toFixed(0)}% bets and ${split.moneyPct.toFixed(0)}% money`,
    );
  }
  if (split.moneyPct - split.betsPct >= 10) {
    candidate.scoreAdjustment += 1;
    candidate.probabilityAdjustment += 0.5;
    candidate.whySelected.push(
      `Money exceeds tickets by ${(split.moneyPct - split.betsPct).toFixed(1)} points`,
    );
  }
}

function aiProtectionChecks(candidate: AiSelectorCandidate) {
  if (!candidate.slateRow) candidate.protectionReasons.push("The candidate could not be matched to today’s saved slate");
  if (candidate.slateRow && !isPregameRow(candidate.slateRow)) {
    candidate.protectionReasons.push("The game has already started");
  }
  if (!String(candidate.odds || "").trim() || !parseAmericanOdds(candidate.odds)) {
    candidate.protectionReasons.push("Playable odds are missing");
  }
  if ((candidate.market === "Total" || candidate.market === "Pitcher Strikeouts") && !String(candidate.line || "").trim()) {
    candidate.protectionReasons.push("The betting line is missing");
  }
  if (!Number.isFinite(candidate.modelScore) || !Number.isFinite(candidate.trendScore)) {
    candidate.protectionReasons.push("A required selector score is invalid");
  }
}

function aiCandidateFromBestPlay(
  play: Play,
  slateRows: SheetRow[],
  today: string,
): AiSelectorCandidate | null {
  const identity = aiBestPlayIdentity(play, aiSlateRowForPlay(play, slateRows));
  if (!identity.market) return null;
  const slateRow = aiSlateRowForPlay(play, slateRows);
  const awayTeam = play.awayTeam || slateRow?.["Away Team"] || "";
  const homeTeam = play.homeTeam || slateRow?.["Home Team"] || "";
  const gameKey = slateRow ? draftKingsGameKey(slateRow) : `${isoPublicDate(today)}|${normalizeTeam(awayTeam)}|${normalizeTeam(homeTeam)}`;
  const modelScore = parseScore(play.score);
  const baselineProbability = aiBestProbability(play);
  const odds = oddsFromLineCell(play.oddsLine || play.altOdds || "");
  const candidateId = aiCandidateId(today, gameKey, identity.market, identity.selection, identity.line);
  return {
    candidateId,
    date: isoPublicDate(today),
    gameKey,
    gameTime: aiGameTime(slateRow),
    game: play.game || `${awayTeam} at ${homeTeam}`,
    awayTeam,
    homeTeam,
    market: identity.market,
    play: identity.playLabel,
    selection: identity.selection,
    line: identity.line,
    odds,
    source: "Best Play",
    bestPlayType: aiCanonicalBestPlayType(play.playType),
    trendTier: "",
    modelScore,
    trendScore: 0,
    aiScore: modelScore,
    estimatedProbability: baselineProbability,
    marketImpliedProbability: aiImpliedProbability(odds),
    estimatedAdvantage: 0,
    selected: false,
    protectionStatus: "PASSED",
    rejectionReason: "",
    confidenceReason: [],
    whySelected: ["Qualified as a Best Play"],
    historicalNotes: [],
    risks: [],
    researchSummary: "",
    verdict: "",
    dataStatus: [],
    externalReviewStatus: process.env.OPENAI_API_KEY ? "PENDING_FINAL_REVIEW" : "NOT_CONFIGURED",
    snapshotStatus: "LIVE",
    lockedAt: "",
    updatedAt: nowET(),
    result: "",
    units: 0,
    resultUpdated: "",
    selectorVersion: AI_PICK_SELECTOR_VERSION,
    slateRow,
    bestPlay: play,
    trendPlay: null,
    baselineProbability,
    scoreAdjustment: 0,
    probabilityAdjustment: 0,
    protectionReasons: [],
  };
}

function aiMergeTrendCandidate(
  candidateMap: Map<string, AiSelectorCandidate>,
  play: TrendPlay,
  slateRows: SheetRow[],
  today: string,
) {
  if (play.tier === "Pass") return;
  const slateRow = slateRows.find(
    (row) =>
      normalizeTeam(row["Away Team"] || "") === normalizeTeam(play.awayTeam) &&
      normalizeTeam(row["Home Team"] || "") === normalizeTeam(play.homeTeam),
  ) || null;
  const gameKey = slateRow ? draftKingsGameKey(slateRow) : `${isoPublicDate(today)}|${normalizeTeam(play.awayTeam)}|${normalizeTeam(play.homeTeam)}`;
  const selection = play.market === "Moneyline" ? play.selectionTeam || teamFromSelection(play.selection) : play.side;
  const line = play.market === "Total" && play.line != null ? String(play.line) : "";
  const id = aiCandidateId(today, gameKey, play.market, selection, line);
  const trendProbability = aiTrendProbability(play);
  const existing = candidateMap.get(id);
  if (existing) {
    existing.source = "Best + Trend";
    existing.trendPlay = play;
    existing.trendTier = play.tier;
    existing.trendScore = Number(play.score || 0);
    existing.baselineProbability = aiClamp(
      existing.baselineProbability * 0.65 + trendProbability * 0.35 + 1.5,
      44,
      78,
    );
    existing.scoreAdjustment += 5;
    existing.whySelected.push(`Also qualified as a ${play.tier} Trend Play`);
    existing.whySelected.push("Model and trend systems agree");
    if (!existing.odds) existing.odds = play.odds || "";
    return;
  }
  const odds = play.odds || "";
  candidateMap.set(id, {
    candidateId: id,
    date: isoPublicDate(today),
    gameKey,
    gameTime: aiGameTime(slateRow) || play.recordGameTime || "",
    game: play.game,
    awayTeam: play.awayTeam,
    homeTeam: play.homeTeam,
    market: play.market,
    play: play.market === "Moneyline" ? `${selection} Moneyline` : `${play.side} ${line}`.trim(),
    selection,
    line,
    odds,
    source: "Trend Play",
    bestPlayType: "",
    trendTier: play.tier,
    modelScore: 0,
    trendScore: Number(play.score || 0),
    aiScore: Number(play.score || 0),
    estimatedProbability: trendProbability,
    marketImpliedProbability: aiImpliedProbability(odds),
    estimatedAdvantage: 0,
    selected: false,
    protectionStatus: "PASSED",
    rejectionReason: "",
    confidenceReason: [],
    whySelected: [`Qualified as a ${play.tier} Trend Play`],
    historicalNotes: [],
    risks: [],
    researchSummary: "",
    verdict: "",
    dataStatus: [],
    externalReviewStatus: process.env.OPENAI_API_KEY ? "PENDING_FINAL_REVIEW" : "NOT_CONFIGURED",
    snapshotStatus: "LIVE",
    lockedAt: "",
    updatedAt: nowET(),
    result: "",
    units: 0,
    resultUpdated: "",
    selectorVersion: AI_PICK_SELECTOR_VERSION,
    slateRow,
    bestPlay: null,
    trendPlay: play,
    baselineProbability: trendProbability,
    scoreAdjustment: 0,
    probabilityAdjustment: 0,
    protectionReasons: [],
  });
}

function buildAiSelectorCandidates(
  bestPlays: Play[],
  trendPlays: TrendPlay[],
  slateRows: SheetRow[],
  completedTrackerRows: SheetRow[],
  trackerRows: SheetRow[],
  draftKings: DraftKingsPayload,
  today: string,
) {
  const candidateMap = new Map<string, AiSelectorCandidate>();
  const completeBestPlays = [...bestPlays, ...aiPendingTotalBestPlays(trackerRows, today)];
  for (const play of completeBestPlays) {
    const candidate = aiCandidateFromBestPlay(play, slateRows, today);
    if (candidate) candidateMap.set(candidate.candidateId, candidate);
  }
  for (const play of trendPlays) aiMergeTrendCandidate(candidateMap, play, slateRows, today);

  for (const candidate of candidateMap.values()) {
    aiRecordAdjustments(candidate, completedTrackerRows);
    aiApplyMarketContext(candidate, draftKings);
    aiProtectionChecks(candidate);
  }
  return [...candidateMap.values()];
}


function sanitizeAiPublicText(value: unknown) {
  let text = String(value || "").trim();
  if (!text) return "";

  // Remove markdown links while preserving the readable label.
  text = text.replace(/\[([^\]]+)\]\((?:https?:\/\/|www\.)[^)]+\)/gi, "$1");
  // Remove OpenAI/web-search citation artifacts and naked URLs.
  text = text
    .replace(/\(?(?:https?:\/\/|www\.)[^\s)\]}]+[)\]}]?/gi, "")
    .replace(/\[?(?:https?:\/\/|www\.)[^\s\]]+\]?/gi, "")
    .replace(/\(?(?:[a-z0-9-]+\.)+(?:com|org|net|gov|edu|io|co|tv)(?:\/[^\s)]*)?\)?/gi, "")
    .replace(/\[(?:source|citation|web)\s*\d*\]/gi, "")
    .replace(/\s*\(\s*\)\s*/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();

  return text.replace(/^[•\-–—]+\s*/, "").trim();
}

function sanitizeAiPublicList(value: unknown, maxItems: number) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(sanitizeAiPublicText).filter(Boolean))].slice(0, maxItems);
}

function aiResponseOutputText(payload: any) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const pieces: string[] = [];
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && typeof content?.text === "string") {
        pieces.push(content.text);
      }
    }
  }
  return pieces.join("\n");
}

async function requestAiExternalReviews(candidates: AiSelectorCandidate[]): Promise<{
  reviews: Map<string, AiExternalReview>;
  status: AiPickExternalStatus;
}> {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey || !candidates.length) {
    return { reviews: new Map(), status: apiKey ? "NO_VERIFIED_CONTEXT" : "NOT_CONFIGURED" };
  }
  const model = String(process.env.EZPZ_AI_SELECTOR_MODEL || "gpt-5-mini").trim();
  const candidatePayload = candidates.map((candidate) => ({
    candidateId: candidate.candidateId,
    game: candidate.game,
    gameTime: candidate.gameTime,
    market: candidate.market,
    play: candidate.play,
    odds: candidate.odds,
    source: candidate.source,
    modelScore: candidate.modelScore,
    trendScore: candidate.trendScore,
    baselineProbability: aiRound(candidate.baselineProbability + candidate.probabilityAdjustment, 1),
    awayTeam: candidate.awayTeam,
    homeTeam: candidate.homeTeam,
    line: candidate.line,
    aiScoreBeforeResearch: aiRound((candidate.source === "Best + Trend" ? candidate.modelScore * 0.65 + candidate.trendScore * 0.35 : candidate.modelScore || candidate.trendScore) + candidate.scoreAdjustment, 1),
    estimatedAdvantageBeforeResearch: aiRound((candidate.baselineProbability + candidate.probabilityAdjustment) - (candidate.marketImpliedProbability || aiImpliedProbability(candidate.odds)), 1),
    existingWhy: candidate.whySelected,
    existingRisks: candidate.risks,
    modelGameContext: candidate.slateRow
      ? Object.fromEntries(
          Object.entries(candidate.slateRow)
            .filter(([key, value]) => {
              if (!String(value || "").trim()) return false;
              const k = key.toLowerCase();
              return (
                k.includes("pitcher") ||
                k.includes("starter") ||
                k.includes("bulk") ||
                k.includes("opener") ||
                k.includes("lineup") ||
                k.includes("batter") ||
                k.includes("hitter") ||
                k.includes("bullpen") ||
                k.includes("run") ||
                k.includes("moneyline") ||
                k.includes("total") ||
                k.includes("nrfi") ||
                k.includes("yrfi") ||
                k.includes("probability") ||
                k.includes("projection") ||
                k.includes("score") ||
                k.includes("reliability") ||
                k.includes("weather") ||
                k.includes("park") ||
                k.includes("umpire") ||
                k.includes("home") ||
                k.includes("away") ||
                k.includes("game") ||
                k.includes("date") ||
                k.includes("time") ||
                k.includes("injur") ||
                k.includes("scratch") ||
                k.includes("rest")
              );
            })
            .slice(0, 240),
        )
      : {},
  }));
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["reviews"],
    properties: {
      reviews: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "candidateId",
            "adjustment",
            "criticalConflict",
            "criticalConflictReason",
            "confidenceReason",
            "why",
            "historicalNotes",
            "risks",
            "researchSummary",
            "verdict",
            "contextSummary",
          ],
          properties: {
            candidateId: { type: "string" },
            adjustment: { type: "number", minimum: -6, maximum: 6 },
            criticalConflict: { type: "boolean" },
            criticalConflictReason: { type: "string" },
            confidenceReason: { type: "array", items: { type: "string" }, maxItems: 6 },
            why: { type: "array", items: { type: "string" }, maxItems: 8 },
            historicalNotes: { type: "array", items: { type: "string" }, maxItems: 5 },
            risks: { type: "array", items: { type: "string" }, maxItems: 3 },
            researchSummary: { type: "string" },
            verdict: { type: "string" },
            contextSummary: { type: "string" },
          },
        },
      },
    },
  };
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      store: false,
      tools: [
        {
          type: "web_search",
          search_context_size: "medium",
          user_location: {
            type: "approximate",
            country: "US",
            region: "Florida",
            timezone: "America/New_York",
          },
        },
      ],
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                "You are the final MLB research analyst for EZPZ AI Picks. Research only information verifiably available before each listed game starts. Analyze every candidate independently; every candidate that clears the quantitative qualification threshold may be published, so do not force only one pick per day or per game.

PLAYER-SPECIFIC REQUIREMENT: The public explanation must read like an MLB matchup report, not a generic betting summary. Begin with the actual probable or confirmed starting pitchers and the key players who directly affect the wager. For every game, research both starters when applicable. For a pitcher prop, center the report on that pitcher and the opposing projected lineup. For a moneyline or total, explain how both starters, the lineups, and the bullpens create the edge. For NRFI/YRFI, emphasize each starter's first-inning profile and the top-of-order hitters.

For each relevant starting pitcher, look for and use the strongest verified items available: (1) recent performance over the last 3-5 starts, including innings, earned runs, strikeouts, walks, pitch count, velocity or underlying contact indicators when reported; (2) career and recent history against the opponent, with innings or plate-appearance sample context; (3) meaningful batter-versus-pitcher history against likely hitters; (4) home/road and day/night splits, but only when the sample is large enough to matter; (5) handedness, pitch mix, and how that arsenal matches the projected lineup; (6) workload, rest, role, and expected leash. Do not merely say a pitcher has a good matchup—name the pitcher, opponent hitters or lineup traits, and the precise reason.

For hitters and lineups, identify specific projected batters who strengthen or weaken the play. Use platoon splits, recent form, pitch-type performance, strikeout/contact tendencies, and meaningful history against the starter. For totals and first-inning wagers, explain which portion of each batting order is most important. For moneylines, explain where the selected team's offensive advantage comes from.

The WHY section should contain 4-7 concise but detailed bullets. At least three bullets must be player-specific whenever verified information exists. One bullet should discuss recent pitcher form, one should discuss opponent or batter history, and one should discuss a relevant split such as day/night or home/road when meaningful. If a requested split or matchup history is unavailable or too small, omit it rather than replacing it with generic filler. Historical notes must state the sample size or clearly describe the sample.

The confidence explanation must say why the candidate cleared the AI threshold relative to the other candidates using supplied scores and concrete matchup evidence. Do not claim it ranked first unless the supplied numbers support that. Risks must be limited to genuine material concerns; return an empty risks array when none are significant.

Use the supplied modelGameContext first to identify the actual starters, projected lineups, bullpen scores, model projections, and saved assumptions, then verify and deepen those facts through research. Prioritize official MLB data and reliable pregame reporting. Do not use generic schedule-strength statements, broad season scoring claims, or park/weather filler unless they directly affect the wager. Never use a final score, in-game information, unsupported rumors, or hindsight. Do not invent statistics.

Do not include URLs, markdown links, citations, domains, publication names, source labels, bracketed source markers, or phrases such as according to. Never repeat a source URL even if the search tool provides one. The public card should contain only clean analyzed information. Return only small evidence-based score adjustments from -6 to +6; use 0 when research does not change the quantitative case. A critical conflict is reserved for evidence that materially invalidates a saved pregame assumption, such as a scratched starter or changed role.",
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Current Eastern time: ${nowET()}\nReview these candidates:\n${JSON.stringify(candidatePayload)}`,
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "ezpz_ai_selector_reviews",
          strict: true,
          schema,
        },
      },
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI selector review failed (${response.status}): ${detail.slice(0, 300)}`);
  }
  const payload = await response.json();
  const raw = aiResponseOutputText(payload);
  if (!raw) return { reviews: new Map(), status: "NO_VERIFIED_CONTEXT" };
  const parsed = JSON.parse(raw) as { reviews?: AiExternalReview[] };
  const reviews = new Map<string, AiExternalReview>();
  for (const review of parsed.reviews || []) {
    if (!review?.candidateId) continue;
    reviews.set(review.candidateId, {
      ...review,
      adjustment: aiClamp(Number(review.adjustment || 0), -6, 6),
      confidenceReason: sanitizeAiPublicList(review.confidenceReason, 6),
      why: sanitizeAiPublicList(review.why, 8),
      historicalNotes: sanitizeAiPublicList(review.historicalNotes, 5),
      risks: sanitizeAiPublicList(review.risks, 3),
      researchSummary: sanitizeAiPublicText(review.researchSummary),
      verdict: sanitizeAiPublicText(review.verdict),
      contextSummary: sanitizeAiPublicText(review.contextSummary),
    });
  }
  return {
    reviews,
    status: reviews.size ? "WEB_REVIEWED" : "NO_VERIFIED_CONTEXT",
  };
}

function finalizeAiCandidates(
  candidates: AiSelectorCandidate[],
  externalReviews: Map<string, AiExternalReview>,
  externalStatus: AiPickExternalStatus,
  snapshotStatus: AiPickSnapshotStatus,
) {
  const finalized = candidates.map((candidate) => {
    const review = externalReviews.get(candidate.candidateId);
    if (review) {
      candidate.scoreAdjustment += review.adjustment * 1.4;
      candidate.probabilityAdjustment += review.adjustment * 0.55;
      candidate.confidenceReason.push(...review.confidenceReason);
      candidate.whySelected.push(...review.why);
      candidate.historicalNotes.push(...review.historicalNotes);
      candidate.risks.push(...review.risks);
      candidate.researchSummary = review.researchSummary || candidate.researchSummary;
      candidate.verdict = review.verdict || candidate.verdict;
      if (review.contextSummary) candidate.dataStatus.push(`External context: ${review.contextSummary}`);
      if (review.criticalConflict) {
        candidate.protectionReasons.push(
          review.criticalConflictReason || "Verified external context invalidated a saved assumption",
        );
      }
    }
    const baseScore = candidate.source === "Best + Trend"
      ? candidate.modelScore * 0.65 + candidate.trendScore * 0.35
      : candidate.modelScore || candidate.trendScore;
    const aiScore = clampScore(baseScore + candidate.scoreAdjustment);
    const estimatedProbability = aiRound(
      aiClamp(candidate.baselineProbability + candidate.probabilityAdjustment, 40, 82),
      1,
    );
    const implied = candidate.marketImpliedProbability || aiImpliedProbability(candidate.odds);
    const advantage = implied ? aiRound(estimatedProbability - implied, 1) : 0;
    const blocked = candidate.protectionReasons.length > 0;
    const thresholdFailure =
      aiScore < 74
        ? `AI score ${aiScore} did not reach the 74 selection threshold`
        : estimatedProbability < 55
          ? `Estimated probability ${estimatedProbability.toFixed(1)}% did not reach 55%`
          : implied && advantage < 1.5
            ? `Estimated advantage ${advantage.toFixed(1)}% did not reach 1.5%`
            : "";
    const preliminarySelected = !blocked && !thresholdFailure;
    const rejectionReason = blocked
      ? candidate.protectionReasons.join(" • ")
      : thresholdFailure;
    return {
      ...candidate,
      aiScore,
      estimatedProbability,
      marketImpliedProbability: implied,
      estimatedAdvantage: advantage,
      selected: preliminarySelected,
      protectionStatus: blocked ? "BLOCKED" as const : "PASSED" as const,
      rejectionReason,
      confidenceReason: sanitizeAiPublicList(candidate.confidenceReason, 6),
      whySelected: sanitizeAiPublicList(candidate.whySelected, 10),
      historicalNotes: sanitizeAiPublicList(candidate.historicalNotes, 5),
      risks: sanitizeAiPublicList(candidate.risks, 3),
      researchSummary: sanitizeAiPublicText(candidate.researchSummary),
      verdict: sanitizeAiPublicText(candidate.verdict),
      dataStatus: [...new Set(candidate.dataStatus.filter(Boolean))].slice(0, 5),
      externalReviewStatus: review ? "WEB_REVIEWED" as const : externalStatus,
      snapshotStatus,
      lockedAt: snapshotStatus === "FINAL_PREGAME" ? nowET() : "",
      updatedAt: nowET(),
    };
  });

  // Every independently qualified candidate remains eligible for publication.
  // Multiple AI picks may come from the same game when each clears all thresholds.
  return finalized.map(({ slateRow, bestPlay, trendPlay, baselineProbability, scoreAdjustment, probabilityAdjustment, protectionReasons, ...pick }) => pick as AiPick);
}

function aiPickRow(pick: AiPick): SheetRow {
  return {
    "Date": pick.date,
    "Candidate ID": pick.candidateId,
    "Game Key": pick.gameKey,
    "Game Time": pick.gameTime,
    "Game": pick.game,
    "Away Team": pick.awayTeam,
    "Home Team": pick.homeTeam,
    "Market": pick.market,
    "Play": pick.play,
    "Selection": pick.selection,
    "Line": pick.line,
    "Odds": pick.odds,
    "Source": pick.source,
    "Best Play Type": pick.bestPlayType,
    "Trend Tier": pick.trendTier,
    "Model Score": String(pick.modelScore),
    "Trend Score": String(pick.trendScore),
    "AI Score": String(pick.aiScore),
    "Estimated Probability": String(pick.estimatedProbability),
    "Market Implied Probability": String(pick.marketImpliedProbability),
    "Estimated Advantage": String(pick.estimatedAdvantage),
    "Selected": pick.selected ? "TRUE" : "FALSE",
    "Protection Status": pick.protectionStatus,
    "Rejection Reason": pick.rejectionReason,
    "AI Confidence Reason": pick.confidenceReason.join(" | "),
    "Why Selected": pick.whySelected.join(" | "),
    "Historical Matchup Notes": pick.historicalNotes.join(" | "),
    "Risks": pick.risks.join(" | "),
    "AI Research Summary": pick.researchSummary,
    "AI Verdict": pick.verdict,
    "Data Status": pick.dataStatus.join(" | "),
    "External Review Status": pick.externalReviewStatus,
    "Snapshot Status": pick.snapshotStatus,
    "Locked At": pick.lockedAt,
    "Updated At": pick.updatedAt,
    "Result": pick.result,
    "Units": String(pick.units),
    "Result Updated": pick.resultUpdated,
    "Selector Version": pick.selectorVersion,
    "Details JSON": JSON.stringify(pick),
  };
}

function parseAiPickRow(row: SheetRow): AiPick | null {
  const raw = String(row["Details JSON"] || "").trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as AiPick;
      if (parsed?.candidateId && parsed?.date) {
        return {
          ...parsed,
          confidenceReason: sanitizeAiPublicList(parsed.confidenceReason, 6),
          whySelected: sanitizeAiPublicList(parsed.whySelected, 10),
          historicalNotes: sanitizeAiPublicList(parsed.historicalNotes, 5),
          risks: sanitizeAiPublicList(parsed.risks, 3),
          researchSummary: sanitizeAiPublicText(parsed.researchSummary),
          verdict: sanitizeAiPublicText(parsed.verdict),
        };
      }
    } catch {
      // Fall through to column parsing for repairability.
    }
  }
  const candidateId = String(row["Candidate ID"] || "").trim();
  if (!candidateId) return null;
  return {
    candidateId,
    date: isoPublicDate(row.Date || ""),
    gameKey: String(row["Game Key"] || ""),
    gameTime: String(row["Game Time"] || ""),
    game: String(row.Game || ""),
    awayTeam: String(row["Away Team"] || ""),
    homeTeam: String(row["Home Team"] || ""),
    market: String(row.Market || "Moneyline") as AiPickMarket,
    play: String(row.Play || ""),
    selection: String(row.Selection || ""),
    line: String(row.Line || ""),
    odds: String(row.Odds || ""),
    source: String(row.Source || "Best Play") as AiPickSource,
    bestPlayType: String(row["Best Play Type"] || ""),
    trendTier: String(row["Trend Tier"] || ""),
    modelScore: toNumber(row["Model Score"]),
    trendScore: toNumber(row["Trend Score"]),
    aiScore: toNumber(row["AI Score"]),
    estimatedProbability: toNumber(row["Estimated Probability"]),
    marketImpliedProbability: toNumber(row["Market Implied Probability"]),
    estimatedAdvantage: toNumber(row["Estimated Advantage"]),
    selected: truthyValue(row.Selected),
    protectionStatus: String(row["Protection Status"] || "PASSED") === "BLOCKED" ? "BLOCKED" : "PASSED",
    rejectionReason: String(row["Rejection Reason"] || ""),
    confidenceReason: sanitizeAiPublicList(String(row["AI Confidence Reason"] || "").split("|"), 6),
    whySelected: sanitizeAiPublicList(String(row["Why Selected"] || "").split("|"), 10),
    historicalNotes: sanitizeAiPublicList(String(row["Historical Matchup Notes"] || "").split("|"), 5),
    risks: sanitizeAiPublicList(String(row.Risks || "").split("|"), 3),
    researchSummary: sanitizeAiPublicText(row["AI Research Summary"]),
    verdict: sanitizeAiPublicText(row["AI Verdict"]),
    dataStatus: String(row["Data Status"] || "").split("|").map((item) => item.trim()).filter(Boolean),
    externalReviewStatus: String(row["External Review Status"] || "NOT_CONFIGURED") as AiPickExternalStatus,
    snapshotStatus: String(row["Snapshot Status"] || "FINAL_PREGAME") === "LIVE" ? "LIVE" : "FINAL_PREGAME",
    lockedAt: String(row["Locked At"] || ""),
    updatedAt: String(row["Updated At"] || ""),
    result: resultCode(row.Result),
    units: toNumber(row.Units),
    resultUpdated: String(row["Result Updated"] || ""),
    selectorVersion: String(row["Selector Version"] || AI_PICK_SELECTOR_VERSION),
  };
}

async function persistAiPickRows(existingRows: SheetRow[], finalPicks: AiPick[]) {
  if (!finalPicks.length) return;
  const map = new Map<string, SheetRow>();
  for (const row of existingRows) {
    const key = `${isoPublicDate(row.Date || "")}|${String(row["Candidate ID"] || "")}`;
    if (key !== "|") map.set(key, row);
  }
  for (const pick of finalPicks) {
    const key = `${pick.date}|${pick.candidateId}`;
    const existing = map.get(key);
    const parsed = existing ? parseAiPickRow(existing) : null;
    if (parsed?.snapshotStatus === "FINAL_PREGAME") continue;
    map.set(key, aiPickRow(pick));
  }
  const { spreadsheetId, sheets } = mainSheetsClient();
  await writeWholeWorksheet(
    sheets,
    spreadsheetId,
    AI_PICK_SELECTOR_TAB,
    AI_PICK_SELECTOR_HEADERS,
    [...map.values()],
  );
}

function aiPickTrackerMatch(pick: AiPick, trackerRows: SheetRow[]) {
  const date = isoPublicDate(pick.date);
  return trackerRows.find((row) => {
    if (isoPublicDate(row.Date || "") !== date) return false;
    const slateGame = textKey(row.Game || "");
    if (slateGame && textKey(pick.game) && slateGame !== textKey(pick.game)) return false;
    const market = trackerMarket(row);
    if (pick.market === "Moneyline") {
      return market === "Moneyline" && normalizeTeam(teamFromSelection(row.Selection || row.Team || "")) === normalizeTeam(pick.selection);
    }
    if (pick.market === "Total") {
      return market === "Total" && trackerTotalSide(row) === pick.selection;
    }
    const type = normalizeType(row["Bet Type"] || row.Market || "");
    if (pick.market === "First Inning") {
      return type.includes(pick.selection);
    }
    if (!String(row.Market || "").toLowerCase().includes("pitcher strikeout") && !isPitcherKType(type)) return false;
    const pitcher = textKey(pick.selection.split("|")[0]);
    const rowText = textKey([row.Selection, row.Team, row.Play, row.Pitcher].join(" "));
    return Boolean(pitcher && rowText.includes(pitcher));
  }) || null;
}

function overlayAiPickResults(
  picks: AiPick[],
  trackerRows: SheetRow[],
  allGameTrendRows: SheetRow[],
) {
  return picks.map((pick) => {
    if (pick.result) return pick;
    let source: SheetRow | null = aiPickTrackerMatch(pick, trackerRows);
    if (!source && (pick.market === "Moneyline" || pick.market === "Total")) {
      source = allGameTrendRows.find((row) => {
        if (isoPublicDate(row.Date || "") !== pick.date) return false;
        if (String(row["Game Key"] || "") && String(row["Game Key"] || "") !== String(pick.gameKey.split("|")[1] || pick.gameKey)) {
          const sameTeams =
            normalizeTeam(row["Away Team"] || "") === normalizeTeam(pick.awayTeam) &&
            normalizeTeam(row["Home Team"] || "") === normalizeTeam(pick.homeTeam);
          if (!sameTeams) return false;
        }
        if (trackerMarket(row) !== pick.market) return false;
        return pick.market === "Moneyline"
          ? normalizeTeam(teamFromSelection(row.Selection || "")) === normalizeTeam(pick.selection)
          : trackerTotalSide(row) === pick.selection;
      }) || null;
    }
    const result = source ? resultCode(source.Result) : "";
    if (!result) return pick;
    const odds = parseAmericanOdds(pick.odds);
    const units = result === "P" ? 0 : result === "L" ? -1 : odds > 0 ? odds / 100 : odds < 0 ? 100 / Math.abs(odds) : 1;
    return {
      ...pick,
      result,
      units: aiRound(units, 2),
      resultUpdated: String(source?.["Result Updated"] || source?.["Graded At"] || nowET()),
    };
  });
}

function aiSortByGameTime(a: AiPick, b: AiPick) {
  const aTime = a.gameTime ? new Date(a.gameTime).getTime() : Number.POSITIVE_INFINITY;
  const bTime = b.gameTime ? new Date(b.gameTime).getTime() : Number.POSITIVE_INFINITY;
  if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return aTime - bTime;
  if (b.estimatedProbability !== a.estimatedProbability) return b.estimatedProbability - a.estimatedProbability;
  return a.play.localeCompare(b.play);
}

async function buildAiPickSelector(args: {
  today: string;
  bestPlays: Play[];
  trendPlays: TrendPlay[];
  slateRows: SheetRow[];
  completedTrackerRows: SheetRow[];
  trackerRows: SheetRow[];
  allGameTrendRows: SheetRow[];
  draftKings: DraftKingsPayload;
  storedRows: SheetRow[];
  captureMode: SnapshotCaptureMode;
}) {
  const {
    today,
    bestPlays,
    trendPlays,
    slateRows,
    completedTrackerRows,
    trackerRows,
    allGameTrendRows,
    draftKings,
    storedRows,
    captureMode,
  } = args;
  const candidates = buildAiSelectorCandidates(
    bestPlays,
    trendPlays,
    slateRows,
    completedTrackerRows,
    trackerRows,
    draftKings,
    today,
  );
  let workingStoredRows = storedRows;
  const stored = workingStoredRows.map(parseAiPickRow).filter((pick): pick is AiPick => Boolean(pick));
  const storedToday = stored.filter((pick) => pick.date === isoPublicDate(today));
  const lockedGameKeys = new Set(storedToday.filter((pick) => pick.snapshotStatus === "FINAL_PREGAME").map((pick) => pick.gameKey));
  const captureRequested = captureMode !== "live";
  const targetGameKeys = new Set(
    slateRows
      .filter((row) =>
        captureRequested &&
        (isFifteenMinuteTrackingWindow(row) || slateHasFinalPregameSnapshot(row)),
      )
      .map((row) => draftKingsGameKey(row))
      .filter((key) => !lockedGameKeys.has(key)),
  );
  const targetCandidates = candidates.filter((candidate) => targetGameKeys.has(candidate.gameKey));

  let externalReviews = new Map<string, AiExternalReview>();
  let externalStatus: AiPickExternalStatus = process.env.OPENAI_API_KEY
    ? "PENDING_FINAL_REVIEW"
    : "NOT_CONFIGURED";
  if (targetCandidates.length) {
    try {
      const external = await requestAiExternalReviews(targetCandidates);
      externalReviews = external.reviews;
      externalStatus = external.status;
    } catch (error) {
      externalStatus = "REVIEW_ERROR";
      for (const candidate of targetCandidates) {
        candidate.risks.push(
          `External context review failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const finalTargetPicks = finalizeAiCandidates(
      targetCandidates,
      externalReviews,
      externalStatus,
      "FINAL_PREGAME",
    );
    await persistAiPickRows(storedRows, finalTargetPicks);
    const finalRows = finalTargetPicks.map(aiPickRow);
    workingStoredRows = [
      ...workingStoredRows.filter((row) => !targetGameKeys.has(parseAiPickRow(row)?.gameKey || "")),
      ...finalRows,
    ];
  }

  const refreshedStored = workingStoredRows.map(parseAiPickRow).filter((pick): pick is AiPick => Boolean(pick));
  const refreshedToday = refreshedStored.filter((pick) => pick.date === isoPublicDate(today));
  const refreshedLockedKeys = new Set(refreshedToday.map((pick) => pick.gameKey));
  const liveCandidates = candidates.filter((candidate) => !refreshedLockedKeys.has(candidate.gameKey));
  const livePicks = finalizeAiCandidates(
    liveCandidates,
    new Map(),
    process.env.OPENAI_API_KEY ? "PENDING_FINAL_REVIEW" : "NOT_CONFIGURED",
    "LIVE",
  );
  const todayCombined = [
    ...refreshedToday,
    ...livePicks,
  ];
  const withResults = overlayAiPickResults(refreshedStored, trackerRows, allGameTrendRows);
  const selectedToday = todayCombined.filter((pick) => pick.selected).sort(aiSortByGameTime);
  const finalCount = selectedToday.filter((pick) => pick.snapshotStatus === "FINAL_PREGAME").length;
  const status: AiSelectorStatus = {
    mode: finalCount && finalCount === selectedToday.length ? "FINAL_PREGAME" : "LIVE_PREVIEW",
    externalResearchConfigured: Boolean(process.env.OPENAI_API_KEY),
    message: selectedToday.length
      ? finalCount
        ? `${finalCount} selection${finalCount === 1 ? "" : "s"} locked at final pregame review`
        : "Live selector preview; external context is reviewed and locked with the final pregame snapshot"
      : "No candidate currently passes every EZPZ AI selection and protection rule",
    updatedAt: nowET(),
    candidateCount: todayCombined.length,
    selectedCount: selectedToday.length,
  };
  return {
    picks: selectedToday,
    recordRows: withResults,
    status,
  };
}

function emptyUfcData(): UfcData {
  return {
    bestPlays: [],
    predictions: [],
    records: [],
    tiles: {
      bestPlaysToday: 0,
      overall: { ...EMPTY_TOTALS, label: "UFC Moneyline - Running Total" },
      last7: { ...EMPTY_TOTALS, label: "UFC Moneyline - Last 7 Days" },
      handpickedOverall: { ...EMPTY_TOTALS, label: "UFC Handpicked - Running Total" },
      handpickedLast7: { ...EMPTY_TOTALS, label: "UFC Handpicked - Last 7 Days" },
      pending: 0,
    },
  };
}

function serviceAccountFromEnv() {
  const rawJson =
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    process.env.GCP_SERVICE_ACCOUNT_JSON ||
    process.env.GOOGLE_CREDENTIALS;
  if (rawJson) {
    const parsed = JSON.parse(rawJson);
    return {
      clientEmail: parsed.client_email,
      privateKey: String(parsed.private_key || "").replace(/\\n/g, "\n"),
    };
  }

  return {
    clientEmail:
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
      process.env.GOOGLE_CLIENT_EMAIL ||
      process.env.GCP_SERVICE_ACCOUNT_EMAIL,
    privateKey: String(
      process.env.GOOGLE_PRIVATE_KEY || process.env.PRIVATE_KEY || "",
    ).replace(/\\n/g, "\n"),
  };
}

async function readWorksheetBySpreadsheetId(
  spreadsheetId: string,
  tabName: string,
): Promise<SheetRow[]> {
  const { clientEmail, privateKey } = serviceAccountFromEnv();
  if (!clientEmail || !privateKey) {
    throw new Error(
      "Missing Google service account env vars for UFC spreadsheet access.",
    );
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'!A:Z`,
  });

  const values = result.data.values || [];
  if (values.length < 2) return [];

  const headers = values[0].map((header: unknown) => String(header || "").trim());
  return values.slice(1).map((row: unknown[]) => {
    const obj: SheetRow = {};
    headers.forEach((header: string, index: number) => {
      if (header) obj[header] = String(row[index] ?? "");
    });
    return obj;
  });
}

async function readUfcWorksheet(tabName: string): Promise<SheetRow[]> {
  const ufcSpreadsheetId =
    process.env.UFC_GOOGLE_SHEET_ID || process.env.UFC_SPREADSHEET_ID;
  if (ufcSpreadsheetId)
    return readWorksheetBySpreadsheetId(ufcSpreadsheetId, tabName);

  // Fallback: useful if you later move UFC tabs into the same public spreadsheet.
  return readWorksheet(tabName);
}

function ufcRowDate(row: SheetRow) {
  return normalizeDate(row["Date"] || row["date"] || "");
}

function ufcUnitsFromRow(row: SheetRow) {
  const directUnits = String(row["Units"] || "").trim();
  if (directUnits) return toNumber(directUnits);
  const result = String(row["Result"] || "")
    .trim()
    .toUpperCase();
  const odds = parseAmericanOdds(row["Odds"] || row["Odds/Line"] || "");

  if (result.includes("PUSH") || result === "P") return 0;
  if (result.includes("LOSS") || result === "L") return -1;
  if (!(result.includes("WIN") || result === "W")) return 0;

  if (odds > 0) return odds / 100;
  if (odds < 0) return 100 / Math.abs(odds);
  return 1;
}

function buildUfcTotals(label: string, rows: SheetRow[]): RecordTotals {
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let unitsWon = 0;

  rows.forEach((row) => {
    const result = String(row["Result"] || "")
      .trim()
      .toUpperCase();
    if (result.includes("WIN") || result === "W") wins += 1;
    else if (result.includes("LOSS") || result === "L") losses += 1;
    else if (result.includes("PUSH") || result === "P") pushes += 1;
    else return;

    unitsWon += ufcUnitsFromRow(row);
  });

  const totalBets = wins + losses + pushes;
  const decisions = wins + losses;
  const winPct = decisions ? round1((wins / decisions) * 100) : 0;
  const roiPct = totalBets ? round1((unitsWon / totalBets) * 100) : 0;

  return {
    label,
    record: `${wins}-${losses}-${pushes}`,
    totalBets,
    winPct,
    unitsWon: round1(unitsWon),
    roiPct,
    wins,
    losses,
    pushes,
  };
}

function normalizeUfcRecordRows(rows: SheetRow[]): UfcRecordRow[] {
  return rows.map((row) => ({
    Category: row["Category"] || "",
    Period: row["Period"] || "",
    Bets: row["Bets"] || 0,
    Wins: row["Wins"] || 0,
    Losses: row["Losses"] || 0,
    Pushes: row["Pushes"] || 0,
    "Win %": row["Win %"] || "0.0%",
    Units: row["Units"] || 0,
    "ROI %": row["ROI %"] || "0.0%",
  }));
}


function ufcFavoritePickValue(row: SheetRow) {
  return row["Favorite Pick"] || row["favorite pick"] || row["Favorite"] || "";
}

function ufcHandpickedRecordValue(row: SheetRow) {
  return (
    row["Handpicked Record"] ||
    row["handpicked record"] ||
    row["Was Handpicked"] ||
    row["Handpicked"] ||
    row["Favorite Pick"] ||
    ""
  );
}

async function buildUfcData(today: string): Promise<UfcData> {
  try {
    const [bestRaw, predictionsRaw, trackerRaw, recordsRaw] = await Promise.all(
      [
        readUfcWorksheet("ufc_best_plays"),
        readUfcWorksheet("ufc_predictions"),
        readUfcWorksheet("ufc_bet_tracker"),
        readUfcWorksheet("ufc_records"),
      ],
    );

    const bestPlays = bestRaw.filter((row) => ufcRowDate(row) === today);
    const predictions = predictionsRaw.filter(
      (row) => ufcRowDate(row) === today,
    );
    const trackerRows: SheetRow[] = trackerRaw.map((row): SheetRow => ({
      ...(row as SheetRow),
      Date: ufcRowDate(row),
    }));
    const completed = trackerRows.filter((row) =>
      isCompletedResult(row["Result"]),
    );
    const handpickedCompleted = completed.filter((row) =>
      isTrueValue(ufcHandpickedRecordValue(row)),
    );
    const last7 = rowsFromLast7Days(completed);
    const handpickedLast7 = rowsFromLast7Days(handpickedCompleted);
    const pending = trackerRows.filter((row) => {
      const result = String(row["Result"] || "")
        .trim()
        .toUpperCase();
      return !result || result === "PENDING";
    }).length;

    return {
      bestPlays,
      predictions,
      records: normalizeUfcRecordRows(recordsRaw),
      tiles: {
        bestPlaysToday: bestPlays.length,
        overall: buildUfcTotals("UFC Moneyline - Running Total", completed),
        last7: buildUfcTotals("UFC Moneyline - Last 7 Days", last7),
        handpickedOverall: buildUfcTotals("UFC Handpicked - Running Total", handpickedCompleted),
        handpickedLast7: buildUfcTotals("UFC Handpicked - Last 7 Days", handpickedLast7),
        pending,
      },
    };
  } catch (error) {
    console.error("UFC public data failed", error);
    return emptyUfcData();
  }
}

async function buildUncachedPublicResponse(request: NextRequest) {
  try {
    const today = todayET();
    const trackingCapture =
      request.headers.get("x-ezpz-background-snapshot") === "true" ||
      request.nextUrl.searchParams.get("tracking") === "15m";
    const scheduledCapture =
      request.headers.get("x-ezpz-scheduled-snapshot") === "true" ||
      request.nextUrl.searchParams.get("scheduled") === "1";
    const captureMode: SnapshotCaptureMode =
      trackingCapture && scheduledCapture
        ? "scheduled_tracking"
        : trackingCapture
          ? "tracking"
          : scheduledCapture
            ? "scheduled"
            : "live";
    const [slateTodayRaw, trackerRaw, liveDraftKings, savedPublicSplits, storedAiPickRows] = await Promise.all([
      readWorksheet("daily_slate"),
      readWorksheet("bet_tracker"),
      loadDraftKingsData(),
      safeReadPublicSplitRows(),
      safeReadAiPickRows(),
    ]);
    const savedDraftKings = snapshotPayloadFromRows(savedPublicSplits, today);
    const finalSnapshotDraftKings = snapshotPayloadFromRows(
      savedPublicSplits.filter(isFifteenMinuteTrackingSnapshot),
      today,
    );
    const draftKings = mergeDraftKingsPayload(liveDraftKings, savedDraftKings);
    const persistence = await persistFinalPregameDraftKings(
      draftKings,
      today,
      captureMode,
    );
    draftKings.persistence = persistence;
    if (persistence.status === "ERROR" && persistence.error) {
      draftKings.errors = [...draftKings.errors, `Pregame persistence: ${persistence.error}`];
    }

    await syncAllGameTrendResults(today);
    const allGameTrendRaw = await safeReadAllGameTrendRows();

    const slateToday = slateTodayRaw.filter(
      (row: SheetRow) => normalizeDate(row["Date"]) === today,
    );
    const publicDraftKings = publicDisplayDraftKingsPayload(
      draftKings,
      finalSnapshotDraftKings,
      slateTodayRaw as SheetRow[],
    );
    const trackerRows: SheetRow[] = (trackerRaw as SheetRow[]).map(
      (row: SheetRow): SheetRow => ({
        ...row,
        Date: normalizeDate(
          row["Date"] || row["date"] || row["Bet Date"] || "",
        ),
      }),
    );
    const completedTrackerRows = trackerRows.filter((row) =>
      isCompletedResult(row["Result"]),
    );
    const qualifiedTrackerRows = completedTrackerRows.filter((row) =>
      isGreenType(row["Bet Type"] || row["Market"]),
    );
    const handpickedCompletedRows = completedTrackerRows.filter((row) =>
      isTrueValue(handpickedRecordValue(row)),
    );
    const last7QualifiedRows = rowsFromLast7Days(qualifiedTrackerRows);
    const last7HandpickedRows = rowsFromLast7Days(handpickedCompletedRows);

    const allGameTrendRows: SheetRow[] = allGameTrendRaw.map((row): SheetRow => ({
      ...row,
      Date: normalizeDate(row.Date || ""),
    }));
    const completedAllGameTrendRows = allGameTrendRows.filter((row) =>
      isCompletedResult(row.Result),
    );
    const trendSourceRows = [...completedAllGameTrendRows];
    const trendSourceKeys = new Set(
      trendSourceRows.map((row) => draftKingsSignalSourceKey(row)),
    );
    // Preserve pre-update qualified history from bet_tracker without duplicating
    // any game/market already represented by the new all_game_trends table.
    for (const row of completedTrackerRows) {
      const market = trackerMarket(row);
      if (!market) continue;
      const key = draftKingsSignalSourceKey(row);
      if (trendSourceKeys.has(key)) continue;
      trendSourceRows.push(row);
      trendSourceKeys.add(key);
    }
    const draftKingsSignalRows = buildDraftKingsSignalRows(
      trendSourceRows,
      slateTodayRaw as SheetRow[],
      savedPublicSplits,
    );
    const authoritativeFrozenTrendPlays = frozenTrendPlaysFromRows(
      allGameTrendRows,
    );
    const trendRecordRows = buildTrendRecordRows(
      completedAllGameTrendRows,
      authoritativeFrozenTrendPlays,
      slateTodayRaw as SheetRow[],
      savedPublicSplits,
    );
    const liveTrendPlays = buildTrendPlays(
      publicDraftKings.splits,
      draftKingsSignalRows,
      slateToday,
      today,
      publicDraftKings.updatedAt,
    );
    const frozenTrendPlays = authoritativeFrozenTrendPlays.filter(
      (play) => isoPublicDate(play.recordDate || "") === isoPublicDate(today),
    );
    const trendPlays = overlayFrozenTrendPlays(
      liveTrendPlays,
      frozenTrendPlays,
      slateToday,
    );
    const pendingGreen = trackerRows.filter((row) => {
      const result = String(row["Result"] || "").trim();
      return (
        (!result || result.toUpperCase() === "PENDING") &&
        isGreenType(row["Bet Type"] || row["Market"])
      );
    }).length;

    const bestPlays = buildBestPlaysFromSlate(
      slateTodayRaw,
      today,
      trackerRows,
    );
    const aiSelector = await buildAiPickSelector({
      today,
      bestPlays,
      trendPlays,
      slateRows: slateToday,
      completedTrackerRows,
      trackerRows,
      allGameTrendRows,
      draftKings: publicDraftKings,
      storedRows: storedAiPickRows,
      captureMode,
    });
    const ufc = await buildUfcData(today);

    return NextResponse.json({
      ok: true,
      today,
      lastUpdated: nowET(),
      draftKings: publicDraftKings,
      ufc,
      tiles: {
        last7Days: buildTotals(
          "Qualified Plays - Last 7 Days",
          last7QualifiedRows,
        ),
        overallGreen: buildTotals(
          "Qualified Plays - Running Total",
          qualifiedTrackerRows,
        ),
        handpickedLast7: buildTotals(
          "Handpicked Plays - Last 7 Days",
          last7HandpickedRows,
        ),
        handpickedOverall: buildTotals(
          "Handpicked Plays - Running Total",
          handpickedCompletedRows,
        ),
        pendingGreen,
        bestPlaysToday: bestPlays.length,
      },
      bestPlays,
      slateToday,
      betTrackerRows: trackerRows,
      draftKingsSignalRows,
      trendRecordRows,
      trendPlays,
      aiPicks: aiSelector.picks,
      aiPickRecordRows: aiSelector.recordRows,
      aiSelectorStatus: aiSelector.status,
      recordSummary: buildSummary(qualifiedTrackerRows),
      last7RecordSummary: buildSummary(last7QualifiedRows),
      handpickedRecordSummary: buildSummary(handpickedCompletedRows),
      handpickedLast7RecordSummary: buildSummary(last7HandpickedRows),
    }, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown public data error";
    return NextResponse.json(
      {
        ok: false,
        error: message,
        today: todayET(),
        lastUpdated: nowET(),
        draftKings: {
          ok: false,
          status: "UNAVAILABLE",
          updatedAt: draftKingsNowET(),
          stale: false,
          splits: [],
          props: [],
          errors: ["Public-data route failed before DraftKings could be returned."],
        },
        ufc: emptyUfcData(),
        tiles: {
          last7Days: EMPTY_TOTALS,
          overallGreen: EMPTY_TOTALS,
          handpickedLast7: EMPTY_TOTALS,
          handpickedOverall: EMPTY_TOTALS,
          pendingGreen: 0,
          bestPlaysToday: 0,
        },
        bestPlays: [],
        slateToday: [],
        draftKingsSignalRows: [],
        trendRecordRows: [],
        trendPlays: [],
        aiPicks: [],
        aiPickRecordRows: [],
        aiSelectorStatus: {
          mode: "LIVE_PREVIEW",
          externalResearchConfigured: Boolean(process.env.OPENAI_API_KEY),
          message: "EZPZ AI Pick Selector is unavailable until public data reloads successfully",
          updatedAt: nowET(),
          candidateCount: 0,
          selectedCount: 0,
        },
        recordSummary: [],
        last7RecordSummary: [],
        handpickedRecordSummary: [],
        handpickedLast7RecordSummary: [],
      },
      {
        status: 500,
        headers: { "Cache-Control": "no-store, max-age=0" },
      },
    );
  }
}

function isBackgroundSnapshotRequest(request: NextRequest) {
  return (
    request.headers.get("x-ezpz-background-snapshot") === "true" ||
    request.headers.get("x-ezpz-scheduled-snapshot") === "true" ||
    request.nextUrl.searchParams.get("tracking") === "15m" ||
    request.nextUrl.searchParams.get("scheduled") === "1"
  );
}

function publicResponseFromCache(
  cached: CachedPublicRouteResponse,
  stale = false,
) {
  return new NextResponse(cached.body, {
    status: cached.status,
    headers: {
      "Content-Type": cached.contentType,
      "Cache-Control": stale
        ? "public, s-maxage=15, stale-while-revalidate=300"
        : "public, s-maxage=45, stale-while-revalidate=300",
      ...(stale
        ? {
            "X-EZPZ-Stale-Data": "true",
            Warning: '110 - "Response is stale while Google Sheets recovers"',
          }
        : {}),
    },
  });
}

async function capturePublicRouteResponse(request: NextRequest) {
  const response = await buildUncachedPublicResponse(request);
  return {
    savedAt: Date.now(),
    body: await response.text(),
    status: response.status,
    contentType: response.headers.get("content-type") || "application/json; charset=utf-8",
  } satisfies CachedPublicRouteResponse;
}

export async function GET(request: NextRequest) {
  // Background/scheduled requests must run the snapshot workflow immediately.
  // Normal public-page requests share one result for 45 seconds, matching the
  // existing DraftKings refresh interval and preventing Sheets quota bursts.
  if (isBackgroundSnapshotRequest(request)) {
    return buildUncachedPublicResponse(request);
  }

  const now = Date.now();
  if (
    publicRouteCache &&
    now - publicRouteCache.savedAt < PUBLIC_ROUTE_CACHE_TTL_MS
  ) {
    return publicResponseFromCache(publicRouteCache);
  }

  if (!publicRouteInFlight) {
    publicRouteInFlight = capturePublicRouteResponse(request).finally(() => {
      publicRouteInFlight = null;
    });
  }

  try {
    const captured = await publicRouteInFlight;
    if (captured.status >= 200 && captured.status < 300) {
      publicRouteCache = captured;
      return publicResponseFromCache(captured);
    }

    if (
      publicRouteCache &&
      now - publicRouteCache.savedAt < PUBLIC_ROUTE_STALE_MS
    ) {
      return publicResponseFromCache(publicRouteCache, true);
    }

    return new NextResponse(captured.body, {
      status: captured.status,
      headers: {
        "Content-Type": captured.contentType,
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    if (
      publicRouteCache &&
      now - publicRouteCache.savedAt < PUBLIC_ROUTE_STALE_MS
    ) {
      return publicResponseFromCache(publicRouteCache, true);
    }
    throw error;
  }
}

