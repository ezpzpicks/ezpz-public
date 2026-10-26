export type SignalMovement = {
  version: string; lineChange: number | null; usesHistory: boolean;
  state: "positive" | "negative" | "neutral" | "unavailable";
  active: boolean; available: boolean; value: number | null; basis: string; reason: string;
};
type MovementInput = {
  market: "Spread" | "Total"; side: string;
  openingLine: unknown; line: unknown;
  retainedBasis?: string; retainedValue?: number | null; retainedLabel?: string;
};
const number = (value: unknown) => {
  if (value == null || String(value).trim() === "") return null;
  const n = Number(String(value).replace(/[−–—]/g, "-"));
  return Number.isFinite(n) ? n : null;
};
const direction = (value: number | null, threshold: number) => value == null || Math.abs(value) + 1e-9 < threshold ? 0 : Math.sign(value);

/** Spread and total movement is measured only in line points, never in odds.
 * A move of at least half a point toward the selected side adds one signal.
 * Saved observations retain this evidence and their original vote on replay.
 */
export function evaluateSignalMovement(input: MovementInput): SignalMovement {
  const opening = number(input.openingLine), current = number(input.line);
  const sideFactor = input.market === "Spread" || /^under/i.test(input.side) ? -1 : 1;
  let lineChange = opening == null || current == null ? null : (current - opening) * sideFactor;
  const expectedBasis = input.market === "Spread" ? "Spread Line" : "Total Line";
  const usesHistory = lineChange != null && Math.abs(lineChange) < 1e-9
    && input.retainedBasis === `${expectedBasis} History`
    && input.retainedValue != null && Math.abs(input.retainedValue) >= .5 && Boolean(input.retainedLabel);
  if (usesHistory) lineChange = input.retainedValue!;
  const net = direction(lineChange, .5), available = lineChange != null;
  const state = !available ? "unavailable" : net > 0 ? "positive" : net < 0 ? "negative" : "neutral";
  const basis = `${expectedBasis}${usesHistory ? " History" : ""}`;
  return { version: "signal-line-points-2026-10-26-v1", lineChange, usesHistory, state,
    active: state === "positive", available, value: lineChange, basis,
    reason: state === "positive" ? "The line moved at least 0.5 points toward this side."
      : state === "negative" ? "Movement is against this side."
      : available ? "The line has not moved at least 0.5 points toward this side."
      : "Opening or current line is unavailable." };
}
