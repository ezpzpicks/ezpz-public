export const TEAM_TREND_READY_POLICY = "team-trend-ready-2026-10-17-v1";
export const TEAM_TREND_POSTING_START_HOUR_ET = 8;

/** Release only the current Eastern game day's board, starting in the morning. */
export function isTeamTrendPostingTime(gameDate: string, now: number): boolean {
  if (!Number.isFinite(now)) return false;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(now));
  const value = (type: string) => parts.find(part => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}` === gameDate
    && Number(value("hour")) >= TEAM_TREND_POSTING_START_HOUR_ET;
}

/** New early locks carry evidence; legacy locks retain their 20-minute limit. */
export function isSavedTeamTrendCapture(pick: Record<string, any>): boolean {
  const saved = Date.parse(String(pick.savedAt || "")), kickoff = Date.parse(String(pick.gameTime || ""));
  if (!Number.isFinite(saved) || !Number.isFinite(kickoff) || saved >= kickoff) return false;
  if (!pick.capturePolicy) return kickoff - saved <= 20 * 60_000;
  return pick.capturePolicy === TEAM_TREND_READY_POLICY
    && Date.parse(String(pick.capturedAt || "")) === saved
    && Date.parse(String(pick.teamTrendScore?.capturedAt || "")) === saved
    && isTeamTrendPostingTime(String(pick.date || ""), saved);
}
