import { isSignalFeedPick, SIGNAL_NAMES } from "./signalPicks";
import { createHash } from "node:crypto";
import { parseGameStart, isoDate } from "./mlbTrendV2";
import { TEAM_TREND_TEST_THRESHOLD, TEAM_TREND_TEST_VERSION } from "./footballTeamTrendPlays";
import { isSavedTeamTrendCapture, TEAM_TREND_READY_POLICY } from "./teamTrendPosting";

export const MCP_SPORTS = ["MLB", "NFL", "NCAAF"] as const;
export type McpSport = (typeof MCP_SPORTS)[number];
type AnyPick = Record<string, any>;
type McpTeamRecord = { label: string; record: string | null; sample: number };
export type McpTeamRecords = {
  team: string; betType: McpTeamRecord; venue: McpTeamRecord; recent: McpTeamRecord;
};

export type McpPick = {
  pickId: string; sport: McpSport; date: string; game: string; market: string;
  selection: string; line: string | number | null; odds: string | null; gameTime: string;
  pickCategory: "public_bet_trend" | "team_trend" | "signals"; signalCount?: number; threshold?: number; signalNames?: string[]; pickLabel: string; teamTrendScore: number | null;
  teamTrendRecords: McpTeamRecords[] | null;
  pickType: string; lastSeven: { record: string; wins: number; losses: number; pushes: number; totalBets: number } | null;
  snapshotStatus: "LIVE" | "FINAL_PREGAME"; finalizedAt: string | null;
  eligibleForPosting: boolean; sourceUrl: string;
};

export function stablePickId(sport: McpSport, pick: AnyPick): string {
  // The frozen game + market decision owns the ID even if the feed is refreshed or its label changes.
  const date = isoDate(pick.date || pick.Date);
  const game = String(pick.gameKey || pick.v2GameKey || pick.game || pick.Game || "").trim().toLowerCase();
  const market = String(pick.market || pick.Market || pick.propMarket || "").trim().toLowerCase();
  const player = String(pick.playerName || pick.Player || "").trim().toLowerCase();
  const identity = [sport, date, game, market, player];
  // Preserve existing public-pick IDs and their delivery ledger. A team decision
  // is independently publishable even for the same game, market and direction.
  if (pick.pickCategory === "team_trend" || pick.pickCategory === "signals") identity.push(pick.pickCategory);
  return `ezpz_${createHash("sha256").update(JSON.stringify(identity)).digest("hex").slice(0,32)}`;
}

export function isSelectedTeamTrendPick(pick: AnyPick): boolean {
  const score = pick.teamTrendScore?.score;
  if (pick.strategyVersion !== TEAM_TREND_TEST_VERSION || pick.threshold !== TEAM_TREND_TEST_THRESHOLD
    || typeof score !== "number" || !Number.isFinite(score) || score < TEAM_TREND_TEST_THRESHOLD || score > 100
    || !["Spread", "Total"].includes(pick.market) || typeof pick.line !== "number" || !Number.isFinite(pick.line)) return false;
  if (pick.snapshotStatus === "LIVE") return true;
  return pick.snapshotStatus === "FINAL_PREGAME" && pick.teamTrendScore.mode === "locked"
    && isSavedTeamTrendCapture(pick);
}

function lastSeven(pick: AnyPick): McpPick["lastSeven"] {
  const value = pick.rankingLastSeven;
  if (!value || typeof value !== "object") return null;
  const wins = Number(value.wins), losses = Number(value.losses), pushes = Number(value.pushes ?? 0);
  if (![wins, losses, pushes].every(n => Number.isSafeInteger(n) && n >= 0) || wins + losses + pushes > 7) return null;
  const record = String(value.record || `${wins}-${losses}-${pushes}`);
  const match = record.match(/^(\d+)-(\d+)(?:-(\d+))?$/);
  if (!match || Number(match[1]) !== wins || Number(match[2]) !== losses || Number(match[3] || 0) !== pushes) return null;
  return { record, wins, losses, pushes, totalBets: wins + losses + pushes };
}

function capturedTeamRecords(pick: AnyPick): McpTeamRecords[] | null {
  const teams = pick.teamTrendScore?.teams;
  if (!Array.isArray(teams) || teams.length !== 2) return null;
  const output: McpTeamRecords[] = [];
  for (const team of teams) {
    const name = String(team?.team || "").trim();
    if (!name) return null;
    const records: Partial<Record<"betType" | "venue" | "recent", McpTeamRecord>> = {};
    for (const key of ["betType", "venue", "recent"] as const) {
      const r = team.records?.[key], label = String(r?.label || "").trim();
      const match = String(r?.record || "").match(/^(\d+)-(\d+)-(\d+)$/);
      const sample = r?.sample;
      if (!label || !match || !Number.isSafeInteger(sample) || sample < 0
        || match.slice(1).reduce((sum, value) => sum + Number(value), 0) !== sample) return null;
      records[key] = { label, record: sample ? r.record : null, sample };
    }
    // Keep each team's actual results, including the opponent's ATS record;
    // never invert a record to make it look supportive of the selection.
    output.push({ team: name, betType: records.betType!, venue: records.venue!, recent: records.recent! });
  }
  return output;
}

