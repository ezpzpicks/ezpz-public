import type { NcaamSpreadGrade as SpreadGrade } from "../lib/ncaamSpreadGrades";
import NcaamPointGrade from "./NcaamPointGrade";

const difference = (n: number) => Number.isFinite(n) ? `${n > 0 ? "+" : ""}${n.toFixed(1)}` : "Unavailable";
export default function NcaamSpreadGrade({ grade, away, home }: { grade: SpreadGrade; away?: string; home?: string }) {
  if (grade.grading_basis === "market_point_edge") return <NcaamPointGrade grade={grade} away={away} home={home} market="Spread" />;
  const tempo = grade.mean_tempo_z;
  return <div className="ncaamGradeDetails">
    {grade.record_mode === "replay" ? <p className="nbaSmall">Retrospective replay</p> : null}
    <details><summary>Spread matchup factors · {grade.role}</summary>
      {grade.selection_team && <p className="nbaSmall">{grade.selection_team}: projected margin {difference(grade.projected_margin)} · cover edge {grade.edge.toFixed(2)} points.</p>}
      <dl className="nbaMetrics">
        <div><dt>Offense advantage</dt><dd>{difference(grade.offense_advantage)}</dd></div>
        <div><dt>Defense advantage</dt><dd>{difference(grade.defense_advantage)}</dd></div>
        <div><dt>Matchup tempo</dt><dd>{!Number.isFinite(tempo) ? "Unavailable" : Math.abs(tempo) < .001 ? "National average" : tempo > 0 ? "Above national average" : "Below national average"}</dd></div>
      </dl>
    </details>
  </div>;
}
