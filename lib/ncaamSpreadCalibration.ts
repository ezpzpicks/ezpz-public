export const NCAAM_SPREAD_MODEL = "ncaam-spread-prior-calibration-b-2026-11-22-v1";
export const NCAAM_SPREAD_CALIBRATION = {
  version: NCAAM_SPREAD_MODEL,
  scale: 0.8308142655650089,
  training_games: 5714,
  training_through: "2025-11-30",
  frozen_at: "2026-11-22T04:19:41.409352+00:00",
} as const;
export const NCAAM_SPREAD_B_SELECTION = {
  version: "ncaam-spread-b-only-2026-11-22-v1",
  minimum_point_edge: 5,
  maximum_point_edge_exclusive: 7,
} as const;
export function validNcaamSpreadBSelection(value: unknown): value is typeof NCAAM_SPREAD_B_SELECTION {
  return !!value && typeof value === "object" && Object.keys(value).length === 3
    && Object.entries(NCAAM_SPREAD_B_SELECTION).every(([key, expected]) => (value as Record<string, unknown>)[key] === expected);
}
