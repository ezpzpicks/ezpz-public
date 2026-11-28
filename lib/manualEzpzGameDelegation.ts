// The original NCAAM delegation has a separate effective date and scope.
export const GAME_MARKET_DELEGATION = "ezpz-nba-nfl-ncaaf-2026-11-28";
const authorizedAt = "2026-11-28T16:33:22.566507Z";

// Preserve sub-millisecond precision at both authorization and kickoff. Convert
// explicit UTC offsets to UTC before comparing equal-width ISO instants.
export function gameDecisionUtc(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.(\d{1,9}))?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  const ms = Date.parse(value);
  if (!match || !Number.isFinite(ms)) return null;
  const day = new Date(value.slice(0, 10) + "T00:00:00Z");
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value.slice(0, 10) || value.slice(11, 13) >= "24") return null;
  return new Date(ms).toISOString().slice(0, -1) + (match[1] || "").slice(3) + "Z";
}

type Selection = {
  sport?: unknown; market?: unknown; selection?: unknown; line?: unknown; delegation?: unknown;
  selectedBy?: unknown; approvedBy?: unknown; gameTime?: unknown; approvedAt?: unknown;
};

export function isDelegatedGameMarket(row: Selection, now?: number): boolean {
  if (row.delegation !== GAME_MARKET_DELEGATION || row.selectedBy !== "ChatGPT" || row.approvedBy !== "Ryan"
    || !["NBA", "NFL", "NCAAF"].includes(String(row.sport)) || typeof row.selection !== "string") return false;
  const selection = row.selection.trim().replace(/[−–]/g, "-");
  const match = row.market === "Total" ? /^(?:over|under)\s+(\d+(?:\.\d+)?)$/i.exec(selection)
    : row.market === "Spread" ? /^(?!.*\b(?:over|under)\b).+?\s+([+-]?\d+(?:\.\d+)?)$/i.exec(selection) : null;
  if (!match || (typeof row.line !== "number" && !(typeof row.line === "string" && row.line.trim()))
    || Number(row.line) !== Number(match[1]) || !Number.isFinite(Number(row.line))) return false;
  const decision = gameDecisionUtc(row.approvedAt), start = gameDecisionUtc(row.gameTime);
  if (!decision || !start) return false;
  const key = (utc: string) => utc.slice(0, -1).padEnd(29, "0");
  return key(decision) >= key(authorizedAt) && key(decision) < key(start)
    && (now === undefined || (Number.isFinite(now) && key(decision) <= key(new Date(now).toISOString())));
}
