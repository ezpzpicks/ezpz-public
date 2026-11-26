import { footballProjectionDisplay } from "../lib/footballProjectionDisplay";
import { useSlateDisplayFinals } from "./SlateDisplayFinals";
import { displayFinalForRow, type SlateDisplayFinal } from "../lib/slateDisplayFinals";
import CompactMatchup, { savedNumber } from "./CompactMatchup";
import { MatchupWithLogos, SelectionWithTeamLogo } from "./TeamLogoName";
import FootballModelFormBadges from "./FootballModelFormBadges";
import NcaafModelDetails from "./NcaafModelDetails";
import { ncaafMatchupContext, NCAAF_PROJECTION_MODEL, type NcaafMatchupContext } from "../lib/ncaafMatchupFactors";
import { modelFactorLabel } from "../lib/modelFactorLabels";
import { marketProjectionPending, projectionAdjustments, trackingModelVersion } from "../lib/marketProjectionPolicy";
import ProjectionAdjustment from "./ProjectionAdjustment";
import { selectedSpreadSide } from "../lib/selectionSide";

type Row = Record<string, string>;
type Play = { playType?: string; play?: string; role?: string; marketOdds?: string; oddsLine?: string;
  score?: string | number; gradingPolicyVersion?: string };
type Group = { game: string; time: string; row: Row | null; plays: Play[] };
type Market = "Spread" | "Total";
type Sport = "NFL" | "NCAAF";
const numeric = (value: unknown) => {
  if (value == null || String(value).trim() === "") return null;
  const n = Number(value); return Number.isFinite(n) ? n : null;
};
const decimal = (value: unknown) => numeric(value)?.toFixed(1) ?? "—";
const signed = (value: unknown) => {
  const n = numeric(value); return n == null ? "—" : `${n > 0 ? "+" : ""}${Number(n.toFixed(1))}`;
};
const gradeLabel = (value: unknown) => String(value || "").match(/^([AB])(?:\s|$)/)?.[1] || "Research";
const marketOf = (play: Play): Market | null => /total/i.test(`${play.role} ${play.playType}`) ? "Total"
  : /spread/i.test(`${play.role} ${play.playType}`) ? "Spread" : null;
