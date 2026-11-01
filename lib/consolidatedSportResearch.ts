import type { FootballSignalSide } from "./footballSignals";
import { catalogSide } from "./footballTrendCatalog";
import { consolidatedSideKey, consolidatedCategoryMatches, consolidatedTrendSignals, buildConsolidatedLeaderboard } from "./consolidatedSportTrends";
import { consolidatedVersion, consolidatedSignalPolicy, consolidatedDefinition, type ConsolidatedSport } from "./catalog/consolidatedSportCatalog";
type Any = Record<string, any>;
const stamp = (value: unknown) => Date.parse(String(value || "").replace(/ EDT$/, " -0400").replace(/ EST$/, " -0500"));
/** Reclassifies only the Public Trend vote. Original observations are never written back. */
export function replayConsolidatedSignals(sport: ConsolidatedSport, sides: FootballSignalSide[], rows: Any[], plays: Any[] = [], now = Date.now()) {
  const markets = new Map<string, Any[]>();
  for (const input of [...rows, ...plays]) {
    const side = catalogSide(input);
    if (side.snapshotStatus !== "FINAL_PREGAME") continue;
    const key = consolidatedSideKey(side, sport); markets.set(key, [...(markets.get(key) || []), side]);
  }
  const rankings = new Map<number, ReturnType<typeof buildConsolidatedLeaderboard>>();
  const observations: FootballSignalSide[] = [];
  let changedPublicFlags = 0, excludedObservations = 0;
  for (const side of sides) {
    if (side.policyVersion === consolidatedSignalPolicy(sport)) { observations.push(side); continue; }
    const at = stamp(side.snapshotAt), kickoff = stamp(side.gameTime), price = Number(side.odds);
    if (!side.recorded || !Number.isFinite(at) || at > now || !Number.isFinite(kickoff)
      || kickoff - at < 600000 || kickoff - at > 1200000 || !Number.isFinite(price) || Math.abs(price) < 100 || price < -150) {
      excludedObservations++; continue;
    }
    const original = (markets.get(consolidatedSideKey(side, sport)) || []).find(play => Math.abs(Number(play.line) - Number(side.line)) < 1e-8
      && Number(play.odds) === price && Math.abs(stamp(play.frozenAt || play.updatedAt) - at) <= 60000);
    if (!original?.catalogEvaluation || original.catalogEvaluation.invalid) { excludedObservations++; continue; }
    if (!rankings.has(at)) rankings.set(at, buildConsolidatedLeaderboard(sport, rows, at, original));
    const signals = new Set(consolidatedTrendSignals(sport, original, [original]));
    const matches = rankings.get(at)!.map((type, i) => ({ ...type, rank: i + 1 }))
      .filter(type => signals.has(type.signal) && consolidatedCategoryMatches(type.category, original))
      .map(type => ({ ...type, rules: [consolidatedDefinition(type.signal)?.rule || "Frozen grouped membership"], selectionDescription: type.category }));
    const active = matches.length > 0;
    if (Boolean(side.signals.find(signal => signal.key === "system")?.active) !== active) changedPublicFlags++;
    const votes = side.signals.map(signal => signal.key === "system" ? { ...signal, available: true, active,
      value: matches[0]?.wilsonScore ?? null, level: active ? "Grouped top-20 match" : "Inactive",
      reason: "Reclassified from the original pregame quote using only outcomes settled before that snapshot." } : { ...signal });
    const keys = votes.filter(signal => signal.active);
    const settledAt = stamp(original.resultUpdated), settlement = /^[WLP]$/.test(original.result || "")
      && settledAt > kickoff && settledAt <= now ? { result: original.result, resultUpdated: original.resultUpdated } : {};
    observations.push({ ...side, policyVersion: consolidatedSignalPolicy(sport), researchOrigin: "replay", signals: votes,
      ...settlement,
      signalCount: keys.length, combination: keys.map(signal => signal.key).join(" + "), publicMatches: matches,
      sourceCount: [keys.some(s => ["money", "move", "system"].includes(s.key)), keys.some(s => s.key === "team"), keys.some(s => s.key === "model")].filter(Boolean).length,
      candidate: false, selected: false, mixed: false, comboScore: undefined });
  }
  return { observations, status: { version: consolidatedVersion(sport), replayedObservations: observations.filter(side => side.researchOrigin === "replay").length,
    changedPublicFlags, excludedObservations, usesPriorResultsOnly: true as const } };
}
