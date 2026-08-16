import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { readWorksheet as readWorksheetUncached } from "../../../lib/googleSheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
// Final reviews can briefly overlap around common first-pitch times. Leave
// enough server time for the compact, game-level review queue to finish rather
// than allowing the platform to terminate the route while a review is pending.
export const maxDuration = 300;

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
  selectedProbability?: string | number;
  reliability?: string | number;
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
const AI_PICK_SELECTOR_VERSION = "hybrid-web-context-v17-all-best-play-last7-gates";
const AI_MINIMUM_ESTIMATED_ADVANTAGE = 5;
const AI_PICK_SELECTOR_HEADERS = [
  "Date", "Candidate ID", "Game Key", "Game Time", "Game", "Away Team", "Home Team",
  "Market", "Play", "Selection", "Line", "Odds", "Source",
  "Best Play Type", "Trend Tier", "Model Score", "Trend Score",
  "AI Score", "Estimated Probability", "Market Implied Probability", "Estimated Advantage",
  "Selected", "Protection Status", "Rejection Reason", "AI Confidence Reason",
  "Why Selected", "Historical Matchup Notes", "Risks", "AI Research Summary", "AI Verdict",
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
  recoveredFromSavedPregameSnapshot?: boolean;
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

type AiPitcherBetTypeForm = "HOT" | "COLD" | "NEUTRAL" | "SAMPLE";

type AiSelectorCandidate = AiPick & {
  slateRow: SheetRow | null;
  bestPlay: Play | null;
  trendPlay: TrendPlay | null;
  baselineProbability: number;
  scoreAdjustment: number;
  probabilityAdjustment: number;
  protectionReasons: string[];
  pitcherBetTypeForm?: AiPitcherBetTypeForm;
  pitcherBetTypeRecord?: string;
  pitcherRequiredScore?: number;
};

type AiExternalReview = {
  candidateId: string;
  adjustment: number;
  approved: boolean;
  criticalConflict: boolean;
  criticalConflictReason: string;
  confidenceReason: string[];
  why: string[];
  historicalNotes: string[];
  risks: string[];
  researchSummary: string;
  verdict: string;
  contextSummary: string;
  startingPitching: string;
  bullpenAnalysis: string;
  recentTeamForm: string;
  historicalMatchup: string;
  selectionComparison: string;
  mainRisk: string;
  finalVerdict: string;
};

type AiGameCandidateReview = {
  candidateId: string;
  adjustment: number;
  approved: boolean;
  criticalConflict: boolean;
  criticalConflictReason: string;
  confidenceReason: string[];
  why: string[];
  historicalNotes: string[];
  researchSummary: string;
  selectionComparison: string;
  finalVerdict: string;
};

type AiGameExternalReview = {
  gameKey: string;
  contextSummary: string;
  startingPitching: string;
  bullpenAnalysis: string;
  recentTeamForm: string;
  historicalMatchup: string;
  candidateReviews: AiGameCandidateReview[];
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
  reportedBetsPct?: number;
  gapPct: number;
  warningKey: string;
  warning: string;
  warningTone: PublicSignalTone;
  warningNegative: boolean;
  openingLine?: number | null;
  openingOdds?: string;
  openingBetsPct?: number;
  openingReportedBetsPct?: number;
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
let marketSlateBootstrapCache: {
  date: string;
  savedAt: number;
  gameCount: number;
} | null = null;
let marketSlateBootstrapInFlight: Promise<number> | null = null;
const MARKET_SLATE_BOOTSTRAP_TTL_MS = 10 * 60_000;

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

function invalidateWorksheetReadCache(tabName: string) {
  worksheetReadCache.delete(textKey(tabName));
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
  "Cleveland Guardians": ["CLE", "CLE Guardians", "Guardians", "Cleveland"],
  "Colorado Rockies": ["COL Rockies", "Rockies", "Colorado"],
  "Detroit Tigers": ["DET Tigers", "Tigers", "Detroit"],
  "Houston Astros": ["HOU Astros", "Astros", "Houston"],
  "Kansas City Royals": ["KC Royals", "KCR Royals", "Royals", "Kansas City"],
  "Los Angeles Angels": ["LA Angels", "LAA Angels", "Angels", "Los Angeles Angels"],
  "Los Angeles Dodgers": ["LA Dodgers", "LAD Dodgers", "Dodgers", "Los Angeles Dodgers"],
  "Miami Marlins": ["MIA Marlins", "Marlins", "Miami"],
  "Milwaukee Brewers": ["MIL", "MIL Brewers", "Brewers", "Milwaukee"],
  "Minnesota Twins": ["MIN Twins", "Twins", "Minnesota"],
  "New York Mets": ["NYM", "NY Mets", "NYM Mets", "Mets", "New York Mets"],
  "New York Yankees": ["NY Yankees", "NYY Yankees", "Yankees", "New York Yankees"],
  Athletics: ["Athletics", "OAK Athletics", "ATH Athletics", "Oakland Athletics"],
  "Philadelphia Phillies": ["PHI", "PHI Phillies", "Phillies", "Philadelphia"],
  "Pittsburgh Pirates": ["PIT", "PIT Pirates", "Pirates", "Pittsburgh"],
  "San Diego Padres": ["SD Padres", "SDP Padres", "Padres", "San Diego"],
  "San Francisco Giants": ["SF Giants", "SFG Giants", "Giants", "San Francisco"],
  "Seattle Mariners": ["SEA Mariners", "Mariners", "Seattle"],
  "St. Louis Cardinals": ["STL Cardinals", "Cardinals", "St Louis Cardinals", "St. Louis"],
  "Tampa Bay Rays": ["TB", "TBR", "TB Rays", "TBR Rays", "Rays", "Tampa Bay"],
  "Texas Rangers": ["TEX Rangers", "Rangers", "Texas"],
  "Toronto Blue Jays": ["TOR Blue Jays", "Blue Jays", "Toronto"],
  "Washington Nationals": ["WAS", "WSH", "WAS Nationals", "WSH Nationals", "Nationals", "Washington"],
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
      : teamFromSelection(row.selectionTeam || row.selection);
  return `${row.date}|${row.game}|${row.market}|${textKey(selectedSide)}`;
}

function draftKingsPropKey(row: DraftKingsProp) {
  const line = row.line == null ? numericLine(row.listedLine) : row.line;
  return [
    row.date,
    row.game,
    textKey(row.pitcher),
    textKey(row.market),
    textKey(row.side),
    line == null ? textKey(row.listedLine) : String(line),
  ].join("|");
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
  const match = String(value || "").replace(/[−–—]/g, "-").match(/-?\d+(?:\.\d+)?/);
  const parsed = match ? Number(match[0]) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function percent(value: unknown) {
  const parsed = Number(String(value || "").replace("%", "").trim());
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : NaN;
}

function alignedBetsPct(moneyPct: number) {
  const clampedMoneyPct = Math.max(0, Math.min(100, moneyPct));
  return Math.round((100 - clampedMoneyPct) * 10) / 10;
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
      warning: "Extreme Bets + Handle Agreement",
      warningTone: "negative" as const,
      warningNegative: true,
      gapPct,
    };
  }
  if (betsPct >= 80 && moneyPct >= 80) {
    return {
      warningKey: "HEAVY_PUBLIC_SHARP_AGREEMENT",
      warning: "Heavy Bets + Handle Agreement",
      warningTone: "caution" as const,
      warningNegative: true,
      gapPct,
    };
  }
  if (gapPct <= -20) {
    return {
      warningKey: "STRONG_SHARP_REJECTION",
      warning: "Strong Handle Below Bets",
      warningTone: "negative" as const,
      warningNegative: true,
      gapPct,
    };
  }
  if (gapPct <= -10) {
    return {
      warningKey: "SHARP_REJECTION",
      warning: "Handle Below Bets",
      warningTone: "negative" as const,
      warningNegative: true,
      gapPct,
    };
  }
  if (gapPct >= 20) {
    return {
      warningKey: "STRONG_SHARP_SUPPORT",
      warning: "Strong Handle Above Bets",
      warningTone: "positive" as const,
      warningNegative: false,
      gapPct,
    };
  }
  if (gapPct >= 10) {
    return {
      warningKey: "SHARP_SUPPORT",
      warning: "Handle Above Bets",
      warningTone: "positive" as const,
      warningNegative: false,
      gapPct,
    };
  }
  return {
    warningKey: "BALANCED_PUBLIC_SHARP_SPLIT",
    warning: "Balanced Bets / Handle",
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
  // Product contract: each selected-side tile is a two-part split where
  // Money % + Bets % = 100%. DraftKings' independently reported Bets % is
  // retained separately so the source value is not lost during normalization.
  const reportedBetsPct = current.reportedBetsPct ?? current.betsPct;
  const betsPct = alignedBetsPct(current.moneyPct);
  const alignedCurrent = { ...current, betsPct, reportedBetsPct };
  const primary = warningFor(betsPct, current.moneyPct);
  const openingLine = previous?.openingLine ?? previous?.line ?? current.openingLine ?? current.line;
  const openingOdds = previous?.openingOdds || previous?.odds || current.openingOdds || current.odds;
  const openingMoneyPct =
    previous?.openingMoneyPct ?? previous?.moneyPct ?? current.openingMoneyPct ?? current.moneyPct;
  const openingReportedBetsPct =
    previous?.openingReportedBetsPct ??
    previous?.reportedBetsPct ??
    previous?.openingBetsPct ??
    previous?.betsPct ??
    current.openingReportedBetsPct ??
    current.openingBetsPct ??
    reportedBetsPct;
  const openingBetsPct = alignedBetsPct(openingMoneyPct);
  const openingSnapshotTime =
    previous?.openingSnapshotTime ||
    previous?.lastSeenAt ||
    current.openingSnapshotTime ||
    updatedAt;
  const movement = movementForSplit(
    alignedCurrent,
    openingLine ?? null,
    openingOdds || current.odds,
    openingBetsPct,
  );
  const sharpMovementPct = Math.round((current.moneyPct - openingMoneyPct) * 10) / 10;

  return {
    ...alignedCurrent,
    ...primary,
    openingLine: openingLine ?? null,
    openingOdds: openingOdds || current.odds,
    openingBetsPct,
    openingReportedBetsPct,
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
    const gameToken = tokens[i] || "";
    const dateToken = tokens[i + 1] || "";
    if (!gameToken.includes(" @ ") || !/\d{1,2}\/\d{1,2}/.test(dateToken)) {
      i += 1;
      continue;
    }

    const [awayRaw = "", homeRaw = ""] = gameToken
      .split(" @ ", 2)
      .map((part) => part.trim());
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
        String(tokens[i] || "").includes(" @ ") &&
        /\d{1,2}\/\d{1,2}/.test(tokens[i + 1] || "")
      )
        break;

      const marketToken = tokens[i] || "";
      const market = marketNames[marketToken];
      if (!market) {
        i += 1;
        continue;
      }

      let j = i + 1;
      while (["Odds", "% Handle", "% Bets"].includes(tokens[j] || "")) j += 1;

      let parsedMarketRows = 0;
      while (j + 3 < tokens.length) {
        if (marketNames[tokens[j] || ""]) break;
        if (
          j + 1 < tokens.length &&
          String(tokens[j] || "").includes(" @ ") &&
          /\d{1,2}\/\d{1,2}/.test(tokens[j + 1] || "")
        )
          break;

        const [selection = "", rawOdds = "", rawMoneyPct = "", rawBetsPct = ""] =
          tokens.slice(j, j + 4);
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
      String(tokens[i] || "").includes(" @ ") &&
      /\d{1,2}\/\d{1,2}/.test(tokens[i + 1] || "") &&
      isOdds(tokens[i + 4])
    ) {
      rawRows.push(tokens.slice(i, i + 5));
      i += 5;
    } else {
      i += 1;
    }
  }

  const rows: DraftKingsProp[] = [];
  rawRows.forEach((rawRow, index) => {
    const [event = "", dateText = "", market = "", listedLine = "", rawOdds = ""] =
      rawRow;
    if (!event.includes(" @ ") || !market.toLowerCase().includes("strikeout")) return;
    const [awayRaw = "", homeRaw = ""] = event
      .split(" @ ", 2)
      .map((part) => part.trim());
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
  existingMatrix?: WorksheetMatrix,
) {
  await ensureWorksheet(sheets, spreadsheetId, tabName, headers);
  const values = [
    headers,
    ...rows.map((row) => headers.map((header) => String(row[header] ?? ""))),
  ];

  // Write the replacement first. If Google rejects the update, the existing
  // worksheet remains intact instead of being left completely empty.
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${escapedSheetName(tabName)}'!A1`,
    valueInputOption: "RAW",
    requestBody: { values },
  });

  const oldRowCount = existingMatrix ? existingMatrix.rows.length + 1 : values.length;
  const oldColumnCount = existingMatrix?.headers.length || headers.length;
  const clearRanges: string[] = [];
  if (oldRowCount > values.length) {
    clearRanges.push(
      `'${escapedSheetName(tabName)}'!A${values.length + 1}:ZZ${oldRowCount}`,
    );
  }
  if (oldColumnCount > headers.length) {
    clearRanges.push(
      `'${escapedSheetName(tabName)}'!${columnLetter(headers.length)}1:${columnLetter(
        oldColumnCount - 1,
      )}${Math.max(oldRowCount, values.length)}`,
    );
  }
  await Promise.all(
    clearRanges.map((range) =>
      sheets.spreadsheets.values.clear({
        spreadsheetId,
        range,
        requestBody: {},
      }),
    ),
  );
  invalidateWorksheetReadCache(tabName);
}

async function appendWorksheetRows(
  sheets: any,
  spreadsheetId: string,
  tabName: string,
  headers: string[],
  rows: SheetRow[],
) {
  if (!rows.length) return;
  if (!headers.length) {
    throw new Error(`${tabName} is missing a header row.`);
  }
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${escapedSheetName(tabName)}'!A:${columnLetter(headers.length - 1)}`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: rows.map((row) => headers.map((header) => String(row[header] ?? ""))),
    },
  });
  invalidateWorksheetReadCache(tabName);
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
  invalidateWorksheetReadCache(tabName);
}

let publicSplitPersistenceQueue: Promise<void> = Promise.resolve();

function persistPublicSplitSnapshotRecords(
  sheets: any,
  spreadsheetId: string,
  snapshotRecords: SheetRow[],
) {
  if (!snapshotRecords.length) return Promise.resolve();
  const operation = publicSplitPersistenceQueue.catch(() => undefined).then(async () => {
    const latestMatrix = await readWorksheetMatrixWithClient(
      sheets,
      spreadsheetId,
      PUBLIC_SPLIT_TAB,
      PUBLIC_SPLIT_HEADERS,
    );
    const snapshotMap = new Map<string, SheetRow>();
    latestMatrix.rows.forEach((row) =>
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
      latestMatrix,
    );
  });
  publicSplitPersistenceQueue = operation.catch(() => undefined);
  return operation;
}

function isoPublicDate(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const [, year, month, day] = iso;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const us = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2}|\d{4})$/);
  if (us) {
    const [, month, day, shortYear] = us;
    const year = String(shortYear).length === 2 ? `20${shortYear}` : shortYear;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
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
  const matches = [...ALIAS_LOOKUP.entries()]
    .filter(([alias]) =>
      alias &&
      (key === alias ||
        key.startsWith(`${alias} `) ||
        key.endsWith(` ${alias}`) ||
        key.includes(` ${alias} `)),
    )
    .sort((a, b) => b[0].length - a[0].length);
  return matches[0]?.[1] || normalizeTeam(value);
}

function easternTimeZoneOffsetMs(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value || 0);
  return (
    Date.UTC(
      value("year"),
      value("month") - 1,
      value("day"),
      value("hour"),
      value("minute"),
      value("second"),
    ) - date.getTime()
  );
}

function easternWallTimeMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
) {
  const wallTimeUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let instant = wallTimeUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const corrected = wallTimeUtc - easternTimeZoneOffsetMs(new Date(instant));
    if (Math.abs(corrected - instant) < 1_000) return corrected;
    instant = corrected;
  }
  return instant;
}

