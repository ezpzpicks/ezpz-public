import { ncaamTeamKey } from "./ncaamTeamKey";
import { quoteImpliedProbability } from "./modelSignalQuote";
import type { NcaamMatchupGrade } from "./ncaamMatchupGrades";
import type { NcaamSpreadGrade } from "./ncaamSpreadGrades";
import { ncaamReboundPoints } from "./ncaamRebounding";

export const LEGACY_NCAAM_POINT_MODEL = "ncaam-v0.7-matchup-projection-2026-11-14";
export const ADJUSTED_TEMPO_NCAAM_POINT_MODEL = "ncaam-v0.8-adjusted-tempo-2026-11-15";
export const INITIAL_OFFENSE_NCAAM_POINT_MODEL = "ncaam-v0.9-progressive-offense-2026-11-15";
export const PRE_REBOUND_NCAAM_POINT_MODEL = "ncaam-v0.10-progressive-offense-2026-11-16";
export const CAPPED_REBOUND_NCAAM_POINT_MODEL = "ncaam-v0.11-rebound-transfer-2026-11-16";
export const PERCENTAGE_REBOUND_NCAAM_POINT_MODEL = "ncaam-v0.12-rebound-percentage-2026-11-17";
export const OFFENSE_ONLY_NCAAM_POINT_MODEL = "ncaam-v0.13-offense-only-2026-11-17";
export const NCAAM_POINT_MODEL = "ncaam-v0.14-mirrored-defense-2026-11-18";
const POINT_MODELS = [LEGACY_NCAAM_POINT_MODEL, ADJUSTED_TEMPO_NCAAM_POINT_MODEL,
  INITIAL_OFFENSE_NCAAM_POINT_MODEL, PRE_REBOUND_NCAAM_POINT_MODEL, CAPPED_REBOUND_NCAAM_POINT_MODEL,
  PERCENTAGE_REBOUND_NCAAM_POINT_MODEL, OFFENSE_ONLY_NCAAM_POINT_MODEL, NCAAM_POINT_MODEL];
export const isNcaamPointModel = (value: unknown) => typeof value === "string" && POINT_MODELS.includes(value);
const OFFENSE_BONUS_POINTS = {very_strong:1,strong:3,above_average:5,below_average:5,weak:8,very_weak:15} as const;
type DefenseBand = keyof typeof OFFENSE_BONUS_POINTS;
const REVISED_OFFENSE_POLICY = { version: "ncaam-very-strong-offense-progressive-2026-11-16-v2", points: OFFENSE_BONUS_POINTS };
const DEFENSE_DEDUCTION_POLICY = "ncaam-very-strong-defense-mirrored-2026-11-18-v1";
const OFFENSE_POLICIES: Record<string, { version: string; points: Record<DefenseBand, number> }> = {
  [INITIAL_OFFENSE_NCAAM_POINT_MODEL]: { version: "ncaam-very-strong-offense-progressive-2026-11-15-v1",
    points: {very_strong:1,strong:3,above_average:5,below_average:8,weak:9,very_weak:10} },
  [PRE_REBOUND_NCAAM_POINT_MODEL]: REVISED_OFFENSE_POLICY,
  [CAPPED_REBOUND_NCAAM_POINT_MODEL]: REVISED_OFFENSE_POLICY,
  [PERCENTAGE_REBOUND_NCAAM_POINT_MODEL]: REVISED_OFFENSE_POLICY,
  [OFFENSE_ONLY_NCAAM_POINT_MODEL]: REVISED_OFFENSE_POLICY,
  [NCAAM_POINT_MODEL]: REVISED_OFFENSE_POLICY,
};
type OffenseBonus = { qualified: boolean; offense_z: number; opponent_defense_z: number;
  opponent_defense_band: DefenseBand; points: number };
type DefenseDeduction = { qualified: boolean; defense_z: number; opponent_offense_z: number;
  opponent_offense_band: DefenseBand; points: number };
export const NCAAM_POINT_POLICY = "ncaam-point-edge-2026-11-14-v1";
export type NcaamPointPolicy = { version: string; grading_basis: "market_point_edge";
  thresholds: { spread_a_points: number; spread_b_points: number; total_a_points: number; total_b_points: number;
    spread_max_market_line: number | null; max_benchmark_age_hours: number; max_market_age_minutes: number } };
export type NcaamPointProjection = { model_version: string; status: string; as_of: string; tipoff: string; season: number;
  ratings_observed_at: string; ratings_source_url: string; sha256: string; benchmark_sha256: string;
  national_benchmark: { season: number; team_count: number; observed_at: string; metrics: Record<string, { mean: number; sd: number }> };
  team_inputs: Record<"away" | "home", { team: string; offense: number; defense: number; tempo: number }>;
  tempo_model?: { method: string; national_tempo: number; away_ratio: number; home_ratio: number };
  offense_bonus_policy?: { version: string; status: string; qualifying_offense_z: number;
    points_by_opponent_defense: Record<DefenseBand, number> };
  defense_deduction_policy?: { version: string; status: string; qualifying_defense_z: number;
    points_by_opponent_offense: Record<DefenseBand, number> };
  possessions: number; away_points: number; home_points: number; margin: number; total: number;
  pairings: Record<"away" | "home", { expected_efficiency: number; neutral_points: number }>;
  adjustments: Record<"away" | "home", { player_points: number; home_court_points: number; offense_bonus?: OffenseBonus;
    opponent_defense_deduction?: DefenseDeduction; rebounding_points?: number }>;
  rebounding_adjustment?: Record<string, any> };
