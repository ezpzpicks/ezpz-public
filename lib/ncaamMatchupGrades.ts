/** Read saved factor grades without recomputing them from current ratings. */
export const NCAAM_MATCHUP_GRADE_TAB = "ncaam_matchup_total_grades";
export type NcaamMatchupGrade = {
  policy_version: string; policy_sha256: string; forecast_record_id: string; game_id: string;
  grade: "A" | "B" | "Research"; side: "Over" | "Under" | null; line: number; reason: string;
  record_mode: "live" | "replay"; published_at: string; as_of: string; tipoff: string;
  benchmark_observed_at?: string; benchmark_exact_rating_timestamp?: boolean;
  benchmark_age_hours?: number;
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
  return g;
}

export function attachNcaamMatchupGrades(forecasts: Row[], gradeRows: Record<string, string>[]): Row[] {
  const saved = new Map<string, NcaamMatchupGrade>();
  for (const row of gradeRows) {
    try {
      const grade = JSON.parse(row["Details JSON"]) as NcaamMatchupGrade;
      if (!grade || typeof grade.forecast_record_id !== "string" || !grade.forecast_record_id) continue;
      const old = saved.get(grade.forecast_record_id);
      if (!old || (grade.record_mode === "live" && old.record_mode !== "live")
        || (grade.record_mode === old.record_mode && time(grade.published_at) > time(old.published_at))) saved.set(grade.forecast_record_id, grade);
    } catch { /* A malformed optional grade cannot remove the point forecast. */ }
  }
  return forecasts.map(f => {
    const candidate = { ...f, matchup_total: ncaamMatchupGrade(f) || saved.get(f.recordId) };
    const grade = ncaamMatchupGrade(candidate);
    if (!grade) return f;
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
