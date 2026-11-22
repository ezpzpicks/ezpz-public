/** Frozen prior-season scoring allowance; no line or outcome is an input. */
export const NCAAM_OVERTIME_POLICY = "ncaam-prior-november-overtime-2026-11-21-v1";
export const NCAAM_OVERTIME_PARAMETERS = {
  intercept: -2.49259655302214,
  squared_margin_coefficient: -0.41691748228307984,
  neutral_coefficient: 0.04107807768514364,
  margin_scale: 10,
  conditional_mean_periods: 1.1993355481727574,
  training_home_court: 3.2,
  regulation_minutes: 40,
  overtime_minutes: 5,
  training_games: 5714,
  training_through: "2025-11-30",
} as const;

export function ncaamExpectedOvertime(regulationTotal: number, baseHomeMargin: number, homeCourt: number, neutral: boolean) {
  if (![regulationTotal, baseHomeMargin, homeCourt].every(Number.isFinite) || regulationTotal <= 0
    || typeof neutral !== "boolean" || homeCourt < 0 || homeCourt > 8 || (neutral && homeCourt !== 0)) return null;
  const p = NCAAM_OVERTIME_PARAMETERS;
  const margin = baseHomeMargin-homeCourt+(neutral ? 0 : p.training_home_court);
  const logit = p.intercept+p.squared_margin_coefficient*(margin/p.margin_scale)**2+p.neutral_coefficient*Number(neutral);
  const e = Math.exp(logit < 0 ? logit : -logit);
  const probability = logit < 0 ? e/(1+e) : 1/(1+e);
  const points = regulationTotal*p.overtime_minutes/p.regulation_minutes*probability*p.conditional_mean_periods;
  return { policy: NCAAM_OVERTIME_POLICY, parameters: {...NCAAM_OVERTIME_PARAMETERS},
    estimated_overtime_probability: probability, expected_extra_total_points: points,
    regulation_total: regulationTotal, total_including_expected_overtime: regulationTotal+points };
}
