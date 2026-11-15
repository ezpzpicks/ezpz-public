import { ncaamTeamKey } from "./ncaamTeamKey";
import { quoteImpliedProbability } from "./modelSignalQuote";
import type { NcaamMatchupGrade } from "./ncaamMatchupGrades";
import type { NcaamSpreadGrade } from "./ncaamSpreadGrades";

export const NCAAM_POINT_MODEL = "ncaam-v0.7-matchup-projection-2026-11-14";
export const NCAAM_POINT_POLICY = "ncaam-point-edge-2026-11-14-v1";
export type NcaamPointPolicy = { version: string; grading_basis: "market_point_edge";
  thresholds: { spread_a_points: number; spread_b_points: number; total_a_points: number; total_b_points: number;
    spread_max_market_line: number; max_benchmark_age_hours: number; max_market_age_minutes: number } };
export type NcaamPointProjection = { model_version: string; status: string; as_of: string; tipoff: string; season: number;
  ratings_observed_at: string; ratings_source_url: string; sha256: string; benchmark_sha256: string;
  national_benchmark: { season: number; team_count: number; observed_at: string; metrics: Record<string, { mean: number; sd: number }> };
  team_inputs: Record<"away" | "home", { team: string; offense: number; defense: number; tempo: number }>;
  possessions: number; away_points: number; home_points: number; margin: number; total: number;
  pairings: Record<"away" | "home", { expected_efficiency: number; neutral_points: number }>;
  adjustments: Record<"away" | "home", { player_points: number; home_court_points: number }> };
type Row = Record<string, any>;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const time = (v: unknown) => typeof v === "string" && /(?:Z|[+-]\d{2}:\d{2})$/.test(v) ? Date.parse(v) : NaN;
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
function validPolicy(policy: NcaamPointPolicy | undefined): policy is NcaamPointPolicy {
  if (policy?.version !== NCAAM_POINT_POLICY || policy.grading_basis !== "market_point_edge") return false;
  const t = policy.thresholds;
  return t && (["spread", "total"] as const).every(m => finite(t[`${m}_a_points`]) && finite(t[`${m}_b_points`])
    && t[`${m}_a_points`] > t[`${m}_b_points`] && t[`${m}_b_points`] > 0)
    && finite(t.spread_max_market_line) && t.spread_max_market_line > 0 && t.spread_max_market_line <= 20
    && finite(t.max_benchmark_age_hours) && t.max_benchmark_age_hours > 0
    && finite(t.max_market_age_minutes) && t.max_market_age_minutes > 0;
}

export function ncaamPointProjection(f: Row): NcaamPointProjection | null {
  const p = f.matchup_projection as NcaamPointProjection | undefined;
  if (f.modelVersion !== NCAAM_POINT_MODEL || f.projection_engine !== NCAAM_POINT_MODEL || !p
    || p.model_version !== NCAAM_POINT_MODEL || p.status !== "provisional" || !hash(p.sha256) || !hash(p.benchmark_sha256)
    || time(p.as_of) !== time(f.lockedAt) || time(p.tipoff) !== time(f.tipoff)
    || !(time(p.ratings_observed_at) <= time(p.as_of) && time(p.as_of) < time(p.tipoff))
    || time(p.as_of) - time(p.ratings_observed_at) > 30 * 3600000
    || p.ratings_source_url !== `https://barttorvik.com/${p.season}_team_results.csv`
    || f.ratings_source_url !== p.ratings_source_url || time(f.ratings_observed_at) !== time(p.ratings_observed_at)
    || ![p.away_points, p.home_points, p.margin, p.total, p.possessions, f.total, f.fair_home_spread].every(finite)
    || p.away_points <= 0 || p.home_points <= 0 || p.possessions <= 45 || p.possessions >= 95
    || Math.abs(p.total-p.away_points-p.home_points) > 1e-7 || Math.abs(p.margin-p.home_points+p.away_points) > 1e-7
    || Math.abs(f.total-p.total) > 1e-7 || Math.abs(f.fair_home_spread+p.margin) > 1e-7) return null;
  const b = p.national_benchmark;
  if (!b || b.season !== p.season || !Number.isInteger(b.team_count) || b.team_count < 300
    || time(b.observed_at) !== time(p.ratings_observed_at)) return null;
  for (const m of ["offense", "defense", "tempo"] as const)
    if (!finite(b.metrics?.[m]?.mean) || !finite(b.metrics?.[m]?.sd) || b.metrics[m].sd <= 0) return null;
  for (const side of ["away", "home"] as const) {
    const a = p.team_inputs?.[side], r = f[`${side}_rating`];
    if (!a || !r || !ncaamTeamKey(a.team) || ncaamTeamKey(a.team) !== ncaamTeamKey(r.team)
      || !["offense", "defense", "tempo"].every(m => finite(a[m as keyof typeof a]) && a[m as keyof typeof a] === r[m])
      || !finite(p.pairings?.[side]?.expected_efficiency) || !finite(p.pairings?.[side]?.neutral_points)
      || !finite(p.adjustments?.[side]?.player_points) || !finite(p.adjustments?.[side]?.home_court_points)) return null;
  }
  const quote = time(f.market?.as_of);
  return Number.isFinite(quote) && quote <= time(f.lockedAt) && time(f.lockedAt)-quote <= 90 * 60000 ? p : null;
}

