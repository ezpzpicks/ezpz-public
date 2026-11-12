/**
 * The sole source of NEW official EZPZ Picks (effective 2026-11-12).
 *
 * An approved row is intentionally a Git-reviewed, manually entered decision.
 * Research shortlists, model grades, signals and situation rules cannot write
 * to this manifest. Ryan alone chooses official picks; ChatGPT records his
 * explicit selections here and publishes them. No research comparison is an
 * approval requirement. Historical automatic signal ledgers remain untouched.
 */
import manifest from "../data/manual-ezpz-picks.json";
import type { McpSport } from "./ezpzMcpPicks";

export const MANUAL_EZPZ_EFFECTIVE_DATE = "2026-11-12";

export type ManualApprovedPick = {
  id: string;
  sport: McpSport;
  date: string;
  game: string;
  gameTime: string;
  market: string;
  selection: string;
  line: number | string | null;
  odds: string | null;
  approvedAt: string;
  approvedBy: "ChatGPT";
  selectedBy: "Ryan";
  reviewedWithMuse?: boolean; // Historical context only; never an approval requirement.
  status: "approved";
  notes?: string;
  result?: "W" | "L" | "P" | "VOID" | "PENDING";
  netUnits?: number;
  resultSource?: string;
};

const SPORTS = new Set<string>(["MLB", "NFL", "NCAAF", "NBA", "NCAAM"]);
const DATE = /^20\d{2}-\d{2}-\d{2}$/;
const ID = /^manual_[a-zA-Z0-9_-]{6,120}$/;

function easternDate(value: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(value));
  const get = (part: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === part)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function getApprovedManualPicks(sport?: McpSport, date?: string, now = Date.now()): ManualApprovedPick[] {
  const input: unknown[] = Array.isArray(manifest.picks) ? manifest.picks : [];
  const used = new Set<string>();
  const output: ManualApprovedPick[] = [];
  for (const value of input) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const row = value as unknown as Record<string, unknown>;
    const id = String(row.id || ""), selectedSport = String(row.sport || "");
    const selectedDate = String(row.date || ""), game = String(row.game || "").trim();
    const market = String(row.market || "").trim(), selection = String(row.selection || "").trim();
    const gameTime = Date.parse(String(row.gameTime || ""));
    const approvedAt = Date.parse(String(row.approvedAt || ""));
    const numericLine = row.line === null ? null : typeof row.line === "number" && Number.isFinite(row.line)
      ? row.line : typeof row.line === "string" && row.line.trim() ? row.line.trim() : undefined;
    if (!ID.test(id) || used.has(id) || !SPORTS.has(selectedSport)
      || !DATE.test(selectedDate) || selectedDate < MANUAL_EZPZ_EFFECTIVE_DATE
      || !game || !market || !selection || numericLine === undefined
      || !Number.isFinite(gameTime) || !Number.isFinite(approvedAt)
      || easternDate(gameTime) !== selectedDate || approvedAt > gameTime || approvedAt > now
      || row.status !== "approved" || row.approvedBy !== "ChatGPT" || row.selectedBy !== "Ryan") continue;
    if (row.odds !== null && row.odds !== undefined && typeof row.odds !== "string") continue;
    const result = String(row.result || "PENDING").toUpperCase();
    if (!["W", "L", "P", "VOID", "PENDING"].includes(result)) continue;
    if (result !== "PENDING" && (typeof row.netUnits !== "number" || !Number.isFinite(row.netUnits)
      || (result === "W" && row.netUnits <= 0) || (result === "L" && row.netUnits !== -1)
      || (["P", "VOID"].includes(result) && row.netUnits !== 0)
      || typeof row.resultSource !== "string" || !row.resultSource.trim())) continue;
    used.add(id);
    const pick: ManualApprovedPick = {
      id, sport: selectedSport as McpSport, date: selectedDate,
      game, gameTime: new Date(gameTime).toISOString(),
      market, selection, line: numericLine,
      odds: row.odds == null ? null : String(row.odds),
      approvedAt: new Date(approvedAt).toISOString(),
      approvedBy: "ChatGPT", selectedBy: "Ryan", status: "approved",
      ...(typeof row.reviewedWithMuse === "boolean" ? { reviewedWithMuse: row.reviewedWithMuse } : {}),
      ...(typeof row.notes === "string" && row.notes.trim() ? { notes: row.notes.trim() } : {}),
      result: result as ManualApprovedPick["result"],
      ...(result !== "PENDING" ? { netUnits: row.netUnits as number, resultSource: String(row.resultSource) } : {}),
    };
    if ((!sport || pick.sport === sport) && (!date || pick.date === date)) output.push(pick);
  }
  return output.sort((a, b) => a.gameTime.localeCompare(b.gameTime) || a.id.localeCompare(b.id));
}

export function manualPickForMcp(pick: ManualApprovedPick) {
  return {
    ...pick, gameKey: pick.id, pickCategory: "manual" as const,
    snapshotStatus: "FINAL_PREGAME" as const, lockedAt: pick.approvedAt,
    selected: true, result: "", source: "ryan-selected-manual-approval",
  };
}
