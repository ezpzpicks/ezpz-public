/** Read saved factor grades without recomputing them from current ratings. */
export const NCAAM_MATCHUP_GRADE_TAB = "ncaam_matchup_total_grades";
export const NCAAM_PROJECTION_AGREEMENT_POLICY = "ncaam-matchup-grades-2026-11-12-v2";
const PROJECTION_AGREEMENT_GAME_CUTOFF = Date.parse("2026-11-12T05:00:00Z"); // November 12, Eastern time
export type NcaamMatchupGrade = {
  policy_version: string; policy_sha256: string; forecast_record_id: string; game_id: string;
  grade: "A" | "B" | "Research"; side: "Over" | "Under" | null; line: number; reason: string;
  record_mode: "live" | "replay"; published_at: string; as_of: string; tipoff: string;
  benchmark_observed_at?: string; benchmark_exact_rating_timestamp?: boolean;
  benchmark_age_hours?: number;
  projection_gate?: { required: boolean; projection_total: number | null; direction: "Over" | "Under" | null;
    agrees: boolean; factor_side: "Over" | "Under" | null; factor_grade: string };
  thresholds?: { extreme_z?: number; very_extreme_z?: number };
  national_benchmark?: { metrics: Record<string, { mean: number; sd: number }> };
  market_reference?: { low_total: number; high_total: number; quote_count: number; observed_at: string };
  z: Record<string, Record<string, number>>;
  directions: Record<string, { grade: string; base_grade: string; profile_id: string | null; profile_label: string;
    matched_profiles: string[]; conflicts: { id: string; reason: string; levels: number }[] }>;
};
type Row = Record<string, any>;
const time = (v: unknown) => Date.parse(String(v || ""));
export function ncaamMatchupGrade(forecast: Row): NcaamMatchupGrade | null {
  const g = forecast.matchup_total as NcaamMatchupGrade | undefined;
  if (!g || !String(g.policy_version).startsWith("ncaam-matchup-grades-") || !/^[a-f0-9]{64}$/.test(g.policy_sha256 || "")
    || typeof g.forecast_record_id !== "string" || !g.forecast_record_id || g.forecast_record_id !== forecast.recordId
    || !g.game_id || String(g.game_id) !== String(forecast.gameId)
    || !["live", "replay"].includes(g.record_mode) || !["A", "B", "Research"].includes(g.grade)
    || !Number.isFinite(g.line) || g.line <= 50 || g.line >= 300 || !Number.isFinite(Number(forecast.market?.total))
    || Math.abs(g.line - Number(forecast.market?.total)) > .001
    || time(g.as_of) !== time(forecast.lockedAt) || time(g.tipoff) !== time(forecast.tipoff)
    || !Number.isFinite(time(g.as_of)) || !Number.isFinite(time(g.tipoff)) || time(g.as_of) >= time(g.tipoff)
    || !Number.isFinite(time(g.published_at)) || time(g.published_at) < time(g.as_of)
    || (g.record_mode === "live" && time(g.published_at) >= time(g.tipoff))) return null;
  if (g.grade === "Research") return g.side === null ? g : null;
  if (!["Over", "Under"].includes(String(g.side)) || !g.directions?.[String(g.side)]
    || g.directions[String(g.side)].grade !== g.grade || !Number.isFinite(time(g.benchmark_observed_at))
    || time(g.benchmark_observed_at) > time(g.as_of) || !g.market_reference
    || !Number.isFinite(time(g.market_reference.observed_at)) || time(g.market_reference.observed_at) > time(g.as_of)) return null;
  // The live board enforces the new requirement during rollout too, even if
  // the builder's latest capture still carries the prior policy version.
  if (g.record_mode === "live" && time(g.tipoff) >= PROJECTION_AGREEMENT_GAME_CUTOFF
    && (typeof forecast.total !== "number" || !Number.isFinite(forecast.total)
      || (g.side === "Over" ? forecast.total <= g.line : forecast.total >= g.line))) return null;
  if (g.policy_version === NCAAM_PROJECTION_AGREEMENT_POLICY || g.projection_gate?.required) {
    const projection = forecast.total, gate = g.projection_gate;
    const direction = typeof projection === "number" && Number.isFinite(projection)
      ? projection > g.line ? "Over" : projection < g.line ? "Under" : null : null;
    if (!gate?.required || !gate.agrees || gate.projection_total !== projection || gate.direction !== direction
      || gate.factor_side !== g.side || gate.factor_grade !== g.grade || direction !== g.side) return null;
  }
  return g;
}

export function attachNcaamMatchupGrades(forecasts: Row[], gradeRows: Record<string, string>[]): Row[] {
  const saved = new Map<string, NcaamMatchupGrade[]>();
  for (const row of gradeRows) {
    try {
      const grade = JSON.parse(row["Details JSON"]) as NcaamMatchupGrade;
      if (!grade || typeof grade.forecast_record_id !== "string" || !grade.forecast_record_id) continue;
      const prior = saved.get(grade.forecast_record_id) || [];
      prior.push(grade); saved.set(grade.forecast_record_id, prior);
    } catch { /* A malformed optional grade cannot remove the point forecast. */ }
  }
  return forecasts.map(f => {
    // A reviewed policy annotation can supersede the inline grade without
    // rewriting its immutable forecast. Validate every candidate before ranking.
    const grade = [f.matchup_total, ...(saved.get(f.recordId) || [])]
      .filter(g => ncaamMatchupGrade({ ...f, matchup_total: g }))
      .sort((a: NcaamMatchupGrade, b: NcaamMatchupGrade) => Number(b.record_mode === "live") - Number(a.record_mode === "live")
        || time(b.published_at) - time(a.published_at) || b.policy_sha256.localeCompare(a.policy_sha256))[0] as NcaamMatchupGrade | undefined;
    if (!grade) return f.matchup_total ? { ...f, matchup_total: undefined } : f;
    const candidate = { ...f, matchup_total: grade };
    return { ...candidate,
      numeric_total_pick: f.numeric_total_pick ?? f.total_pick,
      numeric_total_grade: f.numeric_total_grade ?? f.total_grade,
      numeric_total_edge: f.numeric_total_edge ?? f.total_edge,
      numeric_totalResult: f.numeric_totalResult ?? f.totalResult,
      total_pick: grade.side ? `${grade.side} ${grade.line}` : f.numeric_total_pick ?? f.total_pick,
      total_grade: grade.grade, total_grade_policy: grade.policy_version,
      // Results must be derived from the saved factor side and final scores.
      totalResult: "PENDING" };
  });
}
