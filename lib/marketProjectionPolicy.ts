export type TrackingSport = "NBA" | "NFL" | "NCAAF";
export const MARKET_PROJECTION_POLICY = "directional-market-tracking-2026-11-23-v1";
export const MARKET_PROJECTION_ACTIVATION = "market_projection_activation";
export const MARKET_PROJECTION_UPDATES = "market_projection_updates";
export const trackingModelVersion = (sport: TrackingSport) => `${sport.toLowerCase()}-market-tracking-2026-11-23-v1`;
// The approved NCAAM balanced rules are the fixed starting weights for point markets.
export const MARKET_PROJECTION_PARAMETERS = {
  flow_policy: MARKET_PROJECTION_POLICY,
  feature_order: ["line_movement", "money_movement", "money_ticket_divergence", "ticket_only_movement", "same_window_confirmation", "lagged_confirmation"],
  weights: [1, 2, 1, .5, .5, .25], minimum_adjustment: 1, spread_cap: 4, total_cap: 6,
  half_life_minutes: 120, confirmation_lookback_minutes: 60,
  unconfirmed_split_multiplier: .25, divergence_split_multiplier: .75, full_confirmation_points: 2,
  opposing_price_damping_per_point: .25, maximum_market_age_minutes: 90,
} as const;
export type MarketProjectionActivation = { sport: TrackingSport; policy: string; modelVersion: string;
  activatedAt: string; gradingStatus: "ungraded" };
export function marketProjectionPending(value: Record<string, any> | undefined) {
  return value?.grading_status === "awaiting_market_tracking_grades"
    || value?.["Market Tracking Grade Status"] === "ungraded";
}
export function projectionAdjustments(value: Record<string, any> | undefined) {
  let info = value?.market_tracking;
  if (!info && value?.["Market Tracking JSON"]) {
    try { info = JSON.parse(value["Market Tracking JSON"]); } catch { return null; }
  }
  if (info?.policy !== MARKET_PROJECTION_POLICY || !["NBA", "NFL", "NCAAF"].includes(info.sport)
    || info.status !== "applied" || ![info.spread_adjustment, info.total_adjustment].every(n => typeof n === "number" && Number.isFinite(n))) return null;
  const margin = info.spread_adjustment, total = info.total_adjustment;
  return { homeSpread: margin, awaySpread: -margin, total, homeScore: (total + margin) / 2, awayScore: (total - margin) / 2 };
}
