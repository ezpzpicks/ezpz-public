import type { NcaamSpreadGrade as SpreadGrade } from "../lib/ncaamSpreadGrades";

const difference = (n: number) => Number.isFinite(n) ? `${n > 0 ? "+" : ""}${n.toFixed(1)}` : "Unavailable";
export default function NcaamSpreadGrade({ grade }: { grade: SpreadGrade }) {
  const tempo = grade.mean_tempo_z;
  return <div className="ncaamGradeDetails">
    <p className="nbaSmall"><strong>Spread matchup grade</strong> · {grade.role}{grade.record_mode === "replay" ? " · Retrospective replay" : " · Saved before tipoff"}</p>
    <p className="nbaSmall">{grade.reason}</p>
    <details><summary>Projection, offense, defense & tempo</summary>
      {grade.selection_team && <p className="nbaSmall">{grade.selection_team}: projected margin {difference(grade.projected_margin)} · cover edge {grade.edge.toFixed(2)} points.</p>}
      <dl className="nbaMetrics">
        <div><dt>Offense advantage</dt><dd>{difference(grade.offense_advantage)}</dd></div>
        <div><dt>Defense advantage</dt><dd>{difference(grade.defense_advantage)}</dd></div>
        <div><dt>Matchup tempo</dt><dd>{!Number.isFinite(tempo) ? "Unavailable" : Math.abs(tempo) < .001 ? "National average" : tempo > 0 ? "Above national average" : "Below national average"}</dd></div>
      </dl>
      <p className="nbaSmall">Positive advantages favor the selected team. Better defense means a lower adjusted defensive rating. Faster tempo supports favorites; slower tempo supports underdogs.</p>
      {grade.policy?.edge_window && <p className="nbaSmall">Eligible cover edge: {grade.policy.edge_window.minimum_inclusive} to under {grade.policy.edge_window.maximum_exclusive} points. A combines stronger projection support with defense or all three factors. B needs an offense or defense advantage.</p>}
    </details>
  </div>;
}
