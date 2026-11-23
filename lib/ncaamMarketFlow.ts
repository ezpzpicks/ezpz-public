/** Pure port of the approved Python v3 scorer. No fitting, I/O or grade thresholds. */
import { NCAAM_MARKET_TRACKING as P } from "./ncaamMarketTrackingPolicy";
export type MarketPoint = { snapshotTime: string; line: number; betsPct: number | null; moneyPct: number | null };
export type MarketName = "Spread" | "Total";
const sign = (n: number) => n > 0 ? 1 : n < 0 ? -1 : 0;
export function marketNumber(value: unknown): number {
  if (value == null || typeof value === "boolean" || String(value).trim() === "" || !Number.isFinite(Number(value))) throw new Error("A finite reported number is required.");
  return Number(value);
}
function share(value: unknown) {
  if (value == null) return null;
  const n = marketNumber(value);
  if (n < 0 || n > 100) throw new Error("Shares must be between zero and 100.");
  return n;
}
export function marketTime(value: string) {
  if (!/(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("Timezone-aware timestamps are required.");
  return Date.parse(value);
}
export function ncaamFlowFeatures(history: MarketPoint[], asOf: string, tipoff: string, market: MarketName) {
  const clock = marketTime(asOf), tip = marketTime(tipoff);
  if (!(clock < tip) || !["Spread", "Total"].includes(market)) throw new Error("Market updates must precede tipoff.");
  const points = new Map<number, MarketPoint>();
  for (const raw of history) {
    const t = marketTime(raw.snapshotTime);
    if (t > clock || t >= tip) continue;
    const point = { snapshotTime: new Date(t).toISOString(), line: marketNumber(raw.line), betsPct: share(raw.betsPct), moneyPct: share(raw.moneyPct) };
    const old = points.get(t);
    if (old && JSON.stringify(old) !== JSON.stringify(point)) throw new Error("Conflicting observations at the same timestamp.");
    points.set(t, point);
  }
  const timeline = [...points.entries()].sort(([a], [b]) => a - b);
  const features = Array<number>(6).fill(0);
  const intervals: Record<string, any>[] = [];
  const result = { policy: P.flow_policy, market, as_of: asOf, feature_names: P.feature_order,
    features, intervals, observations: timeline.length, status: "insufficient_history",
    first_observed_at: timeline[0]?.[1].snapshotTime, last_observed_at: timeline.at(-1)?.[1].snapshotTime };
  if (timeline.length < 2) return result;
  const windows = timeline.slice(1).map(([end, after], i) => {
    const [start, before] = timeline[i];
    const money = before.moneyPct != null && after.moneyPct != null ? (after.moneyPct - before.moneyPct) / 10 : null;
    const bets = before.betsPct != null && after.betsPct != null ? (after.betsPct - before.betsPct) / 10 : null;
    return { start, end, price: (after.line - before.line) * (market === "Spread" ? -1 : 1), money, bets, splitChanged: Boolean(money || bets) };
  });
  const anchor = Math.max(timeline[0][0], ...windows.filter(w => w.splitChanged).map(w => w.end));
  for (let i = 0; i < windows.length; i++) {
    const { start, end, price, money, bets } = windows[i];
    const recency = .5 ** (Math.max(0, (anchor - end) / 60_000) / P.half_life_minutes);
    const vector = [price, 0, 0, 0, 0, 0];
    const pressure = money ? money : money === 0 && bets != null ? -bets : 0;
    const divergence = money != null && bets != null && money * bets < 0;
    let response = price, confirmedThrough = end;
    if (pressure) for (const later of windows.slice(i + 1)) {
      if (later.end > end + P.confirmation_lookback_minutes * 60_000 || later.splitChanged) break;
      response += later.price; confirmedThrough = later.end;
    }
    const aligned = pressure ? sign(pressure) * response : 0;
    const base = divergence ? P.divergence_split_multiplier : P.unconfirmed_split_multiplier;
    const multiplier = base + (1 - base) * Math.min(1, Math.max(0, aligned) / P.full_confirmation_points);
    const damping = aligned < 0 ? 1 / (1 + P.opposing_price_damping_per_point * Math.abs(response)) : 1;
    if (money != null) {
      vector[1] = recency * money * multiplier * damping;
      if (divergence) vector[2] = recency * sign(money) * Math.min(Math.abs(money), Math.abs(bets!)) * multiplier * damping;
      if (money === 0 && bets != null) vector[3] = -recency * bets * multiplier * damping;
      if (money) {
        const same = Math.min(Math.max(0, aligned), Math.max(0, sign(money) * price));
        const lagged = Math.max(0, aligned - same);
        vector[4] = recency * sign(money) * Math.min(Math.abs(money), same);
        vector[5] = recency * sign(money) * Math.min(Math.max(0, Math.abs(money) - same), lagged);
      }
    }
    vector.forEach((v, j) => features[j] += v);
    intervals.push({ start: new Date(start).toISOString(), end: new Date(end).toISOString(), money_share_change: money == null ? null : money * 10,
      ticket_share_change: bets == null ? null : bets * 10, signed_market_move: price, recency_weight: recency,
      price_opposition_damping: damping, directional_split_pressure: pressure, money_ticket_divergence: divergence,
      signed_confirmation_response: response, confirmation_observed_through: new Date(confirmedThrough).toISOString(),
      split_strength_multiplier: multiplier, effective_split_multiplier: multiplier * damping, features: vector });
  }
  if (!features.every(Number.isFinite)) throw new Error("Nonfinite market evidence.");
  return { ...result, status: features.some(v => Math.abs(v) > 1e-12) ? "ready" : "observed_unchanged",
    history_minutes: (timeline.at(-1)![0] - timeline[0][0]) / 60_000, split_information_as_of: new Date(anchor).toISOString() };
}
export function ncaamMarketAdjustment(baseline: number, flow: ReturnType<typeof ncaamFlowFeatures>) {
  baseline = marketNumber(baseline);
  if (flow.policy !== P.flow_policy || flow.features.length !== 6) throw new Error("Mismatched market policy.");
  const contributions = Object.fromEntries(P.feature_order.map((name, i) => [name, flow.features[i] * P.weights[i]]));
  const raw = Object.values(contributions).reduce((a, b) => a + b, 0);
  const cap = flow.market === "Spread" ? P.spread_cap : P.total_cap;
  const value = Math.abs(raw) < 1e-9 ? 0 : sign(raw) * Math.min(cap, Math.max(P.minimum_adjustment, Math.abs(raw)));
  return { baseline, raw_adjustment: raw, adjustment: value, projection: baseline + value, contributions };
}
