import type { TrialDecision, TrialSport } from "../lib/selectionTrial";
import type { FadeMarketModel } from "../lib/selectionFade";
import replay from "./data/selection-fade-replay-2026-11-04.json";

type RecordSummary = { record: string; pending: number; netUnits: number; roiPct: number | null };
export type FadeTrialReport = { available: boolean; policy: { version: string }; capturedGames: number;
  record: RecordSummary; matchedOriginal: RecordSummary;
  model: { models: (Omit<FadeMarketModel, "samples"> & { trainingGames: number; trainingDates: number })[] } | null };
const pct = (value: number | null) => value == null ? "—" : `${value.toFixed(2)}%`;
const roi = (value: number) => `${value > 0 ? "+" : ""}${(100 * value).toFixed(2)}%`;

export default function FadeTrialPanel({ sport, date, data, decisions }: {
  sport: TrialSport; date: string; data?: FadeTrialReport; decisions: TrialDecision[];
}) {
  const examples = date === replay.date ? replay.results.filter(row => row.sport === sport) : [];
  if (!data && !examples.length) return null;
  const saved = decisions.filter(d => d.fadeComparison?.version === data?.policy.version);
  return <section aria-label="Calibrated fade trial">
    <h3>Calibrated fade estimates</h3>
    <p>Estimates a cover probability for the opposite side. Earlier predictions can support following, a neutral view, or fading.
      A fade needs at least +2% estimated return after uncertainty, eligible prices, and enough later validation.</p>
    {data?.available ? <>
      <table className="fs-table"><thead><tr><th scope="col">Strategy</th><th scope="col">Record</th><th scope="col">ROI / units</th></tr></thead><tbody>
        {([["Calibrated fades", data.record], ["Original candidates · same selected games", data.matchedOriginal]] as const)
          .map(([label, record]) => <tr key={label}><th scope="row">{label}</th>
            <td data-label="Record">{record.record}<small>{record.pending} pending</small></td>
            <td data-label="ROI / units">{pct(record.roiPct)}<small>{record.netUnits.toFixed(2)}u</small></td></tr>)}
      </tbody></table>
      <p>{data.capturedGames} prospective cards. Records use saved pregame prices and exclude historical replays.</p>
      <details><summary>Calibration and validation history</summary>
        <table className="fs-table"><thead><tr><th scope="col">Market</th><th scope="col">Calibration games</th><th scope="col">Later validation games</th></tr></thead><tbody>
          {data.model!.models.map(model => <tr key={model.market}><th scope="row">{model.market}
            <small>{model.weight < 0 ? "Global fade direction" : model.weight > 0 ? "Global follow direction" : "Global neutral direction"}</small></th>
            <td data-label="Calibration games">{model.calibrationGames}<small>{model.calibrationDates} dates</small></td>
            <td data-label="Later validation games">{model.validationGames}<small>{model.validationDates} dates</small></td></tr>)}
        </tbody></table>
        <p>Calibration uses earlier raw forecasts. Later checks fit calibration only on previous dates.
          Signal combinations and matching public types receive their own adjustment when supported by at least ten games across three dates;
          smaller groups use the broader sport and market estimate. Overlapping public types count each game once.</p>
      </details>
      {saved.length ? <table className="fs-table"><thead><tr><th scope="col">Saved game</th><th scope="col">Fade decision</th><th scope="col">ROI estimate</th></tr></thead><tbody>
        {saved.map(game => {
          const card = game.fadeComparison!, pick = card.estimates.find(e => e.id === card.pickId);
          const best = pick || card.estimates.filter(e => e.id !== e.sourceId).sort((a, b) => b.conservativeRoi - a.conservativeRoi)[0];
          return <tr key={game.gameKey}><th scope="row">{game.game}</th>
            <td data-label="Fade decision">{pick?.selection || "Pass"}<small>{pick ? game.outcomes[pick.id]?.result || "Pending" : best?.selection}</small>
              <small>{pick ? pick.odds : best?.reasons.join(" · ")}</small></td>
            <td data-label="ROI estimate">{best ? roi(best.expectedRoi) : "—"}<small>{best ? `${roi(best.conservativeRoi)} after uncertainty` : ""}</small></td></tr>;
        })}
      </tbody></table> : <p>Awaiting the first complete game card after this model was added.</p>}
    </> : <p>The signed probability model is awaiting its first scheduled build. Original trial records remain available above.</p>}
    {examples.length ? <>
      <h4>November 4 replay · Research only</h4>
      <p>Reconstructed using original pregame quotes and results known before November 4, Eastern time.
        The algorithm was developed afterward. These examples are excluded from prospective records.</p>
      <table className="fs-table"><thead><tr><th scope="col">Selection / price</th><th scope="col">Cover estimate</th><th scope="col">Expected ROI</th><th scope="col">Conservative ROI</th></tr></thead><tbody>
        {examples.map(row => <tr key={row.selection}><th scope="row">{row.selection}<small>{row.odds} · {row.priceBasis}</small></th>
          <td data-label="Cover estimate">{pct(row.coverProbabilityPct)}</td>
          <td data-label="Expected ROI">{pct(row.expectedRoiPct)}</td>
          <td data-label="Conservative ROI">{pct(row.conservativeRoiPct)}<small>{row.qualifies ? "Qualifies" : "Pass"}</small></td></tr>)}
      </tbody></table>
      <details><summary>Why the replay selections passed or failed</summary>
        {examples.map(row => <p key={row.selection}><strong>{row.selection}</strong>: {row.reasons.join(" · ")}.
          {" "}{row.support.calibrationGames} calibration games; {row.support.validationGames} later checks.
          {" "}Original signal-pattern matches: {row.support.combinationGames}; public-type matches: {row.support.publicTypeGames}.
          {" "}Uses the {row.supportLevel.toLowerCase()} estimate.</p>)}
        <p>{sport === "NBA" ? "The NBA replays had no earlier raw forecasts reaching the +2% entry level. NBA quotes assume -110."
          : "Ball State uses its saved -102 quote."} Quote provenance and limited matching history remain material limitations.</p>
      </details>
    </> : null}
    <p>Conservative ROI is an approximate uncertainty adjustment, not a validated confidence bound.
      These research selections do not publish as official EZPZ Picks.</p>
  </section>;
}
