import type { NcaamMatchupGrade } from "../lib/ncaamMatchupGrades";
import type { NcaamSpreadGrade } from "../lib/ncaamSpreadGrades";
import { modelFactorLabel } from "../lib/modelFactorLabels";

export default function NcaamPointGrade({ grade, away = "Away", home = "Home", market }: {
  grade: NcaamMatchupGrade | NcaamSpreadGrade; away?: string; home?: string; market: "Spread" | "Total";
}) {
  return <div className="ncaamGradeDetails">
    {grade.record_mode === "replay" ? <p className="nbaSmall">Retrospective replay</p> : null}
    <details><summary>{market} matchup factors</summary>
      {(["away", "home"] as const).map(side => <section key={side}><h5>{side === "away" ? away : home}</h5>
        <dl className="nbaMetrics">{(["offense", "defense", "tempo"] as const).map(metric => <div key={metric}>
          <dt>{metric === "tempo" ? "Tempo" : `Adjusted ${metric}`}</dt><dd>{modelFactorLabel(grade.z?.[side]?.[metric] ?? NaN,metric)}</dd>
        </div>)}</dl>
      </section>)}
    </details>
  </div>;
}
