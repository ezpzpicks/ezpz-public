import { NFL_EZPZ_POLICY_VERSION, NFL_WILSON_EFFECTIVE_AT } from "./nflEzpzPolicy";
import { buildNflTrendSubtypes, nflTrendSignals } from "./nflPublicTrendLeaderboard";
import { nflTrendGameIdentity } from "./nflTrendIdentity";
import { buildNflConsolidatedLeaderboard } from "./nflConsolidatedTrends";
import { NFL_CONSOLIDATED_EFFECTIVE_AT } from "./catalog/nflConsolidatedCatalog";
import {
  buildNcaafEzpzLeaderboard, isFootballWilsonArchivedPick, selectNcaafWilsonEzpzPicks,
  type FootballWilsonPolicy,
} from "./ncaafEzpzWilson";

export { ncaafWilsonLowerBound as nflWilsonLowerBound, rankNcaafEzpzSubtypes as rankNflEzpzSubtypes,
  NCAAF_WILSON_Z as NFL_WILSON_Z, NCAAF_EZPZ_SUBTYPE_LIMIT as NFL_EZPZ_SUBTYPE_LIMIT } from "./ncaafEzpzWilson";

const policy: FootballWilsonPolicy = {
  version: NFL_EZPZ_POLICY_VERSION, effectiveAt: NFL_WILSON_EFFECTIVE_AT,
  buildSubtypes: buildNflTrendSubtypes, signalsFor: nflTrendSignals, gameIdentity: nflTrendGameIdentity,
};

export function buildNflEzpzLeaderboard(rows: Record<string, string>[], asOf = Date.now(), excludeGame?: Record<string, any>) {
  if (asOf >= Date.parse(NFL_CONSOLIDATED_EFFECTIVE_AT)) return buildNflConsolidatedLeaderboard(rows, asOf, excludeGame);
  return buildNcaafEzpzLeaderboard(rows, asOf, excludeGame, policy);
}

export function isNflWilsonArchivedPick(pick: Record<string, any>) {
  return isFootballWilsonArchivedPick(pick, policy.version, policy.effectiveAt);
}

export function selectNflWilsonEzpzPicks(
  plays: Record<string, any>[], rows: Record<string, string>[], today: string,
  now = Date.now(), archived: Record<string, any>[] = [],
) {
  return selectNcaafWilsonEzpzPicks(plays, rows, today, now, archived, policy);
}
