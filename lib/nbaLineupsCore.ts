import { nbaTeamKey } from "./nbaMarketCore";

export const NBA_LINEUP_SOURCE = "https://www.rotowire.com/basketball/nba-lineups.php";
export type NbaLineupPlayer = { id: string; name: string; position: string; status: string };
export type NbaLineupTeam = {
  team: string; confirmed: boolean; starters: NbaLineupPlayer[]; injuries: NbaLineupPlayer[];
};
export type NbaGameLineup = {
  gameId: string; date: string; tipoff: string; observedAt: string;
  source: "RotoWire"; sourceUrl: string; away: NbaLineupTeam; home: NbaLineupTeam;
};
export type NbaLineupGame = { gameId: string; date: string; tipoff: string; away: string; home: string };

export function lineupStatus(value: unknown): string | null {
  const key = String(value || "").trim().toUpperCase();
  return ({ "": "UNKNOWN", UNKNOWN: "UNKNOWN", QUES: "QUESTIONABLE", QUESTIONABLE: "QUESTIONABLE",
    PROB: "PROBABLE", PROBABLE: "PROBABLE", DOUBT: "DOUBTFUL", DOUBTFUL: "DOUBTFUL",
    OUT: "OUT", OFS: "OUT", AVAILABLE: "AVAILABLE", ACTIVE: "AVAILABLE" } as Record<string, string>)[key] ?? null;
}

function reportTeam(raw: any, team: string): NbaLineupTeam | null {
  if (nbaTeamKey(raw?.team || "") !== nbaTeamKey(team) || !Array.isArray(raw?.players)
    || !Array.isArray(raw?.starters) || raw.starters.length !== 5 || new Set(raw.starters).size !== 5) return null;
  const players = new Map<string, NbaLineupPlayer>();
  for (const row of raw.players) {
    const id = String(row?.player_id || ""), name = String(row?.name || "").trim(), status = lineupStatus(row?.status);
    if (!id || !name || status == null || players.has(id)) return null;
    players.set(id, { id, name, position: String(row.position || ""), status });
  }
  const starters = raw.starters.map((id: string) => players.get(id));
  if (starters.some((player: NbaLineupPlayer | undefined) => !player || ["OUT", "DOUBTFUL"].includes(player.status))) return null;
  return { team, confirmed: raw.confirmed === true, starters,
    injuries: [...players.values()].filter(player => !raw.starters.includes(player.id) && !["UNKNOWN", "AVAILABLE"].includes(player.status)) };
}

/** Consume the same public, source-observed report already stored by the NBA builder. */
export function lineupFromRotoWireReport(game: NbaLineupGame, report: any): NbaGameLineup | null {
  if (report?.provider !== "RotoWire" || report.date !== game.date || report.source_url !== NBA_LINEUP_SOURCE
    || !Number.isFinite(Date.parse(report.fetched_at)) || !Array.isArray(report.games)) return null;
  const matches = report.games.filter((entry: any) => nbaTeamKey(entry?.away?.team || "") === nbaTeamKey(game.away)
    && nbaTeamKey(entry?.home?.team || "") === nbaTeamKey(game.home));
  if (matches.length !== 1) return null;
  const away = reportTeam(matches[0].away, game.away), home = reportTeam(matches[0].home, game.home);
  if (!away || !home || new Set([...away.starters, ...away.injuries, ...home.starters, ...home.injuries].map(p => p.id)).size
    !== away.starters.length + away.injuries.length + home.starters.length + home.injuries.length) return null;
  return { gameId: game.gameId, date: game.date, tipoff: game.tipoff, observedAt: report.fetched_at,
    source: "RotoWire", sourceUrl: NBA_LINEUP_SOURCE, away, home };
}

export const lineupFinal = (lineup?: NbaGameLineup | null) => Boolean(lineup?.away.confirmed && lineup?.home.confirmed
  && lineup.away.starters.length === 5 && lineup.home.starters.length === 5);

export function mergeNbaLineups(...lists: NbaGameLineup[][]): NbaGameLineup[] {
  const latest = new Map<string, NbaGameLineup>();
  for (const lineup of lists.flat()) {
    const key = `${lineup.date}|${lineup.gameId}`, previous = latest.get(key);
    if (!previous || Date.parse(lineup.observedAt) > Date.parse(previous.observedAt)) latest.set(key, lineup);
  }
  return [...latest.values()].sort((a, b) => a.tipoff.localeCompare(b.tipoff));
}

export function findNbaLineup(lineups: NbaGameLineup[], { gameId, game, date }: { gameId?: string; game?: string; date?: string }) {
  const teams = String(game || "").split(/\s*@\s*|\s+(?:at|vs\.?)\s+/i);
  const matches = lineups.filter(lineup => (!date || lineup.date === date) && (gameId ? lineup.gameId === gameId
    : teams.length === 2 && nbaTeamKey(lineup.away.team) === nbaTeamKey(teams[0]) && nbaTeamKey(lineup.home.team) === nbaTeamKey(teams[1])));
  return matches.length === 1 ? matches[0] : undefined;
}
