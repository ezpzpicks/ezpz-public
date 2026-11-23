import { isNcaamMarketTracked } from "./ncaamMarketTrackingPolicy";

/** Spread deltas describe team strength, rather than the inverse handicap sign. */
export function ncaamProjectionAdjustments(forecast: Record<string, any> | undefined) {
  const info = forecast?.market_tracking;
  if (!isNcaamMarketTracked(forecast) || info?.status !== "applied"
    || typeof info.spread_adjustment !== "number" || !Number.isFinite(info.spread_adjustment)
    || typeof info.total_adjustment !== "number" || !Number.isFinite(info.total_adjustment)) return null;
  const margin = info.spread_adjustment, total = info.total_adjustment;
  return { homeSpread: margin, awaySpread: -margin, total,
    homeScore: (total + margin) / 2, awayScore: (total - margin) / 2 };
}
