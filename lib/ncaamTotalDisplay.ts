import { NCAAM_REVERSED_SPREAD_MODEL, NCAAM_REVERSED_TOTAL_MODEL } from "./ncaamMarketTrackingPolicy";
import { ncaamProjectionAdjustments } from "./ncaamProjectionAdjustments";

export const NCAAM_REVERSED_TOTAL_DISPLAY_FROM_ET = "2026-11-25";
const easternDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
});

/** Presentation only. Never pass the returned view into grading, records or storage. */
export function ncaamReversedTotalView(forecast: Record<string, any> | undefined) {
  const original = ncaamProjectionAdjustments(forecast);
  const tip = Date.parse(forecast?.tipoff || "");
  if (!original || !Number.isFinite(tip) || easternDate.format(tip) < NCAAM_REVERSED_TOTAL_DISPLAY_FROM_ET) return null;
  const tracking = forecast!.market_tracking;
  const base = tracking.baseline_total, margin = -forecast!.fair_home_spread;
  const line = forecast!.market?.total;
  if (![base, margin, line, forecast!.total].every(n => typeof n === "number" && Number.isFinite(n))
    || line <= 0 || Math.abs(forecast!.total - base - original.total) > 1e-6) return null;

  if (forecast!.modelVersion === NCAAM_REVERSED_TOTAL_MODEL || forecast!.modelVersion === NCAAM_REVERSED_SPREAD_MODEL) {
    return { total: forecast!.total, edge: forecast!.total_edge, awayScore: forecast!.away_score,
      homeScore: forecast!.home_score, pick: forecast!.total_pick, adjustments: original };
  }
  const delta = -2 * original.total || 0;
  const total = base + delta;
  const away = (total - margin) / 2, home = (total + margin) / 2;
  if (![total, away, home].every(Number.isFinite) || away <= 0 || home <= 0) return null;
  const edge = total - line;
  return {
    total, edge, awayScore: away, homeScore: home,
    pick: Math.abs(edge) < 1e-9 ? "No total edge" : `${edge > 0 ? "Over" : "Under"} ${line}`,
    adjustments: { ...original, total: delta, homeScore: (delta + original.homeSpread) / 2, awayScore: (delta - original.homeSpread) / 2 },
  };
}

/** Read-only spread bridge for approved Projections slates. Canonical v0.19 rows pass through. */
export function ncaamSpreadDisplay<T extends Record<string, any>>(saved: T): T {
  const adjustments = ncaamProjectionAdjustments(saved), tip = Date.parse(saved.tipoff);
  if (!adjustments || saved.modelVersion===NCAAM_REVERSED_SPREAD_MODEL || !Number.isFinite(tip)
    || easternDate.format(tip)<NCAAM_REVERSED_TOTAL_DISPLAY_FROM_ET) return saved;
  const base = saved.market_tracking.baseline_margin, line = saved.market?.home_spread;
  if (![base,line,saved.total,saved.fair_home_spread].every(Number.isFinite)
    || Math.abs(base+adjustments.homeSpread+saved.fair_home_spread)>1e-6) return saved;
  const delta = -2*adjustments.homeSpread || 0, margin = base+delta, edge = margin+line;
  const total = ncaamReversedTotalView(saved)?.total ?? saved.total;
  if (Math.min(total,saved.total)<=Math.abs(margin)) return saved;
  const selectedLine = edge>0 ? line : -line;
  return {...saved, fair_home_spread:-margin,home_spread_edge:edge,
    spread_pick:Math.abs(edge)<1e-9 ? "No spread edge" : `${edge>0?saved.home_team:saved.away_team} ${selectedLine>0?"+":""}${selectedLine}`,
    home_score:(saved.total+margin)/2, away_score:(saved.total-margin)/2,
    market_tracking:{...saved.market_tracking,spread_adjustment:delta}};
}
