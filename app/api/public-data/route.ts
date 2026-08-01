import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { readWorksheet } from "../../../lib/googleSheets";

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
  "Opening Implied %", "Current Implied %", "Public Bets %", "Public Money %",
  "Public Gap %", "Warning Key", "Warning", "Warning Tone", "Warning Negative",
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
  "Line Movement Signal", "Line Movement Tone", "Line Movement Basis",
  "Line Movement Value",
  "Trend Play", "Trend Score", "Trend Tier", "Trend Signals",
  "Trend All Time Record", "Trend Last 30 Record", "Trend Last 7 Record",
  "Trend Exact Sample", "Trend Score Details",
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
  score: number;
  tier: "Strong Trend" | "Positive Trend" | "Neutral / Watch" | "Weak / Conflicting";
  signals: TrendSignalBreakdown[];
  updatedAt: string;
};

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
  openingImpliedPct?: number | null;
  currentImpliedPct?: number | null;
  openingSnapshotTime?: string;
  lineMovementSignal?: string;
  lineMovementTone?: PublicSignalTone | "";
  lineMovementBasis?: "Implied Probability" | "Total Line" | "";
  lineMovementValue?: number | null;
  retained?: boolean;
  lastSeenAt?: string;
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
      warningKey: "EXTREME_PUBLIC_CONSENSUS",
      warning: "Extreme Public Consensus",
      warningTone: "negative" as const,
      warningNegative: true,
      gapPct,
    };
  }
  if (betsPct >= 80 && moneyPct >= 80) {
    return {
      warningKey: "HEAVY_PUBLIC_CONSENSUS",
      warning: "Heavy Public Consensus",
      warningTone: "caution" as const,
      warningNegative: true,
      gapPct,
    };
  }
  if (betsPct >= 70 && betsPct - moneyPct >= 10) {
    return {
      warningKey: "PUBLIC_TICKETS_WEAK_MONEY",
      warning: "Public Tickets, Weak Money",
      warningTone: "negative" as const,
      warningNegative: true,
      gapPct,
    };
  }
  if (betsPct <= 35 && moneyPct >= 55 && gapPct >= 20) {
    return {
      warningKey: "STRONG_CONTRARIAN_MONEY_SUPPORT",
      warning: "Strong Contrarian Money Support",
      warningTone: "positive" as const,
      warningNegative: false,
      gapPct,
    };
  }
  if (betsPct <= 45 && moneyPct >= 50 && gapPct >= 12) {
    return {
      warningKey: "CONTRARIAN_MONEY_SUPPORT",
      warning: "Contrarian Money Support",
      warningTone: "positive" as const,
      warningNegative: false,
      gapPct,
    };
  }
  if (moneyPct >= 60 && gapPct >= 10) {
    return {
      warningKey: "MARKET_MONEY_CONFIRMATION",
      warning: "Market Money Confirmation",
      warningTone: "positive" as const,
      warningNegative: false,
      gapPct,
    };
  }
  return {
    warningKey: "BALANCED_MARKET",
    warning: "Balanced Market",
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

function movementForSplit(
  current: DraftKingsSplit,
  openingLine: number | null,
  openingOdds: string,
) {
  const openingImpliedPct = americanImpliedProbabilityPct(openingOdds);
  const currentImpliedPct = americanImpliedProbabilityPct(current.odds);
  let signal = "";
  let tone: PublicSignalTone | "" = "";
  let basis: "Implied Probability" | "Total Line" | "" = "";
  let value: number | null = null;

  if (
    current.market === "Total" &&
    openingLine != null &&
    current.line != null &&
    current.side
  ) {
    const selectedSideMove = current.side === "Over"
      ? current.line - openingLine
      : openingLine - current.line;
    if (Math.abs(selectedSideMove) >= 0.5) {
      signal = selectedSideMove > 0
        ? "Line Movement Confirmation"
        : "Reverse Line Movement";
      tone = selectedSideMove > 0 ? "positive" : "negative";
      basis = "Total Line";
      value = Math.round(selectedSideMove * 10) / 10;
    }
  }

  if (!signal && openingImpliedPct != null && currentImpliedPct != null) {
    const impliedMove = Math.round((currentImpliedPct - openingImpliedPct) * 10) / 10;
    if (Math.abs(impliedMove) >= 3) {
      signal = impliedMove > 0
        ? "Line Movement Confirmation"
        : "Reverse Line Movement";
      tone = impliedMove > 0 ? "positive" : "negative";
      basis = "Implied Probability";
      value = impliedMove;
    }
  }

  return {
    openingImpliedPct,
    currentImpliedPct,
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
  const openingSnapshotTime =
    previous?.openingSnapshotTime ||
    previous?.lastSeenAt ||
    current.openingSnapshotTime ||
    updatedAt;
  const movement = movementForSplit(current, openingLine ?? null, openingOdds || current.odds);

  return {
    ...current,
    ...primary,
    openingLine: openingLine ?? null,
    openingOdds: openingOdds || current.odds,
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

  try {
    const html = await fetchHtml(DK_BETTING_SPLITS_URL, {
      itm_content: "MLB",
      tb_edate: "n7days",
      tb_eg: "MLB",
      tb_page: "1",
    });
    splits = parseBettingSplits(html);
  } catch (error) {
    errors.push(`Betting splits: ${error instanceof Error ? error.message : String(error)}`);
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
  trackingCapture = false,
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
    "Match Confidence": trackingCapture
      ? item.retained
        ? "15-minute tracking snapshot (last-known retained market)"
        : "15-minute tracking snapshot (live market)"
      : item.retained
        ? "Last-known retained pregame market snapshot"
        : "Live-site pregame market snapshot",
    "Source URL": DK_BETTING_SPLITS_URL,
  };
}

function snapshotRecordFromProp(
  item: DraftKingsProp,
  snapshotTime: string,
  trackingCapture = false,
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
    "Match Confidence": trackingCapture
      ? item.retained
        ? "15-minute tracking snapshot (last-known retained pitcher popularity)"
        : "15-minute tracking snapshot (pitcher popularity)"
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
    const betsPct = Math.max(0, Math.min(100, toNumber(row["Public Bets %"])));
    const moneyPct = Math.max(0, Math.min(100, toNumber(row["Public Money %"])));
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
      openingSnapshotTime: String(row["Opening Snapshot Time ET"] || snapshotTime),
      retained: true,
      lastSeenAt: snapshotTime,
    };
    const openingReference: DraftKingsSplit = {
      ...baseSplit,
      line: baseSplit.openingLine ?? baseSplit.line,
      odds: baseSplit.openingOdds || baseSplit.odds,
      openingLine: baseSplit.openingLine ?? baseSplit.line,
      openingOdds: baseSplit.openingOdds || baseSplit.odds,
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

async function persistFinalPregameDraftKings(
  livePayload: DraftKingsPayload,
  today: string,
  trackingCapture = false,
): Promise<DraftKingsPersistence> {
  const todayIso = isoPublicDate(today);
  const persistenceKey = `${trackingCapture ? "TRACKING_15M" : "LIVE_SITE"}|${todayIso}|${livePayload.updatedAt}|${livePayload.splits.length}|${livePayload.props.length}`;
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

    if (trackingCapture && !trackingGameKeys.size) {
      draftKingsPersistenceCache = { key: persistenceKey, savedAt: Date.now(), result };
      return result;
    }

    for (const matrixRow of slateMatrix.rows) {
      const row = matrixRow.object;
      if (isoPublicDate(row.Date) !== todayIso) continue;
      if (trackingCapture && !trackingGameKeys.has(draftKingsGameKey(row))) continue;
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
            trackingCapture,
          ),
        ),
      );
      matchingProps.forEach((item) =>
        snapshotRecords.push(
          snapshotRecordFromProp(
            item,
            item.lastSeenAt || livePayload.updatedAt,
            trackingCapture,
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
        "Public Data Status": trackingCapture
          ? hasLiveMarket
            ? "TRACKING SNAPSHOT ~15M LIVE"
            : "TRACKING SNAPSHOT ~15M RETAINED"
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

    // Lock the same dedicated ~15-minute snapshot into the separate all-side
    // research table. Normal public-site refreshes never overwrite it.
    for (const matrixRow of trendMatrix.rows) {
      const row = matrixRow.object;
      if (isoPublicDate(row.Date) !== todayIso) continue;

      const slateRow = trackerSlateMatch(row, slateObjects);
      if (!slateRow) continue;

      const market = trackerMarket(row);
      if (!market) continue;
      const alreadyLocked = textKey(
        row["Public Split Match Confidence"] || "",
      ).includes("15 minute tracking snapshot");
      if (alreadyLocked) continue;

      const savedSnapshot = snapshotForTrackerRow(
        row,
        slateObjects,
        savedSnapshotObjects,
      );
      if (savedSnapshot && isFifteenMinuteTrackingSnapshot(savedSnapshot)) {
        trendUpdates.push({
          sheetRow: matrixRow.sheetRow,
          fields: allGameTrendFieldsFromSnapshot(savedSnapshot),
        });
        continue;
      }

      if (!trackingCapture || !trackingGameKeys.has(draftKingsGameKey(slateRow))) {
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
      const scoredTrendPlay = buildTrendPlayForSplit(
        item,
        trendSignalHistory,
        todayIso,
        livePayload.updatedAt,
      );
      trendUpdates.push({
        sheetRow: matrixRow.sheetRow,
        fields: {
          ...allGameTrendFieldsFromSplit(item, livePayload.updatedAt, confidence),
          ...trendSnapshotFields(scoredTrendPlay),
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
        // Once the dedicated tracking snapshot is captured, ordinary live-site
        // refreshes may display newer data but cannot overwrite the historical row.
        if (!trackingCapture && isFifteenMinuteTrackingSnapshot(existing)) return;
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
      "Trend Score Details",
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
    const line = numericLine(row.Line || row["Odds/Line"] || "");
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
      const rowDate = isoPublicDate(matrixRow.object.Date || "");
      return (
        Boolean(rowDate) &&
        rowDate <= todayIso &&
        !isCompletedResult(matrixRow.object.Result) &&
        Boolean(String(matrixRow.object["Game Key"] || "").trim())
      );
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

function exactDatasetWeights(exactSample: number): TrendDatasetWeights {
  if (exactSample > 30) return { exact: 1, market: 0, overall: 0 };
  if (exactSample >= 20) return { exact: 0.8, market: 0.2, overall: 0 };
  if (exactSample >= 10) return { exact: 0.6, market: 0.3, overall: 0.1 };
  if (exactSample >= 5) return { exact: 0.3, market: 0.5, overall: 0.2 };
  return { exact: 0, market: 0.7, overall: 0.3 };
}

function normalizedDatasetWeights(
  weights: TrendDatasetWeights,
  exact: TrendWindowRecords,
  market: TrendWindowRecords,
  overall: TrendWindowRecords,
): TrendDatasetWeights {
  const available = {
    exact: exact.allTime.totalBets > 0 ? weights.exact : 0,
    market: market.allTime.totalBets > 0 ? weights.market : 0,
    overall: overall.allTime.totalBets > 0 ? weights.overall : 0,
  };
  const sum = available.exact + available.market + available.overall;
  if (!sum) return { exact: 0, market: 0, overall: 0 };
  return {
    exact: available.exact / sum,
    market: available.market / sum,
    overall: available.overall / sum,
  };
}

function trendRecordScore(record: TrendRecord) {
  if (!record.totalBets) return 50;

  // Sample reliability is already handled by the exact / market / overall
  // dataset weighting. Do not shrink the score a second time toward 50.
  // This keeps the full ranked board meaningfully separated while still
  // protecting small exact-category samples through the broader-data blend.
  return clampScore(
    50 + (record.winPct - 50) * 1.7 + record.roiPct * 0.55,
  );
}

function trendWindowScore(records: TrendWindowRecords) {
  const windows: Array<[TrendRecord, number]> = [
    [records.allTime, 0.45],
    [records.last30, 0.35],
    [records.last7, 0.2],
  ];
  const available = windows.filter(([record]) => record.totalBets > 0);
  const weightTotal = available.reduce((sum, [, weight]) => sum + weight, 0);
  if (!weightTotal) return 50;
  return available.reduce(
    (sum, [record, weight]) => sum + trendRecordScore(record) * (weight / weightTotal),
    0,
  );
}

function trendRecordPositive(record: TrendRecord) {
  return record.totalBets > 0 && record.winPct > 50 && record.roiPct > 0;
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
  const weights = normalizedDatasetWeights(
    exactDatasetWeights(exact.allTime.totalBets),
    exact,
    marketRecords,
    overall,
  );
  const weightedScore =
    trendWindowScore(exact) * weights.exact +
    trendWindowScore(marketRecords) * weights.market +
    trendWindowScore(overall) * weights.overall;
  const displayRecords = exact.allTime.totalBets
    ? exact
    : marketRecords.allTime.totalBets
      ? marketRecords
      : overall;
  const recordScope = exact.allTime.totalBets
    ? `${market} • ${sideGroup}`
    : marketRecords.allTime.totalBets
      ? `${market} • all sides`
      : "All tracked markets";

  return {
    ...signal,
    category: `${signal.signal} • ${market} • ${sideGroup}`,
    recordScope,
    exactSample: exact.allTime.totalBets,
    score: Math.round(weightedScore || 50),
    weights,
    records: displayRecords,
  };
}

function trendTier(score: number): TrendPlay["tier"] {
  if (score >= 70) return "Strong Trend";
  if (score >= 60) return "Positive Trend";
  if (score >= 50) return "Neutral / Watch";
  return "Weak / Conflicting";
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
      signalKey: split.warningKey || primary.warningKey,
      signal: split.warning || primary.warning,
      tone: split.warningTone || primary.warningTone,
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

  // Every valid current moneyline and total selection belongs on the ranked
  // Trend Plays board. Balanced markets and signals without completed history
  // stay visible with a neutral 50 baseline instead of being filtered out.
  const signals = activeSignals.map((signal) =>
    buildTrendSignalBreakdown(signal, split.market as "Moneyline" | "Total", sideGroup, history, referenceDate),
  );
  const signalsWithHistory = signals.filter(
    (signal) => signal.records.allTime.totalBets > 0,
  );

  let score = signals.reduce((sum, signal) => sum + signal.score, 0) /
    Math.max(1, signals.length);
  const allWindowsPositive =
    signalsWithHistory.length > 0 &&
    signalsWithHistory.every(
      (signal) =>
        trendRecordPositive(signal.records.allTime) &&
        trendRecordPositive(signal.records.last30) &&
        trendRecordPositive(signal.records.last7),
    );
  if (allWindowsPositive) score += 5;
  const hasSupport = signalsWithHistory.some((signal) => signal.score >= 55);
  const hasConflict = signalsWithHistory.some((signal) => signal.score < 45);
  if (hasSupport && hasConflict) score -= 5;
  score = Math.round(clampScore(score));

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
    score,
    tier: trendTier(score),
    signals,
    updatedAt,
  };
}

function buildTrendPlays(
  splits: DraftKingsSplit[],
  history: DraftKingsSignalResult[],
  slateRows: SheetRow[],
  referenceDate: string,
  updatedAt: string,
) {
  const slateGameKeys = new Set(
    slateRows.map(
      (row) => `${normalizeTeam(row["Away Team"] || "")}|${normalizeTeam(row["Home Team"] || "")}`,
    ),
  );
  return splits
    .filter(
      (split) =>
        isoPublicDate(split.date) === isoPublicDate(referenceDate) &&
        (split.market === "Moneyline" || split.market === "Total") &&
        slateGameKeys.has(`${normalizeTeam(split.awayTeam)}|${normalizeTeam(split.homeTeam)}`),
    )
    .map((split) => buildTrendPlayForSplit(split, history, referenceDate, updatedAt))
    .filter((play): play is TrendPlay => Boolean(play))
    .sort((a, b) => b.score - a.score || a.game.localeCompare(b.game));
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

export async function GET(request: NextRequest) {
  try {
    const today = todayET();
    const trackingCapture =
      request.headers.get("x-ezpz-background-snapshot") === "true" ||
      request.nextUrl.searchParams.get("tracking") === "15m";
    const [slateTodayRaw, trackerRaw, liveDraftKings, savedPublicSplits] = await Promise.all([
      readWorksheet("daily_slate"),
      readWorksheet("bet_tracker"),
      loadDraftKingsData(),
      safeReadPublicSplitRows(),
    ]);
    const savedDraftKings = snapshotPayloadFromRows(savedPublicSplits, today);
    const draftKings = mergeDraftKingsPayload(liveDraftKings, savedDraftKings);
    const persistence = await persistFinalPregameDraftKings(
      draftKings,
      today,
      trackingCapture,
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
    const trendPlays = buildTrendPlays(
      draftKings.splits,
      draftKingsSignalRows,
      slateToday,
      today,
      draftKings.updatedAt,
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
    const ufc = await buildUfcData(today);

    return NextResponse.json({
      ok: true,
      today,
      lastUpdated: nowET(),
      draftKings,
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
      trendPlays,
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
        trendPlays: [],
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
