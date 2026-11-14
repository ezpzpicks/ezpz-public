/** Label standardized ratings against each sport's saved national benchmark. */
export function modelFactorLabel(value: number, metric: string, extreme = 1, veryExtreme = 1.5) {
  if (!Number.isFinite(value)) return "Unavailable";
  const strength = Math.abs(value) >= veryExtreme ? "Very " : "";
  const label = metric === "tempo" ? value > 0 ? "fast" : "slow"
    : metric === "defense" ? value > 0 ? "weak defense" : "good defense"
    : value > 0 ? "strong offense" : "weak offense";
  return Math.abs(value) < .001 ? "National average" : Math.abs(value) >= extreme ? `${strength}${label}`
    : `${value > 0 ? "Above" : "Below"} average${metric === "defense" ? value > 0 ? " (weaker)" : " (better)" : ""}`;
}
