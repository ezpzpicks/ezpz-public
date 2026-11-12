"use client";

import { useState } from "react";
import { DirectTrendRecords } from "./FootballTrendMarketBoard";
import { MatchupWithLogos, SelectionWithTeamLogo } from "./TeamLogoName";
import type { NbaMarketPayload } from "./NbaBoard";
import { nbaRecordTotals, type NbaRecordTotals, type NbaModelRecords, type NbaModelPlay } from "../lib/nbaRecords";

const pct = (n: number | null | undefined) => n == null ? "—" : `${n.toFixed(1)}%`;
const units = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(2)}u`;
function RecordCard({ label, totals }: { label: string; totals: NbaRecordTotals }) {
  return <section className="nbaRecordCard" aria-label={label}><h3>{label}</h3><strong className="nbaRecordValue">{totals.record}</strong>
    <p>{totals.totalBets} settled · {totals.pending} pending</p>
    <dl className="nbaMetrics"><div><dt>Win rate</dt><dd>{pct(totals.winPct)}</dd></div>
      <div><dt>Net units</dt><dd>{units(totals.unitsWon)}</dd></div><div><dt>ROI</dt><dd>{pct(totals.roiPct)}</dd></div></dl>
  </section>;
}
function GradeRecords({ models, period, sport, title }: { models?: NbaModelRecords; period: "overall" | "last7Days"; sport: string; title: string }) {
  const rows = (models?.byType || []).filter(row => sport !== "NCAAM" || !["A Total", "B Total"].includes(row.label));
  return <article className="nbaCard"><h3>{title}</h3><div className="nbaTableWrap"><table className="nbaRecordsTable"><thead><tr>
    <th scope="col">Bet type</th><th scope="col">Record</th><th scope="col">Win rate</th><th scope="col">Net units</th><th scope="col">ROI</th><th scope="col">Pending</th>
  </tr></thead><tbody>{rows.map(row => <tr key={row.label}><th scope="row">{row.label}</th><td>{row[period].record}</td>
    <td>{pct(row[period].winPct)}</td><td>{units(row[period].unitsWon)}</td><td>{pct(row[period].roiPct)}</td><td>{row[period].pending}</td></tr>)}</tbody></table></div></article>;
}
function ModelHistory({ history, sport, title }: { history: NbaModelPlay[]; sport: "NBA" | "NCAAM"; title: string }) {
  return <article className="nbaCard"><h3>{title}</h3>{history.length ? <div className="nbaPlayHistory">{history.map(row => <div className="nbaHistoryRow" key={row.id}>
    <div><span className="nbaSmall">{row.date} · {row.grade} {row.market} · {row.odds}</span><strong><SelectionWithTeamLogo sport={sport} selection={row.selection} game={row.game} /></strong>
      <small><MatchupWithLogos sport={sport} game={row.game} compact /></small>{row.gradeReason && <small>{row.gradeReason}</small>}</div>
    <span className="nbaResult" data-result={row.result}>{row.result || "Pending"}</span>
  </div>)}</div> : <p>No qualifying A/B model plays have been saved for this period.</p>}</article>;
}
export default function NbaRecords({ data }: { data: NbaMarketPayload }) {
  const sport = data.sport || "NBA";
  const [period, setPeriod] = useState<"overall" | "last7Days">("overall");
  const models = data.modelRecords, ezpz = data.ezpzRecords;
  const zero = nbaRecordTotals([]), date = data.date || "", start = new Date(Date.parse(`${date || "2000-01-01"}T12:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10);
  const history = (models?.history || []).filter(row => period === "overall" || row.date >= start);
  const picks = (ezpz?.history || []).filter(row => period === "overall" || row.date >= start);
  const replay = sport === "NCAAM" ? models?.replay : undefined;
  const replayHistory = (replay?.history || []).filter(row => period === "overall" || row.date >= start);
  return <section className="nbaBoard" aria-label={`${sport} Records`}>
    <div className="nbaIntro"><h2>{sport} Records</h2></div>
    <div className="nbaControls" role="group" aria-label="Record period">
      <button type="button" aria-pressed={period === "overall"} onClick={() => setPeriod("overall")}>Season</button>
      <button type="button" aria-pressed={period === "last7Days"} onClick={() => setPeriod("last7Days")}>Last 7 days</button>
    </div>
    {sport === "NCAAM" && <p className="nbaSmall">Live Model Plays count grades saved before tipoff. Totals are split into A/B Over and Under records.</p>}
    <div className="nbaRecordGrid"><RecordCard label={sport === "NCAAM" ? "Live Model Plays" : "Model Plays"} totals={models?.[period] || zero} /><RecordCard label="EZPZ Picks" totals={ezpz?.[period] || zero} /></div>
    <GradeRecords models={models} period={period} sport={sport} title="Model records by grade and market" />
    <ModelHistory history={history} sport={sport} title="Recent Model Plays" />
    {replay && (replay.overall.totalBets > 0 || replay.overall.pending > 0) && <>
      <p className="nbaNotice">Retrospective replay: these grades were applied to saved pregame inputs after the games started. Replay results are tracked separately from live Model Plays.</p>
      <RecordCard label="Matchup grade replay" totals={replay[period]} />
      <GradeRecords models={replay} period={period} sport={sport} title="Replay records by grade and direction" />
      <ModelHistory history={replayHistory} sport={sport} title="Replay selections" />
    </>}
    <article className="nbaCard"><h3>EZPZ Picks history</h3>
      {picks.length ? <div className="nbaPlayHistory">{picks.map(row => <div className="nbaHistoryRow" key={row.id}>
        <div><span className="nbaSmall">{row.date} · {row.market} · {row.ruleLabel || `${row.signalCount} signals`}</span><strong><SelectionWithTeamLogo sport={sport} selection={row.selection} game={row.game} /></strong>
          <small><MatchupWithLogos sport={sport} game={row.game} compact /></small></div><span className="nbaResult" data-result={row.result}>{row.result || "Pending"}</span>
      </div>)}</div> : <p>No qualifying EZPZ Picks have been saved for this period.</p>}</article>
    <div className="directTrendRecordWrap"><DirectTrendRecords rows={[]} sport={sport} nbaLeaderboard={data.leaderboard || []} /></div>
  </section>;
}
