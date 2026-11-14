/** Quote-dependent selection preferences; mirrors builders/ncaam_selection_review.py. */
export type NcaamSelectionReview = {
  version: string; enabled: boolean; basis: string;
  meaningful_efficiency_z: number; strong_defense_z: number; very_strong_defense_z: number;
  solid_defense_z: number; weak_attack_z: number; tempo_gap_z: number; matched_tempo_z: number;
  near_even_dog_points: number; matched_tempo_points: number; weak_favorite_maximum_points: number;
  medium_favorite_points: number; large_favorite_points: number; very_large_favorite_points: number;
  slow_controller_tempo_z: number; high_total_points: number;
};
export function validSelectionReview(p: NcaamSelectionReview | undefined) {
  if (!p) return true; // Historical policies have no preference layer.
  const keys = ["meaningful_efficiency_z", "strong_defense_z", "very_strong_defense_z", "solid_defense_z",
    "weak_attack_z", "tempo_gap_z", "matched_tempo_z", "near_even_dog_points", "matched_tempo_points",
    "weak_favorite_maximum_points", "medium_favorite_points", "large_favorite_points",
    "very_large_favorite_points", "slow_controller_tempo_z", "high_total_points"] as const;
  return typeof p.enabled === "boolean" && typeof p.version === "string" && Boolean(p.version)
    && keys.every(k => typeof p[k] === "number" && Number.isFinite(p[k]) && p[k] > 0)
    && p.matched_tempo_points < p.near_even_dog_points && p.large_favorite_points < p.very_large_favorite_points;
}
type Ratings = Record<string, Record<string, number>>;
export function ncaamSpreadReviewReasons(z: Ratings | undefined, side: string | null, line: number, p: NcaamSelectionReview) {
  if (!validSelectionReview(p)) return ["Selection review policy is unavailable"];
  if (!p.enabled) return [];
  if (!["home", "away"].includes(side || "") || !["home", "away"].every(loc =>
    ["offense", "defense", "tempo"].every(metric => typeof z?.[loc]?.[metric] === "number" && Number.isFinite(z[loc][metric]))))
    return ["Saved matchup factors are unavailable for selection review"];
  const picked = z![side!], other = z![side === "home" ? "away" : "home"];
  const offense = picked.offense - other.offense, defense = other.defense - picked.defense;
  const tempoGap = picked.tempo - other.tempo;
  const even = Math.abs(offense) < p.meaningful_efficiency_z && Math.abs(defense) < p.meaningful_efficiency_z;
  const reasons: string[] = [];
  if (line < 0) {
    const points = Math.abs(line);
    if (Math.max(offense, defense) < p.meaningful_efficiency_z && !(offense > 0 && defense > 0))
      reasons.push("A small advantage in only one efficiency is insufficient for a favorite");
    if (points > p.weak_favorite_maximum_points && picked.offense < 0 && picked.defense > 0)
      reasons.push("A below-average offense and weak defense cannot lay more than the configured modest spread");
    if (points >= p.medium_favorite_points && Math.max(picked.tempo, other.tempo) < 0
      && other.defense < 0 && picked.defense > -p.strong_defense_z)
      reasons.push("A slow matchup without a strong favorite defense is unsuitable for this spread");
    if (points >= p.large_favorite_points) {
      const required = points >= p.very_large_favorite_points ? p.very_strong_defense_z : p.strong_defense_z;
      if (picked.defense > -required)
        reasons.push("A large favorite needs a stronger national defense; fast tempo is insufficient");
      if (other.offense > 0 && other.tempo > 0)
        reasons.push("The large favorite faces an above-average offense with above-average tempo");
    }
  } else if (line > 0 && even && line < p.near_even_dog_points) {
    const fastDog = tempoGap >= p.tempo_gap_z;
    const matched = Math.abs(tempoGap) <= p.matched_tempo_z && line >= p.matched_tempo_points;
    if (!fastDog && !matched)
      reasons.push("Near-even efficiencies need more underdog points or the specified tempo fit");
  }
  return reasons;
}