function normalizedClockHour(hour: number, meridiem: string) {
  if (!meridiem) return hour;
  const normalized = hour % 12;
  return meridiem.toUpperCase() === "PM" ? normalized + 12 : normalized;
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
  const raw = String(value).trim();

  // Explicit offsets are already unambiguous and should be honored exactly.
  if (/(?:Z|[+-]\d{2}:?\d{2}|\b(?:UTC|GMT|EST|EDT)\b)\s*$/i.test(raw)) {
    const parsed = new Date(raw).getTime();
    if (Number.isFinite(parsed)) return parsed;
  }
  const easternRaw = raw.replace(/\s+(?:ET|EST|EDT)\s*$/i, "").trim();

  const localDateTime = easternRaw.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})[T\s]+(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(AM|PM)?$/i,
  );
  if (localDateTime) {
    const [, year, month, day, hour, minute = "0", second = "0", meridiem = ""] =
      localDateTime;
    return easternWallTimeMs(
      Number(year),
      Number(month),
      Number(day),
      normalizedClockHour(Number(hour), meridiem),
      Number(minute),
      Number(second),
    );
  }

  const usDateTime = easternRaw.match(
    /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2}|\d{4})[,\s]+(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(AM|PM)?$/i,
  );
  if (usDateTime) {
    const [, month, day, shortYear, hour, minute = "0", second = "0", meridiem = ""] =
      usDateTime;
    const year = String(shortYear).length === 2 ? Number(`20${shortYear}`) : Number(shortYear);
    return easternWallTimeMs(
      year,
      Number(month),
      Number(day),
      normalizedClockHour(Number(hour), meridiem),
      Number(minute),
      Number(second),
    );
  }

  const clock = easternRaw.match(/^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(AM|PM)?$/i);
  const rowDate = isoPublicDate(row.Date || row["Game Date"] || "");
  const dateParts = rowDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (clock && dateParts) {
    const [, hour, minute = "0", second = "0", meridiem = ""] = clock;
    return easternWallTimeMs(
      Number(dateParts[1]),
      Number(dateParts[2]),
      Number(dateParts[3]),
      normalizedClockHour(Number(hour), meridiem),
      Number(minute),
      Number(second),
    );
  }

  // Preserve support for any uncommon but natively parseable full timestamp.
  const parsed = new Date(raw).getTime();
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

function selectedPitcherProp(
  summary: unknown,
  row: SheetRow,
  payload: DraftKingsPayload,
): DraftKingsProp | null {
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
  return options[0] || null;
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

function isAiFinalReviewWindow(row: SheetRow, now = Date.now()) {
  const minutes = minutesBeforeScheduledStart(row, now);
  // The dedicated market snapshot still targets roughly 15 minutes before the
  // game. Keep the AI final-review fallback open through the remaining pregame
  // period so a late scheduler or page refresh cannot strand a pick as PENDING.
  return minutes != null && minutes > 0 && minutes <= 23;
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
    selectedKey = `${textKey(selection)}|${textKey(row.Line || "")}`;
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
  } catch (error) {
    console.error("Public split snapshot read failed", error);
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
  } catch (error) {
    console.error("All-game trend read failed", error);
    return [];
  }
}

