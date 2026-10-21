import { parseGameStart } from "./mlbTrendV2";

const MINUTE = 60_000;
export const MARKET_REFRESH_POLICY = "30m-until-90m-v1";
export type RefreshGame = { kickoff: number | null; date: string; final: boolean; live?: boolean };

export function marketRefreshDecision(games: RefreshGame[], today: string, now: number,
  lastSuccess: number | null, includeResults = false) {
  // Keep recovery/settlement responsive after kickoff. Unknown same-day times
  // stay on the faster cadence rather than risking a missed final snapshot.
  const fast = games.some(game => !game.final && ((includeResults && game.live) || (game.kickoff == null ? game.date === today
    : game.kickoff - now <= 90 * MINUTE && game.kickoff - now >= -(includeResults ? 8 * 60 : 15) * MINUTE)));
  const intervalMinutes = fast ? 5 : 30;
  const age = lastSuccess == null ? Infinity : now - lastSuccess;
  return { due: age < 0 || (fast
      ? lastSuccess == null || Math.floor(now / (5 * MINUTE)) > Math.floor(lastSuccess / (5 * MINUTE))
      : age >= 30 * MINUTE - 30_000), intervalMinutes,
    policy: MARKET_REFRESH_POLICY, reason: fast ? "Near game time or awaiting results" : "Outside the 90-minute countdown" };
}

export function currentPickSnapshotMaxAge(snapshot: {
  refreshPolicy?: string; refreshIntervalMinutes?: number;
  picks?: Array<Record<string, any>>; teamTrendPicks?: Array<Record<string, any>>;
}, now: number) {
  const normal = 20 * MINUTE;
  if (snapshot.refreshPolicy !== MARKET_REFRESH_POLICY || snapshot.refreshIntervalMinutes !== 30) return normal;
  const upcoming = [...(snapshot.picks || []), ...(snapshot.teamTrendPicks || [])]
    .filter(pick => !/^(W|L|P|WIN|LOSS|PUSH)$/i.test(String(pick.result || "")));
  // A saved final/near-kickoff decision still needs the existing short freshness
  // window. The extra allowance applies only to the explicitly slower schedule.
  if (upcoming.some(pick => {
    const kickoff = parseGameStart(pick.date || pick.Date, pick.gameTime || pick["Game Time"]);
    return kickoff == null || (kickoff > now && kickoff - now <= 90 * MINUTE);
  })) return normal;
  return 35 * MINUTE;
}