export function ncaamPointGrade(f: Row, market: "Spread"): NcaamSpreadGrade | null;
export function ncaamPointGrade(f: Row, market: "Total"): NcaamMatchupGrade | null;
export function ncaamPointGrade(f: Row, market: "Spread" | "Total"): NcaamSpreadGrade | NcaamMatchupGrade | null;
export function ncaamPointGrade(f: Row, market: "Spread" | "Total") {
  const p = ncaamPointProjection(f), g = f[market === "Spread" ? "matchup_spread" : "matchup_total"];
  if (!p || !g || g.policy_version !== NCAAM_POINT_POLICY || !validPolicy(g.policy) || !hash(g.policy_sha256)
    || g.forecast_record_id !== f.recordId || String(g.game_id) !== String(f.gameId)
    || g.projection_model_version !== NCAAM_POINT_MODEL || g.projection_sha256 !== p.sha256
    || g.grading_basis !== "market_point_edge" || !["A", "B", "Research"].includes(g.grade)
    || !["A", "B", "Research"].includes(g.edge_grade) || typeof g.eligible !== "boolean"
    || !Array.isArray(g.confidence_flags) || !g.confidence_flags.every((v: unknown) => typeof v === "string")
    || !["live", "replay"].includes(g.record_mode) || time(g.as_of) !== time(f.lockedAt) || time(g.tipoff) !== time(f.tipoff)
    || !(time(g.published_at) >= time(g.as_of)) || (g.record_mode === "live" && time(g.published_at) >= time(g.tipoff))) return null;
  const line = market === "Spread" ? f.market?.home_spread : f.market?.total;
  if (!finite(line) || (market === "Spread" ? g.home_line !== line || g.fair_home_spread !== -p.margin
    : g.line !== line || g.projected_total !== p.total)) return null;
  const gap = market === "Spread" ? p.margin+line : p.total-line, prefix = market === "Spread" ? "spread" : "total";
  const t = (g.policy as NcaamPointPolicy).thresholds, edge = Math.abs(gap);
  const tier = edge >= t[`${prefix}_a_points`] ? "A" : edge >= t[`${prefix}_b_points`] ? "B" : "Research";
  const side = gap > 0 ? market === "Spread" ? "home" : "Over" : gap < 0 ? market === "Spread" ? "away" : "Under" : null;
  if (!finite(g.edge) || Math.abs(g.edge-edge) > 1e-7 || g.edge_grade !== tier || g.projected_side !== side
    || (g.eligible ? g.grade !== tier || !["A", "B"].includes(tier) || g.side !== side : g.grade !== "Research" || g.side !== null)
    || (market === "Spread" && Math.abs(line) >= t.spread_max_market_line && g.eligible)) return null;
  return g;
}

export function ncaamPointQuote(f: Row, market: "Spread" | "Total", selection: string, line: number, asOf: number, odds = "-110") {
  const g = ncaamPointGrade(f, market), p = ncaamPointProjection(f);
  const fail = (reason: string) => ({ active: false, grade: "Research", edge: null, reason });
  if (!g || !p || !finite(line)) return fail("Matching saved score and grade inputs are unavailable.");
  if (g.record_mode !== "live" || !(time(g.published_at) <= asOf && time(g.as_of) <= asOf && asOf < time(g.tipoff)))
    return fail("This quote requires a grade published before the pregame decision.");
  let edge: number;
  if (market === "Spread") {
    if (![ncaamTeamKey(f.away_team), ncaamTeamKey(f.home_team)].includes(selection)) return fail("Current spread team is unavailable.");
    edge = (selection === ncaamTeamKey(f.home_team) ? p.margin : -p.margin)+line;
  } else {
    if (!["Over", "Under"].includes(selection)) return fail("Current total direction is unavailable.");
    edge = (p.total-line)*(selection === "Over" ? 1 : -1);
  }
  const t = (g.policy as NcaamPointPolicy).thresholds, prefix = market === "Spread" ? "spread" : "total";
  const tier = edge >= t[`${prefix}_a_points`] ? "A" : edge >= t[`${prefix}_b_points`] ? "B" : "Research";
  const large = market === "Spread" && Math.abs(line) >= t.spread_max_market_line;
  const price = quoteImpliedProbability(odds), priceOkay = price != null && price <= 110/210+1e-12;
  return { active: tier !== "Research" && !large && priceOkay, grade: large ? "Research" : tier, edge,
    reason: large ? "20+ point spreads remain projection-only." : !priceOkay
      ? "A price worse than -110 requires separate probability evidence." : `${edge.toFixed(2)}-point edge at this number.`,
    confidenceFlags: g.confidence_flags || [] };
}

export function ncaamPointPlayMix(forecasts: Row[]) {
  const latest = new Map<string, Row>();
  for (const f of forecasts) {
    if (!f.gameId || !(time(f.lockedAt) < time(f.tipoff))) continue;
    const day = new Intl.DateTimeFormat("en-CA", {timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(f.tipoff));
    const key = `${day}|${f.gameId}`, old = latest.get(key);
    if (!old || time(f.lockedAt) > time(old.lockedAt) || (time(f.lockedAt) === time(old.lockedAt) && f.recordId > old.recordId)) latest.set(key,f);
  }
  const mix = { capturedGames: 0, total: 0, A: 0, B: 0, favorites: 0, underdogs: 0, overs: 0, unders: 0, pickems: 0 };
  for (const f of latest.values()) {
    if (!ncaamPointProjection(f)) continue;
    mix.capturedGames++;
    for (const market of ["Spread", "Total"] as const) {
      const g = ncaamPointGrade(f,market);
      if (!g?.eligible || g.record_mode !== "live" || (g.grade !== "A" && g.grade !== "B")) continue;
      mix.total++; mix[g.grade]++;
      if (market === "Total") { if (g.side === "Over") mix.overs++; else mix.unders++; }
      else if (g.line < 0) mix.favorites++; else if (g.line > 0) mix.underdogs++; else mix.pickems++;
    }
  }
  return mix;
}
