import { catalogSide, catalogSelectionIdentity, catalogEvaluationFor, catalogSignals, catalogSignalLabel, catalogEventKey, evaluateFootballCatalogGroup } from "./footballTrendCatalog";
import { finiteNcaafNumber } from "./ncaafEzpzPolicy";
import { isVerifiedNcaafTrendRecord } from "./ncaafTrendRecordPolicy";

export const NCAAF_PUBLIC_TREND_LIMIT = 20;

type SheetRow = Record<string, string>;
type TrendSide = Record<string, unknown>;
export type NcaafTrendCategory = "Favorite Spread" | "Underdog Spread" | "Pick'em Spread" | "Over" | "Under";
export type NcaafTrendTotals = {
  record: string;
  totalBets: number;
  wins: number;
  losses: number;
  pushes: number;
  winPct: number;
  unitsWon: number;
  roiPct: number;
  netUnits?: number;
};
export type NcaafPublicTrendSubtype = {
  id: string;
  signal: string;
  category: NcaafTrendCategory;
  label: string;
  totals: NcaafTrendTotals;
  lastSevenTotals?: NcaafTrendTotals;
};

function textKey(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function ncaafTrendSubtypeId(signal: string, category: NcaafTrendCategory) {
  return `${signal.startsWith("catalog:") ? signal : textKey(signal)}|${textKey(category)}`;
}

export function ncaafTrendCategory(play: TrendSide): NcaafTrendCategory | null {
  const market = textKey(play.market);
  if (market === "total") {
    const side = textKey(play.side || play.selection);
    return side.startsWith("over") ? "Over" : side.startsWith("under") ? "Under" : null;
  }
  if (market !== "spread") return null;
  const line = finiteNcaafNumber(play.line);
  if (line == null) return null;
  return line < 0 ? "Favorite Spread" : line > 0 ? "Underdog Spread" : "Pick'em Spread";
}

// These are memberships, not pick eligibility. Hidden and losing signals keep
// their records; presentation filters only after all memberships are graded.
export function ncaafTrendSignals(play: TrendSide, siblings: TrendSide[], sport = "NCAAF"): string[] {
  if (!ncaafTrendCategory(play)) return [];
  return catalogSignals(catalogEvaluationFor(play, siblings, sport), sport);
}

function recordSide(row: SheetRow): TrendSide { return catalogSide(row); }

function resultCode(row: SheetRow) {
  const result = String(row.Result || row.Status || "").toUpperCase().trim();
  return ["W", "WIN", "WON"].includes(result) ? "W"
    : ["L", "LOSS", "LOST"].includes(result) ? "L"
    : ["P", "PUSH"].includes(result) ? "P" : "";
}

function recordTotals(rows: SheetRow[]): NcaafTrendTotals {
  let wins = 0, losses = 0, pushes = 0, units = 0;
  for (const row of rows) {
    const result = resultCode(row);
    if (result === "W") {
      wins++;
      const supplied = finiteNcaafNumber(row["Public Split Odds"] || row.Odds);
      const odds = supplied != null && Math.abs(supplied) >= 100 ? supplied : -110;
      units += odds > 0 ? odds / 100 : 100 / Math.abs(odds);
    } else if (result === "L") { losses++; units--; }
    else if (result === "P") pushes++;
  }
  const decisions = wins + losses;
  const totalBets = decisions + pushes;
  return {
    record: `${wins}-${losses}-${pushes}`, totalBets, wins, losses, pushes,
    winPct: decisions ? Math.round(wins / decisions * 1000) / 10 : 0,
    unitsWon: Math.round(units * 100) / 100,
    roiPct: totalBets ? Math.round(units / totalBets * 1000) / 10 : 0,
    netUnits: units,
  };
}

// Rank exact fractions before rounding the displayed percentage. Push-only and
// ungraded types have no win percentage and cannot earn a public badge.
export function rankNcaafPublicTrendSubtypes(subtypes: NcaafPublicTrendSubtype[]) {
  return subtypes.filter(row => row.totals.wins * 5 > (row.totals.wins + row.totals.losses) * 3)
    .sort((a, b) => {
      const aDecisions = a.totals.wins + a.totals.losses;
      const bDecisions = b.totals.wins + b.totals.losses;
      return b.totals.wins / bDecisions - a.totals.wins / aDecisions
        || bDecisions - aDecisions || a.id.localeCompare(b.id);
    }).slice(0, NCAAF_PUBLIC_TREND_LIMIT);
}

// Build the full graded catalog before any presentation or EZPZ ranking cap.
export function buildNcaafTrendSubtypes(rows: SheetRow[], options: {
  signalsFor?: typeof ncaafTrendSignals;
  gameIdentity?: (row: Record<string, any>) => string;
  sport?: string;
} = {}): NcaafPublicTrendSubtype[] {
  const signalsFor = options.signalsFor || ncaafTrendSignals;
  const sport = options.sport || "NCAAF";
  const gameIdentity = options.gameIdentity || ((row: SheetRow) => catalogEventKey(row, sport));
  const groups = new Map<string, Map<string, SheetRow>>();
  for (const row of rows) {
    if (!isVerifiedNcaafTrendRecord(row) || !resultCode(row)) continue;
    const groupKey = gameIdentity(row);
    const group = groups.get(groupKey) || new Map<string, SheetRow>();
    const selection = `${textKey(row.Market)}|${catalogSelectionIdentity(row, sport)}`;
    if (!selection) continue;
    if (!group.has(selection)) group.set(selection, row);
    groups.set(groupKey, group);
  }
  const buckets = new Map<string, { signal: string; category: NcaafTrendCategory; rows: SheetRow[]; games: Set<string> }>();
  const sortKeys = new Map<SheetRow, { playedAt: number; settledAt: number }>();
  const sortKey = (row: SheetRow) => {
    let value = sortKeys.get(row);
    if (!value) {
      value = {
        playedAt: Date.parse(row["Game Time"] || row["Public Split Snapshot Time"] || "") || 0,
        settledAt: Date.parse(row["Result Updated"] || "") || 0,
      };
      sortKeys.set(row, value);
    }
    return value;
  };
  for (const group of groups.values()) {
    const uniqueRows = [...group.values()];
    const plays = uniqueRows.map(recordSide);
    const evaluations = plays.every(play => play.catalogEvaluation) ? [] : evaluateFootballCatalogGroup(plays, sport);
    plays.forEach((play, i) => { if (!play.catalogEvaluation) play.catalogEvaluation = evaluations[i]; });
    for (let i = 0; i < uniqueRows.length; i++) {
      const category = ncaafTrendCategory(plays[i]);
      if (!category) continue;
      for (const signal of signalsFor(plays[i], plays)) {
        const id = ncaafTrendSubtypeId(signal, category);
        const bucket = buckets.get(id) || { signal, category, rows: [], games: new Set<string>() };
        const row = uniqueRows[i];
        const game = gameIdentity(row);
        if (!bucket.games.has(game)) {
          bucket.rows.push(row);
          bucket.games.add(game);
        }
        buckets.set(id, bucket);
      }
    }
  }
  return [...buckets].map(([id, bucket]) => ({
    id, signal: bucket.signal, category: bucket.category,
    label: `${catalogSignalLabel(bucket.signal)} - ${bucket.category}`, totals: recordTotals(bucket.rows),
    lastSevenTotals: recordTotals([...bucket.rows].sort((a, b) =>
      sortKey(b).playedAt - sortKey(a).playedAt
      || sortKey(b).settledAt - sortKey(a).settledAt
      || String(a.Game).localeCompare(String(b.Game))).slice(0, 7)),
  }));
}

export function createNcaafSubtypeBuilder(): typeof buildNcaafTrendSubtypes {
  const entries: Array<{ rows: SheetRow[]; options: Parameters<typeof buildNcaafTrendSubtypes>[1]; result: NcaafPublicTrendSubtype[] }> = [];
  return (rows, options) => {
    const eligible = rows.filter(row => isVerifiedNcaafTrendRecord(row) && resultCode(row));
    const cached = entries.find(entry => entry.options?.signalsFor === options?.signalsFor
      && entry.options?.gameIdentity === options?.gameIdentity && entry.options?.sport === options?.sport
      && entry.rows.length === eligible.length && entry.rows.every((row, i) => row === eligible[i]));
    if (cached) return cached.result;
    const result = buildNcaafTrendSubtypes(eligible, options);
    entries.push({ rows: eligible, options, result });
    if (entries.length > 4) entries.shift();
    return result;
  };
}

export function buildNcaafPublicTrendLeaderboard(rows: SheetRow[], builder = buildNcaafTrendSubtypes): NcaafPublicTrendSubtype[] {
  return rankNcaafPublicTrendSubtypes(builder(rows));
}

export function visibleNcaafTrendBadges(
  play: TrendSide, siblings: TrendSide[], leaderboard: readonly NcaafPublicTrendSubtype[],
) {
  const category = ncaafTrendCategory(play);
  if (!category) return [];
  const signals = new Set(ncaafTrendSignals(play, siblings));
  return leaderboard.slice(0, NCAAF_PUBLIC_TREND_LIMIT)
    .filter(subtype => subtype.totals.wins * 5 > (subtype.totals.wins + subtype.totals.losses) * 3
      && subtype.category === category && signals.has(subtype.signal));
}
