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
};

type SheetRow = Record<string, string>;

type ApiData = {
  ok: boolean;
  error?: string;
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
  recordSummary: Summary[];
  last7RecordSummary: Summary[];
  handpickedRecordSummary?: Summary[];
  handpickedLast7RecordSummary?: Summary[];
};

type Sport = "MLB" | "NFL" | "NCAAF" | "NCAAM";
type Tab = "Today’s Best Plays" | "Full Slate" | "Records";

type SportMeta = {
  name: string;
  shortName: string;
  status: string;
  description: string;
};

const SPORTS: Sport[] = ["MLB", "NFL", "NCAAF", "NCAAM"];
const TABS: Tab[] = ["Today’s Best Plays", "Full Slate", "Records"];

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

function getFormInfo(summary: Summary | null) {
  if (!summary || summary.totalBets < 2) {
    return {
      label: "Neutral",
      icon: "➖",
      className: "neutral",
      detail: "small 7-day sample",
    };
  }

  if (summary.wins > summary.losses && summary.winPct >= 58) {
    return {
      label: "Hot",
      icon: "🔥",
      className: "hot",
      detail: `${summary.wins}-${summary.losses}-${summary.pushes} last 7`,
    };
  }

  if (summary.winPct < 45) {
    return {
      label: "Cold",
      icon: "❄️",
      className: "cold",
      detail: `${summary.wins}-${summary.losses}-${summary.pushes} last 7`,
    };
  }

  return {
    label: "Neutral",
    icon: "➖",
    className: "neutral",
    detail: `${summary.wins}-${summary.losses}-${summary.pushes} last 7`,
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

function FormTag({ summary }: { summary: Summary | null }) {
  const form = getFormInfo(summary);

  return (
    <div className={`formPill ${form.className}`} title="Record context only; this does not change the current model score.">
      {form.icon} 7-day market form: {form.label}{" "}
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

function BadgeRow({
  play,
  recentSummary,
}: {
  play: Play;
  recentSummary: Summary | null;
}) {
  const form = getFormInfo(recentSummary);
  const showHot = form.className === "hot";
  const showCold = form.className === "cold";
  const showAlt = hasAltBadge(play);

  if (!showHot && !showCold && !showAlt) return null;

  return (
    <div className="badges">
      {showHot ? <span className="badge hot">🔥 Market Hot</span> : null}
      {showCold ? <span className="badge cold">❄️ Market Cold</span> : null}
      {showAlt ? <span className="badge alt">⭐ ALT</span> : null}
    </div>
  );
}

function BestPlayCard({
  play,
  index,
  recentSummary,
  slateRows,
  handpicked = false,
}: {
  play: Play;
  index: number;
  recentSummary: Summary | null;
  slateRows: SheetRow[];
  handpicked?: boolean;
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

      {handpicked && favoriteTag ? (
        <div className="favoriteTag">{favoriteTag}</div>
      ) : null}
      {handpicked && favoriteNotes ? (
        <div className="favoriteNotes">{favoriteNotes}</div>
      ) : null}

      <BadgeRow play={play} recentSummary={recentSummary} />
      <div className="formRow">
        <FormTag summary={recentSummary} />
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

function SlateCard({ row }: { row: SheetRow }) {
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
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [activeSport, setActiveSport] = useState<Sport>("MLB");
  const [active, setActive] = useState<Tab>("Today’s Best Plays");

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const res = await fetch("/api/public-data", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Failed to load EZPZ data");
      }
      setData(json);
      setError("");
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

    if (active === "Today’s Best Plays") {
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

      return (
        <>
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
                    slateRows={data.slateToday}
                    handpicked={Boolean(favoriteRow)}
                  />
                );
              })}
            </div>
          ) : (
            <div className="empty">
              No qualified Best Plays saved yet for {data.today}.
            </div>
          )}
        </>
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
            </div>
          </div>

          {data.slateToday.length ? (
            <div className="cards">
              {data.slateToday.map((row, index) => (
                <SlateCard key={`${row["Game ID"]}-${index}`} row={row} />
              ))}
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
          .tileGrid,
          .qualifiedGrid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 700px) {
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
            padding: 10px 8px;
            font-size: 11px;
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
