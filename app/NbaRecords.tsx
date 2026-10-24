"use client";

import { useState } from "react";
import { DirectTrendRecords } from "./FootballTrendMarketBoard";
import { MatchupWithLogos, SelectionWithTeamLogo } from "./TeamLogoName";
import type { NbaMarketPayload } from "./NbaBoard";
import { nbaRecordTotals, type NbaRecordTotals } from "../lib/nbaRecords";

const pct = (n: number | null | undefined) => n == null ? "—" : `${n.toFixed(1)}%`;
const units = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(2)}u`;
function RecordCard({ label, totals }: { label: string; totals: NbaRecordTotals }) {
  return <section className="nbaRecordCard" aria-label={label}><h3>{label}</h3><strong className="nbaRecordValue">{totals.record}</strong>
    <p>{totals.totalBets} settled · {totals.pending} pending</p>
    <dl className="nbaMetrics"><div><dt>Win rate</dt><dd>{pct(totals.winPct)}</dd></div>
      <div><dt>Net units</dt><dd>{units(totals.unitsWon)}</dd></div><div><dt>ROI</dt><dd>{pct(totals.roiPct)}</dd></div></dl>
  </section>;
}
export default function NbaRecords({ data }: { data: NbaMarketPayload }) {
  const [period, setPeriod] = useState<"overall" | "last7Days">("overall");
  const models = data.modelRecords, ezpz = data.ezpzRecords;
  const zero = nbaRecordTotals([]), date = data.date || "", start = new Date(Date.parse(`${date || "2000-01-01"}T12:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10);
  const history = (models?.history || []).filter(row => period === "overall" || row.date >= start);
  const picks = (ezpz?.history || []).filter(row => period === "overall" || row.date >= start);
  return <section className="nbaBoard" aria-label="NBA Records">
    <div className="nbaIntro"><h2>NBA Records</h2><p>Model plays, EZPZ Picks and public betting trends.</p>
      <p className="nbaSmall">A/B model plays use the last saved forecast before tipoff, once per game and market. Early and pregame runs are not counted twice. One unit risked per play; spread and total odds assumed -110.</p></div>
    <div className="nbaControls" role="group" aria-label="Record period">
      <button type="button" aria-pressed={period === "overall"} onClick={() => setPeriod("overall")}>Season</button>
      <button type="button" aria-pressed={period === "last7Days"} onClick={() => setPeriod("last7Days")}>Last 7 days</button>
    </div>
    <div className="nbaRecordGrid"><RecordCard label="Model Plays" totals={models?.[period] || zero} /><RecordCard label="EZPZ Picks" totals={ezpz?.[period] || zero} /></div>
    <article className="nbaCard"><h3>Model records by grade and market</h3><div className="nbaTableWrap"><table className="nbaRecordsTable"><thead><tr>
      <th scope="col">Bet type</th><th scope="col">Record</th><th scope="col">Win rate</th><th scope="col">Net units</th><th scope="col">ROI</th><th scope="col">Pending</th>
    </tr></thead><tbody>{(models?.byType || []).map(row => <tr key={row.label}><th scope="row">{row.label}</th><td>{row[period].record}</td>
      <td>{pct(row[period].winPct)}</td><td>{units(row[period].unitsWon)}</td><td>{pct(row[period].roiPct)}</td><td>{row[period].pending}</td></tr>)}</tbody></table></div></article>
    <article className="nbaCard"><h3>Recent Model Plays</h3><p className="nbaSmall">Most recent 100 qualifying plays. Older forecasts remain available in Full Slate.</p>
      {history.length ? <div className="nbaPlayHistory">{history.map(row => <div className="nbaHistoryRow" key={row.id}>
        <div><span className="nbaSmall">{row.date} · {row.grade} {row.market} · {row.odds}</span><strong><SelectionWithTeamLogo sport="NBA" selection={row.selection} game={row.game} /></strong>
          <small><MatchupWithLogos sport="NBA" game={row.game} compact /></small></div><span className="nbaResult" data-result={row.result}>{row.result || "Pending"}</span>
      </div>)}</div> : <p>No qualifying A/B model plays have been saved for this period.</p>}</article>
    <article className="nbaCard"><h3>EZPZ Picks history</h3><p className="nbaSmall">Only selections saved before tipoff enter records. Each game contributes at most one pick.</p>
      {picks.length ? <div className="nbaPlayHistory">{picks.map(row => <div className="nbaHistoryRow" key={row.id}>
        <div><span className="nbaSmall">{row.date} · {row.market} · {row.signalCount} signals</span><strong><SelectionWithTeamLogo sport="NBA" selection={row.selection} game={row.game} /></strong>
          <small><MatchupWithLogos sport="NBA" game={row.game} compact /></small></div><span className="nbaResult" data-result={row.result}>{row.result || "Pending"}</span>
      </div>)}</div> : <p>No qualifying EZPZ Picks have been saved for this period.</p>}</article>
    <div className="directTrendRecordWrap"><DirectTrendRecords rows={[]} sport="NBA" nbaLeaderboard={data.leaderboard || []} /></div>
  </section>;
}