export function normalizeMcpPick(sport: McpSport, pick: AnyPick, now = Date.now()): McpPick | null {
  const teamTrend = pick.pickCategory === "team_trend", signalTest = pick.pickCategory === "signals";
  if (signalTest && !isSignalFeedPick(pick, sport)) return null;
  if (teamTrend && (sport === "MLB" || !isSelectedTeamTrendPick(pick))) return null;
  if (pick.selected === false || (pick.protectionStatus && pick.protectionStatus !== "PASSED")) return null;
  // MLB cards explicitly gate selection; football's feed is already the catalog-selected list.
  if (sport === "MLB" && (pick.selected !== true || pick.protectionStatus !== "PASSED")) return null;
  const date = isoDate(pick.date || pick.Date);
  const game = String(pick.game || pick.Game || "").trim();
  const market = String(pick.market || pick.Market || pick.propMarket || "").trim();
  const selection = String(pick.selection || pick.play || pick.Play || "").trim();
  const gameStart = parseGameStart(date, pick.gameTime || pick["Game Time"]);
  const status = pick.snapshotStatus === "FINAL_PREGAME" ? "FINAL_PREGAME" : "LIVE";
  if (!date || !game || !market || !selection || gameStart == null) return null;
  const frozen = Date.parse(String(teamTrend ? pick.savedAt : pick.lockedAt || pick.frozenAt || ""));
  const result = String(pick.result || pick.Result || "").trim();
  return {
    pickId: stablePickId(sport, pick), sport, date, game, market, selection,
    line: pick.line ?? pick.propLine ?? null, odds: pick.odds == null || pick.odds === "" ? null : String(pick.odds),
    gameTime: new Date(gameStart).toISOString(),
    pickCategory: signalTest ? "signals" : teamTrend ? "team_trend" : "public_bet_trend",
    ...(signalTest ? { signalCount: pick.signalCount, threshold: pick.threshold,
      signalNames: pick.signals.filter((s: AnyPick) => s.active && s.available).map((s: AnyPick) => SIGNAL_NAMES[s.key]) } : {}),
    pickLabel: signalTest ? "EZPZ Signal Pick" : teamTrend ? "EZPZ Team Trend" : "EZPZ Public Bet Trend",
    teamTrendScore: teamTrend ? pick.teamTrendScore.score : null,
    teamTrendRecords: teamTrend ? capturedTeamRecords(pick) : null,
    pickType: signalTest ? `${pick.signalCount} signals: ${pick.qualification}` : teamTrend ? `Team Trend (score >= ${pick.threshold}/100)`
      : String(pick.tier || pick.trendTier || pick.bestPlayType || pick.source || "").trim(),
    // Team records used by the score are not the strategy's last seven bets.
    lastSeven: teamTrend || signalTest ? null : lastSeven(pick), snapshotStatus: status,
    finalizedAt: status === "FINAL_PREGAME" && Number.isFinite(frozen) ? new Date(frozen).toISOString() : null,
    eligibleForPosting: status === "FINAL_PREGAME" && gameStart > now && (!Number.isFinite(frozen) || frozen <= now)
      && !/^(?:W|L|P|WIN|LOSS|PUSH|WON|LOST)$/i.test(result),
    sourceUrl: "https://ezpzpicks.com",
  };
}

// A recently read, selected football pick owns its frozen snapshot independently
// of unrelated LIVE markets. A FINAL label alone is insufficient on a stale feed.
export function isVerifiedFrozenFootballMcpPick(sport: McpSport, raw: AnyPick, now = Date.now()): boolean {
  if (sport === "MLB") return false;
  const pick = normalizeMcpPick(sport, raw, now);
  if (!pick || pick.snapshotStatus !== "FINAL_PREGAME" || !pick.finalizedAt) return false;
  const captured = Date.parse(pick.finalizedAt);
  const lead = Date.parse(pick.gameTime) - captured;
  if (pick.pickCategory === "team_trend" && raw.capturePolicy === TEAM_TREND_READY_POLICY) return captured <= now;
  return captured <= now && lead >= 10 * 60_000 && lead <= 20 * 60_000;
}
