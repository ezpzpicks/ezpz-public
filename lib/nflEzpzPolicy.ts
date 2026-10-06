// The new selector applies prospectively; earlier published cards keep their rules.
export const NFL_CORE_SELECTOR_EFFECTIVE_DATE = "2026-10-05";

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
