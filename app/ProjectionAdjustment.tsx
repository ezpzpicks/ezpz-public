export default function ProjectionAdjustment({ points, label = "projection" }: { points?: number | null; label?: string }) {
  if (typeof points !== "number" || !Number.isFinite(points) || Math.abs(points) < 0.05) return null;
  const up = points > 0, amount = Math.abs(points).toFixed(1);
  const description = `Betting market adjustment: ${label} ${up ? "increased" : "decreased"} by ${amount} points from baseline`;
  return <small className="projectionAdjustment" data-direction={up ? "up" : "down"} title={description} aria-label={description}>
    <span aria-hidden="true">{up ? "↑" : "↓"} {amount} pts</span>
  </small>;
}
