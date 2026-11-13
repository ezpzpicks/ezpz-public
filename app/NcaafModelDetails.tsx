import { ncaafMatchupContext } from "../lib/ncaafMatchupFactors";

const signed = (value: string | undefined) => value?.trim() && Number.isFinite(Number(value))
  ? `${Number(value) > 0 ? "+" : ""}${Number(value).toFixed(1)}` : "—";

export default function NcaafModelDetails({ row }: { row: Record<string, string> }) {
  const context = ncaafMatchupContext(row);
  if (!context) return <p className="nbaSmall">Team factor details unavailable for this saved forecast.</p>;
  const { factors, spread, total } = context;
  const observed = new Date(factors.observed_at).toLocaleString("en-US", { timeZone: "America/New_York",
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return <details className="nbaLineups ncaamModelDetails">
    <summary><span>Model factors & personnel impact</span><span className="nbaLineupStatus">Spread {spread.grade} · Total {total.grade}</span><span className="nbaLineupChevron" aria-hidden="true">⌄</span></summary>
    <div className="nbaLineupBody">
      <p className="nbaSmall">SP+ offensive and defensive ratings account for opponent strength and tempo. Each offense faces the opposing defense; pace sets expected possessions.</p>
      <div className="nbaLineupTeams">{([factors.away, factors.home]).map((team, index) => {
        const side = index === 0 ? "Away" : "Home";
        return <section className="nbaLineupTeam" key={team.team}><h4>{team.team}</h4>
          <p className="nbaSmall">Published SP+ ratings · Pace through week {factors.pace_through_week}</p>
          <dl className="nbaMetrics"><div><dt>Adjusted offense</dt><dd>{team.offense.toFixed(1)}</dd></div>
            <div><dt>Adjusted defense</dt><dd>{team.defense.toFixed(1)}</dd></div>
            <div><dt>Tempo</dt><dd>{team.tempo.toFixed(1)}</dd></div></dl>
          <p className="nbaSmall">Quarterback adjustment {signed(row[`${side} QB Adjustment`])} pts · Injury adjustment {signed(row[`${side} Injury Adjustment`])} pts.</p>
        </section>;
      })}</div>
      <p className="nbaSmall">Higher adjusted offense and lower adjusted defense are better. Tempo is possessions per team, with current-season pace blended with the previous season.</p>
      <p className="nbaSmall">Provisional matchup support · A/B grades require projection agreement and a qualifying saved price.</p>
      <p className="nbaLineupSource"><a href={factors.source_url} target="_blank" rel="noreferrer">Bill Connelly SP+ · CFB Update</a> · Inputs captured {observed} ET</p>
    </div>
  </details>;
}
