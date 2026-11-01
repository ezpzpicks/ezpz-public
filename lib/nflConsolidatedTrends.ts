import { catalogEvaluationFor, catalogSide, catalogSelectionIdentity } from "./footballTrendCatalog";
import { nflTrendGameIdentity } from "./nflTrendIdentity";
import { isVerifiedNcaafTrendRecord } from "./ncaafTrendRecordPolicy";
import { ncaafTrendCategory, type NcaafPublicTrendSubtype } from "./ncaafPublicTrendLeaderboard";
import { ncaafWilsonLowerBound } from "./ncaafEzpzWilson";
import { NFL_CONSOLIDATED_TYPES, NFL_CONSOLIDATED_VERSION, nflConsolidatedSignal, type NflGroupCategory } from "./catalog/nflConsolidatedCatalog";
type Side = Record<string, any>;
type Row = Record<string, string>;
export const NFL_GROUPED_MIN_DECISIONS = 8;
export const NFL_GROUPED_MIN_ROI = 10;
export function nflGroupCategoryMatches(category: string, side: Side) {
  return category === "Spread" ? String(side.market).toLowerCase() === "spread" : category === ncaafTrendCategory(side);
}
export function nflConsolidatedSignals(play: Side, siblings: Side[]): string[] {
  const side = catalogSide(play), evaluation = catalogEvaluationFor(play, siblings, "NFL");
  if (!evaluation || evaluation.invalid) return [];
  const matches = new Set(evaluation.memberships.map(m => `${m.pair}|${m.direction}`));
  return NFL_CONSOLIDATED_TYPES.filter(type => type.market === side.market && nflGroupCategoryMatches(type.category, side)
    && type.pairs.some(pair => matches.has(`${pair}|${type.direction}`))).map(type => nflConsolidatedSignal(type.id));
}
function totals(rows: Row[]) {
  let wins = 0, losses = 0, pushes = 0, netUnits = 0;
  for (const row of rows) {
    const odds = Number(row["Public Split Odds"] || row.Odds);
    if (row.Result === "W") { wins++; netUnits += odds > 0 ? odds / 100 : 100 / Math.abs(odds); }
    else if (row.Result === "L") { losses++; netUnits--; } else pushes++;
  }
  const totalBets = wins + losses + pushes;
  return { record: `${wins}-${losses}-${pushes}`, wins, losses, pushes, totalBets, netUnits,
    winPct: wins + losses ? Math.round(1000 * wins / (wins + losses)) / 10 : 0,
    unitsWon: Math.round(netUnits * 100) / 100, roiPct: totalBets ? Math.round(1000 * netUnits / totalBets) / 10 : 0 };
}
export type NflConsolidatedSubtype = NcaafPublicTrendSubtype & { sampleKey: string; groupedVersion: string };
export function buildNflConsolidatedSubtypes(rows: Row[]): NflConsolidatedSubtype[] {
  const events = new Map<string, Map<string, Row>>();
  for (const row of rows) {
    const date = String(row.Date || ""), odds = Number(row["Public Split Odds"] || row.Odds);
    // August preseason, missing prices and unverified live copies are excluded.
    if (!isVerifiedNcaafTrendRecord(row) || !/^[WLP]$/.test(row.Result) || !Number.isFinite(odds) || Math.abs(odds) < 100
      || row["Observed Price Missing"] === "TRUE" || row["Odds Source"] === "DEFAULT_110"
      || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date.slice(5, 7) === "08") continue;
    const side = catalogSide(row), category = ncaafTrendCategory(side);
    if (!category) continue;
    const event = nflTrendGameIdentity(row), group = events.get(event) || new Map<string, Row>();
    const selection = `${side.market}|${catalogSelectionIdentity(row, "NFL")}`;
    if (!group.has(selection)) group.set(selection, row);
    events.set(event, group);
  }
  const buckets = new Map<string, Map<string, Row>>();
  for (const [event, group] of events) {
    const siblings = [...group.values()];
    for (const row of siblings) for (const signal of nflConsolidatedSignals(row, siblings)) {
      const bucket = buckets.get(signal) || new Map<string, Row>();
      const side = catalogSide(row), key = `${event}|${side.market}|${catalogSelectionIdentity(row, "NFL")}`;
      if (!bucket.has(key)) bucket.set(key, row);
      buckets.set(signal, bucket);
    }
  }
  return NFL_CONSOLIDATED_TYPES.flatMap(type => {
    const signal = nflConsolidatedSignal(type.id), bucket = buckets.get(signal);
    if (!bucket?.size) return [];
    const records = [...bucket.values()], recent = [...records].sort((a, b) =>
      Date.parse(b["Game Time"] || b["Public Split Snapshot Time"]) - Date.parse(a["Game Time"] || a["Public Split Snapshot Time"]));
    return [{ id: `${signal}|${type.category.toLowerCase()}`, signal, category: type.category as NflGroupCategory,
      label: `${type.market}: ${type.label}`, totals: totals(records), lastSevenTotals: totals(recent.slice(0, 7)),
      sampleKey: [...bucket.keys()].sort().join(";"), groupedVersion: NFL_CONSOLIDATED_VERSION }];
  });
}
export function rankNflConsolidatedSubtypes(subtypes: NflConsolidatedSubtype[]) {
  const seen = new Set<string>();
  return subtypes.filter(({ totals: t }) => t.wins + t.losses >= NFL_GROUPED_MIN_DECISIONS
    && t.wins * 5 > (t.wins + t.losses) * 3 && (t.netUnits || 0) > 0
    && 100 * (t.netUnits || 0) / t.totalBets >= NFL_GROUPED_MIN_ROI)
    .map(type => ({ ...type, wilsonScore: 100 * ncaafWilsonLowerBound(type.totals.wins, type.totals.losses) }))
    .sort((a, b) => b.wilsonScore - a.wilsonScore || b.totals.roiPct - a.totals.roiPct || a.id.localeCompare(b.id))
    .filter(type => { if (seen.has(type.sampleKey)) return false; seen.add(type.sampleKey); return true; }).slice(0, 20);
}
export function buildNflConsolidatedLeaderboard(rows: Row[], asOf = Date.now(), excludeGame?: Side) {
  return rankNflConsolidatedSubtypes(buildNflConsolidatedSubtypes(rows.filter(row => {
    const settled = Date.parse(row["Result Updated"] || ""), kickoff = Date.parse(row["Game Time"] || "");
    return Number.isFinite(settled) && settled <= asOf && (!Number.isFinite(kickoff) || settled > kickoff)
      && (!excludeGame || nflTrendGameIdentity(row) !== nflTrendGameIdentity(excludeGame));
  })));
}
