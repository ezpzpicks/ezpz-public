import { footballTeamKey } from "./footballTeamTrends";
import { ncaamFlowFeatures, ncaamMarketAdjustment, type MarketPoint, type MarketName } from "./ncaamMarketFlow";
import { MARKET_PROJECTION_PARAMETERS as P, MARKET_PROJECTION_POLICY, trackingModelVersion,
  type TrackingSport, type MarketProjectionActivation } from "./marketProjectionPolicy";

type Row = Record<string, any>;
export type ProjectionBaseline = { sourceDataset?: "daily_slate" | "game_previews"; sport: TrackingSport; recordId: string; gameId: string; date: string; tipoff: string;
  lockedAt: string; modelVersion: string; away_team: string; home_team: string; home_score: number; away_score: number;
  total: number; fair_home_spread: number; original: Row };
export type ProjectionInputs = { histories: Record<MarketName, MarketPoint[]>; observedAt: string; finalPregame: boolean; source: "ScoresAndOdds" };
export class ProjectionDataPending extends Error {}
export const projectionNumber = (v: unknown): number | null => v == null || typeof v === "boolean" || String(v).trim() === "" || !Number.isFinite(Number(v)) ? null : Number(v);
export function projectionTime(value: unknown) {
  const raw = String(value || "").trim();
  return /(?:Z|[+-]\d\d:\d\d| EST| EDT)$/.test(raw) ? Date.parse(raw.replace(/ EST$/, " -0500").replace(/ EDT$/, " -0400")) : NaN;
}
export const projectionGameKey = (sport: TrackingSport, date: string, away: string, home: string, tipoff: string) =>
  `${date}|${sport}|${footballTeamKey(away, sport)}|${footballTeamKey(home, sport)}|${projectionTime(tipoff)}`;
export function normalizeProjectionBaseline(sport: TrackingSport, row: Row, date: string, tipoff: string): ProjectionBaseline | null {
  if (row.market_tracking || row["Market Tracking JSON"]) return null;
  const nba = sport === "NBA", away = String(nba ? row.away_team : row["Away Team"] || ""), home = String(nba ? row.home_team : row["Home Team"] || "");
  const lockedAt = nba ? row.lockedAt : row["Build At"] || row["Build Captured At"];
  const captured = projectionTime(lockedAt), tip = projectionTime(tipoff);
  if (!away || !home || !Number.isFinite(captured) || !Number.isFinite(tip) || captured >= tip
    || /FINAL|IN_PROGRESS|CANCEL|POSTPON/.test(String(row.Status || "")) || /^(TRUE|YES|1)$/i.test(String(row.Completed || ""))) return null;
  let margin = nba ? -(projectionNumber(row.fair_home_spread) ?? NaN) : projectionNumber(row["Projected Margin"]);
  let total = projectionNumber(nba ? row.total : row["Projected Total"]);
  // Independent NFL spread/total models retain their full precision in saved proofs.
  if (sport === "NFL") {
    try { const c = JSON.parse(row["Spread Model JSON"] || "null"); if (c?.ready) margin = projectionNumber(c.margin); } catch { return null; }
    try { const c = JSON.parse(row["Total Model JSON"] || "null"); if (c?.ready) total = projectionNumber(c.tree_total); } catch { return null; }
  }
  const modelVersion = String(nba ? row.modelVersion : row["Model Version"] || "");
  if (!modelVersion || modelVersion.includes("market-tracking") || margin == null || !Number.isFinite(margin) || total == null
    || !(total > Math.abs(margin))) return null;
  const homeScore = (total + margin) / 2, awayScore = (total - margin) / 2;
  for (const [value, expected] of [[nba ? row.home_score : row["Projected Home"], homeScore], [nba ? row.away_score : row["Projected Away"], awayScore]]) {
    const n = projectionNumber(value); if (n == null || Math.abs(n - Number(expected)) > .2) return null;
  }
  const key = projectionGameKey(sport, date, away, home, tipoff);
  return { sport, recordId: String(row.recordId || `${key}|${captured}|${modelVersion}`), gameId: String(nba ? row.gameId : row["Game ID"] || key),
    date, tipoff: new Date(tip).toISOString(), lockedAt: new Date(captured).toISOString(), modelVersion,
    away_team: away, home_team: home, home_score: homeScore, away_score: awayScore, total, fair_home_spread: -margin, original: row };
}