type Row = Record<string, any>;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const time = (v: unknown) => typeof v === "string" && /(?:Z|[+-]\d{2}:\d{2})$/.test(v) ? Date.parse(v) : NaN;
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
function validPolicy(policy: NcaamPointPolicy | undefined): policy is NcaamPointPolicy {
  if (policy?.version !== NCAAM_POINT_POLICY || policy.grading_basis !== "market_point_edge") return false;
  const t = policy.thresholds;
  return t && (["spread", "total"] as const).every(m => finite(t[`${m}_a_points`]) && finite(t[`${m}_b_points`])
    && t[`${m}_a_points`] > t[`${m}_b_points`] && t[`${m}_b_points`] > 0)
    && (t.spread_max_market_line === null || (finite(t.spread_max_market_line)
      && t.spread_max_market_line > 0 && t.spread_max_market_line <= 20))
    && finite(t.max_benchmark_age_hours) && t.max_benchmark_age_hours > 0
    && finite(t.max_market_age_minutes) && t.max_market_age_minutes > 0;
}

export function ncaamPointProjection(f: Row): NcaamPointProjection | null {
  const p = f.matchup_projection as NcaamPointProjection | undefined;
  if (!isNcaamPointModel(f.modelVersion) || f.projection_engine !== f.modelVersion || !p
    || p.model_version !== f.modelVersion || p.status !== "provisional" || !hash(p.sha256) || !hash(p.benchmark_sha256)
    || time(p.as_of) !== time(f.lockedAt) || time(p.tipoff) !== time(f.tipoff)
    || !(time(p.ratings_observed_at) <= time(p.as_of) && time(p.as_of) < time(p.tipoff))
    || time(p.as_of) - time(p.ratings_observed_at) > 30 * 3600000
    || p.ratings_source_url !== `https://barttorvik.com/${p.season}_team_results.csv`
    || f.ratings_source_url !== p.ratings_source_url || time(f.ratings_observed_at) !== time(p.ratings_observed_at)
    || ![p.away_points, p.home_points, p.margin, p.total, p.possessions, f.total, f.fair_home_spread].every(finite)
    || (p.model_version === PERCENTAGE_REBOUND_NCAAM_POINT_MODEL ? p.away_points < 0 || p.home_points < 0 : p.away_points <= 0 || p.home_points <= 0)
    || p.possessions <= 45 || p.possessions >= 95
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
  const a = p.team_inputs.away.tempo, h = p.team_inputs.home.tempo, national = b.metrics.tempo.mean;
  if (!(national > 45 && national < 95)) return null;
  const pace = p.model_version === LEGACY_NCAAM_POINT_MODEL ? (a+h)/2 : a*h/national;
  if (Math.abs(p.possessions-pace) > 1e-7) return null;
  if (p.model_version !== LEGACY_NCAAM_POINT_MODEL) {
    const tempo = p.tempo_model;
    if (tempo?.method !== "adjusted-tempo-ratios-v1" || tempo.national_tempo !== national
      || !finite(tempo.away_ratio) || Math.abs(tempo.away_ratio-a/national) > 1e-7
      || !finite(tempo.home_ratio) || Math.abs(tempo.home_ratio-h/national) > 1e-7) return null;
  }
  const offensePolicy = OFFENSE_POLICIES[p.model_version], progressive = Boolean(offensePolicy), policy = p.offense_bonus_policy;
  if (progressive && (policy?.version !== offensePolicy.version || policy.status !== "experimental"
    || policy.qualifying_offense_z !== 1.5 || !policy.points_by_opponent_defense
    || Object.keys(policy.points_by_opponent_defense).length !== 6
    || (Object.keys(OFFENSE_BONUS_POINTS) as DefenseBand[]).some(k => policy.points_by_opponent_defense[k] !== offensePolicy.points[k]))) return null;
  if (!progressive && policy !== undefined) return null;
  const defenseAdjusted = p.model_version === NCAAM_POINT_MODEL, defensePolicy = p.defense_deduction_policy;
  if (defenseAdjusted ? defensePolicy?.version !== DEFENSE_DEDUCTION_POLICY || defensePolicy.status !== "experimental"
    || defensePolicy.qualifying_defense_z !== -1.5 || !defensePolicy.points_by_opponent_offense
    || Object.keys(defensePolicy.points_by_opponent_offense).length !== 6
    || (Object.keys(OFFENSE_BONUS_POINTS) as DefenseBand[]).some(k => defensePolicy.points_by_opponent_offense[k] !== OFFENSE_BONUS_POINTS[k])
    : defensePolicy !== undefined) return null;
  const baseline = { away: 0, home: 0 };
  for (const side of ["away", "home"] as const) {
    const other = side === "away" ? "home" : "away", input = p.team_inputs[side], opponent = p.team_inputs[other];
    const adj = p.adjustments[side], pair = p.pairings[side];
    const offenseZ = (input.offense-b.metrics.offense.mean)/b.metrics.offense.sd;
    const defenseZ = (opponent.defense-b.metrics.defense.mean)/b.metrics.defense.sd;
    const band: DefenseBand = defenseZ <= -1.5 ? "very_strong" : defenseZ <= -1 ? "strong"
      : defenseZ < 0 ? "above_average" : defenseZ < 1 ? "below_average" : defenseZ < 1.5 ? "weak" : "very_weak";
    const bonus = progressive && offenseZ >= 1.5 ? offensePolicy.points[band] : 0;
    const offenseBand: DefenseBand = offenseZ >= 1.5 ? "very_strong" : offenseZ >= 1 ? "strong"
      : offenseZ > 0 ? "above_average" : offenseZ > -1 ? "below_average" : offenseZ > -1.5 ? "weak" : "very_weak";
    const deduction = defenseAdjusted && defenseZ <= -1.5 ? OFFENSE_BONUS_POINTS[offenseBand] : 0;
    if (defenseAdjusted) {
      const proof = adj.opponent_defense_deduction;
      if (!proof || proof.qualified !== (defenseZ <= -1.5) || proof.opponent_offense_band !== offenseBand
        || !finite(proof.defense_z) || Math.abs(proof.defense_z-defenseZ) > 1e-7
        || !finite(proof.opponent_offense_z) || Math.abs(proof.opponent_offense_z-offenseZ) > 1e-7
        || proof.points !== deduction) return null;
    } else if (adj.opponent_defense_deduction !== undefined) return null;
    if (progressive) {
      const proof = adj.offense_bonus;
      if (!proof || proof.qualified !== (offenseZ >= 1.5) || proof.opponent_defense_band !== band
        || !finite(proof.offense_z) || Math.abs(proof.offense_z-offenseZ) > 1e-7
        || !finite(proof.opponent_defense_z) || Math.abs(proof.opponent_defense_z-defenseZ) > 1e-7
        || proof.points !== bonus) return null;
      const offenseDelta = f.lineup_adjustment?.[side]?.offense_change_per_100 ?? 0;
      const defenseDelta = f.lineup_adjustment?.[other]?.defense_improvement_per_100 ?? 0;
      if (![offenseDelta,defenseDelta,f.home_court_points].every(finite) || typeof f.neutral_site !== "boolean"
        || f.home_court_points < 0 || f.home_court_points > 8 || (f.neutral_site && f.home_court_points !== 0)
        || Math.abs(adj.player_points-pace*(offenseDelta-defenseDelta)/100) > 1e-7
        || Math.abs(adj.home_court_points-f.home_court_points/2*(side === "home" ? 1 : -1)) > 1e-7) return null;
    } else if (adj.offense_bonus !== undefined) return null;
    const efficiency = (b.metrics.offense.mean+b.metrics.defense.mean)/2
      +input.offense-b.metrics.offense.mean+opponent.defense-b.metrics.defense.mean;
    const neutral = pace*efficiency/100;
    if (Math.abs(pair.expected_efficiency-efficiency) > 1e-7 || Math.abs(pair.neutral_points-neutral) > 1e-7) return null;
    baseline[side] = neutral+adj.player_points+adj.home_court_points+bonus-deduction;
    if (baseline[side] <= 0 || baseline[side] >= 200) return null;
  }
  const hasRebounds = p.model_version === CAPPED_REBOUND_NCAAM_POINT_MODEL || p.model_version === PERCENTAGE_REBOUND_NCAAM_POINT_MODEL;
  const rebounds = hasRebounds ? ncaamReboundPoints(f, baseline, p.model_version === PERCENTAGE_REBOUND_NCAAM_POINT_MODEL) : {away:0,home:0};
  if (!rebounds || (!hasRebounds && (p.rebounding_adjustment !== undefined
    || p.adjustments.away.rebounding_points !== undefined || p.adjustments.home.rebounding_points !== undefined))
    || Math.abs(p.total-baseline.away-baseline.home) > 1e-7) return null;
  for (const side of ["away", "home"] as const)
    if (Math.abs(p[`${side}_points`]-baseline[side]-rebounds[side]) > 1e-7) return null;
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
    || g.projection_model_version !== p.model_version || g.projection_sha256 !== p.sha256
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
    || (market === "Spread" && t.spread_max_market_line !== null
      && Math.abs(line) >= t.spread_max_market_line && g.eligible)) return null;
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
  const price = quoteImpliedProbability(odds), priceOkay = price != null && price <= 110/210+1e-12;
  return { active: tier !== "Research" && priceOkay, grade: tier, edge,
    reason: !priceOkay
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
