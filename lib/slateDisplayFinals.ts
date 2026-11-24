import { nflTrendTeamKey } from "./nflTrendIdentity";
export type SlateDisplayFinal = { gameId: string; date: string; sourceGameId: string; source: "ESPN";
  awayTeam: string; homeTeam: string; awayScore: number; homeScore: number };
type Row = Record<string, string>;
const etDate = (value: unknown) => {
  const stamp = Date.parse(String(value || ""));
  if (!Number.isFinite(stamp)) return "";
  const parts = new Intl.DateTimeFormat("en-US", {timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(stamp);
  const get = (name:string) => parts.find(p=>p.type===name)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
};
const score = (value: unknown) => {
  if ((typeof value !== "string" && typeof value !== "number") || String(value).trim() === "") return null;
  const n = Number(value); return Number.isSafeInteger(n) && n >= 0 ? n : null;
};
const isFinal = (status: any) => status?.type?.completed === true && status.type.state === "post" && status.type.name === "STATUS_FINAL";
/** Independent display evidence only: never settles bets or recovers projections. */
export function verifiedNflDisplayFinals(rows: Row[], date: string, payload: any): SlateDisplayFinal[] {
  const finals: SlateDisplayFinal[] = [];
  for (const row of rows) {
    const id = row["Game ID"] || "";
    if (!id || row.Date !== date || !row["Away Team"] || !row["Home Team"]) continue;
    if (row["Game Time"]?.includes("T") && etDate(row["Game Time"]) !== date) continue;
    const matches: SlateDisplayFinal[] = [];
    for (const event of Array.isArray(payload?.events) ? payload.events : []) {
      if (!/^\d+$/.test(String(event.id)) || event.competitions?.length !== 1) continue;
      const competition = event.competitions[0];
      if (String(competition.id) !== String(event.id) || !isFinal(competition.status) || (event.status && !isFinal(event.status))) continue;
      if (etDate(competition.date) !== date || (event.date && etDate(event.date) !== date)) continue;
      const competitors = competition.competitors;
      if (!Array.isArray(competitors) || competitors.length !== 2) continue;
      const away = competitors.find(c => c.homeAway === "away"), home = competitors.find(c => c.homeAway === "home");
      if (!away?.team?.displayName || !home?.team?.displayName || !away.team.id || away.team.id === home.team.id) continue;
      const awayKey = nflTrendTeamKey(away.team.displayName), homeKey = nflTrendTeamKey(home.team.displayName);
      if (awayKey !== nflTrendTeamKey(row["Away Team"]) || homeKey !== nflTrendTeamKey(row["Home Team"])) continue;
      // Stored native NFL IDs use season_week_away_home; ESPN uses numeric event IDs.
      // Validate every native ID component against ESPN, not just the matchup text.
      const native = id.match(/^(\d{4})_(\d{1,2})_([A-Z]{2,3})_([A-Z]{2,3})$/);
      const idMatches = native ? event.season?.type === 2 && Number(native[1]) === event.season.year && Number(native[2]) === event.week?.number
        && nflTrendTeamKey(native[3]) === awayKey && nflTrendTeamKey(native[4]) === homeKey : id === String(event.id);
      if (!idMatches) continue;
      const awayScore = score(away.score), homeScore = score(home.score);
      if (awayScore == null || homeScore == null) continue;
      matches.push({gameId:id,date,sourceGameId:String(event.id),source:"ESPN",awayTeam:away.team.displayName,homeTeam:home.team.displayName,awayScore,homeScore});
    }
    if (matches.length === 1) finals.push(matches[0]); // Ambiguous identities fail closed.
  }
  return finals;
}
export function displayFinalForRow(finals: SlateDisplayFinal[], row: Row) {
  return finals.find(f=>f.gameId === row["Game ID"] && f.date === row.Date
    && nflTrendTeamKey(f.awayTeam) === nflTrendTeamKey(row["Away Team"])
    && nflTrendTeamKey(f.homeTeam) === nflTrendTeamKey(row["Home Team"]));
}
