import type { NcaamMatchupGrade as MatchupGrade } from "../lib/ncaamMatchupGrades";
import { modelFactorLabel as factor } from "../lib/modelFactorLabels";
import NcaamPointGrade from "./NcaamPointGrade";

export default function NcaamMatchupGrade({ grade, away, home }: { grade: MatchupGrade; away: string; home: string }) {
  if (grade.grading_basis === "market_point_edge") return <NcaamPointGrade grade={grade} away={away} home={home} market="Total" />;
  const direction = grade.side ? grade.directions[grade.side] : null;
  const extreme = grade.thresholds?.extreme_z ?? 1, veryExtreme = grade.thresholds?.very_extreme_z ?? 1.5;
  return <div className="ncaamGradeDetails">
    <p className="nbaSmall"><strong>Matchup grade</strong>{grade.record_mode === "replay" ? " · Retrospective replay" : " · Saved before tipoff"}</p>
    <p className="nbaSmall">{grade.reason}</p>
    {grade.projection_gate?.required && <p className="nbaSmall">Projection agreement required · Point projection: {grade.projection_gate.direction || "No direction"}
      {grade.projection_gate.factor_side ? ` · Factor profile: ${grade.projection_gate.factor_grade} ${grade.projection_gate.factor_side}` : ""}</p>}
    {direction?.conflicts.map(conflict => <p className="nbaSmall" key={conflict.id}>Grade reduced: {conflict.reason}.</p>)}
    <details><summary>Offense, defense & tempo factors</summary>
      {(["away", "home"] as const).map(side => <section key={side}>
        <h5>{side === "away" ? away : home}</h5>
        <dl className="nbaMetrics">{["offense", "defense", "tempo"].map(metric => <div key={metric}>
          <dt>{metric === "tempo" ? "Tempo" : `Adjusted ${metric}`}</dt>
          <dd>{factor(grade.z?.[side]?.[metric], metric, extreme, veryExtreme)}</dd>
        </div>)}</dl>
      </section>)}
      <p className="nbaSmall">Compared with the dated Division I national average. A higher defensive rating means more points allowed.</p>
      <p className="nbaSmall">{grade.projection_gate?.required
        ? "A/B grades require the point projection to favor the same direction. Matchup factors determine A or B; no minimum point edge is required."
        : "This earlier policy graded the matchup factors independently. Its original selection is retained."}</p>
    </details>
  </div>;
}
