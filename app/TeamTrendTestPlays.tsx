"use client";

import { useState } from "react";
import FootballTeamTrendScore from "./FootballTeamTrendScore";
import { SelectionWithTeamLogo, TeamLogoName } from "./TeamLogoName";
import type { TeamTrendTestPick, TeamTrendTestStatus } from "../lib/footballTeamTrendPlays";

const timeLabel = (value: string) => new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true,
}).format(new Date(value)) + " ET";
const signed = (value: number, digits = 2) => `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;

export default function TeamTrendTestPlays({ sport, today, current = [], records = [], status }: {
  sport: "NFL" | "NCAAF"; today: string; current?: TeamTrendTestPick[]; records?: TeamTrendTestPick[]; status?: TeamTrendTestStatus;
}) {
  const [chosenDate, setChosenDate] = useState("");
  if (!status) return null;
  const date = chosenDate || today;
  const dates = [...new Set([today, ...records.map(p => p.date)])].sort((a,b) => b.localeCompare(a));
  const picks = date === today ? current : records.filter(p => p.date === date);
  return <section className="footballEzpzHistorySection teamTrendTestSection" aria-labelledby="team-trend-test-title">
    <div className="footballHistoryHead">
      <div>
        <h2 id="team-trend-test-title">Team Trend Plays <small>Testing</small></h2>
        <p>{status.threshold}/100 minimum · 50% bet type, 30% home/away, 20% last five</p>
      </div>
      <span>{picks.length} {picks.length === 1 ? "play" : "plays"}</span>
    </div>
    <div className="teamTrendTestRecord" aria-label="Team trend test results">
      <div><span>Test record</span><strong>{status.record}</strong></div>
      <div><span>Net units</span><strong>{signed(status.units)}u</strong></div>
      <div><span>ROI</span><strong>{status.graded ? `${signed(status.roiPct, 1)}%` : "—"}</strong></div>
      <p>{status.graded} settled · {status.pending} pending · 1 unit risk per play at -110</p>
    </div>
    <p className="teamTrendTestNote">Live previews can change. Qualifying plays are saved at the final pregame snapshot and graded automatically after the final score.</p>
    <details className="footballHistoryDropdown">
      <summary><div><strong>Team trend history</strong><span>{date}{date === today ? " · Today" : ""} · {picks.length} {picks.length === 1 ? "play" : "plays"}</span></div><b>Choose date ▾</b></summary>
      <div className="footballHistoryControls">
        <label><span>Calendar date</span><input type="date" value={date} max={today} onChange={e => setChosenDate(e.target.value)} /></label>
        <label><span>Dates with saved plays</span><select value={dates.includes(date) ? date : ""} onChange={e => setChosenDate(e.target.value)}>
          {!dates.includes(date) ? <option value="" disabled>No saved plays on selected date</option> : null}
          {dates.map(d => <option key={d} value={d}>{d}{d === today ? " — Today" : ""}</option>)}
        </select></label>
      </div>
    </details>
    {picks.length ? <div className="footballHistoryStack">{picks.map(p => {
      const label = p.result === "W" ? "WON" : p.result === "L" ? "LOST" : p.result === "P" ? "PUSH" : p.savedAt ? "SAVED PREGAME" : "LIVE PREVIEW";
      const tone = p.result === "W" ? "win" : p.result === "L" ? "loss" : p.result === "P" ? "push" : p.savedAt ? "final" : "pending";
      return <article className="footballHistoryPickCard footballHistoryTrendCard" key={p.id} data-team-trend-test={p.id}>
        <div className="footballHistoryStatusCluster">
          <span className={`footballHistoryResult ${tone}`}>{label}</span>
          <span className="footballHistoryGameTime">{timeLabel(p.gameTime)}</span>
        </div>
        <div className="footballHistoryTrendMatchup">
          <TeamLogoName sport={sport} team={p.awayTeam} className="footballHistoryTrendTeam" />
          <span className="footballHistoryTrendAt">AT</span>
          <TeamLogoName sport={sport} team={p.homeTeam} className="footballHistoryTrendTeam home" />
        </div>
        <div className="footballHistoryTrendPickRow">
          <div><h3><SelectionWithTeamLogo sport={sport} selection={p.selection} game={p.game} /></h3><p>{p.market} · Team score ≥ {p.threshold}</p></div>
          <strong className="footballHistoryTrendOdds">-110</strong>
        </div>
        <FootballTeamTrendScore score={p.teamTrendScore} threshold={p.threshold} />
      </article>;
    })}</div> : <div className="footballHistoryEmpty">{date === today ? `No ${sport} team-trend plays currently meet ${status.threshold}/100.` : `No team-trend plays were saved for ${date}.`}</div>}
    {date === today && status.awaitingHistory > 0 ? <p className="teamTrendTestNote">{status.awaitingHistory} {status.awaitingHistory === 1 ? "market is" : "markets are"} awaiting complete team history.</p> : null}
    <style jsx>{`
      .teamTrendTestSection{margin-top:32px;padding-top:26px;border-top:1px solid rgba(120,151,191,.22)}
      h2 small{display:inline-block;vertical-align:middle;margin-left:6px;padding:4px 7px;border:1px solid rgba(152,123,240,.4);border-radius:6px;color:#cbb9ff;font-size:.65rem;font-weight:700;letter-spacing:0}
      .teamTrendTestRecord{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;border:1px solid rgba(152,123,240,.25);border-radius:18px;background:rgba(82,53,152,.08);padding:16px}
      .teamTrendTestRecord>div{display:grid;gap:5px}.teamTrendTestRecord span{font-size:.7rem;color:var(--ez-muted)}
      .teamTrendTestRecord strong{font-size:1.2rem;font-variant-numeric:tabular-nums}.teamTrendTestRecord p{grid-column:1/-1;margin:0;font-size:.7rem;color:var(--ez-muted);line-height:1.5}
      .teamTrendTestNote{margin:0;color:var(--ez-muted);font-size:.75rem;line-height:1.5}
    `}</style>
  </section>;
}
