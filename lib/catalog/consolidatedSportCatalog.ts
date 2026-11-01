import { NFL_CONSOLIDATED_TYPES, type NflConsolidatedType } from "./nflConsolidatedCatalog";
export type ConsolidatedSport = "NCAAF" | "NBA" | "NCAAM";
export const CONSOLIDATED_SPORT_EFFECTIVE_AT = "2026-11-01T23:00:00.000Z";
export const CONSOLIDATED_MIN_DECISIONS = 8;
export const CONSOLIDATED_MIN_ROI = 10;
export const CONSOLIDATED_TOP_LIMIT = 20;
export const consolidatedVersion = (sport: ConsolidatedSport) => `${sport.toLowerCase()}-grouped-2026-11-01-v1`;
export const consolidatedSignalPolicy = (sport: ConsolidatedSport) => `${sport === "NCAAF" ? "football" : sport.toLowerCase()}-signals-${sport.toLowerCase()}-grouped-2026-11-01-v2`;
export const isConsolidatedSport = (sport: string): sport is ConsolidatedSport => ["NCAAF", "NBA", "NCAAM"].includes(sport);
const definitions = new Map<ConsolidatedSport, readonly NflConsolidatedType[]>(["NCAAF", "NBA", "NCAAM"].map(name => {
  const sport = name as ConsolidatedSport;
  return [sport, NFL_CONSOLIDATED_TYPES.map(type => ({ ...type,
    pairs: type.pairs.filter(pair => sport !== "NCAAF" || !pair.startsWith("nfl-"))
      .map(pair => pair.replace(/^nfl-/, `${sport.toLowerCase()}-`)),
    rule: type.rule.replace(/NFL/g, sport).replace(/The legacy hour-move membership.*$/, ""),
  }))] as const;
}));
export const consolidatedTypes = (sport: ConsolidatedSport) => definitions.get(sport)!;
export const consolidatedSignal = (sport: ConsolidatedSport, id: string) => `split-group:${consolidatedVersion(sport)}:${id}`;
export function consolidatedDefinition(signal: string) {
  for (const sport of definitions.keys()) {
    if (signal.startsWith(`split-group:${consolidatedVersion(sport)}:`)) {
      return definitions.get(sport)!.find(type => consolidatedSignal(sport, type.id) === signal);
    }
  }
}
export function consolidationMetadata(sport: ConsolidatedSport) {
  return { version: consolidatedVersion(sport), typeCount: consolidatedTypes(sport).length,
    signalPolicy: consolidatedSignalPolicy(sport), topLimit: CONSOLIDATED_TOP_LIMIT,
    minDecisions: CONSOLIDATED_MIN_DECISIONS, minRoiPct: CONSOLIDATED_MIN_ROI, winPctExclusiveMinimum: 60,
    oddsPolicy: sport === "NCAAF" ? "Saved observed prices; explicit assumptions identified" : "Assumed -110" };
}
