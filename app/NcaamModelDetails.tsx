import type { CollegeModelImpact } from "../lib/nbaLineupsCore";

type Rating = { team: string; offense: number; defense: number; tempo: number; prior_season?: number; prior_weight?: number;
  games_played?: number; prior_record?: string; prior_competition?: { strength_of_schedule: number | null; opponent_offense: number | null; opponent_defense: number | null } | null };
export type NcaamModelContext = { away_rating?: Rating; home_rating?: Rating; lineup_adjustment?: CollegeModelImpact | null;
  lineup_margin_change?: number; lineup_total_change?: number; baseline_away_score?: number; baseline_home_score?: number;
  availability_scenarios?: { player: string; team: string; homeMarginChange: number; totalChange: number }[] };
const signed = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}`;
export default function NcaamModelDetails({ forecast }: { forecast: NcaamModelContext }) {
  const { away_rating: away, home_rating: home, lineup_adjustment: impact } = forecast;
  if (!away || !home) return <p className="nbaSmall">Research forecast · Player availability unchecked · NCAAM grades pending validation</p>;
  return <details className="nbaLineups ncaamModelDetails"><summary><span>Model factors & player impact</span><span className="nbaLineupStatus">Research</span><span className="nbaLineupChevron" aria-hidden="true">⌄</span></summary>
    <div className="nbaLineupBody">
      <p className="nbaSmall">Offensive and defensive efficiencies account for opponent strength, schedule and level of competition. Each offense faces the opposing defense; tempo sets expected possessions.</p>
      <div className="nbaLineupTeams">{([away, home] as Rating[]).map((rating, index) => {
        const teamImpact = impact?.[index === 0 ? "away" : "home"], competition = rating.prior_competition;
        return <section className="nbaLineupTeam" key={rating.team}><h4>{rating.team}</h4>
          <p className="nbaSmall">{rating.prior_season ? `${rating.prior_season - 1}–${String(rating.prior_season).slice(-2)} prior: ${Math.round((rating.prior_weight || 0) * 100)}% · ${rating.games_played ?? 0} current-season games` : "Dated team ratings"}</p>
          <dl className="nbaMetrics"><div><dt>Adjusted offense</dt><dd>{rating.offense.toFixed(1)}</dd></div><div><dt>Adjusted defense</dt><dd>{rating.defense.toFixed(1)}</dd></div><div><dt>Tempo</dt><dd>{rating.tempo.toFixed(1)}</dd></div></dl>
          {competition?.opponent_offense != null && competition?.opponent_defense != null && <p className="nbaSmall">Prior opponents’ adjusted offense / defense: {competition.opponent_offense.toFixed(1)} / {competition.opponent_defense.toFixed(1)}{competition.strength_of_schedule != null ? ` · Torvik SOS ${competition.strength_of_schedule.toFixed(3)}` : ""}</p>}
          {teamImpact && <><p className="nbaSmall">Roster & availability: offense {signed(teamImpact.offense_change_per_100)} / defense improvement {signed(teamImpact.defense_improvement_per_100)} per 100 possessions.</p>
            {teamImpact.flags.map(flag => <p className="nbaSmall" key={flag}>{flag}</p>)}
            {teamImpact.players.length > 0 && <details className="ncaamRotation"><summary>Player minutes & ratings</summary><div className="ncaamRotationScroll"><table><caption>200 team minutes · OUT/Doubtful excluded · Questionable assumed IN</caption><thead><tr><th>Player</th><th>Prior min</th><th>Model min</th><th>OBPM</th><th>DBPM</th></tr></thead><tbody>{teamImpact.players.map(p => <tr key={p.ratingId}><td>{p.name}{p.status !== "UNKNOWN" ? ` · ${p.status.toLowerCase()}` : ""}</td><td>{p.referenceMinutes.toFixed(1)}</td><td>{p.minutes.toFixed(1)}</td><td>{signed(p.offensiveImpact)}</td><td>{signed(p.defensiveImpact)}</td></tr>)}</tbody></table></div></details>}
          </>}
        </section>;
      })}</div>
      {!impact && <p className="nbaSmall">College player impact inputs are unavailable. This forecast retains the team baseline.</p>}
      {forecast.lineup_margin_change != null && <p className="nbaSmall">Roster & availability effect: home margin {signed(forecast.lineup_margin_change)} pts · total {signed(forecast.lineup_total_change || 0)} pts{forecast.baseline_away_score != null && forecast.baseline_home_score != null ? ` · Team-only score ${forecast.baseline_away_score.toFixed(1)}–${forecast.baseline_home_score.toFixed(1)}` : ""}.</p>}
      {forecast.availability_scenarios?.map(s => <p className="nbaSmall" key={`${s.team}|${s.player}`}>If {s.player} is out: home margin {signed(s.homeMarginChange)} pts · total {signed(s.totalChange)} pts versus this forecast.</p>)}
      <p className="nbaSmall">Current results gain weight as games are played. Player effects use college OBPM/DBPM and minutes relative to the baseline rotation. The ten-game prior and player effects remain research estimates.</p>
      {impact && <p className="nbaLineupSource"><a href={impact.ratingsSourceUrl} target="_blank" rel="noreferrer">College player ratings</a> · Forecast inputs {new Date(impact.as_of).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })} ET</p>}
    </div>
  </details>;
}
