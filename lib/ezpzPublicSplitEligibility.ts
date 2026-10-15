import { footballCatalog } from "./footballTrendCatalog";
import { NCAAF_EZPZ_POLICY_VERSION } from "./ncaafEzpzPolicy";
import { NFL_EZPZ_POLICY_VERSION } from "./nflEzpzPolicy";

type PublicSplitPick = {
  source?: unknown;
  market?: unknown;
  tier?: unknown;
  qualification?: unknown;
  playerName?: unknown;
  propMarket?: unknown;
  selectorVersion?: unknown;
  trendSubtypeId?: unknown;
};

function isCatalogSelection(pick: PublicSplitPick, market: string) {
  const sport = pick.selectorVersion === NCAAF_EZPZ_POLICY_VERSION ? "NCAAF"
    : pick.selectorVersion === NFL_EZPZ_POLICY_VERSION ? "NFL" : "";
  if (!sport) return false;
  const catalog = footballCatalog(sport);
  const subtype = String(pick.trendSubtypeId || "").split("|");
  const parts = subtype[0].split(":");
  const [prefix, version, ruleId, direction, filters] = parts;
  const categories = market === "total" ? ["over", "under"]
    : ["favorite spread", "underdog spread", "pick em spread"];
  return subtype.length === 2 && categories.includes(subtype[1])
    && parts.length === 5 && prefix === "catalog" && version === catalog.version
    && (direction === "0" || direction === "1")
    && catalog.rules.some(rule => rule.id === ruleId && rule.market.toLowerCase() === market)
    && (!filters || filters.split(",").every(id => catalog.filters.some(filter => filter.id === id)));
}

// Accept combined signals and legacy Best + Trend rows only when they carry
// an actual public-split qualification. Current catalog picks already passed
// the backend's Wilson selector; their names must not face a retired whitelist.
// A model grade alone never qualifies.
export function isPublicSplitEzpzPick(pick: PublicSplitPick): boolean {
  const source = String(pick.source || "").trim().toLowerCase();
  const market = String(pick.market || "").trim().toLowerCase();
  return (source === "trend play" || source === "best + trend")
    && (market === "spread" || market === "total")
    && !pick.playerName
    && !pick.propMarket
    && (isCatalogSelection(pick, market)
      || /\b(?:RLM|Public\s+Fade|Sharp|Market\s+Move|Money\s+Momentum|Total\s+Drop\s+Fade|Spread\s+Ticket\s+Momentum)\b/i.test(`${pick.tier || ""} ${pick.qualification || ""}`));
}

