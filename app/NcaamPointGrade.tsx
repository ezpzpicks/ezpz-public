import type { NcaamMatchupGrade } from "../lib/ncaamMatchupGrades";
import type { NcaamSpreadGrade } from "../lib/ncaamSpreadGrades";
import { modelFactorLabel } from "../lib/modelFactorLabels";

export default function NcaamPointGrade({ grade, away = "Away", home = "Home", market }: {
  grade: NcaamMatchupGrade | NcaamSpreadGrade; away?: string; home?: string; market: "Spread" | "Total";
}) {
  const t = grade.policy && "thresholds" in grade.policy ? grade.policy.thresholds : null;
  const prefix = market === "Spread" ? "spread" : "total";
  return <div className="ncaamGradeDetails">
    <p className="nbaSmall"><strong>Point-edge grade</strong> · {grade.record_mode === "replay" ? "Retrospective replay" : "Saved before tipoff"}</p>
    <p className="nbaSmall">{grade.reason}</p>
    <details><summary>Projection, offense, defense & tempo</summary>
      {t ? <p className="nbaSmall">A ≥ {t[`${prefix}_a_points`]} pts · B ≥ {t[`${prefix}_b_points`]} pts. Matchup strength is already included in the score projection.</p> : null}
      {(["away", "home"] as const).map(side => <section key={side}><h5>{side === "away" ? away : home}</h5>
        <dl className="nbaMetrics">{(["offense", "defense", "tempo"] as const).map(metric => <div key={metric}>
          <dt>{metric === "tempo" ? "Tempo" : `Adjusted ${metric}`}</dt><dd>{modelFactorLabel(grade.z?.[side]?.[metric] ?? NaN,metric)}</dd>
        </div>)}</dl>
      </section>)}
      <p className="nbaSmall">Confidence flags: {(grade.confidence_flags || []).join(" · ")}</p>
    </details>
  </div>;
}
