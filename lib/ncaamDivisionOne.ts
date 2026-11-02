import { membership } from "../data/ncaamDivisionOneTeams";
import type { TursoRow } from "./tursoStore";

export const NCAAM_DIVISION_ONE_POLICY = "ncaam-both-division-one-v1";
const { season, teams } = membership;
const members = new Set(teams.map(team => team.id));
if (members.size !== teams.length || members.size < 300) throw new Error("Invalid NCAAM Division I membership snapshot.");

/** Membership uses verified ESPN IDs, never a similar name or a betting line. */
export function ncaamDivisionOneMatchup(awayId: string, homeId: string, gameSeason: number) {
  return gameSeason === season && awayId !== homeId && members.has(awayId) && members.has(homeId);
}

export function ncaamDivisionOneSchedule(rows: TursoRow[]) {
  return rows.filter(row => {
    const date = row.Date || "", year = Number(date.slice(0, 4));
    const gameSeason = row.Season ? Number(row.Season) : year + (Number(date.slice(5, 7)) >= 7 ? 1 : 0);
    return ncaamDivisionOneMatchup(row["Away Team ID"], row["Home Team ID"], gameSeason);
  });
}
