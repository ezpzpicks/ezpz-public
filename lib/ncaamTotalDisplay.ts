import { NCAAM_REVERSED_SPREAD_FROM, NCAAM_REVERSED_TOTAL_FROM, NCAAM_REVERSED_SPREAD_MODEL, NCAAM_REVERSED_TOTAL_MODEL } from "./ncaamMarketTrackingPolicy";
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

/** Read-only spread bridge for approved Projections slates. The v0.19 view uses the same-line original spread shadow. */
export function ncaamSpreadDisplay<T extends Record<string, any>>(saved: T, game?: Record<string, string>): T {
  const adjustments = ncaamProjectionAdjustments(saved), tip = Date.parse(saved.tipoff);
  if (!adjustments || !Number.isFinite(tip)
    || easternDate.format(tip)<NCAAM_REVERSED_TOTAL_DISPLAY_FROM_ET) return saved;
  const base = saved.market_tracking.baseline_margin, line = saved.market?.home_spread;
  if (![base,line,saved.total,saved.fair_home_spread].every(Number.isFinite)
    || Math.abs(base+adjustments.homeSpread+saved.fair_home_spread)>1e-6) return saved;
  let delta = -2 * adjustments.homeSpread;
  if (saved.modelVersion === NCAAM_REVERSED_SPREAD_MODEL) {
    const shadow = saved.market_tracking.original_spread_shadow;
    if (!game || game["Game ID"] !== saved.gameId || game["Home Team"] !== saved.home_team
      || game["Away Team"] !== saved.away_team || Date.parse(game["Game Time"]) !== tip
      || !shadow || ![shadow.baseline, shadow.adjustment, shadow.projection, shadow.home_line].every(Number.isFinite)
      || shadow.home_line !== line || Math.abs(shadow.baseline - base) > 1e-6
      || Math.abs(shadow.projection - base - shadow.adjustment) > 1e-6
      || Math.abs(adjustments.homeSpread + 2 * shadow.adjustment) > 1e-6) return saved;
    delta = -shadow.adjustment;
  }
  const margin = base + delta, edge = margin + line;
  const total = ncaamReversedTotalView(saved)?.total ?? saved.total;
  if (Math.min(total,saved.total)<=Math.abs(margin)) return saved;
  const selectedLine = edge>0 ? line : -line;
  return {...saved, fair_home_spread:-margin,home_spread_edge:edge,
    spread_pick:Math.abs(edge)<1e-9 ? "No spread edge" : `${edge>0?saved.home_team:saved.away_team} ${selectedLine>0?"+":""}${selectedLine}`,
    home_score:(saved.total+margin)/2, away_score:(saved.total-margin)/2,
    market_tracking:{...saved.market_tracking,spread_adjustment:delta}};
}

/** Verify each market against the saved capture before deriving a Projections-only copy. */
export function ncaamNormalDisplay<T extends Record<string, any>>(saved: T, game?: Record<string, string>) {
  const fallback = ncaamSpreadDisplay(saved, game);
  const previous = { forecast: fallback, normalTotal: false };
  const t = saved.market_tracking, market = saved.market;
  if (![NCAAM_REVERSED_SPREAD_MODEL, NCAAM_REVERSED_TOTAL_MODEL].includes(saved.modelVersion)
    || !ncaamProjectionAdjustments(saved) || !market || !game || game["Game ID"] !== saved.gameId
    || game["Away Team"] !== saved.away_team || game["Home Team"] !== saved.home_team
    || String(t.baseline_forecast_record_id || "").split("|")[0] !== saved.gameId) return previous;
  const tip = Date.parse(saved.tipoff), quote = Date.parse(market.as_of), published = Date.parse(t.published_at);
  if (!(tip === Date.parse(game["Game Time"]) && quote === Date.parse(t.decision_as_of)
    && Date.parse(t.baseline_captured_at) <= published && quote <= published && published < tip
    && Date.parse(saved.lockedAt) === quote && market.source === t.source && market.source === "ScoresAndOdds")) return previous;
  const close = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a-b) <= 1e-6;
  function normalDelta(name: "spread" | "total", base: number, canonical: number, line: number) {
    const spread = name === "spread", shadow = t[`original_${name}_shadow`], applied = t[`${name}_adjustment`];
    const from = spread ? NCAAM_REVERSED_SPREAD_FROM : NCAAM_REVERSED_TOTAL_FROM;
    if (!shadow || t[`${name}_policy_effective_at`] !== from || quote < Date.parse(from)
      || ![shadow.adjustment,line,base,applied].every(Number.isFinite)
      || shadow[spread ? "home_line" : "line"] !== line || !close(shadow.baseline, base)
      || !close(shadow.projection, base+shadow.adjustment) || !close(applied,-2*shadow.adjustment)
      || !close(canonical,base+applied)) return null;
    return 2*shadow.adjustment;
  }
  const spread = saved.modelVersion === NCAAM_REVERSED_SPREAD_MODEL
    ? normalDelta("spread",t.baseline_margin,-saved.fair_home_spread,market.home_spread) : null;
  const points = normalDelta("total",t.baseline_total,saved.total,market.total);
  if (spread === null && points === null) return previous;
  const margin = spread === null ? -fallback.fair_home_spread : t.baseline_margin+spread;
  const total = points === null ? saved.total : t.baseline_total+points;
  if (!(total > Math.abs(margin))) return previous;
  const spreadEdge = margin+market.home_spread, totalEdge = total-market.total;
  const selectedLine = spreadEdge > 0 ? market.home_spread : -market.home_spread;
  return { normalTotal: points !== null, forecast: {...fallback,
    ...(spread === null ? {} : {fair_home_spread:-margin, home_spread_edge:spreadEdge,
      spread_pick:Math.abs(spreadEdge)<1e-9 ? "No spread edge" : `${spreadEdge>0?saved.home_team:saved.away_team} ${selectedLine>0?"+":""}${selectedLine}`}),
    ...(points === null ? {} : {total, total_edge:totalEdge, total_pick:Math.abs(totalEdge)<1e-9 ? "No total edge" : `${totalEdge>0?"Over":"Under"} ${market.total}`}),
    home_score:(total+margin)/2, away_score:(total-margin)/2, market_tracking:{...fallback.market_tracking,
      spread_adjustment:spread ?? fallback.market_tracking.spread_adjustment, total_adjustment:points ?? t.total_adjustment}} };
}
