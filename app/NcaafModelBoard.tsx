import { MatchupWithLogos, SelectionWithTeamLogo } from "./TeamLogoName";
import FootballModelFormBadges from "./FootballModelFormBadges";
import NcaafModelDetails from "./NcaafModelDetails";
import { ncaafMatchupContext, type NcaafMatchupContext } from "../lib/ncaafMatchupFactors";

type Row = Record<string, string>;
type Play = { playType?: string; play?: string; role?: string; marketOdds?: string; oddsLine?: string;
  score?: string | number; gradingPolicyVersion?: string };
type Group = { game: string; time: string; row: Row | null; plays: Play[] };
type Market = "Spread" | "Total";
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
function Score({ row, game, actual = false }: { row: Row; game: string; actual?: boolean }) {
  const pair = teams(row, game);
  const away = actual ? numeric(row["Away Score"]) ?? numeric(row["Actual Away"]) : numeric(row["Projected Away"]);
  const home = actual ? numeric(row["Home Score"]) ?? numeric(row["Actual Home"]) : numeric(row["Projected Home"]);
  if (actual && (away == null || home == null)) return null;
  return <div className="nbaScoreBlock"><p className="nbaSmall">{actual ? status(row) === "Final" ? "Final score" : "Current score" : "Projected score"}</p>
    <div className="nbaScore"><div><span>{pair.away}</span><strong>{away == null ? "—" : actual ? String(away) : away.toFixed(1)}</strong></div>
      <div><span>{pair.home}</span><strong>{home == null ? "—" : actual ? String(home) : home.toFixed(1)}</strong></div></div>
  </div>;
}
function MatchupGrade({ context, market, row }: { context: NcaafMatchupContext; market: Market; row: Row }) {
  const grade = market === "Spread" ? context.spread : context.total;
  const { factors } = context;
  return <div className="ncaamGradeDetails">
    <p className="nbaSmall"><strong>{market === "Spread" ? "Spread matchup grade" : "Matchup grade"}</strong> · Saved before kickoff</p>
    <p className="nbaSmall">{grade.reason}</p>
    <details><summary>{market === "Spread" ? "Projection, offense, defense & tempo" : "Offense, defense & tempo factors"}</summary>
      {market === "Spread" ? <p className="nbaSmall">Projected home margin {signed(row["Projected Margin"])} · Cover edge {decimal(row["Spread Edge"])} points.</p> : null}
      {([factors.away, factors.home]).map(team => <section key={team.team}><h5>{team.team}</h5>
        <dl className="nbaMetrics">{(["offense", "defense", "tempo"] as const).map(metric => {
          const z = (team[metric] - factors.national[metric].mean) / factors.national[metric].sd;
          const label = Math.abs(z) < .5 ? "Near national average" : metric === "tempo" ? z > 0 ? "Fast" : "Slow"
            : metric === "defense" ? z > 0 ? "Weak defense" : "Good defense" : z > 0 ? "Strong offense" : "Weak offense";
          return <div key={metric}><dt>{metric === "tempo" ? "Tempo" : `Adjusted ${metric}`}</dt><dd>{label}</dd></div>;
        })}</dl>
      </section>)}
      <p className="nbaSmall">Compared with the saved FBS national benchmark. Lower adjusted defense means fewer points allowed. A/B matchup grades require projection agreement and a qualifying saved price.</p>
    </details>
  </div>;
}
function ForecastCard({ group, qualifiedOnly = false, tracker, today }: { group: Group; qualifiedOnly?: boolean; tracker: Row[]; today?: string }) {
  const row = group.row || {}, pair = teams(row, group.game);
  const hasForecast = numeric(row["Projected Away"]) != null && numeric(row["Projected Home"]) != null;
  const context = ncaafMatchupContext(row);
  const markets = (["Spread", "Total"] as const).flatMap(name => {
    const play = group.plays.find(candidate => marketOf(candidate) === name);
    if (qualifiedOnly && !play) return [];
    const margin = numeric(row["Projected Margin"]);
    const selection = qualifiedOnly ? play?.play || row[`${name} Pick`] : row[`${name} Pick`];
    const result = tracker.find(record => record["Game ID"] && record["Game ID"] === row["Game ID"]
      && record["Bet Type"] === name && record.Selection === selection)?.Result;
    return [{ name, play, selection, result, grade: gradeLabel(qualifiedOnly ? play?.playType : row[`${name} Grade`]),
      model: name === "Spread" ? margin == null ? "—" : signed(-margin) : decimal(row["Projected Total"]),
      line: name === "Spread" ? signed(row["Market Home Spread"]) : decimal(row["Market Total"]),
      edge: numeric(row[`${name} Edge`]), odds: row[`${name} Odds`] || play?.marketOdds || play?.oddsLine || "",
      probability: numeric(row[`${name} Probability`]) ?? numeric(play?.score) }];
  });
  const gameStatus = status(row);
  return <article className="nbaCard" data-game-id={row["Game ID"] || group.game}>
    <h3><MatchupWithLogos sport="NCAAF" game={`${pair.away} @ ${pair.home}`} /></h3>
    <p className="nbaMeta"><time>{time(group.time)}</time><span>{hasForecast || qualifiedOnly ? "Saved forecast" : "Scheduled"}</span>{gameStatus ? <span>{gameStatus}</span> : null}</p>
    {hasForecast || qualifiedOnly ? <>
      <NcaafModelDetails row={row} />
      <Score row={row} game={group.game} />
      <div className="nbaMarkets">{markets.map(market => <section className="nbaMarketCard" key={market.name} aria-label={`${market.name} forecast`}>
        <div className="nbaMarketHeading"><h4>{market.name}</h4><span className="nbaGrade" data-grade={market.grade}>Grade {market.grade}</span></div>
        <strong className="nbaSelection"><SelectionWithTeamLogo sport="NCAAF" selection={market.selection || "No market line"} game={group.game} /></strong>
        <dl className="nbaMetrics"><div><dt>{market.name === "Spread" ? "Model home spread" : "Model total"}</dt><dd>{market.model}</dd></div>
          <div><dt>{market.name === "Spread" ? "Market home spread" : "Market total"}</dt><dd>{market.line}</dd></div>
          <div><dt>Edge</dt><dd>{market.edge == null ? "—" : `${Math.abs(market.edge).toFixed(1)} pts`}</dd></div></dl>
        {market.odds || market.probability != null ? <p className="nbaSmall">{market.odds ? `Odds ${market.odds}` : ""}{market.odds && market.probability != null ? " · " : ""}{market.probability != null ? `Model probability ${(Math.abs(market.probability) <= 1 ? market.probability * 100 : market.probability).toFixed(1)}%` : ""}</p> : null}
        {context ? <MatchupGrade context={context} market={market.name} row={row} /> : null}
        {qualifiedOnly && market.play ? <FootballModelFormBadges rows={tracker.filter(record => !market.play?.gradingPolicyVersion || record["Grading Policy Version"] === market.play.gradingPolicyVersion)}
          today={today} grade={market.play.playType} market={market.name} selection={market.selection} /> : null}
        {market.result ? <p className="nbaSmall">Result: <strong>{market.result}</strong></p> : null}
      </section>)}</div>
    </> : <>
      <p className="nbaNotice">No saved model forecast for this matchup.</p>
      <dl className="nbaMarketQuotes"><div><dt>Market home spread · {pair.home}</dt><dd>{signed(row["Market Home Spread"] || row["Home Spread"])}</dd></div>
        <div><dt>Market total</dt><dd>{decimal(row["Market Total"] || row.Total)}</dd></div></dl>
    </>}
    <Score row={row} game={group.game} actual />
    {context ? <p className="nbaSmall">SP+ inputs captured {time(context.factors.observed_at)} · Saved pregame factors</p> : null}
  </article>;
}

export default function NcaafModelBoard({ fullSlate, rows, groups, tracker = [], today }: {
  fullSlate: boolean; rows: Row[]; groups: Group[]; tracker?: Row[]; today?: string;
}) {
  const cards = fullSlate ? rows.map(row => ({ row, game: row.Game || `${row["Away Team"]} @ ${row["Home Team"]}`,
    time: row["Game Time"] || row.Time || row["Start Time"] || row["Game Time ET"] || "", plays: [] })) : groups;
  return <section className="nbaBoard ncaafModelBoard">
    <div className="nbaIntro"><h2>NCAAF {fullSlate ? "Full Slate" : "Model Plays"}</h2></div>
    {cards.map(group => <ForecastCard key={group.row?.["Game ID"] || group.game} group={group} qualifiedOnly={!fullSlate} tracker={tracker} today={today} />)}
    {!cards.length ? <div className="nbaCard">{fullSlate ? "No NCAAF games have been collected for this date." : "No qualifying A/B Model Plays have been saved for this slate yet."}</div> : null}
  </section>;
}