/** Paired side histories must share the same sport, teams, kickoff and observation. */
export function projectionTrackingInputs(base: ProjectionBaseline, rows: Row[], now: number): ProjectionInputs {
  const tip = projectionTime(base.tipoff), team = (v: unknown) => footballTeamKey(String(v || ""), base.sport);
  const matches = rows.filter(r => r.Date === base.date && team(r["Away Team"]) === team(base.away_team)
    && team(r["Home Team"]) === team(base.home_team) && projectionTime(r["Game Time"]) === tip);
  const histories = {} as Record<MarketName, MarketPoint[]>;
  let observedAt = "", finalPregame = true;
  const canonical = (p: MarketPoint) => JSON.stringify([p.line, p.betsPct, p.moneyPct]);
  for (const market of ["Spread", "Total"] as const) {
    const selected = (r: Row, primary: boolean) => r.Market === market && (market === "Spread"
      ? team(r.Selection) === team(primary ? base.home_team : base.away_team)
      : String(r.Side || r.Selection).toLowerCase() === (primary ? "over" : "under"));
    const first = matches.filter(r => selected(r, true)), second = matches.filter(r => selected(r, false));
    if (first.length !== 1 || second.length !== 1) throw new ProjectionDataPending("Waiting for a complete paired spread and total market.");
    const decode = (r: Row) => {
      if (r.Source !== "ScoresAndOdds") throw new Error("Unverified market source.");
      const end = projectionTime(r["Updated At"]);
      if (!Number.isFinite(end) || end > now || end >= tip || now - end > P.maximum_market_age_minutes * 60000)
        throw new ProjectionDataPending("Waiting for fresh pregame market observations.");
      const iso = new Date(end).toISOString();
      if (observedAt && observedAt !== iso) throw new Error("Paired markets have different observation times.");
      observedAt = iso; finalPregame &&= r["Snapshot Status"] === "FINAL_PREGAME";
      const raw = JSON.parse(r["Details JSON"] || "{}");
      if (!Array.isArray(raw.movementHistory)) throw new ProjectionDataPending("Waiting for verified movement history.");
      const points = new Map<number, MarketPoint>();
      const add = (t: number, line: unknown, bets: unknown, money: unknown) => {
        if (!Number.isFinite(t) || t > end || t >= tip) return;
        const value = projectionNumber(line), b = projectionNumber(bets), m = projectionNumber(money);
        if (value == null || [b, m].some(n => n != null && (n < 0 || n > 100))) throw new Error("Invalid reported quote or split share.");
        const placeholder = b === m && (b === 0 || b === 100);
        const p = { snapshotTime: new Date(t).toISOString(), line: value, betsPct: placeholder ? null : b, moneyPct: placeholder ? null : m };
        if (points.has(t) && canonical(points.get(t)!) !== canonical(p)) throw new Error("Conflicting market observations.");
        points.set(t, p);
      };
      for (const p of raw.movementHistory) add(projectionTime(p.snapshotTime), p.line, p.betsPct, p.moneyPct);
      add(end, r.Line, r["Current Bets %"], r["Current Handle %"]);
      if (r["Frozen At"] && projectionTime(r["Frozen At"]) !== end) throw new Error("Final quote disagrees with its frozen time.");
      return points;
    };
    const a = decode(first[0]), b = decode(second[0]), paired: MarketPoint[] = [];
    for (const [t, p] of [...a.entries()].sort(([x], [y]) => x - y)) {
      const other = b.get(t); if (!other) continue;
      if (Math.abs(market === "Spread" ? p.line + other.line : p.line - other.line) > 1e-7
        || ["betsPct", "moneyPct"].some(k => { const x = p[k as "betsPct"], y = other[k as "betsPct"]; return x != null && y != null && Math.abs(x + y - 100) > 1.01; }))
        throw new Error("Paired lines or split shares disagree.");
      paired.push(p);
    }
    if (!paired.length || paired.at(-1)!.snapshotTime !== observedAt) throw new Error("The latest quote lacks a paired observation.");
    histories[market] = paired;
  }
  const lead = (tip - projectionTime(observedAt)) / 60000;
  if (finalPregame && (lead < 10 || lead > 20)) throw new Error("Final capture is outside the existing pregame window.");
  return { histories, observedAt, finalPregame, source: "ScoresAndOdds" };
}
export function projectionFingerprint(base: ProjectionBaseline, inputs: ProjectionInputs) {
  const material = (h: MarketPoint[]) => h.filter((p, i) => !i || JSON.stringify([p.line, p.betsPct, p.moneyPct]) !== JSON.stringify([h[i-1].line, h[i-1].betsPct, h[i-1].moneyPct]));
  return { policy: MARKET_PROJECTION_POLICY, parameters: P, baseline: base, spread: material(inputs.histories.Spread), total: material(inputs.histories.Total), final: inputs.finalPregame };
}
export function buildMarketTrackedProjection(base: ProjectionBaseline, inputs: ProjectionInputs, activation: MarketProjectionActivation, now: number, digest: string): Row {
  const tip = projectionTime(base.tipoff), observed = projectionTime(inputs.observedAt), captured = projectionTime(base.lockedAt);
  if (base.sport === "NCAAF" && inputs.finalPregame && (base.sourceDataset === "game_previews" || base.original["Build Phase"] === "preview"))
    throw new Error("A morning preview cannot create a final pregame lock.");
  if (activation.sport !== base.sport || activation.policy !== MARKET_PROJECTION_POLICY || activation.modelVersion !== trackingModelVersion(base.sport)
    || projectionTime(activation.activatedAt) > now || !/^[a-f0-9]{64}$/.test(digest) || !(captured <= now && now < tip)
    || tip <= projectionTime(activation.activatedAt) || now - captured > 30 * 3600000 || observed > now || observed >= tip
    || now - observed > P.maximum_market_age_minutes * 60000 || (inputs.finalPregame && captured > observed)) throw new Error("A current captured baseline and pregame market are required.");
  for (const market of ["Spread", "Total"] as const) {
    if (!inputs.histories[market]?.length || inputs.histories[market].at(-1)!.snapshotTime !== inputs.observedAt
      || inputs.histories[market].some(p => projectionTime(p.snapshotTime) > observed)) throw new Error("Market histories must end at the saved quote.");
  }
  if (inputs.finalPregame && ((tip - observed) / 60000 < 10 || (tip - observed) / 60000 > 20)) throw new Error("Invalid final pregame capture.");
  const at = new Date(now).toISOString(), spreadFlow = ncaamFlowFeatures(inputs.histories.Spread, at, base.tipoff, "Spread", P), totalFlow = ncaamFlowFeatures(inputs.histories.Total, at, base.tipoff, "Total", P);
  const spread = ncaamMarketAdjustment(-base.fair_home_spread, spreadFlow, P), total = ncaamMarketAdjustment(base.total, totalFlow, P);
  const home = (total.projection + spread.projection) / 2, away = (total.projection - spread.projection) / 2;
  if (!(home > 0 && away > 0)) throw new Error("Adjusted team scores must remain positive.");
  const homeLine = inputs.histories.Spread.at(-1)!.line, totalLine = inputs.histories.Total.at(-1)!.line;
  const spreadEdge = spread.projection + homeLine, totalEdge = total.projection - totalLine, homePick = spreadEdge >= 0, line = homePick ? homeLine : -homeLine;
  const info = { policy: MARKET_PROJECTION_POLICY, sport: base.sport, profile: "balanced", status: spreadFlow.observations > 1 || totalFlow.observations > 1 ? "applied" : "waiting_for_history",
    grade_status: "ungraded", baseline_forecast_record_id: base.recordId, baseline_model_version: base.modelVersion, baseline_captured_at: base.lockedAt,
    baseline_margin: -base.fair_home_spread, baseline_total: base.total, baseline_home: base.home_score, baseline_away: base.away_score,
    decision_as_of: inputs.observedAt, published_at: at, spread_adjustment: spread.adjustment, total_adjustment: total.adjustment,
    final_pregame: inputs.finalPregame, input_digest: digest, parameters: P, histories: inputs.histories, baseline: base, source: inputs.source,
    market_models: { spread, total } };
  return { ...base.original, sport: base.sport, gameId: base.gameId, recordId: `${base.gameId}|${trackingModelVersion(base.sport)}|${digest}`,
    modelVersion: trackingModelVersion(base.sport), tipoff: base.tipoff, lockedAt: at, phase: inputs.finalPregame || tip - now <= 90 * 60000 ? "pregame" : "early",
    away_team: base.away_team, home_team: base.home_team, home_score: home, away_score: away, home_margin: spread.projection,
    fair_home_spread: -spread.projection, total: total.projection, home_spread_edge: spreadEdge, total_edge: totalEdge,
    spread_pick: `${homePick ? base.home_team : base.away_team} ${line > 0 ? "+" : ""}${line}`, total_pick: `${totalEdge >= 0 ? "Over" : "Under"} ${totalLine}`,
    market: { home_spread: homeLine, total: totalLine, as_of: inputs.observedAt, source: inputs.source, odds: -110 },
    spread_grade: "Ungraded", total_grade: "Ungraded", grading_status: "awaiting_market_tracking_grades", legacy_grade_eligible: false,
    grade_policy: MARKET_PROJECTION_POLICY, official_pick_eligible: false, eligible_for_posting: false,
    spread_probability_estimate: null, total_probability_estimate: null, market_tracking: info,
    market_tracking_effective_at: activation.activatedAt, spreadResult: "PENDING", totalResult: "PENDING" };
}
export function validMarketTrackedProjection(value: Row, activation: MarketProjectionActivation, now: number) {
  try {
    const info = value.market_tracking, base = info.baseline as ProjectionBaseline;
    if (value.sport !== activation.sport || value.modelVersion !== activation.modelVersion || projectionTime(value.lockedAt) > now
      || value.spread_grade !== "Ungraded" || value.total_grade !== "Ungraded" || value.official_pick_eligible !== false
      || base.sport !== activation.sport || value.tipoff !== base.tipoff || value.gameId !== base.gameId
      || value.home_team !== base.home_team || value.away_team !== base.away_team) return false;
    const rebuilt = buildMarketTrackedProjection(base, { histories: info.histories, observedAt: info.decision_as_of, finalPregame: info.final_pregame, source: info.source }, activation, projectionTime(value.lockedAt), info.input_digest);
    return ["total", "fair_home_spread", "home_score", "away_score", "home_spread_edge", "total_edge", "recordId", "market", "market_tracking"].every(k => JSON.stringify(value[k]) === JSON.stringify(rebuilt[k]));
  } catch { return false; }
}
export const publicTrackedProjection = (f: Row) => ({ ...f, market_tracking: Object.fromEntries(Object.entries(f.market_tracking || {}).filter(([k]) => !["baseline", "parameters", "histories"].includes(k))) });
export function trackedFootballRow(row: Row, f: Row | undefined, activation: MarketProjectionActivation): Row {
  const hold = { ...row, "Market Tracking Grade Status": "ungraded", "Market Tracking Effective At": activation.activatedAt,
    "Spread Grade": "Ungraded", "Total Grade": "Ungraded", "Spread Probability": "", "Total Probability": "" };
  if (!f) return hold;
  const info = publicTrackedProjection(f).market_tracking;
  return { ...hold, "Projected Home": String(f.home_score), "Projected Away": String(f.away_score), "Projected Margin": String(-f.fair_home_spread), "Projected Total": String(f.total),
    "Spread Pick": f.spread_pick, "Total Pick": f.total_pick, "Spread Edge": String(Math.abs(f.home_spread_edge)), "Total Edge": String(Math.abs(f.total_edge)),
    "Market Home Spread": String(f.market.home_spread), "Market Total": String(f.market.total), "Market Tracking JSON": JSON.stringify(info),
    "Market Tracking Updated At": f.lockedAt, "Baseline Model Version": row["Model Version"], "Model Version": f.modelVersion };
}