function time(value: string) {
  if (!value) return "Time unavailable";
  if (/(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)))
    return new Date(value).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }) + " ET";
  return /\bET$/i.test(value) ? value : `${value} ET`;
}
function teams(row: Row, game: string) {
  const pair = game.split(/\s+(?:@|at|vs\.?)\s+/i);
  return { away: row["Away Team"] || pair[0] || "Away", home: row["Home Team"] || pair[1] || "Home" };
}
function status(row: Row) {
  if (/^(true|1|yes)$/i.test(row.Completed || "") || /FINAL/i.test(row.Status || "")) return "Final";
  if (/IN_PROGRESS/i.test(row.Status || "")) return "In progress";
  return "";
}
function Score({ row, game, actual = false, final }: { row: Row; game: string; actual?: boolean; final?: SlateDisplayFinal }) {
  const pair = final ? {away:final.awayTeam,home:final.homeTeam} : teams(row, game);
  const adjustment = actual ? null : projectionAdjustments(row);
  const away = actual ? final?.awayScore ?? numeric(row["Away Score"]) ?? numeric(row["Actual Away"]) : numeric(row["Projected Away"]);
  const home = actual ? final?.homeScore ?? numeric(row["Home Score"]) ?? numeric(row["Actual Home"]) : numeric(row["Projected Home"]);
  if (actual && (away == null || home == null)) return null;
  return <div className={`nbaScoreBlock ${actual && (final || status(row) === "Final") ? "actualFinalScore" : ""}`}><p className="nbaSmall">{actual ? final || status(row) === "Final" ? "Final score" : "Current score" : "Projected score"}</p>
    <div className="nbaScore"><div><span>{pair.away}</span><strong>{away == null ? "—" : actual ? String(away) : away.toFixed(1)}<ProjectionAdjustment points={adjustment?.awayScore} label={`${pair.away} score`} /></strong></div>
      <div><span>{pair.home}</span><strong>{home == null ? "—" : actual ? String(home) : home.toFixed(1)}<ProjectionAdjustment points={adjustment?.homeScore} label={`${pair.home} score`} /></strong></div></div>
  </div>;
}
function MatchupGrade({ context, market, row }: { context: NcaafMatchupContext; market: Market; row: Row }) {
  const { factors } = context;
  return <div className="ncaamGradeDetails">
    <details><summary>{market === "Spread" ? "Projection, offense, defense & tempo" : "Offense, defense & tempo factors"}</summary>
      {market === "Spread" ? <p className="nbaSmall">Projected home margin {signed(row["Projected Margin"])} · Cover edge {decimal(row["Spread Edge"])} points.</p> : null}
      {([factors.away, factors.home]).map(team => <section key={team.team}><h5>{team.team}</h5>
        <dl className="nbaMetrics">{(["offense", "defense", "tempo"] as const).map(metric => {
          const z = (team[metric] - factors.national[metric].mean) / factors.national[metric].sd;
          const label = modelFactorLabel(z, metric);
          return <div key={metric}><dt>{metric === "tempo" ? "Tempo" : `Adjusted ${metric}`}</dt><dd>{label}</dd></div>;
        })}</dl>
      </section>)}
    </details>
  </div>;
}
function ForecastCard({ group, sport, qualifiedOnly = false, tracker, today }: { group: Group; sport: Sport; qualifiedOnly?: boolean; tracker: Row[]; today?: string }) {
  const saved = group.row || {};
  const row = qualifiedOnly ? saved : footballProjectionDisplay(saved, sport), pair = teams(row, group.game);
  const preview = sport === "NCAAF" && row["Build Phase"] === "preview";
  const pending = preview || marketProjectionPending(row), adjustments = projectionAdjustments(row);
  const hasForecast = numeric(row["Projected Away"]) != null && numeric(row["Projected Home"]) != null;
  const context = pending || sport !== "NCAAF" ? null : ncaafMatchupContext(row);
  const matchupDriven = sport === "NCAAF" && row["Projection Engine"] === NCAAF_PROJECTION_MODEL;
  const markets = (["Spread", "Total"] as const).flatMap(name => {
    const play = group.plays.find(candidate => marketOf(candidate) === name);
    if (qualifiedOnly && !play) return [];
    const margin = numeric(row["Projected Margin"]);
    const selection = qualifiedOnly ? play?.play || row[`${name} Pick`] : row[`${name} Pick`];
    const awaySpread = selectedSpreadSide(sport, selection, pair.away, pair.home,
      margin, numeric(row["Market Home Spread"])) === "away";
    const spreadSign = awaySpread ? -1 : 1;
    const result = tracker.find(record => record["Game ID"] && record["Game ID"] === row["Game ID"]
      && record["Bet Type"] === name && record.Selection === selection)?.Result;
    const savedGrade = name === "Spread" ? context?.spread : context?.total;
    return [{ name, play, selection, result, grade: pending ? "Ungraded" : gradeLabel(qualifiedOnly ? play?.playType
        : savedGrade?.grading_basis === "market_point_edge" ? savedGrade.edge_grade : row[`${name} Grade`]),
      held: savedGrade?.grading_basis === "market_point_edge" && savedGrade.eligible === false,
      model: name === "Spread" ? margin == null ? "—" : signed(-spreadSign * margin) : decimal(row["Projected Total"]),
      line: name === "Spread" ? numeric(row["Market Home Spread"]) == null ? "—" : signed(spreadSign * Number(row["Market Home Spread"])) : decimal(row["Market Total"]),
      spreadTeam: awaySpread ? pair.away : pair.home,
      adjustment: name === "Spread" ? awaySpread ? adjustments?.awaySpread : adjustments?.homeSpread : adjustments?.total,
      edge: numeric(row[`${name} Edge`]), odds: row[`${name} Odds`] || play?.marketOdds || play?.oddsLine || "",
      probability: pending ? null : numeric(row[`${name} Probability`]) ?? numeric(play?.score) }];
  });
  const finals = useSlateDisplayFinals();
  const final = sport === "NFL" ? displayFinalForRow(finals, row) : undefined;
  const gameStatus = final ? "Final" : status(row);
  const card = <article className="nbaCard" data-game-id={row["Game ID"] || group.game}>
    <h3><MatchupWithLogos sport={sport} game={`${pair.away} @ ${pair.home}`} /></h3>
    <p className="nbaMeta"><time>{time(group.time)}</time>{gameStatus ? <span className="gameStatus" data-status={gameStatus}>{gameStatus}</span> : null}</p>
    {hasForecast || qualifiedOnly ? <>
      {row["Projection Engine"] === "legacy_fallback" ? <p className="nbaSmall">Matchup inputs unavailable</p> : null}
      {preview ? <p className="nbaSmall">Morning preview · Ungraded projection; awaiting the normal builder save.</p> : null}
      <Score row={row} game={group.game} />
      <div className="nbaMarkets">{markets.map(market => <section className="nbaMarketCard" key={market.name} aria-label={`${market.name} forecast`}>
        <div className="nbaMarketHeading"><h4>{market.name}</h4><span className="nbaGrade" data-grade={market.grade}>{pending ? "Ungraded" : `Grade ${market.grade}`}</span></div>
        {market.held && market.grade !== "Research" ? <p className="nbaSmall">Projection only · Saved eligibility or price check did not qualify.</p> : null}
        <strong className="nbaSelection"><SelectionWithTeamLogo sport={sport} selection={market.selection || "No market line"} game={group.game} /></strong>
        <dl className="nbaMetrics"><div><dt>{market.name === "Spread" ? "Model spread" : "Model total"}</dt><dd title={market.name === "Spread" ? market.spreadTeam : undefined}>{market.model}
          <ProjectionAdjustment points={market.adjustment} label={market.name === "Spread" ? `${market.spreadTeam} strength` : "total"} /></dd></div>
          <div><dt>{market.name === "Spread" ? "Market spread" : "Market total"}</dt><dd>{market.line}</dd></div>
          <div><dt>Edge</dt><dd>{market.edge == null ? "—" : `${Math.abs(market.edge).toFixed(1)} pts`}</dd></div></dl>
        {market.odds || market.probability != null ? <p className="nbaSmall">{market.odds ? `Odds ${market.odds}` : ""}{market.odds && market.probability != null ? " · " : ""}{market.probability != null ? `${matchupDriven ? "Uncalibrated simulation" : "Model probability"} ${(Math.abs(market.probability) <= 1 ? market.probability * 100 : market.probability).toFixed(1)}%` : ""}</p> : null}
        {context ? <MatchupGrade context={context} market={market.name} row={row} /> : null}
        {qualifiedOnly && market.play ? <FootballModelFormBadges rows={tracker.filter(record => !market.play?.gradingPolicyVersion || record["Grading Policy Version"] === market.play.gradingPolicyVersion)}
          today={today} grade={market.play.playType} market={market.name} selection={market.selection} /> : null}
        {market.result ? <p className="nbaSmall">Result: <strong>{market.result}</strong></p> : null}
      </section>)}</div>
      {sport === "NCAAF" ? <NcaafModelDetails row={row} /> : null}
      {sport === "NFL" && row.Reliability ? <details className="forecastDetails"><summary>Model details</summary><p className="nbaSmall">Reliability {row.Reliability}</p></details> : null}
    </> : <>
      <p className="nbaNotice">No saved model forecast for this matchup.</p>
      <dl className="nbaMarketQuotes"><div><dt>Market home spread · {pair.home}</dt><dd>{signed(row["Market Home Spread"] || row["Home Spread"])}</dd></div>
        <div><dt>Market total</dt><dd>{decimal(row["Market Total"] || row.Total)}</dd></div></dl>
    </>}
    <Score row={row} game={group.game} actual final={final} />
    {context ? <p className="nbaSmall">SP+ inputs captured {time(context.factors.observed_at)}</p> : null}
  </article>;
  return <CompactMatchup id={row["Game ID"] || group.game} sport={sport} away={pair.away} home={pair.home} awayScore={savedNumber(row["Projected Away"])} homeScore={savedNumber(row["Projected Home"])} awayAdjustment={adjustments?.awayScore} homeAdjustment={adjustments?.homeScore}
    time={time(group.time)} status={gameStatus || (hasForecast ? "Preview" : "Pending")}
    markets={hasForecast || qualifiedOnly ? markets.map(market => ({name:market.name, selection:market.selection || "No market line", ...(!qualifiedOnly && row["Model Version"]===trackingModelVersion(sport,true) ? {projection:market.model,adjustment:market.adjustment} : {}), detail:market.edge == null ? "Edge unavailable" : `${Math.abs(market.edge).toFixed(1)} pt edge`, grade:qualifiedOnly ? pending ? "Ungraded" : `Grade ${market.grade}` : undefined, result:market.result})) : []}
    finalScore={final ? {away:final.awayScore,home:final.homeScore,awayTeam:final.awayTeam,homeTeam:final.homeTeam} : gameStatus === "Final" ? {away:row["Away Score"] || row["Actual Away"] || "—", home:row["Home Score"] || row["Actual Home"] || "—"} : undefined}
    returnLabel={qualifiedOnly ? "Back to Model Plays" : "Back to slate"}>{card}</CompactMatchup>;
}

