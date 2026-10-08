type PublicSplitPick = {
  source?: unknown;
  market?: unknown;
  tier?: unknown;
  qualification?: unknown;
  playerName?: unknown;
  propMarket?: unknown;
};

// Accept combined signals and legacy Best + Trend rows only when they carry
// an actual public-split qualification. A model grade alone never qualifies.
export function isPublicSplitEzpzPick(pick: PublicSplitPick): boolean {
  const source = String(pick.source || "").trim().toLowerCase();
  const market = String(pick.market || "").trim().toLowerCase();
  return (source === "trend play" || source === "best + trend")
    && (market === "spread" || market === "total")
    && !pick.playerName
    && !pick.propMarket
    && /\b(?:RLM|Public\s+Fade|Sharp|Market\s+Move|Money\s+Momentum|Total\s+Drop\s+Fade|Spread\s+Ticket\s+Momentum)\b/i.test(`${pick.tier || ""} ${pick.qualification || ""}`);
}

