import type { CollegeModelImpact } from "../lib/nbaLineupsCore";
import type { NcaamMatchupGrade } from "../lib/ncaamMatchupGrades";
import type { NcaamSpreadGrade } from "../lib/ncaamSpreadGrades";
import type { NcaamPointProjection } from "../lib/ncaamPointEdges";
import { ncaamTrackingGradesPending, type NcaamTrackingInfo } from "../lib/ncaamMarketTrackingPolicy";

type Rating = { team: string; offense: number; defense: number; tempo: number; prior_season?: number; prior_weight?: number;
  games_played?: number | null; d1_games_played?: number | null; source_preseason_prior?: boolean;
  prior_record?: string; prior_competition?: { strength_of_schedule: number | null; opponent_offense: number | null; opponent_defense: number | null } | null };
export type NcaamModelContext = { away_rating?: Rating; home_rating?: Rating; lineup_adjustment?: CollegeModelImpact | null;
  matchup_projection?: NcaamPointProjection;
  market_tracking?: NcaamTrackingInfo; grading_status?: string;
  matchup_total?: NcaamMatchupGrade; matchup_spread?: NcaamSpreadGrade; numeric_total_pick?: string;
  lineup_margin_change?: number; lineup_total_change?: number; baseline_away_score?: number; baseline_home_score?: number;
  availability_scenarios?: { player: string; team: string; homeMarginChange: number; totalChange: number }[] };
const signed = (n: number | null) => n == null ? "Unavailable" : `${n > 0 ? "+" : ""}${n.toFixed(1)}`;
export default function NcaamModelDetails({ forecast, displayedTotalAdjustment }: { forecast: NcaamModelContext; displayedTotalAdjustment?: number }) {
  const { away_rating: away, home_rating: home, lineup_adjustment: impact } = forecast;
  if (!away || !home) return <p className="nbaSmall">Team factor details unavailable · Player availability unchecked</p>;
  const grade = forecast.matchup_total;
  const badges = ncaamTrackingGradesPending(forecast) ? "Ungraded" : [forecast.matchup_spread?.side ? `Spread ${forecast.matchup_spread.grade}` : "", grade?.side ? `Total ${grade.grade}` : ""].filter(Boolean).join(" · ");
  return <details className="nbaLineups ncaamModelDetails"><summary><span>Model factors & player impact</span><span className="nbaLineupStatus">{badges || "Research"}</span><span className="nbaLineupChevron" aria-hidden="true">⌄</span></summary>
    <div className="nbaLineupBody">
      {forecast.market_tracking && <p className="nbaSmall">Market adjustment: home margin {signed(forecast.market_tracking.spread_adjustment)} pts · total {signed(displayedTotalAdjustment ?? forecast.market_tracking.total_adjustment)} pts{displayedTotalAdjustment != null ? " (reversed 2×)" : ""} · baseline score {forecast.market_tracking.baseline_away.toFixed(1)}–{forecast.market_tracking.baseline_home.toFixed(1)}. Grades pending.</p>}
      {forecast.matchup_projection ? <p className="nbaSmall">Matchup baseline: {forecast.matchup_projection.possessions.toFixed(1)} possessions · {away.team}: {forecast.matchup_projection.pairings.away.expected_efficiency.toFixed(1)} points per 100 · {home.team}: {forecast.matchup_projection.pairings.home.expected_efficiency.toFixed(1)} points per 100. Home court and player impact are applied once.</p> : null}
      <div className="nbaLineupTeams">{([away, home] as Rating[]).map((rating, index) => {
        const teamImpact = impact?.[index === 0 ? "away" : "home"], competition = rating.prior_competition;
        return <section className="nbaLineupTeam" key={rating.team}><h4>{rating.team}</h4>
          <p className="nbaSmall">{rating.source_preseason_prior ? `Torvik season weighting · ${rating.d1_games_played == null ? "D1 game count unavailable" : `${rating.d1_games_played} D1 games through yesterday`}` : rating.prior_season ? `${rating.prior_season - 1}–${String(rating.prior_season).slice(-2)} prior: ${Math.round((rating.prior_weight || 0) * 100)}% · ${rating.games_played ?? 0} current-season games` : "Dated team ratings"}</p>
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
      {impact && <p className="nbaLineupSource"><a href={impact.ratingsSourceUrl} target="_blank" rel="noreferrer">College player ratings</a> · Forecast inputs {new Date(impact.as_of).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })} ET</p>}
    </div>
  </details>;
}
