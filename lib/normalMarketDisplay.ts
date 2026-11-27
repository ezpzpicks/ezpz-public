import { MARKET_PROJECTION_POLICY, REVERSED_MARKET_FROM, REVERSED_MARKET_POLICY, trackingModelVersion, type TrackingSport } from "./marketProjectionPolicy";
const close = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a-b) <= 1e-6;

export function normalMarketDisplay(t: Record<string, any> | undefined, sport: TrackingSport, tip: number, locked: number,
  away: string, home: string, line: number, totalLine: number, savedMargin: number, savedTotal: number, savedHome: number, savedAway: number) {
  if (!t || t.sport !== sport || t.policy !== MARKET_PROJECTION_POLICY || t.status !== "applied"
    || t.adjustment_policy !== REVERSED_MARKET_POLICY || t.adjustment_policy_effective_at !== REVERSED_MARKET_FROM || t.source !== "ScoresAndOdds") return null;
  const observed = Date.parse(t.decision_as_of), captured = Date.parse(t.baseline_captured_at);
  if (!(observed >= Date.parse(REVERSED_MARKET_FROM) && observed <= locked && captured <= locked
    && locked === Date.parse(t.published_at) && locked < tip && (!t.final_pregame || captured <= observed))) return null;
  const spread = t.original_spread_shadow, points = t.original_total_shadow;
  function matches(shadow: typeof spread, base: number, applied: number, projection: number) {
    return shadow && [shadow.baseline,shadow.adjustment,shadow.projection,base,applied].every(Number.isFinite)
      && close(shadow.baseline,base) && close(shadow.projection,base+shadow.adjustment)
      && close(applied,-2*shadow.adjustment) && close(projection,base+applied);
  }
  if (!matches(spread,t.baseline_margin,t.spread_adjustment,savedMargin)
    || !matches(points,t.baseline_total,t.total_adjustment,savedTotal)
    || !Number.isFinite(line) || !Number.isFinite(totalLine) || totalLine<=0
    || spread.home_line !== line || points.line !== totalLine
    || !close(savedHome,(savedTotal+savedMargin)/2) || !close(savedAway,(savedTotal-savedMargin)/2)) return null;
  const margin = spread.baseline+2*spread.adjustment, total = points.baseline+2*points.adjustment;
  if (!(total>Math.abs(margin))) return null;
  const edge = margin+line, totalEdge = total-totalLine, pickLine = edge>0 ? line : -line;
  return { margin,total,edge,totalEdge,homeScore:(total+margin)/2,awayScore:(total-margin)/2,
    spreadPick:Math.abs(edge)<1e-9 ? "No spread edge" : `${edge>0?home:away} ${pickLine>0?"+":""}${pickLine}`,
    totalPick:Math.abs(totalEdge)<1e-9 ? "No total edge" : `${totalEdge>0?"Over":"Under"} ${totalLine}`,
    tracking:{...t,spread_adjustment:2*spread.adjustment,total_adjustment:2*points.adjustment}};
}

export function nbaNormalDisplay<T extends Record<string, any>>(saved:T, game?:Record<string,string>):T {
  const t=saved.market_tracking, m=saved.market, tip=Date.parse(saved.tipoff);
  if (saved.modelVersion!==trackingModelVersion("NBA",true) || !t || !m || !game || saved.gameId!==game["Game ID"]
    || saved.recordId!==`${saved.gameId}|${saved.modelVersion}|${t.input_digest}`
    || saved.home_team!==game["Home Team"] || saved.away_team!==game["Away Team"] || tip!==Date.parse(game["Game Time"])
    || m.source!==t.source || Date.parse(m.as_of)!==Date.parse(t.decision_as_of)) return saved;
  const v=normalMarketDisplay(t,"NBA",tip,Date.parse(saved.lockedAt),saved.away_team,saved.home_team,
    m.home_spread,m.total,-saved.fair_home_spread,saved.total,saved.home_score,saved.away_score);
  return v ? {...saved, fair_home_spread:-v.margin,home_margin:v.margin,total:v.total,home_score:v.homeScore,away_score:v.awayScore,
    home_spread_edge:v.edge,total_edge:v.totalEdge,spread_pick:v.spreadPick,total_pick:v.totalPick,market_tracking:v.tracking} : saved;
}
