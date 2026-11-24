/** Official spread/total performance is simulated at -110, risking one unit.
 * Original quoted odds and settlement evidence are never rewritten. */
export const OFFICIAL_TRACKING_BASIS = "standard-simulated" as const;
export const isStandardOfficialMarket = (market: string) => /^(?:spread|total)$/i.test(market.trim());
export function standardOfficialTracking<T extends { market: string; result?: string | null; netUnits?: number; units?: number | null; trackingBasis?: string; recordedNetUnits?: number; recordedUnits?: number | null }>(pick: T) {
  if (!isStandardOfficialMarket(pick.market)) return pick;
  const result = String(pick.result || "").toUpperCase();
  const netUnits = result === "W" ? 100 / 110 : result === "L" ? -1 : ["P", "VOID"].includes(result) ? 0 : undefined;
  return { ...pick, trackingOdds: -110, trackingBasis: OFFICIAL_TRACKING_BASIS,
    ...(pick.trackingBasis !== OFFICIAL_TRACKING_BASIS && typeof pick.netUnits === "number" ? { recordedNetUnits: pick.netUnits } : {}),
    ...(pick.trackingBasis !== OFFICIAL_TRACKING_BASIS && "units" in pick ? { recordedUnits: pick.units } : {}),
    ...(netUnits !== undefined ? { netUnits, ...("units" in pick ? { units: netUnits } : {}) } : {}),
  };
}
