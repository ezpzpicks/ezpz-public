import { catalogEvaluationFor, catalogSignals } from "./footballTrendCatalog";
import { buildNcaafTrendSubtypes, ncaafTrendCategory, type NcaafPublicTrendSubtype } from "./ncaafPublicTrendLeaderboard";
import { ncaafRowsBeforeDecision, rankNcaafEzpzSubtypes, type NcaafEzpzSubtype } from "./ncaafEzpzWilson";
import { NBA_MARKET_POLICY, nbaTeamKey } from "./nbaMarketCore";

type Row = Record<string, any>;
export const NBA_SIGNALS_POLICY = { version: "nba-signals-2026-10-22-v1", prefix: "nba-signals-", launchAt: "2026-10-22T23:15:00.000Z" };
export const NBA_SIGNALS_TAB = "nba_signal_observations";
export const NBA_TREND_RECORDS_TAB = "nba_trend_records";
export const NBA_TREND_RECORD_POLICY = "nba-verified-final-v1";
export const NBA_ANALYSIS_TAB = "nba_analysis_state";

export function nbaTrendGameKey(row: Row) {
  return `${row.date || row.Date}|${[row.awayTeam || row["Away Team"], row.homeTeam || row["Home Team"]].map(name => nbaTeamKey(String(name || ""))).sort().join("|")}`;
}
export function nbaTrendSignals(play: Row, siblings: Row[]) {
  return ncaafTrendCategory(play) ? catalogSignals(catalogEvaluationFor(play, siblings, "NBA"), "NBA") : [];
}
export function buildNbaTrendSubtypes(rows: Record<string, string>[]): NcaafPublicTrendSubtype[] {
  return buildNcaafTrendSubtypes(rows.filter(row => row.Sport === "NBA" && row["NBA Record Policy"] === NBA_TREND_RECORD_POLICY
    && row["Market Policy"] === NBA_MARKET_POLICY), { sport: "NBA", signalsFor: nbaTrendSignals, gameIdentity: nbaTrendGameKey });
}
export function buildNbaTrendLeaderboard(rows: Record<string, string>[], asOf = Date.now()): NcaafEzpzSubtype[] {
  return rankNcaafEzpzSubtypes(buildNbaTrendSubtypes(ncaafRowsBeforeDecision(rows, asOf, undefined, nbaTrendGameKey)));
}
export function visibleNbaTrendBadges(play: Row, siblings: Row[], leaderboard: readonly NcaafPublicTrendSubtype[]) {
  const memberships = new Set(nbaTrendSignals(play, siblings)), category = ncaafTrendCategory(play);
  return leaderboard.slice(0, 20).filter(type => type.category === category && memberships.has(type.signal)
    && type.totals.wins * 5 > (type.totals.wins + type.totals.losses) * 3
    && (type.totals.netUnits ?? type.totals.unitsWon) > 0);
}

/** An NBA model vote comes only from a saved A/B forecast known at the decision. */
export function nbaModelFor(play: Row, forecasts: Row[], asOf: number) {
  const selected = play.market === "Total" ? play.side : nbaTeamKey(play.selectionTeam || play.selection);
  const forecast = forecasts.filter(f => Date.parse(f.lockedAt) <= asOf && Date.parse(f.lockedAt) < Date.parse(f.tipoff)
    && nbaTeamKey(f.away_team) === nbaTeamKey(play.awayTeam) && nbaTeamKey(f.home_team) === nbaTeamKey(play.homeTeam)
    && Date.parse(f.tipoff) === Date.parse(play.gameTime)).sort((a, b) => Date.parse(b.lockedAt) - Date.parse(a.lockedAt))[0];
  const line = play.line == null ? null : Number(play.line);
  let projection: number | null = null, savedLine: number | null = null, pick = "", grade = "";
  if (forecast) {
    const away = selected === nbaTeamKey(play.awayTeam);
    projection = play.market === "Total" ? forecast.total : away ? -forecast.fair_home_spread : forecast.fair_home_spread;
    savedLine = play.market === "Total" ? forecast.market?.total : away ? -forecast.market?.home_spread : forecast.market?.home_spread;
    pick = String(forecast[play.market === "Total" ? "total_pick" : "spread_pick"] || "");
    grade = String(forecast[play.market === "Total" ? "total_grade" : "spread_grade"] || "");
  }
  const matches = play.market === "Total" ? pick.startsWith(String(selected) + " ")
    : nbaTeamKey(pick.replace(/\s+[+−-]?\d+(?:\.\d+)?$/, "")) === selected;
  const noWorse = savedLine != null && Number.isFinite(savedLine) && line != null && (play.market === "Spread" || selected === "Under" ? line >= savedLine : line <= savedLine);
  const active = Boolean(forecast && ["A", "B"].includes(grade) && matches && noWorse);
  const edge = projection == null || line == null ? null : play.market === "Spread" ? line - projection : selected === "Over" ? projection - line : line - projection;
  const reason = !forecast ? "No saved model forecast was available before this decision."
    : active ? "Matches a saved A/B NBA model forecast at an equal or better line."
    : !["A", "B"].includes(grade) || !matches ? "No qualifying A/B model forecast on this side."
    : "The current line is worse than the saved qualifying model line; awaiting model re-evaluation.";
  return { active, available: Boolean(forecast), edge, context: { play: pick, grade, version: String(forecast?.modelVersion || ""),
    projection, line: savedLine, probability: null, reason: reason + (forecast?.injury_verified === false ? " Expected rotation; injury availability unchecked." : "") } };
}
