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
