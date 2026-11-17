import { ncaamTeamKey } from "./ncaamTeamKey";

type Row = Record<string, any>;
type Points = Record<"away" | "home", number>;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const equal = (v: unknown, expected: number) => finite(v) && Math.abs(v - expected) <= 1e-7;
const time = (v: unknown) => typeof v === "string" && /(?:Z|[+-]\d{2}:\d{2})$/.test(v) ? Date.parse(v) : NaN;
const day = (clock: number) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date(clock));
const validDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && Number.isFinite(Date.parse(`${v}T12:00:00Z`)) && new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v;

function profile(rating: Row, season: number, clock: number): Row | null {
  const p = rating?.rebounding, observed = time(p?.observed_at);
  if (!p || p.policy !== "ncaam-d1-rebound-inputs-2026-11-16-v1" || p.season !== season
    || !ncaamTeamKey(p.team) || ncaamTeamKey(p.team) !== ncaamTeamKey(rating.team)
    || p.source_url !== `https://barttorvik.com/getgamestats.php?year=${season}&csv=1`
    || !/^[a-f0-9]{64}$/.test(p.source_sha256 || "")
    || !(observed <= clock && clock - observed <= 30 * 3600000)
    || !validDay(p.cutoff_date) || p.cutoff_date !== day(observed) || p.cutoff_date > day(clock)
    || !validDay(p.last_game_date) || p.last_game_date >= p.cutoff_date
    || !Number.isSafeInteger(p.d1_games) || p.d1_games < 1
    || !["orb", "drb", "opp_orb", "opp_drb"].every(k => Number.isSafeInteger(p[k]) && p[k] >= 0)) return null;
  const own = p.orb + p.opp_drb, opponent = p.opp_orb + p.drb;
  return own > 0 && opponent > 0 ? { ...p, orb_pct: p.orb / own, allowed_pct: p.opp_orb / opponent } : null;
}

/** Reconstruct each frozen rebound rule from its captured pregame box counts. */
export function ncaamReboundPoints(f: Row, baseline: Points, percentage: boolean): Points | null {
  const p = f.matchup_projection, r = p?.rebounding_adjustment;
  if (!r || r.policy !== (percentage ? "ncaam-rebound-percentage-zero-sum-2026-11-17-v2"
    : "ncaam-rebound-zero-sum-2026-11-16-v1") || r.experimental !== true
    || !equal(r.before_away_points, baseline.away) || !equal(r.before_home_points, baseline.home)
    || (percentage ? r.boost_fraction_per_edge_pp !== .15 / 20
      : r.points_per_edge_pp !== .2 || r.max_transfer_points !== 3 || r.full_weight_games !== 3)) return null;
  const a = profile(f.away_rating, p.season, time(f.lockedAt)), h = profile(f.home_rating, p.season, time(f.lockedAt));
  const available = a && h && ["source_sha256", "observed_at", "cutoff_date"].every(k => a[k] === h[k]);
  const expected: Row = { status: "unavailable", inputs: null, away_points: 0, home_points: 0,
    sample_weight: 0, home_edge_pp: null };
  if (percentage) Object.assign(expected, { favored_side: null, requested_boost_fraction: 0,
    requested_transfer_points: 0, applied_transfer_points: 0, score_floor_applied: false });
  if (available) {
    const awayScore = (a.orb_pct + h.allowed_pct) / 2, homeScore = (h.orb_pct + a.allowed_pct) / 2;
    const edge = 100 * (homeScore - awayScore);
    Object.assign(expected, { status: "applied", inputs: { away: a, home: h },
      away_matchup_score: awayScore, home_matchup_score: homeScore, home_edge_pp: edge });
    if (percentage) {
      const favored = edge > 0 ? "home" : edge < 0 ? "away" : null;
      const boost = Math.abs(edge) * (.15 / 20), other = favored === "home" ? "away" : "home";
      const requested = favored ? baseline[favored] * boost : 0;
      const applied = favored ? Math.min(requested, baseline[other]) : 0;
      const delta = favored === "home" ? applied : favored === "away" ? -applied : 0;
      Object.assign(expected, { sample_weight: 1, favored_side: favored,
        favored_baseline_points: favored ? baseline[favored] : null,
        requested_boost_fraction: boost, requested_transfer_points: requested, applied_transfer_points: applied,
        score_floor_applied: favored ? requested > baseline[other] : false, home_points: delta, away_points: -delta });
    } else {
      const weight = Math.min(1, Math.min(a.d1_games, h.d1_games) / 3), raw = .2 * edge;
      const capped = Math.max(-3, Math.min(3, raw));
      Object.assign(expected, { sample_weight: weight, uncapped_home_points: raw, capped_home_points: capped,
        home_points: capped * weight, away_points: -capped * weight });
    }
  }
  for (const [key, value] of Object.entries(expected)) {
    if (key === "inputs" && available) {
      for (const side of ["away", "home"] as const) for (const [field, input] of Object.entries(expected.inputs[side]))
        if (typeof input === "number" ? !equal(r.inputs?.[side]?.[field], input) : r.inputs?.[side]?.[field] !== input) return null;
    } else if (typeof value === "number" ? !equal(r[key], value) : r[key] !== value) return null;
  }
  const points = { away: expected.away_points as number, home: expected.home_points as number };
  for (const side of ["away", "home"] as const)
    if (!equal(p.adjustments?.[side]?.rebounding_points, points[side])) return null;
  return points;
}
