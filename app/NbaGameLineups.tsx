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
function Team({ lineup, sport }: { lineup: NbaLineupTeam; sport: "NBA" | "NCAAM" }) {
  const college = sport === "NCAAM", players = [...lineup.starters, ...lineup.injuries];
  return <section className="nbaLineupTeam" aria-label={`${lineup.team} starting lineup`}>
    <header><TeamLogoName sport={sport} team={lineup.team} /><span className="nbaLineupStatus" data-final={!college && lineup.confirmed}>{college ? lineup.complete ? "Projected" : "Incomplete" : lineup.confirmed ? "Final" : "Pending"}</span></header>
    {college && <div className="ncaamAvailability"><span>{players.filter(p => p.status === "OUT").length} out</span><span>{players.filter(p => p.status === "DOUBTFUL").length} doubtful</span><span>{players.filter(p => p.status === "QUESTIONABLE").length} questionable</span></div>}
    <p className="nbaLineupCaption">{college ? `${lineup.starters.length}/5 projected starters · Depth chart` : lineup.confirmed ? "Confirmed starting five" : "Projected starting five"}</p>
    <ol className="nbaLineupPlayers">{lineup.starters.map(player => <Player key={player.id} player={player} />)}</ol>
    {lineup.injuries.length ? <><p className="nbaLineupCaption">Other listed injuries</p>
      <ul className="nbaLineupPlayers nbaLineupOther">{lineup.injuries.map(player => <Player key={player.id} player={player} />)}</ul></> : null}
  </section>;
}

export default function NbaGameLineups({ gameId, game, date, lineups, sport = "NBA" }: { gameId?: string; game?: string; date?: string; lineups?: NbaGameLineup[]; sport?: "NBA" | "NCAAM" }) {
  const shared = useContext(LineupContext), lineup = findNbaLineup(lineups || shared, { gameId, game, date });
  const final = lineupFinal(lineup), college = sport === "NCAAM" || lineup?.sport === "NCAAM";
  return <details className="nbaLineups" data-game-id={gameId || lineup?.gameId}>
    <summary><span>Lineups</span><span className="nbaLineupStatus" data-final={final}>{college ? lineup ? "Projected" : "Unavailable" : final ? "Final" : "Pending"}</span><span className="nbaLineupChevron" aria-hidden="true">⌄</span></summary>
    <div className="nbaLineupBody">{lineup ? <>
      <div className="nbaLineupTeams"><Team lineup={lineup.away} sport={college ? "NCAAM" : "NBA"} /><Team lineup={lineup.home} sport={college ? "NCAAM" : "NBA"} /></div>
      {college && <p className="nbaLineupEmpty">College lineups are depth-chart projections. Unlisted injuries remain unknown; incomplete fives stay incomplete.</p>}
      <p className="nbaLineupSource"><a href={lineup.sourceUrl} target="_blank" rel="noreferrer">RotoWire</a> · Updated {new Date(lineup.observedAt).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })} ET</p>
    </> : <p className="nbaLineupEmpty">Projected starting lineups are not available yet.</p>}</div>
  </details>;
}
