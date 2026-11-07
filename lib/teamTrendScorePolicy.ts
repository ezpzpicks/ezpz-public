export const SPREAD_TEAM_TREND_VERSION = "team-trends-spread-2026-11-07-v3";
export const SPREAD_TEAM_TREND_EFFECTIVE_AT = "2026-11-07T22:10:00.000Z";

export function teamTrendAggregationExplanation(score?: { aggregation?: string } | null) {
  return score?.aggregation === "Neutral-relative spread"
    ? "Spread comparison starts at 50 and adds each team's support above or below 50, capped at 0–100. An even opponent is neutral; opposing trends reduce the score."
    : "Team scores are averaged.";
}
