"use client";

import { createContext, useContext, type ReactNode } from "react";
import { TeamLogoName } from "./TeamLogoName";
import { findNbaLineup, lineupFinal, type NbaGameLineup, type NbaLineupPlayer, type NbaLineupTeam } from "../lib/nbaLineupsCore";

const EMPTY: NbaGameLineup[] = [];
const LineupContext = createContext<NbaGameLineup[]>(EMPTY);
export function NbaLineupProvider({ lineups = EMPTY, children }: { lineups?: NbaGameLineup[]; children: ReactNode }) {
  return <LineupContext.Provider value={lineups}>{children}</LineupContext.Provider>;
}
const STATUS: Record<string, string> = { QUESTIONABLE: "Questionable", PROBABLE: "Probable", DOUBTFUL: "Doubtful", OUT: "Out", AVAILABLE: "Available" };
function Player({ player }: { player: NbaLineupPlayer }) {
  return <li className="nbaLineupPlayer"><span className="nbaLineupPosition">{player.position}</span>
    <span className="nbaLineupName">{player.name}</span>
    {STATUS[player.status] ? <span className="nbaLineupInjury" data-status={player.status}>{STATUS[player.status]}</span> : null}</li>;
}
function Team({ lineup }: { lineup: NbaLineupTeam }) {
  return <section className="nbaLineupTeam" aria-label={`${lineup.team} starting lineup`}>
    <header><TeamLogoName sport="NBA" team={lineup.team} /><span className="nbaLineupStatus" data-final={lineup.confirmed}>{lineup.confirmed ? "Final" : "Pending"}</span></header>
    <p className="nbaLineupCaption">{lineup.confirmed ? "Confirmed starting five" : "Projected starting five"}</p>
    <ol className="nbaLineupPlayers">{lineup.starters.map(player => <Player key={player.id} player={player} />)}</ol>
    {lineup.injuries.length ? <><p className="nbaLineupCaption">Other listed injuries</p>
      <ul className="nbaLineupPlayers nbaLineupOther">{lineup.injuries.map(player => <Player key={player.id} player={player} />)}</ul></> : null}
  </section>;
}

export default function NbaGameLineups({ gameId, game, date, lineups }: { gameId?: string; game?: string; date?: string; lineups?: NbaGameLineup[] }) {
  const shared = useContext(LineupContext), lineup = findNbaLineup(lineups || shared, { gameId, game, date });
  const final = lineupFinal(lineup);
  return <details className="nbaLineups" data-game-id={gameId || lineup?.gameId}>
    <summary><span>Lineups</span><span className="nbaLineupStatus" data-final={final}>{final ? "Final" : "Pending"}</span><span className="nbaLineupChevron" aria-hidden="true">⌄</span></summary>
    <div className="nbaLineupBody">{lineup ? <>
      <div className="nbaLineupTeams"><Team lineup={lineup.away} /><Team lineup={lineup.home} /></div>
      <p className="nbaLineupSource"><a href={lineup.sourceUrl} target="_blank" rel="noreferrer">RotoWire</a> · Updated {new Date(lineup.observedAt).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })} ET</p>
    </> : <p className="nbaLineupEmpty">Projected starting lineups are not available yet.</p>}</div>
  </details>;
}
