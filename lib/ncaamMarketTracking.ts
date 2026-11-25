/** Forward-only forecasts from a captured team baseline and paired market observations. */
import { ncaamPointProjection, NCAAM_POINT_MODEL } from "./ncaamPointEdges";
import { ncaamDate, ncaamTeamKey, NCAAM_MARKET_POLICY } from "./ncaamMarketCore";
import { ncaamFlowFeatures, ncaamMarketAdjustment, sameInputCappedComparator, validateMarketCapPolicy, marketNumber, marketTime, type MarketCapPolicy, type MarketPoint, type MarketName } from "./ncaamMarketFlow";
import { NCAAM_MARKET_TRACKING as P, NCAAM_REVERSED_SPREAD_MODEL, NCAAM_REVERSED_SPREAD_FROM, NCAAM_REVERSED_TOTAL_MODEL, NCAAM_REVERSED_TOTAL_FROM, isNcaamMarketTracked,
  type NcaamTrackingActivation, type NcaamTrackingInfo } from "./ncaamMarketTrackingPolicy";
type Row = Record<string, any>;
export type TrackingInputs = { histories: Record<MarketName, MarketPoint[]>; observedAt: string; finalPregame: boolean; source: string; sourceUrl?: string };
const pct = (value: unknown) => value == null || String(value).trim() === "" ? null : marketNumber(value);
export class NcaamTrackingDataPending extends Error {}
const canonical = (point: MarketPoint) => JSON.stringify([point.line, point.betsPct, point.moneyPct]);
export const materialNcaamHistory = (history: MarketPoint[]) => history.filter((point, i) => !i || canonical(point) !== canonical(history[i-1]));
export function ncaamTrackingInputs(game: Row, splits: Row[], now: number): TrackingInputs | null {
  const tip = marketTime(game["Game Time"]), gameId = String(game["Game ID"]);
  if (!(now < tip) || game.Status !== "STATUS_SCHEDULED") return null;
  const rows = splits.filter(r => String(r["Game ID"]) === gameId);
  if (!rows.length) return null;
  const histories = {} as Record<MarketName, MarketPoint[]>;
  const observed = new Set<string>(); let finalPregame = true;
  for (const market of ["Spread", "Total"] as const) {
    const matches = rows.filter(r => r.Market === market);
    const primary = matches.filter(r => market === "Spread" ? ncaamTeamKey(r.Selection) === ncaamTeamKey(game["Home Team"]) : String(r.Side || r.Selection).toLowerCase() === "over");
    const other = matches.filter(r => market === "Spread" ? ncaamTeamKey(r.Selection) === ncaamTeamKey(game["Away Team"]) : String(r.Side || r.Selection).toLowerCase() === "under");
    if (primary.length !== 1 || other.length !== 1) throw new Error("Paired spread and total observations are required.");
    const [a, b] = [primary[0], other[0]];
    for (const r of [a, b]) {
      if (r["Market Policy"] !== NCAAM_MARKET_POLICY || r.Source !== "ScoresAndOdds"
        || marketTime(r["Game Time"]) !== tip || ncaamTeamKey(r["Home Team"]) !== ncaamTeamKey(game["Home Team"])
        || ncaamTeamKey(r["Away Team"]) !== ncaamTeamKey(game["Away Team"])) throw new Error("Unverified market identity.");
      const t = marketTime(r["Updated At"]);
      if (t > now || t >= tip) throw new Error("Market observation was unavailable at capture.");
      if (now-t > P.maximum_market_age_minutes*60_000) throw new NcaamTrackingDataPending("Waiting for a fresh paired market observation.");
      observed.add(new Date(t).toISOString());
      finalPregame &&= r["Snapshot Status"] === "FINAL_PREGAME";
    }
    const decode = (row: Row) => {
      const raw = JSON.parse(row["Details JSON"] || "{}");
      if (raw.policy !== P.flow_policy && raw.policy !== NCAAM_MARKET_POLICY) throw new Error("Unverified movement history policy.");
      if (!Array.isArray(raw.movementHistory)) throw new Error("Movement history is missing.");
      const points = new Map<number, MarketPoint>();
      for (const point of raw.movementHistory) {
        const t = marketTime(point.snapshotTime);
        if (t > now || t >= tip) continue;
        const value = { snapshotTime: new Date(t).toISOString(), line: marketNumber(point.line), betsPct: pct(point.betsPct), moneyPct: pct(point.moneyPct) };
        if (points.has(t) && canonical(points.get(t)!) !== canonical(value)) throw new Error("Conflicting paired history.");
        points.set(t, value);
      }
      const t = marketTime(row["Updated At"]);
      const current = { snapshotTime: new Date(t).toISOString(), line: marketNumber(row.Line), betsPct: pct(row["Current Bets %"]), moneyPct: pct(row["Current Handle %"]) };
      if (points.has(t) && canonical(points.get(t)!) !== canonical(current)) throw new Error("Current quote contradicts captured history.");
      points.set(t, current);
      return points;
    };
    const ah = decode(a), bh = decode(b), end = marketTime(a["Updated At"]);
    const paired: MarketPoint[] = [];
    for (const [t, point] of [...ah.entries()].sort(([x], [y]) => x-y)) {
      const other = bh.get(t);
      if (!other || t > end) continue;
      const lineDiff = market === "Spread" ? point.line + other.line : point.line - other.line;
      if (Math.abs(lineDiff) > 1e-7 || ["betsPct", "moneyPct"].some(k => {
        const x = point[k as "betsPct"], y = other[k as "betsPct"];
        return x != null && y != null && Math.abs(x+y-100)>1.01;
      })) throw new Error("The paired quotes or split shares disagree.");
      paired.push(point);
    }
    if (!paired.length || marketTime(paired.at(-1)!.snapshotTime) !== end) throw new Error("Latest paired observation is unavailable.");
    histories[market] = paired;
  }
  if (observed.size !== 1) throw new Error("Both markets must share a captured timestamp.");
  const observedAt = [...observed][0];
  if (finalPregame) {
    const lead = (tip-marketTime(observedAt))/60_000;
    if (lead<10 || lead>20 || rows.some(r => r["Frozen At"] && marketTime(r["Frozen At"]) !== marketTime(observedAt))) throw new Error("Invalid final market capture.");
  }
  return { histories, observedAt, finalPregame, source: "ScoresAndOdds",
    sourceUrl: rows[0]["Source URL"] || `https://www.scoresandodds.com/ncaab/consensus-picks?date=${ncaamDate(tip)}` };
}
/** Saved same-provider quotes can supply price-only history without fabricating splits. */
export function ncaamBaselineTrackingInputs(base: Row, candidates: Row[], now: number): TrackingInputs {
  const market = base.market, end = marketTime(market.as_of), tip = marketTime(base.tipoff);
  const quotes = new Map<number, Row>();
  for (const f of candidates) {
    if (f.gameId!==base.gameId || f.tipoff!==base.tipoff || f.modelVersion!==base.modelVersion
      || f.market?.source!==market.source || f.market?.provider_id!==market.provider_id) continue;
    const observed = marketTime(f.market.as_of), locked = marketTime(f.lockedAt);
    if (observed>end || observed>locked || locked>now || locked>=tip) continue;
    const quote = { home_spread:marketNumber(f.market.home_spread),total:marketNumber(f.market.total) };
    if (quotes.has(observed) && JSON.stringify(quotes.get(observed))!==JSON.stringify(quote)) throw new Error("Conflicting captured fallback quotes.");
    quotes.set(observed,quote);
  }
  quotes.set(end,{home_spread:marketNumber(market.home_spread),total:marketNumber(market.total)});
  const points = [...quotes.entries()].sort(([a],[b])=>a-b);
  const history = (key: string): MarketPoint[] => points.map(([t,q])=>({snapshotTime:new Date(t).toISOString(),line:q[key],betsPct:null,moneyPct:null}));
  return { histories:{Spread:history("home_spread"),Total:history("total")},observedAt:new Date(end).toISOString(),finalPregame:false,source:market.source,sourceUrl:market.source_url };
}
export function ncaamTrackingFingerprint(base: Row, inputs: TrackingInputs, capPolicy?: MarketCapPolicy) {
  validateMarketCapPolicy(capPolicy);
  return { parameters: P, baselineRecordId: base.recordId,
    spread: materialNcaamHistory(inputs.histories.Spread), total: materialNcaamHistory(inputs.histories.Total), finalPregame: inputs.finalPregame, ...(capPolicy ? { adjustment_cap_policy: capPolicy } : {}) };
}
export function buildNcaamTrackedForecast(base: Row, inputs: TrackingInputs, activation: NcaamTrackingActivation, now: number, digest: string, capPolicy?: MarketCapPolicy, reversed = false, reversedSpread = false): Row {
  validateMarketCapPolicy(capPolicy);
  const p = ncaamPointProjection(base), tip = marketTime(base.tipoff), lock = marketTime(base.lockedAt);
  if (!p || base.modelVersion !== NCAAM_POINT_MODEL || now < marketTime(activation.activatedAt) || !(lock<=now && now<tip)
    || activation.modelVersion !== P.model_version || activation.policy !== P.flow_policy
    || now-marketTime(base.ratings_observed_at)>30*3600_000 || !/^[a-f0-9]{64}$/.test(digest)) throw new Error("A current unadjusted captured baseline is required.");
  const observed = marketTime(inputs.observedAt);
  if (observed>now || observed>=tip || now-observed>P.maximum_market_age_minutes*60_000
    || (inputs.finalPregame && lock>observed)) throw new Error("Final capture cannot use later baseline inputs.");
  for (const market of ["Spread","Total"] as const) {
    if (!inputs.histories[market]?.length || inputs.histories[market].some(point=>marketTime(point.snapshotTime)>observed)
      || marketTime(inputs.histories[market].at(-1)!.snapshotTime)!==observed) throw new Error("Market history must end at the captured paired quote.");
  }
  const clock = new Date(now).toISOString();
  const flows = { spread: ncaamFlowFeatures(inputs.histories.Spread, clock, base.tipoff, "Spread"), total: ncaamFlowFeatures(inputs.histories.Total, clock, base.tipoff, "Total") };
  const originalSpread = ncaamMarketAdjustment(p.margin, flows.spread, P, capPolicy), originalTotal = ncaamMarketAdjustment(p.total, flows.total, P, capPolicy);
  if (reversed && Math.min(observed,now)<Date.parse(NCAAM_REVERSED_TOTAL_FROM)) throw new Error("Observation predates total policy.");
  if (reversed && inputs.source!=="ScoresAndOdds" && (!base.market?.source || inputs.source!==base.market.source)) throw new Error("Unverified total adjustment source.");
  if (reversedSpread && (!reversed || Math.min(now,observed)<Date.parse(NCAAM_REVERSED_SPREAD_FROM))) throw new Error("Spread policy is not active.");
  const spreadDelta = -2 * originalSpread.adjustment || 0;
  const spread = reversedSpread ? { ...originalSpread, adjustment: spreadDelta, projection: p.margin + spreadDelta } : originalSpread;
  const version = reversedSpread ? NCAAM_REVERSED_SPREAD_MODEL : reversed ? NCAAM_REVERSED_TOTAL_MODEL : P.model_version;
  const delta = -2 * originalTotal.adjustment || 0;
  const total = reversed ? { ...originalTotal, adjustment: delta, projection: p.total + delta } : originalTotal;
  const sizing = capPolicy ? { adjustment_cap_policy: capPolicy, ...(capPolicy === "uncapped-v1" ?
    { capped_comparator: sameInputCappedComparator(ncaamMarketAdjustment(p.margin, flows.spread), ncaamMarketAdjustment(p.total, flows.total)) } : {}) } : {};
  const home = (total.projection+spread.projection)/2, away = (total.projection-spread.projection)/2;
  if (!(home>0 && away>0)) throw new Error("Adjusted team scores must remain positive.");
  const homeLine = inputs.histories.Spread.at(-1)!.line, totalLine = inputs.histories.Total.at(-1)!.line;
  const spreadEdge = spread.projection+homeLine, totalEdge = total.projection-totalLine;
  const auditSide = (edge: number) => Math.abs(edge)<1e-9 ? 0 : Math.sign(edge);
  const homePick = spreadEdge>0, pickedLine = homePick ? homeLine : -homeLine;
  const market_tracking: NcaamTrackingInfo = { policy: P.flow_policy, profile: P.profile,
    status: flows.spread.observations>1 || flows.total.observations>1 ? "applied" : "waiting_for_history", grade_status: "ungraded",
    baseline_forecast_record_id: base.recordId, baseline_model_version: base.modelVersion, baseline_captured_at: base.lockedAt,
    baseline_projection_sha256: p.sha256, baseline_margin: p.margin, baseline_total: p.total, baseline_home: p.home_points, baseline_away: p.away_points,
    decision_as_of: inputs.observedAt, published_at: clock, spread_adjustment: spread.adjustment, total_adjustment: total.adjustment,
    final_pregame: inputs.finalPregame, input_digest: digest, parameters: P, histories: inputs.histories,
    ...(reversedSpread ? { spread_policy_effective_at: NCAAM_REVERSED_SPREAD_FROM,
      original_spread_shadow: { ...originalSpread, home_line: homeLine, edge: originalSpread.projection+homeLine,
        original_side: auditSide(originalSpread.projection+homeLine), applied_side: auditSide(spreadEdge),
        discordant: auditSide(originalSpread.projection+homeLine)!==auditSide(spreadEdge) } } : {}),
    ...(reversed ? { total_policy_effective_at: NCAAM_REVERSED_TOTAL_FROM,
      original_total_shadow: { ...originalTotal, line: totalLine, edge: originalTotal.projection-totalLine,
        original_side: auditSide(originalTotal.projection-totalLine), applied_side: auditSide(totalEdge),
        discordant: auditSide(originalTotal.projection-totalLine)!==auditSide(totalEdge) } } : {}),
    market_models: { spread, total }, source: inputs.source, source_url: inputs.sourceUrl, ...sizing };
  const f = { ...base, modelVersion: version, projection_engine: version,
    recordId: `${base.gameId}|${version}|${digest}`, lockedAt: clock, phase: inputs.finalPregame ? "pregame" : (tip-now)/60_000<=90 ? "pregame" : "early",
    inputDigest: digest, away_score: away, home_score: home, fair_home_spread: -spread.projection, total: total.projection,
    home_spread_edge: spreadEdge, total_edge: totalEdge,
    market: { ...base.market, home_spread: homeLine, total: totalLine, as_of: inputs.observedAt, source: inputs.source, source_url:inputs.sourceUrl, odds: -110 },
    spread_pick: reversedSpread && !auditSide(spreadEdge) ? "No spread edge" : `${homePick ? base.home_team : base.away_team} ${pickedLine>0?"+":""}${pickedLine}`,
    total_pick: reversed && Math.abs(totalEdge)<1e-9 ? "No total edge" : `${totalEdge>=0?"Over":"Under"} ${totalLine}`, spread_grade: "Ungraded", total_grade: "Ungraded",
    grade_policy: P.grade_policy, grading_status: "awaiting_market_tracking_grades", official_pick_eligible: false,
    legacy_grade_eligible: false, market_tracking_effective_at: activation.activatedAt, market_tracking,
    spreadResult: "PENDING", totalResult: "PENDING" } as Row;
  for (const key of ["matchup_spread", "matchup_total", "numeric_total_pick", "numeric_total_grade", "numeric_total_edge", "numeric_totalResult", "numeric_spread_grade", "total_grade_policy", "spread_grade_policy"]) delete f[key];
  return f;
}
export function validNcaamTrackingForecast(f: Row, base: Row, activation: NcaamTrackingActivation, now: number) {
  try {
    const track = f.market_tracking as NcaamTrackingInfo;
    if (!isNcaamMarketTracked(f) || !track || marketTime(f.lockedAt)>now || track.baseline_forecast_record_id!==base.recordId
      || f.gameId!==base.gameId || f.tipoff!==base.tipoff || f.away_team!==base.away_team || f.home_team!==base.home_team
      || f.spread_grade!=="Ungraded" || f.total_grade!=="Ungraded" || f.official_pick_eligible!==false) return false;
    const inputs = { histories: track.histories, observedAt: track.decision_as_of, finalPregame: track.final_pregame, source: track.source, sourceUrl:track.source_url } as TrackingInputs;
    const capPolicy = track.adjustment_cap_policy;
    validateMarketCapPolicy(capPolicy);
    const reversedSpread = f.modelVersion===NCAAM_REVERSED_SPREAD_MODEL;
    const reversedTotal = reversedSpread || f.modelVersion===NCAAM_REVERSED_TOTAL_MODEL;
    const expected = buildNcaamTrackedForecast(base, inputs, activation, marketTime(f.lockedAt), track.input_digest, capPolicy,reversedTotal,reversedSpread);
    return ["total", "fair_home_spread", "away_score", "home_score", "home_spread_edge", "total_edge"].every(k =>
      typeof f[k]==="number" && Math.abs(f[k]-expected[k])<1e-7) && f.recordId===expected.recordId
      && f.market?.home_spread===expected.market.home_spread && f.market?.total===expected.market.total
      && ["policy","profile","baseline_model_version","baseline_captured_at","baseline_projection_sha256","baseline_margin","baseline_total","spread_adjustment","total_adjustment"].every(k=>track[k]===expected.market_tracking[k])
      && (!reversedSpread || (track.spread_policy_effective_at===NCAAM_REVERSED_SPREAD_FROM
        && f.spread_pick===expected.spread_pick && JSON.stringify(track.original_spread_shadow)===JSON.stringify(expected.market_tracking.original_spread_shadow)))
      && (!reversedTotal || (track.total_policy_effective_at===NCAAM_REVERSED_TOTAL_FROM
        && f.total_pick===expected.total_pick && f.total_grade==="Ungraded" && f.legacy_grade_eligible===false
        && JSON.stringify(track.original_total_shadow)===JSON.stringify(expected.market_tracking.original_total_shadow)
        && JSON.stringify(track.market_models)===JSON.stringify(expected.market_tracking.market_models)))
      && JSON.stringify(track.parameters)===JSON.stringify(P)
      && JSON.stringify(track.capped_comparator)===JSON.stringify(expected.market_tracking.capped_comparator);
  } catch { return false; }
}
export function mergeNcaamTrackingForecasts(baselines: Row[], tracked: Row[], activation: NcaamTrackingActivation | null, now: number): Row[] {
  if (!activation) return baselines;
  const cutoff = marketTime(activation.activatedAt), bases = new Map(baselines.map(f=>[f.recordId,f]));
  const updates = tracked.filter(f=>bases.has(f.market_tracking?.baseline_forecast_record_id)
    && validNcaamTrackingForecast(f,bases.get(f.market_tracking.baseline_forecast_record_id)!,activation,now));
  const updatedGames = new Set(updates.map(f=>f.gameId));
  return [...baselines.filter(f=>marketTime(f.lockedAt)<cutoff || !updatedGames.has(f.gameId)).map(f=>({ ...f,
    legacy_grade_eligible: marketTime(f.lockedAt)<cutoff,
    ...(marketTime(f.tipoff)>cutoff ? { grading_status: "awaiting_market_tracking_grades", market_tracking_effective_at: activation.activatedAt } : {}) })), ...updates];
}
