/** Validate captured spread grades and re-evaluate quotes using saved factors. */
export const NCAAM_SPREAD_GRADE_TAB = "ncaam_matchup_spread_grades";
export type NcaamSpreadPolicy = {
  edge_window: { minimum_inclusive: number; maximum_exclusive: number };
  A_profiles: { id: string; minimum_edge: number; picked_defense_z_maximum?: number;
    maximum_opposing_matchup_tempo_z_exclusive?: number }[];
  B_profile: { minimum_edge: number };
};
export type NcaamSpreadGrade = {
  policy_version: string; policy_sha256: string; policy: NcaamSpreadPolicy;
  forecast_record_id: string; game_id: string; as_of: string; tipoff: string; published_at: string;
  record_mode: "live" | "replay"; grade: "A" | "B" | "Research";
  side: "away" | "home" | null; projected_side: "away" | "home" | null; selection_team: string | null;
  line: number; home_line: number; fair_home_spread: number; projected_margin: number; edge: number;
  role: "Favorite" | "Underdog" | "Pickem"; reason: string; profile_id?: string | null;
  matched_profiles?: string[]; offense_advantage: number; defense_advantage: number; picked_defense_z: number;
  mean_tempo_z: number; tempo_support_z: number; benchmark_observed_at?: string;
};
type Row = Record<string, any>;
const time = (v: unknown) => Date.parse(String(v || ""));
const rounded = (v: number) => Math.round(v * 1e8) / 1e8;
function validPolicy(p: NcaamSpreadPolicy | undefined): p is NcaamSpreadPolicy {
  const low = p?.edge_window?.minimum_inclusive, high = p?.edge_window?.maximum_exclusive;
  if (typeof low !== "number" || typeof high !== "number" || !Number.isFinite(low) || !Number.isFinite(high)
    || !(low > 0 && low < high && high <= 100) || !Array.isArray(p?.A_profiles) || p.A_profiles.length !== 2
    || !Number.isFinite(p.B_profile?.minimum_edge) || p.B_profile.minimum_edge < low || p.B_profile.minimum_edge >= high) return false;
  const defense = p.A_profiles.find(x => x?.id === "defense-supported"), confluence = p.A_profiles.find(x => x?.id === "three-factor-confluence");
  return Boolean(defense && confluence && p.A_profiles.every(x => Number.isFinite(x.minimum_edge) && x.minimum_edge >= low && x.minimum_edge < high)
    && Number.isFinite(defense.picked_defense_z_maximum) && Number(defense.picked_defense_z_maximum) < 0
    && Number.isFinite(defense.maximum_opposing_matchup_tempo_z_exclusive) && Number(defense.maximum_opposing_matchup_tempo_z_exclusive) > 0);
}
export const spreadSelection = (g: NcaamSpreadGrade) => g.selection_team
  ? `${g.selection_team} ${g.line > 0 ? "+" : ""}${g.line}` : "";

export function ncaamSpreadQuote(g: NcaamSpreadGrade, line: number) {
  const edge = rounded(g.projected_margin + line), policy = g.policy;
  const role = line < 0 ? "Favorite" : line > 0 ? "Underdog" : "Pickem";
  if (!validPolicy(policy)) return { grade: "Research", edge, role, reason: "Spread grading policy is unavailable" };
  const tempo = role === "Favorite" ? g.mean_tempo_z : role === "Underdog" ? -g.mean_tempo_z : 0;
  const low = policy?.edge_window?.minimum_inclusive, high = policy?.edge_window?.maximum_exclusive;
  if (![line, edge, low, high].every(Number.isFinite) || !(low > 0 && high > low)
    || edge < low || edge >= high) return { grade: "Research", edge, role, reason: `Projected cover edge is outside ${low} to under ${high} points` };
  const profiles = policy.A_profiles || [];
  const defense = profiles.find(p => p.id === "defense-supported"), confluence = profiles.find(p => p.id === "three-factor-confluence");
  if (defense && edge >= defense.minimum_edge && g.picked_defense_z <= Number(defense.picked_defense_z_maximum)
    && -tempo < Number(defense.maximum_opposing_matchup_tempo_z_exclusive))
    return { grade: "A", edge, role, reason: "Strong national defense with projection support" };
  if (confluence && edge >= confluence.minimum_edge && g.offense_advantage > 0 && g.defense_advantage > 0 && tempo > 0)
    return { grade: "A", edge, role, reason: "Offense, defense and tempo support the projected cover" };
  if (edge >= policy.B_profile.minimum_edge && (g.offense_advantage > 0 || g.defense_advantage > 0))
    return { grade: "B", edge, role, reason: "Projected cover with a relative offense or defense advantage" };
  return { grade: "Research", edge, role, reason: "No supporting relative offense/defense advantage" };
}

