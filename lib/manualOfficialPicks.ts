import { createHash } from "node:crypto";
import ledger from "../data/official-ezpz-picks.json";

export const MANUAL_EZPZ_START = "2026-11-12";
export const OFFICIAL_SPORTS = ["MLB", "NFL", "NCAAF", "NBA", "NCAAM"] as const;
export type OfficialSport = (typeof OFFICIAL_SPORTS)[number];
export type ApprovedPick = {
  pickId: string;
  sport: OfficialSport;
  date: string;
  game: string;
  gameTime: string;
  market: string;
  selection: string;
  line: number | null;
  odds: number | null;
  oddsBasis: "observed" | "assumed" | "unavailable";
  approvedAt: string;
  approvedBy: "ChatGPT";
  reviewedSources: ["ChatGPT", "Muse"] | ["Muse", "ChatGPT"];
  pickCategory: "manual";
  pickLabel: "EZPZ PICK";
  selectionMethod: "manual_review";
  snapshotStatus: "FINAL_PREGAME";
  finalizedAt: string;
  eligibleForPosting: boolean;
  result: string;
  sourceUrl: string;
};

/** This version-controlled list is the ONLY official-pick source from Nov 12 onward.
 * Signal/model candidates and play-type rules are research inputs, never automatic picks.
 * Every entry is a deliberate edit after ChatGPT and Muse reports have been compared.
 */
export function dateET(value: number | string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(parsed);
  const part = (type: string) => parts.find(item => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function isOfficialSport(value: string): value is OfficialSport {
  return (OFFICIAL_SPORTS as readonly string[]).includes(value);
}

function approvedEntry(raw: unknown, now: number): ApprovedPick | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const sport = String(row.sport || "").toUpperCase();
  const date = String(row.date || "");
  const game = String(row.game || "").trim();
  const market = String(row.market || "").trim();
  const selection = String(row.selection || "").trim();
  const gameTime = String(row.gameTime || "");
  const approvedAt = String(row.approvedAt || "");
  const kickoff = Date.parse(gameTime), approved = Date.parse(approvedAt);
  const reviewers = row.reviewedSources;
  const numericLine = row.line === null ? null : Number(row.line);
  const numericOdds = row.odds === null ? null : Number(row.odds);
  const oddsBasis = row.oddsBasis;
  if (!isOfficialSport(sport) || !/^20\d{2}-\d{2}-\d{2}$/.test(date)
    || date < MANUAL_EZPZ_START || dateET(gameTime) !== date
    || !game || !market || !selection || !Number.isFinite(kickoff)
    || !Number.isFinite(approved) || approved > now + 60_000 || approved >= kickoff
    || row.status !== "approved" || row.approvedBy !== "ChatGPT"
    || !Array.isArray(reviewers) || reviewers.length !== 2
    || !reviewers.includes("ChatGPT") || !reviewers.includes("Muse")
    || !["observed", "assumed", "unavailable"].includes(String(oddsBasis))
    || (numericLine !== null && !Number.isFinite(numericLine))
    || (numericOdds !== null && !Number.isFinite(numericOdds))
    || (/^(Spread|Total)$/i.test(market) && numericLine === null)
    || (/prop/i.test(market) && (numericLine === null || numericOdds === null || oddsBasis !== "observed"))
    || (oddsBasis === "assumed" && !/^(Spread|Total)$/i.test(market))) return null;
  const identity = [date, sport, game, market, selection, numericLine ?? ""].join("|");
  return {
    pickId: "ezpz_" + createHash("sha256").update(identity).digest("hex").slice(0, 32),
    sport, date, game, gameTime, market, selection,
    line: numericLine, odds: numericOdds, oddsBasis: oddsBasis as ApprovedPick["oddsBasis"],
    approvedAt, approvedBy: "ChatGPT", reviewedSources: ["ChatGPT", "Muse"],
    pickCategory: "manual", pickLabel: "EZPZ PICK", selectionMethod: "manual_review",
    snapshotStatus: "FINAL_PREGAME", finalizedAt: approvedAt,
    eligibleForPosting: kickoff > now, result: String(row.result || ""),
    sourceUrl: "https://ezpzpicks.com",
  };
}

export function readApprovedPicks(options: { sport?: OfficialSport; date?: string; now?: number } = {}) {
  const now = options.now ?? Date.now();
  const picks: ApprovedPick[] = [];
  const seen = new Set<string>();
  for (const raw of ledger.picks as unknown[]) {
    const pick = approvedEntry(raw, now);
    if (!pick || seen.has(pick.pickId)) continue;
    if (options.sport && pick.sport !== options.sport) continue;
    if (options.date && pick.date !== options.date) continue;
    seen.add(pick.pickId);
    picks.push(pick);
  }
  return picks.sort((a, b) => a.gameTime.localeCompare(b.gameTime) || a.pickId.localeCompare(b.pickId));
}
