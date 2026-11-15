import type { NcaamMatchupGrade as MatchupGrade } from "../lib/ncaamMatchupGrades";
import { modelFactorLabel as factor } from "../lib/modelFactorLabels";
import NcaamPointGrade from "./NcaamPointGrade";

export default function NcaamMatchupGrade({ grade, away, home }: { grade: MatchupGrade; away: string; home: string }) {
  if (grade.grading_basis === "market_point_edge") return <NcaamPointGrade grade={grade} away={away} home={home} market="Total" />;
  const extreme = grade.thresholds?.extreme_z ?? 1, veryExtreme = grade.thresholds?.very_extreme_z ?? 1.5;
  return <div className="ncaamGradeDetails">
    {grade.record_mode === "replay" ? <p className="nbaSmall">Retrospective replay</p> : null}
    <details><summary>Offense, defense & tempo factors</summary>
      {(["away", "home"] as const).map(side => <section key={side}>
        <h5>{side === "away" ? away : home}</h5>
        <dl className="nbaMetrics">{["offense", "defense", "tempo"].map(metric => <div key={metric}>
          <dt>{metric === "tempo" ? "Tempo" : `Adjusted ${metric}`}</dt>
          <dd>{factor(grade.z?.[side]?.[metric], metric, extreme, veryExtreme)}</dd>
        </div>)}</dl>
      </section>)}
    </details>
  </div>;
}