export function ncaamSpreadGrade(f: Row): NcaamSpreadGrade | null {
  const g = f.matchup_spread as NcaamSpreadGrade | undefined;
  if (!g || typeof g.policy_version !== "string" || !g.policy_version.startsWith("ncaam-spread-grades-") || !/^[a-f0-9]{64}$/.test(g.policy_sha256 || "")
    || !g.forecast_record_id || g.forecast_record_id !== f.recordId || String(g.game_id) !== String(f.gameId)
    || !["live", "replay"].includes(g.record_mode) || !["A", "B", "Research"].includes(g.grade)
    || time(g.as_of) !== time(f.lockedAt) || time(g.tipoff) !== time(f.tipoff)
    || !Number.isFinite(time(g.as_of)) || !Number.isFinite(time(g.tipoff)) || time(g.as_of) >= time(g.tipoff)
    || !Number.isFinite(time(g.published_at)) || time(g.published_at) < time(g.as_of)
    || (g.record_mode === "live" && time(g.published_at) >= time(g.tipoff))
    || typeof f.market?.home_spread !== "number" || !Number.isFinite(f.market.home_spread)
    || typeof f.fair_home_spread !== "number" || !Number.isFinite(f.fair_home_spread)
    || g.home_line !== f.market.home_spread || g.fair_home_spread !== f.fair_home_spread) return null;
  if (g.grade === "Research") return g.side === null ? g : null;
  if (!validPolicy(g.policy)) return null;
  const gap = rounded(f.market.home_spread - f.fair_home_spread), side = gap > 0 ? "home" : gap < 0 ? "away" : null;
  const sign = side === "home" ? 1 : -1;
  if (!side || g.side !== side || g.projected_side !== side || g.selection_team !== f[side + "_team"]
    || g.line !== sign * f.market.home_spread || g.projected_margin !== -sign * f.fair_home_spread
    || Math.abs(g.edge - Math.abs(gap)) > 1e-7 || !Number.isFinite(time(g.benchmark_observed_at))
    || time(g.benchmark_observed_at) > time(g.as_of)
    || ![g.offense_advantage, g.defense_advantage, g.picked_defense_z, g.mean_tempo_z].every(Number.isFinite)) return null;
  const quote = ncaamSpreadQuote(g, g.line);
  return quote.grade === g.grade && quote.role === g.role ? g : null;
}

export function attachNcaamSpreadGrades(forecasts: Row[], rows: Record<string, string>[]) {
  const saved = new Map<string, NcaamSpreadGrade[]>();
  for (const row of rows) {
    try {
      const g = JSON.parse(row["Details JSON"]) as NcaamSpreadGrade;
      if (!g?.forecast_record_id) continue;
      saved.set(g.forecast_record_id, [...(saved.get(g.forecast_record_id) || []), g]);
    } catch { /* Malformed optional grades never remove the point forecast. */ }
  }
  return forecasts.map(f => {
    const g = [f.matchup_spread, ...(saved.get(f.recordId) || [])].filter(g => ncaamSpreadGrade({ ...f, matchup_spread: g }))
      .sort((a: NcaamSpreadGrade, b: NcaamSpreadGrade) => Number(b.record_mode === "live") - Number(a.record_mode === "live")
        || time(b.published_at) - time(a.published_at) || b.policy_sha256.localeCompare(a.policy_sha256))[0] as NcaamSpreadGrade | undefined;
    if (!g) return f.matchup_spread ? { ...f, matchup_spread: undefined } : f;
    return { ...f, matchup_spread: g, numeric_spread_grade: f.numeric_spread_grade ?? f.spread_grade,
      spread_grade: g.grade, spread_grade_policy: g.policy_version,
      spread_pick: g.side ? spreadSelection(g) : f.spread_pick };
  });
}
