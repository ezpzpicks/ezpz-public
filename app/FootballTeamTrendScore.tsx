import type { FootballTeamTrendScore, TeamTrendRecord } from "../lib/footballTeamTrends";

function RecordLine({ record }: { record: TeamTrendRecord }) {
  return <span className="teamTrendRecord">
    <span>{record.label}</span>
    <b>{record.sample ? record.record : "—"}</b>
  </span>;
}

export default function FootballTeamTrendScore({ score }: { score?: FootballTeamTrendScore }) {
  if (!score?.teams?.length) return null;
  const scoreLabel = score.score == null ? "Awaiting records" : `${score.score.toFixed(1)} / 100`;
  const seasonHistory = score.scope === "Current-season games";
  return <section className="teamTrendScore" aria-label="Experimental team trend score" data-team-trend-version={score.version}>
    <div className="teamTrendScoreTop">
      <span>Team trends <small>Testing</small></span>
      <strong>{scoreLabel}</strong>
    </div>
    <div className="teamTrendTeams">
      {score.teams.map((team, i) => <div className="teamTrendTeam" key={`${team.team}-${i}`}>
        <strong className="teamTrendName">{team.team}</strong>
        <div className="teamTrendRecords">
          <RecordLine record={team.records.betType} />
          <RecordLine record={team.records.venue} />
          <RecordLine record={team.records.recent} />
        </div>
      </div>)}
    </div>
    <details className="teamTrendMethod">
      <summary>{score.mode === "locked" ? "Saved pregame" : score.mode === "replay" ? "Pregame replay" : "Live preview"} · {seasonHistory ? "Season history" : "Tracked games"}</summary>
      {seasonHistory ? <p>{score.teams.map(team => `${team.team}: ${team.trackedGames}/${team.seasonGames} games included`).join(" · ")}. {score.teams.some(team => team.missingGames > 0) ? "The score is awaiting missing game lines." : "Each game is graded against its historical spread or total."}</p> : null}
      <p>Raw hit rates: {score.weights.betType}% bet type, {score.weights.venue}% home/away, {score.weights.recent}% last five. Team scores are averaged. Pushes are excluded from hit rates; an empty category contributes a neutral 50%. A dash means no matching games.</p>
      {score.teams.some(team => team.opposing) ? <p>Records show each team’s actual ATS results. The opposing team’s failures to cover support the selected side and are used for its score.</p> : null}
      <p>This is a testing score, not a win probability. It does not qualify or exclude picks.{score.mode === "replay" ? " This older pick’s records were reconstructed from prior game dates, rather than saved before kickoff." : ""}</p>
    </details>
    <style jsx>{`
      .teamTrendScore{margin-top:13px;padding-top:12px;border-top:1px solid rgba(120,151,191,.16);color:#a9b9ce}
      .teamTrendScoreTop{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:9px;font-size:.73rem}
      .teamTrendScoreTop>span{display:flex;align-items:center;gap:7px;font-weight:750}
      .teamTrendScoreTop small{font-size:.6rem;font-weight:650;color:#8da5bf;border:1px solid rgba(120,151,191,.2);border-radius:5px;padding:2px 5px}
      .teamTrendScoreTop>strong{font-size:.88rem;color:#c3daef;font-variant-numeric:tabular-nums;white-space:nowrap}
      .teamTrendTeams{display:grid;gap:9px}
      .teamTrendTeam{display:grid;grid-template-columns:minmax(80px,.8fr) minmax(0,2fr);gap:9px;align-items:center}
      .teamTrendName{font-size:.7rem;font-weight:700;line-height:1.3;color:#bac9da;overflow-wrap:anywhere}
      .teamTrendRecords{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
      .teamTrendMethod{margin-top:9px;font-size:.64rem;line-height:1.5;color:#8194ad}
      .teamTrendMethod>summary{cursor:pointer;width:fit-content}
      .teamTrendMethod p{margin:7px 0 0;max-width:70ch}
      @media(max-width:480px){.teamTrendTeam{grid-template-columns:1fr;gap:5px}.teamTrendRecords{gap:10px}.teamTrendName{font-size:.7rem}}
    `}</style>
    <style jsx global>{`
      .teamTrendRecord{display:grid;gap:2px;min-width:0;font-size:.62rem;line-height:1.35;color:#8194ad}
      .teamTrendRecord>span{overflow-wrap:anywhere}
      .teamTrendRecord>b{font-size:.72rem;font-weight:700;font-variant-numeric:tabular-nums;color:#b8c9db}
    `}</style>
  </section>;
}
