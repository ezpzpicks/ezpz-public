"use client";

import { MatchupWithLogos, SelectionWithTeamLogo } from "./TeamLogoName";
import type { NbaMarketPayload } from "./NbaBoard";
import NbaGameLineups from "./NbaGameLineups";

export default function NbaEzpzPicks({ data }: { data: NbaMarketPayload }) {
  const picks = data.ezpzSelections || [];
  return <section className="nbaBoard" aria-label="NBA EZPZ Picks"><div className="nbaIntro"><h2>NBA EZPZ Picks</h2>
    <p>At least 3 signals across 2 independent sources, with at most one pick per game. Equal highest-signal candidates wait for a clear leader.</p>
    <p className="nbaSmall">Live previews update with the market. Official picks and their lines are saved at the final pregame snapshot. Spread and total odds assumed -110.</p></div>
    {data.stale ? <p className="nbaNotice" role="status">Market updates are delayed. Saved picks remain visible; new previews await fresh data.</p> : null}
    {picks.length ? picks.map(pick => <article key={pick.id} className="nbaCard">
      <h3><MatchupWithLogos sport="NBA" game={pick.game} /></h3><p className="nbaMeta">{pick.recorded ? "Final pregame pick" : "Live preview"} · {pick.signalCount} signals · {pick.market}</p>
      <NbaGameLineups game={pick.game} date={pick.date} />
      <strong className="nbaSelection"><SelectionWithTeamLogo sport="NBA" selection={pick.selection} game={pick.game} /></strong>
      <p>{pick.odds} · {new Date(pick.gameTime).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })} ET</p>
      <p>{pick.signals.filter(signal => signal.active).map(signal => ({ money: "Money support", move: "Line movement", system: "Public bet trends", team: "Team trends", model: "Model", sos: "Strength of schedule" }[signal.key])).join(" · ")}</p>
      {pick.result ? <span className="nbaResult" data-result={pick.result}>{pick.result}</span> : null}
    </article>) : <div className="nbaCard"><h3>No qualifying NBA EZPZ Picks yet</h3><p>Picks appear when the existing signal requirements are met. The full slate and individual Model Plays remain available.</p></div>}
  </section>;
}
