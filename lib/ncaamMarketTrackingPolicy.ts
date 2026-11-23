// Fixed rollout parameters; checked against the JSON config and Python parity fixtures.
const parameters = {
  "model_version": "ncaam-v0.17-market-tracking-2026-11-22",
  "flow_policy": "ncaam-directional-market-flow-2026-11-22-v3",
  "profile": "balanced",
  "grade_policy": "ncaam-market-tracking-ungraded-2026-11-22-v1",
  "grade": "Ungraded",
  "activation": "First successful deployed collector tick; immutable activation record; forward only",
  "feature_order": [
    "line_movement",
    "money_movement",
    "money_ticket_divergence",
    "ticket_only_movement",
    "same_window_confirmation",
    "lagged_confirmation"
  ],
  "weights": [
    1,
    2,
    1,
    0.5,
    0.5,
    0.25
  ],
  "minimum_adjustment": 1,
  "spread_cap": 4,
  "total_cap": 6,
  "half_life_minutes": 120,
  "confirmation_lookback_minutes": 60,
  "unconfirmed_split_multiplier": 0.25,
  "divergence_split_multiplier": 0.75,
  "full_confirmation_points": 2,
  "opposing_price_damping_per_point": 0.25,
  "maximum_market_age_minutes": 90,
  "baseline_model": "ncaam-v0.16-calibrated-b-spreads-2026-11-22",
  "official_pick_eligible": false,
  "regrade_history": false
} as const;
export const NCAAM_MARKET_TRACKING = parameters;
export const NCAAM_MARKET_TRACKING_MODEL = parameters.model_version;
export const NCAAM_TRACKING_FORECAST_TAB = "ncaam_market_projection_updates";
export const NCAAM_TRACKING_ACTIVATION_TAB = "ncaam_market_projection_activation";
export type NcaamTrackingActivation = { policy: string; modelVersion: string; activatedAt: string; gradingStatus: "ungraded" };
export type NcaamTrackingInfo = { policy: string; profile: string; status: "applied" | "waiting_for_history";
  grade_status: "ungraded"; baseline_forecast_record_id: string; baseline_model_version: string;
  baseline_captured_at: string; baseline_margin: number; baseline_total: number;
  baseline_home: number; baseline_away: number; decision_as_of: string; published_at: string;
  spread_adjustment: number; total_adjustment: number; final_pregame: boolean;
  input_digest: string; [key: string]: unknown };
export const isNcaamMarketTracked = (forecast: Record<string, any> | undefined) => forecast?.modelVersion === NCAAM_MARKET_TRACKING_MODEL;
export const ncaamTrackingGradesPending = (forecast: Record<string, any> | undefined) =>
  isNcaamMarketTracked(forecast) || forecast?.grading_status === "awaiting_market_tracking_grades";
