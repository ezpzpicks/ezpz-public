import { createHash } from "node:crypto";
import { footballTeamKey } from "./footballTeamTrends";
import type { SheetRow } from "./sportSheets";

export const TOTAL_FORWARD_POLICY = "ncaaf-total-direction-forward-2026-10-30-v1";
export const TOTAL_FORWARD_PARAMETERS = {
  policy: TOTAL_FORWARD_POLICY, startedAt: "2026-10-30T17:09:32Z",
  modelVersion: "cfb-v2.8.1-five-game-residual-totals-2026-10-07", season: 2026,
  aMinimumPoints: 6, bMinimumPoints: 3, bMaximumExclusivePoints: 6,
  odds: -110, stakeUnits: 1, priceBasis: "ASSUMED_MINUS_110",
  captureRule: "First observed valid saved forecast before kickoff; immutable by policy and game ID",
  strategies: ["a_total_fade", "a_total_original_control", "b_total_original"], official: false,
} as const;
export const TOTAL_FORWARD_PARAMETER_JSON = JSON.stringify(TOTAL_FORWARD_PARAMETERS);
export const TOTAL_FORWARD_PARAMETER_HASH = createHash("sha256").update(TOTAL_FORWARD_PARAMETER_JSON).digest("hex");
export type TotalStrategy = "a_total_fade" | "a_total_original_control" | "b_total_original";
export type TotalForwardPrediction = {
  strategy: TotalStrategy; side: "Over" | "Under"; line: number; selection: string;
  odds: number; stakeUnits: number; priceBasis: string; official: false; eligibleForPosting: false;
};
export type TotalForwardGame = {
  policy: string; parameterHash: string; gameId: string; date: string; game: string;
  awayTeam: string; homeTeam: string; kickoff: string; capturedAt: string;
  modelVersion: string; grade: string; originalSide: "Over" | "Under"; line: number;
  projectedTotal: number; edgePoints: number; sourceBuildCapturedAt: string;
  predictions: TotalForwardPrediction[];
};
export function forwardNumber(value: unknown): number | null {
  if (value == null || String(value).trim() === "") return null;
  const n = Number(value); return Number.isFinite(n) ? n : null;
}
function timestamp(value: unknown) {
  const raw = String(value || "");
  if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)) return null;
  const n = Date.parse(raw); return Number.isFinite(n) ? n : null;
}
function easternDate(epoch: number) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(epoch);
  const p = (name: string) => parts.find(part => part.type === name)?.value || "";
  return `${p("year")}-${p("month")}-${p("day")}`;
}
function completed(row: SheetRow) { return /^(true|yes|1|final|completed)$/i.test(String(row.Completed || "")); }

/** No network reads or outcomes enter a prospective selection. */
export function totalForwardGame(slate: SheetRow, schedule: SheetRow, now = Date.now()): TotalForwardGame | null {
  const p = TOTAL_FORWARD_PARAMETERS;
  if (!Number.isFinite(now) || now < Date.parse(p.startedAt)) return null;
  const id = String(slate["Game ID"] || "");
  if (!/^\d{8,12}$/.test(id) || String(schedule["Game ID"] || "") !== id || completed(schedule)) return null;
  if (slate["Model Version"] !== p.modelVersion || forwardNumber(slate.Season) !== p.season) return null;
  const kickoff = timestamp(schedule["Game Time"]);
  if (kickoff == null || now >= kickoff) return null;
  const date = String(slate.Date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || easternDate(kickoff) !== date) return null;
  const scheduledDate = String(schedule["Game Date"] || schedule.Date || "").slice(0, 10);
  if (scheduledDate && scheduledDate !== date) return null;
  for (const side of ["Away", "Home"]) {
    if (!slate[`${side} Team`] || !schedule[`${side} Team`] || footballTeamKey(slate[`${side} Team`], "NCAAF") !== footballTeamKey(schedule[`${side} Team`], "NCAAF")) return null;
  }
  const pick = String(slate["Total Pick"] || "").match(/^(Over|Under)\s+([0-9]+(?:\.[0-9]+)?)$/i);
  const line = forwardNumber(slate["Market Total"]), projected = forwardNumber(slate["Projected Total"]), edge = forwardNumber(slate["Total Edge"]);
  if (!pick || line == null || line <= 0 || projected == null || projected <= 0 || edge == null || Math.abs(Number(pick[2]) - line) > 1e-7) return null;
  const side = pick[1].toLowerCase() === "over" ? "Over" as const : "Under" as const;
  if (Math.abs((projected - line) * (side === "Over" ? 1 : -1) - edge) > .031) return null;
  const grade = String(slate["Total Grade"] || "");
  if (!["A Total", "B Total", "No Play"].includes(grade)) return null;
  const prediction = (strategy: TotalStrategy, selectedSide: "Over" | "Under"): TotalForwardPrediction => ({ strategy, side: selectedSide, line,
    selection: `${selectedSide} ${line}`, odds: p.odds, stakeUnits: p.stakeUnits, priceBasis: p.priceBasis, official: false, eligibleForPosting: false });
  const predictions: TotalForwardPrediction[] = [];
  if (grade === "A Total" && edge >= p.aMinimumPoints) {
    predictions.push(prediction("a_total_fade", side === "Over" ? "Under" : "Over"), prediction("a_total_original_control", side));
  } else if (grade === "B Total" && edge >= p.bMinimumPoints && edge < p.bMaximumExclusivePoints) predictions.push(prediction("b_total_original", side));
  return { policy: p.policy, parameterHash: TOTAL_FORWARD_PARAMETER_HASH, gameId: id, date,
    game: `${slate["Away Team"]} @ ${slate["Home Team"]}`, awayTeam: slate["Away Team"], homeTeam: slate["Home Team"],
    kickoff: new Date(kickoff).toISOString(), capturedAt: new Date(now).toISOString(), modelVersion: p.modelVersion,
    grade, originalSide: side, line, projectedTotal: projected, edgePoints: edge,
    sourceBuildCapturedAt: String(slate["Build Captured At"] || ""), predictions };
}
export function settleTotalForward(game: TotalForwardGame, pick: TotalForwardPrediction, schedule: SheetRow, now = Date.now()) {
  if (!Number.isFinite(now) || /cancel|postpon|suspend|abandon|forfeit/i.test(String(schedule.Status || schedule["Game Status"] || ""))) return null;
  if (String(schedule["Game ID"] || "") !== game.gameId || !completed(schedule) || now < Date.parse(game.kickoff)) return null;
  if (String(schedule["Game Date"] || schedule.Date || "").slice(0, 10) !== game.date) return null;
  for (const side of ["Away", "Home"]) {
    const team = side === "Away" ? game.awayTeam : game.homeTeam;
    if (footballTeamKey(schedule[`${side} Team`], "NCAAF") !== footballTeamKey(team, "NCAAF")) return null;
  }
  const a = forwardNumber(schedule["Away Score"]), h = forwardNumber(schedule["Home Score"]);
  if (a == null || h == null || a < 0 || h < 0 || a + h <= 0) return null;
  const value = (a + h - pick.line) * (pick.side === "Over" ? 1 : -1);
  const result = Math.abs(value) < 1e-7 ? "P" : value > 0 ? "W" : "L";
  return { result, units: result === "W" ? 100 / 110 : result === "L" ? -1 : 0, actualAway: a, actualHome: h, settledAt: new Date(now).toISOString() };
}
