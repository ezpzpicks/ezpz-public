import type { ReactNode } from "react";
import { MatchupWithLogos } from "./TeamLogoName";

type Row = Record<string, string>;
function runs(value: unknown) {
  if (value == null || String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(1) : null;
}

export default function MlbSlateCard({ row, time, modelBuilt, markets, children }: {
  row: Row; time: string; modelBuilt: boolean; markets: ReactNode; children?: ReactNode;
}) {
  const game = row["Game Label"] || `${row["Away Team"]} @ ${row["Home Team"]}`;
  const awayRuns = runs(row["Away Runs Projection"]), homeRuns = runs(row["Home Runs Projection"]);
  return <article className="nbaCard" data-game-id={row["Game ID"] || row["Game Key"] || game}>
    <h3><MatchupWithLogos sport="MLB" game={game} /></h3>
    <p className="nbaMeta"><time>{time ? `${time} ET` : "Time unavailable"}</time><span>{modelBuilt ? "Saved forecast" : "Scheduled"}</span></p>
    {!modelBuilt ? <p className="nbaNotice">No saved model forecast for this matchup.</p> : null}
    {awayRuns != null || homeRuns != null ? <div className="nbaScoreBlock"><p className="nbaSmall">Projected score</p>
      <div className="nbaScore"><div><span>{row["Away Team"] || "Away"}</span><strong>{awayRuns ?? "—"}</strong></div>
        <div><span>{row["Home Team"] || "Home"}</span><strong>{homeRuns ?? "—"}</strong></div></div>
    </div> : null}
    <div className="nbaMarkets">{markets}</div>
    {children}
  </article>;
}

export function MlbMarketPanel({ title, grade, isGreen, metrics, children }: {
  title: string; grade: string; isGreen: boolean;
  metrics: Array<{ label: string; value: string | number }>; children?: ReactNode;
}) {
  const tier = isGreen ? grade.match(/^([AB])\b/)?.[1] || "A" : grade;
  return <section className="nbaMarketCard" aria-label={`${title} forecast`}>
    <div className="nbaMarketHeading"><h4>{title}</h4><span className="nbaGrade" data-grade={tier}>{grade || "PASS"}</span></div>
    {metrics.length ? <dl className="nbaMetrics">{metrics.map(metric => <div key={metric.label}>
      <dt>{metric.label}</dt><dd>{metric.value === "" ? "—" : metric.value}</dd>
    </div>)}</dl> : null}
    {children}
  </section>;
}
