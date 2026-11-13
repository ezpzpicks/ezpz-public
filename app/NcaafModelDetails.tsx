import { ncaafMatchupContext } from "../lib/ncaafMatchupFactors";

export default function NcaafModelDetails({ row }: { row: Record<string, string> }) {
  const context = ncaafMatchupContext(row);
  if (!context) return null;
  const { factors, spread, total } = context;
  const level = (value: number, metric: "offense" | "defense" | "tempo") => {
    const b = factors.national[metric], z = (value - b.mean) / b.sd;
    if (metric === "tempo") return z >= .5 ? "Fast" : z <= -.5 ? "Slow" : "Average";
    const quality = metric === "defense" ? -z : z;
    return quality >= .5 ? "Strong" : quality <= -.5 ? "Weak" : "Average";
  };
  const observed = new Date(factors.observed_at).toLocaleString("en-US", { timeZone: "America/New_York",
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return <details className="ncaafFactors">
    <summary><span>Offense · Defense · Tempo</span><small>SP+ matchup grades</small><span aria-hidden="true">⌄</span></summary>
    <div className="ncaafFactorBody">
      <div className="ncaafFactorTeams">{([factors.away, factors.home]).map(team => <section key={team.team}>
        <h4>{team.team}</h4>
        <dl>{(["offense", "defense", "tempo"] as const).map(metric => <div key={metric}>
          <dt>{metric === "offense" ? "Adjusted offense" : metric === "defense" ? "Adjusted defense" : "Tempo"}</dt>
          <dd>{team[metric].toFixed(1)}<small>{level(team[metric], metric)}</small></dd>
        </div>)}</dl>
      </section>)}</div>
      <p className="ncaafFactorNote">SP+ offense and defense: opponent- and tempo-adjusted points; higher offense and lower defense are better. Tempo: possessions per team, with current-season pace blended with the previous season.</p>
      <div className="ncaafFactorReasons">{([["Spread", spread], ["Total", total]] as const).map(([market, grade]) =>
        <p key={market}><b className={`ncaafFactorGrade grade${grade.grade}`}>{market} {grade.grade}</b><span>{grade.reason}</span></p>)}</div>
      <p className="ncaafFactorSource"><a href={factors.source_url} target="_blank" rel="noreferrer">Bill Connelly SP+ · CFB Update</a><span>Captured {observed} ET</span></p>
      <p className="ncaafFactorNote">Provisional matchup support. A/B grades require projection agreement and a qualifying saved price; they are not win probabilities.</p>
    </div>
    <style jsx>{`
      .ncaafFactors{grid-column:1/-1;border:1px solid rgba(89,153,228,.22);border-radius:15px;background:rgba(9,23,40,.6);overflow:hidden}
      .ncaafFactors summary{display:flex;align-items:center;gap:12px;padding:12px 14px;cursor:pointer;font-size:.8rem;font-weight:850;list-style:none}
      .ncaafFactors summary small{margin-left:auto;color:#8fc3ff;font-size:.65rem}.ncaafFactorBody{padding:0 14px 13px;display:grid;gap:10px}
      .ncaafFactorTeams{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.ncaafFactorTeams section{padding:12px;border:1px solid rgba(89,153,228,.13);border-radius:12px;background:rgba(6,16,29,.6)}
      h4{margin:0 0 12px;font-size:.83rem;color:#e4f0ff}dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:0}dt{font-size:.61rem;color:var(--ez-muted);line-height:1.4}dd{margin:5px 0 0;font-size:1.2rem;font-weight:900;color:#f2f7ff}dd small{display:block;margin-top:3px;font-size:.62rem;font-weight:650;color:#a7c5e7}
      .ncaafFactorNote,.ncaafFactorSource{margin:0;color:var(--ez-muted);font-size:.67rem;line-height:1.5}.ncaafFactorSource{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}.ncaafFactorSource a{color:#8fc3ff;text-decoration:none}
      .ncaafFactorReasons{display:grid;gap:7px}.ncaafFactorReasons p{display:flex;gap:8px;align-items:baseline;margin:0;font-size:.69rem;line-height:1.5;color:#c2d4e9}.ncaafFactorGrade{flex:0 0 auto;font-size:.64rem;border-radius:6px;padding:3px 7px;background:rgba(76,119,171,.16);color:#adc6e3}.gradeA{color:#a5f0c7;background:rgba(32,145,88,.18)}.gradeB{color:#a3ceff;background:rgba(45,119,202,.18)}
      @media(max-width:650px){.ncaafFactorTeams{grid-template-columns:1fr}.ncaafFactors summary{gap:7px;font-size:.73rem}.ncaafFactors summary small{font-size:.59rem}}
    `}</style>
  </details>;
}
