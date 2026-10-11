// The new selector applies prospectively; earlier published cards keep their rules.
export const NFL_CORE_SELECTOR_EFFECTIVE_DATE = "2026-10-05";
export const NFL_EZPZ_POLICY_VERSION = "nfl-wilson-v1-top20";
export const NFL_WILSON_EFFECTIVE_AT = "2026-10-11T06:25:52Z";
export const NFL_EZPZ_RULE = "NFL EZPZ Picks: up to 20 tracked trend subtypes ranked by the one-sided 95% Wilson lower-bound score. Subtypes require an actual win rate above 60% and positive ROI, with no fixed minimum number of bets. One pick per game uses the highest-ranked qualifying subtype. Only verified final-snapshot results settled before the decision count; the supporting record and rank are saved when the pick locks. Odds must be -150 or better; missing spread/total odds default to -110.";

export const NFL_CORE_PICK_CLASSES = {
  combinedTotal: { tier: "Market Move + Total Money Momentum", priority: 1, score: 95, market: "Total" },
  spreadMomentum: { tier: "Spread Money Momentum", priority: 2, score: 90, market: "Spread" },
  marketMove: { tier: "Market Move", priority: 3, score: 85, market: "Total" },
} as const;

export function savedNflCoreClass(market: unknown, tier: unknown) {
  const normalize = (value: unknown) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  return Object.values(NFL_CORE_PICK_CLASSES).find((entry) =>
    normalize(entry.market) === normalize(market) && normalize(entry.tier) === normalize(tier),
  );
}