export default function NcaafModelBoard({ sport = "NCAAF", fullSlate, rows, groups, tracker = [], today }: {
  sport?: Sport; fullSlate: boolean; rows: Row[]; groups: Group[]; tracker?: Row[]; today?: string;
}) {
  const cards = fullSlate ? rows.map(row => ({ row, game: row.Game || `${row["Away Team"]} @ ${row["Home Team"]}`,
    time: row["Game Time"] || row.Time || row["Start Time"] || row["Game Time ET"] || "", plays: [] })) : groups;
  const completed = cards.filter(group => status(group.row || {}) === "Final");
  const activeCards = cards.filter(group => status(group.row || {}) !== "Final")
    .sort((a, b) => Number(status(b.row || {}) === "In progress") - Number(status(a.row || {}) === "In progress"));
  const card = (group: Group) => <ForecastCard key={group.row?.["Game ID"] || group.game} sport={sport} group={group} qualifiedOnly={!fullSlate} tracker={tracker} today={today} />;
  return <section className={`nbaBoard ${sport === "NCAAF" ? "ncaafModelBoard" : "nflModelBoard"}`}>
    <div className="nbaIntro"><h2>{sport} {fullSlate ? "Projections" : "Model Plays"}</h2></div>
    {fullSlate ? <>{activeCards.map(card)}{completed.length ? <details className="completedGames" open={!activeCards.length}>
      <summary>Completed games <span>{completed.length}</span></summary><div className="completedGamesList">{completed.map(card)}</div>
    </details> : null}</> : cards.map(card)}
    {!cards.length ? <div className="nbaCard">{fullSlate ? `No ${sport} games have been collected for this date.` : rows.some(marketProjectionPending)
      ? `New ${sport} grades are pending. Updated projections are available in Projections.` : `No ${sport} model plays for this slate.`}</div> : null}
  </section>;
}
