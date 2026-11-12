import { catalogEvaluationFor, catalogSignals } from "./footballTrendCatalog";
import { buildNcaafTrendSubtypes, ncaafTrendCategory, type NcaafPublicTrendSubtype } from "./ncaafPublicTrendLeaderboard";
import { ncaafRowsBeforeDecision, rankNcaafEzpzSubtypes, type NcaafEzpzSubtype } from "./ncaafEzpzWilson";
import { NCAAM_MARKET_POLICY, ncaamTeamKey } from "./ncaamMarketCore";
import { quoteImpliedProbability, regradeModelQuote } from "./modelSignalQuote";
import { buildConsolidatedLeaderboard, visibleConsolidatedBadges } from "./consolidatedSportTrends";
import { CONSOLIDATED_SPORT_EFFECTIVE_AT } from "./catalog/consolidatedSportCatalog";
import { ncaamMatchupGrade } from "./ncaamMatchupGrades";
import { ncaamSpreadGrade, ncaamSpreadQuote, spreadSelection } from "./ncaamSpreadGrades";

type Row = Record<string, any>;
export const NCAAM_SIGNALS_POLICY = { version: "ncaam-signals-2026-11-01-v1", prefix: "ncaam-signals-", launchAt: "2026-11-01T00:00:00.000Z" };
export const NCAAM_SIGNALS_TAB = "ncaam_signal_observations";
export const NCAAM_TREND_RECORDS_TAB = "ncaam_trend_records";
export const NCAAM_TREND_RECORD_POLICY = "ncaam-verified-final-v1";
export const NCAAM_ANALYSIS_TAB = "ncaam_analysis_state";

export function ncaamTrendGameKey(row: Row) {
  return `${row.date || row.Date}|${[row.awayTeam || row["Away Team"], row.homeTeam || row["Home Team"]].map(name => ncaamTeamKey(String(name || ""))).sort().join("|")}`;
}
export function ncaamTrendSignals(play: Row, siblings: Row[]) {
  return ncaafTrendCategory(play) ? catalogSignals(catalogEvaluationFor(play, siblings, "NCAAM"), "NCAAM") : [];
}
export function buildNcaamTrendSubtypes(rows: Record<string, string>[]): NcaafPublicTrendSubtype[] {
  return buildNcaafTrendSubtypes(rows.filter(row => row.Sport === "NCAAM" && row["NCAAM Record Policy"] === NCAAM_TREND_RECORD_POLICY
    && row["Market Policy"] === NCAAM_MARKET_POLICY), { sport: "NCAAM", signalsFor: ncaamTrendSignals, gameIdentity: ncaamTrendGameKey });
}
export function buildNcaamTrendLeaderboard(rows: Record<string, string>[], asOf = Date.now()): NcaafEzpzSubtype[] {
  if (asOf >= Date.parse(CONSOLIDATED_SPORT_EFFECTIVE_AT)) return buildConsolidatedLeaderboard("NCAAM", rows, asOf);
  return rankNcaafEzpzSubtypes(buildNcaamTrendSubtypes(ncaafRowsBeforeDecision(rows, asOf, undefined, ncaamTrendGameKey)));
}
export function visibleNcaamTrendBadges(play: Row, siblings: Row[], leaderboard: readonly NcaafPublicTrendSubtype[]) {
  if (leaderboard.some(type => type.signal.startsWith("split-group:"))) return visibleConsolidatedBadges("NCAAM", play, siblings, leaderboard);
  const memberships = new Set(ncaamTrendSignals(play, siblings)), category = ncaafTrendCategory(play);
  return leaderboard.slice(0, 20).filter(type => type.category === category && memberships.has(type.signal)
    && type.totals.wins * 5 > (type.totals.wins + type.totals.losses) * 3
    && (type.totals.netUnits ?? type.totals.unitsWon) > 0);
}

