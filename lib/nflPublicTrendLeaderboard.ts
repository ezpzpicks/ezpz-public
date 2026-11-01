import {
  buildNcaafTrendSubtypes, ncaafTrendCategory, ncaafTrendSignals, rankNcaafPublicTrendSubtypes,
  type NcaafPublicTrendSubtype,
} from "./ncaafPublicTrendLeaderboard";
import { nflTrendGameIdentity, nflTrendTeamKey } from "./nflTrendIdentity";
import { buildNflConsolidatedLeaderboard, nflConsolidatedSignals, nflGroupCategoryMatches } from "./nflConsolidatedTrends";

type TrendSide = Record<string, unknown>;
type SheetRow = Record<string, string>;
export type NflPublicTrendSubtype = NcaafPublicTrendSubtype;
export const NFL_PUBLIC_TREND_LIMIT = 20;

// NFL memberships come exclusively from the new catalog, with canonical team
// names so split aliases resolve to the same spread selection.
export function nflTrendSignals(play: TrendSide, siblings: TrendSide[]): string[] {
  const canonical = (side: TrendSide) => String(side.market).toLowerCase() === "spread"
    ? { ...side, selection: nflTrendTeamKey(side.selectionTeam || side.selection),
      selectionTeam: nflTrendTeamKey(side.selectionTeam || side.selection) } : side;
  return ncaafTrendSignals(canonical(play), siblings.map(canonical), "NFL");
}

export function buildNflTrendSubtypes(rows: SheetRow[]): NflPublicTrendSubtype[] {
  return buildNcaafTrendSubtypes(rows, { signalsFor: nflTrendSignals, gameIdentity: nflTrendGameIdentity, sport: "NFL" });
}

export function buildNflPublicTrendLeaderboard(rows: SheetRow[]) {
  return buildNflConsolidatedLeaderboard(rows);
}

export function visibleNflTrendBadges(play: TrendSide, siblings: TrendSide[], leaderboard: readonly NflPublicTrendSubtype[]) {
  const category = ncaafTrendCategory(play);
  const grouped = leaderboard.some(type => type.signal.startsWith("nfl-group:"));
  const signals = new Set(grouped ? nflConsolidatedSignals(play, siblings) : nflTrendSignals(play, siblings));
  return leaderboard.slice(0, NFL_PUBLIC_TREND_LIMIT)
    .filter(subtype => subtype.totals.wins * 5 > (subtype.totals.wins + subtype.totals.losses) * 3
      && (grouped ? nflGroupCategoryMatches(subtype.category, play) : subtype.category === category) && signals.has(subtype.signal));
}
