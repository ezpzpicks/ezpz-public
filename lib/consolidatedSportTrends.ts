import { catalogSide, catalogEvaluationFor, footballCatalog } from "./footballTrendCatalog";
import { footballTeamKey } from "./footballTeamTrends";
import { ncaafTrendCategory, type NcaafPublicTrendSubtype } from "./ncaafPublicTrendLeaderboard";
import { NBA_MARKET_POLICY } from "./nbaMarketCore";
import { NCAAM_MARKET_POLICY } from "./ncaamMarketCore";
import { consolidatedTypes, consolidatedSignal, consolidatedVersion, CONSOLIDATED_MIN_DECISIONS,
  CONSOLIDATED_MIN_ROI, CONSOLIDATED_TOP_LIMIT, type ConsolidatedSport } from "./catalog/consolidatedSportCatalog";
type Row = Record<string, any>;
const frozenSides = new WeakMap<Row, Row>();
function savedSide(input: Row): Row {
  if (input.Market && input["Snapshot Status"] === "FINAL_PREGAME") {
    const previous = frozenSides.get(input);
    if (previous) return previous;
    const side = catalogSide(input); frozenSides.set(input, side); return side;
  }
  return catalogSide(input);
}
export type ConsolidatedSubtype = NcaafPublicTrendSubtype & { sampleKey: string; groupedVersion: string; assumedPriceBets: number; wilsonScore?: number };
export function consolidatedEventKey(input: Row, sport: ConsolidatedSport) {
  const side = savedSide(input);
  const names = side.awayTeam && side.homeTeam ? [side.awayTeam, side.homeTeam]
    : String(side.game || "").split(/\s*(?:@|\bat\b|\bvs\.?\b)\s*/i);
  const teams = names.length === 2 ? names.map(team => footballTeamKey(String(team || ""), sport)) : [];
  if (teams.length === 2 && teams.every(Boolean)) return `${side.date}|${teams.sort().join("|")}`;
  return `${side.date}|${String(side.game || side.gameKey).toLowerCase().replace(/[^a-z0-9]/g, "")}`;
}
export function consolidatedSideKey(input: Row, sport: ConsolidatedSport) {
  const side = savedSide(input), selection = side.market === "Total" ? String(side.side || side.selection).split(" ")[0].toLowerCase()
    : footballTeamKey(String(side.selectionTeam || side.side || side.selection || "").replace(/\s+[+-]?\d+(?:\.\d+)?$/, ""), sport);
  return `${consolidatedEventKey(input, sport)}|${side.market}|${selection}`;
}
export function consolidatedCategoryMatches(category: string, input: Row) {
  const side = savedSide(input);
  return category === "Spread" ? side.market === "Spread" : category === ncaafTrendCategory(side);
}
const membershipCache = new WeakMap<Row, Map<ConsolidatedSport, string[]>>();
export function consolidatedTrendSignals(sport: ConsolidatedSport, input: Row, siblings: Row[]): string[] {
  const saved = membershipCache.get(input)?.get(sport);
  if (saved) return saved;
  const side = savedSide(input), evaluation = side.catalogEvaluation?.version === footballCatalog(sport).version
    ? side.catalogEvaluation : catalogEvaluationFor(input, siblings, sport);
  if (!evaluation || evaluation.invalid || evaluation.version !== footballCatalog(sport).version) return [];
  const memberships = new Set(evaluation.memberships.map((m: { pair: string; direction: number }) => `${m.pair}|${m.direction}`));
  const signals = consolidatedTypes(sport).filter(type => type.market === side.market && consolidatedCategoryMatches(type.category, input)
    && type.pairs.some(pair => memberships.has(`${pair}|${type.direction}`))).map(type => consolidatedSignal(sport, type.id));
  // Frozen membership JSON is immutable; live groups are always evaluated afresh.
  if (side.snapshotStatus === "FINAL_PREGAME" && side.catalogEvaluation?.version === evaluation.version) {
    const cache = membershipCache.get(input) || new Map(); cache.set(sport, signals); membershipCache.set(input, cache);
  }
  return signals;
}
function eligible(row: Row, sport: ConsolidatedSport) {
  if (row.Sport && row.Sport !== sport) return false;
  const odds = Number(row["Public Split Odds"] || row.Odds);
  if (row["Record Snapshot Policy"] !== "verified-final-snapshot-v1" || row["Snapshot Status"] !== "FINAL_PREGAME"
    || !row["Public Split Snapshot Time"] || !/^[WLP]$/.test(row.Result) || !Number.isFinite(odds) || Math.abs(odds) < 100) return false;
  if (sport !== "NCAAF") {
    if (row.Sport !== sport || row[`${sport} Record Policy`] !== `${sport.toLowerCase()}-verified-final-v1`
      || row["Market Policy"] !== (sport === "NBA" ? NBA_MARKET_POLICY : NCAAM_MARKET_POLICY) || odds !== -110) return false;
  }
  const side = savedSide(row);
  return side.catalogEvaluation?.version === footballCatalog(sport).version && !side.catalogEvaluation.invalid;
}
function totals(rows: Row[]) {
  let wins = 0, losses = 0, pushes = 0, netUnits = 0;
  for (const row of rows) {
    const odds = Number(row["Public Split Odds"] || row.Odds);
    if (row.Result === "W") { wins++; netUnits += odds > 0 ? odds / 100 : 100 / Math.abs(odds); }
    else if (row.Result === "L") { losses++; netUnits--; } else pushes++;
  }
  const totalBets = wins + losses + pushes;
  return { wins, losses, pushes, totalBets, netUnits, record: `${wins}-${losses}-${pushes}`,
    unitsWon: Math.round(100 * netUnits) / 100, winPct: wins + losses ? Math.round(1000 * wins / (wins + losses)) / 10 : 0,
    roiPct: totalBets ? Math.round(1000 * netUnits / totalBets) / 10 : 0 };
}
export function buildConsolidatedSubtypes(sport: ConsolidatedSport, rows: Row[]): ConsolidatedSubtype[] {
  const events = new Map<string, Map<string, Row>>();
  for (const row of rows) {
    if (!eligible(row, sport)) continue;
    const event = consolidatedEventKey(row, sport), key = consolidatedSideKey(row, sport), group = events.get(event) || new Map();
    if (!group.has(key)) group.set(key, row); events.set(event, group);
  }
  const buckets = new Map<string, Map<string, Row>>();
  for (const group of events.values()) {
    const siblings = [...group.values()];
    for (const row of siblings) for (const signal of consolidatedTrendSignals(sport, row, siblings)) {
      const bucket = buckets.get(signal) || new Map(); bucket.set(consolidatedSideKey(row, sport), row); buckets.set(signal, bucket);
    }
  }
  return consolidatedTypes(sport).flatMap(type => {
    const signal = consolidatedSignal(sport, type.id), bucket = buckets.get(signal);
    if (!bucket?.size) return [];
    const records = [...bucket.values()].sort((a, b) => Date.parse(b["Game Time"] || b["Public Split Snapshot Time"]) - Date.parse(a["Game Time"] || a["Public Split Snapshot Time"]));
    return [{ id: `${signal}|${type.category.toLowerCase()}`, signal, label: `${type.market}: ${type.label}`, category: type.category,
      totals: totals(records), lastSevenTotals: totals(records.slice(0, 7)), sampleKey: [...bucket.keys()].sort().join(";"),
      groupedVersion: consolidatedVersion(sport), assumedPriceBets: records.filter(row => row["Observed Price Missing"] === "TRUE" || row["Odds Source"] === "DEFAULT_110").length }];
  });
}
function wilson(w: number, l: number) {
  const n = w + l, z = 1.6448536269514722, p = n ? w / n : 0, z2 = z * z;
  return n ? 100 * (p + z2 / (2 * n) - z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / (1 + z2 / n) : 0;
}
export function rankConsolidatedSubtypes(types: ConsolidatedSubtype[]) {
  const seen = new Set<string>();
  return types.filter(({ totals: t }) => t.wins + t.losses >= CONSOLIDATED_MIN_DECISIONS
    && t.wins * 5 > (t.wins + t.losses) * 3 && 100 * t.netUnits! / t.totalBets >= CONSOLIDATED_MIN_ROI)
    .map(type => ({ ...type, wilsonScore: wilson(type.totals.wins, type.totals.losses) }))
    .sort((a, b) => b.wilsonScore - a.wilsonScore || b.totals.roiPct - a.totals.roiPct || a.id.localeCompare(b.id))
    .filter(type => { if (seen.has(type.sampleKey)) return false; seen.add(type.sampleKey); return true; }).slice(0, CONSOLIDATED_TOP_LIMIT);
}
export function buildConsolidatedLeaderboard(sport: ConsolidatedSport, rows: Row[], asOf = Date.now(), excludeGame?: Row) {
  return rankConsolidatedSubtypes(buildConsolidatedSubtypes(sport, rows.filter(row => {
    const settled = Date.parse(row["Result Updated"] || ""), kickoff = Date.parse(row["Game Time"] || "");
    return Number.isFinite(settled) && settled <= asOf && (!Number.isFinite(kickoff) || settled > kickoff)
      && (!excludeGame || consolidatedEventKey(row, sport) !== consolidatedEventKey(excludeGame, sport));
  })));
}
export function visibleConsolidatedBadges(sport: ConsolidatedSport, play: Row, siblings: Row[], leaderboard: readonly NcaafPublicTrendSubtype[]) {
  const signals = new Set(consolidatedTrendSignals(sport, play, siblings));
  return leaderboard.slice(0, CONSOLIDATED_TOP_LIMIT).filter(type => consolidatedCategoryMatches(type.category, play) && signals.has(type.signal));
}