/** An NCAAM model vote comes only from a saved A/B forecast known at the decision. */
export function ncaamModelFor(play: Row, forecasts: Row[], asOf: number) {
  const selected = play.market === "Total" ? play.side : ncaamTeamKey(play.selectionTeam || play.selection);
  const forecast = forecasts.filter(f => Date.parse(f.lockedAt) <= asOf && Date.parse(f.lockedAt) < Date.parse(f.tipoff)
    && ncaamTeamKey(f.away_team) === ncaamTeamKey(play.awayTeam) && ncaamTeamKey(f.home_team) === ncaamTeamKey(play.homeTeam)
    && Date.parse(f.tipoff) === Date.parse(play.gameTime)).sort((a, b) => Date.parse(b.lockedAt) - Date.parse(a.lockedAt))[0];
  const line = play.line == null ? null : Number(play.line);
  const spread = forecast && play.market === "Spread" ? ncaamSpreadGrade(forecast) : null;
  if (spread) {
    const published = spread.record_mode === "live" && Date.parse(spread.published_at) <= asOf;
    const matches = ncaamTeamKey(spread.selection_team || "") === selected && ["A", "B"].includes(spread.grade);
    const quote = line != null && Number.isFinite(line) ? ncaamSpreadQuote(spread, line) : null;
    const price = quoteImpliedProbability(play.odds || "-110");
    const active = published && matches && quote != null && ["A", "B"].includes(quote.grade) && price != null && price <= 110 / 210;
    const reason = spread.record_mode === "replay" ? "Retrospective replay grades do not create pregame model signals."
      : !published ? "The spread grade was not published before this decision."
      : !matches ? "No qualifying spread grade on this projected cover side."
      : !quote || !["A", "B"].includes(quote.grade) ? quote?.reason || "The current spread is unavailable."
      : active ? quote.reason : "The current price does not qualify for the saved spread grade.";
    return { active, available: true, edge: matches ? quote?.edge ?? null : null, context: {
      play: matches && line != null ? `${spread.selection_team} ${line > 0 ? "+" : ""}${line}` : spreadSelection(spread),
      grade: matches ? quote?.grade || "Research" : spread.grade, version: spread.policy_version,
      projection: -spread.projected_margin, line: matches ? line : spread.line, probability: null, reason,
      regraded: matches && line != null && (line !== spread.line || quote?.grade !== spread.grade),
      originalPlay: spreadSelection(spread), originalGrade: spread.grade } };
  }
  const matchup = forecast && play.market === "Total" ? ncaamMatchupGrade(forecast) : null;
  if (matchup) {
    const published = Date.parse(matchup.published_at) <= asOf && matchup.record_mode === "live";
    const matches = matchup.side === selected && ["A", "B"].includes(matchup.grade);
    const noWorse = line != null && Number.isFinite(line) && (selected === "Over" ? line <= matchup.line : line >= matchup.line);
    const price = quoteImpliedProbability(play.odds || "-110");
    const active = published && matches && noWorse && price != null && price <= 110 / 210;
    const reason = matchup.record_mode === "replay" ? "Retrospective replay grades do not create pregame model signals."
      : !published ? "The matchup grade was not published before this decision."
      : !matches ? "No qualifying matchup grade on this side."
      : !noWorse ? "The current line is worse than the saved matchup selection."
      : active ? matchup.reason : "The current price does not qualify for the saved matchup grade.";
    return { active, available: true, edge: null, context: { play: matchup.side ? `${matchup.side} ${matchup.line}` : "",
      grade: matchup.grade, version: matchup.policy_version, projection: forecast.total, line: matchup.line,
      probability: null, reason } };
  }
  let projection: number | null = null, savedLine: number | null = null, pick = "", grade = "";
  if (forecast) {
    const away = selected === ncaamTeamKey(play.awayTeam);
    projection = play.market === "Total" ? forecast.total : away ? -forecast.fair_home_spread : forecast.fair_home_spread;
    savedLine = play.market === "Total" ? forecast.market?.total : away ? -forecast.market?.home_spread : forecast.market?.home_spread;
    pick = String(forecast[play.market === "Total" ? "total_pick" : "spread_pick"] || "");
    grade = String(forecast[play.market === "Total" ? "total_grade" : "spread_grade"] || "");
  }
  const matches = play.market === "Total" ? pick.startsWith(String(selected) + " ")
    : ncaamTeamKey(pick.replace(/\s+[+−-]?\d+(?:\.\d+)?$/, "")) === selected;
  const noWorse = savedLine != null && Number.isFinite(savedLine) && line != null && (play.market === "Spread" || selected === "Under" ? line >= savedLine : line <= savedLine);
  const edge = projection == null || line == null ? null : play.market === "Spread" ? line - projection : selected === "Over" ? projection - line : line - projection;
  const version = String(forecast?.modelVersion || "");
  const originalPlay = pick, originalGrade = grade;
  const delta = savedLine == null || line == null ? 0 : play.market === "Spread" || selected === "Under" ? line - savedLine : savedLine - line;
  const regraded = forecast && ["A", "B"].includes(grade) && matches && edge != null && savedLine != null && line != null
    ? regradeModelQuote({ sport: "NCAAM", market: play.market, side: selected, version, policy: forecast.grade_policy,
      savedLine, line, savedEdge: edge - delta, savedGrade: grade, probability: null, odds: String(play.odds || "-110") }) : null;
  const price = quoteImpliedProbability(play.odds || "-110");
  const savedProbability = forecast?.[play.market === "Total" ? "total_probability_estimate" : "spread_probability_estimate"];
  const priceOkay = price != null && (Number.isFinite(savedProbability) ? savedProbability > price : price <= 110 / 210);
  const active = regraded ? regraded.active : Boolean(forecast && ["A", "B"].includes(grade) && matches && noWorse && priceOkay);
  if (regraded) {
    grade = regraded.grade;
    pick = play.market === "Total" ? `${selected} ${line}` : `${play.selectionTeam || play.selection} ${line! > 0 ? "+" : ""}${line}`;
  }
  const reason = !forecast ? "No saved model forecast was available before this decision."
    : regraded ? regraded.reason : active ? "Matches a saved A/B NCAAM model forecast at an equal or better line."
    : !["A", "B"].includes(grade) || !matches ? "No qualifying A/B model forecast on this side."
    : !priceOkay ? "The current price no longer qualifies for the saved model forecast."
    : "The changed line needs a supported model re-evaluation; the saved grade is not carried forward automatically.";
  return { active, available: Boolean(forecast), edge, context: { play: pick, grade, version,
    projection, line: regraded ? line : savedLine, probability: regraded?.probability ?? null,
    ...(regraded ? { regraded: Math.abs(delta) > 1e-9 || grade !== originalGrade, originalPlay, originalGrade, probabilityEstimated: regraded.estimated } : {}),
    reason: reason + (forecast?.availability_mode === "rotowire_html"
      ? ` RotoWire availability checked; ${forecast.starters_confirmed ? "starting fives confirmed" : "projected starting fives"}. Unresolved statuses remain conditional.`
      : forecast?.injury_verified === false ? " Expected rotation; injury availability unchecked." : "") } };
}
