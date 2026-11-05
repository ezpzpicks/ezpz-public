import type { TrialDecision, TrialSport } from "../lib/selectionTrial";
import type { FadeMarketModel } from "../lib/selectionFade";
import replay from "./data/selection-fade-replay-2026-11-04.json";

type RecordSummary = { record: string; pending: number; netUnits: number; roiPct: number | null };
export type FadeTrialReport = { available: boolean;
  policy: { version: string; qualification: string; usesEstimatedFadeRoi: boolean };
  estimatePolicy: { version: string }; estimateAvailable: boolean; capturedGames: number; selectedGames: number;
  record: RecordSummary; matchedOriginal: RecordSummary;
  model: { models: (Omit<FadeMarketModel, "samples"> & { trainingGames: number; trainingDates: number })[] } | null };
const pct = (value: number | null) => value == null ? "—" : `${value.toFixed(2)}%`;
const roi = (value: number) => `${value > 0 ? "+" : ""}${(100 * value).toFixed(2)}%`;

export default function FadeTrialPanel({ sport, date, data, decisions }: {
  sport: TrialSport; date: string; data?: FadeTrialReport; decisions: TrialDecision[];
}) {
  const examples = date === replay.date ? replay.results.filter(row => row.sport === sport) : [];
  if (!data && !examples.length) return null;
  const saved = decisions.filter(d => d.paperComparison?.version === data?.policy.version);
  return <section aria-label="Rule-qualified fade trial">
    <h3>Fade test · Rule qualified</h3>
    <p>The fade trigger qualifies the play. Estimated fade ROI and the uncertainty adjustment are informational;
      they do not reject or rank fades.</p>
    <details><summary>When a play becomes a fade</summary>
      <ol>
        <li>The strongest raw candidate in the game reaches +2% estimated ROI.</li>
        <li>The original model has a stable fit with at least 40 training games across four dates,
          plus 20 chronological calibration checks across three dates.</li>
        <li>The strict trial rejects that candidate, calibration retains zero learned adjustment,
          and earlier raw probability error is worse than the market baseline.</li>
        <li>Take the exact opposite in the same market, at its own saved odds of -150 or better.
          Both sides must meet the price limit.</li>
      </ol>
      <p>Only one fade is selected per game. An uncertainty-only rejection, missing history or a failed fit produces a pass.
        Complete quotes freeze in the final 10–20 minutes before the game. No minimum signal count is required.</p>
    </details>
    {data?.available ? <>
      <table className="fs-table"><thead><tr><th scope="col">Strategy</th><th scope="col">Record</th><th scope="col">ROI / units</th></tr></thead><tbody>
        {([["Rule-qualified fades", data.record], ["Original candidates · same fade games", data.matchedOriginal]] as const)
          .map(([label, record]) => <tr key={label}><th scope="row">{label}</th>
            <td data-label="Record">{record.record}<small>{record.pending} pending</small></td>
            <td data-label="ROI / units">{pct(record.roiPct)}<small>{record.netUnits.toFixed(2)}u</small></td></tr>)}
      </tbody></table>
      <p>{data.capturedGames} prospective cards · {data.selectedGames} rule-qualified fades.
        Records use saved pregame prices and exclude historical replays.</p>
      {data.estimateAvailable && data.model ? <details><summary>Experimental ROI model history</summary>
        <table className="fs-table"><thead><tr><th scope="col">Market</th><th scope="col">Calibration games</th><th scope="col">Later validation games</th></tr></thead><tbody>
          {data.model.models.map(model => <tr key={model.market}><th scope="row">{model.market}
            <small>{model.weight < 0 ? "Global fade direction" : model.weight > 0 ? "Global follow direction" : "Global neutral direction"}</small></th>
            <td data-label="Calibration games">{model.calibrationGames}<small>{model.calibrationDates} dates</small></td>
            <td data-label="Later validation games">{model.validationGames}<small>{model.validationDates} dates</small></td></tr>)}
        </tbody></table>
        <p>Calibration uses earlier raw forecasts. Later checks fit calibration only on previous dates.
          Signal combinations and matching public types receive their own adjustment when supported by at least ten games across three dates;
          smaller groups use the broader sport and market estimate. Overlapping public types count each game once.
          These estimates and their later validation counts do not determine rule qualification.</p>
      </details> : <p>ROI estimates are awaiting their scheduled build. Fade qualification uses the saved reversal rule.</p>}
      {saved.length ? <table className="fs-table"><thead><tr><th scope="col">Saved game</th><th scope="col">Fade decision</th><th scope="col">ROI estimate · Informational</th></tr></thead><tbody>
        {saved.map(game => {
          const rule = game.paperComparison!, pick = game.estimates.find(e => e.id === rule.oppositePickId);
          const estimate = game.fadeComparison?.version === data.estimatePolicy.version
            ? game.fadeComparison.estimates.find(e => e.id === pick?.id) : undefined;
          return <tr key={game.gameKey}><th scope="row">{game.game}</th>
            <td data-label="Fade decision">{pick?.selection || "Pass"}<small>{pick ? "Meets fade rule" : rule.reason}</small>
              <small>{pick ? `${pick.odds} · ${game.outcomes[pick.id]?.result || "Pending"} · ${pick.priceBasis}` : ""}</small></td>
            <td data-label="ROI estimate · Informational">{estimate ? roi(estimate.expectedRoi) : "—"}
              <small>{estimate ? `${roi(estimate.conservativeRoi)} after uncertainty · Does not affect qualification` : ""}</small></td></tr>;
        })}
      </tbody></table> : <p>Awaiting the first complete game card after this model was added.</p>}
    </> : <p>The fade rule is awaiting its first saved daily model.</p>}
    {examples.length ? <>
      <h4>November 4 replay · Research only</h4>
      <p>Reconstructed using original pregame quotes and results known before November 4, Eastern time.
        The algorithm was developed afterward. These examples are excluded from prospective records.</p>
      <table className="fs-table"><thead><tr><th scope="col">Selection / price</th><th scope="col">Fade rule</th><th scope="col">Cover estimate</th><th scope="col">Expected ROI</th><th scope="col">Conservative ROI</th></tr></thead><tbody>
        {examples.map(row => <tr key={row.selection}><th scope="row">{row.selection}<small>{row.odds} · {row.priceBasis}</small></th>
          <td data-label="Fade rule">{row.ruleQualifier.qualifies ? "Meets fade rule" : "Pass"}</td>
          <td data-label="Cover estimate">{pct(row.coverProbabilityPct)}</td>
          <td data-label="Expected ROI">{pct(row.expectedRoiPct)}</td>
          <td data-label="Conservative ROI">{pct(row.conservativeRoiPct)}<small>Informational</small></td></tr>)}
      </tbody></table>
      <details><summary>Replay qualification and estimate support</summary>
        {examples.map(row => <p key={row.selection}><strong>{row.selection}</strong>: {row.ruleQualifier.reason}
          {" "}{row.support.calibrationGames} calibration games; {row.support.validationGames} later checks.
          {" "}Original signal-pattern matches: {row.support.combinationGames}; public-type matches: {row.support.publicTypeGames}.
          {" "}Uses the {row.supportLevel.toLowerCase()} estimate.</p>)}
        <p>{sport === "NBA" ? "The NBA replays had no earlier raw forecasts reaching the +2% entry level. NBA quotes assume -110."
          : "Ball State uses its saved -102 quote."} Quote provenance and limited matching history remain material limitations.</p>
      </details>
    </> : null}
    <p>ROI estimates do not determine fade qualification. Conservative ROI is an approximate uncertainty adjustment, not a validated confidence bound.
      These research selections do not publish as official EZPZ Picks.</p>
  </section>;
}
