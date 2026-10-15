import { createHash } from "node:crypto";
import { parseGameStart, isoDate } from "./mlbTrendV2";

export const MCP_SPORTS = ["MLB", "NFL", "NCAAF"] as const;
export type McpSport = (typeof MCP_SPORTS)[number];
type AnyPick = Record<string, any>;

export type McpPick = {
  pickId: string; sport: McpSport; date: string; game: string; market: string;
  selection: string; line: string | number | null; odds: string | null; gameTime: string;
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
  return `ezpz_${createHash("sha256").update(JSON.stringify([sport, date, game, market, player])).digest("hex").slice(0,32)}`;
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

export function normalizeMcpPick(sport: McpSport, pick: AnyPick, now = Date.now()): McpPick | null {
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
  const frozen = Date.parse(String(pick.lockedAt || pick.frozenAt || ""));
  const result = String(pick.result || pick.Result || "").trim();
  return {
    pickId: stablePickId(sport, pick), sport, date, game, market, selection,
    line: pick.line ?? pick.propLine ?? null, odds: pick.odds == null || pick.odds === "" ? null : String(pick.odds),
    gameTime: new Date(gameStart).toISOString(),
    pickType: String(pick.tier || pick.trendTier || pick.bestPlayType || pick.source || "").trim(),
    lastSeven: lastSeven(pick), snapshotStatus: status,
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
  return captured <= now && lead >= 10 * 60_000 && lead <= 20 * 60_000;
}
