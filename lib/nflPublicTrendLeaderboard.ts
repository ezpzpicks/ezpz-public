import { finiteNcaafNumber } from "./ncaafEzpzPolicy";
import {
  buildNcaafTrendSubtypes, ncaafTrendCategory, ncaafTrendSignals, rankNcaafPublicTrendSubtypes,
  type NcaafPublicTrendSubtype,
} from "./ncaafPublicTrendLeaderboard";
import { nflTrendGameIdentity, nflTrendTeamKey } from "./nflTrendIdentity";

type TrendSide = Record<string, unknown>;
type SheetRow = Record<string, string>;
export type NflPublicTrendSubtype = NcaafPublicTrendSubtype;
export const NFL_PUBLIC_TREND_LIMIT = 20;

// Football shares the NCAAF predicates. Keep the NFL's additional movement
// cohorts tracked independently of both public visibility and pick eligibility.
export function nflTrendSignals(play: TrendSide, siblings: TrendSide[]): string[] {
  const canonical = (side: TrendSide) => String(side.market).toLowerCase() === "spread"
    ? { ...side, selection: nflTrendTeamKey(side.selectionTeam || side.selection),
      selectionTeam: nflTrendTeamKey(side.selectionTeam || side.selection) } : side;
  const labels = ncaafTrendSignals(canonical(play), siblings.map(canonical));
  if (!ncaafTrendCategory(play)) return labels;
  const market = String(play.market).toLowerCase();
  const lineMove = finiteNcaafNumber(play.lineMovementValue);
  const basis = String(play.lineMovementBasis || "");
  const opening = finiteNcaafNumber(play.openingMoneyPct);
  const money = finiteNcaafNumber(play.moneyPct);
  const first = Date.parse(String(play.openingSnapshotTime || play.firstTrackedAt || ""));
  const last = Date.parse(String(play.frozenAt || play.updatedAt || play.snapshotTime || ""));
  const mature = Number.isFinite(first) && Number.isFinite(last) && last - first >= 60 * 60_000;
  const matchingLine = market === "spread" ? basis.includes("Spread") : basis.includes("Total Line");
  const marketMove = mature && market === "total" && matchingLine && lineMove != null && lineMove >= 1;
  const moneyMomentum = mature && matchingLine && lineMove != null && lineMove >= 0.5
    && opening != null && opening > 0 && opening < 100 && money != null && money - opening >= 10;
  if (marketMove) labels.push("Market Move");
  if (moneyMomentum) labels.push(market === "spread" ? "Spread Money Momentum" : "Total Money Momentum");
  if (marketMove && moneyMomentum) labels.push("Market Move + Total Money Momentum");
  return labels;
}

export function buildNflTrendSubtypes(rows: SheetRow[]): NflPublicTrendSubtype[] {
  return buildNcaafTrendSubtypes(rows, { signalsFor: nflTrendSignals, gameIdentity: nflTrendGameIdentity });
}

export function buildNflPublicTrendLeaderboard(rows: SheetRow[]) {
  return rankNcaafPublicTrendSubtypes(buildNflTrendSubtypes(rows));
}

export function visibleNflTrendBadges(play: TrendSide, siblings: TrendSide[], leaderboard: readonly NflPublicTrendSubtype[]) {
  const category = ncaafTrendCategory(play);
  const signals = new Set(nflTrendSignals(play, siblings));
  return leaderboard.slice(0, NFL_PUBLIC_TREND_LIMIT)
    .filter(subtype => subtype.category === category && signals.has(subtype.signal));
}
