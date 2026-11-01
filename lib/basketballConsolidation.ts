import type { FootballSignalSide } from "./footballSignals";
import { replayConsolidatedSignals } from "./consolidatedSportResearch";
import { buildConsolidatedLeaderboard } from "./consolidatedSportTrends";
import { consolidatedVersion, consolidatedSignalPolicy, consolidationMetadata } from "./catalog/consolidatedSportCatalog";
import { buildSignalResearchDays, SIGNAL_RESEARCH_VERSION, type SignalResearchDay, type SignalResearchReport } from "./signalCombinationResearch";
export type BasketballConsolidationState = {
  consolidation?: ReturnType<typeof consolidationMetadata>;
  consolidationReplay?: { version: string; days: Record<string, SignalResearchDay>; status: NonNullable<SignalResearchReport["reclassification"]> };
  legacySignalResearch?: { version: string; days: Record<string, SignalResearchDay> };
};
/** Producer-only migration/update; stores small daily aggregates, never rewrites original captures. */
export function updateBasketballConsolidation<T extends BasketballConsolidationState & { signalResearch?: { version: string; days: Record<string, SignalResearchDay> } }>(
  sport: "NBA" | "NCAAM", state: T, rows: Record<string, any>[], sides: FootballSignalSide[], plays: Record<string, any>[], now: number, legacyPolicy: string,
) {
  const replay = replayConsolidatedSignals(sport, sides, rows, plays, now);
  const replayDays = buildSignalResearchDays(replay.observations.filter(side => side.researchOrigin === "replay"), consolidatedSignalPolicy(sport), now);
  const seeded = state.consolidation?.version === consolidatedVersion(sport);
  const oldReplay = seeded ? state.consolidationReplay?.days || {} : {};
  const oldLegacy = seeded ? state.legacySignalResearch?.days || {} : {};
  const capturedDays = seeded ? state.signalResearch?.days || {} : {};
  return { ...state, consolidation: consolidationMetadata(sport), leaderboard: buildConsolidatedLeaderboard(sport, rows, now),
    leaderboardAsOf: new Date(now).toISOString(),
    consolidationReplay: { version: consolidatedVersion(sport), days: { ...oldReplay, ...replayDays },
      status: seeded && state.consolidationReplay
        ? state.consolidationReplay.status : replay.status },
    legacySignalResearch: { version: SIGNAL_RESEARCH_VERSION, days: { ...oldLegacy, ...buildSignalResearchDays(sides, legacyPolicy, now) } },
    signalResearch: { version: SIGNAL_RESEARCH_VERSION, days: { ...capturedDays, ...buildSignalResearchDays(sides, consolidatedSignalPolicy(sport), now) } } };
}
