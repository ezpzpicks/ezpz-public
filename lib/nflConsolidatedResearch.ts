import type { FootballSignalSide } from "./footballSignals";
import { catalogSide } from "./footballTrendCatalog";
import { nflTrendGameIdentity, nflTrendTeamKey } from "./nflTrendIdentity";
import { buildNflConsolidatedLeaderboard, nflConsolidatedSignals, nflGroupCategoryMatches } from "./nflConsolidatedTrends";
import { NFL_CONSOLIDATED_SIGNAL_POLICY, NFL_CONSOLIDATED_VERSION, nflConsolidatedDefinition } from "./catalog/nflConsolidatedCatalog";

type Any = Record<string, any>;
const stamp = (value: unknown) => Date.parse(String(value || "").replace(/ EDT$/, " -0400").replace(/ EST$/, " -0500"));
const sideKey = (side: Any) => `${nflTrendGameIdentity(side)}|${side.market}|${nflTrendTeamKey(side.side || side.selectionTeam || side.selection)}`;
/** Read-only reclassification: original captures and all other votes remain untouched. */
export function replayNflConsolidatedSignals(sides: FootballSignalSide[], rows: Record<string, string>[], plays: Any[] = [], now = Date.now()) {
  const markets = new Map<string, Any[]>();
  for (const input of [...rows, ...plays]) {
    const side = catalogSide(input);
    if (side.snapshotStatus !== "FINAL_PREGAME") continue;
    const key = sideKey(side); markets.set(key, [...(markets.get(key) || []), side]);
  }
  const rankings = new Map<number, ReturnType<typeof buildNflConsolidatedLeaderboard>>();
  let changedPublicFlags = 0, excludedObservations = 0;
  const observations: FootballSignalSide[] = [];
  for (const side of sides) {
    if (side.policyVersion === NFL_CONSOLIDATED_SIGNAL_POLICY) { observations.push(side); continue; }
    const at = stamp(side.snapshotAt), kickoff = stamp(side.gameTime), price = Number(side.odds);
    if (!side.recorded || !Number.isFinite(at) || at > now || !Number.isFinite(kickoff)
      || kickoff - at < 600_000 || kickoff - at > 1_200_000 || !Number.isFinite(price) || Math.abs(price) < 100 || price < -150) {
      excludedObservations++; continue;
    }
    const original = (markets.get(sideKey(side)) || []).find(play => Math.abs(Number(play.line) - Number(side.line)) < 1e-8
      && Number(play.odds) === price && Math.abs(stamp(play.frozenAt || play.updatedAt) - at) <= 60_000);
    // A later market quote cannot stand in for missing original evidence.
    if (!original?.catalogEvaluation || original.catalogEvaluation.invalid) { excludedObservations++; continue; }
    if (!rankings.has(at)) rankings.set(at, buildNflConsolidatedLeaderboard(rows, at, original));
    const signals = new Set(nflConsolidatedSignals(original, [original]));
    const matches = rankings.get(at)!.map((type, i) => ({ ...type, rank: i + 1 }))
      .filter(type => signals.has(type.signal) && nflGroupCategoryMatches(type.category, original))
      .map(type => ({ ...type, rules: [nflConsolidatedDefinition(type.signal)?.rule || "Frozen grouped membership"], selectionDescription: type.category }));
    const active = matches.length > 0;
    if (Boolean(side.signals.find(signal => signal.key === "system")?.active) !== active) changedPublicFlags++;
    const votes = side.signals.map(signal => signal.key === "system" ? { ...signal, available: true, active,
      value: matches[0]?.wilsonScore ?? null, level: active ? "Grouped top-20 match" : "Inactive",
      reason: "Reclassified from the original pregame quote using only results settled before that snapshot." } : { ...signal });
    const keys = votes.filter(signal => signal.active);
    observations.push({ ...side, policyVersion: NFL_CONSOLIDATED_SIGNAL_POLICY, researchOrigin: "replay",
      signals: votes, publicMatches: matches, signalCount: keys.length,
      sourceCount: [keys.some(s => ["money", "move", "system"].includes(s.key)), keys.some(s => s.key === "team"), keys.some(s => s.key === "model")].filter(Boolean).length,
      combination: keys.map(signal => signal.key).join(" + "), candidate: false, selected: false, mixed: false, comboScore: undefined });
  }
  return { observations, status: { version: NFL_CONSOLIDATED_VERSION,
    replayedObservations: observations.filter(side => side.researchOrigin === "replay").length,
    changedPublicFlags, excludedObservations, usesPriorResultsOnly: true as const } };
}
