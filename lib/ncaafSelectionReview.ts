/** NCAAF preferences mirrored from the builder, using frozen pregame factors. */
export type NcaafSelectionReview = {
  version: string; enabled: boolean; basis?: string;
  minimum_attacking_pair_z: number; suppressed_attack_pair_z: number;
  strong_offense_z: number; average_band_z: number; slow_tempo_z: number; good_defense_z: number;
  medium_favorite_points: number; strong_attack_weak_opponent_maximum_points: number;
};
export type NcaafFactorsZ = Record<"home" | "away", Record<"offense" | "defense" | "tempo", number>>;
export function validNcaafSelectionReview(p: NcaafSelectionReview | undefined): p is NcaafSelectionReview {
  const keys = ["minimum_attacking_pair_z", "suppressed_attack_pair_z", "strong_offense_z", "average_band_z",
    "slow_tempo_z", "good_defense_z", "medium_favorite_points", "strong_attack_weak_opponent_maximum_points"] as const;
  return Boolean(p && p.version === "ryan-ncaaf-review-2026-11-13-v1" && typeof p.enabled === "boolean"
    && keys.every(k => typeof p[k] === "number" && Number.isFinite(p[k]) && p[k] > 0));
}
export function ncaafSpreadReviewReasons(z: NcaafFactorsZ, side: "home" | "away", line: number, p: NcaafSelectionReview) {
  if (!p.enabled) return [];
  const picked = z[side], other = z[side === "home" ? "away" : "home"];
  const attack = (picked.offense + other.defense) / 2, opposing = (other.offense + picked.defense) / 2;
  const reasons: string[] = [];
  if (line < 0) {
    if (attack < p.minimum_attacking_pair_z && opposing > -p.suppressed_attack_pair_z)
      reasons.push("Favorite lacks a clear attacking mismatch or a clear opposing-attack suppression case");
    if (picked.offense >= p.strong_offense_z && other.offense <= -p.strong_offense_z
      && Math.max(Math.abs(picked.defense), Math.abs(other.defense)) < p.average_band_z
      && Math.abs(line) > p.strong_attack_weak_opponent_maximum_points)
      reasons.push("Strong-attack favorite with average defenses exceeds the configured point ceiling");
  }
  return reasons;
}
export function ncaafTotalReviewReasons(z: NcaafFactorsZ, side: string, p: NcaafSelectionReview) {
  if (!p.enabled || side !== "Over") return [];
  const pairs = [(z.away.offense + z.home.defense) / 2, (z.home.offense + z.away.defense) / 2];
  return Math.max(...pairs) < p.minimum_attacking_pair_z
    ? ["Neither offense has a clearly favorable scoring matchup; fast tempo alone cannot support the Over"] : [];
}