async function safeReadAiPickRows(): Promise<SheetRow[]> {
  try {
    return await readWorksheet(AI_PICK_SELECTOR_TAB);
  } catch (error) {
    console.error("AI pick selector read failed", error);
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
    const capturedTrackingSnapshotKeys = new Set(
      savedSnapshotObjects
        .filter((row) => isFifteenMinuteTrackingSnapshot(row))
        .map(snapshotRecordKey),
    );
    const alreadyCapturedGameKeys = new Set(
      slateObjects
        .filter((row) => isoPublicDate(row.Date) === todayIso)
        .filter((row) => {
          const expected = [
            ...availableSplits
              .filter((item) => sameDraftKingsGame(row, item))
              .map((item) =>
                snapshotRecordKey(
                  snapshotRecordFromSplit(item, item.lastSeenAt || livePayload.updatedAt, "tracking"),
                ),
              ),
            ...availableProps
              .filter((item) => sameDraftKingsGame(row, item))
              .map((item) =>
                snapshotRecordKey(
                  snapshotRecordFromProp(item, item.lastSeenAt || livePayload.updatedAt, "tracking"),
                ),
              ),
          ];
          return (
            expected.length > 0 &&
            expected.every((key) => capturedTrackingSnapshotKeys.has(key))
          );
        })
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
          const selectedProp = exact || props[0];
          if (selectedProp) {
            fields = trackerPropFields(selectedProp, livePayload.updatedAt, Boolean(exact));
          }
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
      await persistPublicSplitSnapshotRecords(sheets, spreadsheetId, snapshotRecords);
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


type MlbScheduledGame = {
  gameKey: string;
  date: string;
  gameTime: string;
  awayTeam: string;
  homeTeam: string;
  game: string;
};

async function scheduledMlbGamesForDate(dateIso: string): Promise<MlbScheduledGame[]> {
  const url = new URL("https://statsapi.mlb.com/api/v1/schedule");
  url.searchParams.set("sportId", "1");
  url.searchParams.set("date", dateIso);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`MLB schedule request failed (${response.status})`);
  }
  const payload = (await response.json()) as any;
  const output: MlbScheduledGame[] = [];
  for (const day of payload?.dates || []) {
    for (const game of day?.games || []) {
      const state = `${String(game?.status?.detailedState || "")} ${String(
        game?.status?.abstractGameState || "",
      )}`.toLowerCase();
      if (state.includes("cancel") || state.includes("postpon")) continue;
      const gameKey = String(game?.gamePk || "").replace(/\.0$/, "");
      const awayTeam = normalizeTeam(game?.teams?.away?.team?.name || "");
      const homeTeam = normalizeTeam(game?.teams?.home?.team?.name || "");
      const gameTime = String(game?.gameDate || "").trim();
      if (!gameKey || !awayTeam || !homeTeam || !gameTime) continue;
      output.push({
        gameKey,
        date: dateIso,
        gameTime,
        awayTeam,
        homeTeam,
        game: `${awayTeam} at ${homeTeam}`,
      });
    }
  }
  return output;
}

function marketTrackingTrendShellRows(game: MlbScheduledGame): SheetRow[] {
  const common: SheetRow = {
    Date: game.date,
    "Game Key": game.gameKey,
    Game: game.game,
    "Game Time": game.gameTime,
    "Away Team": game.awayTeam,
    "Home Team": game.homeTeam,
    Qualified: "FALSE",
    Result: "Pending",
  };
  return [
    { ...common, Market: "Moneyline", Selection: game.awayTeam, Side: "" },
    { ...common, Market: "Moneyline", Selection: game.homeTeam, Side: "" },
    { ...common, Market: "Total", Selection: "Over", Side: "Over" },
    { ...common, Market: "Total", Selection: "Under", Side: "Under" },
  ];
}

function trendShellIdentity(row: SheetRow) {
  const market = textKey(row.Market || "");
  const selection = market === "total"
    ? textKey(row.Side || row.Selection || "")
    : textKey(teamFromSelection(row.Selection || ""));
  const gameKey = String(row["Game Key"] || "").trim().replace(/\.0$/, "");
  const fallbackGame = `${normalizeTeam(row["Away Team"] || "")}|${normalizeTeam(
    row["Home Team"] || "",
  )}`;
  return `${isoPublicDate(row.Date || "")}|${gameKey || fallbackGame}|${market}|${selection}`;
}

async function ensureTodayMarketSlate(today: string) {
  const todayIso = isoPublicDate(today);
  if (!todayIso) return 0;
  if (
    marketSlateBootstrapCache &&
    marketSlateBootstrapCache.date === todayIso &&
    Date.now() - marketSlateBootstrapCache.savedAt < MARKET_SLATE_BOOTSTRAP_TTL_MS
  ) {
    return marketSlateBootstrapCache.gameCount;
  }
  if (marketSlateBootstrapInFlight) return marketSlateBootstrapInFlight;

  marketSlateBootstrapInFlight = (async () => {
    const games = await scheduledMlbGamesForDate(todayIso);
    if (!games.length) {
      marketSlateBootstrapCache = { date: todayIso, savedAt: Date.now(), gameCount: 0 };
      return 0;
    }

    const { spreadsheetId, sheets } = mainSheetsClient();
    const [slateMatrix, trendMatrix] = await Promise.all([
      readWorksheetMatrixWithClient(sheets, spreadsheetId, "daily_slate"),
      readWorksheetMatrixWithClient(
        sheets,
        spreadsheetId,
        ALL_GAME_TRENDS_TAB,
        ALL_GAME_TRENDS_HEADERS,
      ),
    ]);

    const existingSlateGameKeys = new Set(
      slateMatrix.rows
        .filter((row) => isoPublicDate(row.object.Date || "") === todayIso)
        .map((row) => String(row.object["Game Key"] || "").trim().replace(/\.0$/, ""))
        .filter(Boolean),
    );
    const existingSlateMatchups = new Set(
      slateMatrix.rows
        .filter((row) => isoPublicDate(row.object.Date || "") === todayIso)
        .map(
          (row) =>
            `${normalizeTeam(row.object["Away Team"] || "")}|${normalizeTeam(
              row.object["Home Team"] || "",
            )}`,
        )
        .filter((key) => key !== "|"),
    );

    const missingSlateRows: SheetRow[] = [];
    for (const game of games) {
      const matchupKey = `${game.awayTeam}|${game.homeTeam}`;
      if (existingSlateGameKeys.has(game.gameKey) || existingSlateMatchups.has(matchupKey)) continue;
      missingSlateRows.push({
        Date: game.date,
        "Game Key": game.gameKey,
        "Game Label": game.game,
        "Game Time": game.gameTime,
        "Away Team": game.awayTeam,
        "Home Team": game.homeTeam,
        "Public Data Status": "MARKET TRACKING INITIALIZED",
      });
    }

    const existingTrendKeys = new Set(
      trendMatrix.rows.map((row) => trendShellIdentity(row.object)),
    );
    const missingTrendRows: SheetRow[] = [];
    for (const game of games) {
      for (const shell of marketTrackingTrendShellRows(game)) {
        const key = trendShellIdentity(shell);
        if (existingTrendKeys.has(key)) continue;
        existingTrendKeys.add(key);
        missingTrendRows.push(shell);
      }
    }

    if (missingSlateRows.length) {
      await appendWorksheetRows(
        sheets,
        spreadsheetId,
        "daily_slate",
        slateMatrix.headers,
        missingSlateRows,
      );
    }
    if (missingTrendRows.length) {
      await appendWorksheetRows(
        sheets,
        spreadsheetId,
        ALL_GAME_TRENDS_TAB,
        trendMatrix.headers,
        missingTrendRows,
      );
    }

    marketSlateBootstrapCache = {
      date: todayIso,
      savedAt: Date.now(),
      gameCount: games.length,
    };
    return games.length;
  })();

  try {
    return await marketSlateBootstrapInFlight;
  } catch (error) {
    console.error("Automatic MLB market-slate bootstrap failed", error);
    return 0;
  } finally {
    marketSlateBootstrapInFlight = null;
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
  "ELITE YRFI",
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
    const fullYear = String(y).length === 2 ? `20${y}` : y;
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
  if (text.includes("ELITE YRFI")) return "ELITE YRFI";
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
  const raw = String(value ?? "").replace(/[−–—]/g, "-").trim();
  const signed = raw.match(/[+-]\d{3,4}(?!\d)/)?.[0];
  const whole = raw.match(/^[+-]?\d{3,4}$/)?.[0];
  const match = signed || whole;
  if (!match) return 0;
  const odds = Number(match);
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

const DRAFTKINGS_LINE_MOVEMENT_SIGNAL_CATALOG: ReadonlyArray<{
  signal: string;
  tone: PublicSignalTone;
}> = [
  { signal: "Strong Reverse Line Movement Support", tone: "positive" },
  { signal: "Reverse Line Movement Support", tone: "positive" },
  { signal: "Strong Reverse Line Movement Against", tone: "negative" },
  { signal: "Reverse Line Movement Against", tone: "negative" },
  { signal: "Line Movement Confirmation", tone: "positive" },
  { signal: "Adverse Line Movement", tone: "negative" },
  { signal: "Legacy Adverse Movement (pre-fix)", tone: "negative" },
];

function normalizedLineMovementSignal(value: unknown) {
  const normalized = textKey(value);
  if (!normalized) return null;

  // Historical rows used this ambiguous label before support/against was fixed.
  // Keep those results in the explicit legacy bucket instead of dropping them.
  if (normalized === "reverse line movement") {
    return DRAFTKINGS_LINE_MOVEMENT_SIGNAL_CATALOG.find(
      (item) => item.signal === "Legacy Adverse Movement (pre-fix)",
    ) || null;
  }

  return DRAFTKINGS_LINE_MOVEMENT_SIGNAL_CATALOG.find(
    (item) => textKey(item.signal) === normalized,
  ) || null;
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
    const moneyPct =
      publicPercentOrNull(row["Public Money %"]) ??
      publicPercentOrNull(snapshot?.["Public Money %"]);
    if (moneyPct == null) continue;
    const betsPct = alignedBetsPct(moneyPct);

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

    // Some historical all_game_trends rows contain Trend Exact Sample counts
    // (for example "21" or "11 | 2") in the Line Movement Signal column.
    // Only canonical labels are recordable, and a malformed row value must not
    // prevent recovery from the corresponding saved DraftKings snapshot.
    const movementSignal =
      normalizedLineMovementSignal(row["Line Movement Signal"]) ||
      normalizedLineMovementSignal(snapshot?.["Line Movement Signal"]);
    if (movementSignal) {
      output.push({
        ...common,
        signalType: "Line Movement",
        signalKey: textKey(movementSignal.signal).toUpperCase().replace(/\s+/g, "_"),
        signal: movementSignal.signal,
        tone: movementSignal.tone,
      });
    }
  }
  return output;
}

function canonicalDraftKingsSignalRows(
  rows: DraftKingsSignalResult[],
): DraftKingsSignalResult[] {
  return rows.flatMap((row) => {
    if (row.signalType === "Public Split") return [row];

    // Historical schema drift placed Trend Exact Sample values such as "21"
    // and "11 | 2" in Line Movement Signal. They are sample counts, not
    // betting signals, and must never become separate public record buckets.
    const canonical = normalizedLineMovementSignal(row.signal);
    if (!canonical) return [];
    return [{
      ...row,
      signalKey: textKey(canonical.signal).toUpperCase().replace(/\s+/g, "_"),
      signal: canonical.signal,
      tone: canonical.tone,
    }];
  });
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
  const recoveredMoneyPct =
    publicPercentOrNull(snapshot?.["Public Money %"] || row["Public Money %"]) ?? 0;
  const recoveredBetsPct = alignedBetsPct(recoveredMoneyPct);
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
        betsPct: recoveredBetsPct,
        moneyPct: recoveredMoneyPct,
        gapPct: Math.round((recoveredMoneyPct - recoveredBetsPct) * 10) / 10,
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

  const savedTrendScore = (value: unknown) => {
    const raw = String(value ?? "").trim();
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
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
    const storedPlayTimestamp = (() => {
      try {
        const raw = String(row["Trend Score Details"] || "").trim();
        if (!raw) return "";
        const parsed = JSON.parse(raw) as Partial<TrendPlay>;
        return String(parsed.frozenAt || parsed.updatedAt || "").trim();
      } catch {
        return "";
      }
    })();
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
    const savedPregameTime = String(
      row["Public Split Snapshot Time"] ||
        storedPlay?.frozenAt ||
        storedPlayTimestamp ||
        "",
    ).trim();
    const savedPregameTier = normalizeSavedTier(
      row["Trend Tier"] || storedPlay?.tier,
    );
    const savedPregameScore =
      savedTrendScore(row["Trend Score"]) ?? savedTrendScore(storedPlay?.score);
    const recoveredFromSavedPregameSnapshot = Boolean(
      storedPlay &&
        savedPregameTier &&
        savedPregameScore != null &&
        savedPregameScore >= 60 &&
        savedPregameTime &&
        confidence.includes("pregame") &&
        !confidence.includes("live game"),
    );
    const finalSnapshot =
      isOfficialTrendSnapshotConfidence(confidence) ||
      Boolean(historicalOverride) ||
      recoveredFromSavedPregameSnapshot ||
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

    const authoritativeScore = savedTrendScore(authoritativePlay?.score);
    const rowScore = savedTrendScore(row["Trend Score"]);
    const storedScore = savedTrendScore(storedPlay?.score);
    const frozenScore = historicalOverride
      ? historicalOverride.score
      : authoritativeScore != null
        ? authoritativeScore
        : rowScore != null
          ? rowScore
          : storedScore != null
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
    const recoveredMoneyPct = publicPercentOrNull(row["Public Money %"]) ?? 0;
    const recoveredBetsPct = alignedBetsPct(recoveredMoneyPct);

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
            betsPct: recoveredBetsPct,
            moneyPct: recoveredMoneyPct,
            gapPct: Math.round((recoveredMoneyPct - recoveredBetsPct) * 10) / 10,
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
      recoveredFromSavedPregameSnapshot,
      recoveryNote:
        historicalOverride?.note ||
        (recoveredFromSavedPregameSnapshot
          ? "saved pregame snapshot recovery"
          : undefined),
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
  { key: "allTime", weight: 0.25 },
  { key: "last30", weight: 0.25 },
  { key: "last7", weight: 0.5 },
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
  return {
    // Trend history is intentionally split evenly between actual win record
    // and ROI. Recency is handled separately by TREND_WINDOW_WEIGHTS above.
    score: clampScore(
      weightedAverage("winScore") * 0.5 +
        weightedAverage("roiScore") * 0.5,
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
    const moneyPct = Number.isFinite(Number(parsed.moneyPct))
      ? Math.max(0, Math.min(100, Number(parsed.moneyPct)))
      : 0;
    const betsPct = alignedBetsPct(moneyPct);
    const openingMoneyPct = Number.isFinite(Number(parsed.openingMoneyPct))
      ? Math.max(0, Math.min(100, Number(parsed.openingMoneyPct)))
      : undefined;
    const openingBetsPct =
      openingMoneyPct == null ? undefined : alignedBetsPct(openingMoneyPct);

    return {
      ...(parsed as TrendPlay),
      moneyPct,
      betsPct,
      gapPct: Math.round((moneyPct - betsPct) * 10) / 10,
      openingMoneyPct,
      openingBetsPct,
      publicMovementPct:
        openingBetsPct == null
          ? parsed.publicMovementPct
          : Math.round((betsPct - openingBetsPct) * 10) / 10,
      sharpMovementPct:
        openingMoneyPct == null
          ? parsed.sharpMovementPct
          : Math.round((moneyPct - openingMoneyPct) * 10) / 10,
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

  const overlayKey = (play: TrendPlay) =>
    `${trendGameComparisonKey(play)}|${trendMarketComparisonKey(play)}|${trendSideComparisonKey(play)}`;
  const liveByKey = new Map(livePlays.map((play) => [overlayKey(play), play]));
  const refreshedFrozenPlays = frozenPlays.map((frozenPlay) => {
    const livePlay = liveByKey.get(overlayKey(frozenPlay));
    if (!livePlay) return frozenPlay;

    // The final market snapshot remains frozen, but signal labels, records,
    // scores, and ranks must be rebuilt from the current calculation contract.
    // Otherwise a repaired split (for example 32% Bets / 68% Handle) can keep
    // the pre-repair "Handle Below Bets" badge from its stored JSON.
    return {
      ...livePlay,
      frozenAt: frozenPlay.frozenAt || livePlay.updatedAt,
      snapshotStatus: "FINAL_PREGAME" as const,
      gradingVersion: FROZEN_TREND_GRADING_VERSION,
      recordDate: frozenPlay.recordDate,
      recordGameKey: frozenPlay.recordGameKey,
      recordGameTime: frozenPlay.recordGameTime,
    };
  });

  const frozenGameKeys = new Set(
    refreshedFrozenPlays.map((play) => trendGameComparisonKey(play)),
  );
  const combined = [
    ...livePlays.filter(
      (play) => !frozenGameKeys.has(trendGameComparisonKey(play)),
    ),
    ...refreshedFrozenPlays,
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
    .replace(/\b(?:STRONG|LEAN)\s+(?:OVER|UNDER)\b/gi, "")
    .replace(/\b(?:OVER|UNDER)\b/gi, "")
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

function pitcherBestPlayIdentity(play: Play) {
  if (!isPitcherKType(play.playType)) return "";
  let pitcherName = cleanPitcherName(play.play);
  if (pitcherName.includes(",")) {
    const [last, first] = pitcherName.split(",", 2);
    pitcherName = `${first || ""} ${last || ""}`.trim();
  }
  const pitcher = normalizeText(pitcherName);
  return pitcher ? `PK|${pitcher}` : "";
}

function pitcherBestPlayCompleteness(play: Play) {
  let score = 0;
  if (toNumber(play.projectedKs) > 0) score += 100;
  if (toNumber(play.altLine) > 0) score += 30;
  if (normalizeProbability(play.selectedProbability) > 0) score += 15;
  if (toNumber(play.reliability) > 0) score += 10;
  if (toNumber(play.score) > 0) score += 5;
  if (play.awayTeam && play.homeTeam) score += 20;
  if (play.playerTeam) score += 5;
  return score;
}

function dedupePitcherBestPlays(plays: Play[]) {
  const deduped: Play[] = [];
  const pitcherIndexes = new Map<string, number>();

  for (const play of plays) {
    const key = pitcherBestPlayIdentity(play);
    if (!key) {
      deduped.push(play);
      continue;
    }

    const existingIndex = pitcherIndexes.get(key);
    if (existingIndex === undefined) {
      pitcherIndexes.set(key, deduped.length);
      deduped.push(play);
      continue;
    }

    const existing = deduped[existingIndex];
    if (
      pitcherBestPlayCompleteness(play) >=
      pitcherBestPlayCompleteness(existing)
    ) {
      deduped[existingIndex] = play;
    }
  }

  return deduped;
}

function extractPitcherFromSelection(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const match = text.match(/^(.*?)(?=\s+\d+(?:\.\d+)?)/);
  return String(match ? match[1] : text.split("(", 1)[0] || "").trim();
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
        probability: firstValue(row, [
          "Away Pitcher K Probability",
          "Away K Probability",
          "Away Pitcher Probability",
          "Away Pitcher Selected Probability",
        ]),
        reliability: firstValue(row, [
          "Away Pitcher K Reliability",
          "Away K Reliability",
          "Away Pitcher Reliability",
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
        probability: firstValue(row, [
          "Home Pitcher K Probability",
          "Home K Probability",
          "Home Pitcher Probability",
          "Home Pitcher Selected Probability",
        ]),
        reliability: firstValue(row, [
          "Home Pitcher K Reliability",
          "Home K Reliability",
          "Home Pitcher Reliability",
        ]),
        headshotUrl: firstValue(row, [
          "Home Pitcher Headshot",
          "Home Pitcher Headshot URL",
          "Home Pitcher Image",
          "Home Pitcher Photo",
          "Home Headshot",
        ]),
      },
      {
        summary: row["Away Bulk Pitcher K + Grade"] || "",
        score:
          row["Away Bulk Pitcher K Score"] ||
          row["Away Bulk K Score"] ||
          row["Away Bulk Pitcher Score"] ||
          "",
        team: awayTeam,
        odds: firstValue(row, [
          "Away Bulk Pitcher K Odds",
          "Away Bulk K Odds",
          "Away Bulk Pitcher Odds",
          "Away Bulk Pitcher Prop Odds",
          "Away Bulk Pitcher Odds/Line",
        ]),
        probability: firstValue(row, [
          "Away Bulk Pitcher K Probability",
          "Away Bulk K Probability",
          "Away Bulk Pitcher Probability",
          "Away Bulk Pitcher Selected Probability",
        ]),
        reliability: firstValue(row, [
          "Away Bulk Pitcher K Reliability",
          "Away Bulk K Reliability",
          "Away Bulk Pitcher Reliability",
        ]),
        headshotUrl: firstValue(row, [
          "Away Bulk Pitcher Headshot",
          "Away Bulk Pitcher Headshot URL",
          "Away Bulk Pitcher Image",
          "Away Bulk Pitcher Photo",
          "Away Bulk Headshot",
        ]),
      },
      {
        summary: row["Home Bulk Pitcher K + Grade"] || "",
        score:
          row["Home Bulk Pitcher K Score"] ||
          row["Home Bulk K Score"] ||
          row["Home Bulk Pitcher Score"] ||
          "",
        team: homeTeam,
        odds: firstValue(row, [
          "Home Bulk Pitcher K Odds",
          "Home Bulk K Odds",
          "Home Bulk Pitcher Odds",
          "Home Bulk Pitcher Prop Odds",
          "Home Bulk Pitcher Odds/Line",
        ]),
        probability: firstValue(row, [
          "Home Bulk Pitcher K Probability",
          "Home Bulk K Probability",
          "Home Bulk Pitcher Probability",
          "Home Bulk Pitcher Selected Probability",
        ]),
        reliability: firstValue(row, [
          "Home Bulk Pitcher K Reliability",
          "Home Bulk K Reliability",
          "Home Bulk Pitcher Reliability",
        ]),
        headshotUrl: firstValue(row, [
          "Home Bulk Pitcher Headshot",
          "Home Bulk Pitcher Headshot URL",
          "Home Bulk Pitcher Image",
          "Home Bulk Pitcher Photo",
          "Home Bulk Headshot",
        ]),
      },
    ];

    for (const market of kMarkets) {
      const type = normalizeType(market.summary);
      if (!isGreenType(type)) continue;
      const parsed = parseKSummary(market.summary);
      const pitcherName =
        parsed.pitcherName || cleanPitcherName(market.summary);
      // A grade word by itself (for example, "Alvarez, Andrew OVER") is not a
      // complete model projection. Requiring both numeric fields prevents stale
      // tracker-style text from becoming a blank public Best Play card.
      if (
        !pitcherName ||
        toNumber(parsed.projected) <= 0 ||
        toNumber(parsed.line) <= 0
      ) {
        continue;
      }
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
        selectedProbability: market.probability,
        reliability: market.reliability,
        altLine: parsed.line,
        altOdds: odds,
      });
    }
  }

  const sorted = dedupePitcherBestPlays(plays).sort(
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
        String(play.oddsLine || "").split("/")[0]?.trim() || "",
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

function aiTrendEvidenceSample(play: TrendPlay) {
  const evidence = (play.signals || [])
    .filter((signal) => Number(signal.records?.allTime?.totalBets || 0) > 0)
    .map((signal) => {
      const exactSample = Number(signal.exactSample || 0);
      if (exactSample > 0) return exactSample;
      const fallbackSample = Number(signal.records?.allTime?.totalBets || 0);
      // Broader market/overall fallback history still matters, but is treated as
      // lower-confidence evidence than an exact market + side historical sample.
      return Math.min(fallbackSample * 0.5, 15);
    });
  if (!evidence.length) return 0;
  return aiRound(
    evidence.reduce((sum, sample) => sum + sample, 0) / evidence.length,
    1,
  );
}

function aiTrendBlendWeights(play: TrendPlay | null) {
  const effectiveSample = play ? aiTrendEvidenceSample(play) : 0;
  const trendWeight = effectiveSample >= 20 ? 0.4 : effectiveSample >= 10 ? 0.35 : 0.25;
  return {
    modelWeight: 1 - trendWeight,
    trendWeight,
    effectiveSample,
  };
}

function aiTrendOnlyHistoryAdjustment(play: TrendPlay) {
  const effectiveSample = aiTrendEvidenceSample(play);
  if (effectiveSample < 5) {
    return { score: -4, probability: -1.5, effectiveSample };
  }
  if (effectiveSample < 10) {
    return { score: -2, probability: -0.8, effectiveSample };
  }
  if (effectiveSample >= 20) {
    return { score: 1, probability: 0.3, effectiveSample };
  }
  return { score: 0, probability: 0, effectiveSample };
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
  const market = aiBestPlayMarket(play);
  const moneyline = normalizePercentValue(play.moneylinePct || "");
  if (market === "Moneyline" && moneyline > 0) {
    return aiClamp(moneyline, 40, 82);
  }

  // Pitcher props already carry a model-generated selected probability.
  // Use it directly instead of compressing a strong K score through the
  // generic score-to-probability formula, which was suppressing valid props.
  if (market === "Pitcher Strikeouts") {
    const pitcherProbability = normalizePercentValue(play.selectedProbability || "");
    if (pitcherProbability > 0) {
      return aiClamp(pitcherProbability, 45, 82);
    }
  }

  const score = parseScore(play.score);
  return aiClamp(50 + (score - 50) * 0.35, 44, 74);
}

function aiFindMarketSplit(candidate: AiSelectorCandidate, draftKings: DraftKingsPayload) {
  if (candidate.market !== "Moneyline" && candidate.market !== "Total") return null;
  const options = draftKings.splits.filter(
    (split) =>
      isoPublicDate(split.date) === isoPublicDate(candidate.date) &&
      normalizeTeam(split.awayTeam) === normalizeTeam(candidate.awayTeam) &&
      normalizeTeam(split.homeTeam) === normalizeTeam(candidate.homeTeam) &&
      split.market === candidate.market,
  );
  if (candidate.market === "Moneyline") {
    return options.find(
      (split) => normalizeTeam(split.selectionTeam || split.selection) === normalizeTeam(candidate.selection),
    ) || null;
  }
  const selectedSide = options.filter((split) => split.side === candidate.selection);
  const candidateLine = numericLine(candidate.line);
  if (candidateLine == null) return selectedSide[0] || null;
  return (
    selectedSide.find(
      (split) => split.line != null && Math.abs(split.line - candidateLine) < 0.001,
    ) || null
  );
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
    const qualificationValue = firstValue(row, [
      "Qualified",
      "Is Qualified",
      "Model Qualified",
      "Green Play",
    ]);
    const qualified = qualificationValue
      ? truthyValue(qualificationValue)
      : isGreenType(row["Bet Type"] || row["Model Grade"] || row.Market || "");
    if (!qualified) continue;
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
    const lineNumber = toNumber(line);
    const explicitScore = toNumber(firstValue(row, ["EZPZ Score", "AI Score", "Score", "Model Score"]));
    if (explicitScore <= 20 && (!projection || !lineNumber)) continue;
    const directionalEdge =
      projection && lineNumber
        ? side === "Over"
          ? projection - lineNumber
          : lineNumber - projection
        : 0;
    if (projection && lineNumber && directionalEdge <= 0) continue;
    const score = explicitScore > 20
      ? explicitScore
      : projection && lineNumber
        ? aiClamp(65 + directionalEdge * 8, 60, 92)
        : explicitScore;
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

function aiTrackerRowIsQualified(row: SheetRow) {
  const qualificationValue = firstValue(row, [
    "Qualified",
    "Is Qualified",
    "Model Qualified",
    "Green Play",
  ]);
  return qualificationValue
    ? truthyValue(qualificationValue)
    : isGreenType(row["Bet Type"] || row["Model Grade"] || row.Market || "");
}

function aiRowsForType(rows: SheetRow[], type: string) {
  const normalized = aiCanonicalBestPlayType(type);
  return rows.filter((row) => {
    if (normalized === "MONEYLINE") {
      return trackerMarket(row) === "Moneyline" && aiTrackerRowIsQualified(row);
    }
    if (normalized === "TOTAL OVER" || normalized === "TOTAL UNDER") {
      return (
        trackerMarket(row) === "Total" &&
        trackerTotalSide(row).toUpperCase() === normalized.replace("TOTAL ", "") &&
        aiTrackerRowIsQualified(row)
      );
    }
    if (["OVER", "UNDER", "LEAN OVER", "LEAN UNDER", "STRONG OVER", "STRONG UNDER"].includes(normalized)) {
      return trackerMarket(row) !== "Total" && normalizeType(row["Bet Type"] || row.Market || "") === normalized;
    }
    return aiCanonicalBestPlayType(row["Bet Type"] || row.Market || "") === normalized;
  });
}

function aiSummaryForType(rows: SheetRow[], type: string) {
  const normalized = aiCanonicalBestPlayType(type);
  return buildTotals(normalized || "Play", aiRowsForType(rows, type));
}

function aiLastSevenBetsSummaryForType(rows: SheetRow[], type: string) {
  const normalized = aiCanonicalBestPlayType(type);
  const recentRows = aiRowsForType(rows, type)
    .map((row, index) => ({
      row,
      index,
      timestamp:
        parseNormalizedDate(row.Date || row.date || row["Bet Date"] || "")?.getTime() || 0,
    }))
    .sort((a, b) => b.timestamp - a.timestamp || b.index - a.index)
    .slice(0, 7)
    .map(({ row }) => row);
  return buildTotals(`${normalized || "Play"} - Last 7 Bets`, recentRows);
}

function aiPitcherBetTypeForm(record: RecordTotals): AiPitcherBetTypeForm {
  // Match page.tsx exactly: seven completed wagers are required; 5+ wins is
  // Hot, 5+ losses is Cold, and everything else is Neutral.
  if (record.totalBets < 7) return "SAMPLE";
  if (record.wins >= 5) return "HOT";
  if (record.losses >= 5) return "COLD";
  return "NEUTRAL";
}

function aiPitcherRequiredScore(_record: RecordTotals, form: AiPitcherBetTypeForm) {
  // Last-7 form changes the mandatory grade rather than changing the underlying
  // EZPZ score. Every Hot bucket receives the same 74 minimum regardless of
  // whether the rolling record is 5-2, 6-1, or 7-0.
  if (form === "HOT") return 74;
  if (form === "NEUTRAL") return 80;
  return 86; // SAMPLE stays strict; COLD is blocked before paid AI review.
}

type AiPitcherQualificationProfile = {
  score: number;
  probability: number;
  advantage: number;
  enforceProbability: boolean;
};

function aiPitcherQualificationProfile(
  form: AiPitcherBetTypeForm | undefined,
  record: RecordTotals | null = null,
): AiPitcherQualificationProfile {
  const normalizedForm = form || "SAMPLE";
  const score = aiPitcherRequiredScore(record || ({ wins: 0 } as RecordTotals), normalizedForm);

  if (normalizedForm === "HOT") {
    return { score, probability: 50, advantage: 1.5, enforceProbability: true };
  }
  if (normalizedForm === "NEUTRAL") {
    return { score, probability: 52.5, advantage: 3.25, enforceProbability: true };
  }
  return { score, probability: 55, advantage: 5, enforceProbability: true };
}

function aiHistoricalRecordType(candidate: AiSelectorCandidate) {
  if (candidate.bestPlayType) return aiCanonicalBestPlayType(candidate.bestPlayType);
  if (candidate.market === "Moneyline") return "MONEYLINE";
  if (candidate.market === "Total") {
    const side = String(candidate.selection || "").trim().toUpperCase();
    if (side === "OVER" || side === "UNDER") return `TOTAL ${side}`;
  }
  return "";
}

function aiLongTermRecordAdjustment(record: RecordTotals) {
  const decisions = record.wins + record.losses;
  if (decisions >= 20 && record.winPct >= 60) return 4;
  if (decisions >= 20 && record.winPct <= 42) return -5;
  if (decisions >= 10 && record.winPct >= 57) return 2;
  if (decisions >= 10 && record.winPct <= 45) return -3;
  return 0;
}

function aiRecentRecordConsistencyAdjustment(overall: RecordTotals, recent: RecordTotals) {
  const overallDecisions = overall.wins + overall.losses;
  const recentDecisions = recent.wins + recent.losses;
  if (overallDecisions < 10 || recentDecisions < 4) return 0;

  if (overall.winPct >= 55 && recent.winPct >= 65) {
    return recentDecisions >= 7 ? 2 : 1;
  }
  if (overall.winPct <= 47 && recent.winPct <= 35) {
    return recentDecisions >= 7 ? -2 : -1;
  }
  return 0;
}

function aiRecordAdjustments(candidate: AiSelectorCandidate, completedTrackerRows: SheetRow[]) {
  const recordType = aiHistoricalRecordType(candidate);
  if (!recordType) return;

  // Trend-only candidates are graded by their Trend Score and final external AI
  // approval. The model bet-type form gate applies only when this exact wager is
  // also backed by a Best Play.
  if (!candidate.bestPlayType) {
    candidate.dataStatus.push(
      "Trend-only candidate: Last 7 Bets model-grade gate does not apply",
    );
    return;
  }

  // Every Best Play market uses the same rolling Last-7-Bets qualification
  // system displayed on the public site. This includes pitcher props, A/B
  // Moneylines, Total Over/Under, and Elite NRFI/YRFI. Historical form changes
  // the mandatory score/probability/advantage gates; it does not inflate the
  // underlying EZPZ score. Cold buckets are deterministically excluded until
  // their rolling seven naturally improves.
  const lastSeven = aiLastSevenBetsSummaryForType(completedTrackerRows, recordType);
  const form = aiPitcherBetTypeForm(lastSeven);
  const profile = aiPitcherQualificationProfile(form, lastSeven);
  candidate.pitcherBetTypeForm = form;
  candidate.pitcherBetTypeRecord = lastSeven.record;
  candidate.pitcherRequiredScore = profile.score;

  if (form === "COLD") {
    candidate.protectionReasons.push(
      `${recordType} is Cold over its last 7 completed bets (${lastSeven.record}); Cold Best Play bet types are excluded from AI Picks until the rolling record improves`,
    );
    candidate.dataStatus.push(
      `${recordType} Last 7 Bets: Cold • ${lastSeven.record} • AI review skipped`,
    );
    return;
  }

  const label =
    form === "HOT" ? "Hot" : form === "NEUTRAL" ? "Neutral" : "Need 7 Bets";
  candidate.dataStatus.push(
    `${recordType} Last 7 Bets: ${label} • ${lastSeven.record} • minimum score ${profile.score} • minimum probability ${profile.probability}% • minimum advantage ${profile.advantage}%`,
  );
  candidate.historicalNotes.push(
    form === "SAMPLE"
      ? `${recordType} Last 7 Bets: Need 7 Bets • ${lastSeven.totalBets}/7 completed`
      : `${recordType} Last 7 Bets: ${label} • ${lastSeven.record}`,
  );

  if (form === "HOT") {
    candidate.whySelected.push(
      `${recordType} is Hot over its last 7 completed bets (${lastSeven.record}); Best Play gates are score 74+, estimated probability 50%+, and estimated advantage 1.5%+`,
    );
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
  if (!parseAmericanOdds(candidate.odds) && parseAmericanOdds(split.odds)) {
    candidate.odds = split.odds;
    candidate.marketImpliedProbability = aiImpliedProbability(split.odds);
    candidate.dataStatus.push("Playable odds filled from the matched DraftKings snapshot");
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

function aiFirstInningDirectionContext(
  market: AiPickMarket,
  selection: unknown,
  line: unknown,
  slateRow: SheetRow | null,
) {
  const grade = normalizeType(
    firstValue(slateRow || undefined, [
      "NRFI Grade",
      "First Inning Grade",
      "NRFI/YRFI Grade",
    ]),
  );
  const side = grade.includes("YRFI")
    ? "YRFI"
    : grade.includes("NRFI")
      ? "NRFI"
      : "";
  const meaning = side === "YRFI"
    ? "Yes Run First Inning: at least one first-inning run, a pro-scoring signal"
    : side === "NRFI"
      ? "No Run First Inning: no first-inning run, an anti-scoring signal"
      : "";
  const totalSide = String(selection || "").trim().toUpperCase();
  const elite = grade === "ELITE YRFI" || grade === "ELITE NRFI";
  const conflicts =
    market === "Total" &&
    elite &&
    ((totalSide === "UNDER" && side === "YRFI") ||
      (totalSide === "OVER" && side === "NRFI"));
  const aligns =
    market === "Total" &&
    elite &&
    ((totalSide === "UNDER" && side === "NRFI") ||
      (totalSide === "OVER" && side === "YRFI"));
  const totalLabel = `${String(selection || "Total").trim()} ${String(line || "").trim()}`
    .replace(/\s+/g, " ")
    .trim();
  const relationship = conflicts ? "CONFLICTS" : aligns ? "ALIGNS" : "UNRELATED";
  const reason = conflicts
    ? `${grade} means ${meaning}. It directionally conflicts with ${totalLabel} and cannot be used as support for that full-game total.`
    : aligns
      ? `${grade} is directionally consistent with ${totalLabel}, but it covers only the first inning and is not sufficient evidence for a full-game total by itself.`
      : "";

  return { grade, side, meaning, relationship, reason };
}

function aiApplyFirstInningTotalDirection(candidate: AiSelectorCandidate) {
  const context = aiFirstInningDirectionContext(
    candidate.market,
    candidate.selection,
    candidate.line,
    candidate.slateRow,
  );
  if (!context.side) return;

  candidate.dataStatus.push(`${context.grade}: ${context.meaning}`);
  if (context.relationship === "CONFLICTS") {
    candidate.protectionReasons.push(context.reason);
    candidate.risks.push(context.reason);
  } else if (context.relationship === "ALIGNS") {
    candidate.dataStatus.push(context.reason);
  }
}

function aiProtectionChecks(candidate: AiSelectorCandidate) {
  if (!candidate.slateRow) candidate.protectionReasons.push("The candidate could not be matched to today’s saved slate");
  // Game-start gating is enforced in the selector lifecycle so an interrupted
  // FINAL_PREGAME review can retry without allowing a new live/in-game pick.
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
  // Preserve the strikeout model's score so pitcher props compete on their
  // actual model strength instead of entering the selector at a shared baseline.
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
    const blend = aiTrendBlendWeights(play);
    existing.source = "Best + Trend";
    existing.trendPlay = play;
    existing.trendTier = play.tier;
    existing.trendScore = Number(play.score || 0);
    existing.baselineProbability = aiClamp(
      existing.baselineProbability * blend.modelWeight +
        trendProbability * blend.trendWeight +
        1.5,
      44,
      78,
    );
    existing.scoreAdjustment += 5;
    existing.whySelected.push(`Also qualified as a ${play.tier} Trend Play`);
    existing.whySelected.push("Model and trend systems agree");
    existing.whySelected.push(
      `Trend history receives ${Math.round(blend.trendWeight * 100)}% weight from about ${blend.effectiveSample.toFixed(1)} effective historical decisions`,
    );
    if (!existing.odds) existing.odds = play.odds || "";
    return;
  }
  const odds = play.odds || "";
  const trendHistoryAdjustment = aiTrendOnlyHistoryAdjustment(play);
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
    whySelected: [
      `Qualified as a ${play.tier} Trend Play`,
      ...(trendHistoryAdjustment.score > 0
        ? [`Trend record is backed by about ${trendHistoryAdjustment.effectiveSample.toFixed(1)} effective historical decisions`]
        : []),
    ],
    historicalNotes: [
      `Trend evidence sample: about ${trendHistoryAdjustment.effectiveSample.toFixed(1)} effective historical decisions`,
    ],
    risks: trendHistoryAdjustment.score < 0
      ? [`Trend-only sample is still limited at about ${trendHistoryAdjustment.effectiveSample.toFixed(1)} effective historical decisions`]
      : [],
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
    scoreAdjustment: trendHistoryAdjustment.score,
    probabilityAdjustment: trendHistoryAdjustment.probability,
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
  for (const play of bestPlays) {
    const candidate = aiCandidateFromBestPlay(play, slateRows, today);
    if (candidate) candidateMap.set(candidate.candidateId, candidate);
  }
  for (const play of aiPendingTotalBestPlays(trackerRows, today)) {
    const candidate = aiCandidateFromBestPlay(play, slateRows, today);
    if (candidate && !candidateMap.has(candidate.candidateId)) {
      candidateMap.set(candidate.candidateId, candidate);
    }
  }
  for (const play of trendPlays) aiMergeTrendCandidate(candidateMap, play, slateRows, today);

  for (const candidate of candidateMap.values()) {
    aiRecordAdjustments(candidate, completedTrackerRows);
    aiApplyMarketContext(candidate, draftKings);
    aiApplyFirstInningTotalDirection(candidate);
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

function aiResponseCompletedWebSearch(payload: any) {
  return (payload?.output || []).some(
    (item: any) =>
      item?.type === "web_search_call" &&
      (!item?.status || item.status === "completed"),
  );
}

type AiExternalReviewRequestResult = {
  reviews: Map<string, AiExternalReview>;
  status: AiPickExternalStatus;
  errors: Map<string, string>;
};

type AiGameResearchCacheEntry = {
  savedAt: number;
  reviews: Map<string, AiExternalReview> | null;
  error: string;
};

// Successful game research can be reused during normal public-route refreshes.
// Failed calls get only a short cool-down so a temporary timeout or incomplete
// response can recover before first pitch without repeatedly buying retries.
const AI_GAME_RESEARCH_CACHE_TTL_MS = 30 * 60_000;
const AI_GAME_RESEARCH_ERROR_CACHE_TTL_MS = 75_000;
const AI_GAME_REVIEW_MAX_CANDIDATES = 5;
const aiGameResearchCache = new Map<string, AiGameResearchCacheEntry>();
const aiGameResearchInFlight = new Map<
  string,
  Promise<Map<string, AiExternalReview>>
>();

function aiGameResearchRequestKey(candidates: AiSelectorCandidate[]) {
  const anchor = candidates[0];
  const candidateIds = candidates
    .map((candidate) => candidate.candidateId)
    .sort()
    .join("||");
  return `${AI_PICK_SELECTOR_VERSION}|${anchor?.gameKey || "unknown-game"}|${candidateIds}`;
}

function aiCandidateResearchPayload(candidate: AiSelectorCandidate) {
  const firstInningContext = aiFirstInningDirectionContext(
    candidate.market,
    candidate.selection,
    candidate.line,
    candidate.slateRow,
  );
  const bestPlayProfile = candidate.bestPlayType
    ? aiPitcherQualificationProfile(candidate.pitcherBetTypeForm)
    : null;
  return {
    candidateId: candidate.candidateId,
    game: candidate.game,
    gameTime: candidate.gameTime,
    market: candidate.market,
    play: candidate.play,
    odds: candidate.odds,
    source: candidate.source,
    modelScore: candidate.modelScore,
    underlyingPitcherKModelScore:
      candidate.market === "Pitcher Strikeouts" ? parseScore(candidate.bestPlay?.score || 0) : undefined,
    pitcherKGrade:
      candidate.market === "Pitcher Strikeouts" ? candidate.bestPlayType : undefined,
    bestPlayLast7BetsForm:
      candidate.bestPlayType ? candidate.pitcherBetTypeForm : undefined,
    bestPlayLast7BetsRecord:
      candidate.bestPlayType ? candidate.pitcherBetTypeRecord : undefined,
    bestPlayQualificationThresholds:
      bestPlayProfile
        ? {
            score: candidate.pitcherRequiredScore || bestPlayProfile.score,
            estimatedProbability: bestPlayProfile.probability,
            estimatedAdvantage: bestPlayProfile.advantage,
          }
        : undefined,
    // Keep pitcher-specific aliases for compatibility with older debug/review payloads.
    pitcherLast7BetsForm:
      candidate.market === "Pitcher Strikeouts" ? candidate.pitcherBetTypeForm : undefined,
    pitcherLast7BetsRecord:
      candidate.market === "Pitcher Strikeouts" ? candidate.pitcherBetTypeRecord : undefined,
    pitcherQualificationThresholds:
      candidate.market === "Pitcher Strikeouts" && bestPlayProfile
        ? {
            score: candidate.pitcherRequiredScore || bestPlayProfile.score,
            estimatedProbability: bestPlayProfile.probability,
            estimatedAdvantage: bestPlayProfile.advantage,
          }
        : undefined,
    trendScore: candidate.trendScore,
    baselineProbability: aiRound(candidate.baselineProbability + candidate.probabilityAdjustment, 1),
    awayTeam: candidate.awayTeam,
    homeTeam: candidate.homeTeam,
    line: candidate.line,
    aiScoreBeforeResearch: aiRound(
      (candidate.source === "Best + Trend"
        ? candidate.modelScore * aiTrendBlendWeights(candidate.trendPlay).modelWeight +
          candidate.trendScore * aiTrendBlendWeights(candidate.trendPlay).trendWeight
        : candidate.modelScore || candidate.trendScore) + candidate.scoreAdjustment,
      1,
    ),
    estimatedAdvantageBeforeResearch: aiRound(
      (candidate.baselineProbability + candidate.probabilityAdjustment) -
        (candidate.marketImpliedProbability || aiImpliedProbability(candidate.odds)),
      1,
    ),
    existingWhy: candidate.whySelected.slice(0, 6),
    firstInningSignal: firstInningContext.side
      ? {
          grade: firstInningContext.grade,
          definition: firstInningContext.meaning,
          relationshipToCandidate: firstInningContext.relationship,
          interpretationRule:
            firstInningContext.reason ||
            "Treat NRFI/YRFI as a first-inning-only signal, not proof of a nine-inning total.",
        }
      : undefined,
  };
}

function aiGameResearchPayload(candidates: AiSelectorCandidate[]) {
  const anchor = candidates[0];
  if (!anchor) throw new Error("OpenAI game research requires at least one candidate");
  // The old payload allowed 90 cells at 500 characters each. That can become
  // more than ten thousand input tokens for one game, even though most cells
  // do not help the final decision. Keep the useful model context, prioritize
  // it by wager type, and cap it at a predictable low-cost size.
  const maxFields = 36;
  const maxValueLength = 280;
  const hasPitcherProp = candidates.some(
    (candidate) => candidate.market === "Pitcher Strikeouts",
  );
  const fieldPriority = (key: string) => {
    const normalized = textKey(key);
    if (
      normalized.includes("starting pitcher") ||
      normalized.includes("starter") ||
      normalized.includes("away pitcher") ||
      normalized.includes("home pitcher") ||
      normalized.includes("bulk pitcher") ||
      normalized.includes("opener")
    ) return 0;
    if (
      hasPitcherProp &&
      (normalized.includes("strikeout") ||
        normalized.includes("pitcher k") ||
        normalized.includes("whiff") ||
        normalized.includes("arsenal") ||
        normalized.includes("pitch mix") ||
        normalized.includes("reliability"))
    ) return 1;
    if (
      normalized.includes("lineup") ||
      normalized.includes("batter") ||
      normalized.includes("hitter") ||
      normalized.includes("handed")
    ) return 2;
    if (
      normalized.includes("bullpen") ||
      normalized.includes("fatigue") ||
      normalized.includes("rest") ||
      normalized.includes("leash") ||
      normalized.includes("pitch count") ||
      normalized.includes("innings")
    ) return 3;
    if (normalized.includes("recent") || normalized.includes("last 3") || normalized.includes("last 5")) return 4;
    if (normalized.includes("history") || normalized.includes("versus") || normalized.includes(" bvp")) return 5;
    if (
      normalized.includes("projection") ||
      normalized.includes("probability") ||
      normalized.includes("model") ||
      normalized.includes("moneyline") ||
      normalized.includes("total")
    ) return 6;
    if (
      normalized.includes("weather") ||
      normalized.includes("park") ||
      normalized.includes("umpire") ||
      normalized.includes("nrfi") ||
      normalized.includes("yrfi")
    ) return 7;
    return 20;
  };

  const modelGameContext = anchor.slateRow
    ? Object.fromEntries(
        Object.entries(anchor.slateRow)
          .map(([key, value], index) => ({ key, value, index, priority: fieldPriority(key) }))
          .filter(({ key, value }) => {
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
              k.includes("recent") ||
              k.includes("last 3") ||
              k.includes("last 5") ||
              k.includes("history") ||
              k.includes("versus") ||
              k.includes("vs ") ||
              k.includes("bvp") ||
              k.includes("split") ||
              k.includes("handed") ||
              k.includes("arsenal") ||
              k.includes("pitch mix") ||
              k.includes("velocity") ||
              k.includes("whiff") ||
              k.includes("strikeout") ||
              k.includes("walk") ||
              k.includes("innings") ||
              k.includes("pitch count") ||
              k.includes("leash") ||
              k.includes("rest") ||
              k.includes("fatigue") ||
              k.includes("injur") ||
              k.includes("scratch") ||
              k.includes("projection") ||
              k.includes("probability") ||
              k.includes("moneyline") ||
              k.includes("total") ||
              k.includes("nrfi") ||
              k.includes("yrfi") ||
              k.includes("weather") ||
              k.includes("park") ||
              k.includes("umpire") ||
              k.includes("reliability")
            );
          })
          .sort((a, b) => a.priority - b.priority || a.index - b.index)
          .slice(0, maxFields)
          .map(({ key, value }) => [key, String(value).slice(0, maxValueLength)]),
      )
    : {};

  return {
    gameKey: anchor.gameKey,
    date: anchor.date,
    game: anchor.game,
    gameTime: anchor.gameTime,
    awayTeam: anchor.awayTeam,
    homeTeam: anchor.homeTeam,
    modelGameContext,
    candidates: candidates.map((candidate) => aiCandidateResearchPayload(candidate)),
  };
}

function aiGameExternalReviewSchema(candidateCount: number) {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "contextSummary",
      "startingPitching",
      "bullpenAnalysis",
      "recentTeamForm",
      "historicalMatchup",
      "candidateReviews",
    ],
    properties: {
      contextSummary: { type: "string", minLength: 20, maxLength: 220 },
      startingPitching: { type: "string", minLength: 20, maxLength: 360 },
      bullpenAnalysis: { type: "string", minLength: 15, maxLength: 260 },
      recentTeamForm: { type: "string", minLength: 15, maxLength: 260 },
      historicalMatchup: { type: "string", minLength: 12, maxLength: 240 },
      candidateReviews: {
        type: "array",
        minItems: candidateCount,
        maxItems: candidateCount,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "adjustment",
            "approved",
            "criticalConflict",
            "criticalConflictReason",
            "confidenceReason",
            "why",
            "historicalNotes",
            "researchSummary",
            "selectionComparison",
            "finalVerdict",
          ],
          properties: {
            adjustment: { type: "number", minimum: -6, maximum: 6 },
            approved: { type: "boolean" },
            criticalConflict: { type: "boolean" },
            criticalConflictReason: { type: "string", maxLength: 200 },
            confidenceReason: {
              type: "array",
              items: { type: "string", maxLength: 160 },
              minItems: 1,
              maxItems: 2,
            },
            why: {
              type: "array",
              items: { type: "string", maxLength: 200 },
              minItems: 2,
              maxItems: 3,
            },
            historicalNotes: {
              type: "array",
              items: { type: "string", maxLength: 160 },
              maxItems: 1,
            },
            researchSummary: { type: "string", minLength: 24, maxLength: 260 },
            selectionComparison: { type: "string", minLength: 24, maxLength: 280 },
            finalVerdict: { type: "string", minLength: 16, maxLength: 200 },
          },
        },
      },
    },
  };
}

function sanitizeAiExternalReview(review: AiExternalReview): AiExternalReview {
  return {
    ...review,
    adjustment: aiClamp(Number(review.adjustment || 0), -6, 6),
    approved: review.approved === true,
    confidenceReason: sanitizeAiPublicList(review.confidenceReason, 6),
    why: sanitizeAiPublicList(review.why, 8),
    historicalNotes: sanitizeAiPublicList(review.historicalNotes, 5),
    risks: [],
    researchSummary: sanitizeAiPublicText(review.researchSummary),
    verdict: sanitizeAiPublicText(review.verdict),
    contextSummary: sanitizeAiPublicText(review.contextSummary),
    startingPitching: sanitizeAiPublicText(review.startingPitching),
    bullpenAnalysis: sanitizeAiPublicText(review.bullpenAnalysis),
    recentTeamForm: sanitizeAiPublicText(review.recentTeamForm),
    historicalMatchup: sanitizeAiPublicText(review.historicalMatchup),
    selectionComparison: sanitizeAiPublicText(review.selectionComparison),
    mainRisk: "",
    finalVerdict: sanitizeAiPublicText(review.finalVerdict),
  };
}

function aiExternalReviewIsComplete(review: AiExternalReview, candidateId: string) {
  return (
    review.candidateId === candidateId &&
    review.startingPitching.length >= 20 &&
    review.bullpenAnalysis.length >= 15 &&
    review.recentTeamForm.length >= 15 &&
    review.historicalMatchup.length >= 12 &&
    review.selectionComparison.length >= 24 &&
    review.finalVerdict.length >= 16 &&
    review.researchSummary.length >= 40 &&
    review.why.length >= 2
  );
}

function sanitizeAiGameCandidateReview(
  review: AiGameCandidateReview,
): AiGameCandidateReview {
  return {
    candidateId: String(review?.candidateId || "").trim(),
    adjustment: aiClamp(Number(review?.adjustment || 0), -6, 6),
    approved: review?.approved === true,
    criticalConflict: review?.criticalConflict === true,
    criticalConflictReason: sanitizeAiPublicText(review?.criticalConflictReason),
    confidenceReason: sanitizeAiPublicList(review?.confidenceReason, 3),
    why: sanitizeAiPublicList(review?.why, 5),
    historicalNotes: sanitizeAiPublicList(review?.historicalNotes, 2),
    researchSummary: sanitizeAiPublicText(review?.researchSummary),
    selectionComparison: sanitizeAiPublicText(review?.selectionComparison),
    finalVerdict: sanitizeAiPublicText(review?.finalVerdict),
  };
}

function sanitizeAiGameExternalReview(
  review: AiGameExternalReview,
  expectedGameKey: string,
): AiGameExternalReview {
  return {
    // The API call is already scoped to one known game. Do not make the model
    // copy an opaque game key back into its JSON; a harmless punctuation or
    // team-name variation used to invalidate an otherwise complete review.
    gameKey: expectedGameKey,
    contextSummary: sanitizeAiPublicText(review?.contextSummary),
    startingPitching: sanitizeAiPublicText(review?.startingPitching),
    bullpenAnalysis: sanitizeAiPublicText(review?.bullpenAnalysis),
    recentTeamForm: sanitizeAiPublicText(review?.recentTeamForm),
    historicalMatchup: sanitizeAiPublicText(review?.historicalMatchup),
    candidateReviews: Array.isArray(review?.candidateReviews)
      ? review.candidateReviews.map(sanitizeAiGameCandidateReview)
      : [],
  };
}

function aiGameExternalReviewIsComplete(
  review: AiGameExternalReview,
  candidates: AiSelectorCandidate[],
) {
  const anchor = candidates[0];
  if (!anchor || review.gameKey !== anchor.gameKey) return false;
  if (
    review.contextSummary.length < 20 ||
    review.startingPitching.length < 20 ||
    review.bullpenAnalysis.length < 15 ||
    review.recentTeamForm.length < 15 ||
    review.historicalMatchup.length < 12 ||
    review.candidateReviews.length !== candidates.length
  ) {
    return false;
  }

  // Candidate reviews are intentionally mapped by their required array order.
  // This avoids asking the model to reproduce long, punctuation-sensitive IDs
  // while the exact min/max array size still guarantees one decision per play.
  return review.candidateReviews.every(
    (item) =>
      item.confidenceReason.length >= 1 &&
      item.why.length >= 2 &&
      item.researchSummary.length >= 24 &&
      item.selectionComparison.length >= 24 &&
      item.finalVerdict.length >= 16,
  );
}

function aiExternalReviewsFromGameReview(
  gameReview: AiGameExternalReview,
  candidates: AiSelectorCandidate[],
) {
  const reviews = new Map<string, AiExternalReview>();
  for (const [index, candidate] of candidates.entries()) {
    const item = gameReview.candidateReviews[index];
    if (!item) continue;
    const review = sanitizeAiExternalReview({
      candidateId: candidate.candidateId,
      adjustment: item.adjustment,
      approved: item.approved,
      criticalConflict: item.criticalConflict,
      criticalConflictReason: item.criticalConflictReason,
      confidenceReason: item.confidenceReason,
      why: item.why,
      historicalNotes: item.historicalNotes,
      risks: [],
      researchSummary: `${gameReview.contextSummary} ${item.researchSummary}`.trim(),
      verdict: item.finalVerdict,
      contextSummary: gameReview.contextSummary,
      startingPitching: gameReview.startingPitching,
      bullpenAnalysis: gameReview.bullpenAnalysis,
      recentTeamForm: gameReview.recentTeamForm,
      historicalMatchup: gameReview.historicalMatchup,
      selectionComparison: item.selectionComparison,
      mainRisk: "",
      finalVerdict: item.finalVerdict,
    });
    if (!aiExternalReviewIsComplete(review, candidate.candidateId)) continue;
    reviews.set(candidate.candidateId, review);
  }
  return reviews;
}

async function fetchSingleAiGameExternalReviews(
  candidates: AiSelectorCandidate[],
  outputTokenOverride?: number,
): Promise<Map<string, AiExternalReview>> {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) throw new Error("OpenAI API key is not configured");
  const anchor = candidates[0];
  if (!anchor) throw new Error("OpenAI game research requires at least one candidate");
  if (candidates.some((candidate) => candidate.gameKey !== anchor.gameKey)) {
    throw new Error("OpenAI game research received candidates from multiple games");
  }

  const scheduledStartMs = anchor.slateRow
    ? scheduledGameStart(anchor.slateRow)
    : null;
  const remainingPregameMs = scheduledStartMs == null
    ? null
    : scheduledStartMs - Date.now();
  if (remainingPregameMs != null && remainingPregameMs <= 15_000) {
    throw new Error(
      "Final AI review was skipped because the scheduled start was too close or had passed",
    );
  }

  const model = String(process.env.EZPZ_AI_SELECTOR_MODEL || "gpt-5-mini").trim();
  const configuredSearchContextSize = String(
    process.env.EZPZ_AI_SEARCH_CONTEXT_SIZE || "low",
  ).trim();
  const searchContextSize: "low" | "medium" | "high" = ["low", "medium", "high"].includes(
    configuredSearchContextSize,
  )
    ? (configuredSearchContextSize as "low" | "medium" | "high")
    : "low";
  const configuredMaxRaw = Number(
    process.env.EZPZ_AI_MAX_GAME_OUTPUT_TOKENS || 2600,
  );
  const configuredMax = Number.isFinite(configuredMaxRaw) ? configuredMaxRaw : 2600;
  const candidateScaledMinimum = 1500 + candidates.length * 360;
  const maxOutputTokens = outputTokenOverride ?? Math.max(
    1800,
    Math.min(3600, Math.max(configuredMax, candidateScaledMinimum)),
  );
  const configuredTimeoutRaw = Number(process.env.EZPZ_AI_REQUEST_TIMEOUT_MS || 55_000);
  const configuredRequestTimeoutMs = Number.isFinite(configuredTimeoutRaw)
    ? Math.max(15_000, Math.min(75_000, configuredTimeoutRaw))
    : 55_000;
  // A late-pregame fallback must never keep researching after first pitch. End
  // the request five seconds before the scheduled start when that deadline is
  // sooner than the normal timeout.
  const requestTimeoutMs = remainingPregameMs == null
    ? configuredRequestTimeoutMs
    : Math.min(
        configuredRequestTimeoutMs,
        Math.max(10_000, remainingPregameMs - 5_000),
      );
  const gamePayload = aiGameResearchPayload(candidates);
  const schema = aiGameExternalReviewSchema(candidates.length);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
      model,
      store: false,
      // OpenAI limits this routing key to 64 characters. Keep it short and
      // stable so same-version game reviews still share prompt-cache affinity.
      prompt_cache_key: "ezpz-ai-game-v13",
      tools: [
        {
          type: "web_search",
          search_context_size: searchContextSize,
          user_location: {
            type: "approximate",
            country: "US",
            region: "Florida",
            timezone: "America/New_York",
          },
        },
      ],
      tool_choice: "required",
      max_tool_calls: 1,
      parallel_tool_calls: false,
      reasoning: { effort: "low" },
      max_output_tokens: maxOutputTokens,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: `You are the final pregame MLB research analyst for EZPZ AI Picks. Use one web search to research this one game, then evaluate every supplied candidate using the same verified pregame facts. Never use information from after first pitch and do not invent statistics.

Use modelGameContext as the primary quantitative source. Verify only decision-relevant details: probable/confirmed starters, projected lineups, recent 3-5-start form, workload/leash, bullpen availability, meaningful matchup or split evidence, and weather/park only if material. State plainly when a split or history sample is unavailable or too small.

The shared fields must be concise but matchup-specific: startingPitching names both starters and any prop pitcher; bullpenAnalysis covers availability or says no material concern was verified; recentTeamForm covers both teams; historicalMatchup includes sample context or says no meaningful sample exists.

Return candidateReviews in exactly the same order as the supplied candidates, with exactly one item for each. approved=true means the wager still deserves publication after research. approved=false is a final veto for materially negative evidence; it is not limited to critical conflicts. Use a small adjustment from -6 to +6, and use 0 when research does not change the supplied quantitative case. Each candidate needs two or three concise WHY bullets focused on the actual reason it cleared or failed—never a public risk list. For any candidate backed by a Best Play, its exact Best Play bet type uses the rolling Last-7-Bets quantitative gates: Hot = 74 score / 50% probability / 1.5% advantage; Neutral = 80 / 52.5% / 3.25%; Small Sample = 86 / 55% / 5%; Cold is excluded before review. This applies to pitcher props, A/B Moneylines, Total Over/Under, and Elite NRFI/YRFI. A Trend-Play-only candidate is not subject to the model bet-type form gate; its quantitative qualification is its qualifying Trend Score, while your final approved=true/false review remains the final publication decision.

For Pitcher Strikeouts, treat the supplied AI score as the strikeout model's differentiated assessment, not a win probability or automatic approval. Preserve the model's score distinctions unless verified research justifies the permitted small adjustment. Test the projection versus line, opposing lineup K/contact tendencies, pitcher arsenal/whiff fit, recent starts, innings/pitch count/leash, relevant history sample, and whether today’s lineup differs from generic team rates. A negative net assessment must be approved=false.

YRFI is pro-scoring and NRFI is anti-scoring. ELITE YRFI conflicts with a full-game Under; ELITE NRFI conflicts with a full-game Over. If firstInningSignal says CONFLICTS, approve=false and do not cite it positively.

Keep selectionComparison and finalVerdict direct and wager-specific. Do not include URLs, citations, source labels, domains, markdown, or generic filler. Return only the required JSON object.`,
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Current Eastern time: ${nowET()}\nResearch this game once and review every candidate:\n${JSON.stringify(gamePayload)}`,
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "ezpz_ai_selector_game_review",
          strict: true,
          schema,
        },
      },
      }),
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`OpenAI selector review timed out after ${requestTimeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI selector review failed (${response.status}): ${detail.slice(0, 300)}`);
  }

  const payload = await response.json();
  if (payload?.status === "incomplete") {
    const reason = String(payload?.incomplete_details?.reason || "unknown reason");
    throw new Error(`OpenAI selector review was incomplete (${reason})`);
  }

  if (!aiResponseCompletedWebSearch(payload)) {
    throw new Error("OpenAI selector did not complete the required game web search");
  }

  const raw = aiResponseOutputText(payload).trim();
  if (!raw) throw new Error("OpenAI selector returned no structured game review");

  let parsed: AiGameExternalReview;
  try {
    parsed = JSON.parse(raw) as AiGameExternalReview;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `OpenAI selector returned invalid structured game JSON (${String(payload?.status || "unknown")}): ${message}`,
    );
  }

  const gameReview = sanitizeAiGameExternalReview(parsed, anchor.gameKey);
  if (!aiGameExternalReviewIsComplete(gameReview, candidates)) {
    throw new Error("OpenAI selector returned an incomplete required game review");
  }
  const reviews = aiExternalReviewsFromGameReview(gameReview, candidates);
  if (reviews.size !== candidates.length) {
    throw new Error("OpenAI selector did not return a complete decision for every game candidate");
  }
  return reviews;
}

async function requestSingleAiGameExternalReviews(
  candidates: AiSelectorCandidate[],
): Promise<Map<string, AiExternalReview>> {
  const requestKey = aiGameResearchRequestKey(candidates);
  const cached = aiGameResearchCache.get(requestKey);
  const cacheAgeMs = cached ? Date.now() - cached.savedAt : Number.POSITIVE_INFINITY;
  if (cached && cacheAgeMs < AI_GAME_RESEARCH_CACHE_TTL_MS) {
    if (cached.error) {
      if (cacheAgeMs < AI_GAME_RESEARCH_ERROR_CACHE_TTL_MS) {
        throw new Error(cached.error);
      }
      aiGameResearchCache.delete(requestKey);
    } else {
      return new Map(cached.reviews || []);
    }
  }

  const existingRequest = aiGameResearchInFlight.get(requestKey);
  if (existingRequest) return new Map(await existingRequest);

  const request = (async () => {
    try {
      return await fetchSingleAiGameExternalReviews(candidates);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Structured Outputs reports a precise reason when the response reaches
      // max_output_tokens. Retry only that rare recoverable condition with a
      // modest ceiling; normal calls remain compact and inexpensive.
      if (!/incomplete\s*\(\s*max_output_tokens\s*\)/i.test(message)) {
        throw error;
      }
      const fallbackOutputTokens = Math.max(
        3200,
        Math.min(4200, 2200 + candidates.length * 400),
      );
      return fetchSingleAiGameExternalReviews(candidates, fallbackOutputTokens);
    }
  })();
  aiGameResearchInFlight.set(requestKey, request);
  try {
    const reviews = await request;
    aiGameResearchCache.set(requestKey, {
      savedAt: Date.now(),
      reviews: new Map(reviews),
      error: "",
    });
    return new Map(reviews);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    aiGameResearchCache.set(requestKey, {
      savedAt: Date.now(),
      reviews: null,
      error: message,
    });
    throw error;
  } finally {
    aiGameResearchInFlight.delete(requestKey);
  }
}

function aiGameReviewGroups(candidates: AiSelectorCandidate[]) {
  const byGame = new Map<string, AiSelectorCandidate[]>();
  for (const candidate of candidates) {
    const group = byGame.get(candidate.gameKey) || [];
    group.push(candidate);
    byGame.set(candidate.gameKey, group);
  }

  const groups: AiSelectorCandidate[][] = [];
  for (const group of byGame.values()) {
    for (let index = 0; index < group.length; index += AI_GAME_REVIEW_MAX_CANDIDATES) {
      groups.push(group.slice(index, index + AI_GAME_REVIEW_MAX_CANDIDATES));
    }
  }
  return groups;
}

async function requestAiExternalReviews(
  candidates: AiSelectorCandidate[],
): Promise<AiExternalReviewRequestResult> {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey || !candidates.length) {
    return {
      reviews: new Map(),
      status: apiKey ? "NO_VERIFIED_CONTEXT" : "NOT_CONFIGURED",
      errors: new Map(),
    };
  }

  const reviews = new Map<string, AiExternalReview>();
  const errors = new Map<string, string>();
  const reviewGroups = aiGameReviewGroups(candidates);
  const configuredConcurrency = Number(process.env.EZPZ_AI_REVIEW_CONCURRENCY || 4);
  const concurrency = Number.isFinite(configuredConcurrency)
    ? Math.max(1, Math.min(4, Math.floor(configuredConcurrency)))
    : 4;
  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= reviewGroups.length) return;
      const group = reviewGroups[index];
      if (!group?.length) return;
      try {
        // One compact request and one web search per game. This keeps the cost
        // near the number of games, shares verified context across wagers, and
        // avoids the old per-play queue that could outlive the route timeout.
        const gameReviews = await requestSingleAiGameExternalReviews(group);
        for (const candidate of group) {
          const review = gameReviews.get(candidate.candidateId);
          if (review) {
            reviews.set(candidate.candidateId, review);
          } else {
            errors.set(candidate.candidateId, "AI review did not return this candidate decision");
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        for (const candidate of group) errors.set(candidate.candidateId, message);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, reviewGroups.length) }, () => worker()),
  );

  return {
    reviews,
    status: errors.size ? "REVIEW_ERROR" : "WEB_REVIEWED",
    errors,
  };
}

function finalizeAiCandidates(
  candidates: AiSelectorCandidate[],
  externalReviews: Map<string, AiExternalReview>,
  externalStatus: AiPickExternalStatus,
  snapshotStatus: AiPickSnapshotStatus,
  reviewErrors: Map<string, string> = new Map(),
) {
  const finalized = candidates.map((candidate) => {
    const deterministicallyBlocked = candidate.protectionReasons.length > 0;
    const review = externalReviews.get(candidate.candidateId);
    if (review) {
      candidate.scoreAdjustment += review.adjustment * 1.4;
      candidate.probabilityAdjustment += review.adjustment * 0.55;
      candidate.confidenceReason.push(...review.confidenceReason);
      candidate.confidenceReason.push(review.selectionComparison);
      candidate.whySelected.push(...review.why);
      candidate.whySelected.push(`Starting pitching: ${review.startingPitching}`);
      candidate.whySelected.push(`Bullpen: ${review.bullpenAnalysis}`);
      candidate.whySelected.push(`Recent form: ${review.recentTeamForm}`);
      candidate.whySelected.push(`Historical matchup: ${review.historicalMatchup}`);
      candidate.whySelected.push(`Why it cleared: ${review.selectionComparison}`);
      candidate.historicalNotes.push(...review.historicalNotes);
      candidate.historicalNotes.push(review.historicalMatchup);
      candidate.risks = [];
      candidate.researchSummary = [
        review.startingPitching,
        review.bullpenAnalysis,
        review.recentTeamForm,
        review.historicalMatchup,
        review.researchSummary,
      ].filter(Boolean).join(" ");
      candidate.verdict = review.finalVerdict || review.verdict || candidate.verdict;
      if (review.contextSummary) candidate.dataStatus.push(`External context: ${review.contextSummary}`);
      if (!review.approved) {
        candidate.protectionReasons.push(
          `Final AI review rejected this wager: ${review.finalVerdict || review.verdict || review.selectionComparison}`,
        );
      }
      if (review.criticalConflict) {
        candidate.protectionReasons.push(
          review.criticalConflictReason || "Verified external context invalidated a saved assumption",
        );
      }
    }
    const trendBlend = aiTrendBlendWeights(candidate.trendPlay);
    const baseScore = candidate.source === "Best + Trend"
      ? candidate.modelScore * trendBlend.modelWeight +
        candidate.trendScore * trendBlend.trendWeight
      : candidate.modelScore || candidate.trendScore;
    const aiScore = clampScore(baseScore + candidate.scoreAdjustment);
    const estimatedProbability = aiRound(
      aiClamp(candidate.baselineProbability + candidate.probabilityAdjustment, 40, 82),
      1,
    );
    const implied = candidate.marketImpliedProbability || aiImpliedProbability(candidate.odds);
    const advantage = implied ? aiRound(estimatedProbability - implied, 1) : 0;
    // A FINAL_PREGAME row is publishable only when this candidate actually
    // received a complete external review. Previously a failed/missed review
    // could still inherit the live selector score, remain selected, and be
    // displayed as a pending AI pick after the game started.
    if (snapshotStatus === "FINAL_PREGAME" && !review && !deterministicallyBlocked) {
      const failureDetail = sanitizeAiPublicText(
        reviewErrors.get(candidate.candidateId) || "",
      ).slice(0, 320);
      const reason = externalStatus === "NOT_CONFIGURED"
        ? "Final external AI review is not configured"
        : externalStatus === "REVIEW_ERROR"
          ? failureDetail
            ? `Final external AI review did not complete: ${failureDetail}`
            : "Final external AI review did not complete successfully"
          : "Final external AI review is incomplete";
      candidate.protectionReasons.push(reason);
      if (externalStatus === "REVIEW_ERROR") {
        candidate.dataStatus.push(`Final AI review failure: ${failureDetail || "no specific API error was returned"}`);
      }
    }
    const blocked = candidate.protectionReasons.length > 0;
    const bestPlayBacked = Boolean(candidate.bestPlayType);
    const trendOnlyCandidate = !bestPlayBacked && candidate.source === "Trend Play";

    // Any candidate backed by a Best Play uses the same rolling Last-7-Bets
    // form gate, regardless of market. Trend-only candidates qualify
    // quantitatively from their Trend Score alone; final external AI approval
    // is still required at the pregame lock.
    const bestPlayProfile = aiPitcherQualificationProfile(
      candidate.pitcherBetTypeForm,
    );
    const bestPlayRequiredScore =
      candidate.pitcherRequiredScore || bestPlayProfile.score;
    const selectionThresholds = trendOnlyCandidate
      ? {
          score: 60,
          probability: 0,
          advantage: 0,
          enforceProbability: false,
          enforceAdvantage: false,
        }
      : bestPlayBacked
        ? {
            score: bestPlayRequiredScore,
            probability: bestPlayProfile.probability,
            advantage: bestPlayProfile.advantage,
            enforceProbability: bestPlayProfile.enforceProbability,
            enforceAdvantage: true,
          }
        : {
            score: 74,
            probability: 55,
            advantage: AI_MINIMUM_ESTIMATED_ADVANTAGE,
            enforceProbability: true,
            enforceAdvantage: true,
          };
    const qualificationScore = trendOnlyCandidate
      ? Number(candidate.trendScore || 0)
      : aiScore;
    const thresholdFailure =
      qualificationScore < selectionThresholds.score
        ? `${trendOnlyCandidate ? "Trend score" : "AI score"} ${qualificationScore} did not reach the ${selectionThresholds.score} premium-play threshold`
        : selectionThresholds.enforceProbability &&
            estimatedProbability < selectionThresholds.probability
          ? `Estimated probability ${estimatedProbability.toFixed(1)}% did not reach ${selectionThresholds.probability}%`
          : selectionThresholds.enforceAdvantage && implied && advantage < selectionThresholds.advantage
            ? `Estimated advantage ${advantage.toFixed(1)}% did not reach ${selectionThresholds.advantage.toFixed(1)}%`
            : "";
    const preliminarySelected = !blocked && !thresholdFailure;
    const rejectionReason = blocked
      ? candidate.protectionReasons.join(" • ")
      : thresholdFailure;
    const liveBestPlayReviewNote =
      snapshotStatus === "LIVE" && bestPlayBacked && preliminarySelected
        ? `Pending final review: ${candidate.bestPlayType} is ${candidate.pitcherBetTypeForm || "SAMPLE"} over its last 7 completed bets (${candidate.pitcherBetTypeRecord || "0-0-0"}); final selection requires AI score ${bestPlayRequiredScore}+, estimated probability ${bestPlayProfile.probability.toFixed(1)}%+, estimated advantage ${bestPlayProfile.advantage.toFixed(2)}%+, and final AI approval.`
        : "";
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
      whySelected: sanitizeAiPublicList(
        liveBestPlayReviewNote
          ? [liveBestPlayReviewNote, ...candidate.whySelected]
          : candidate.whySelected,
        14,
      ),
      historicalNotes: sanitizeAiPublicList(candidate.historicalNotes, 5),
      risks: [],
      researchSummary: sanitizeAiPublicText(candidate.researchSummary),
      verdict: sanitizeAiPublicText(candidate.verdict),
      dataStatus: [
        ...new Set(
          [liveBestPlayReviewNote, ...candidate.dataStatus].filter(Boolean),
        ),
      ].slice(0, 5),
      externalReviewStatus: review
        ? "WEB_REVIEWED" as const
        : deterministicallyBlocked
          ? "NO_VERIFIED_CONTEXT" as const
          : externalStatus,
      snapshotStatus,
      lockedAt: snapshotStatus === "FINAL_PREGAME" ? nowET() : "",
      updatedAt: nowET(),
    };
  });

  const publicPicks = finalized.map(({ slateRow, bestPlay, trendPlay, baselineProbability, scoreAdjustment, probabilityAdjustment, protectionReasons, ...pick }) => pick as AiPick);

  // Moneylines and full-game totals are alternative exposures to the same game.
  // They can be researched independently, but only the stronger approved market
  // may survive. First-inning plays and pitcher props remain independently
  // eligible alongside that one full-game selection.
  return applyAiFullGameMarketLimit(publicPicks);
}

function aiFullGameMarketSourceRank(source: AiPickSource) {
  if (source === "Best + Trend") return 3;
  if (source === "Best Play") return 2;
  return 1;
}

function aiCompareFullGameMarkets(a: AiPick, b: AiPick) {
  if (b.aiScore !== a.aiScore) return b.aiScore - a.aiScore;
  if (b.estimatedAdvantage !== a.estimatedAdvantage) {
    return b.estimatedAdvantage - a.estimatedAdvantage;
  }
  if (b.estimatedProbability !== a.estimatedProbability) {
    return b.estimatedProbability - a.estimatedProbability;
  }
  const sourceDifference =
    aiFullGameMarketSourceRank(b.source) - aiFullGameMarketSourceRank(a.source);
  if (sourceDifference) return sourceDifference;
  return a.candidateId.localeCompare(b.candidateId);
}

function aiFullGameComparisonLine(pick: AiPick) {
  return `${pick.play} (AI ${pick.aiScore}, edge ${pick.estimatedAdvantage.toFixed(1)}%)`;
}

function applyAiFullGameMarketLimit(picks: AiPick[]) {
  const selectedByGame = new Map<string, AiPick[]>();

  for (const pick of picks) {
    if (!pick.selected || (pick.market !== "Moneyline" && pick.market !== "Total")) continue;
    const group = selectedByGame.get(pick.gameKey) || [];
    group.push(pick);
    selectedByGame.set(pick.gameKey, group);
  }

  const replacements = new Map<string, AiPick>();
  for (const group of selectedByGame.values()) {
    if (group.length < 2) continue;
    const ranked = [...group].sort(aiCompareFullGameMarkets);
    const winner = ranked[0];
    if (!winner) continue;
    const losers = ranked.slice(1);
    const stage = winner.snapshotStatus === "FINAL_PREGAME"
      ? "final reviewed"
      : "current pregame";
    const winnerReason =
      `Won the same-game Moneyline/Total comparison on ${stage} strength: ` +
      `${aiFullGameComparisonLine(winner)} ranked above ` +
      losers.map(aiFullGameComparisonLine).join(" and ");

    replacements.set(winner.candidateId, {
      ...winner,
      confidenceReason: sanitizeAiPublicList(
        [winnerReason, ...winner.confidenceReason],
        6,
      ),
      whySelected: sanitizeAiPublicList(
        [winnerReason, ...winner.whySelected],
        14,
      ),
      dataStatus: [
        "Same-game Moneyline/Total limit applied",
        ...winner.dataStatus.filter(
          (item) => item !== "Same-game Moneyline/Total limit applied",
        ),
      ].slice(0, 5),
    });

    for (const loser of losers) {
      const rejectionReason =
        `Same-game full-market limit: ${aiFullGameComparisonLine(winner)} ranked above ` +
        `${aiFullGameComparisonLine(loser)}. Only one Moneyline or Total can be selected for this game.`;
      replacements.set(loser.candidateId, {
        ...loser,
        selected: false,
        rejectionReason,
        verdict: rejectionReason,
        confidenceReason: sanitizeAiPublicList(
          [rejectionReason, ...loser.confidenceReason],
          6,
        ),
        dataStatus: [
          "Same-game Moneyline/Total limit applied",
          ...loser.dataStatus.filter(
            (item) => item !== "Same-game Moneyline/Total limit applied",
          ),
        ].slice(0, 5),
      });
    }
  }

  return picks.map((pick) => replacements.get(pick.candidateId) || pick);
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
        // The sheet columns are authoritative for grading. Details JSON is a
        // snapshot of the pick and can contain an older blank/stale result.
        const columnResult = resultCode(row.Result);
        const columnUnits = String(row.Units ?? "").trim();
        const columnResultUpdated = String(row["Result Updated"] || "").trim();
        return {
          ...parsed,
          result: columnResult || parsed.result || "",
          units: columnResult ? toNumber(columnUnits) : Number(parsed.units || 0),
          resultUpdated: columnResultUpdated || parsed.resultUpdated || "",
          confidenceReason: sanitizeAiPublicList(parsed.confidenceReason, 6),
          whySelected: sanitizeAiPublicList(parsed.whySelected, 14),
          historicalNotes: sanitizeAiPublicList(parsed.historicalNotes, 5),
          risks: [],
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
    whySelected: sanitizeAiPublicList(String(row["Why Selected"] || "").split("|"), 14),
    historicalNotes: sanitizeAiPublicList(String(row["Historical Matchup Notes"] || "").split("|"), 5),
    risks: [],
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
    selectorVersion: String(row["Selector Version"] || "legacy-unversioned"),
  };
}

let aiPickPersistenceQueue: Promise<void> = Promise.resolve();

function persistAiPickRows(finalPicks: AiPick[]) {
  if (!finalPicks.length) return Promise.resolve();

  const operation = aiPickPersistenceQueue.catch(() => undefined).then(async () => {
    const { spreadsheetId, sheets } = mainSheetsClient();
    // Re-read inside the serialized write so a stale route request cannot erase
    // picks or grades saved by another request earlier in the same instance.
    const matrix = await readWorksheetMatrixWithClient(
      sheets,
      spreadsheetId,
      AI_PICK_SELECTOR_TAB,
      AI_PICK_SELECTOR_HEADERS,
    );
    const map = new Map<string, SheetRow>();
    for (const row of matrix.rows.map((entry) => entry.object)) {
      const key = `${isoPublicDate(row.Date || "")}|${String(row["Candidate ID"] || "")}`;
      if (key !== "|") map.set(key, row);
    }
    for (const pick of finalPicks) {
      const key = `${pick.date}|${pick.candidateId}`;
      // Persist the supplied row. Finalized AI selections are protected earlier in
      // the review pipeline, while this writer must remain able to save grading
      // updates (Result / Units / Result Updated) after the game.
      map.set(key, aiPickRow(pick));
    }
    await writeWholeWorksheet(
      sheets,
      spreadsheetId,
      AI_PICK_SELECTOR_TAB,
      AI_PICK_SELECTOR_HEADERS,
      [...map.values()],
      matrix,
    );
  });

  aiPickPersistenceQueue = operation.catch(() => undefined);
  return operation;
}

function aiTeamIdentityValues(team: unknown) {
  const canonical = normalizeTeam(team);
  const aliases = [canonical, ...(MLB_TEAM_ALIASES[canonical] || [])];
  return [...new Set(aliases.map(textKey).filter(Boolean))];
}

function aiRowMatchesGame(pick: AiPick, row: SheetRow) {
  const pickAway = normalizeTeam(pick.awayTeam);
  const pickHome = normalizeTeam(pick.homeTeam);
  const rowAway = normalizeTeam(
    row["Away Team"] || row.Away || row["Away"] || row["Visitor Team"] || "",
  );
  const rowHome = normalizeTeam(
    row["Home Team"] || row.Home || row["Home"] || "",
  );

  const teamsMatch = Boolean(
    rowAway && rowHome && rowAway === pickAway && rowHome === pickHome,
  );
  if (rowAway && rowHome && !teamsMatch) return false;

  const pickGameKey = String(pick.gameKey || "").trim().replace(/\.0$/, "");
  const rowGameKey = String(row["Game Key"] || row["Game ID"] || "")
    .trim()
    .replace(/\.0$/, "");
  if (pickGameKey && rowGameKey) {
    const pickKeyTail = pickGameKey.split("|").pop() || pickGameKey;
    const rowKeyTail = rowGameKey.split("|").pop() || rowGameKey;
    if (pickGameKey === rowGameKey || pickKeyTail === rowKeyTail) return true;
  }

  const rowGame = textKey(
    row.Game || row["Game Label"] || row.Matchup || row["Match Up"] || "",
  );
  const pickGame = textKey(pick.game);
  if (pickGame && rowGame && rowGame === pickGame) return true;

  const gameNumber = (value: string) =>
    value.match(/\b(?:game|gm|dh)\s*#?\s*([12])\b/i)?.[1] || "";
  const pickGameNumber = gameNumber(String(pick.game || ""));
  const rowGameNumber = gameNumber(
    String(row.Game || row["Game Label"] || row.Matchup || row["Match Up"] || ""),
  );
  if (pickGameNumber && rowGameNumber && pickGameNumber !== rowGameNumber) {
    return false;
  }

  const pickStart = scheduledGameStart({ Date: pick.date, "Game Time": pick.gameTime });
  const rowStart = scheduledGameStart(row);
  if (pickStart != null && rowStart != null && Math.abs(pickStart - rowStart) > 30 * 60_000) {
    return false;
  }

  if (teamsMatch) return true;
  if (!rowGame) return false;

  const awayAliases = aiTeamIdentityValues(pickAway);
  const homeAliases = aiTeamIdentityValues(pickHome);
  return (
    awayAliases.some((alias) => rowGame.split(" ").includes(alias) || rowGame.includes(alias)) &&
    homeAliases.some((alias) => rowGame.split(" ").includes(alias) || rowGame.includes(alias))
  );
}

function aiPickTrackerMatch(pick: AiPick, trackerRows: SheetRow[]): SheetRow | null {
  const date = isoPublicDate(pick.date);
  const sameDateRows = trackerRows.filter(
    (row) => isoPublicDate(row.Date || row["Bet Date"] || "") === date,
  );

  if (pick.market === "First Inning") {
    const selectedType = normalizeType(pick.selection);
    const sameSideRows = sameDateRows.filter((row) => {
      const type = normalizeType(
        row["Bet Type"] || row.Market || row.Selection || row.Play || "",
      );
      return selectedType.includes("YRFI")
        ? type.includes("YRFI")
        : selectedType.includes("NRFI") && type.includes("NRFI") && !type.includes("YRFI");
    });
    const exactGame = sameSideRows.filter((row) => aiRowMatchesGame(pick, row));
    if (exactGame.length) {
      return exactGame.find((row) => Boolean(resultCode(row.Result))) || exactGame[0] || null;
    }

    // Some legacy bet_tracker first-inning rows contain only team abbreviations
    // or omit matchup columns. A unique completed YRFI/NRFI row for that date is
    // safe to use; ambiguous rows remain pending rather than borrowing a result.
    const onlySameSide = sameSideRows.length === 1 ? sameSideRows[0] : undefined;
    return onlySameSide && resultCode(onlySameSide.Result) ? onlySameSide : null;
  }

  if (pick.market === "Pitcher Strikeouts") {
    const [pickPitcherRaw, pickSideRaw] = String(pick.selection || "").split("|");
    const pickPitcher = textKey(pickPitcherRaw);
    const pickSide = normalizeType(pickSideRaw);
    const pickLine = numericLine(pick.line || "");

    const candidates = sameDateRows.filter((row) => {
      const type = normalizeType(row["Bet Type"] || row.Market || row.Play || "");
      const marketText = textKey(row.Market || row["Bet Type"] || "");
      if (!marketText.includes("pitcher strikeout") && !isPitcherKType(type)) return false;

      const rowText = textKey(
        [row.Selection, row.Team, row.Play, row.Pitcher, row["Player"]].join(" "),
      );
      if (
        !pickPitcher ||
        !(rowText.includes(pickPitcher) || namesShareAtLeastTwoTokens(pickPitcherRaw, rowText))
      ) return false;

      const rowSide = type.includes("UNDER") || textKey(row.Selection).includes("under")
        ? "UNDER"
        : type.includes("OVER") || textKey(row.Selection).includes("over")
          ? "OVER"
          : "";
      if (pickSide && rowSide && !pickSide.includes(rowSide)) return false;

      const rowLine = numericLine(row.Line || row["Odds/Line"] || row.Selection || row.Play || "");
      if (pickLine != null && rowLine != null && Math.abs(pickLine - rowLine) > 0.001) {
        return false;
      }

      // Pitcher/date/side/line is the authoritative identity. Do not require the
      // tracker Game text because pitcher-prop rows may omit or abbreviate it.
      return true;
    });
    const exactGame = candidates.filter((row) => aiRowMatchesGame(pick, row));
    const eligible = exactGame.length ? exactGame : candidates.length === 1 ? candidates : [];
    return eligible.find((row) => Boolean(resultCode(row.Result))) || eligible[0] || null;
  }

  const matches = sameDateRows.filter((row) => {
    if (!aiRowMatchesGame(pick, row)) return false;
    const market = trackerMarket(row);
    if (pick.market === "Moneyline") {
      return market === "Moneyline" &&
        normalizeTeam(teamFromSelection(row.Selection || row.Team || row.Pick || "")) ===
          normalizeTeam(pick.selection);
    }
    if (pick.market === "Total") {
      return market === "Total" && trackerTotalSide(row) === pick.selection;
    }
    return false;
  });
  if (pick.market === "Total") {
    const pickLine = numericLine(pick.line);
    if (pickLine != null) {
      const exactLine = matches.filter((row) => {
        const rowLine = numericLine(
          row.Line || row["Total Line"] || row["Odds/Line"] || row.Selection || row.Play || "",
        );
        return rowLine != null && Math.abs(rowLine - pickLine) < 0.001;
      });
      if (exactLine.length) {
        return exactLine.find((row) => Boolean(resultCode(row.Result))) || exactLine[0] || null;
      }
      const noLine = matches.filter(
        (row) =>
          numericLine(
            row.Line || row["Total Line"] || row["Odds/Line"] || row.Selection || row.Play || "",
          ) == null,
      );
      return matches.length === 1 && noLine.length === 1 ? noLine[0] || null : null;
    }
  }
  return matches.find((row) => Boolean(resultCode(row.Result))) || matches[0] || null;
}

function overlayAiPickResults(
  picks: AiPick[],
  trackerRows: SheetRow[],
  allGameTrendRows: SheetRow[],
) {
  return picks.map((pick) => {
    let source: SheetRow | null = aiPickTrackerMatch(pick, trackerRows);
    if (
      (pick.market === "Moneyline" || pick.market === "Total") &&
      (!source || !resultCode(source.Result))
    ) {
      const allGameSource = aiPickTrackerMatch(pick, allGameTrendRows);
      if (allGameSource && resultCode(allGameSource.Result)) source = allGameSource;
    }

    const authoritativeResult = source ? resultCode(source.Result) : "";

    // First-inning and pitcher-strikeout AI picks are graded only from bet_tracker.
    // Until the matching tracker row has a completed Result, keep the AI pick pending
    // so it is excluded from wins, losses, pushes, units, and ROI.
    const trackerOnlyMarket =
      pick.market === "First Inning" || pick.market === "Pitcher Strikeouts";
    if (!authoritativeResult) {
      return trackerOnlyMarket
        ? {
            ...pick,
            result: "" as AiPick["result"],
            units: 0,
            resultUpdated: "",
          }
        : pick;
    }

    const odds = parseAmericanOdds(pick.odds);
    const units = authoritativeResult === "P"
      ? 0
      : authoritativeResult === "L"
        ? -1
        : odds > 0
          ? odds / 100
          : odds < 0
            ? 100 / Math.abs(odds)
            : 1;
    return {
      ...pick,
      result: authoritativeResult,
      units: aiRound(units, 2),
      resultUpdated: String(
        source?.["Result Updated"] ||
          source?.["Graded At"] ||
          (pick.result === authoritativeResult && pick.resultUpdated
            ? pick.resultUpdated
            : nowET()),
      ),
    };
  });
}

function aiSlateRowForStoredPick(pick: AiPick, slateRows: SheetRow[]) {
  return (
    slateRows.find((row) => draftKingsGameKey(row) === pick.gameKey) ||
    slateRows.find(
      (row) =>
        normalizeTeam(row["Away Team"] || "") === normalizeTeam(pick.awayTeam) &&
        normalizeTeam(row["Home Team"] || "") === normalizeTeam(pick.homeTeam),
    ) ||
    null
  );
}

function aiStoredFirstInningDirectionCorrection(
  pick: AiPick,
  slateRows: SheetRow[],
): AiPick | null {
  if (!pick.selected || pick.market !== "Total") return null;
  const slateRow = aiSlateRowForStoredPick(pick, slateRows);
  const context = aiFirstInningDirectionContext(
    pick.market,
    pick.selection,
    pick.line,
    slateRow,
  );
  if (context.relationship !== "CONFLICTS") return null;

  const correction = `First-inning direction safety correction: ${context.reason}`;
  return {
    ...pick,
    selected: false,
    protectionStatus: "BLOCKED",
    rejectionReason: correction,
    confidenceReason: [],
    whySelected: [correction],
    historicalNotes: [],
    risks: [],
    researchSummary: "",
    verdict: `${pick.play} was removed because the saved first-inning model signal points in the opposite scoring direction.`,
    dataStatus: [
      ...pick.dataStatus.filter(
        (item) =>
          !textKey(item).includes("nrfi") &&
          !textKey(item).includes("yrfi") &&
          !textKey(item).includes("first inning"),
      ),
      `${context.grade}: ${context.meaning}`,
      correction,
    ].slice(0, 5),
    externalReviewStatus: "NO_VERIFIED_CONTEXT",
    updatedAt: nowET(),
    selectorVersion: AI_PICK_SELECTOR_VERSION,
  };
}

function aiStoredFinalSelectionIsLocked(pick: AiPick) {
  // Once a pick has passed the FINAL_PREGAME AI review and was published as
  // selected, it is immutable. Later refreshes must never re-review or demote
  // it because market/model inputs can continue changing after the lock.
  return (
    pick.snapshotStatus === "FINAL_PREGAME" &&
    pick.selected === true &&
    pick.externalReviewStatus === "WEB_REVIEWED"
  );
}

function aiStoredFinalDecisionIsTerminal(pick: AiPick) {
  if (pick.snapshotStatus !== "FINAL_PREGAME") return false;
  if (aiStoredFinalSelectionIsLocked(pick)) return true;
  if (pick.externalReviewStatus === "WEB_REVIEWED") return true;
  // A temporary response timeout or output-limit error is not a final decision.
  // requestSingleAiGameExternalReviews applies a short in-memory cool-down, and
  // the start-time guard below permanently closes any review still unfinished
  // at first pitch. This gives a pregame failure a safe chance to recover.
  if (pick.externalReviewStatus === "REVIEW_ERROR") return false;
  return (
    pick.externalReviewStatus === "NO_VERIFIED_CONTEXT" &&
    pick.protectionStatus === "BLOCKED"
  );
}

function aiSortByGameTime(a: AiPick, b: AiPick) {
  const aTime = scheduledGameStart({ Date: a.date, "Game Time": a.gameTime }) ?? Number.POSITIVE_INFINITY;
  const bTime = scheduledGameStart({ Date: b.date, "Game Time": b.gameTime }) ?? Number.POSITIVE_INFINITY;
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
  } = args;
  const selectorNow = Date.now();
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
  let stored = workingStoredRows.map(parseAiPickRow).filter((pick): pick is AiPick => Boolean(pick));
  let storedToday = stored.filter((pick) => pick.date === isoPublicDate(today));

  // A completed web review cannot make a reversed market definition valid.
  // Correct any already-published Total pick whose saved ELITE NRFI/YRFI signal
  // points the opposite way. This is deterministic, costs no AI call, and keeps
  // the rejected row in the audit sheet instead of silently deleting it.
  const directionCorrections = storedToday
    .map((pick) => aiStoredFirstInningDirectionCorrection(pick, slateRows))
    .filter((pick): pick is AiPick => Boolean(pick));
  if (directionCorrections.length) {
    try {
      await persistAiPickRows(directionCorrections);
    } catch (error) {
      console.error("AI first-inning direction correction persistence failed", error);
    }
    const correctedByKey = new Map(
      directionCorrections.map((pick) => [`${pick.date}|${pick.candidateId}`, pick] as const),
    );
    workingStoredRows = workingStoredRows.map((row) => {
      const parsed = parseAiPickRow(row);
      if (!parsed) return row;
      return correctedByKey.get(`${parsed.date}|${parsed.candidateId}`)
        ? aiPickRow(correctedByKey.get(`${parsed.date}|${parsed.candidateId}`) as AiPick)
        : row;
    });
    stored = workingStoredRows.map(parseAiPickRow).filter((pick): pick is AiPick => Boolean(pick));
    storedToday = stored.filter((pick) => pick.date === isoPublicDate(today));
  }

  // Never leave an interrupted final-review row visible after first pitch and
  // never restart paid research using in-game information. Keep the rejected
  // row for the audit sheet, but make the public selection disappear.
  const expiredFinalReviews = storedToday
    .filter(
      (pick) =>
        pick.snapshotStatus === "FINAL_PREGAME" &&
        !aiStoredFinalDecisionIsTerminal(pick),
    )
    .filter((pick) => {
      const start = scheduledGameStart({
        Date: pick.date,
        "Game Time": pick.gameTime,
      });
      return start != null && selectorNow >= start;
    })
    .map((pick): AiPick => {
      const reason =
        "Final AI review did not complete before the scheduled start; the play was removed without using post-start information.";
      return {
        ...pick,
        selected: false,
        protectionStatus: "BLOCKED",
        rejectionReason: reason,
        confidenceReason: [],
        whySelected: [reason],
        historicalNotes: [],
        risks: [],
        researchSummary: "",
        verdict: reason,
        dataStatus: [...new Set([...pick.dataStatus, reason])].slice(0, 5),
        externalReviewStatus: "NO_VERIFIED_CONTEXT",
        updatedAt: nowET(),
      };
    });
  if (expiredFinalReviews.length) {
    try {
      await persistAiPickRows(expiredFinalReviews);
    } catch (error) {
      console.error("Expired AI final-review persistence failed", error);
    }
    const expiredByKey = new Map(
      expiredFinalReviews.map(
        (pick) => [`${pick.date}|${pick.candidateId}`, pick] as const,
      ),
    );
    workingStoredRows = workingStoredRows.map((row) => {
      const parsed = parseAiPickRow(row);
      if (!parsed) return row;
      const replacement = expiredByKey.get(`${parsed.date}|${parsed.candidateId}`);
      return replacement ? aiPickRow(replacement) : row;
    });
    stored = workingStoredRows.map(parseAiPickRow).filter((pick): pick is AiPick => Boolean(pick));
    storedToday = stored.filter((pick) => pick.date === isoPublicDate(today));
  }
  // A final snapshot is not fully locked until its external review reaches a
  // terminal status. Older rows can be FINAL_PREGAME while still carrying
  // PENDING_FINAL_REVIEW without a recorded attempt; those unfinished rows may
  // retry. A recorded REVIEW_ERROR is terminal so refreshes cannot buy another
  // game-research call automatically.
  const storedTodayByCandidateId = new Map(
    storedToday.map((pick) => [pick.candidateId, pick] as const),
  );
  const currentCandidateIdsByGame = new Map<string, string[]>();
  for (const candidate of candidates) {
    const ids = currentCandidateIdsByGame.get(candidate.gameKey) || [];
    ids.push(candidate.candidateId);
    currentCandidateIdsByGame.set(candidate.gameKey, ids);
  }

  // A final decision is immutable once its review completed. Unfinished pending
  // rows and unconfigured rows can still recover, but selector-version changes
  // alone do not reopen a published, rejected, or failed final decision.
  const fullyReviewedGameKeys = new Set(
    [...currentCandidateIdsByGame.entries()]
      .filter(([, candidateIds]) =>
        candidateIds.length > 0 &&
        candidateIds.every((candidateId) => {
          const storedPick = storedTodayByCandidateId.get(candidateId);
          return Boolean(storedPick && aiStoredFinalDecisionIsTerminal(storedPick));
        }),
      )
      .map(([gameKey]) => gameKey),
  );
  // The AI selector must not depend exclusively on a background/scheduled
  // request to enter final review. A normal public refresh from 23 minutes out
  // through the remaining pregame period may finalize the candidate. This
  // makes the final-review state self-healing if a scheduler run is late.

  // The Full Slate display determines a locked game from the merged DraftKings
  // payload, where saved 15-minute market rows are marked FINAL_PREGAME. The
  // daily_slate row is not guaranteed to have its Public Data Status cell updated,
  // so relying on slateHasFinalPregameSnapshot(row) alone can leave the AI card in
  // LIVE mode even while the Full Slate correctly displays FINAL.
  const finalDraftKingsGameKeys = new Set(
    draftKings.splits
      .filter(
        (split) =>
          split.snapshotStatus === "FINAL_PREGAME" &&
          (split.market === "Moneyline" || split.market === "Total"),
      )
      .map(
        (split) =>
          `${isoPublicDate(split.date)}|${normalizeTeam(split.awayTeam)}|${normalizeTeam(split.homeTeam)}`,
      ),
  );
  const storedFinalGameKeys = new Set(
    storedToday
      .filter((pick) => pick.snapshotStatus === "FINAL_PREGAME")
      .map((pick) => pick.gameKey),
  );
  const retryGameKeys = new Set(
    storedToday
      .filter(
        (pick) =>
          pick.snapshotStatus === "FINAL_PREGAME" &&
          !aiStoredFinalDecisionIsTerminal(pick),
      )
      .map((pick) => pick.gameKey),
  );

  const targetGameKeys = new Set(
    slateRows
      .filter((row) => {
        const gameKey = draftKingsGameKey(row);
        return (
          finalDraftKingsGameKeys.has(gameKey) ||
          slateHasFinalPregameSnapshot(row) ||
          isAiFinalReviewWindow(row, selectorNow) ||
          retryGameKeys.has(gameKey)
        );
      })
      .map((row) => draftKingsGameKey(row))
      .filter((key) => !fullyReviewedGameKeys.has(key)),
  );
  const targetCandidates = candidates.filter((candidate) => {
    if (!targetGameKeys.has(candidate.gameKey)) return false;
    const storedPick = storedTodayByCandidateId.get(candidate.candidateId);
    if (storedFinalGameKeys.has(candidate.gameKey) && !storedPick) return false;
    if (storedPick && aiStoredFinalDecisionIsTerminal(storedPick)) return false;
    if (
      storedPick?.externalReviewStatus === "NOT_CONFIGURED" &&
      !process.env.OPENAI_API_KEY
    ) {
      return false;
    }
    const started = candidate.slateRow ? !isPregameRow(candidate.slateRow, selectorNow) : false;
    // Once the scheduled start passes, the row is rejected above instead of
    // purchasing a new review that could be contaminated by in-game context.
    return !started;
  });
  // Deterministic failures can never become selected after research. Persist
  // their blocked decision without paying for a web-search/model call.
  const reviewCandidates = targetCandidates.filter(
    (candidate) => candidate.protectionReasons.length === 0,
  );

  let externalReviews = new Map<string, AiExternalReview>();
  let externalReviewErrors = new Map<string, string>();
  let externalStatus: AiPickExternalStatus = process.env.OPENAI_API_KEY
    ? "PENDING_FINAL_REVIEW"
    : "NOT_CONFIGURED";
  if (targetCandidates.length) {
    if (reviewCandidates.length) {
      try {
        const external = await requestAiExternalReviews(reviewCandidates);
        externalReviews = external.reviews;
        externalReviewErrors = external.errors;
        externalStatus = external.status;
      } catch (error) {
        externalStatus = "REVIEW_ERROR";
        const message = error instanceof Error ? error.message : String(error);
        externalReviewErrors = new Map(
          reviewCandidates.map((candidate) => [candidate.candidateId, message] as const),
        );
      }
    } else {
      externalStatus = "NO_VERIFIED_CONTEXT";
    }
    const finalTargetPicks = finalizeAiCandidates(
      targetCandidates,
      externalReviews,
      externalStatus,
      "FINAL_PREGAME",
      externalReviewErrors,
    );
    await persistAiPickRows(finalTargetPicks);
    const finalRows = finalTargetPicks.map(aiPickRow);
    const finalizedCandidateIds = new Set(finalTargetPicks.map((pick) => pick.candidateId));
    // Replace only the candidates reviewed in this pass. Do not clear every row
    // from the game, because another candidate from that game may already be a
    // locked/published AI pick that must remain immutable.
    workingStoredRows = [
      ...workingStoredRows.filter((row) => {
        const storedPick = parseAiPickRow(row);
        return !storedPick || !finalizedCandidateIds.has(storedPick.candidateId);
      }),
      ...finalRows,
    ];
  }

  const refreshedStored = workingStoredRows.map(parseAiPickRow).filter((pick): pick is AiPick => Boolean(pick));
  const refreshedToday = refreshedStored.filter((pick) => pick.date === isoPublicDate(today));
  // Any persisted FINAL_PREGAME row means that candidate has already reached
  // the final-decision stage. Do not recreate a live/pending preview for the
  // same game after that point, including when the final decision was rejection.
  const refreshedLockedKeys = new Set(
    refreshedToday
      .filter((pick) => pick.snapshotStatus === "FINAL_PREGAME")
      .map((pick) => pick.gameKey),
  );
  const liveCandidates = candidates.filter(
    (candidate) =>
      !refreshedLockedKeys.has(candidate.gameKey) &&
      (!candidate.slateRow || isPregameRow(candidate.slateRow, selectorNow)),
  );
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

  // Persist authoritative grades back to ai_pick_selector. Previously the website
  // calculated results only in memory, leaving the Result/Units columns blank and
  // making debugging difficult. This also allows corrected tracker grades to repair
  // previously saved AI results.
  const changedGradePicks = withResults.filter((pick, index) => {
    const before = refreshedStored[index];
    return Boolean(
      before &&
        (before.result !== pick.result ||
          before.units !== pick.units ||
          before.resultUpdated !== pick.resultUpdated)
    );
  });
  if (changedGradePicks.length) {
    await persistAiPickRows(changedGradePicks);
  }

  const gradedByCandidate = new Map(
    withResults.map((pick) => [`${pick.date}|${pick.candidateId}`, pick] as const),
  );
  const todayCombinedWithResults = todayCombined.map(
    (pick) => gradedByCandidate.get(`${pick.date}|${pick.candidateId}`) || pick,
  );
  const selectedToday = todayCombinedWithResults
    .filter((pick) => pick.selected)
    .sort(aiSortByGameTime);
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
    candidateCount: todayCombinedWithResults.length,
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
    // Create today's schedule shells before reading the public board. This lets
    // DraftKings market tracking begin automatically even when the MLB model has
    // not been built yet; the builder later replaces/upserts the same Game Key.
    await ensureTodayMarketSlate(today);
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
    const [slateTodayRaw, trackerRaw, liveDraftKings, initialSavedPublicSplits, storedAiPickRows] = await Promise.all([
      readWorksheet("daily_slate"),
      readWorksheet("bet_tracker"),
      loadDraftKingsData(),
      safeReadPublicSplitRows(),
      safeReadAiPickRows(),
    ]);
    let savedPublicSplits = initialSavedPublicSplits;
    const savedDraftKings = snapshotPayloadFromRows(savedPublicSplits, today);
    let finalSnapshotDraftKings = snapshotPayloadFromRows(
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
    if (persistence.snapshotRowsUpdated > 0) {
      savedPublicSplits = await safeReadPublicSplitRows();
      finalSnapshotDraftKings = snapshotPayloadFromRows(
        savedPublicSplits.filter(isFifteenMinuteTrackingSnapshot),
        today,
      );
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
    const draftKingsSignalRows = canonicalDraftKingsSignalRows(
      buildDraftKingsSignalRows(
        trendSourceRows,
        slateTodayRaw as SheetRow[],
        savedPublicSplits,
      ),
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

function isAuthorizedBackgroundSnapshotRequest(request: NextRequest) {
  // Support the existing EZPZ-specific secret and the GitHub workflow's
  // CRON_SECRET so the workflow can call /api/public-data directly.
  const secrets = [process.env.EZPZ_SNAPSHOT_SECRET, process.env.CRON_SECRET]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (!secrets.length) return true;
  const authorization = String(request.headers.get("authorization") || "").trim();
  const suppliedSecret = String(
    request.headers.get("x-ezpz-snapshot-secret") || "",
  ).trim();
  return secrets.some(
    (secret) => suppliedSecret === secret || authorization === `Bearer ${secret}`,
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
    if (!isAuthorizedBackgroundSnapshotRequest(request)) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized background snapshot request" },
        {
          status: 401,
          headers: { "Cache-Control": "no-store, max-age=0" },
        },
      );
    }
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
