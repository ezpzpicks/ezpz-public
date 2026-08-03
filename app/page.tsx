"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

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

type TrendSignalBreakdown = {
  signalType: "Public Split" | "Line Movement";
  signalKey: string;
  signal: string;
  tone: PublicSignalTone;
  category: string;
  recordScope: string;
  exactSample: number;
  score: number;
  weights: { exact: number; market: number; overall: number };
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
  tier:
    | "Strong Trend"
    | "Positive Trend"
    | "Neutral / Watch"
    | "Weak / Conflicting"
    | "Pass"
    | "Good"
    | "Strong"
    | "Elite";
  signals: TrendSignalBreakdown[];
  updatedAt: string;
};

type ModelTrendMatch = "MATCH" | "AGREE" | "";

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
  favoritePick?: string | boolean;
  favoriteRank?: string | number;
  favoriteTag?: string;
  favoriteNotes?: string;
  reliability?: string | number;
  selectedProbability?: string | number;
  modelVersion?: string;
  role?: string;
  publicBetsPct?: string | number;
  publicMoneyPct?: string | number;
  publicWarning?: string;
  publicWarningNegative?: string | boolean;
  publicSplitSource?: string;
  publicSplitSelection?: string;
  publicSplitLine?: string | number;
  publicSplitOdds?: string | number;
  publicSplitMatchConfidence?: string;
  publicSplitUpdatedAt?: string;
  mostBetProp?: string | boolean;
  mostBetPropRank?: string | number;
  propPopularityMarket?: string;
  propPopularityLine?: string | number;
  propPopularityOdds?: string | number;
  propPopularitySource?: string;
  propPopularityMatchConfidence?: string;
  propPopularityUpdatedAt?: string;
};

type SheetRow = Record<string, string>;

type ApiData = {
  ok: boolean;
  error?: string;
  draftKings?: DraftKingsData;
  today: string;
  lastUpdated: string;
  tiles: {
    last7Days: RecordTotals;
    overallGreen: RecordTotals;
    handpickedLast7?: RecordTotals;
    handpickedOverall?: RecordTotals;
    pendingGreen: number;
    bestPlaysToday: number;
  };
  bestPlays: Play[];
  slateToday: SheetRow[];
  betTrackerRows?: SheetRow[];
  draftKingsSignalRows?: DraftKingsSignalResult[];
  trendRecordRows?: TrendRecordResult[];
  trendPlays?: TrendPlay[];
  recordSummary: Summary[];
  last7RecordSummary: Summary[];
  handpickedRecordSummary?: Summary[];
  handpickedLast7RecordSummary?: Summary[];
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
  warningKey?: string;
  warning: string;
  warningTone?: PublicSignalTone;
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
};

type DraftKingsData = {
  ok: boolean;
  status: "LIVE" | "PARTIAL" | "UNAVAILABLE";
  updatedAt: string;
  stale?: boolean;
  splits: DraftKingsSplit[];
  props: DraftKingsProp[];
  errors?: string[];
  displayMode?: "LIVE" | "MIXED" | "FINAL_PREGAME";
  finalSnapshotGames?: number;
};

type Sport = "MLB" | "NFL" | "NCAAF" | "NCAAM";
type Tab = "Today’s Best Plays" | "Today’s Trend Plays" | "Full Slate" | "Records";

type SportMeta = {
  name: string;
  shortName: string;
  status: string;
  description: string;
};

const SPORTS: Sport[] = ["MLB", "NFL", "NCAAF", "NCAAM"];
const TABS: Tab[] = ["Today’s Best Plays", "Today’s Trend Plays", "Full Slate", "Records"];

const SPORT_META: Record<Sport, SportMeta> = {
  MLB: {
    name: "Major League Baseball",
    shortName: "MLB",
    status: "Live model",
    description:
      "Confirmed lineups, role-aware workloads, model probability, and projection reliability.",
  },
  NFL: {
    name: "NFL",
    shortName: "NFL",
    status: "Preseason development",
    description:
      "Matchup-adjusted spreads, moneylines, totals, projected scores, and personnel reliability.",
  },
  NCAAF: {
    name: "College Football",
    shortName: "NCAAF",
    status: "Preseason development",
    description:
      "Opponent-adjusted team strength, projected possessions, availability, and game-environment modeling.",
  },
  NCAAM: {
    name: "College Basketball",
    shortName: "NCAAM",
    status: "Preseason development",
    description:
      "Tempo-adjusted efficiency, projected rotations, matchup edges, and game-total modeling.",
  },
};

const TEAM_ABBR: Record<string, string> = {
  "Arizona Diamondbacks": "ari",
  "Atlanta Braves": "atl",
  "Baltimore Orioles": "bal",
  "Boston Red Sox": "bos",
  "Chicago Cubs": "chc",
  "Chicago White Sox": "cws",
  "Cincinnati Reds": "cin",
  "Cleveland Guardians": "cle",
  "Colorado Rockies": "col",
  "Detroit Tigers": "det",
  "Houston Astros": "hou",
  "Kansas City Royals": "kc",
  "Los Angeles Angels": "laa",
  "Los Angeles Dodgers": "lad",
  "Miami Marlins": "mia",
  "Milwaukee Brewers": "mil",
  "Minnesota Twins": "min",
  "New York Mets": "nym",
  "New York Yankees": "nyy",
  Athletics: "ath",
  "Oakland Athletics": "ath",
  "Philadelphia Phillies": "phi",
  "Pittsburgh Pirates": "pit",
  "San Diego Padres": "sd",
  "San Francisco Giants": "sf",
  "Seattle Mariners": "sea",
  "St. Louis Cardinals": "stl",
  "Tampa Bay Rays": "tb",
  "Texas Rangers": "tex",
  "Toronto Blue Jays": "tor",
  "Washington Nationals": "wsh",
};

function normalizeType(value: unknown) {
  const text = String(value || "")
    .toUpperCase()
    .trim();

  // Game totals must be classified before generic pitcher OVER/UNDER,
  // otherwise TOTAL OVER would get mixed into pitcher prop OVER records.
  if (text.includes("TOTAL OVER") || text.includes("GAME TOTAL OVER")) return "TOTAL OVER";
  if (text.includes("TOTAL UNDER") || text.includes("GAME TOTAL UNDER")) return "TOTAL UNDER";
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

function isKType(type: unknown) {
  const normalized = normalizeType(type);
  return (
    normalized === "PITCHER K" ||
    normalized === "PITCHER STRIKEOUTS" ||
    [
      "OVER",
      "UNDER",
      "LEAN OVER",
      "LEAN UNDER",
      "STRONG OVER",
      "STRONG UNDER",
    ].includes(normalized)
  );
}

function isTotalType(type: unknown) {
  const normalized = normalizeType(type);
  return normalized === "TOTAL OVER" || normalized === "TOTAL UNDER";
}

function isMoneylineType(type: unknown) {
  return normalizeType(type).includes("MONEYLINE");
}

function isNRFIType(type: unknown) {
  const normalized = normalizeType(type);
  return normalized.includes("NRFI") || normalized.includes("YRFI");
}

function isLeanNRFIType(type: unknown) {
  return normalizeType(type) === "LEAN NRFI";
}

function isNonEdgeMoneyline(type: unknown) {
  return normalizeType(type) === "NON-EDGE MONEYLINE";
}

function isPass(type: unknown) {
  return normalizeType(type) === "PASS";
}

const PUBLIC_TRACKED_RECORD_TYPES = [
  "STRONG OVER",
  "OVER",
  "LEAN OVER",
  "STRONG UNDER",
  "UNDER",
  "LEAN UNDER",
  "A MONEYLINE",
  "B MONEYLINE",
  "ELITE NRFI",
  "ELITE YRFI",
  "YRFI",
  "TOTAL OVER",
  "TOTAL UNDER",
];

function isPublicTrackedRecordType(type: unknown) {
  return PUBLIC_TRACKED_RECORD_TYPES.includes(normalizeType(type));
}

function publicRecordRows(rows: Summary[] | undefined) {
  const order = new Map(
    PUBLIC_TRACKED_RECORD_TYPES.map((type, index) => [type, index]),
  );

  return (rows || [])
    .filter((row) => isPublicTrackedRecordType(row.betType))
    .sort(
      (a, b) =>
        (order.get(normalizeType(a.betType)) ?? 999) -
        (order.get(normalizeType(b.betType)) ?? 999),
    );
}

function combinedRecordTotals(label: string, rows: Summary[]) {
  const totals = emptyRecord(label);

  rows.forEach((row) => {
    totals.wins += row.wins || 0;
    totals.losses += row.losses || 0;
    totals.pushes += row.pushes || 0;
    totals.unitsWon += row.unitsWon || 0;
  });

  totals.totalBets = totals.wins + totals.losses + totals.pushes;
  totals.record = `${totals.wins}-${totals.losses}-${totals.pushes}`;
  const decisions = totals.wins + totals.losses;
  totals.winPct = decisions
    ? Math.round((totals.wins / decisions) * 1000) / 10
    : 0;
  totals.unitsWon = Math.round(totals.unitsWon * 100) / 100;
  totals.roiPct = totals.totalBets
    ? Math.round((totals.unitsWon / totals.totalBets) * 1000) / 10
    : 0;

  return totals;
}

function toNumber(value: unknown) {
  const n = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parseScore(value: unknown) {
  const n = toNumber(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 50;
}

function parseAmericanOdds(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;

  // Handle tracker format like "5.5 / -150" by reading only the odds side.
  if (raw.includes("/")) {
    const oddsSide = raw.split("/").slice(1).join("/").trim();
    const signedFromSlash = oddsSide.match(/[+-]\d{3,4}/)?.[0];
    if (signedFromSlash) return Number(signedFromSlash);
    const unsignedFromSlash = oddsSide.match(/\b\d{3}\b/)?.[0];
    if (unsignedFromSlash) return Number(unsignedFromSlash);
  }

  // Prefer signed American odds so dates/lines like 2026 or 5.5 are ignored.
  const signed = raw.match(/[+-]\d{3,4}/)?.[0];
  if (signed) return Number(signed);

  // Only accept unsigned odds when the whole value is exactly 3 digits.
  const exactUnsigned = raw.match(/^\d{3}$/)?.[0];
  if (exactUnsigned) return Number(exactUnsigned);

  return 0;
}

function americanOddsImpliedPercent(value: unknown) {
  const odds = parseAmericanOdds(value);
  if (!odds) return 0;
  return odds < 0
    ? (Math.abs(odds) / (Math.abs(odds) + 100)) * 100
    : (100 / (odds + 100)) * 100;
}

function moneylineEdgeText(modelProbability: unknown, oddsValue: unknown) {
  const modelPct = percentNumber(modelProbability);
  const impliedPct = americanOddsImpliedPercent(oddsValue);
  if (!modelPct || !impliedPct) return "—";
  const edge = modelPct - impliedPct;
  return `${edge >= 0 ? "+" : ""}${edge.toFixed(1)}%`;
}

function isQualifiedGreenPlay(play: Play) {
  if (isPass(play.playType)) return false;
  if (isNonEdgeMoneyline(play.playType)) return false;

  return play.isGreen === true;
}

function isBestPlay(play: Play) {
  if (!isQualifiedGreenPlay(play)) return false;

  // The admin model is the source of truth. The public-data endpoint still uses
  // the legacy YRFI label for a qualified Elite YRFI play. Accept that label on
  // Today’s Best Plays only; record summaries continue to keep YRFI and
  // ELITE YRFI completely separate.
  if (isNRFIType(play.playType)) {
    const type = normalizeType(play.playType);
    return (
      type === "ELITE NRFI" ||
      type === "ELITE YRFI" ||
      type === "YRFI"
    );
  }

  return true;
}

function formatOdds(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "—";

  // Pitcher prop tracker cells are stored like "5.5 / -150".
  // The odds bubble should show only the second part.
  if (raw.includes("/")) {
    const oddsSide = raw.split("/").slice(1).join("/").trim();
    const signedFromSlash = oddsSide.match(/[+-]\d{3,4}/)?.[0];
    if (signedFromSlash) return signedFromSlash;
    const unsignedFromSlash = oddsSide.match(/\b\d{3}\b/)?.[0];
    if (unsignedFromSlash) return `+${unsignedFromSlash}`;
  }

  const signed = raw.match(/[+-]\d{3,4}/)?.[0];
  if (signed) return signed;

  const exactUnsigned = raw.match(/^\d{3}$/)?.[0];
  if (exactUnsigned) return `+${exactUnsigned}`;

  return "—";
}

function cleanTeamName(value: unknown) {
  return String(value || "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\b\d+(?:\.\d+)?%/g, "")
    .replace(/\bMoneyline\b/gi, "")
    .replace(/\bA\+?\b|\bB\+?\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function teamLogoUrl(team: string) {
  const cleaned = cleanTeamName(team);
  const abbr = TEAM_ABBR[cleaned] || TEAM_ABBR[String(team || "").trim()];
  return abbr ? `https://a.espncdn.com/i/teamlogos/mlb/500/${abbr}.png` : "";
}

function initials(name: string) {
  const parts = String(name || "")
    .replace(",", " ")
    .split(/\s+/)
    .filter(Boolean);
  return (
    parts
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "P"
  );
}


type MlbDirectoryPerson = {
  id?: number;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  nameFirstLast?: string;
  nameLastFirst?: string;
};

type MlbDirectoryResponse = {
  people?: MlbDirectoryPerson[];
  players?: MlbDirectoryPerson[];
  teams?: Array<{
    roster?: Array<{ person?: MlbDirectoryPerson }>;
  }>;
};

const MLB_DIRECTORY_STORAGE_KEY = "ezpz-mlb-player-directory-v2";
const MLB_DIRECTORY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
let mlbPlayerDirectoryPromise: Promise<Map<string, number>> | null = null;

function normalizeMlbPlayerName(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/gi, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function mlbPlayerNameKeys(value: unknown) {
  const raw = cleanPitcherName(String(value || "")).trim();
  if (!raw) return [];

  const variants = new Set<string>();
  variants.add(raw);

  if (raw.includes(",")) {
    const [last, first] = raw.split(",", 2);
    variants.add(`${first || ""} ${last || ""}`.trim());
    variants.add(`${last || ""} ${first || ""}`.trim());
  } else {
    const parts = raw.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const first = parts[0];
      const last = parts.slice(1).join(" ");
      variants.add(`${first} ${last}`);
      variants.add(`${last} ${first}`);
    }
  }

  return [...variants]
    .map(normalizeMlbPlayerName)
    .filter(Boolean);
}

function addMlbDirectoryPerson(
  directory: Map<string, number>,
  person?: MlbDirectoryPerson,
) {
  const id = Number(person?.id || 0);
  if (!id) return;

  const names = [
    person?.fullName,
    person?.nameFirstLast,
    person?.nameLastFirst,
    [person?.firstName, person?.lastName].filter(Boolean).join(" "),
    [person?.lastName, person?.firstName].filter(Boolean).join(" "),
  ];

  names.forEach((name) => {
    mlbPlayerNameKeys(name).forEach((key) => {
      if (!directory.has(key)) directory.set(key, id);
    });
  });
}

function readStoredMlbDirectory() {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(MLB_DIRECTORY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      savedAt?: number;
      entries?: Array<[string, number]>;
    };
    if (
      !parsed.savedAt ||
      Date.now() - parsed.savedAt > MLB_DIRECTORY_TTL_MS ||
      !Array.isArray(parsed.entries)
    ) {
      return null;
    }
    return new Map(parsed.entries);
  } catch {
    return null;
  }
}

function storeMlbDirectory(directory: Map<string, number>) {
  if (typeof window === "undefined" || !directory.size) return;

  try {
    window.localStorage.setItem(
      MLB_DIRECTORY_STORAGE_KEY,
      JSON.stringify({
        savedAt: Date.now(),
        entries: [...directory.entries()],
      }),
    );
  } catch {
    // Storage can be unavailable in private browsing. Headshots still work in-session.
  }
}

async function loadMlbPlayerDirectory() {
  const stored = readStoredMlbDirectory();
  if (stored?.size) return stored;
  if (mlbPlayerDirectoryPromise) return mlbPlayerDirectoryPromise;

  mlbPlayerDirectoryPromise = (async () => {
    const directory = new Map<string, number>();
    const currentYear = new Date().getFullYear();

    // The sport-player endpoint resolves starters and most bulk pitchers in one request.
    for (const season of [currentYear, currentYear - 1]) {
      try {
        const response = await fetch(
          `https://statsapi.mlb.com/api/v1/sports/1/players?season=${season}`,
          { cache: "force-cache" },
        );
        if (!response.ok) continue;
        const payload = (await response.json()) as MlbDirectoryResponse;
        const people = payload.people || payload.players || [];
        people.forEach((person) => addMlbDirectoryPerson(directory, person));
        if (directory.size > 500) break;
      } catch {
        // Try the roster hydrate fallback below.
      }
    }

    // Fallback for environments where the sport-player endpoint is unavailable.
    if (directory.size < 100) {
      try {
        const response = await fetch(
          `https://statsapi.mlb.com/api/v1/teams?sportId=1&season=${currentYear}&hydrate=roster(person)`,
          { cache: "force-cache" },
        );
        if (response.ok) {
          const payload = (await response.json()) as MlbDirectoryResponse;
          (payload.teams || []).forEach((team) => {
            (team.roster || []).forEach((entry) =>
              addMlbDirectoryPerson(directory, entry.person),
            );
          });
        }
      } catch {
        // The visual fallback below intentionally avoids reverting to initials.
      }
    }

    storeMlbDirectory(directory);
    return directory;
  })();

  return mlbPlayerDirectoryPromise;
}

function officialMlbHeadshotUrl(playerId: number) {
  return `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:silo:current.png,w_256,q_auto:best,f_auto/v1/people/${playerId}/headshot/67/current`;
}

function useMlbPitcherHeadshot(summary: string) {
  const lookupKeys = useMemo(() => mlbPlayerNameKeys(summary), [summary]);
  const lookupSignature = lookupKeys.join("|");
  const [headshot, setHeadshot] = useState("");

  useEffect(() => {
    let cancelled = false;
    setHeadshot("");
    const keys = lookupSignature ? lookupSignature.split("|") : [];
    if (!keys.length) return () => undefined;

    void loadMlbPlayerDirectory().then((directory) => {
      if (cancelled) return;
      const playerId = keys
        .map((key) => directory.get(key))
        .find((value): value is number => Boolean(value));
      if (playerId) setHeadshot(officialMlbHeadshotUrl(playerId));
    });

    return () => {
      cancelled = true;
    };
  }, [lookupSignature]);

  return headshot;
}

function cleanPitcherName(summary: string) {
  return String(summary || "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\bLine\b.*$/i, "")
    .replace(/\d+(\.\d+)?/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseKSummary(summary: string, fallback = "") {
  const raw = String(summary || "").trim();
  const fallbackText = String(fallback || "").trim();

  const explicitLine =
    raw.match(/\bLine\s*([0-9]+(?:\.[0-9]+)?)/i)?.[1] ||
    fallbackText.match(/\bLine\s*([0-9]+(?:\.[0-9]+)?)/i)?.[1];

  const beforeGrade = raw.split("(")[0] || raw;
  const projectedMatches = [
    ...beforeGrade.matchAll(/([0-9]+(?:\.[0-9]+)?)/g),
  ].map((match) => match[1]);
  const projected = projectedMatches.length
    ? projectedMatches[projectedMatches.length - 1]
    : "";

  const afterGrade = raw.includes(")") ? raw.split(")").slice(1).join(")") : "";
  const afterGradeNumber = afterGrade.match(/([0-9]+(?:\.[0-9]+)?)/)?.[1];
  const fallbackNumber = fallbackText.match(/([0-9]+(?:\.[0-9]+)?)/)?.[1];

  return {
    projected: projected || "—",
    line: explicitLine || afterGradeNumber || fallbackNumber || "—",
  };
}

function extractProjectedK(summary: string, fallback = "") {
  return parseKSummary(summary, fallback).projected;
}

function extractLine(summary: string, fallback = "") {
  return parseKSummary(summary, fallback).line;
}

function getProjectedKs(play: Play) {
  return String(
    play.projectedKs || extractProjectedK(play.play, play.oddsLine) || "—",
  );
}

function getPitcherLine(play: Play) {
  return String(play.altLine || extractLine(play.play, play.oddsLine) || "—");
}

function getPitcherEdgeText(play: Play) {
  const edge = signedDifferenceText(getProjectedKs(play), getPitcherLine(play));
  return edge === "—" ? "—" : `${edge} Ks`;
}

function getTotalLine(play: Play, slateRows: SheetRow[] = []) {
  const row = findSlateRowForPlay(play, slateRows);
  const savedLine = firstValue(row, ["Total Runs Line", "Total Line", "Game Total Line"]);
  if (savedLine) return savedLine;

  const direct = String(play.oddsLine || "").trim();
  if (direct.includes("/")) {
    const lineSide = direct.split("/")[0].trim();
    if (lineSide) return lineSide;
  }
  const playLine = String(play.play || "").match(/(?:OVER|UNDER)\s+([0-9]+(?:\.[0-9]+)?)/i)?.[1];
  return playLine || direct || "—";
}

function getTotalProjectionNumber(play: Play, slateRows: SheetRow[] = []) {
  const row = findSlateRowForPlay(play, slateRows);
  const savedProjection = toNumber(
    firstValue(row, [
      "Total Runs Projection",
      "Projected Total",
      "Total Projection",
      "Game Total Projection",
    ]),
  );
  if (savedProjection > 0 && savedProjection < 30) return savedProjection;

  const raw = String(play.score ?? "").trim();
  if (!raw) return 0;
  const n = Number(raw.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) && n > 0 && n < 30 ? n : 0;
}

function getTotalProjection(play: Play, slateRows: SheetRow[] = []) {
  const n = getTotalProjectionNumber(play, slateRows);
  if (n) return n.toFixed(1);
  return "—";
}

function getTotalModelScore(play: Play, slateRows: SheetRow[] = []) {
  const line = toNumber(getTotalLine(play, slateRows));
  const projection = getTotalProjectionNumber(play, slateRows);
  if (!line || !projection) return parseScore(play.score);

  const type = normalizeType(play.playType);
  const edgeRuns = type === "TOTAL OVER" ? projection - line : line - projection;

  // Public score mirrors the size of the calibrated run edge without treating
  // an extreme raw projection as automatically superior.
  return clampScore(50 + Math.min(2.5, Math.max(0, edgeRuns)) * 12);
}

function getTotalPickLabel(play: Play, slateRows: SheetRow[] = []) {
  const type = normalizeType(play.playType);
  const side = type === "TOTAL OVER" ? "Over" : type === "TOTAL UNDER" ? "Under" : "Total";
  return `${side} ${getTotalLine(play, slateRows)}`;
}

function getRecentSummary(playType: string, rows: Summary[]) {
  const type = normalizeType(playType);
  return rows.find((row) => normalizeType(row.betType) === type) || null;
}

type MarketFormWindow = "last7Days" | "last7Bets";

type MarketFormInfo = {
  label: string;
  icon: string;
  className: "hot" | "cold" | "neutral" | "sample";
  detail: string;
};

function summaryRecord(summary: Summary | null) {
  return summary
    ? `${summary.wins}-${summary.losses}-${summary.pushes}`
    : "0-0-0";
}

function getFormInfo(
  summary: Summary | null,
  window: MarketFormWindow = "last7Days",
): MarketFormInfo {
  const record = summaryRecord(summary);
  const totalBets = summary?.totalBets || 0;

  if (window === "last7Bets") {
    if (!summary || totalBets < 7) {
      return {
        label: "Need 7 Bets",
        icon: "➖",
        className: "sample",
        detail: `${record} • ${totalBets}/7 completed`,
      };
    }

    if (summary.wins >= 5) {
      return {
        label: "Hot",
        icon: "🔥",
        className: "hot",
        detail: `${record} most recent`,
      };
    }

    if (summary.losses >= 5) {
      return {
        label: "Cold",
        icon: "❄️",
        className: "cold",
        detail: `${record} most recent`,
      };
    }

    return {
      label: "Neutral",
      icon: "➖",
      className: "neutral",
      detail: `${record} most recent`,
    };
  }

  if (!summary || totalBets < 5) {
    return {
      label: "Small Sample",
      icon: "⚠️",
      className: "sample",
      detail: `${record} • ${totalBets}/5 minimum`,
    };
  }

  if (summary.wins > summary.losses && summary.winPct >= 60) {
    return {
      label: "Hot",
      icon: "🔥",
      className: "hot",
      detail: `${record} in 7 days`,
    };
  }

  if (summary.winPct <= 40) {
    return {
      label: "Cold",
      icon: "❄️",
      className: "cold",
      detail: `${record} in 7 days`,
    };
  }

  return {
    label: "Neutral",
    icon: "➖",
    className: "neutral",
    detail: `${record} in 7 days`,
  };
}

function hasAltBadge(play: Play) {
  if (!isKType(play.playType)) return false;

  const expectedKs =
    toNumber(play.projectedKs) ||
    toNumber(extractProjectedK(play.play, play.oddsLine));
  const line = toNumber(extractLine(play.play, play.oddsLine));
  const sixInningKs = toNumber(play.sixInningKs);
  const score = parseScore(play.score);
  const volatility = String(play.volatility || "").toLowerCase();
  const type = pitcherGrade(play);

  if (!expectedKs || !line || !sixInningKs) return false;
  if (volatility === "high") return false;

  const overAlt =
    type.includes("OVER") &&
    expectedKs >= line + 1 &&
    sixInningKs >= line + 0.5;
  const underAlt =
    type.includes("UNDER") &&
    expectedKs <= line - 1 &&
    sixInningKs <= line - 0.5;

  return (overAlt || underAlt) && score >= 75;
}

function moneylineGradeLabel(type: string) {
  const normalized = normalizeType(type);
  if (normalized === "A MONEYLINE") return "Moneyline A+";
  if (normalized === "B MONEYLINE") return "Moneyline B+";
  if (normalized === "NON-EDGE MONEYLINE") return "Moneyline";

  return normalized.replace("MONEYLINE", "Moneyline");
}

function cleanMoneylineTeam(value: unknown) {
  return cleanTeamName(value);
}

function formatModelPct(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "—") return "—";
  const match = raw.match(/\d+(?:\.\d+)?\s*%?/);
  if (!match) return "—";
  const pct = match[0].replace(/\s/g, "");
  return pct.includes("%") ? pct : `${pct}%`;
}

function getMoneylineModelPct(play: Play, slateRows: SheetRow[]) {
  const direct = formatModelPct(play.moneylinePct);
  if (direct !== "—") return direct;

  const row = findSlateRowForPlay(play, slateRows);
  if (!row) return "—";

  const explicit = formatModelPct(
    firstValue(row, [
      "Model %",
      "Win %",
      "Moneyline %",
      "ML %",
      "Better ML %",
      "Better Moneyline %",
      "Model Win %",
      "ML Model %",
      "Projected Win %",
      "Win Probability",
      "Moneyline Win %",
      "Better Team Win %",
    ]),
  );

  if (explicit !== "—") return explicit;

  const selectedTeam = cleanTeamName(play.playerTeam || "").toLowerCase();
  let firstPct = "—";

  for (const [key, value] of Object.entries(row)) {
    const lowerKey = key.toLowerCase();
    if (
      !(
        lowerKey.includes("%") ||
        lowerKey.includes("probability") ||
        lowerKey.includes("win pct") ||
        lowerKey.includes("winpct")
      )
    )
      continue;
    if (
      lowerKey.includes("edge") ||
      lowerKey.includes("odds") ||
      lowerKey.includes("grade") ||
      lowerKey.includes("nrfi") ||
      lowerKey.includes("yrfi") ||
      lowerKey.includes("pitcher") ||
      lowerKey.includes("k ")
    )
      continue;

    const pct = formatModelPct(value);
    if (pct === "—") continue;

    if (firstPct === "—") firstPct = pct;
    if (selectedTeam && lowerKey.includes(selectedTeam)) return pct;
  }

  return firstPct;
}

function getPlayableOdds(play: Play) {
  const altOdds = formatOdds(play.altOdds || "");
  if (altOdds !== "—" && parseAmericanOdds(altOdds)) return altOdds;

  const odds = formatOdds(play.oddsLine || "");
  return parseAmericanOdds(odds) ? odds : "—";
}

function findSlateRowForPlay(play: Play, rows: SheetRow[]) {
  return rows.find((row) => {
    const game =
      row["Game Label"] ||
      `${row["Away Team"] || ""} at ${row["Home Team"] || ""}`.trim();
    return (
      game === play.game ||
      (row["Away Team"] === play.awayTeam && row["Home Team"] === play.homeTeam)
    );
  });
}

type PitcherSlot = {
  summary: string;
  score: string;
  reliability: string;
  probability: string;
  role: "Starter" | "Opener" | "Bulk";
  side: "Away" | "Home";
};

type PlayDiagnostics = {
  score: number;
  reliability: number;
  probability: number;
  probabilityText: string;
  reliabilityText: string;
  modelVersion: string;
  role: string;
  grade: string;
};

function isPitcherPlay(play: Play) {
  return isKType(play.playType) || isKType(play.play);
}

function pitcherGrade(play: Play) {
  const summaryGrade = normalizeType(play.play);
  return isKType(summaryGrade) && summaryGrade !== "PITCHER K"
    ? summaryGrade
    : normalizeType(play.playType);
}
function recordTypeForPlay(play: Play) {
  if (isPitcherPlay(play)) return pitcherGrade(play);

  const type = normalizeType(play.playType);

  // The public-data endpoint can still send a qualified Elite YRFI play under
  // the legacy YRFI label. Match it to the ELITE YRFI record bucket so the
  // 7-day Hot / Neutral / Cold trend uses the correct market history.
  if (type === "YRFI" && play.isGreen === true) return "ELITE YRFI";

  return type;
}


function percentNumber(value: unknown) {
  const n = normalizeProbability(value);
  return n > 0 ? Math.max(0, Math.min(100, n * 100)) : 0;
}

function percentText(value: unknown) {
  const n = percentNumber(value);
  return n ? `${n.toFixed(n >= 10 ? 1 : 2)}%` : "—";
}

function scoreText(value: unknown) {
  const n = toNumber(value);
  return n > 0 ? String(Math.round(n)) : "—";
}

function signedDifferenceText(
  projected: unknown,
  line: unknown,
  digits = 2,
) {
  const projectedNumber = toNumber(projected);
  const lineNumber = toNumber(line);
  if (!projectedNumber || !lineNumber) return "—";
  const difference = projectedNumber - lineNumber;
  return `${difference >= 0 ? "+" : ""}${difference.toFixed(digits)}`;
}

function rowModelVersion(row?: SheetRow, play?: Play) {
  return String(play?.modelVersion || row?.["Model Version"] || "").trim();
}

function pitcherSlotsFromRow(row?: SheetRow): PitcherSlot[] {
  if (!row) return [];

  const awayHasBulk = Boolean(String(row["Away Bulk Pitcher K + Grade"] || "").trim());
  const homeHasBulk = Boolean(String(row["Home Bulk Pitcher K + Grade"] || "").trim());

  const slots: PitcherSlot[] = [
    {
      summary: String(row["Away Pitcher K + Grade"] || ""),
      score: String(row["Away Pitcher K Score"] || ""),
      reliability: String(row["Away Pitcher K Reliability"] || ""),
      probability: String(row["Away Pitcher K Probability"] || ""),
      role: awayHasBulk ? "Opener" : "Starter",
      side: "Away",
    },
    {
      summary: String(row["Home Pitcher K + Grade"] || ""),
      score: String(row["Home Pitcher K Score"] || ""),
      reliability: String(row["Home Pitcher K Reliability"] || ""),
      probability: String(row["Home Pitcher K Probability"] || ""),
      role: homeHasBulk ? "Opener" : "Starter",
      side: "Home",
    },
    {
      summary: String(row["Away Bulk Pitcher K + Grade"] || ""),
      score: String(row["Away Bulk Pitcher K Score"] || ""),
      reliability: String(row["Away Bulk Pitcher K Reliability"] || ""),
      probability: "",
      role: "Bulk",
      side: "Away",
    },
    {
      summary: String(row["Home Bulk Pitcher K + Grade"] || ""),
      score: String(row["Home Bulk Pitcher K Score"] || ""),
      reliability: String(row["Home Bulk Pitcher K Reliability"] || ""),
      probability: "",
      role: "Bulk",
      side: "Home",
    },
  ];

  return slots.filter((slot) => slot.summary.trim());
}

function findPitcherSlot(play: Play, row?: SheetRow) {
  const slots = pitcherSlotsFromRow(row);
  if (!slots.length) return null;

  const targetName = pitcherNameKey(cleanPitcherName(play.play));
  const exactSummary = String(play.play || "").trim();

  return (
    slots.find((slot) => slot.summary.trim() === exactSummary) ||
    slots.find(
      (slot) =>
        targetName &&
        pitcherNameKey(cleanPitcherName(slot.summary)) === targetName,
    ) ||
    null
  );
}

function getPlayDiagnostics(play: Play, slateRows: SheetRow[] = []): PlayDiagnostics {
  const row = findSlateRowForPlay(play, slateRows);
  const modelVersion = rowModelVersion(row, play);

  if (isPitcherPlay(play)) {
    const slot = findPitcherSlot(play, row);
    const score = parseScore(slot?.score || play.score);
    const reliability = Math.max(
      0,
      Math.min(100, toNumber(slot?.reliability || play.reliability)),
    );
    const probability = percentNumber(slot?.probability || play.selectedProbability);
    return {
      score,
      reliability,
      probability,
      probabilityText: probability ? `${probability.toFixed(1)}%` : "—",
      reliabilityText: reliability ? `${Math.round(reliability)}/100` : "—",
      modelVersion,
      role: slot?.role || String(play.role || "Starter"),
      grade: pitcherGrade(play),
    };
  }

  if (isTotalType(play.playType)) {
    const reliability = Math.max(
      0,
      Math.min(
        100,
        toNumber(
          firstValue(row, ["Total Reliability"]) || play.reliability,
        ),
      ),
    );
    const probability = percentNumber(
      firstValue(row, ["Total Selected Probability"]) ||
        play.selectedProbability,
    );
    return {
      score: getTotalModelScore(play, slateRows),
      reliability,
      probability,
      probabilityText: probability ? `${probability.toFixed(1)}%` : "—",
      reliabilityText: reliability ? `${Math.round(reliability)}/100` : "—",
      modelVersion,
      role: "Game Total",
      grade: normalizeType(play.playType),
    };
  }

  if (isNRFIType(play.playType)) {
    const rawType = normalizeType(play.playType);
    const type = rawType === "YRFI" && play.isGreen === true ? "ELITE YRFI" : rawType;
    const yrfi = type.includes("YRFI");
    const probability = percentNumber(
      firstValue(row, [
        yrfi ? "YRFI Probability" : "NRFI Probability",
        yrfi ? "YRFI %" : "NRFI %",
      ]) || play.selectedProbability,
    );
    const directScore = toNumber(
      firstValue(row, [yrfi ? "YRFI Score" : "NRFI Score"]),
    );
    const score = directScore
      ? clampScore(directScore)
      : nrfiScoreFromRow(play, row);
    return {
      score,
      reliability: score,
      probability,
      probabilityText: probability ? `${probability.toFixed(1)}%` : "—",
      reliabilityText: score ? `${Math.round(score)}/100` : "—",
      modelVersion,
      role: "First Inning",
      grade: type,
    };
  }

  const modelPct = percentNumber(getMoneylineModelPct(play, slateRows));
  return {
    score: parseScore(play.score),
    reliability: parseScore(play.score),
    probability: modelPct,
    probabilityText: modelPct ? `${modelPct.toFixed(1)}%` : "—",
    reliabilityText: parseScore(play.score)
      ? `${Math.round(parseScore(play.score))}/100`
      : "—",
    modelVersion,
    role: "Moneyline",
    grade: normalizeType(play.playType),
  };
}


type PublicBettingInfo = {
  kind: "split" | "prop";
  source: string;
  betsPct?: number;
  moneyPct?: number;
  gapPct?: number;
  warning?: string;
  warningTone?: PublicSignalTone;
  warningNegative?: boolean;
  lineMovementSignal?: string;
  lineMovementTone?: PublicSignalTone | "";
  lineMovementBasis?: "Implied Probability" | "Total Line" | "";
  lineMovementValue?: number | null;
  openingBetsPct?: number;
  openingMoneyPct?: number;
  publicMovementPct?: number;
  sharpMovementPct?: number;
  openingLine?: number | null;
  openingOdds?: string;
  openingImpliedPct?: number | null;
  currentImpliedPct?: number | null;
  selection?: string;
  line?: string;
  odds?: string;
  rank?: number;
  market?: string;
  matchConfidence?: string;
  updatedAt?: string;
  exactPropMatch?: boolean;
};

function publicMatchKey(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedPublicDate(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const iso = raw.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const us = raw.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
  if (us) {
    const year = us[3].length === 2 ? `20${us[3]}` : us[3];
    return `${year}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  }
  return raw;
}

function sameDraftKingsGame(
  row: SheetRow | undefined,
  marketRow: { date?: string; awayTeam: string; homeTeam: string },
) {
  if (!row) return false;
  const awayMatch = publicMatchKey(row["Away Team"]) === publicMatchKey(marketRow.awayTeam);
  const homeMatch = publicMatchKey(row["Home Team"]) === publicMatchKey(marketRow.homeTeam);
  if (!awayMatch || !homeMatch) return false;
  const rowDate = normalizedPublicDate(row["Date"]);
  const marketDate = normalizedPublicDate(marketRow.date);
  return !rowDate || !marketDate || rowDate === marketDate;
}

function liveSplitsForRow(
  row: SheetRow | undefined,
  market: "Moneyline" | "Total",
  draftKings?: DraftKingsData | null,
) {
  return (draftKings?.splits || [])
    .filter((split) => split.market === market && sameDraftKingsGame(row, split))
    .sort((a, b) => {
      if (market === "Total") return a.side === "Over" ? -1 : b.side === "Over" ? 1 : 0;
      const awayKey = publicMatchKey(row?.["Away Team"]);
      return publicMatchKey(a.selectionTeam) === awayKey
        ? -1
        : publicMatchKey(b.selectionTeam) === awayKey
          ? 1
          : 0;
    });
}

function liveSplitInfoForPlay(
  play: Play,
  slateRows: SheetRow[],
  draftKings?: DraftKingsData | null,
): PublicBettingInfo | null {
  const row = findSlateRowForPlay(play, slateRows);
  if (!row || !draftKings) return null;
  const moneyline = isMoneylineType(play.playType);
  const total = isTotalType(play.playType);
  if (!moneyline && !total) return null;

  const market = moneyline ? "Moneyline" : "Total";
  const options = liveSplitsForRow(row, market, draftKings);
  const target = moneyline
    ? publicMatchKey(cleanTeamName(play.playerTeam || play.play || row["Better ML"]))
    : normalizeType(play.playType) === "TOTAL OVER"
      ? "over"
      : "under";
  const match = moneyline
    ? options.find((split) => publicMatchKey(split.selectionTeam) === target)
    : options.find((split) => split.side.toLowerCase() === target);
  if (!match) return null;

  const finalSnapshot = match.snapshotStatus === "FINAL_PREGAME";

  return {
    kind: "split",
    source: finalSnapshot
      ? "DraftKings Final Pregame Snapshot"
      : "DraftKings Live",
    betsPct: match.betsPct,
    moneyPct: match.moneyPct,
    gapPct: match.gapPct,
    warning: match.warning,
    warningTone: match.warningTone || (match.warningNegative ? "negative" : "positive"),
    warningNegative: match.warningNegative,
    lineMovementSignal: match.lineMovementSignal || "",
    lineMovementTone: match.lineMovementTone || "",
    lineMovementBasis: match.lineMovementBasis || "",
    lineMovementValue: match.lineMovementValue,
    openingBetsPct: match.openingBetsPct,
    openingMoneyPct: match.openingMoneyPct,
    publicMovementPct: match.publicMovementPct,
    sharpMovementPct: match.sharpMovementPct,
    openingLine: match.openingLine,
    openingOdds: match.openingOdds || "",
    openingImpliedPct: match.openingImpliedPct,
    currentImpliedPct: match.currentImpliedPct,
    selection: match.selection,
    line: match.line == null ? "" : String(match.line),
    odds: formatOdds(match.odds),
    matchConfidence: finalSnapshot
      ? "Official ~15-minute snapshot used by Records"
      : "Live game and selected-side match",
    updatedAt:
      match.snapshotTime ||
      match.lastSeenAt ||
      draftKings.updatedAt,
  };
}

function livePropInfoForSummary(
  summary: string,
  row: SheetRow | undefined,
  draftKings?: DraftKingsData | null,
): PublicBettingInfo | null {
  if (!summary || !row || !draftKings) return null;
  const pitcherKey = publicMatchKey(cleanPitcherName(summary));
  if (!pitcherKey) return null;
  const prop = (draftKings.props || []).find(
    (item) =>
      sameDraftKingsGame(row, item) && publicMatchKey(item.pitcher) === pitcherKey,
  );
  if (!prop) return null;

  const grade = normalizeType(summary);
  const modelSide = grade.includes("UNDER") ? "Under" : grade.includes("OVER") ? "Over" : "";
  const modelLine = toNumber(extractLine(summary));
  const exactSide = !modelSide || !prop.side || modelSide === prop.side;
  const exactLine = !modelLine || prop.line == null || Math.abs(modelLine - prop.line) < 0.01;

  return {
    kind: "prop",
    source: "DraftKings Live",
    rank: prop.rank,
    market: prop.market,
    line: prop.listedLine,
    odds: formatOdds(prop.odds),
    matchConfidence: exactSide && exactLine ? "Live exact pitcher side/line match" : "Live pitcher match",
    updatedAt: draftKings.updatedAt,
    exactPropMatch: exactSide && exactLine,
  };
}

function hasSheetValue(value: unknown) {
  const text = String(value ?? "").trim();
  return Boolean(text && text !== "—" && text.toLowerCase() !== "nan");
}

function publicPctNumber(value: unknown) {
  if (!hasSheetValue(value)) return undefined;
  const parsed = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : undefined;
}

function publicPctText(value?: number) {
  return value == null ? "—" : `${value.toFixed(value % 1 ? 1 : 0)}%`;
}

function signedPublicMoveText(value?: number) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)} pts`;
}

function marketMovementText(
  basis?: "Implied Probability" | "Total Line" | "",
  value?: number | null,
) {
  if (value == null || !basis) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)} ${
    basis === "Total Line" ? "runs" : "implied pts"
  }`;
}

function truthySheetFlag(value: unknown) {
  if (typeof value === "boolean") return value;
  return ["TRUE", "YES", "Y", "1"].includes(String(value ?? "").trim().toUpperCase());
}

function computedPublicWarning(betsPct?: number, moneyPct?: number) {
  if (betsPct == null || moneyPct == null) {
    return { label: "", tone: "neutral" as const, negative: false };
  }

  const gapPct = moneyPct - betsPct;
  if (betsPct >= 90 && moneyPct >= 90) {
    return {
      label: "Extreme Public + Sharp Agreement",
      tone: "negative" as const,
      negative: true,
    };
  }
  if (betsPct >= 80 && moneyPct >= 80) {
    return {
      label: "Heavy Public + Sharp Agreement",
      tone: "caution" as const,
      negative: true,
    };
  }

  // Public % represents ticket share and Sharp % represents money share.
  // The split is only balanced when those percentages are within 10 points.
  if (gapPct <= -20) {
    return { label: "Strong Sharp Rejection", tone: "negative" as const, negative: true };
  }
  if (gapPct <= -10) {
    return { label: "Sharp Rejection", tone: "negative" as const, negative: true };
  }
  if (gapPct >= 20) {
    return { label: "Strong Sharp Support", tone: "positive" as const, negative: false };
  }
  if (gapPct >= 10) {
    return { label: "Sharp Support", tone: "positive" as const, negative: false };
  }
  return {
    label: "Balanced Public / Sharp Split",
    tone: "neutral" as const,
    negative: false,
  };
}

function getPublicBettingInfo(
  play: Play,
  slateRows: SheetRow[] = [],
  draftKings?: DraftKingsData | null,
): PublicBettingInfo | null {
  const row = findSlateRowForPlay(play, slateRows);
  const liveSplit = liveSplitInfoForPlay(play, slateRows, draftKings);
  if (liveSplit) return liveSplit;
  if (isPitcherPlay(play)) {
    const liveProp = livePropInfoForSummary(play.play, row, draftKings);
    if (liveProp) return liveProp;
  }

  if (isMoneylineType(play.playType) || isTotalType(play.playType)) {
    const prefix = isMoneylineType(play.playType) ? "ML" : "Total";
    const betsPct = publicPctNumber(
      firstValue(row, [`${prefix} Public Bets %`]) || play.publicBetsPct,
    );
    const moneyPct = publicPctNumber(
      firstValue(row, [`${prefix} Public Money %`]) || play.publicMoneyPct,
    );
    if (betsPct == null && moneyPct == null) return null;

    const savedWarning = String(
      firstValue(row, [`${prefix} Public Warning`]) || play.publicWarning || "",
    ).trim();
    const computed = computedPublicWarning(betsPct, moneyPct);
    const warningNegativeRaw =
      firstValue(row, [`${prefix} Public Warning Negative`]) ||
      play.publicWarningNegative;

    return {
      kind: "split",
      source: String(
        firstValue(row, [`${prefix} Public Split Source`]) ||
          play.publicSplitSource ||
          "DraftKings",
      ),
      betsPct,
      moneyPct,
      gapPct:
        betsPct != null && moneyPct != null
          ? Math.round((moneyPct - betsPct) * 10) / 10
          : undefined,
      warning: savedWarning || computed.label,
      warningTone: computed.tone,
      warningNegative: hasSheetValue(warningNegativeRaw)
        ? truthySheetFlag(warningNegativeRaw)
        : computed.negative,
      selection: String(
        firstValue(row, [`${prefix} Public Split Selection`]) ||
          play.publicSplitSelection ||
          "",
      ),
      line: String(
        firstValue(row, [`${prefix} Public Split Line`]) ||
          play.publicSplitLine ||
          "",
      ),
      odds: formatOdds(
        firstValue(row, [`${prefix} Public Split Odds`]) ||
          play.publicSplitOdds ||
          "",
      ),
      matchConfidence: String(
        firstValue(row, [`${prefix} Public Match Confidence`]) ||
          play.publicSplitMatchConfidence ||
          "",
      ),
      updatedAt: String(
        firstValue(row, ["Public Data Updated"]) ||
          play.publicSplitUpdatedAt ||
          "",
      ),
    };
  }

  if (isPitcherPlay(play)) {
    const slot = findPitcherSlot(play, row);
    const prefix = slot
      ? `${slot.side} ${slot.role === "Bulk" ? "Bulk" : "Pitcher"}`
      : "";
    const rankValue =
      (prefix ? firstValue(row, [`${prefix} Prop Popularity Rank`]) : "") ||
      play.mostBetPropRank;
    const rank = toNumber(rankValue);
    if (!rank) return null;

    const exactRaw =
      (prefix ? firstValue(row, [`${prefix} Prop Popularity Flag`]) : "") ||
      play.mostBetProp;
    return {
      kind: "prop",
      source: String(
        (prefix ? firstValue(row, [`${prefix} Prop Popularity Source`]) : "") ||
          play.propPopularitySource ||
          "DraftKings",
      ),
      rank,
      market: String(
        (prefix ? firstValue(row, [`${prefix} Prop Popularity Market`]) : "") ||
          play.propPopularityMarket ||
          "",
      ),
      line: String(
        (prefix ? firstValue(row, [`${prefix} Prop Popularity Line`]) : "") ||
          play.propPopularityLine ||
          "",
      ),
      odds: formatOdds(
        (prefix ? firstValue(row, [`${prefix} Prop Popularity Odds`]) : "") ||
          play.propPopularityOdds ||
          "",
      ),
      matchConfidence: String(
        (prefix
          ? firstValue(row, [`${prefix} Prop Popularity Match Confidence`])
          : "") ||
          play.propPopularityMatchConfidence ||
          "",
      ),
      updatedAt: String(
        (prefix ? firstValue(row, [`${prefix} Prop Popularity Updated`]) : "") ||
          play.propPopularityUpdatedAt ||
          "",
      ),
      exactPropMatch: truthySheetFlag(exactRaw),
    };
  }

  return null;
}

function displayModelVersion(value: string) {
  if (!value) return "";
  return value
    .replace(/-\d{4}-\d{2}-\d{2}$/i, "")
    .replace(/-/g, " ")
    .replace(/\bv(\d)/i, "v$1")
    .replace(/\belite yrfi\b/i, "Elite YRFI");
}

function imageForBestPlay(play: Play, rows: SheetRow[]) {
  if (play.headshotUrl) return play.headshotUrl;
  if (!isPitcherPlay(play)) return "";

  const row = findSlateRowForPlay(play, rows);
  if (!row) return "";

  const slot = findPitcherSlot(play, row);
  if (!slot || slot.role === "Bulk") return "";

  return imageFromRow(
    row,
    slot.side === "Away"
      ? [
          "Away Pitcher Headshot URL",
          "Away Pitcher Headshot",
          "Away Pitcher Image URL",
        ]
      : [
          "Home Pitcher Headshot URL",
          "Home Pitcher Headshot",
          "Home Pitcher Image URL",
        ],
  );
}

function imageFromRow(row: SheetRow, keys: string[]) {
  for (const key of keys) {
    const value = String(row[key] || "").trim();
    if (value.startsWith("http")) return value;
  }

  return "";
}

function firstValue(row: SheetRow | undefined, keys: string[]) {
  if (!row) return "";
  for (const key of keys) {
    const value = String(row[key] ?? "").trim();
    if (value) return value;
  }
  return "";
}

function rowValueAtIndex(row: SheetRow | undefined, index: number) {
  if (!row) return "";
  const value = Object.values(row)[index];
  return String(value ?? "").trim();
}

function firstRowValue(row: SheetRow | undefined, keys: string[], fallbackIndex?: number) {
  const keyed = firstValue(row, keys);
  if (keyed) return keyed;
  return typeof fallbackIndex === "number" ? rowValueAtIndex(row, fallbackIndex) : "";
}

function normalizeProbability(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const n = toNumber(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1 ? n / 100 : n;
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function calculateNRFIScoreFromProbability(
  probability: number,
  playType: unknown,
) {
  if (!probability || !Number.isFinite(probability)) return 0;
  const rawNrfiScore = Math.max(
    0,
    Math.min(100, 50 + (probability - 0.515) * 450),
  );
  return normalizeType(playType).includes("YRFI") ? 100 - rawNrfiScore : rawNrfiScore;
}

function nrfiScoreFromRow(play: Play, row?: SheetRow) {
  if (!isNRFIType(play.playType)) return 0;

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

  if (row) {
    for (const key of directKeys) {
      const raw = String(row[key] ?? "").trim();
      if (!raw) continue;
      let score = toNumber(raw);
      if (!score) continue;
      if (score > 0 && score <= 1) score *= 100;
      const lowerKey = key.toLowerCase();
      if (
        normalizeType(play.playType).includes("YRFI") &&
        lowerKey.includes("nrfi") &&
        !lowerKey.includes("yrfi")
      )
        score = 100 - score;
      return clampScore(score);
    }

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
      let score = toNumber(rawValue);
      if (!score) continue;
      if (score > 0 && score <= 1) score *= 100;
      if (
        normalizeType(play.playType).includes("YRFI") &&
        lowerKey.includes("nrfi") &&
        !lowerKey.includes("yrfi")
      )
        score = 100 - score;
      return clampScore(score);
    }

    let probability = normalizeProbability(
      firstValue(row, [
        "NRFI %",
        "NRFI%",
        "NRFI Probability",
        "NRFI Prob",
        "NRFI Model %",
        "NRFI Model",
        "NRFI Projection",
        "NRFI Projected %",
      ]),
    );

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

    const calculated = calculateNRFIScoreFromProbability(
      probability,
      play.playType,
    );
    if (calculated) return clampScore(calculated);
  }

  // If no real NRFI/YRFI score or probability exists, do not invent a generic 65.
  // Returning 0 keeps unknown generic NRFI/YRFI plays out of Best Plays via the 65+ filter.
  const type = normalizeType(play.playType);
  if (type.includes("ELITE")) return 88;
  if (type.includes("STRONG")) return 78;
  if (type.includes("LEAN")) return 68;
  return 0;
}

function getBaseModelScore(play: Play, slateRows: SheetRow[] = []) {
  if (isTotalType(play.playType)) return getTotalModelScore(play, slateRows);

  const row = findSlateRowForPlay(play, slateRows);
  const nrfiScore = nrfiScoreFromRow(play, row);
  if (nrfiScore) return clampScore(nrfiScore);

  if (isPitcherPlay(play)) {
    const slot = findPitcherSlot(play, row);
    if (slot?.score) return parseScore(slot.score);
  }

  return parseScore(play.score);
}

function getRankScore(
  play: Play,
  _recentSummary: Summary | null,
  slateRows: SheetRow[] = [],
) {
  // Scores are already calibrated and reliability-aware in v14.1. Do not
  // re-grade them from short-term bet-type records or ALT badges on the website.
  return getBaseModelScore(play, slateRows);
}

function statusClass(wins: number, losses: number) {
  if (wins > losses) return "green";
  if (wins === losses) return "yellow";
  return "red";
}

function isFavoriteValue(value: unknown) {
  // Strict on purpose: only the actual Google Sheets TRUE value should count.
  return (
    String(value ?? "")
      .trim()
      .toLowerCase() === "true"
  );
}

function isHandpickedRecordRow(row: SheetRow) {
  // Active badges still use Favorite Pick only. Historical records can use
  // the permanent Handpicked Record flag, while still counting older rows
  // that only have Favorite Pick = TRUE.
  return (
    isFavoriteValue(row["Handpicked Record"]) ||
    isFavoriteValue(row["Was Handpicked"]) ||
    isFavoriteValue(row["Handpicked"]) ||
    isFavoriteValue(row["Favorite Pick"])
  );
}

function favoriteRankValue(play: Play) {
  const n = toNumber(play.favoriteRank);
  return n > 0 ? n : 999;
}

function favoriteTagValue(play: Play) {
  return String(play.favoriteTag || "")
    .trim()
    .toUpperCase();
}

function favoriteNotesValue(play: Play) {
  return String(play.favoriteNotes || "").trim();
}

function normalizeResult(value: unknown) {
  const text = String(value ?? "")
    .trim()
    .toUpperCase();
  if (["W", "WIN", "WON"].includes(text)) return "WIN";
  if (["L", "LOSS", "LOST"].includes(text)) return "LOSS";
  if (["P", "PUSH", "VOID", "CANCELLED", "CANCELED"].includes(text))
    return "PUSH";
  return "";
}

function americanProfitUnits(odds: number) {
  if (!odds) return 0;
  return odds > 0 ? odds / 100 : 100 / Math.abs(odds);
}

function emptyRecord(label: string): RecordTotals {
  return {
    label,
    record: "0-0-0",
    totalBets: 0,
    winPct: 0,
    unitsWon: 0,
    roiPct: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
  };
}

function parseDateOnly(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const direct = new Date(`${raw}T12:00:00`);
  if (!Number.isNaN(direct.getTime())) return direct;
  const fallback = new Date(raw);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function calculateFavoriteRecord(
  rows: SheetRow[] | undefined,
  mode: "all" | "last7" | "today" = "all",
  today = "",
) {
  const totals = emptyRecord(
    mode === "today"
      ? "Handpicked Plays Today"
      : mode === "last7"
        ? "Handpicked Plays Last 7 Days"
        : "Handpicked Plays",
  );
  if (!rows?.length) return totals;

  const todayDate = parseDateOnly(today);
  const startDate = todayDate ? new Date(todayDate) : null;
  if (startDate) startDate.setDate(startDate.getDate() - 6);

  rows.forEach((row) => {
    if (!isHandpickedRecordRow(row)) return;

    const rowDateText = row.Date || row.date || row["Bet Date"] || "";
    const rowDate = parseDateOnly(rowDateText);
    if (mode === "today" && today && rowDateText !== today) return;
    if (mode === "last7" && startDate && todayDate) {
      if (!rowDate || rowDate < startDate || rowDate > todayDate) return;
    }

    const result = normalizeResult(row.Result);
    if (!result) return;

    const odds = parseAmericanOdds(
      row["Odds/Line"] || row.Odds || row["ML Odds"] || "",
    );
    totals.totalBets += 1;

    if (result === "WIN") {
      totals.wins += 1;
      totals.unitsWon += americanProfitUnits(odds) || 1;
    } else if (result === "LOSS") {
      totals.losses += 1;
      totals.unitsWon -= 1;
    } else if (result === "PUSH") {
      totals.pushes += 1;
    }
  });

  totals.record = `${totals.wins}-${totals.losses}-${totals.pushes}`;
  const decisions = totals.wins + totals.losses;
  totals.winPct = decisions
    ? Math.round((totals.wins / decisions) * 1000) / 10
    : 0;
  totals.unitsWon = Math.round(totals.unitsWon * 100) / 100;
  totals.roiPct = totals.totalBets
    ? Math.round((totals.unitsWon / totals.totalBets) * 1000) / 10
    : 0;
  return totals;
}


function trackerDateInMode(row: SheetRow, mode: "all" | "last7" | "today", today = "") {
  const rowDateText = row.Date || row.date || row["Bet Date"] || "";
  const rowDate = parseDateOnly(rowDateText);
  const todayDate = parseDateOnly(today);

  if (mode === "today") return today ? sameDateText(rowDateText, today) : true;
  if (mode === "last7" && todayDate) {
    const startDate = new Date(todayDate);
    startDate.setDate(startDate.getDate() - 6);
    return Boolean(rowDate && rowDate >= startDate && rowDate <= todayDate);
  }

  return true;
}

function buildSummaryFromAccumulator(betType: string, totals: RecordTotals): Summary {
  let status: Summary["status"] = "EVEN";
  if (totals.wins > totals.losses) status = "WINNING";
  if (totals.losses > totals.wins) status = "LOSING";

  return {
    betType,
    status,
    wins: totals.wins,
    losses: totals.losses,
    pushes: totals.pushes,
    totalBets: totals.totalBets,
    winPct: totals.winPct,
    unitsWon: totals.unitsWon,
    roiPct: totals.roiPct,
  };
}

function finalizeRecordTotals(totals: RecordTotals) {
  totals.totalBets = totals.wins + totals.losses + totals.pushes;
  totals.record = `${totals.wins}-${totals.losses}-${totals.pushes}`;
  const decisions = totals.wins + totals.losses;
  totals.winPct = decisions ? Math.round((totals.wins / decisions) * 1000) / 10 : 0;
  totals.unitsWon = Math.round(totals.unitsWon * 100) / 100;
  totals.roiPct = totals.totalBets ? Math.round((totals.unitsWon / totals.totalBets) * 1000) / 10 : 0;
  return totals;
}

function firstInningTrackerKey(row: SheetRow) {
  const dateKey = favoriteDateKey(row.Date || row.date || row["Bet Date"] || "");
  const awayTeam = row["Away Team"] || row.Away || "";
  const homeTeam = row["Home Team"] || row.Home || "";
  const matchupFromTeams =
    awayTeam || homeTeam ? `${awayTeam} at ${homeTeam}` : "";
  const game =
    row.Game ||
    row["Game Label"] ||
    row.Matchup ||
    matchupFromTeams ||
    row.Selection ||
    row.Pick ||
    row.Play ||
    "";

  return `${dateKey}|${favoriteKeyText(game)}`;
}

function calculateTrackerRecordSummary(
  rows: SheetRow[] | undefined,
  mode: "all" | "last7" | "today" = "all",
  today = "",
  handpickedOnly = false,
) {
  const grouped = new Map<string, RecordTotals>();
  if (!rows?.length) return [] as Summary[];

  const eligibleRows = rows.filter((row) => {
    if (handpickedOnly && !isHandpickedRecordRow(row)) return false;
    if (!trackerDateInMode(row, mode, today)) return false;

    const betType = normalizeType(
      row["Bet Type"] || row["Play Type"] || row.Type || "",
    );
    if (!isPublicTrackedRecordType(betType)) return false;

    return Boolean(normalizeResult(row.Result || row.Status || ""));
  });

  // Some older tracker/API workflows saved the same Elite YRFI result under both
  // ELITE YRFI and the broader YRFI label. Keep the elite classification only.
  const eliteYrfiKeys = new Set(
    eligibleRows
      .filter(
        (row) =>
          normalizeType(
            row["Bet Type"] || row["Play Type"] || row.Type || "",
          ) === "ELITE YRFI",
      )
      .map(firstInningTrackerKey),
  );

  eligibleRows.forEach((row) => {
    const betType = normalizeType(
      row["Bet Type"] || row["Play Type"] || row.Type || "",
    );

    if (
      betType === "YRFI" &&
      eliteYrfiKeys.has(firstInningTrackerKey(row))
    )
      return;

    const result = normalizeResult(row.Result || row.Status || "");
    if (!grouped.has(betType)) grouped.set(betType, emptyRecord(betType));
    const totals = grouped.get(betType)!;
    const odds = parseAmericanOdds(
      row["Odds/Line"] || row.Odds || row["ML Odds"] || "",
    );

    if (result === "WIN") {
      totals.wins += 1;
      totals.unitsWon += americanProfitUnits(odds) || 1;
    } else if (result === "LOSS") {
      totals.losses += 1;
      totals.unitsWon -= 1;
    } else if (result === "PUSH") {
      totals.pushes += 1;
    }
  });

  return [...grouped.entries()].map(([betType, totals]) =>
    buildSummaryFromAccumulator(betType, finalizeRecordTotals(totals)),
  );
}

function calculateTrackerLastBetsSummary(
  rows: SheetRow[] | undefined,
  betCount = 7,
): Summary[] {
  if (!rows?.length) return [] as Summary[];

  const eligibleRows = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => {
      const betType = normalizeType(
        row["Bet Type"] || row["Play Type"] || row.Type || "",
      );
      return (
        isPublicTrackedRecordType(betType) &&
        Boolean(normalizeResult(row.Result || row.Status || ""))
      );
    });

  // Keep Elite YRFI results out of the broader legacy YRFI bucket when both
  // versions of the same tracker row exist.
  const eliteYrfiKeys = new Set(
    eligibleRows
      .filter(
        ({ row }) =>
          normalizeType(
            row["Bet Type"] || row["Play Type"] || row.Type || "",
          ) === "ELITE YRFI",
      )
      .map(({ row }) => firstInningTrackerKey(row)),
  );

  const grouped = new Map<
    string,
    Array<{ row: SheetRow; index: number; timestamp: number }>
  >();

  eligibleRows.forEach(({ row, index }) => {
    const betType = normalizeType(
      row["Bet Type"] || row["Play Type"] || row.Type || "",
    );
    if (
      betType === "YRFI" &&
      eliteYrfiKeys.has(firstInningTrackerKey(row))
    )
      return;

    const rowDate = parseDateOnly(row.Date || row.date || row["Bet Date"] || "");
    const timestamp = rowDate?.getTime() || 0;
    const bucket = grouped.get(betType) || [];
    bucket.push({ row, index, timestamp });
    grouped.set(betType, bucket);
  });

  return [...grouped.entries()].map(([betType, entries]) => {
    const totals = emptyRecord(`${betType} - Last ${betCount} Bets`);
    const recentEntries = [...entries]
      .sort((a, b) => b.timestamp - a.timestamp || b.index - a.index)
      .slice(0, betCount);

    recentEntries.forEach(({ row }) => {
      const result = normalizeResult(row.Result || row.Status || "");
      const odds = parseAmericanOdds(
        row["Odds/Line"] || row.Odds || row["ML Odds"] || "",
      );

      if (result === "WIN") {
        totals.wins += 1;
        totals.unitsWon += americanProfitUnits(odds) || 1;
      } else if (result === "LOSS") {
        totals.losses += 1;
        totals.unitsWon -= 1;
      } else if (result === "PUSH") {
        totals.pushes += 1;
      }
    });

    return buildSummaryFromAccumulator(
      betType,
      finalizeRecordTotals(totals),
    );
  });
}

function mergeRecordSummaries(primary: Summary[] | undefined, fallback: Summary[]) {
  // Whenever raw tracker rows are available, they are the source of truth for the
  // complete records table. Do not retain an API-only bucket that is absent from
  // the exact tracker rebuild; that was causing ELITE YRFI to reappear as YRFI.
  if (fallback.length) return fallback;
  return primary || [];
}

function splitGameTeams(game: string) {
  const parts = String(game || "").split(/\s+(?:at|@|vs\.?|v\.?|versus)\s+/i);
  return {
    awayTeam: cleanTeamName(parts[0] || ""),
    homeTeam: cleanTeamName(parts[1] || ""),
  };
}

function trackerTotalPlayKey(play: Play) {
  return `${normalizeType(play.playType)}|${favoriteKeyText(play.game || play.play)}|${getTotalLine(play)}|${formatOdds(play.oddsLine)}`;
}

function totalPlayFromTrackerRow(row: SheetRow): Play | null {
  const playType = normalizeType(row["Bet Type"] || row["Play Type"] || row.Type || "");
  const market = String(row.Market || row["Bet Market"] || "").toLowerCase();
  if (!isTotalType(playType) && !market.includes("game total")) return null;

  const game =
    row.Game ||
    row["Game Label"] ||
    row.Matchup ||
    row.Selection ||
    row.Pick ||
    row.Play ||
    "Game Total";
  const teams = splitGameTeams(String(game));

  return {
    playType,
    game: String(game),
    play: String(row.Selection || row.Pick || row.Play || game),
    oddsLine: String(row["Odds/Line"] || row.Odds || ""),
    score: firstRowValue(
      row,
      [
        "Projection",
        "Projected",
        "Projected Total",
        "Total Projection",
        "Total Runs Projection",
        "Model Projection",
        "Predicted Total",
        "Run Projection",
        "Score",
        "EZPZ Score",
      ],
    ),
    isGreen: true,
    awayTeam: teams.awayTeam,
    homeTeam: teams.homeTeam,
    projectedKs: "",
    sixInningKs: "",
    favoritePick: row["Favorite Pick"],
    favoriteRank: row["Favorite Rank"],
    favoriteTag: row["Favorite Tag"],
    favoriteNotes: row["Favorite Notes"],
  };
}

function totalPlaysFromTrackerRows(rows: SheetRow[] | undefined, today = "") {
  if (!rows?.length) return [] as Play[];
  return rows
    .filter((row) => trackerDateInMode(row, "today", today))
    .filter((row) => !normalizeResult(row.Result || row.Status || ""))
    .map(totalPlayFromTrackerRow)
    .filter(Boolean) as Play[];
}

function mergeBestPlaysWithTrackerTotals(apiPlays: Play[] | undefined, trackerTotalPlays: Play[]) {
  const merged: Play[] = [...(apiPlays || [])];
  const existingKeyToIndex = new Map<string, number>();

  merged.forEach((play, index) => {
    if (isTotalType(play.playType)) existingKeyToIndex.set(trackerTotalPlayKey(play), index);
  });

  trackerTotalPlays.forEach((play) => {
    const key = trackerTotalPlayKey(play);
    const existingIndex = existingKeyToIndex.get(key);

    if (typeof existingIndex === "number") {
      const existing = merged[existingIndex];
      merged[existingIndex] = {
        ...existing,
        score: getTotalProjectionNumber(play) || !getTotalProjectionNumber(existing) ? play.score : existing.score,
        play: existing.play || play.play,
        game: existing.game || play.game,
        oddsLine:
          parseAmericanOdds(existing.oddsLine) !== 0
            ? existing.oddsLine
            : play.oddsLine || existing.oddsLine,
        awayTeam: existing.awayTeam || play.awayTeam,
        homeTeam: existing.homeTeam || play.homeTeam,
        favoritePick: existing.favoritePick || play.favoritePick,
        favoriteRank: existing.favoriteRank || play.favoriteRank,
        favoriteTag: existing.favoriteTag || play.favoriteTag,
        favoriteNotes: existing.favoriteNotes || play.favoriteNotes,
      };
      return;
    }

    existingKeyToIndex.set(key, merged.length);
    merged.push(play);
  });

  return merged;
}

function sameDateText(a: unknown, b: unknown) {
  const aText = String(a ?? "").trim();
  const bText = String(b ?? "").trim();
  if (!aText || !bText) return false;
  const aDate = parseDateOnly(aText);
  const bDate = parseDateOnly(bText);
  if (aDate && bDate) return aDate.toDateString() === bDate.toDateString();
  return aText === bText;
}

function favoriteKeyText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function favoriteDateKey(value: unknown) {
  const parsed = parseDateOnly(value);
  return parsed ? parsed.toDateString() : String(value ?? "").trim();
}

function pitcherNameKey(value: unknown) {
  let raw = String(value ?? "").trim();

  // Remove prop details so only the pitcher name remains.
  raw = raw
    .replace(/\bLine\b.*$/i, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\b\d+(?:\.\d+)?\+?\s*(?:so|k|ks|strikeouts?)?\b.*$/i, "")
    .replace(/\b(?:over|under|strong|lean)\b.*$/i, "")
    .trim();

  // Convert "Last, First" to "First Last" so tracker and play names match.
  if (raw.includes(",")) {
    const [last, first] = raw.split(",", 2);
    raw = `${first || ""} ${last || ""}`.trim();
  }

  return favoriteKeyText(raw);
}

function cleanTrackerPitcherSelection(value: unknown) {
  return pitcherNameKey(value);
}

function favoriteKeyFromTrackerRow(row: SheetRow, today: string) {
  if (!isFavoriteValue(row["Favorite Pick"])) return "";
  if (!sameDateText(row.Date || row.date || row["Bet Date"] || "", today))
    return "";

  const dateKey = favoriteDateKey(today);
  const type = normalizeType(row["Bet Type"] || row["Market"] || "");
  const market = favoriteKeyText(row["Market"] || "");
  const selection =
    row["Selection"] || row["Pick"] || row["Play"] || row["Player"] || "";

  if (isMoneylineType(type) || market === "moneyline") {
    return `ML|${dateKey}|${favoriteKeyText(cleanTeamName(selection))}`;
  }

  if (isKType(type) || market.includes("pitcher strikeout")) {
    return `K|${dateKey}|${cleanTrackerPitcherSelection(selection)}`;
  }

  if (isNRFIType(type) || market.includes("nrfi") || market.includes("yrfi")) {
    const game =
      row["Game"] || row["Game Label"] || row["Matchup"] || selection;
    return `FI|${dateKey}|${type}|${favoriteKeyText(game)}`;
  }

  if (isTotalType(type) || market.includes("game total") || market === "total") {
    const game = row["Game"] || row["Game Label"] || row["Matchup"] || selection;
    return `TOTAL|${dateKey}|${type}|${favoriteKeyText(game)}`;
  }

  return `OTHER|${dateKey}|${type}|${favoriteKeyText(selection)}`;
}

function favoriteKeyFromPlay(play: Play, today: string) {
  const dateKey = favoriteDateKey(today);
  const type = normalizeType(play.playType);

  if (isMoneylineType(type)) {
    return `ML|${dateKey}|${favoriteKeyText(cleanMoneylineTeam(play.playerTeam || play.play))}`;
  }

  if (isKType(type)) {
    return `K|${dateKey}|${pitcherNameKey(cleanPitcherName(play.play))}`;
  }

  if (isNRFIType(type)) {
    return `FI|${dateKey}|${type}|${favoriteKeyText(play.game || play.play)}`;
  }

  if (isTotalType(type)) {
    return `TOTAL|${dateKey}|${type}|${favoriteKeyText(play.game || play.play)}`;
  }

  return `OTHER|${dateKey}|${type}|${favoriteKeyText(play.play)}`;
}

function buildFavoriteRowMap(rows: SheetRow[] | undefined, today: string) {
  const map = new Map<string, SheetRow>();
  if (!rows?.length || !today) return map;

  rows.forEach((row) => {
    const key = favoriteKeyFromTrackerRow(row, today);
    if (key && !map.has(key)) map.set(key, row);
  });

  return map;
}

function calculateFavoriteCount(rows: SheetRow[] | undefined, today = "") {
  if (!rows?.length) return 0;
  return rows.filter((row) => {
    if (!isFavoriteValue(row["Favorite Pick"])) return false;
    if (!today) return true;
    return sameDateText(row.Date || row.date || row["Bet Date"] || "", today);
  }).length;
}

function slateMoneylinePassesBestPlayRules(row: SheetRow) {
  const grade = normalizeType(row["ML Grade"] || "");
  return grade === "A MONEYLINE" || grade === "B MONEYLINE";
}

function Tile({
  label,
  value,
  meta,
  green,
}: {
  label: string;
  value: string;
  meta: string;
  green?: boolean;
}) {
  return (
    <div className={`tile ${green ? "green" : ""}`}>
      <div className="tileLabel">{label}</div>
      <div className="tileValue">{value}</div>
      <div className="tileMeta">{meta}</div>
    </div>
  );
}

function TeamRow({
  awayTeam,
  homeTeam,
}: {
  awayTeam: string;
  homeTeam: string;
}) {
  const cleanAway = cleanTeamName(awayTeam);
  const cleanHome = cleanTeamName(homeTeam);
  const awayLogo = teamLogoUrl(cleanAway);
  const homeLogo = teamLogoUrl(cleanHome);

  return (
    <div className="teamRow">
      <div className="teamSide">
        {awayLogo ? (
          <img className="teamLogo" src={awayLogo} alt={`${cleanAway} logo`} loading="lazy" />
        ) : null}
        <div className="teamName">{cleanAway}</div>
      </div>

      <div className="vsText">AT</div>

      <div className="teamSide home">
        <div className="teamName">{cleanHome}</div>
        {homeLogo ? (
          <img className="teamLogo" src={homeLogo} alt={`${cleanHome} logo`} loading="lazy" />
        ) : null}
      </div>
    </div>
  );
}

function PitcherPhoto({
  url,
  summary,
  team = "",
}: {
  url?: string;
  summary: string;
  team?: string;
}) {
  const name = cleanPitcherName(summary);
  const officialHeadshot = useMlbPitcherHeadshot(summary);
  const candidates = useMemo(
    () => [...new Set([url, officialHeadshot].filter(Boolean) as string[])],
    [url, officialHeadshot],
  );
  const candidateSignature = candidates.join("|");
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const activeUrl = candidates[candidateIndex] || "";
  const teamLogo = teamLogoUrl(team);

  useEffect(() => {
    setCandidateIndex(0);
    setLoaded(false);
  }, [candidateSignature]);

  return (
    <div className={`headshotFrame ${loaded ? "loaded" : ""}`}>
      {activeUrl ? (
        <img
          className="headshot"
          src={activeUrl}
          alt={`${name} headshot`}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => {
            setLoaded(false);
            setCandidateIndex((current) => current + 1);
          }}
        />
      ) : (
        <div className="headshotFallback" aria-label={`${name} headshot unavailable`}>
          <svg viewBox="0 0 64 64" aria-hidden="true">
            <circle cx="32" cy="23" r="12" />
            <path d="M12 57c1.8-13 9.1-20 20-20s18.2 7 20 20" />
          </svg>
        </div>
      )}
      {teamLogo ? (
        <img
          className="headshotTeamBadge"
          src={teamLogo}
          alt=""
          aria-hidden="true"
          loading="lazy"
        />
      ) : null}
    </div>
  );
}

function TeamPickMark({ team }: { team: string }) {
  const logo = teamLogoUrl(team);

  return (
    <div className="teamPickFrame" aria-label={`${team} team logo`}>
      {logo ? (
        <img
          className="teamPickLogo"
          src={logo}
          alt={`${team} logo`}
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div className="teamPickFallback">{initials(team)}</div>
      )}
    </div>
  );
}

function MiniBubble({
  label,
  value,
  green,
}: {
  label: string;
  value: string | number;
  green?: boolean;
}) {
  return (
    <div className={`miniBubble ${green ? "green" : ""}`}>
      <div className="miniLabel">{label}</div>
      <div className="miniValue">{value || "—"}</div>
    </div>
  );
}

function FormTag({
  summary,
  window,
}: {
  summary: Summary | null;
  window: MarketFormWindow;
}) {
  const form = getFormInfo(summary, window);
  const periodLabel = window === "last7Days" ? "7 Days" : "Last 7 Bets";

  return (
    <div
      className={`formPill ${form.className}`}
      title="Record context only; this does not change the current model score."
    >
      {form.icon} {periodLabel}: {form.label}{" "}
      <span style={{ opacity: 0.72 }}>• {form.detail}</span>
    </div>
  );
}

function ConfidenceBar({
  score,
  label = "Projection Reliability",
}: {
  score: string | number;
  label?: string;
}) {
  const pct = parseScore(score);

  return (
    <div className="confidenceWrap" aria-label={`${label}: ${Math.round(pct)} percent`}>
      <div className="confidenceTop">
        <span>{label}</span>
        <span>{pct ? `${Math.round(pct)}%` : "—"}</span>
      </div>
      <div className="confidenceBar">
        <div className="confidenceFill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function BadgeRow({ play }: { play: Play }) {
  const showAlt = hasAltBadge(play);
  if (!showAlt) return null;

  return (
    <div className="badges">
      <span className="badge alt">⭐ ALT</span>
    </div>
  );
}


function PublicBettingPanel({ info }: { info: PublicBettingInfo | null }) {
  if (!info) return null;

  if (info.kind === "prop") {
    const exact = info.exactPropMatch === true;
    const warningLabel = exact
      ? info.rank && info.rank <= 10
        ? "Highly Popular Player Prop"
        : "Popular Player Prop"
      : "Pitcher Popularity Match — Different Side/Line";

    return (
      <div className="publicSplitPanel">
        <div className="publicSplitTitle">
          <span>{info.source} Most-Bet Props</span>
          <strong>#{info.rank}</strong>
        </div>
        <div className="bubbleGrid publicSplitGrid">
          <MiniBubble label="Handle Rank" value={`#${info.rank}`} />
          <MiniBubble label="Listed Line" value={info.line || "—"} />
          <MiniBubble label="Listed Odds" value={info.odds || "—"} />
          <MiniBubble label="Match" value={exact ? "Exact" : "Different"} />
        </div>
        <div className={`publicWarning ${exact ? "caution" : "neutral"}`}>
          {exact ? "⚠" : "ℹ"} {warningLabel}
        </div>
        <div className="publicSplitMeta">
          {info.matchConfidence || "DraftKings popularity ranking"}
          {info.updatedAt ? ` • ${info.updatedAt}` : ""}
        </div>
      </div>
    );
  }

  const warningClass = info.warningTone || (info.warningNegative ? "negative" : "positive");
  const warningIcon =
    warningClass === "negative" ? "⚠" :
    warningClass === "caution" ? "⚠" :
    warningClass === "positive" ? "↗" : "○";
  const movementClass = info.lineMovementTone || "neutral";
  const movementIcon = movementClass === "negative" ? "↘" : "↗";
  const movementDetail =
    info.lineMovementValue == null || !info.lineMovementBasis
      ? ""
      : info.lineMovementBasis === "Total Line"
        ? ` • ${info.lineMovementValue > 0 ? "+" : ""}${info.lineMovementValue.toFixed(1)} runs`
        : ` • ${info.lineMovementValue > 0 ? "+" : ""}${info.lineMovementValue.toFixed(1)} implied pts`;
  return (
    <div className="publicSplitPanel">
      <div className="publicSplitTitle">
        <span>{info.source} Public / Sharp Splits</span>
        <strong>{info.selection || "Selected side"}</strong>
      </div>
      <div className="bubbleGrid publicSplitGrid">
        <MiniBubble label="Opening Public" value={publicPctText(info.openingBetsPct)} />
        <MiniBubble label="Current Public" value={publicPctText(info.betsPct)} />
        <MiniBubble label="Public Change" value={signedPublicMoveText(info.publicMovementPct)} />
        <MiniBubble label="Opening Sharp" value={publicPctText(info.openingMoneyPct)} />
        <MiniBubble label="Current Sharp" value={publicPctText(info.moneyPct)} />
        <MiniBubble label="Sharp Change" value={signedPublicMoveText(info.sharpMovementPct)} />
        <MiniBubble
          label="Sharp − Public"
          value={
            info.gapPct == null
              ? "—"
              : `${info.gapPct >= 0 ? "+" : ""}${info.gapPct.toFixed(1)}%`
          }
        />
        <MiniBubble label="Opening Odds" value={formatOdds(info.openingOdds)} />
        <MiniBubble label="Current Odds" value={info.odds || "—"} />
        <MiniBubble
          label="Market Move"
          value={marketMovementText(info.lineMovementBasis, info.lineMovementValue)}
        />
      </div>
      <div className="publicSignalStack">
        {info.warning ? (
          <div className={`publicWarning ${warningClass}`}>
            {warningIcon} {info.warning}
          </div>
        ) : null}
        {info.lineMovementSignal ? (
          <div className={`publicWarning ${movementClass}`}>
            {movementIcon} {info.lineMovementSignal}{movementDetail}
          </div>
        ) : null}
      </div>
      <div className="publicSplitMeta">
        Public {publicPctText(info.openingBetsPct)} → {publicPctText(info.betsPct)}
        {info.openingLine != null && info.line
          ? ` • Line ${info.openingLine} → ${info.line}`
          : info.openingOdds
            ? ` • Odds ${formatOdds(info.openingOdds)} → ${info.odds || "—"}`
            : ""}
        {info.openingImpliedPct != null && info.currentImpliedPct != null
          ? ` • Implied ${info.openingImpliedPct.toFixed(1)}% → ${info.currentImpliedPct.toFixed(1)}%`
          : ""}
      </div>
      <div className="publicSplitMeta">
        {info.matchConfidence || "DraftKings selected-side split"}
        {info.updatedAt ? ` • ${info.updatedAt}` : ""}
      </div>
    </div>
  );
}

function LiveMarketSplits({
  row,
  market,
  draftKings,
}: {
  row: SheetRow;
  market: "Moneyline" | "Total";
  draftKings?: DraftKingsData | null;
}) {
  const rows = liveSplitsForRow(row, market, draftKings);
  if (!rows.length) return null;

  return (
    <div className="publicSplitPanel liveMarketPanel">
      <div className="publicSplitTitle">
        <span>DraftKings Live {market} Splits</span>
        <strong>{draftKings?.stale ? "Last available" : "Live"}</strong>
      </div>
      <div className="liveSplitTable">
        {rows.map((split) => {
          const warningTone =
            split.warningTone || (split.warningNegative ? "negative" : "neutral");
          const warningIcon =
            warningTone === "negative" || warningTone === "caution"
              ? "⚠"
              : warningTone === "positive"
                ? "↗"
                : "○";
          const movementTone = split.lineMovementTone || "neutral";
          const movementIcon = movementTone === "negative" ? "↘" : "↗";

          return (
            <div className="liveSplitEntry" key={`${split.market}-${split.selection}`}>
              <div className="liveSplitRow">
                <strong>{split.selection}</strong>
                <span>
                  <small>Public</small>
                  {publicPctText(split.openingBetsPct)} → {publicPctText(split.betsPct)}
                </span>
                <span><small>Sharp</small>{publicPctText(split.moneyPct)}</span>
                <span>
                  <small>Odds</small>
                  {split.openingOdds ? `${formatOdds(split.openingOdds)} → ` : ""}{formatOdds(split.odds)}
                </span>
              </div>
              <div className="publicSplitMeta">
                Public change {signedPublicMoveText(split.publicMovementPct)}
                {split.sharpMovementPct != null
                  ? ` • Sharp change ${signedPublicMoveText(split.sharpMovementPct)}`
                  : ""}
                {split.openingLine != null && split.line != null
                  ? ` • Line ${split.openingLine} → ${split.line}`
                  : ""}
                {split.lineMovementBasis && split.lineMovementValue != null
                  ? ` • Market ${marketMovementText(split.lineMovementBasis, split.lineMovementValue)}`
                  : ""}
              </div>
              <div className="liveSplitSignals">
                {split.warning ? (
                  <span className={`liveSignalPill ${warningTone}`}>
                    {warningIcon} {split.warning}
                  </span>
                ) : null}
                {split.lineMovementSignal ? (
                  <span className={`liveSignalPill ${movementTone}`}>
                    {movementIcon} {split.lineMovementSignal}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <div className="publicSplitMeta">
        Updated {draftKings?.updatedAt || "recently"}
        {draftKings?.stale ? " • DraftKings refresh unavailable; showing last successful pull" : ""}
      </div>
    </div>
  );
}


function modelTrendBadgeText(status: ModelTrendMatch) {
  return status === "MATCH"
    ? "MODEL + TREND MATCH"
    : status === "AGREE"
      ? "MODEL + TREND AGREE"
      : "";
}

function playGameMatchKey(play: Play) {
  if (play.awayTeam && play.homeTeam) {
    return `${publicMatchKey(play.awayTeam)}|${publicMatchKey(play.homeTeam)}`;
  }
  return publicMatchKey(play.game);
}

function trendGameMatchKey(play: TrendPlay) {
  if (play.awayTeam && play.homeTeam) {
    return `${publicMatchKey(play.awayTeam)}|${publicMatchKey(play.homeTeam)}`;
  }
  return publicMatchKey(play.game);
}

function modelTrendMatchForPair(
  modelPlay: Play,
  trendPlay: TrendPlay,
  slateRows: SheetRow[],
): ModelTrendMatch {
  if (playGameMatchKey(modelPlay) !== trendGameMatchKey(trendPlay)) return "";

  if (isMoneylineType(modelPlay.playType) && trendPlay.market === "Moneyline") {
    const modelTeam = publicMatchKey(
      cleanMoneylineTeam(modelPlay.playerTeam || modelPlay.play),
    );
    const trendTeam = publicMatchKey(
      trendPlay.selectionTeam || cleanMoneylineTeam(trendPlay.selection),
    );
    return modelTeam && modelTeam === trendTeam ? "MATCH" : "";
  }

  if (isTotalType(modelPlay.playType) && trendPlay.market === "Total") {
    const modelSide = normalizeType(modelPlay.playType) === "TOTAL UNDER" ? "Under" : "Over";
    if (modelSide !== trendPlay.side) return "";
    const modelLine = toNumber(getTotalLine(modelPlay, slateRows));
    const trendLine = Number(trendPlay.line);
    if (modelLine && Number.isFinite(trendLine) && Math.abs(modelLine - trendLine) < 0.01) {
      return "MATCH";
    }
    return "AGREE";
  }

  return "";
}

function trendMatchForBestPlay(
  play: Play,
  trendPlays: TrendPlay[],
  slateRows: SheetRow[],
): ModelTrendMatch {
  let status: ModelTrendMatch = "";
  for (const trendPlay of trendPlays) {
    const pairStatus = modelTrendMatchForPair(play, trendPlay, slateRows);
    if (pairStatus === "MATCH") return "MATCH";
    if (pairStatus === "AGREE") status = "AGREE";
  }
  return status;
}

function bestMatchForTrendPlay(
  trendPlay: TrendPlay,
  bestPlays: Play[],
  slateRows: SheetRow[],
): ModelTrendMatch {
  let status: ModelTrendMatch = "";
  for (const play of bestPlays) {
    const pairStatus = modelTrendMatchForPair(play, trendPlay, slateRows);
    if (pairStatus === "MATCH") return "MATCH";
    if (pairStatus === "AGREE") status = "AGREE";
  }
  return status;
}

function TrendRecordCell({ label, record }: { label: string; record: TrendRecord }) {
  return (
    <div className="trendRecordCell">
      <span>{label}</span>
      <strong>{record.record}</strong>
      <small>
        {record.totalBets
          ? `${record.winPct.toFixed(1)}% • ${record.roiPct >= 0 ? "+" : ""}${record.roiPct.toFixed(1)}% ROI`
          : "No results"}
      </small>
    </div>
  );
}

type TrendTier = "Pass" | "Good" | "Strong" | "Elite";

type TrendScoreMetrics = {
  score: number;
  roiPct: number;
  winPct: number;
  hasData: boolean;
};

type RankedTrendPlay = TrendPlay & {
  originalScore: number;
  baseTrendScore: number;
  trendRoiPct: number;
  trendWinPct: number;
  comparisonGap: number;
  opponentLabel: string;
  opponentBaseScore: number | null;
  comparisonWinner: boolean;
  hasComparison: boolean;
  tier: TrendTier;
};

type TrendGameGroup = {
  key: string;
  game: string;
  awayTeam: string;
  homeTeam: string;
  plays: RankedTrendPlay[];
  topScore: number;
  secondScore: number;
  maxExactSample: number;
};

function trendPickLabel(play: TrendPlay) {
  return play.market === "Total"
    ? `${play.side} ${play.line ?? ""}`.trim()
    : play.selectionTeam || cleanMoneylineTeam(play.selection);
}

function rankedTrendLabel(score: number, eligible = true): TrendTier {
  if (!eligible || score < 60) return "Pass";
  if (score >= 88) return "Elite";
  if (score >= 75) return "Strong";
  return "Good";
}

function clampTrendValue(value: number) {
  return Math.max(0, Math.min(100, value));
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

  // Bet count is intentionally not used in the score. A 10-0 trend receives
  // its full record and ROI value rather than being reduced for sample size.
  const roiScore = clampTrendValue(50 + record.roiPct * 1.25);
  const winScore = clampTrendValue(50 + (record.winPct - 50) * 2);

  return {
    roiScore,
    winScore,
    roiPct: record.roiPct,
    winPct: record.winPct,
  };
}

function trendSignalMetrics(signal: TrendSignalBreakdown): TrendScoreMetrics {
  const windows = TREND_WINDOW_WEIGHTS.map(({ key, weight }) => {
    const recordMetrics = trendRecordScore(signal.records[key]);
    return recordMetrics ? { ...recordMetrics, weight } : null;
  }).filter(
    (window): window is NonNullable<typeof window> => Boolean(window),
  );

  if (!windows.length) {
    return {
      score: clampTrendValue(signal.score || 0),
      roiPct: 0,
      winPct: 0,
      hasData: false,
    };
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
      : clampTrendValue(
          100 - (Math.max(...windowScores) - Math.min(...windowScores)) * 1.5,
        );

  // ROI is the primary signal, record quality is secondary, and consistency
  // rewards trends that hold up across all-time, 30-day, and 7-day windows.
  const score =
    weightedAverage("roiScore") * 0.6 +
    weightedAverage("winScore") * 0.25 +
    consistencyScore * 0.15;

  return {
    score: clampTrendValue(score),
    roiPct: weightedAverage("roiPct"),
    winPct: weightedAverage("winPct"),
    hasData: true,
  };
}

function trendPlayMetrics(play: TrendPlay): TrendScoreMetrics {
  const signals = play.signals
    .map(trendSignalMetrics)
    .filter((signal) => signal.hasData);

  if (!signals.length) {
    return {
      score: clampTrendValue(play.score || 0),
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

function trendMarketComparisonKey(play: TrendPlay) {
  if (play.market === "Moneyline") return "Moneyline";
  const line = Number(play.line);
  return `Total|${Number.isFinite(line) ? line : ""}`;
}

function trendSideComparisonKey(play: TrendPlay) {
  return play.market === "Moneyline"
    ? publicMatchKey(play.selectionTeam || cleanMoneylineTeam(play.selection))
    : play.side.toLowerCase();
}

function scoreTrendMarketPlays(plays: TrendPlay[]): RankedTrendPlay[] {
  const baseRows = plays.map((play) => ({
    play,
    metrics: trendPlayMetrics(play),
  }));

  return baseRows.map(({ play, metrics }) => {
    const sameMarket = baseRows.filter(
      (candidate) =>
        trendMarketComparisonKey(candidate.play) === trendMarketComparisonKey(play),
    );
    const sideKey = trendSideComparisonKey(play);
    const opponents = sameMarket
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
    const hasComparison = Boolean(opponent);
    const rawGap = opponent ? metrics.score - opponent.metrics.score : 0;
    const comparisonWinner = Boolean(opponent && rawGap > 0.01);
    const comparisonGap = Math.abs(rawGap);

    // The direct edge over the opposing side is the primary qualifier.
    // Standalone trend quality is a smaller secondary adjustment, so a side
    // can qualify with a slightly negative ROI when the opposing trend is
    // materially worse. No positive-ROI requirement, bet minimum, or sample
    // penalty is applied.
    const eligible = Boolean(
      comparisonWinner && metrics.hasData && opponent?.metrics.hasData,
    );
    const winnerScore = clampScore(
      50 + comparisonGap + (metrics.score - 50) * 0.5,
    );
    const loserScore = Math.min(
      59,
      clampScore(50 - comparisonGap + (metrics.score - 50) * 0.25),
    );
    const displayScore = !hasComparison
      ? 0
      : eligible
        ? winnerScore
        : loserScore;

    return {
      ...play,
      originalScore: play.score,
      score: displayScore,
      baseTrendScore: clampScore(metrics.score),
      trendRoiPct: metrics.roiPct,
      trendWinPct: metrics.winPct,
      comparisonGap,
      opponentLabel: opponent ? trendPickLabel(opponent.play) : "",
      opponentBaseScore: opponent ? clampScore(opponent.metrics.score) : null,
      comparisonWinner,
      hasComparison,
      tier: rankedTrendLabel(displayScore, eligible),
    };
  });
}

function trendExactSample(play: TrendPlay) {
  return Math.max(0, ...play.signals.map((signal) => signal.exactSample || 0));
}

const TREND_GAME_TIME_KEYS = [
  "Game Time",
  "Start Time",
  "Scheduled Time",
  "First Pitch",
  "Time",
];

function trendSlateRow(
  group: TrendGameGroup,
  slateRows: SheetRow[],
): { row?: SheetRow; index: number } {
  const index = slateRows.findIndex((row) => {
    const teamsMatch =
      publicMatchKey(row["Away Team"]) === publicMatchKey(group.awayTeam) &&
      publicMatchKey(row["Home Team"]) === publicMatchKey(group.homeTeam);
    if (teamsMatch) return true;

    const rowGame = firstValue(row, ["Game Label", "Game", "Matchup"]);
    return Boolean(
      rowGame && publicMatchKey(rowGame) === publicMatchKey(group.game),
    );
  });

  return { row: index >= 0 ? slateRows[index] : undefined, index };
}

function trendGameTimeSortValue(row?: SheetRow) {
  const raw = firstValue(row, TREND_GAME_TIME_KEYS);
  if (!raw) return Number.POSITIVE_INFINITY;

  const normalizedTime = raw.replace(/\./g, "");
  const timeMatch = normalizedTime.match(
    /(?:^|[^\d])(\d{1,2}):(\d{2})\s*(AM|PM)?\b/i,
  );
  const hourOnlyMatch = normalizedTime.match(
    /(?:^|[^\d])(\d{1,2})\s*(AM|PM)\b/i,
  );
  const hour = Number(timeMatch?.[1] || hourOnlyMatch?.[1]);
  const minute = Number(timeMatch?.[2] || 0);
  const meridiem = String(
    timeMatch?.[3] || hourOnlyMatch?.[2] || "",
  ).toUpperCase();

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return Number.POSITIVE_INFINITY;
  }

  let normalizedHour = hour;
  if (meridiem === "AM") normalizedHour = hour % 12;
  if (meridiem === "PM") normalizedHour = (hour % 12) + 12;

  if (normalizedHour < 0 || normalizedHour > 23 || minute < 0 || minute > 59) {
    return Number.POSITIVE_INFINITY;
  }

  return normalizedHour * 60 + minute;
}

function groupRankedTrendPlays(
  trendPlays: TrendPlay[],
  slateRows: SheetRow[],
): TrendGameGroup[] {
  const grouped = new Map<
    string,
    Omit<TrendGameGroup, "plays"> & { plays: TrendPlay[] }
  >();

  trendPlays.forEach((play) => {
    const key = trendGameMatchKey(play) || publicMatchKey(play.game);
    const existing = grouped.get(key);
    if (existing) {
      existing.plays.push(play);
      return;
    }

    grouped.set(key, {
      key,
      game: play.game,
      awayTeam: play.awayTeam,
      homeTeam: play.homeTeam,
      plays: [play],
      topScore: 0,
      secondScore: 0,
      maxExactSample: trendExactSample(play),
    });
  });

  return [...grouped.values()]
    .map((group) => {
      const plays = scoreTrendMarketPlays(group.plays).sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.baseTrendScore !== a.baseTrendScore) {
          return b.baseTrendScore - a.baseTrendScore;
        }
        if (b.trendRoiPct !== a.trendRoiPct) {
          return b.trendRoiPct - a.trendRoiPct;
        }
        if (a.market !== b.market) return a.market === "Moneyline" ? -1 : 1;
        return trendPickLabel(a).localeCompare(trendPickLabel(b));
      });

      return {
        ...group,
        plays,
        topScore: plays[0]?.score || 0,
        secondScore: plays[1]?.score || 0,
        maxExactSample: Math.max(0, ...plays.map(trendExactSample)),
      };
    })
    .sort((a, b) => {
      const aSlate = trendSlateRow(a, slateRows);
      const bSlate = trendSlateRow(b, slateRows);
      const timeDifference =
        trendGameTimeSortValue(aSlate.row) - trendGameTimeSortValue(bSlate.row);
      if (timeDifference) return timeDifference;

      // Preserve the saved slate order when two games share a start time or
      // when a usable time is unavailable for both games.
      const aSlateIndex =
        aSlate.index >= 0 ? aSlate.index : Number.POSITIVE_INFINITY;
      const bSlateIndex =
        bSlate.index >= 0 ? bSlate.index : Number.POSITIVE_INFINITY;
      if (aSlateIndex !== bSlateIndex) return aSlateIndex - bSlateIndex;

      return a.game.localeCompare(b.game);
    });
}

function TrendSignalPanels({ play }: { play: TrendPlay }) {
  return (
    <div className="trendSignalList">
      {play.signals.map((signal) => {
        const signalMetrics = trendSignalMetrics(signal);

        return (
          <section className="trendSignalPanel" key={`${signal.signalType}-${signal.signalKey}`}>
            <div className="trendSignalHead">
              <div>
                <span className={`liveSignalPill ${signal.tone}`}>{signal.signal}</span>
                <small>{signal.recordScope}</small>
              </div>
              <strong>{clampScore(signalMetrics.score)}</strong>
            </div>
            <div className="trendRecordGrid">
              <TrendRecordCell label="All Time" record={signal.records.allTime} />
              <TrendRecordCell label="Last 30" record={signal.records.last30} />
              <TrendRecordCell label="Last 7" record={signal.records.last7} />
            </div>
            <div className="trendWeightLine">
              Exact category: {signal.exactSample} bets • No sample penalty • ROI 60% • Record 25% • Consistency 15%
            </div>
          </section>
        );
      })}
    </div>
  );
}

function TrendSelectionRow({
  play,
  selectionRank,
  matchStatus,
  initiallyOpen,
}: {
  play: RankedTrendPlay;
  selectionRank: number;
  matchStatus: ModelTrendMatch;
  initiallyOpen: boolean;
}) {
  const pickLabel = trendPickLabel(play);
  const badgeText = modelTrendBadgeText(matchStatus);
  const compactSignals = play.signals.map((signal) => signal.signal).join(" • ");

  return (
    <details
      className={`trendSelectionRow ${selectionRank === 1 ? "leader" : ""}`}
      open={initiallyOpen}
    >
      <summary className="trendSelectionSummary">
        <span className="trendSelectionRank">#{selectionRank}</span>
        <span className="trendSelectionIdentity">
          <strong>{pickLabel}</strong>
          <small>
            {play.market} • {play.sideGroup}
            {compactSignals ? ` • ${compactSignals}` : ""}
          </small>
        </span>
        <span className="trendSelectionMarket">
          <small>{play.tier}</small>
          <strong>{play.score}</strong>
        </span>
        <span className="trendSelectionChevron" aria-hidden="true">⌄</span>
      </summary>

      <div className="trendSelectionBody">
        {badgeText ? (
          <div className={`modelTrendBadge ${matchStatus.toLowerCase()}`}>{badgeText}</div>
        ) : null}

        <div className="bubbleGrid trendSelectionMetrics">
          <MiniBubble label="Opening Public" value={publicPctText(play.openingBetsPct)} />
          <MiniBubble label="Current Public" value={publicPctText(play.betsPct)} />
          <MiniBubble label="Public Change" value={signedPublicMoveText(play.publicMovementPct)} />
          <MiniBubble label="Opening Sharp" value={publicPctText(play.openingMoneyPct)} />
          <MiniBubble label="Current Sharp" value={publicPctText(play.moneyPct)} />
          <MiniBubble label="Sharp Change" value={signedPublicMoveText(play.sharpMovementPct)} />
          <MiniBubble
            label="Sharp − Public"
            value={`${play.gapPct >= 0 ? "+" : ""}${play.gapPct.toFixed(1)}%`}
          />
          <MiniBubble label="Opening Odds" value={formatOdds(play.openingOdds)} />
          <MiniBubble label="Current Odds" value={formatOdds(play.odds)} />
          <MiniBubble
            label="Market Move"
            value={marketMovementText(play.lineMovementBasis, play.lineMovementValue)}
          />
        </div>

        <TrendSignalPanels play={play} />

        <div className="modelMeta trendMeta">
          <span>
            {play.hasComparison
              ? `Head-to-head gap: ${play.comparisonWinner ? "+" : "−"}${play.comparisonGap.toFixed(1)} vs ${play.opponentLabel} • Base ${play.baseTrendScore}-${play.opponentBaseScore ?? "—"}`
              : "Head-to-head comparison unavailable"}
          </span>
          <span>
            Public {publicPctText(play.openingBetsPct)} → {publicPctText(play.betsPct)}
            {play.openingLine != null && play.line != null
              ? ` • Line ${play.openingLine} → ${play.line}`
              : play.openingOdds
                ? ` • Odds ${formatOdds(play.openingOdds)} → ${formatOdds(play.odds)}`
                : ""}
          </span>
          <span>Exact sample: {trendExactSample(play)} bets</span>
          <span>{play.updatedAt ? `Updated ${play.updatedAt}` : "DraftKings trend history"}</span>
        </div>
      </div>
    </details>
  );
}

function TrendGameCard({
  group,
  gameRank,
  bestPlays,
  slateRows,
}: {
  group: TrendGameGroup;
  gameRank: number;
  bestPlays: Play[];
  slateRows: SheetRow[];
}) {
  const leader = group.plays[0];
  const topPick = leader ? trendPickLabel(leader) : "—";
  const topMatch = leader && leader.tier !== "Pass"
    ? bestMatchForTrendPlay(leader, bestPlays, slateRows)
    : "";
  const topBadge = modelTrendBadgeText(topMatch);
  const slateRow = trendSlateRow(group, slateRows).row;
  const gameTime = firstValue(slateRow, TREND_GAME_TIME_KEYS);

  return (
    <article className={`card trendGameCard ${group.topScore >= 75 ? "top" : ""}`}>
      <div className="trendGameHeader">
        <div>
          <div className="cardTitle">{group.game}</div>
          <div className="cardSub">
            {gameTime ? `${gameTime} • ` : ""}{group.plays.length} ranked betting markets
          </div>
        </div>
        <div className="trendGameRankBox">
          <span>TIME ORDER</span>
          <strong>#{gameRank}</strong>
        </div>
      </div>

      <TeamRow awayTeam={group.awayTeam} homeTeam={group.homeTeam} />

      <div className="trendGameLeader">
        <div>
          <span className="trendGameLeaderLabel">Top trend in this game</span>
          <strong>{topPick}</strong>
          <small>{leader?.tier || "Pass"}</small>
        </div>
        <div className="trendGameLeaderScore">
          <span>TREND</span>
          <strong>{group.topScore}</strong>
        </div>
      </div>

      {topBadge ? (
        <div className={`modelTrendBadge trendGameMatchBadge ${topMatch.toLowerCase()}`}>
          {topBadge}
        </div>
      ) : null}

      <div className="trendSelectionStack">
        {group.plays.map((play, index) => (
          <TrendSelectionRow
            key={`${play.market}-${play.selection}-${play.side}-${play.line ?? ""}`}
            play={play}
            selectionRank={index + 1}
            matchStatus={
              play.tier === "Pass"
                ? ""
                : bestMatchForTrendPlay(play, bestPlays, slateRows)
            }
            initiallyOpen={false}
          />
        ))}
      </div>
    </article>
  );
}

function BestPlayCard({
  play,
  index,
  recentSummary,
  lastSevenBetsSummary,
  slateRows,
  draftKings,
  handpicked = false,
  trendMatch = "",
}: {
  play: Play;
  index: number;
  recentSummary: Summary | null;
  lastSevenBetsSummary: Summary | null;
  slateRows: SheetRow[];
  draftKings?: DraftKingsData | null;
  handpicked?: boolean;
  trendMatch?: ModelTrendMatch;
}) {
  const kPlay = isPitcherPlay(play);
  const totalPlay = isTotalType(play.playType);
  const moneylinePlay = isMoneylineType(play.playType);
  const firstInningPlay = isNRFIType(play.playType);
  const pitcherName = cleanPitcherName(play.play);
  const rawDisplayTeam = play.playerTeam || play.play;
  const displayTeam = moneylinePlay
    ? cleanMoneylineTeam(rawDisplayTeam) ||
      cleanMoneylineTeam(play.play) ||
      "Moneyline"
    : rawDisplayTeam;
  const row = findSlateRowForPlay(play, slateRows);
  const diagnostics = getPlayDiagnostics(play, slateRows);
  const publicBettingInfo = getPublicBettingInfo(play, slateRows, draftKings);
  const modelPct = moneylinePlay ? getMoneylineModelPct(play, slateRows) : "—";
  const moneylineOdds = moneylinePlay
    ? formatOdds(play.oddsLine || "—")
    : "—";
  const moneylineImpliedPct = moneylinePlay
    ? americanOddsImpliedPercent(moneylineOdds)
    : 0;
  const pitcherImage = imageForBestPlay(play, slateRows);
  const rankScore = diagnostics.score || getRankScore(play, recentSummary, slateRows);
  const topPlay = index < 3;
  const favoriteTag = favoriteTagValue(play);
  const favoriteNotes = favoriteNotesValue(play);
  const modelVersion = displayModelVersion(diagnostics.modelVersion);
  const firstInningOdds = formatOdds(
    play.oddsLine ||
      firstValue(row, [
        diagnostics.grade.includes("YRFI") ? "YRFI Odds" : "NRFI Odds",
      ]),
  );

  return (
    <article
      className={`card green fade-in best ${topPlay ? "top" : ""} ${handpicked ? "handpicked" : ""}`}
    >
      {trendMatch ? (
        <div className={`modelTrendBadge ${trendMatch.toLowerCase()}`}>
          {modelTrendBadgeText(trendMatch)}
        </div>
      ) : null}

      <div className="cardTop">
        <div className="rankBadge">
          #
          {handpicked && favoriteRankValue(play) !== 999
            ? favoriteRankValue(play)
            : index + 1}
        </div>
        <div className="scorePill" aria-label={`EZPZ Score ${rankScore || "unavailable"}`}>
          <span className="scorePillLabel">EZPZ</span>
          <strong>{rankScore || "—"}</strong>
          <span className="scorePillSub">SCORE</span>
        </div>
      </div>

      {handpicked ? (
        <div className="handpickedPill handpickedPillRow">⭐ HANDPICKED</div>
      ) : null}

      {play.awayTeam && play.homeTeam ? (
        <TeamRow awayTeam={play.awayTeam} homeTeam={play.homeTeam} />
      ) : (
        <div className="cardSub">{play.game}</div>
      )}

      {kPlay ? (
        <>
          <div className="playMain">
            <PitcherPhoto summary={play.play} url={pitcherImage} team={play.playerTeam || ""} />
            <div>
              <div className="playName">{pitcherName}</div>
              <div className="playDetail">
                {play.playerTeam || play.game} • {diagnostics.role}
              </div>
            </div>
          </div>

          <div className="projectionBlock">
            <div className="projection">{getProjectedKs(play)} Ks</div>
            <div className="grade">{diagnostics.grade}</div>
          </div>

          <div className="divider" />

          <div className="bubbleGrid">
            <MiniBubble label="Line" value={getPitcherLine(play)} green />
            <MiniBubble label="Odds" value={getPlayableOdds(play)} green />
            <MiniBubble label="Calibrated Ks" value={getProjectedKs(play)} green />
            <MiniBubble
              label="Hit Probability"
              value={diagnostics.probabilityText}
              green
            />
            <MiniBubble
              label="Projection Edge"
              value={getPitcherEdgeText(play)}
              green
            />
            <MiniBubble label="Role" value={diagnostics.role} green />
          </div>
        </>
      ) : moneylinePlay ? (
        <>
          <div className="playMain moneylineMain">
            <TeamPickMark team={displayTeam} />
            <div>
              <div className="playName">{displayTeam}</div>
              <div className="playDetail">Model-selected moneyline side</div>
            </div>
          </div>

          <div className="projectionBlock">
            <div className="projection">Moneyline</div>
            <div className="grade">{moneylineGradeLabel(play.playType)}</div>
          </div>

          <div className="divider" />

          <div className="bubbleGrid">
            <MiniBubble label="Odds" value={moneylineOdds} green />
            <MiniBubble label="Model Win %" value={modelPct} green />
            <MiniBubble
              label="Market Implied %"
              value={moneylineImpliedPct ? `${moneylineImpliedPct.toFixed(1)}%` : "—"}
              green
            />
            <MiniBubble
              label="Model Edge"
              value={moneylineEdgeText(modelPct, moneylineOdds)}
              green
            />
          </div>
        </>
      ) : totalPlay ? (
        <>
          <div className="cardTitle">Calibrated Game Total</div>
          <div className="cardSub">{play.game}</div>

          <div className="projectionBlock">
            <div className="projection">{getTotalPickLabel(play, slateRows)}</div>
            <div className="grade">{normalizeType(play.playType)}</div>
          </div>

          <div className="divider" />

          <div className="bubbleGrid">
            <MiniBubble label="Line" value={getTotalLine(play, slateRows)} green />
            <MiniBubble label="Projected Runs" value={getTotalProjection(play, slateRows)} green />
            <MiniBubble label="Hit Probability" value={diagnostics.probabilityText} green />
            <MiniBubble
              label="Proj − Line"
              value={signedDifferenceText(
                getTotalProjectionNumber(play, slateRows),
                getTotalLine(play, slateRows),
              )}
              green
            />
            <MiniBubble label="Odds" value={getPlayableOdds(play)} green />
            <MiniBubble label="EZPZ Score" value={rankScore || "—"} green />
          </div>
        </>
      ) : firstInningPlay ? (
        <>
          <div className="cardTitle">First-Inning Market</div>
          <div className="cardSub">{play.game}</div>

          <div className="projectionBlock">
            <div className="projection">{diagnostics.grade}</div>
            <div className="grade">Elite qualifier only</div>
          </div>

          <div className="divider" />

          <div className="bubbleGrid">
            <MiniBubble label="Pick" value={diagnostics.grade} green />
            <MiniBubble label="Probability" value={diagnostics.probabilityText} green />
            <MiniBubble label="Odds" value={firstInningOdds} green />
            <MiniBubble label="EZPZ Score" value={rankScore || "—"} green />
          </div>
        </>
      ) : (
        <>
          <div className="cardTitle">{normalizeType(play.playType)}</div>
          <div className="cardSub">{play.game}</div>

          <div className="projectionBlock">
            <div className="projection">{play.play}</div>
            <div className="grade">{normalizeType(play.playType)}</div>
          </div>
        </>
      )}

      <PublicBettingPanel info={publicBettingInfo} />

      {handpicked && favoriteTag ? (
        <div className="favoriteTag">{favoriteTag}</div>
      ) : null}
      {handpicked && favoriteNotes ? (
        <div className="favoriteNotes">{favoriteNotes}</div>
      ) : null}

      <BadgeRow play={play} />
      <div className="formRow">
        <FormTag summary={recentSummary} window="last7Days" />
        <FormTag summary={lastSevenBetsSummary} window="last7Bets" />
      </div>

      <ConfidenceBar
        score={diagnostics.reliability || rankScore || 50}
        label={
          firstInningPlay
            ? "First-Inning Strength"
            : moneylinePlay
              ? "Model Strength"
              : "Projection Reliability"
        }
      />

      <div className="modelMeta">
        <span>{modelVersion ? `Model ${modelVersion}` : "Calibrated model"}</span>
        <span>Confirmed-lineup workflow</span>
      </div>
    </article>
  );
}

function isQualifiedKSummary(summary: string) {
  const grade = normalizeType(summary);
  return [
    "STRONG OVER",
    "OVER",
    "LEAN OVER",
    "STRONG UNDER",
    "UNDER",
    "LEAN UNDER",
  ].includes(grade);
}

function KBubbleGroup({
  summary,
  score,
  reliability,
  probability,
  isGreen,
}: {
  summary: string;
  score: string;
  reliability: string;
  probability: string;
  isGreen: boolean;
}) {
  if (!summary) return null;

  return (
    <div className="bubbleGrid pitcherMetrics">
      <MiniBubble label="Line" value={extractLine(summary)} green={isGreen} />
      <MiniBubble
        label="Calibrated Ks"
        value={extractProjectedK(summary)}
        green={isGreen}
      />
      <MiniBubble label="Hit Probability" value={percentText(probability)} green={isGreen} />
      <MiniBubble
        label="Reliability"
        value={reliability ? `${Math.round(toNumber(reliability))}/100` : "—"}
        green={isGreen}
      />
      <MiniBubble label="EZPZ Score" value={score || "—"} green={isGreen} />
      <MiniBubble
        label="Grade"
        value={normalizeType(summary) || "—"}
        green={isGreen}
      />
    </div>
  );
}

function MarketPanel({
  title,
  grade,
  isGreen,
  children,
}: {
  title: string;
  grade: string;
  isGreen: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`marketPanel ${isGreen ? "green" : ""}`}>
      <div className="marketPanelTop">
        <span className="marketPanelTitle">{title}</span>
        <span className={`chip ${isGreen ? "green" : "yellow"}`}>
          {grade || "PASS"}
        </span>
      </div>
      <div className="bubbleGrid marketMetrics">{children}</div>
    </section>
  );
}

function SlateCard({
  row,
  draftKings,
}: {
  row: SheetRow;
  draftKings?: DraftKingsData | null;
}) {
  const game =
    row["Game Label"] || `${row["Away Team"]} at ${row["Home Team"]}`;

  const awayK = row["Away Pitcher K + Grade"] || "";
  const homeK = row["Home Pitcher K + Grade"] || "";
  const awayBulkK = row["Away Bulk Pitcher K + Grade"] || "";
  const homeBulkK = row["Home Bulk Pitcher K + Grade"] || "";

  const awayGreen = isQualifiedKSummary(awayK);
  const homeGreen = isQualifiedKSummary(homeK);
  const awayBulkGreen = isQualifiedKSummary(awayBulkK);
  const homeBulkGreen = isQualifiedKSummary(homeBulkK);

  const mlType = normalizeType(row["ML Grade"] || "");
  const firstInningType = normalizeType(row["NRFI Grade"] || "");
  const totalType = normalizeType(
    row["Total Runs Grade"] || row["Total Grade"] || "",
  );

  const mlGreen = mlType === "A MONEYLINE" || mlType === "B MONEYLINE";
  const firstInningGreen =
    firstInningType === "ELITE NRFI" || firstInningType === "ELITE YRFI";
  const totalGreen = isTotalType(totalType);

  const isYrfi = firstInningType.includes("YRFI");
  const firstInningScore = row[isYrfi ? "YRFI Score" : "NRFI Score"] || "";
  const firstInningProbability =
    row[isYrfi ? "YRFI Probability" : "NRFI Probability"] || "";
  const firstInningOdds = row[isYrfi ? "YRFI Odds" : "NRFI Odds"] || "";

  const hasGreen =
    awayGreen ||
    homeGreen ||
    awayBulkGreen ||
    homeBulkGreen ||
    mlGreen ||
    firstInningGreen ||
    totalGreen;

  const version = displayModelVersion(String(row["Model Version"] || ""));

  return (
    <article className={`card slateCard ${hasGreen ? "green" : ""}`}>
      <div className="slateCardHeader">
        <div>
          <div className="cardTitle">{game}</div>
          <div className="cardSub">
            {version ? `Model ${version}` : "Calibrated daily projection"}
          </div>
        </div>
        {hasGreen ? (
          <div className="slateGreenCallout">Qualified play active</div>
        ) : (
          <div className="slatePassCallout">Projection only</div>
        )}
      </div>

      <TeamRow
        awayTeam={row["Away Team"] || ""}
        homeTeam={row["Home Team"] || ""}
      />

      <div className="marketPanelGrid">
        {row["ML Grade"] ? (
          <MarketPanel title="Moneyline" grade={mlType} isGreen={mlGreen}>
            <MiniBubble label="Pick" value={row["Better ML"] || "—"} green={mlGreen} />
            <MiniBubble label="Odds" value={formatOdds(row["ML Odds"] || "—")} green={mlGreen} />
            <LiveMarketSplits row={row} market="Moneyline" draftKings={draftKings} />
          </MarketPanel>
        ) : null}

        {row["NRFI Grade"] ? (
          <MarketPanel
            title="First Inning"
            grade={firstInningType}
            isGreen={firstInningGreen}
          >
            <MiniBubble label="Probability" value={percentText(firstInningProbability)} green={firstInningGreen} />
            <MiniBubble label="EZPZ Score" value={scoreText(firstInningScore)} green={firstInningGreen} />
            <MiniBubble label="Odds" value={formatOdds(firstInningOdds)} green={firstInningGreen} />
          </MarketPanel>
        ) : null}

        {row["Total Runs Projection"] || totalType ? (
          <MarketPanel title="Game Total" grade={totalType || "PASS"} isGreen={totalGreen}>
            <MiniBubble label="Line" value={row["Total Runs Line"] || "—"} green={totalGreen} />
            <MiniBubble label="Projected Runs" value={row["Total Runs Projection"] || "—"} green={totalGreen} />
            <MiniBubble
              label="Hit Probability"
              value={percentText(row["Total Selected Probability"] || "")}
              green={totalGreen}
            />
            <MiniBubble
              label="Reliability"
              value={
                row["Total Reliability"]
                  ? `${Math.round(toNumber(row["Total Reliability"]))}/100`
                  : "—"
              }
              green={totalGreen}
            />
            <LiveMarketSplits row={row} market="Total" draftKings={draftKings} />
          </MarketPanel>
        ) : null}
      </div>

      <div className="pitcherGrid">
        <PitcherSlateBox
          label={awayBulkK ? "Away Opener" : "Away Starter"}
          role={awayBulkK ? "Opener" : "Starter"}
          summary={awayK}
          score={row["Away Pitcher K Score"] || ""}
          reliability={row["Away Pitcher K Reliability"] || ""}
          probability={row["Away Pitcher K Probability"] || ""}
          isGreen={awayGreen}
          imageUrl={imageFromRow(row, [
            "Away Pitcher Headshot URL",
            "Away Pitcher Headshot",
            "Away Pitcher Image URL",
          ])}
          team={row["Away Team"] || ""}
          publicInfo={livePropInfoForSummary(awayK, row, draftKings)}
        />
        {awayBulkK ? (
          <PitcherSlateBox
            label="Away Bulk Pitcher"
            role="Bulk"
            summary={awayBulkK}
            score={row["Away Bulk Pitcher K Score"] || ""}
            reliability={row["Away Bulk Pitcher K Reliability"] || ""}
            probability=""
            isGreen={awayBulkGreen}
            imageUrl=""
            team={row["Away Team"] || ""}
            publicInfo={livePropInfoForSummary(awayBulkK, row, draftKings)}
          />
        ) : null}

        <PitcherSlateBox
          label={homeBulkK ? "Home Opener" : "Home Starter"}
          role={homeBulkK ? "Opener" : "Starter"}
          summary={homeK}
          score={row["Home Pitcher K Score"] || ""}
          reliability={row["Home Pitcher K Reliability"] || ""}
          probability={row["Home Pitcher K Probability"] || ""}
          isGreen={homeGreen}
          imageUrl={imageFromRow(row, [
            "Home Pitcher Headshot URL",
            "Home Pitcher Headshot",
            "Home Pitcher Image URL",
          ])}
          team={row["Home Team"] || ""}
          publicInfo={livePropInfoForSummary(homeK, row, draftKings)}
        />
        {homeBulkK ? (
          <PitcherSlateBox
            label="Home Bulk Pitcher"
            role="Bulk"
            summary={homeBulkK}
            score={row["Home Bulk Pitcher K Score"] || ""}
            reliability={row["Home Bulk Pitcher K Reliability"] || ""}
            probability=""
            isGreen={homeBulkGreen}
            imageUrl=""
            team={row["Home Team"] || ""}
            publicInfo={livePropInfoForSummary(homeBulkK, row, draftKings)}
          />
        ) : null}
      </div>

      <div className="modelMeta">
        <span>Confirmed lineups</span>
        <span>Calibrated projections</span>
        <span>Role-aware workload</span>
      </div>
    </article>
  );
}

function PitcherSlateBox({
  label,
  role,
  summary,
  score,
  reliability,
  probability,
  isGreen,
  imageUrl,
  team,
  publicInfo,
}: {
  label: string;
  role: string;
  summary: string;
  score: string;
  reliability: string;
  probability: string;
  isGreen: boolean;
  imageUrl: string;
  team: string;
  publicInfo?: PublicBettingInfo | null;
}) {
  if (!summary) return null;

  return (
    <section className={`pitcherBox ${isGreen ? "green" : ""}`}>
      <div className="pitcherHeader">
        <PitcherPhoto summary={summary || label} url={imageUrl} team={team} />
        <div>
          <div className="pitcherLabel">{label}</div>
          <div className="pitcherNameSmall">
            {cleanPitcherName(summary) || label}
          </div>
          <div className="rolePill">{role}</div>
        </div>
      </div>
      <KBubbleGroup
        summary={summary}
        score={score}
        reliability={reliability}
        probability={probability}
        isGreen={isGreen}
      />
      <PublicBettingPanel info={publicInfo || null} />
    </section>
  );
}

function RecordsTable({ rows }: { rows: Summary[] }) {
  return (
    <div className="tableWrap">
      <table>
        <thead>
          <tr>
            <th>Bet Type</th>
            <th>Status</th>
            <th>Record</th>
            <th>Win %</th>
            <th>Units</th>
            <th>ROI</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.betType}>
              <td>{row.betType}</td>
              <td>
                <span className={`chip ${statusClass(row.wins, row.losses)}`}>
                  {row.status}
                </span>
              </td>
              <td>
                {row.wins}-{row.losses}-{row.pushes}
              </td>
              <td>{row.winPct}%</td>
              <td>{row.unitsWon}u</td>
              <td>{row.roiPct}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecordsDropdown({
  title,
  subtitle,
  rows,
  defaultOpen = false,
}: {
  title: string;
  subtitle: string;
  rows: Summary[];
  defaultOpen?: boolean;
}) {
  return (
    <details className="recordsDropdown" open={defaultOpen}>
      <summary className="recordsSummary">
        <div>
          <div className="recordsSummaryTitle">{title}</div>
          <div className="recordsSummarySub">{subtitle}</div>
        </div>
        <span className="recordsCount">{rows.length} types</span>
      </summary>

      {rows.length ? (
        <RecordsTable rows={rows} />
      ) : (
        <div className="empty insideDropdown">No completed bets yet.</div>
      )}
    </details>
  );
}


type DraftKingsSignalSummary = {
  signalType: "Public Split" | "Line Movement";
  signal: string;
  tone: PublicSignalTone;
  wins: number;
  losses: number;
  pushes: number;
  totalBets: number;
  winPct: number;
  unitsWon: number;
  roiPct: number;
  sampleLabel: string;
};

const DRAFTKINGS_SIGNAL_CATALOG: Array<
  Pick<DraftKingsSignalSummary, "signalType" | "signal" | "tone">
> = [
  { signalType: "Public Split", signal: "Extreme Public + Sharp Agreement", tone: "negative" },
  { signalType: "Public Split", signal: "Heavy Public + Sharp Agreement", tone: "caution" },
  { signalType: "Public Split", signal: "Strong Sharp Rejection", tone: "negative" },
  { signalType: "Public Split", signal: "Sharp Rejection", tone: "negative" },
  { signalType: "Public Split", signal: "Strong Sharp Support", tone: "positive" },
  { signalType: "Public Split", signal: "Sharp Support", tone: "positive" },
  { signalType: "Public Split", signal: "Balanced Public / Sharp Split", tone: "neutral" },
  { signalType: "Line Movement", signal: "Strong Reverse Line Movement Support", tone: "positive" },
  { signalType: "Line Movement", signal: "Reverse Line Movement Support", tone: "positive" },
  { signalType: "Line Movement", signal: "Strong Reverse Line Movement Against", tone: "negative" },
  { signalType: "Line Movement", signal: "Reverse Line Movement Against", tone: "negative" },
  { signalType: "Line Movement", signal: "Line Movement Confirmation", tone: "positive" },
  { signalType: "Line Movement", signal: "Adverse Line Movement", tone: "negative" },
  { signalType: "Line Movement", signal: "Legacy Adverse Movement (pre-fix)", tone: "negative" },
];

function signalSampleLabel(totalBets: number) {
  if (totalBets < 10) return "Small sample";
  if (totalBets < 25) return "Early trend";
  if (totalBets < 50) return "Developing";
  return "Meaningful";
}

function signalDateWithin(date: string, today: string, days: number) {
  if (!days) return true;
  const end = Date.parse(`${normalizedPublicDate(today)}T12:00:00Z`);
  const start = Date.parse(`${normalizedPublicDate(date)}T12:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return false;
  const diff = Math.floor((end - start) / 86_400_000);
  return diff >= 0 && diff < days;
}

function summarizeDraftKingsSignals(rows: DraftKingsSignalResult[]) {
  const map = new Map<string, DraftKingsSignalSummary>();
  for (const item of DRAFTKINGS_SIGNAL_CATALOG) {
    map.set(`${item.signalType}|${item.signal}`, {
      ...item,
      wins: 0,
      losses: 0,
      pushes: 0,
      totalBets: 0,
      winPct: 0,
      unitsWon: 0,
      roiPct: 0,
      sampleLabel: "Small sample",
    });
  }
  for (const row of rows) {
    const displaySignal =
      row.signalType === "Line Movement" && row.signal === "Reverse Line Movement"
        ? "Legacy Adverse Movement (pre-fix)"
        : row.signal;
    const key = `${row.signalType}|${displaySignal}`;
    if (!map.has(key)) {
      map.set(key, {
        signalType: row.signalType,
        signal: displaySignal,
        tone: row.tone,
        wins: 0,
        losses: 0,
        pushes: 0,
        totalBets: 0,
        winPct: 0,
        unitsWon: 0,
        roiPct: 0,
        sampleLabel: "Small sample",
      });
    }
    const summary = map.get(key)!;
    if (row.result === "W") summary.wins += 1;
    else if (row.result === "L") summary.losses += 1;
    else summary.pushes += 1;
    summary.totalBets += 1;
    summary.unitsWon += Number(row.units || 0);
  }

  const toneOrder: Record<PublicSignalTone, number> = {
    negative: 0,
    caution: 1,
    positive: 2,
    neutral: 3,
  };
  return [...map.values()]
    .map((summary) => {
      const decisions = summary.wins + summary.losses;
      return {
        ...summary,
        winPct: decisions ? Math.round((summary.wins / decisions) * 1000) / 10 : 0,
        unitsWon: Math.round(summary.unitsWon * 10) / 10,
        roiPct: summary.totalBets
          ? Math.round((summary.unitsWon / summary.totalBets) * 1000) / 10
          : 0,
        sampleLabel: signalSampleLabel(summary.totalBets),
      };
    })
    .sort(
      (a, b) =>
        (a.signalType === b.signalType ? 0 : a.signalType === "Public Split" ? -1 : 1) ||
        toneOrder[a.tone] - toneOrder[b.tone] ||
        b.totalBets - a.totalBets,
    );
}

type HistoricalTrendOutcome = {
  date: string;
  gameKey: string;
  play: TrendPlay;
  result: "W" | "L" | "P";
  units: number;
  tier: "Good" | "Strong" | "Elite";
  score: number;
  frozenAt: string;
  recoveredFromHistoricalOverride?: boolean;
  recoveryNote?: string;
};

function historicalTrendPlay(row: TrendRecordResult): TrendPlay | null {
  try {
    const parsed = JSON.parse(row.trendScoreDetails) as TrendPlay;
    if (!parsed || !Array.isArray(parsed.signals)) return null;

    return {
      ...parsed,
      game: parsed.game || row.game,
      market: parsed.market || row.market,
      selection: parsed.selection || row.selection,
      score: row.frozenScore,
      tier: row.frozenTier,
    };
  } catch {
    return null;
  }
}

function historicalTrendGameKey(row: TrendRecordResult, play: TrendPlay) {
  const savedGameKey = String(row.gameKey || "").trim();
  if (savedGameKey) return `${row.date}|${savedGameKey}`;
  const matchupKey = trendGameMatchKey(play) || publicMatchKey(row.game);
  const gameTimeKey = publicMatchKey(row.gameTime || "");
  return `${row.date}|${matchupKey}|${gameTimeKey}`;
}

function historicalTrendSelectionKey(play: TrendPlay) {
  return `${trendMarketComparisonKey(play)}|${trendSideComparisonKey(play)}`;
}

function buildHistoricalTrendOutcomes(rows: TrendRecordResult[]) {
  const unique = new Map<string, HistoricalTrendOutcome>();

  rows.forEach((row) => {
    if (row.snapshotStatus !== "FINAL_PREGAME") return;
    if (!row.frozenAt) return;
    if (!Number.isFinite(Number(row.frozenScore))) return;

    const play = historicalTrendPlay(row);
    if (!play) return;
    const gameKey = historicalTrendGameKey(row, play);
    const selectionKey = historicalTrendSelectionKey(play);
    const key = `${gameKey}|${selectionKey}`;
    if (unique.has(key)) return;

    unique.set(key, {
      date: row.date,
      gameKey,
      play,
      result: row.result,
      units: Number(row.units || 0),
      tier: row.frozenTier,
      score: Number(row.frozenScore),
      frozenAt: row.frozenAt,
      recoveredFromHistoricalOverride: row.recoveredFromHistoricalOverride,
      recoveryNote: row.recoveryNote,
    });
  });

  return [...unique.values()];
}

function summarizeTrendTierRecords(
  outcomes: Array<HistoricalTrendOutcome & { tier: TrendTier; score: number }>,
) {
  const tiers: TrendTier[] = ["Elite", "Strong", "Good"];
  const totals = new Map(tiers.map((tier) => [tier, emptyRecord(`${tier} Trend Plays`)]));

  outcomes.forEach((outcome) => {
    const summary = totals.get(outcome.tier);
    if (!summary) return;
    if (outcome.result === "W") summary.wins += 1;
    else if (outcome.result === "L") summary.losses += 1;
    else summary.pushes += 1;
    summary.unitsWon += outcome.units;
  });

  return tiers.map((tier) => finalizeRecordTotals(totals.get(tier)!));
}

function TrendTierRecords({
  rows,
  today,
}: {
  rows: TrendRecordResult[];
  today: string;
}) {
  const [period, setPeriod] = useState<"today" | "all" | "30" | "7">("today");
  const [market, setMarket] = useState<"All" | "Moneyline" | "Total">("All");

  const historicalOutcomes = useMemo(() => buildHistoricalTrendOutcomes(rows), [rows]);
  const filteredOutcomes = useMemo(() => {
    const days = period === "today" ? 1 : period === "7" ? 7 : period === "30" ? 30 : 0;
    return historicalOutcomes.filter((outcome) => {
      if (market !== "All" && outcome.play.market !== market) return false;
      return signalDateWithin(outcome.date, today, days);
    });
  }, [historicalOutcomes, market, period, today]);
  const summaries = useMemo(
    () => summarizeTrendTierRecords(filteredOutcomes),
    [filteredOutcomes],
  );
  const gradedCount = historicalOutcomes.length;
  const filteredCount = filteredOutcomes.length;
  const recoveredCount = filteredOutcomes.filter(
    (outcome) => outcome.recoveredFromHistoricalOverride,
  ).length;

  return (
    <div className="dkRecordsCard trendTierRecordsCard">
      <div className="dkRecordFilters trendRecordFilters">
        <label>
          <span>Period</span>
          <select
            value={period}
            onChange={(event) =>
              setPeriod(event.target.value as "today" | "all" | "30" | "7")
            }
          >
            <option value="today">Today</option>
            <option value="all">Overall</option>
            <option value="30">Last 30 Days</option>
            <option value="7">Last 7 Days</option>
          </select>
        </label>
        <label>
          <span>Market</span>
          <select
            value={market}
            onChange={(event) =>
              setMarket(event.target.value as "All" | "Moneyline" | "Total")
            }
          >
            <option>All</option>
            <option>Moneyline</option>
            <option value="Total">Totals</option>
          </select>
        </label>
      </div>

      <div className="qualifiedGrid trendTierRecordsGrid">
        {summaries.map((summary) => (
          <Tile
            key={summary.label}
            label={summary.label}
            value={summary.record}
            meta={`${summary.totalBets} bets • ${summary.winPct}% • ${
              summary.unitsWon > 0 ? "+" : ""
            }${summary.unitsWon}u • ROI ${summary.roiPct > 0 ? "+" : ""}${
              summary.roiPct
            }%`}
            green={summary.totalBets > 0 && summary.unitsWon >= 0}
          />
        ))}
      </div>

      <div className="trendRecordsNote">
        {gradedCount
          ? `${filteredCount} completed official trend plays match these filters (${gradedCount} total available). Every result uses the tier frozen before the game; totals are settled against the frozen public line. Nothing is re-graded after the game.${
              recoveredCount
                ? ` ${recoveredCount} confirmed August 2 final-board play${recoveredCount === 1 ? " was" : "s were"} restored because the original sheet rows were missing their snapshot metadata.`
                : ""
            }`
          : "No completed frozen trend-grade snapshots are available yet. New results will populate here automatically after the tracked games finish."}
      </div>

      {filteredOutcomes.length ? (
        <details className="trendRecordAudit">
          <summary>View the {filteredOutcomes.length} plays counted in this record</summary>
          <div className="trendRecordAuditRows">
            {[...filteredOutcomes]
              .sort((a, b) =>
                b.date.localeCompare(a.date) ||
                a.play.game.localeCompare(b.play.game) ||
                b.score - a.score,
              )
              .map((outcome, index) => (
                <div
                  className={`trendRecordAuditRow result${outcome.result}`}
                  key={`${outcome.gameKey}-${historicalTrendSelectionKey(outcome.play)}-${index}`}
                >
                  <span>{outcome.date}</span>
                  <span>{outcome.play.game}</span>
                  <strong>{trendPickLabel(outcome.play)}</strong>
                  <span>
                    {outcome.recoveredFromHistoricalOverride
                      ? `${outcome.tier} • confirmed recovery`
                      : `${outcome.tier} ${outcome.score.toFixed(1)}`}
                  </span>
                  <b>{outcome.result}</b>
                </div>
              ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function DraftKingsSignalRecords({
  rows,
  today,
}: {
  rows: DraftKingsSignalResult[];
  today: string;
}) {
  const [period, setPeriod] = useState<"all" | "30" | "7">("all");
  const [market, setMarket] = useState<"All" | "Moneyline" | "Total">("All");
  const [scope, setScope] = useState<"Qualified" | "All">("All");
  const [side, setSide] = useState<"All" | "Favorite" | "Underdog" | "Over" | "Under">("All");
  const [modelVersion, setModelVersion] = useState("All");

  const modelVersions = useMemo(
    () => [
      "All",
      ...Array.from(new Set(rows.map((row) => row.modelVersion.trim()).filter(Boolean))).sort().reverse(),
    ],
    [rows],
  );

  const filtered = useMemo(() => {
    const days = period === "7" ? 7 : period === "30" ? 30 : 0;
    return rows.filter((row) => {
      if (scope === "Qualified" && !row.qualified) return false;
      if (market !== "All" && row.market !== market) return false;
      if (side !== "All" && row.sideGroup !== side) return false;
      if (modelVersion !== "All" && row.modelVersion !== modelVersion) return false;
      return signalDateWithin(row.date, today, days);
    });
  }, [market, modelVersion, period, rows, scope, side, today]);

  const summaries = useMemo(() => summarizeDraftKingsSignals(filtered), [filtered]);

  return (
    <div className="dkRecordsCard">
      <div className="dkRecordFilters">
        <label>
          <span>Period</span>
          <select value={period} onChange={(event) => setPeriod(event.target.value as "all" | "30" | "7")}>
            <option value="all">Overall</option>
            <option value="30">Last 30 Days</option>
            <option value="7">Last 7 Days</option>
          </select>
        </label>
        <label>
          <span>Market</span>
          <select value={market} onChange={(event) => setMarket(event.target.value as "All" | "Moneyline" | "Total")}>
            <option>All</option>
            <option>Moneyline</option>
            <option value="Total">Totals</option>
          </select>
        </label>
        <label>
          <span>Tracking Set</span>
          <select value={scope} onChange={(event) => setScope(event.target.value as "Qualified" | "All")}>
            <option value="Qualified">Qualified Plays</option>
            <option value="All">All Tracked Sides</option>
          </select>
        </label>
        <label>
          <span>Side</span>
          <select value={side} onChange={(event) => setSide(event.target.value as "All" | "Favorite" | "Underdog" | "Over" | "Under")}>
            <option>All</option>
            <option>Favorite</option>
            <option>Underdog</option>
            <option>Over</option>
            <option>Under</option>
          </select>
        </label>
        <label>
          <span>Model Version</span>
          <select value={modelVersion} onChange={(event) => setModelVersion(event.target.value)}>
            {modelVersions.map((version) => (
              <option key={version} value={version}>{version}</option>
            ))}
          </select>
        </label>
      </div>

      {summaries.length ? (
        <div className="tableWrap dkSignalTableWrap">
          <table className="dkSignalTable">
            <thead>
              <tr>
                <th>Signal</th>
                <th>Type</th>
                <th>Record</th>
                <th>Win %</th>
                <th>Units</th>
                <th>ROI</th>
                <th>Sample</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map((row) => (
                <tr key={`${row.signalType}-${row.signal}`}>
                  <td>
                    <span className={`signalName ${row.tone}`}>{row.signal}</span>
                  </td>
                  <td>{row.signalType}</td>
                  <td>{row.wins}-{row.losses}-{row.pushes}</td>
                  <td>{row.winPct}%</td>
                  <td className={row.unitsWon > 0 ? "metricPositive" : row.unitsWon < 0 ? "metricNegative" : ""}>
                    {row.unitsWon > 0 ? "+" : ""}{row.unitsWon}u
                  </td>
                  <td className={row.roiPct > 0 ? "metricPositive" : row.roiPct < 0 ? "metricNegative" : ""}>
                    {row.roiPct > 0 ? "+" : ""}{row.roiPct}%
                  </td>
                  <td>
                    <span className={`sampleChip sample${row.sampleLabel.replace(/\s+/g, "")}`}>
                      {row.totalBets} • {row.sampleLabel}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty insideSignalRecords">
          No completed moneyline or total sides match these filters yet. Records will populate automatically as tracked games finish.
        </div>
      )}
    </div>
  );
}

function SportDevelopmentContent({
  sport,
  tab,
  today,
}: {
  sport: Exclude<Sport, "MLB">;
  tab: Tab;
  today?: string;
}) {
  const meta = SPORT_META[sport];
  const dateLabel = today || "today";

  if (tab === "Today’s Best Plays") {
    return (
      <>
        <div className="sectionHead">
          <div>
            <h2>{meta.name} Best Plays</h2>
            <p>
              This public board is ready for qualified {meta.shortName} plays as
              soon as they are saved from the new builder.
            </p>
          </div>
          <span className="countPill">0 plays</span>
        </div>

        <div className="sportDevelopmentCard">
          <span className="developmentEyebrow">PUBLIC FORMAT READY</span>
          <h3>No official {meta.shortName} plays posted for {dateLabel}</h3>
          <p>
            Best Plays will appear here with the same transparent model score,
            probability, reliability, line, odds, and matchup context used
            throughout EZPZ Picks.
          </p>
          <div className="developmentStatusRow">
            <span>Model stage</span>
            <strong>{meta.status}</strong>
          </div>
        </div>
      </>
    );
  }

  if (tab === "Full Slate") {
    return (
      <>
        <div className="sectionHead">
          <div>
            <h2>{meta.name} Full Slate</h2>
            <p>
              Every saved matchup will appear here, including projected score,
              spread, moneyline, total, personnel status, and reliability.
            </p>
          </div>
        </div>

        <div className="sportDevelopmentCard">
          <span className="developmentEyebrow">SLATE CONNECTION READY</span>
          <h3>No {meta.shortName} matchups have been published yet</h3>
          <p>
            The page structure is active now. Games will populate automatically
            after the builder begins saving official slate projections.
          </p>
          <div className="developmentStatusRow">
            <span>Expected markets</span>
            <strong>Spread • Moneyline • Total</strong>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="sectionHead">
        <div>
          <h2>{meta.name} Records</h2>
          <p>
            Results will begin at 0-0-0 and update only from official tracked
            EZPZ plays.
          </p>
        </div>
      </div>

      <div className="qualifiedGrid">
        <Tile
          label="Best Plays - Last 7 Days"
          value="0-0-0"
          meta="0.0% • 0.00u • ROI 0.0%"
        />
        <Tile
          label="Best Plays - Running Total"
          value="0-0-0"
          meta="0.0% • 0.00u • ROI 0.0%"
        />
        <Tile
          label="Handpicked - Last 7 Days"
          value="0-0-0"
          meta="0.0% • 0.00u • ROI 0.0%"
        />
        <Tile
          label="Handpicked - Running Total"
          value="0-0-0"
          meta="0.0% • 0.00u • ROI 0.0%"
        />
      </div>

      <div className="sportDevelopmentCard">
        <span className="developmentEyebrow">TRACKING READY</span>
        <h3>No completed {meta.shortName} bets yet</h3>
        <p>
          Records will remain separate by sport and will populate after official
          plays are graded in the tracker.
        </p>
      </div>
    </>
  );
}

function LoadingState() {
  return (
    <div className="loadingGrid" aria-label="Loading EZPZ projections">
      {[0, 1, 2].map((item) => (
        <div className="loadingCard" key={item}>
          <div className="loadingLine short" />
          <div className="loadingLine medium" />
          <div className="loadingPlayer">
            <div className="loadingAvatar" />
            <div className="loadingTextStack">
              <div className="loadingLine medium" />
              <div className="loadingLine short" />
            </div>
          </div>
          <div className="loadingMetricGrid">
            <div className="loadingMetric" />
            <div className="loadingMetric" />
            <div className="loadingMetric" />
            <div className="loadingMetric" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Home() {
  const [data, setData] = useState<ApiData | null>(null);
  const [draftKings, setDraftKings] = useState<DraftKingsData | null>(null);
  const [draftKingsError, setDraftKingsError] = useState("");
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [activeSport, setActiveSport] = useState<Sport>("MLB");
  const [active, setActive] = useState<Tab>("Today’s Best Plays");

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const response = await fetch("/api/public-data", { cache: "no-store" });
      const json = (await response.json()) as ApiData;
      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Failed to load EZPZ data");
      }
      setData(json);
      setError("");

      if (json.draftKings) {
        setDraftKings(json.draftKings);
        setDraftKingsError(
          json.draftKings.status === "UNAVAILABLE"
            ? json.draftKings.errors?.join(" • ") || "DraftKings feed unavailable"
            : "",
        );
      } else {
        setDraftKings(null);
        setDraftKingsError("DraftKings feed unavailable");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load EZPZ data");
    } finally {
      if (!silent) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
    const interval = window.setInterval(() => void loadData(true), 60_000);
    return () => window.clearInterval(interval);
  }, [loadData]);

  const trackerLast7RecordSummary = useMemo(
    () => calculateTrackerRecordSummary(data?.betTrackerRows, "last7", data?.today || ""),
    [data?.betTrackerRows, data?.today],
  );
  const trackerOverallRecordSummary = useMemo(
    () => calculateTrackerRecordSummary(data?.betTrackerRows, "all", data?.today || ""),
    [data?.betTrackerRows, data?.today],
  );
  const trackerLastSevenBetsRecordSummary = useMemo(
    () => calculateTrackerLastBetsSummary(data?.betTrackerRows, 7),
    [data?.betTrackerRows],
  );
  const trackerHandpickedLast7RecordSummary = useMemo(
    () => calculateTrackerRecordSummary(data?.betTrackerRows, "last7", data?.today || "", true),
    [data?.betTrackerRows, data?.today],
  );
  const trackerHandpickedOverallRecordSummary = useMemo(
    () => calculateTrackerRecordSummary(data?.betTrackerRows, "all", data?.today || "", true),
    [data?.betTrackerRows, data?.today],
  );
  const mergedLast7RecordSummary = useMemo(
    () => mergeRecordSummaries(data?.last7RecordSummary, trackerLast7RecordSummary),
    [data?.last7RecordSummary, trackerLast7RecordSummary],
  );
  const mergedOverallRecordSummary = useMemo(
    () => mergeRecordSummaries(data?.recordSummary, trackerOverallRecordSummary),
    [data?.recordSummary, trackerOverallRecordSummary],
  );
  const mergedHandpickedLast7RecordSummary = useMemo(
    () => mergeRecordSummaries(data?.handpickedLast7RecordSummary, trackerHandpickedLast7RecordSummary),
    [data?.handpickedLast7RecordSummary, trackerHandpickedLast7RecordSummary],
  );
  const mergedHandpickedOverallRecordSummary = useMemo(
    () => mergeRecordSummaries(data?.handpickedRecordSummary, trackerHandpickedOverallRecordSummary),
    [data?.handpickedRecordSummary, trackerHandpickedOverallRecordSummary],
  );
  const trackerTotalBestPlays = useMemo(
    () => totalPlaysFromTrackerRows(data?.betTrackerRows, data?.today || ""),
    [data?.betTrackerRows, data?.today],
  );

  const bestPlays = useMemo(() => {
    if (!data) return [];
    const recentByType = new Map(
      mergedLast7RecordSummary.map((row) => [normalizeType(row.betType), row]),
    );
    const sourceBestPlays = mergeBestPlaysWithTrackerTotals(data.bestPlays, trackerTotalBestPlays);

    return sourceBestPlays
      .filter((play) => isBestPlay(play))
      .sort((a, b) => {
        const aFavorite = isFavoriteValue(a.favoritePick) ? 1 : 0;
        const bFavorite = isFavoriteValue(b.favoritePick) ? 1 : 0;
        if (aFavorite !== bFavorite) return bFavorite - aFavorite;
        if (aFavorite && bFavorite)
          return favoriteRankValue(a) - favoriteRankValue(b);
        const aRecent = recentByType.get(recordTypeForPlay(a)) || null;
        const bRecent = recentByType.get(recordTypeForPlay(b)) || null;
        const scoreDifference =
          getRankScore(b, bRecent, data.slateToday) -
          getRankScore(a, aRecent, data.slateToday);
        if (scoreDifference) return scoreDifference;

        return (
          getPlayDiagnostics(b, data.slateToday).reliability -
          getPlayDiagnostics(a, data.slateToday).reliability
        );
      });
  }, [data, mergedLast7RecordSummary, mergedOverallRecordSummary, trackerTotalBestPlays]);

  const handpickedLast7 =
    data?.tiles.handpickedLast7 ||
    calculateFavoriteRecord(data?.betTrackerRows, "last7", data?.today || "");
  const handpickedOverall =
    data?.tiles.handpickedOverall ||
    calculateFavoriteRecord(data?.betTrackerRows, "all", data?.today || "");
  const handpickedTodayCount = calculateFavoriteCount(
    data?.betTrackerRows,
    data?.today || "",
  );
  const favoriteRowMap = useMemo(
    () => buildFavoriteRowMap(data?.betTrackerRows, data?.today || ""),
    [data?.betTrackerRows, data?.today],
  );
  const visibleLast7RecordSummary = useMemo(
    () => publicRecordRows(mergedLast7RecordSummary),
    [mergedLast7RecordSummary],
  );
  const visibleOverallRecordSummary = useMemo(
    () => publicRecordRows(mergedOverallRecordSummary),
    [mergedOverallRecordSummary],
  );
  const visibleHandpickedLast7RecordSummary = useMemo(
    () => publicRecordRows(mergedHandpickedLast7RecordSummary),
    [mergedHandpickedLast7RecordSummary],
  );
  const visibleHandpickedOverallRecordSummary = useMemo(
    () => publicRecordRows(mergedHandpickedOverallRecordSummary),
    [mergedHandpickedOverallRecordSummary],
  );
  const visibleLast7Totals = useMemo(
    () => combinedRecordTotals("Best Plays - Last 7 Days", visibleLast7RecordSummary),
    [visibleLast7RecordSummary],
  );
  const visibleOverallTotals = useMemo(
    () => combinedRecordTotals("Best Plays - Running Total", visibleOverallRecordSummary),
    [visibleOverallRecordSummary],
  );
  const activeModelVersion = useMemo(() => {
    const rowVersion =
      data?.slateToday?.find((row) => String(row["Model Version"] || "").trim())?.[
        "Model Version"
      ] || "";
    return displayModelVersion(String(rowVersion));
  }, [data?.slateToday]);

  const activeSportMeta = SPORT_META[activeSport];

  const content = useMemo(() => {
    if (error && !data) {
      return (
        <div className="error">
          <strong>Could not load projections.</strong>
          <span>{error}</span>
          <button type="button" className="refreshBtn" onClick={() => void loadData()}>
            Try again
          </button>
        </div>
      );
    }
    if (!data) return <LoadingState />;

    if (activeSport !== "MLB") {
      return (
        <SportDevelopmentContent
          sport={activeSport}
          tab={active}
          today={data.today}
        />
      );
    }

    const recentByType = new Map(
      mergedLast7RecordSummary.map((row) => [normalizeType(row.betType), row]),
    );
    const lastSevenBetsByType = new Map<string, Summary>(
      trackerLastSevenBetsRecordSummary.map((row) => [
        normalizeType(row.betType),
        row,
      ]),
    );

    const handpickedPlays = bestPlays.filter((play) =>
      isFavoriteValue(play.favoritePick),
    );
    const regularBestPlays = bestPlays.filter(
      (play) => !isFavoriteValue(play.favoritePick),
    );
    const orderedPlays = [
      ...handpickedPlays.sort(
        (a, b) => favoriteRankValue(a) - favoriteRankValue(b),
      ),
      ...regularBestPlays,
    ];
    const trendPlays = data.trendPlays || [];
    const rankedTrendGames = groupRankedTrendPlays(trendPlays, data.slateToday);
    const qualifiedTrendPlays = rankedTrendGames.flatMap((group) =>
      group.plays.filter((play) => play.tier !== "Pass"),
    );

    if (active === "Today’s Best Plays") {
      return (
        <section>
          <div className="sectionHead">
            <div>
              <h2>Today’s Best Plays</h2>
              <p>
                Ranked by calibrated model score and projection reliability.
                Historical records are shown for context but do not override a qualified play.
              </p>
            </div>
            <span className="countPill">{orderedPlays.length} plays</span>
          </div>

          {orderedPlays.length ? (
            <div className="cards">
              {orderedPlays.map((play, index) => {
                const key = favoriteKeyFromPlay(play, data.today);
                const favoriteRow = favoriteRowMap.get(key);
                const displayedPlay: Play = favoriteRow
                  ? {
                      ...play,
                      favoritePick: true,
                      favoriteRank:
                        favoriteRow["Favorite Rank"] || play.favoriteRank,
                      favoriteTag:
                        favoriteRow["Favorite Tag"] || play.favoriteTag,
                      favoriteNotes:
                        favoriteRow["Favorite Notes"] || play.favoriteNotes,
                    }
                  : play;

                return (
                  <BestPlayCard
                    key={`${play.game}-${play.play}-${index}`}
                    play={displayedPlay}
                    index={index}
                    recentSummary={
                      recentByType.get(recordTypeForPlay(play)) || null
                    }
                    lastSevenBetsSummary={
                      lastSevenBetsByType.get(recordTypeForPlay(play)) || null
                    }
                    slateRows={data.slateToday}
                    draftKings={draftKings}
                    handpicked={Boolean(favoriteRow)}
                    trendMatch={trendMatchForBestPlay(
                      displayedPlay,
                      qualifiedTrendPlays,
                      data.slateToday,
                    )}
                  />
                );
              })}
            </div>
          ) : (
            <div className="empty">
              No qualified Best Plays saved yet for {data.today}.
            </div>
          )}
        </section>
      );
    }

    if (active === "Today’s Trend Plays") {
      return (
        <section>
          <div className="sectionHead">
            <div>
              <h2>Today’s Trend Plays</h2>
              <p>
                One tile per game, ordered by scheduled start time. Each tile keeps both
                moneylines, the Over, and the Under together, with each side scored against its
                direct opponent using trend record, ROI, and consistency.
              </p>
            </div>
            <span className="countPill">
              {rankedTrendGames.length} games • {trendPlays.length} markets
            </span>
          </div>

          {rankedTrendGames.length ? (
            <div className="trendGameGrid">
              {rankedTrendGames.map((group, index) => (
                <TrendGameCard
                  key={group.key}
                  group={group}
                  gameRank={index + 1}
                  bestPlays={orderedPlays}
                  slateRows={data.slateToday}
                />
              ))}
            </div>
          ) : (
            <div className="empty">
              No current DraftKings moneyline or total markets are available for today’s saved slate.
            </div>
          )}
        </section>
      );
    }

    if (active === "Full Slate") {
      return (
        <>
          <div className="sectionHead">
            <div>
              <h2>Full Slate</h2>
              <p>
                Every saved game for {data.today}, including calibrated pitcher,
                total, moneyline, and first-inning outputs. Green highlights show qualified plays.
              </p>
              <div className={`dkFeedStatus ${draftKings?.status === "LIVE" ? "live" : "partial"}`}>
                {draftKings?.displayMode === "FINAL_PREGAME"
                  ? `DraftKings final pregame snapshots • ${draftKings.finalSnapshotGames || 0} games locked`
                  : draftKings?.displayMode === "MIXED"
                    ? `DraftKings live + final snapshots • ${draftKings.finalSnapshotGames || 0} games locked`
                    : draftKings?.status === "LIVE"
                      ? `DraftKings live splits • updated ${draftKings.updatedAt}`
                      : draftKings?.status === "PARTIAL"
                        ? `DraftKings partial feed • updated ${draftKings.updatedAt}`
                        : draftKingsError
                          ? "DraftKings live feed temporarily unavailable"
                          : "Loading DraftKings live splits…"}
              </div>
            </div>
          </div>

          {data.slateToday.length ? (
            <div className="slateDropdownStack">
              {data.slateToday.map((row, index) => {
                const game =
                  row["Game Label"] || `${row["Away Team"]} at ${row["Home Team"]}`;
                const version = displayModelVersion(String(row["Model Version"] || ""));

                return (
                  <details
                    className="slateDropdown"
                    key={`${row["Game ID"]}-${index}`}
                    open={data.slateToday.length === 1}
                  >
                    <summary className="slateDropdownSummary">
                      <div>
                        <div className="slateDropdownTitle">{game}</div>
                        <div className="slateDropdownSub">
                          {version ? `Model ${version}` : "Calibrated daily projection"}
                        </div>
                      </div>
                      <span className="slateDropdownAction">View matchup</span>
                    </summary>
                    <div className="slateDropdownBody">
                      <SlateCard row={row} draftKings={draftKings} />
                    </div>
                  </details>
                );
              })}
            </div>
          ) : (
            <div className="empty">No games saved today yet.</div>
          )}
        </>
      );
    }

    return (
      <>
        <div className="sectionHead">
          <div>
            <h2>All Qualified Plays</h2>
            <p>
              All qualified green plays are tracked here. Non-edge moneylines
              are kept out of public green totals.
            </p>
          </div>
        </div>

        <div className="qualifiedGrid">
          <Tile
            label="Handpicked Plays - Last 7 Days"
            value={handpickedLast7.record}
            meta={`${handpickedLast7.winPct}% • ${handpickedLast7.unitsWon}u • ROI ${handpickedLast7.roiPct}%`}
            green={handpickedLast7.totalBets > 0}
          />
          <Tile
            label="Handpicked Plays - Running Total"
            value={handpickedOverall.record}
            meta={`${handpickedOverall.winPct}% • ${handpickedOverall.unitsWon}u • ROI ${handpickedOverall.roiPct}%`}
            green={handpickedOverall.totalBets > 0}
          />
          <Tile
            label="Qualified Plays - Last 7 Days"
            value={visibleLast7Totals.record}
            meta={`${visibleLast7Totals.winPct}% • ${visibleLast7Totals.unitsWon}u • ROI ${visibleLast7Totals.roiPct}%`}
            green
          />
          <Tile
            label="Qualified Plays - Running Total"
            value={visibleOverallTotals.record}
            meta={`${visibleOverallTotals.winPct}% • ${visibleOverallTotals.unitsWon}u • ROI ${visibleOverallTotals.roiPct}%`}
            green
          />
        </div>

        <div className="sectionHead trendRecordsHead">
          <div>
            <h2>Trend Play Records</h2>
            <p>
              Good, Strong, and Elite results use the exact tier and score saved at the final pregame snapshot. Grades are never recalculated after the game.
            </p>
          </div>
        </div>

        <TrendTierRecords
          rows={data.trendRecordRows || []}
          today={data.today}
        />

        <div className="sectionHead dkSignalsHead">
          <div>
            <h2>DraftKings Market Signals</h2>
            <p>
              Tracks both moneyline teams and both total directions for every saved game, with model-qualified plays available as a separate filter. Signals are separated by market and side so exact trend samples can become reliable.
            </p>
          </div>
        </div>

        <DraftKingsSignalRecords
          rows={data.draftKingsSignalRows || []}
          today={data.today}
        />

        <div className="sectionHead">
          <div>
            <h2>Bet Type Records</h2>
            <p>
              Open each section to review normal Best Plays records or
              handpicked-only records by bet type.
            </p>
          </div>
        </div>

        <div className="recordsDropdownStack">
          <RecordsDropdown
            title="Last 7 Days Best Plays"
            subtitle="Qualified green plays from the last 7 days."
            rows={visibleLast7RecordSummary}
            defaultOpen
          />
          <RecordsDropdown
            title="Overall Best Plays"
            subtitle="All completed qualified green plays from your tracker."
            rows={visibleOverallRecordSummary}
          />
          <RecordsDropdown
            title="Last 7 Days Handpicked"
            subtitle="Handpicked-only results from the last 7 days, broken down by bet type."
            rows={visibleHandpickedLast7RecordSummary}
          />
          <RecordsDropdown
            title="Overall Handpicked"
            subtitle="All completed handpicked plays, broken down by bet type."
            rows={visibleHandpickedOverallRecordSummary}
          />
        </div>
      </>
    );
  }, [
    activeSport,
    active,
    bestPlays,
    handpickedLast7,
    handpickedOverall,
    favoriteRowMap,
    data,
    error,
    mergedLast7RecordSummary,
    trackerLastSevenBetsRecordSummary,
    draftKings,
    draftKingsError,
    visibleLast7RecordSummary,
    visibleOverallRecordSummary,
    visibleHandpickedLast7RecordSummary,
    visibleHandpickedOverallRecordSummary,
    visibleLast7Totals,
    visibleOverallTotals,
    loadData,
  ]);

  return (
    <main className="shell">
      <section className="hero">
        <div className="heroAccent" aria-hidden="true" />
        <div className="heroTopline">
          <span className="heroKicker">
            <span className="heroKickerDot" /> EZPZ MODEL CENTER
          </span>
          <span className="heroLive">LIVE PROJECTIONS</span>
        </div>

        <div className="heroBrand">
          <div className="logoWrap">
            <div className="logoFallback">EZ</div>
            <img className="logo" src="/ezpz_logo.png" alt="EZPZ Picks logo" />
          </div>
          <div className="heroCopy">
            <h1>
              {activeSport === "MLB"
                ? "Today’s calibrated betting board"
                : `${activeSportMeta.name} model center`}
            </h1>
            <p className="heroSub">{activeSportMeta.description}</p>
          </div>
        </div>

        <div className="heroStatusRow">
          <span className="statusDot">●</span>
          <span>
            {activeSport === "MLB"
              ? activeModelVersion
                ? `MLB Model ${activeModelVersion}`
                : "MLB model online"
              : `${activeSportMeta.shortName} • ${activeSportMeta.status}`}
          </span>
          {activeSport === "MLB" && data?.lastUpdated ? (
            <span>Updated {data.lastUpdated}</span>
          ) : null}
          <button
            type="button"
            className="refreshBtn"
            onClick={() => void loadData()}
            disabled={refreshing}
            aria-label={`Refresh ${activeSportMeta.shortName} public board`}
          >
            {refreshing ? "Refreshing…" : "Refresh board"}
          </button>
        </div>
      </section>

      {error && data ? (
        <div className="staleBanner">
          Showing the last successful update. Refresh failed: {error}
        </div>
      ) : null}

      <nav className="sportTabs">
        {SPORTS.map((sport) => (
          <button
            key={sport}
            className={`sportTabBtn ${activeSport === sport ? "active" : ""}`}
            onClick={() => {
              setActiveSport(sport);
              setActive("Today’s Best Plays");
            }}
          >
            {sport}
          </button>
        ))}
      </nav>

      {data ? (
        <section className="tileGrid">
          {activeSport === "MLB" ? (
            <>
              <Tile
                label="Best Plays - Last 7 Days"
                value={visibleLast7Totals.record}
                meta={`${visibleLast7Totals.winPct}% • ${visibleLast7Totals.unitsWon}u • ROI ${visibleLast7Totals.roiPct}%`}
                green
              />
              <Tile
                label="Best Plays - Running Total"
                value={visibleOverallTotals.record}
                meta={`${visibleOverallTotals.winPct}% • ${visibleOverallTotals.unitsWon}u • ROI ${visibleOverallTotals.roiPct}%`}
                green
              />
              <Tile
                label="Today’s Handpicked"
                value={String(handpickedTodayCount)}
                meta="Your conviction plays"
                green={handpickedTodayCount > 0}
              />
              <Tile
                label="Handpicked - Last 7 Days"
                value={handpickedLast7.record}
                meta={`${handpickedLast7.winPct}% • ${handpickedLast7.unitsWon}u • ROI ${handpickedLast7.roiPct}%`}
                green={
                  handpickedLast7.wins >= handpickedLast7.losses &&
                  handpickedLast7.totalBets > 0
                }
              />
              <Tile
                label="Handpicked - Running Total"
                value={handpickedOverall.record}
                meta={`${handpickedOverall.winPct}% • ${handpickedOverall.unitsWon}u • ROI ${handpickedOverall.roiPct}%`}
                green={
                  handpickedOverall.wins >= handpickedOverall.losses &&
                  handpickedOverall.totalBets > 0
                }
              />
              <Tile
                label="Today’s Best Plays"
                value={String(bestPlays.length)}
                meta="Pending Best Plays"
                green={bestPlays.length > 0}
              />
            </>
          ) : (
            <>
              <Tile
                label="Best Plays - Last 7 Days"
                value="0-0-0"
                meta="0.0% • 0.00u • ROI 0.0%"
              />
              <Tile
                label="Best Plays - Running Total"
                value="0-0-0"
                meta="Tracking begins with official plays"
              />
              <Tile
                label="Today’s Handpicked"
                value="0"
                meta="No selections posted"
              />
              <Tile
                label="Model Stage"
                value="PRESEASON"
                meta={activeSportMeta.status}
              />
              <Tile
                label="Today’s Best Plays"
                value="0"
                meta="Public format is ready"
              />
              <Tile
                label="Published Matchups"
                value="0"
                meta="Slate connection pending"
              />
            </>
          )}
        </section>
      ) : null}

      <nav className="tabs">
        {TABS.map((tab) => (
          <button
            key={tab}
            className={`tabBtn ${active === tab ? "active" : ""}`}
            onClick={() => setActive(tab)}
          >
            {tab}
          </button>
        ))}
      </nav>

      {content}

      <footer className="siteFooter">
        <div>
          <strong>EZPZ Picks</strong>
          <span>Multi-sport projections • transparent records • matchup-driven modeling</span>
        </div>
        <p>
          Model probabilities are estimates, not guarantees. Records use one-unit risk
          unless otherwise noted. Wager responsibly.
        </p>
      </footer>

      <style jsx global>{`
        :root {
          color-scheme: dark;
          --ez-bg: #02040a;
          --ez-bg-soft: #050914;
          --ez-panel: #080e1b;
          --ez-panel-2: #0b1324;
          --ez-panel-3: #0f1a2d;
          --ez-border: rgba(125, 154, 198, 0.16);
          --ez-border-strong: rgba(70, 156, 255, 0.34);
          --ez-blue: #2f8cff;
          --ez-blue-bright: #24c7ff;
          --ez-blue-soft: #8cc7ff;
          --ez-green: #2bd875;
          --ez-yellow: #f7c85c;
          --ez-red: #ff6978;
          --ez-text: #f7fbff;
          --ez-muted: #94a8c5;
          --ez-muted-2: #6f819d;
          --ez-shadow: 0 24px 70px rgba(0, 0, 0, 0.46);
        }

        * {
          box-sizing: border-box;
        }

        html {
          min-height: 100%;
          background: var(--ez-bg);
          scroll-behavior: smooth;
        }

        body {
          min-height: 100vh;
          margin: 0;
          color: var(--ez-text);
          background:
            radial-gradient(circle at 12% -8%, rgba(47, 140, 255, 0.2), transparent 34rem),
            radial-gradient(circle at 92% 18%, rgba(36, 199, 255, 0.08), transparent 30rem),
            linear-gradient(180deg, #02040a 0%, #040813 48%, #02040a 100%);
          font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          -webkit-font-smoothing: antialiased;
          text-rendering: optimizeLegibility;
        }

        body::before {
          content: "";
          position: fixed;
          inset: 0;
          z-index: -1;
          pointer-events: none;
          opacity: 0.18;
          background-image:
            linear-gradient(rgba(79, 156, 255, 0.045) 1px, transparent 1px),
            linear-gradient(90deg, rgba(79, 156, 255, 0.045) 1px, transparent 1px);
          background-size: 44px 44px;
          mask-image: linear-gradient(to bottom, black, transparent 78%);
        }

        button {
          font: inherit;
        }

        img {
          display: block;
          max-width: 100%;
        }

        ::selection {
          color: #fff;
          background: rgba(47, 140, 255, 0.5);
        }

        .shell {
          width: min(1180px, 100%);
          margin: 0 auto;
          padding: 20px 18px 54px;
        }

        .hero {
          position: relative;
          overflow: hidden;
          border: 1px solid rgba(76, 158, 255, 0.28);
          border-radius: 30px;
          padding: 23px 25px 21px;
          background:
            linear-gradient(135deg, rgba(5, 9, 18, 0.98), rgba(8, 18, 38, 0.96)),
            radial-gradient(circle at 88% 8%, rgba(47, 140, 255, 0.24), transparent 26rem);
          box-shadow:
            0 0 0 1px rgba(47, 140, 255, 0.04),
            var(--ez-shadow);
          isolation: isolate;
        }

        .hero::before {
          content: "";
          position: absolute;
          width: 420px;
          height: 420px;
          right: -190px;
          top: -245px;
          border-radius: 50%;
          background: rgba(36, 199, 255, 0.17);
          filter: blur(12px);
          z-index: -1;
        }

        .hero::after {
          content: "";
          position: absolute;
          inset: auto -5% -65% 28%;
          height: 250px;
          background: radial-gradient(ellipse, rgba(47, 140, 255, 0.14), transparent 68%);
          z-index: -1;
        }

        .heroAccent {
          position: absolute;
          inset: 0 auto 0 0;
          width: 3px;
          background: linear-gradient(180deg, transparent, var(--ez-blue), var(--ez-blue-bright), transparent);
          box-shadow: 0 0 24px rgba(47, 140, 255, 0.78);
        }

        .heroTopline {
          position: relative;
          z-index: 1;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 17px;
        }

        .heroKicker,
        .heroLive {
          display: inline-flex;
          align-items: center;
          border-radius: 999px;
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }

        .heroKicker {
          gap: 7px;
          color: #cde8ff;
        }

        .heroKickerDot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--ez-blue-bright);
          box-shadow: 0 0 16px rgba(36, 199, 255, 0.95);
        }

        .heroLive {
          padding: 6px 9px;
          color: #d5ffe6;
          background: rgba(18, 117, 65, 0.16);
          border: 1px solid rgba(43, 216, 117, 0.25);
        }

        .heroBrand {
          position: relative;
          z-index: 1;
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          align-items: center;
          gap: 24px;
        }

        .logoWrap {
          position: relative;
          display: grid;
          place-items: center;
          width: 172px;
          min-height: 86px;
        }

        .logo {
          position: relative;
          z-index: 2;
          width: 168px;
          height: auto;
          object-fit: contain;
          filter: drop-shadow(0 12px 28px rgba(0, 0, 0, 0.48));
        }

        .logoFallback {
          position: absolute;
          inset: 0;
          display: grid;
          place-items: center;
          border-radius: 22px;
          color: rgba(141, 204, 255, 0.18);
          font-size: 38px;
          font-weight: 950;
          letter-spacing: -0.08em;
        }

        .heroCopy h1 {
          margin: 0;
          color: #fff;
          font-size: clamp(24px, 4vw, 40px);
          line-height: 1.02;
          letter-spacing: -0.045em;
          text-wrap: balance;
        }

        .heroSub {
          max-width: 680px;
          margin: 10px 0 0;
          color: rgba(196, 215, 239, 0.8);
          font-size: 14px;
          line-height: 1.55;
        }

        .heroStatusRow {
          position: relative;
          z-index: 1;
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 9px 14px;
          margin-top: 19px;
          padding-top: 15px;
          border-top: 1px solid rgba(118, 155, 202, 0.13);
          color: rgba(200, 222, 248, 0.8);
          font-size: 12px;
          font-weight: 750;
        }

        .statusDot {
          color: var(--ez-green);
          font-size: 12px;
          text-shadow: 0 0 16px rgba(43, 216, 117, 0.9);
          animation: statusPulse 2.4s ease-in-out infinite;
        }

        .refreshBtn {
          margin-left: auto;
          border: 1px solid rgba(77, 163, 255, 0.34);
          background: linear-gradient(135deg, rgba(32, 106, 222, 0.26), rgba(14, 28, 55, 0.72));
          color: #e9f5ff;
          border-radius: 999px;
          padding: 8px 13px;
          font-weight: 850;
          cursor: pointer;
          transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease;
        }

        .refreshBtn:hover:not(:disabled) {
          transform: translateY(-1px);
          border-color: rgba(92, 187, 255, 0.68);
          background: linear-gradient(135deg, rgba(37, 121, 244, 0.36), rgba(14, 28, 55, 0.84));
        }

        .refreshBtn:disabled {
          opacity: 0.55;
          cursor: wait;
        }

        .staleBanner {
          margin: 13px 0;
          border: 1px solid rgba(247, 200, 92, 0.32);
          background: rgba(97, 65, 10, 0.2);
          color: #ffe6a3;
          border-radius: 15px;
          padding: 11px 14px;
          font-size: 13px;
        }

        .sportTabs {
          display: flex;
          width: fit-content;
          margin: 16px auto 12px;
          padding: 5px;
          gap: 5px;
          border: 1px solid rgba(87, 133, 193, 0.18);
          border-radius: 16px;
          background: rgba(4, 8, 17, 0.8);
          box-shadow: 0 14px 34px rgba(0, 0, 0, 0.25);
        }

        .sportTabBtn,
        .tabBtn {
          border: 0;
          color: var(--ez-muted);
          cursor: pointer;
          font-weight: 850;
          transition: color 0.18s ease, background 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease;
        }

        .sportTabBtn {
          min-width: 88px;
          border-radius: 12px;
          padding: 9px 17px;
          background: transparent;
          font-size: 12px;
          letter-spacing: 0.08em;
        }

        .sportTabBtn.active {
          color: #fff;
          background: linear-gradient(135deg, #1769dc, #20a9e9);
          box-shadow: 0 8px 22px rgba(25, 118, 230, 0.33);
        }

        .tileGrid,
        .qualifiedGrid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 11px;
          margin: 13px 0 15px;
        }

        .tile {
          position: relative;
          overflow: hidden;
          min-width: 0;
          border: 1px solid rgba(116, 148, 192, 0.15);
          border-radius: 18px;
          padding: 14px 15px;
          background: linear-gradient(145deg, rgba(9, 15, 29, 0.92), rgba(6, 11, 21, 0.86));
          box-shadow: 0 12px 30px rgba(0, 0, 0, 0.23);
        }

        .tile::after {
          content: "";
          position: absolute;
          width: 100px;
          height: 100px;
          right: -42px;
          top: -54px;
          border-radius: 50%;
          background: rgba(47, 140, 255, 0.08);
        }

        .tile.green {
          border-color: rgba(47, 140, 255, 0.24);
          background:
            linear-gradient(145deg, rgba(10, 25, 48, 0.94), rgba(5, 11, 22, 0.9));
        }

        .tile.green::before {
          content: "";
          position: absolute;
          inset: 0 auto 0 0;
          width: 2px;
          background: linear-gradient(180deg, var(--ez-blue), var(--ez-green));
          box-shadow: 0 0 18px rgba(47, 140, 255, 0.52);
        }

        .tileLabel {
          position: relative;
          z-index: 1;
          color: var(--ez-muted);
          font-size: 10px;
          font-weight: 850;
          letter-spacing: 0.09em;
          text-transform: uppercase;
        }

        .tileValue {
          position: relative;
          z-index: 1;
          margin-top: 5px;
          color: #fff;
          font-size: clamp(20px, 3vw, 27px);
          line-height: 1.04;
          font-weight: 920;
          letter-spacing: -0.035em;
          font-variant-numeric: tabular-nums;
        }

        .tileMeta {
          position: relative;
          z-index: 1;
          margin-top: 5px;
          color: rgba(166, 188, 216, 0.75);
          font-size: 11px;
          line-height: 1.35;
        }

        .tabs {
          position: sticky;
          z-index: 30;
          top: 9px;
          display: flex;
          gap: 6px;
          margin: 16px 0 27px;
          padding: 6px;
          border: 1px solid rgba(96, 144, 205, 0.2);
          border-radius: 18px;
          background: rgba(3, 7, 14, 0.82);
          box-shadow: 0 18px 42px rgba(0, 0, 0, 0.3);
          backdrop-filter: blur(18px) saturate(140%);
          -webkit-backdrop-filter: blur(18px) saturate(140%);
        }

        .tabBtn {
          flex: 1;
          min-width: 0;
          border-radius: 13px;
          padding: 11px 12px;
          background: transparent;
          font-size: 13px;
          white-space: nowrap;
        }

        .tabBtn:hover {
          color: #e8f4ff;
          background: rgba(47, 140, 255, 0.08);
        }

        .tabBtn.active {
          color: #fff;
          background: linear-gradient(135deg, rgba(24, 100, 220, 0.95), rgba(24, 169, 225, 0.92));
          box-shadow: 0 8px 22px rgba(27, 117, 224, 0.3);
        }

        .sectionHead {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 18px;
          margin: 0 2px 17px;
        }

        .sectionHead h2 {
          margin: 0;
          color: #fff;
          font-size: clamp(22px, 3vw, 31px);
          line-height: 1.05;
          letter-spacing: -0.035em;
        }

        .sectionHead p {
          max-width: 740px;
          margin: 7px 0 0;
          color: rgba(157, 181, 211, 0.78);
          font-size: 13px;
          line-height: 1.5;
        }

        .countPill {
          flex: 0 0 auto;
          border: 1px solid rgba(72, 163, 255, 0.3);
          border-radius: 999px;
          padding: 7px 11px;
          color: #d8edff;
          background: rgba(26, 105, 210, 0.15);
          font-size: 11px;
          font-weight: 850;
          letter-spacing: 0.04em;
          white-space: nowrap;
        }

        .playsBoard {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 22px;
          align-items: start;
        }

        .playsBoardColumn {
          min-width: 0;
        }

        .boardCards {
          grid-template-columns: 1fr;
        }

        .modelTrendBadge {
          position: relative;
          z-index: 3;
          width: fit-content;
          margin: -3px 0 12px;
          border: 1px solid rgba(60, 218, 142, 0.42);
          border-radius: 999px;
          padding: 6px 10px;
          color: #d9ffeb;
          background: linear-gradient(135deg, rgba(20, 151, 86, 0.28), rgba(7, 47, 32, 0.78));
          font-size: 10px;
          font-weight: 950;
          letter-spacing: 0.07em;
          box-shadow: 0 0 18px rgba(43, 216, 117, 0.14);
        }

        .modelTrendBadge.agree {
          border-color: rgba(75, 166, 255, 0.4);
          color: #def0ff;
          background: linear-gradient(135deg, rgba(28, 113, 220, 0.3), rgba(6, 31, 63, 0.8));
          box-shadow: 0 0 18px rgba(47, 140, 255, 0.14);
        }

        .trendCard {
          border-color: rgba(78, 145, 255, 0.25);
        }

        .trendCard::before {
          content: "";
          position: absolute;
          inset: 14px auto 14px 0;
          width: 3px;
          border-radius: 0 3px 3px 0;
          background: linear-gradient(180deg, #7c8cff, var(--ez-blue));
          box-shadow: 0 0 22px rgba(91, 123, 255, 0.34);
        }

        .trendScorePill {
          border-color: rgba(123, 138, 255, 0.38);
          background: linear-gradient(135deg, rgba(73, 76, 202, 0.3), rgba(8, 18, 42, 0.86));
        }

        .trendProjectionBlock {
          margin-top: 2px;
        }

        .trendSignalList {
          display: grid;
          gap: 10px;
          margin-top: 13px;
        }

        .trendSignalPanel {
          position: relative;
          z-index: 1;
          border: 1px solid rgba(105, 139, 183, 0.16);
          border-radius: 17px;
          padding: 11px;
          background: rgba(3, 9, 20, 0.52);
        }

        .trendSignalHead {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 9px;
        }

        .trendSignalHead > div {
          display: grid;
          gap: 5px;
          min-width: 0;
        }

        .trendSignalHead small {
          color: rgba(151, 177, 208, 0.72);
          font-size: 10px;
          line-height: 1.3;
        }

        .trendSignalHead > strong {
          display: grid;
          place-items: center;
          min-width: 38px;
          height: 34px;
          border: 1px solid rgba(80, 157, 255, 0.28);
          border-radius: 11px;
          color: #f1f7ff;
          background: rgba(27, 91, 175, 0.18);
          font-size: 15px;
          font-weight: 950;
        }

        .trendRecordGrid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 7px;
        }

        .trendRecordCell {
          min-width: 0;
          border: 1px solid rgba(93, 128, 171, 0.13);
          border-radius: 12px;
          padding: 8px;
          background: rgba(8, 17, 33, 0.64);
        }

        .trendRecordCell span,
        .trendRecordCell small {
          display: block;
          color: rgba(144, 171, 204, 0.72);
          font-size: 9px;
          line-height: 1.25;
        }

        .trendRecordCell strong {
          display: block;
          margin: 3px 0;
          color: #f1f6fd;
          font-size: 12px;
          font-weight: 900;
          font-variant-numeric: tabular-nums;
        }

        .trendWeightLine {
          margin-top: 8px;
          color: rgba(145, 174, 209, 0.7);
          font-size: 9px;
          line-height: 1.35;
        }

        .trendMeta {
          margin-top: 13px;
        }

        .trendGameGrid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 17px;
          align-items: start;
        }

        .trendGameCard {
          border-color: rgba(78, 145, 255, 0.25);
        }

        .trendGameCard::before {
          content: "";
          position: absolute;
          inset: 14px auto 14px 0;
          width: 3px;
          border-radius: 0 3px 3px 0;
          background: linear-gradient(180deg, #7c8cff, var(--ez-blue));
          box-shadow: 0 0 22px rgba(91, 123, 255, 0.34);
        }

        .trendGameHeader {
          position: relative;
          z-index: 2;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
        }

        .trendGameRankBox {
          flex: 0 0 auto;
          display: grid;
          justify-items: center;
          min-width: 72px;
          border: 1px solid rgba(110, 151, 255, 0.25);
          border-radius: 15px;
          padding: 8px 10px;
          background: rgba(31, 70, 142, 0.17);
        }

        .trendGameRankBox span {
          color: rgba(160, 187, 220, 0.72);
          font-size: 8px;
          font-weight: 900;
          letter-spacing: 0.08em;
        }

        .trendGameRankBox strong {
          margin-top: 2px;
          color: #f3f7ff;
          font-size: 21px;
          font-weight: 950;
        }

        .trendGameLeader {
          position: relative;
          z-index: 2;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          margin: 15px 0 11px;
          border: 1px solid rgba(71, 150, 255, 0.24);
          border-radius: 18px;
          padding: 12px 13px;
          background: linear-gradient(135deg, rgba(26, 91, 183, 0.22), rgba(6, 18, 38, 0.68));
        }

        .trendGameLeader > div:first-child {
          display: grid;
          gap: 3px;
          min-width: 0;
        }

        .trendGameLeaderLabel,
        .trendGameLeader small {
          color: rgba(158, 184, 216, 0.74);
          font-size: 9px;
          font-weight: 850;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }

        .trendGameLeader > div:first-child > strong {
          color: #f5f8ff;
          font-size: 20px;
          font-weight: 950;
        }

        .trendGameLeaderScore {
          flex: 0 0 auto;
          display: grid;
          justify-items: center;
          min-width: 64px;
          border-left: 1px solid rgba(115, 158, 217, 0.18);
          padding-left: 13px;
        }

        .trendGameLeaderScore span {
          color: rgba(155, 184, 220, 0.72);
          font-size: 8px;
          font-weight: 900;
          letter-spacing: 0.08em;
        }

        .trendGameLeaderScore strong {
          color: #eef5ff;
          font-size: 30px;
          font-weight: 950;
          line-height: 1;
        }

        .trendGameMatchBadge {
          margin: 0 0 11px;
        }

        .trendSelectionStack {
          position: relative;
          z-index: 2;
          display: grid;
          gap: 9px;
        }

        .trendSelectionRow {
          overflow: hidden;
          border: 1px solid rgba(100, 139, 190, 0.15);
          border-radius: 17px;
          background: rgba(4, 11, 23, 0.62);
        }

        .trendSelectionRow.leader {
          border-color: rgba(70, 155, 255, 0.3);
          background: rgba(7, 22, 46, 0.72);
        }

        .trendSelectionSummary {
          cursor: pointer;
          list-style: none;
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto auto;
          align-items: center;
          gap: 11px;
          min-height: 66px;
          padding: 10px 12px;
          user-select: none;
        }

        .trendSelectionSummary::-webkit-details-marker {
          display: none;
        }

        .trendSelectionRank {
          display: grid;
          place-items: center;
          width: 34px;
          height: 34px;
          border: 1px solid rgba(100, 149, 214, 0.2);
          border-radius: 11px;
          color: #dbeaff;
          background: rgba(29, 76, 139, 0.18);
          font-size: 12px;
          font-weight: 950;
        }

        .trendSelectionIdentity {
          display: grid;
          gap: 4px;
          min-width: 0;
        }

        .trendSelectionIdentity strong {
          overflow: hidden;
          color: #f2f7ff;
          font-size: 15px;
          font-weight: 950;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .trendSelectionIdentity small {
          overflow: hidden;
          color: rgba(145, 174, 209, 0.72);
          font-size: 9px;
          line-height: 1.25;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .trendSelectionMarket {
          display: grid;
          justify-items: end;
          gap: 2px;
          min-width: 88px;
        }

        .trendSelectionMarket small {
          color: rgba(154, 182, 215, 0.74);
          font-size: 8px;
          font-weight: 900;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }

        .trendSelectionMarket strong {
          color: #f4f8ff;
          font-size: 24px;
          font-weight: 950;
          line-height: 1;
        }

        .trendSelectionChevron {
          color: rgba(163, 191, 225, 0.68);
          font-size: 18px;
          transition: transform 0.2s ease;
        }

        .trendSelectionRow[open] .trendSelectionChevron {
          transform: rotate(180deg);
        }

        .trendSelectionBody {
          border-top: 1px solid rgba(100, 139, 190, 0.12);
          padding: 12px;
        }

        .trendSelectionMetrics {
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }

        .cards {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(min(100%, 350px), 1fr));
          gap: 17px;
          align-items: start;
        }

        .card {
          position: relative;
          overflow: hidden;
          min-width: 0;
          border-radius: 24px;
          border: 1px solid var(--ez-border);
          padding: 18px;
          background:
            linear-gradient(155deg, rgba(9, 16, 31, 0.97), rgba(5, 10, 20, 0.96));
          box-shadow:
            0 0 0 1px rgba(255, 255, 255, 0.012),
            0 20px 52px rgba(0, 0, 0, 0.37);
          transition: transform 0.22s ease, border-color 0.22s ease, box-shadow 0.22s ease;
        }

        .card::after {
          content: "";
          position: absolute;
          width: 220px;
          height: 220px;
          right: -135px;
          top: -145px;
          border-radius: 50%;
          background: rgba(47, 140, 255, 0.08);
          pointer-events: none;
        }

        .card:hover {
          transform: translateY(-2px);
          border-color: rgba(74, 157, 255, 0.29);
          box-shadow:
            0 0 0 1px rgba(47, 140, 255, 0.05),
            0 26px 64px rgba(0, 0, 0, 0.44);
        }

        .card.green {
          border-color: rgba(43, 216, 117, 0.2);
        }

        .card.green::before {
          content: "";
          position: absolute;
          inset: 14px auto 14px 0;
          width: 3px;
          border-radius: 0 3px 3px 0;
          background: linear-gradient(180deg, var(--ez-blue), var(--ez-green));
          box-shadow: 0 0 22px rgba(43, 216, 117, 0.36);
        }

        .card.top {
          border-color: rgba(47, 140, 255, 0.42);
          box-shadow:
            0 0 0 1px rgba(47, 140, 255, 0.08),
            0 25px 66px rgba(6, 54, 128, 0.2),
            0 20px 52px rgba(0, 0, 0, 0.38);
        }

        .card.best {
          isolation: isolate;
        }

        .cardTop {
          position: relative;
          z-index: 2;
          display: flex;
          align-items: center;
          gap: 9px;
          margin-bottom: 14px;
        }

        .rankBadge {
          display: grid;
          place-items: center;
          min-width: 46px;
          height: 40px;
          border: 1px solid rgba(61, 164, 255, 0.34);
          border-radius: 14px;
          color: #e8f5ff;
          background: linear-gradient(145deg, rgba(24, 106, 218, 0.28), rgba(7, 20, 41, 0.8));
          font-size: 16px;
          font-weight: 920;
          font-variant-numeric: tabular-nums;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
        }

        .scorePill {
          display: inline-grid;
          grid-template-columns: auto auto auto;
          align-items: baseline;
          gap: 6px;
          margin-left: auto;
          min-height: 40px;
          border: 1px solid rgba(55, 166, 255, 0.32);
          border-radius: 14px;
          padding: 7px 11px;
          color: #f3f9ff;
          background:
            linear-gradient(135deg, rgba(13, 102, 217, 0.28), rgba(4, 17, 35, 0.84));
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
          white-space: nowrap;
        }

        .scorePillLabel,
        .scorePillSub {
          color: #8dc8ff;
          font-size: 9px;
          font-weight: 900;
          letter-spacing: 0.1em;
        }

        .scorePill strong {
          color: #fff;
          font-size: 17px;
          line-height: 1;
          font-weight: 950;
          font-variant-numeric: tabular-nums;
        }

        .scorePillSub {
          color: rgba(157, 195, 233, 0.7);
        }

        .teamRow {
          position: relative;
          z-index: 1;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
          align-items: center;
          gap: 9px;
          margin: 4px 0 15px;
          border: 1px solid rgba(105, 139, 183, 0.13);
          border-radius: 17px;
          padding: 10px 11px;
          background: rgba(3, 8, 17, 0.45);
        }

        .teamSide {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }

        .teamSide.home {
          justify-content: flex-end;
          text-align: right;
        }

        .teamLogo {
          flex: 0 0 auto;
          width: 31px;
          height: 31px;
          object-fit: contain;
          filter: drop-shadow(0 5px 9px rgba(0, 0, 0, 0.3));
        }

        .teamName {
          min-width: 0;
          color: #e8eef7;
          font-size: 12px;
          font-weight: 850;
          line-height: 1.2;
          overflow-wrap: anywhere;
        }

        .vsText {
          color: rgba(113, 137, 169, 0.9);
          font-size: 9px;
          font-weight: 950;
          letter-spacing: 0.12em;
        }

        .playMain,
        .pitcherHeader {
          position: relative;
          z-index: 1;
          display: flex;
          align-items: center;
          gap: 13px;
        }

        .headshotFrame {
          position: relative;
          flex: 0 0 auto;
          width: 78px;
          height: 78px;
          border-radius: 22px;
          padding: 2px;
          background: linear-gradient(145deg, rgba(67, 163, 255, 0.95), rgba(36, 199, 255, 0.28) 45%, rgba(43, 216, 117, 0.56));
          box-shadow:
            0 12px 28px rgba(0, 0, 0, 0.38),
            0 0 28px rgba(47, 140, 255, 0.13);
        }

        .headshot,
        .headshotFallback {
          width: 100%;
          height: 100%;
          border-radius: 20px;
        }

        .headshot {
          object-fit: cover;
          object-position: center 15%;
          background: linear-gradient(145deg, #0a1426, #050a12);
          opacity: 0;
          transform: scale(0.985);
          transition: opacity 0.28s ease, transform 0.28s ease;
        }

        .headshotFrame.loaded .headshot {
          opacity: 1;
          transform: scale(1);
        }

        .headshotFallback {
          display: grid;
          place-items: center;
          overflow: hidden;
          color: rgba(137, 193, 244, 0.58);
          background:
            linear-gradient(145deg, rgba(13, 31, 57, 0.98), rgba(4, 10, 19, 0.98));
        }

        .headshotFallback::after {
          content: "";
          position: absolute;
          inset: 2px;
          border-radius: 20px;
          background: linear-gradient(105deg, transparent 28%, rgba(95, 174, 255, 0.09) 46%, transparent 65%);
          background-size: 220% 100%;
          animation: shimmer 2s linear infinite;
        }

        .headshotFallback svg {
          width: 42px;
          height: 42px;
          fill: rgba(79, 155, 224, 0.12);
          stroke: rgba(133, 196, 250, 0.58);
          stroke-width: 2.2;
          stroke-linecap: round;
        }

        .headshotTeamBadge {
          position: absolute;
          z-index: 3;
          right: -5px;
          bottom: -5px;
          width: 27px;
          height: 27px;
          border: 2px solid #07101e;
          border-radius: 50%;
          padding: 3px;
          object-fit: contain;
          background: #eaf4ff;
          box-shadow: 0 6px 15px rgba(0, 0, 0, 0.45);
        }

        .teamPickFrame {
          position: relative;
          flex: 0 0 auto;
          display: grid;
          place-items: center;
          width: 76px;
          height: 76px;
          border: 1px solid rgba(66, 165, 255, 0.38);
          border-radius: 22px;
          background:
            radial-gradient(circle at 35% 25%, rgba(53, 157, 255, 0.17), transparent 52%),
            linear-gradient(145deg, rgba(10, 29, 55, 0.98), rgba(4, 10, 19, 0.98));
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.045),
            0 12px 28px rgba(0, 0, 0, 0.38),
            0 0 26px rgba(47, 140, 255, 0.12);
          overflow: hidden;
        }

        .teamPickFrame::after {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: inherit;
          background: linear-gradient(120deg, transparent 20%, rgba(83, 177, 255, 0.08), transparent 66%);
          pointer-events: none;
        }

        .teamPickLogo {
          position: relative;
          z-index: 1;
          width: 70%;
          height: 70%;
          object-fit: contain;
          filter: drop-shadow(0 8px 12px rgba(0, 0, 0, 0.42));
        }

        .teamPickFallback {
          position: relative;
          z-index: 1;
          color: #dff1ff;
          font-size: 20px;
          font-weight: 950;
          letter-spacing: -0.03em;
        }

        .moneylineMain {
          margin-top: 2px;
        }

        .playName {
          color: #fff;
          font-size: clamp(18px, 2.6vw, 23px);
          line-height: 1.06;
          font-weight: 930;
          letter-spacing: -0.025em;
          text-transform: uppercase;
        }

        .playDetail {
          margin-top: 5px;
          color: rgba(153, 176, 205, 0.82);
          font-size: 12px;
          font-weight: 700;
          line-height: 1.35;
        }

        .projectionBlock {
          position: relative;
          z-index: 1;
          margin-top: 16px;
        }

        .projection {
          color: #fff;
          font-size: clamp(30px, 5vw, 43px);
          line-height: 0.98;
          font-weight: 950;
          letter-spacing: -0.055em;
          font-variant-numeric: tabular-nums;
          overflow-wrap: anywhere;
        }

        .grade {
          display: inline-flex;
          width: fit-content;
          margin-top: 9px;
          border-radius: 999px;
          padding: 5px 9px;
          color: #8ef0b5;
          background: rgba(21, 128, 69, 0.14);
          border: 1px solid rgba(43, 216, 117, 0.2);
          font-size: 11px;
          font-weight: 950;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }

        .divider {
          height: 1px;
          margin: 16px 0;
          background: linear-gradient(90deg, rgba(76, 151, 238, 0.3), rgba(91, 126, 170, 0.12), transparent);
        }

        .bubbleGrid {
          position: relative;
          z-index: 1;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 9px;
        }

        .bubbleGrid.three {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }

        .miniBubble {
          min-width: 0;
          border-radius: 15px;
          padding: 11px 12px;
          background: linear-gradient(145deg, rgba(12, 22, 39, 0.82), rgba(6, 13, 25, 0.84));
          border: 1px solid rgba(108, 142, 187, 0.14);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.018);
        }

        .miniBubble.green {
          border-color: rgba(43, 216, 117, 0.17);
          background:
            linear-gradient(145deg, rgba(9, 31, 42, 0.72), rgba(7, 15, 29, 0.9));
        }

        .miniLabel {
          color: rgba(135, 158, 190, 0.88);
          font-size: 9px;
          font-weight: 900;
          letter-spacing: 0.09em;
          text-transform: uppercase;
        }

        .miniValue {
          margin-top: 5px;
          color: #f7fbff;
          font-size: 14px;
          line-height: 1.16;
          font-weight: 900;
          font-variant-numeric: tabular-nums;
          white-space: normal;
          overflow-wrap: anywhere;
          word-break: break-word;
        }

        .publicSplitPanel {
          position: relative;
          z-index: 1;
          margin-top: 15px;
          padding: 13px;
          border-radius: 17px;
          border: 1px solid rgba(84, 157, 244, 0.22);
          background:
            radial-gradient(circle at 100% 0%, rgba(43, 126, 231, 0.12), transparent 44%),
            linear-gradient(145deg, rgba(9, 20, 37, 0.9), rgba(6, 13, 25, 0.94));
        }

        .publicSplitTitle {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 10px;
          color: rgba(169, 198, 232, 0.86);
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 0.075em;
          text-transform: uppercase;
        }

        .publicSplitTitle strong {
          color: #f0f8ff;
          font-size: 11px;
          letter-spacing: 0.02em;
          text-align: right;
        }

        .publicSplitGrid {
          margin-top: 0;
        }

        .publicWarning {
          margin-top: 10px;
          border-radius: 12px;
          padding: 9px 10px;
          font-size: 10px;
          line-height: 1.3;
          font-weight: 950;
          letter-spacing: 0.045em;
          text-transform: uppercase;
        }

        .publicWarning.negative {
          color: #ffc0c0;
          border: 1px solid rgba(255, 82, 82, 0.34);
          background: rgba(135, 24, 32, 0.22);
        }

        .publicWarning.positive {
          color: #a9f2c6;
          border: 1px solid rgba(43, 216, 117, 0.28);
          background: rgba(20, 106, 61, 0.18);
        }

        .publicWarning.caution {
          color: #ffe1a3;
          border: 1px solid rgba(242, 178, 70, 0.32);
          background: rgba(112, 72, 10, 0.22);
        }

        .publicWarning.neutral {
          color: #c9ddf5;
          border: 1px solid rgba(99, 145, 201, 0.24);
          background: rgba(33, 67, 108, 0.18);
        }

        .publicSignalStack {
          display: grid;
          gap: 7px;
          margin-top: 10px;
        }

        .publicSignalStack .publicWarning {
          margin-top: 0;
        }

        .publicSplitMeta {
          margin-top: 8px;
          color: rgba(139, 165, 199, 0.7);
          font-size: 9px;
          line-height: 1.35;
          font-weight: 700;
          overflow-wrap: anywhere;
        }

        .liveMarketPanel {
          grid-column: 1 / -1;
          width: 100%;
          margin-top: 4px;
        }

        .liveSplitTable {
          display: grid;
          gap: 7px;
        }

        .liveSplitEntry {
          display: grid;
          gap: 7px;
          padding: 10px 0;
          border-bottom: 1px solid rgba(97, 135, 184, 0.1);
        }

        .liveSplitEntry:last-child {
          border-bottom: 0;
        }

        .liveSplitSignals {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .liveSignalPill {
          display: inline-flex;
          align-items: center;
          border-radius: 999px;
          padding: 5px 8px;
          font-size: 8px;
          font-weight: 950;
          letter-spacing: 0.035em;
          text-transform: uppercase;
        }

        .liveSignalPill.negative {
          color: #ffc4c4;
          border: 1px solid rgba(255, 83, 83, 0.28);
          background: rgba(133, 24, 34, 0.2);
        }

        .liveSignalPill.caution {
          color: #ffe1a3;
          border: 1px solid rgba(242, 178, 70, 0.3);
          background: rgba(112, 72, 10, 0.2);
        }

        .liveSignalPill.positive {
          color: #a9f2c6;
          border: 1px solid rgba(43, 216, 117, 0.26);
          background: rgba(20, 106, 61, 0.18);
        }

        .liveSignalPill.neutral {
          color: #c9ddf5;
          border: 1px solid rgba(99, 145, 201, 0.24);
          background: rgba(33, 67, 108, 0.18);
        }

        .liveSplitRow {
          display: grid;
          grid-template-columns: minmax(100px, 1.6fr) repeat(3, minmax(54px, 0.7fr));
          align-items: center;
          gap: 7px;
          padding: 9px 10px;
          border-radius: 12px;
          border: 1px solid rgba(84, 157, 244, 0.14);
          background: rgba(8, 18, 33, 0.7);
          color: #eef7ff;
          font-size: 11px;
          font-variant-numeric: tabular-nums;
        }

        .liveSplitRow > strong {
          min-width: 0;
          overflow-wrap: anywhere;
        }

        .liveSplitRow > span {
          display: grid;
          gap: 2px;
          text-align: right;
          font-weight: 900;
        }

        .liveSplitRow small {
          color: rgba(139, 165, 199, 0.72);
          font-size: 8px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }

        .dkFeedStatus {
          display: inline-flex;
          margin-top: 10px;
          padding: 7px 10px;
          border-radius: 999px;
          border: 1px solid rgba(242, 178, 70, 0.24);
          background: rgba(112, 72, 10, 0.15);
          color: #ffe1a3;
          font-size: 10px;
          font-weight: 850;
        }

        .dkFeedStatus.live {
          border-color: rgba(43, 216, 117, 0.24);
          background: rgba(20, 106, 61, 0.16);
          color: #a9f2c6;
        }

        .badges,
        .badgeRow {
          display: flex;
          flex-wrap: wrap;
          gap: 7px;
          margin-top: 13px;
        }

        .badge {
          display: inline-flex;
          align-items: center;
          width: fit-content;
          border-radius: 999px;
          padding: 6px 9px;
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }

        .badge.hot,
        .formPill.hot {
          color: #ffe7a4;
          border-color: rgba(247, 200, 92, 0.28);
          background: rgba(112, 74, 11, 0.2);
        }

        .badge.cold,
        .formPill.cold {
          color: #bfe7ff;
          border-color: rgba(36, 199, 255, 0.26);
          background: rgba(17, 85, 119, 0.18);
        }

        .badge.alt {
          color: #dbeeff;
          border: 1px solid rgba(74, 157, 255, 0.32);
          background: rgba(32, 104, 210, 0.17);
        }

        .badge.handpicked {
          color: #dceeff;
          border: 1px solid rgba(73, 166, 255, 0.4);
          background: rgba(27, 112, 225, 0.19);
        }

        .formRow {
          display: flex;
          flex-wrap: wrap;
          gap: 7px;
          margin-top: 13px;
        }

        .formPill {
          display: inline-flex;
          align-items: center;
          max-width: 100%;
          border: 1px solid rgba(111, 145, 190, 0.16);
          border-radius: 999px;
          padding: 7px 10px;
          color: rgba(191, 209, 231, 0.84);
          background: rgba(12, 21, 37, 0.7);
          font-size: 10px;
          font-weight: 800;
          line-height: 1.25;
          overflow-wrap: anywhere;
        }

        .formPill.neutral {
          color: rgba(191, 207, 229, 0.76);
        }

        .formPill.sample {
          color: #ffe2a8;
          border-color: rgba(242, 178, 70, 0.24);
          background: rgba(100, 68, 18, 0.16);
        }

        .confidenceWrap {
          position: relative;
          z-index: 1;
          margin-top: 15px;
          padding-top: 13px;
          border-top: 1px solid rgba(106, 140, 186, 0.12);
        }

        .confidenceTop {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 8px;
          color: rgba(164, 185, 213, 0.82);
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .confidenceTop span:last-child {
          color: #eaf5ff;
          font-size: 12px;
          font-variant-numeric: tabular-nums;
        }

        .confidenceBar {
          overflow: hidden;
          height: 8px;
          border: 1px solid rgba(99, 137, 187, 0.14);
          border-radius: 999px;
          background: rgba(18, 31, 51, 0.75);
        }

        .confidenceFill {
          height: 100%;
          border-radius: inherit;
          background: linear-gradient(90deg, #2267ef 0%, #20bde4 62%, #2bd875 100%);
          box-shadow: 0 0 16px rgba(36, 199, 255, 0.42);
          transition: width 0.45s ease;
        }

        .modelMeta {
          position: relative;
          z-index: 1;
          display: flex;
          flex-wrap: wrap;
          gap: 7px;
          margin-top: 13px;
          padding-top: 11px;
          border-top: 1px solid rgba(103, 138, 184, 0.11);
        }

        .modelMeta span {
          border-radius: 999px;
          padding: 5px 8px;
          background: rgba(13, 24, 42, 0.7);
          border: 1px solid rgba(104, 139, 184, 0.13);
          color: rgba(160, 182, 211, 0.72);
          font-size: 9px;
          font-weight: 800;
          letter-spacing: 0.035em;
        }

        .cardTitle {
          color: #fff;
          font-size: 17px;
          line-height: 1.18;
          font-weight: 920;
          letter-spacing: -0.02em;
        }

        .cardSub {
          margin-top: 5px;
          color: rgba(150, 174, 205, 0.76);
          font-size: 12px;
          line-height: 1.4;
        }

        .card.handpicked {
          border-color: rgba(69, 166, 255, 0.72) !important;
          box-shadow:
            0 0 0 1px rgba(69, 166, 255, 0.14),
            0 25px 68px rgba(18, 90, 194, 0.24),
            0 20px 52px rgba(0, 0, 0, 0.4) !important;
        }

        .handpickedPill {
          flex: 0 0 auto;
          border: 1px solid rgba(79, 172, 255, 0.48);
          background: linear-gradient(135deg, rgba(33, 119, 235, 0.25), rgba(26, 57, 101, 0.35));
          color: #dcefff;
          border-radius: 999px;
          padding: 6px 9px;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: 0.09em;
          white-space: nowrap;
        }

        .handpickedPillRow {
          position: relative;
          z-index: 2;
          width: fit-content;
          margin: -5px 0 13px;
          box-shadow: 0 8px 22px rgba(18, 90, 194, 0.16);
        }

        .favoriteTag {
          display: inline-flex;
          width: fit-content;
          margin-top: 13px;
          border-radius: 999px;
          padding: 7px 10px;
          background: linear-gradient(135deg, rgba(32, 112, 226, 0.24), rgba(18, 57, 105, 0.24));
          border: 1px solid rgba(91, 183, 255, 0.3);
          color: #dcefff;
          font-weight: 900;
          font-size: 10px;
          letter-spacing: 0.08em;
        }

        .favoriteNotes {
          margin-top: 10px;
          padding: 11px 12px;
          border-radius: 14px;
          background: rgba(9, 19, 34, 0.72);
          border: 1px solid rgba(104, 141, 190, 0.15);
          color: rgba(205, 220, 239, 0.84);
          font-size: 12px;
          line-height: 1.45;
        }

        .slateCardHeader {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
        }

        .slateGreenCallout,
        .slatePassCallout {
          flex: 0 0 auto;
          border-radius: 999px;
          padding: 7px 9px;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: 0.07em;
          text-transform: uppercase;
          white-space: nowrap;
        }

        .slateGreenCallout {
          color: #bdf6d2;
          background: rgba(20, 118, 64, 0.17);
          border: 1px solid rgba(43, 216, 117, 0.24);
        }

        .slatePassCallout {
          color: #b7c4d6;
          background: rgba(35, 51, 73, 0.28);
          border: 1px solid rgba(113, 143, 181, 0.16);
        }

        .slateDropdownStack {
          display: grid;
          gap: 14px;
        }

        .slateDropdown {
          overflow: hidden;
          border: 1px solid rgba(68, 151, 248, 0.2);
          border-radius: 22px;
          background: linear-gradient(145deg, rgba(8, 17, 31, 0.94), rgba(4, 10, 20, 0.92));
          box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
        }

        .slateDropdownSummary {
          cursor: pointer;
          list-style: none;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: center;
          gap: 14px;
          padding: 17px 18px;
          user-select: none;
        }

        .slateDropdownSummary::-webkit-details-marker {
          display: none;
        }

        .slateDropdownSummary::before {
          content: "›";
          grid-column: 1;
          grid-row: 1;
          align-self: center;
          width: 18px;
          color: #75baff;
          font-size: 23px;
          line-height: 1;
          transform: translateX(-2px);
          transition: transform 0.18s ease;
        }

        .slateDropdownSummary > div {
          grid-column: 1;
          grid-row: 1;
          min-width: 0;
          padding-left: 24px;
        }

        .slateDropdown[open] .slateDropdownSummary::before {
          transform: translateX(-2px) rotate(90deg);
        }

        .slateDropdown[open] .slateDropdownSummary {
          border-bottom: 1px solid rgba(78, 153, 241, 0.13);
          background: linear-gradient(90deg, rgba(31, 110, 216, 0.1), transparent);
        }

        .slateDropdownTitle {
          color: #f7fbff;
          font-size: 15px;
          font-weight: 920;
        }

        .slateDropdownSub {
          margin-top: 4px;
          color: rgba(151, 175, 205, 0.76);
          font-size: 11px;
          font-weight: 700;
        }

        .slateDropdownAction {
          grid-column: 2;
          grid-row: 1;
          border: 1px solid rgba(76, 163, 255, 0.24);
          background: rgba(32, 105, 210, 0.13);
          color: #d9edff;
          border-radius: 999px;
          padding: 7px 10px;
          font-size: 9px;
          font-weight: 900;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          white-space: nowrap;
        }

        .slateDropdownBody {
          padding: 14px;
        }

        .slateDropdownBody .slateCard {
          margin: 0;
          box-shadow: none;
        }

        .marketPanelGrid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 11px;
          margin: 15px 0;
        }

        .marketPanel {
          border-radius: 17px;
          border: 1px solid rgba(105, 140, 184, 0.14);
          background: rgba(7, 14, 27, 0.62);
          padding: 12px;
        }

        .marketPanel.green {
          border-color: rgba(43, 216, 117, 0.2);
          background: linear-gradient(145deg, rgba(8, 33, 39, 0.54), rgba(7, 14, 27, 0.7));
        }

        .marketPanelTop {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 10px;
        }

        .marketPanelTitle {
          color: #f4f8fd;
          font-size: 12px;
          font-weight: 900;
        }

        .marketMetrics {
          grid-template-columns: repeat(auto-fit, minmax(92px, 1fr));
        }

        .pitcherGrid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 11px;
        }

        .pitcherBox {
          border-radius: 19px;
          border: 1px solid rgba(105, 140, 184, 0.14);
          background: rgba(4, 10, 20, 0.52);
          padding: 13px;
        }

        .pitcherBox.green {
          border-color: rgba(43, 216, 117, 0.2);
          background: linear-gradient(145deg, rgba(7, 31, 38, 0.48), rgba(4, 10, 20, 0.6));
        }

        .pitcherBox .headshotFrame {
          width: 62px;
          height: 62px;
          border-radius: 18px;
        }

        .pitcherBox .headshot,
        .pitcherBox .headshotFallback {
          border-radius: 16px;
        }

        .pitcherBox .headshotFallback::after {
          border-radius: 16px;
        }

        .pitcherLabel {
          color: rgba(134, 158, 189, 0.76);
          font-size: 9px;
          font-weight: 900;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .pitcherNameSmall {
          margin-top: 3px;
          color: #f7fbff;
          font-size: 14px;
          line-height: 1.15;
          font-weight: 900;
          text-transform: uppercase;
        }

        .pitcherMetrics {
          margin-top: 12px;
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }

        .rolePill {
          display: inline-flex;
          margin-top: 5px;
          border-radius: 999px;
          padding: 4px 7px;
          color: #c8e7ff;
          background: rgba(37, 105, 210, 0.15);
          border: 1px solid rgba(71, 158, 248, 0.2);
          font-size: 9px;
          font-weight: 900;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }

        .chip {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          padding: 5px 8px;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          white-space: nowrap;
        }

        .chip.green {
          color: #bdf5d2;
          background: rgba(21, 124, 67, 0.17);
          border: 1px solid rgba(43, 216, 117, 0.24);
        }

        .chip.yellow,
        .chip.even {
          color: #ffe4a0;
          background: rgba(125, 83, 12, 0.2);
          border: 1px solid rgba(247, 200, 92, 0.24);
        }

        .chip.red {
          color: #ffc2c9;
          background: rgba(130, 34, 50, 0.2);
          border: 1px solid rgba(255, 105, 120, 0.22);
        }

        .qualifiedGrid {
          margin-bottom: 24px;
        }

        .trendRecordsHead {
          margin-top: 28px;
        }

        .trendTierRecordsCard {
          margin-bottom: 28px;
        }

        .trendRecordFilters {
          grid-template-columns: repeat(2, minmax(0, 220px));
          justify-content: start;
        }

        .trendTierRecordsGrid {
          margin: 16px 0 10px;
        }

        .trendRecordsNote {
          color: rgba(166, 188, 216, 0.75);
          font-size: 11px;
          line-height: 1.5;
        }

        .trendRecordAudit {
          margin-top: 12px;
          border-top: 1px solid rgba(67, 154, 255, 0.14);
          padding-top: 10px;
        }

        .trendRecordAudit summary {
          cursor: pointer;
          color: rgba(198, 220, 247, 0.9);
          font-size: 12px;
          font-weight: 700;
        }

        .trendRecordAuditRows {
          display: grid;
          gap: 6px;
          margin-top: 10px;
        }

        .trendRecordAuditRow {
          display: grid;
          grid-template-columns: 88px minmax(170px, 1.4fr) minmax(120px, 1fr) 110px 28px;
          gap: 10px;
          align-items: center;
          padding: 8px 10px;
          border: 1px solid rgba(67, 154, 255, 0.12);
          border-radius: 10px;
          color: rgba(210, 226, 246, 0.82);
          font-size: 11px;
        }

        .trendRecordAuditRow.resultW b { color: #62d394; }
        .trendRecordAuditRow.resultL b { color: #ff7c8b; }
        .trendRecordAuditRow.resultP b { color: #f6c85f; }

        @media (max-width: 720px) {
          .trendRecordAuditRow {
            grid-template-columns: 1fr auto;
          }

          .trendRecordAuditRow span:nth-child(1),
          .trendRecordAuditRow span:nth-child(4) {
            display: none;
          }
        }

        .dkSignalsHead {
          margin-top: 28px;
        }

        .dkRecordsCard {
          margin-top: 14px;
          padding: 16px;
          border: 1px solid rgba(67, 154, 255, 0.2);
          border-radius: 20px;
          background: linear-gradient(145deg, rgba(8, 17, 31, 0.95), rgba(5, 10, 20, 0.92));
          box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
        }

        .dkRecordFilters {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 10px;
          margin-bottom: 14px;
        }

        .dkRecordFilters label {
          display: grid;
          gap: 6px;
        }

        .dkRecordFilters label > span {
          color: rgba(154, 181, 215, 0.78);
          font-size: 9px;
          font-weight: 900;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .dkRecordFilters select {
          width: 100%;
          min-width: 0;
          border: 1px solid rgba(78, 155, 249, 0.23);
          border-radius: 11px;
          background: rgba(6, 14, 27, 0.96);
          color: #eef7ff;
          padding: 10px 11px;
          font: inherit;
          font-size: 11px;
          font-weight: 800;
          outline: none;
        }

        .dkRecordFilters select:focus {
          border-color: rgba(62, 172, 255, 0.58);
          box-shadow: 0 0 0 3px rgba(46, 133, 255, 0.1);
        }

        .dkSignalTable {
          min-width: 790px;
        }

        .signalName {
          display: inline-flex;
          align-items: center;
          border-radius: 999px;
          padding: 6px 9px;
          font-size: 10px;
          font-weight: 900;
          white-space: nowrap;
        }

        .signalName.negative {
          color: #ffc4c4;
          border: 1px solid rgba(255, 83, 83, 0.28);
          background: rgba(133, 24, 34, 0.2);
        }

        .signalName.caution {
          color: #ffe1a3;
          border: 1px solid rgba(242, 178, 70, 0.3);
          background: rgba(112, 72, 10, 0.2);
        }

        .signalName.positive {
          color: #a9f2c6;
          border: 1px solid rgba(43, 216, 117, 0.26);
          background: rgba(20, 106, 61, 0.18);
        }

        .signalName.neutral {
          color: #c9ddf5;
          border: 1px solid rgba(99, 145, 201, 0.24);
          background: rgba(33, 67, 108, 0.18);
        }

        .metricPositive {
          color: #82ecb0;
          font-weight: 900;
        }

        .metricNegative {
          color: #ff9e9e;
          font-weight: 900;
        }

        .sampleChip {
          display: inline-flex;
          border-radius: 999px;
          padding: 5px 8px;
          color: #d8eaff;
          border: 1px solid rgba(91, 151, 221, 0.22);
          background: rgba(42, 88, 145, 0.14);
          font-size: 9px;
          font-weight: 850;
          white-space: nowrap;
        }

        .sampleChip.sampleMeaningful {
          color: #a9f2c6;
          border-color: rgba(43, 216, 117, 0.24);
          background: rgba(20, 106, 61, 0.16);
        }

        .insideSignalRecords {
          margin: 4px 0 0;
        }

        .recordsDropdownStack {
          display: grid;
          gap: 12px;
          margin-top: 16px;
        }

        .recordsDropdown {
          overflow: hidden;
          border: 1px solid rgba(74, 150, 242, 0.19);
          border-radius: 19px;
          background: linear-gradient(145deg, rgba(9, 16, 30, 0.92), rgba(5, 10, 20, 0.9));
          box-shadow: 0 16px 42px rgba(0, 0, 0, 0.28);
        }

        .recordsSummary {
          cursor: pointer;
          list-style: none;
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          align-items: center;
          gap: 13px;
          padding: 17px 18px;
          text-align: left;
          user-select: none;
          transition: background 0.18s ease, border-color 0.18s ease;
        }

        .recordsSummary:hover {
          background: rgba(47, 140, 255, 0.055);
        }

        .recordsDropdown[open] .recordsSummary {
          border-bottom: 1px solid rgba(81, 148, 232, 0.13);
          background: linear-gradient(90deg, rgba(29, 104, 207, 0.1), rgba(8, 17, 31, 0.08));
        }

        .recordsSummary > div {
          min-width: 0;
        }

        .recordsSummary::-webkit-details-marker {
          display: none;
        }

        .recordsSummary::before {
          content: "›";
          color: #75baff;
          font-size: 22px;
          line-height: 1;
          transition: transform 0.18s ease;
        }

        .recordsDropdown[open] .recordsSummary::before {
          transform: rotate(90deg);
        }

        .recordsSummaryTitle {
          color: #f7fbff;
          font-size: 15px;
          font-weight: 920;
        }

        .recordsSummarySub {
          margin-top: 4px;
          color: rgba(151, 175, 205, 0.76);
          font-size: 12px;
          line-height: 1.35;
        }

        .recordsCount {
          margin-left: 0;
          border: 1px solid rgba(76, 163, 255, 0.24);
          background: rgba(32, 105, 210, 0.13);
          color: #d9edff;
          border-radius: 999px;
          padding: 6px 9px;
          font-size: 10px;
          font-weight: 850;
          white-space: nowrap;
        }

        .recordsDropdown .tableWrap {
          margin: 0 14px 14px;
        }

        .insideDropdown {
          margin: 0 14px 14px;
        }

        .tableWrap {
          overflow-x: auto;
          border: 1px solid rgba(105, 139, 183, 0.13);
          border-radius: 15px;
          background: rgba(3, 8, 17, 0.42);
          -webkit-overflow-scrolling: touch;
        }

        table {
          width: 100%;
          min-width: 650px;
          border-collapse: collapse;
          font-size: 12px;
          font-variant-numeric: tabular-nums;
        }

        th,
        td {
          padding: 11px 12px;
          border-bottom: 1px solid rgba(102, 136, 181, 0.1);
          text-align: left;
          white-space: nowrap;
        }

        th {
          color: rgba(132, 159, 194, 0.86);
          background: rgba(10, 20, 36, 0.8);
          font-size: 9px;
          font-weight: 950;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        td {
          color: rgba(221, 232, 246, 0.88);
          font-weight: 700;
        }

        tbody tr:last-child td {
          border-bottom: 0;
        }

        tbody tr:hover td {
          background: rgba(47, 140, 255, 0.045);
        }

        .sportDevelopmentCard {
          position: relative;
          overflow: hidden;
          display: grid;
          gap: 12px;
          border: 1px solid rgba(72, 156, 255, 0.22);
          border-radius: 24px;
          padding: clamp(21px, 4vw, 32px);
          background:
            radial-gradient(circle at 92% 0%, rgba(28, 151, 255, 0.17), transparent 34%),
            linear-gradient(145deg, rgba(9, 18, 34, 0.96), rgba(4, 9, 19, 0.96));
          box-shadow: 0 18px 48px rgba(0, 0, 0, 0.3);
        }

        .sportDevelopmentCard::after {
          content: "";
          position: absolute;
          inset: auto -45px -70px auto;
          width: 190px;
          height: 190px;
          border-radius: 50%;
          border: 1px solid rgba(58, 163, 255, 0.13);
          box-shadow:
            0 0 0 24px rgba(58, 163, 255, 0.035),
            0 0 0 49px rgba(58, 163, 255, 0.022);
          pointer-events: none;
        }

        .developmentEyebrow {
          position: relative;
          z-index: 1;
          width: fit-content;
          border: 1px solid rgba(61, 173, 255, 0.3);
          border-radius: 999px;
          padding: 6px 9px;
          color: #9bd7ff;
          background: rgba(23, 110, 211, 0.13);
          font-size: 9px;
          font-weight: 950;
          letter-spacing: 0.1em;
        }

        .sportDevelopmentCard h3 {
          position: relative;
          z-index: 1;
          max-width: 700px;
          margin: 0;
          color: #f5faff;
          font-size: clamp(20px, 4vw, 30px);
          line-height: 1.12;
        }

        .sportDevelopmentCard p {
          position: relative;
          z-index: 1;
          max-width: 760px;
          margin: 0;
          color: rgba(177, 199, 225, 0.82);
          font-size: 13px;
          line-height: 1.65;
        }

        .developmentStatusRow {
          position: relative;
          z-index: 1;
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 8px 16px;
          width: min(100%, 650px);
          margin-top: 4px;
          border-top: 1px solid rgba(91, 137, 190, 0.15);
          padding-top: 13px;
          color: rgba(145, 171, 204, 0.78);
          font-size: 11px;
        }

        .developmentStatusRow strong {
          color: #d9efff;
          font-size: 11px;
        }

        .siteFooter {
          display: grid;
          gap: 8px;
          margin-top: 34px;
          padding: 20px 4px 0;
          border-top: 1px solid rgba(104, 139, 184, 0.13);
          color: rgba(134, 157, 188, 0.72);
          font-size: 11px;
          line-height: 1.5;
        }

        .siteFooter div {
          display: flex;
          flex-wrap: wrap;
          gap: 8px 14px;
        }

        .siteFooter strong {
          color: #f4f9ff;
        }

        .siteFooter p {
          margin: 0;
        }

        .empty,
        .error {
          border: 1px dashed rgba(83, 148, 231, 0.24);
          border-radius: 19px;
          padding: 24px;
          color: rgba(174, 195, 222, 0.82);
          background: rgba(6, 12, 23, 0.65);
          font-size: 13px;
          line-height: 1.5;
        }

        .error {
          display: grid;
          gap: 10px;
          justify-items: start;
        }

        .loadingGrid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(min(100%, 350px), 1fr));
          gap: 17px;
        }

        .loadingCard {
          border: 1px solid rgba(95, 135, 184, 0.13);
          border-radius: 24px;
          padding: 18px;
          background: linear-gradient(145deg, rgba(9, 16, 30, 0.94), rgba(5, 10, 19, 0.94));
        }

        .loadingLine,
        .loadingAvatar,
        .loadingMetric {
          background: linear-gradient(105deg, rgba(24, 42, 67, 0.75) 25%, rgba(50, 79, 115, 0.7) 45%, rgba(24, 42, 67, 0.75) 65%);
          background-size: 220% 100%;
          animation: shimmer 1.55s linear infinite;
        }

        .loadingLine {
          height: 11px;
          border-radius: 999px;
        }

        .loadingLine.short {
          width: 34%;
        }

        .loadingLine.medium {
          width: 62%;
          margin-top: 10px;
        }

        .loadingPlayer {
          display: flex;
          align-items: center;
          gap: 13px;
          margin: 23px 0;
        }

        .loadingAvatar {
          flex: 0 0 auto;
          width: 76px;
          height: 76px;
          border-radius: 22px;
        }

        .loadingTextStack {
          flex: 1;
        }

        .loadingMetricGrid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 9px;
        }

        .loadingMetric {
          height: 58px;
          border-radius: 15px;
        }

        .fade-in {
          animation: cardIn 0.42s ease both;
        }

        @keyframes cardIn {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes shimmer {
          from {
            background-position: 180% 0;
          }
          to {
            background-position: -40% 0;
          }
        }

        @keyframes statusPulse {
          0%,
          100% {
            opacity: 0.75;
          }
          50% {
            opacity: 1;
          }
        }

        @media (max-width: 900px) {
          .playsBoard {
            grid-template-columns: 1fr;
          }

          .tileGrid,
          .qualifiedGrid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 700px) {
          .dkRecordFilters {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          body::before {
            background-size: 34px 34px;
          }

          .shell {
            padding: 10px 9px 36px;
          }

          .hero {
            border-radius: 23px;
            padding: 18px 16px 16px;
          }

          .heroTopline {
            margin-bottom: 14px;
          }

          .heroBrand {
            grid-template-columns: 1fr;
            gap: 12px;
          }

          .logoWrap {
            justify-self: start;
            width: 132px;
            min-height: 64px;
          }

          .logo {
            width: 130px;
          }

          .heroCopy h1 {
            font-size: 27px;
          }

          .heroSub {
            font-size: 12px;
          }

          .heroStatusRow {
            align-items: flex-start;
            gap: 8px 11px;
          }

          .refreshBtn {
            width: 100%;
            margin: 4px 0 0;
          }

          .tileGrid,
          .qualifiedGrid {
            grid-auto-flow: column;
            grid-auto-columns: minmax(225px, 76vw);
            grid-template-columns: none;
            overflow-x: auto;
            gap: 10px;
            margin-left: -9px;
            margin-right: -9px;
            padding: 0 9px 7px;
            scroll-snap-type: x mandatory;
            scrollbar-width: none;
          }

          .tileGrid::-webkit-scrollbar,
          .qualifiedGrid::-webkit-scrollbar {
            display: none;
          }

          .tile {
            scroll-snap-align: start;
          }

          .tabs {
            top: 7px;
            margin: 11px 0 23px;
          }

          .tabBtn {
            min-height: 44px;
            padding: 8px 5px;
            font-size: 10px;
            line-height: 1.12;
            white-space: normal;
          }

          .sectionHead {
            align-items: flex-start;
            margin-bottom: 14px;
          }

          .sectionHead h2 {
            font-size: 24px;
          }

          .countPill {
            margin-top: 2px;
          }

          .cards,
          .loadingGrid {
            grid-template-columns: 1fr;
            gap: 13px;
          }

          .trendGameHeader {
            gap: 9px;
          }

          .trendGameRankBox {
            min-width: 64px;
            padding: 7px 8px;
          }

          .trendGameLeader {
            padding: 11px;
          }

          .trendGameLeader > div:first-child > strong {
            font-size: 17px;
          }

          .trendSelectionSummary {
            grid-template-columns: auto minmax(0, 1fr) auto;
            gap: 8px;
            padding: 9px;
          }

          .trendSelectionRank {
            width: 30px;
            height: 30px;
          }

          .trendSelectionIdentity strong {
            font-size: 13px;
          }

          .trendSelectionMarket {
            min-width: 66px;
          }

          .trendSelectionMarket small {
            max-width: 70px;
            text-align: right;
          }

          .trendSelectionMarket strong {
            font-size: 21px;
          }

          .trendSelectionChevron {
            display: none;
          }

          .trendSelectionMetrics {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .trendRecordGrid {
            grid-template-columns: 1fr;
          }

          .card {
            border-radius: 22px;
            padding: 16px;
          }

          .card:hover {
            transform: none;
          }

          .scorePill {
            gap: 4px;
            padding: 7px 9px;
          }

          .scorePillSub {
            display: none;
          }

          .handpickedPill {
            width: fit-content;
          }

          .handpickedPillRow {
            margin-top: -4px;
          }

          .teamName {
            font-size: 11px;
          }

          .teamLogo {
            width: 28px;
            height: 28px;
          }

          .headshotFrame {
            width: 74px;
            height: 74px;
          }

          .teamPickFrame {
            width: 70px;
            height: 70px;
            border-radius: 20px;
          }

          .playName {
            font-size: 19px;
          }

          .projection {
            font-size: 38px;
          }

          .bubbleGrid.three,
          .pitcherMetrics {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .marketPanelGrid,
          .pitcherGrid {
            grid-template-columns: 1fr;
          }

          .slateCardHeader {
            align-items: flex-start;
          }

          .slateGreenCallout,
          .slatePassCallout {
            max-width: 118px;
            white-space: normal;
            text-align: center;
          }

          .recordsSummary {
            grid-template-columns: auto minmax(0, 1fr);
            gap: 11px;
            padding: 15px 14px;
          }

          .recordsCount {
            display: none;
          }
        }

        @media (max-width: 420px) {
          .heroLive {
            display: none;
          }

          .sportTabs {
            width: 100%;
          }

          .sportTabBtn {
            flex: 1;
            min-width: 0;
            padding: 9px 4px;
            font-size: 10px;
            letter-spacing: 0.03em;
          }

          .bubbleGrid,
          .bubbleGrid.three,
          .pitcherMetrics {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .miniBubble {
            padding: 10px;
          }

          .miniValue {
            font-size: 13px;
          }

          .liveSplitRow {
            grid-template-columns: minmax(92px, 1.35fr) repeat(3, minmax(42px, 0.65fr));
            gap: 5px;
            padding: 8px;
            font-size: 10px;
          }

          .teamRow {
            padding: 9px;
          }

          .teamLogo {
            width: 25px;
            height: 25px;
          }

          .teamName {
            font-size: 10px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          *,
          *::before,
          *::after {
            scroll-behavior: auto !important;
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.01ms !important;
          }
        }
      `}</style>
    </main>
  );
}
