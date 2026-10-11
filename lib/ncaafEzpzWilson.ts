import { finiteNcaafNumber, NCAAF_EZPZ_POLICY_VERSION, NCAAF_WILSON_EFFECTIVE_AT } from "./ncaafEzpzPolicy";
import {
  buildNcaafTrendSubtypes, ncaafTrendCategory, ncaafTrendSignals,
  type NcaafPublicTrendSubtype,
} from "./ncaafPublicTrendLeaderboard";

export const NCAAF_EZPZ_SUBTYPE_LIMIT = 20;
export const NCAAF_WILSON_Z = 1.6448536269514722;

type SheetRow = Record<string, string>;
type AnyPick = Record<string, any>;
export type NcaafEzpzSubtype = NcaafPublicTrendSubtype & { wilsonScore: number };
export type FootballWilsonPolicy = {
  version: string;
  effectiveAt: string;
  buildSubtypes: typeof buildNcaafTrendSubtypes;
  signalsFor: typeof ncaafTrendSignals;
  gameIdentity: (play: AnyPick) => string;
};

function key(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function stamp(value: unknown) {
  const n = typeof value === "number" ? value : Date.parse(String(value || ""));
  return Number.isFinite(n) ? n : null;
}

function gameKey(play: AnyPick) {
  return `${play.date || play.Date || ""}|${key(play.game || play.Game || play.gameKey || play["Game Key"])}`;
}

// This is a conservative ordering score, not a forecast of the next game's result.
// Pushes supply no Bernoulli decision and are excluded from wins + losses.
export function ncaafWilsonLowerBound(wins: number, losses: number) {
  if (![wins, losses].every(n => Number.isInteger(n) && n >= 0) || wins + losses === 0) return 0;
  const n = wins + losses;
  const p = wins / n;
  const z2 = NCAAF_WILSON_Z ** 2;
  return Math.max(0, (p + z2 / (2 * n)
    - NCAAF_WILSON_Z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / (1 + z2 / n));
}

export function rankNcaafEzpzSubtypes(subtypes: NcaafPublicTrendSubtype[]): NcaafEzpzSubtype[] {
  return subtypes.filter(({ totals: t }) =>
    [t.wins, t.losses].every(n => Number.isInteger(n) && n >= 0)
    && t.wins * 5 > (t.wins + t.losses) * 3
    && Number.isFinite(t.netUnits ?? t.unitsWon) && (t.netUnits ?? t.unitsWon) > 0
  ).map(subtype => ({ ...subtype, wilsonScore: ncaafWilsonLowerBound(subtype.totals.wins, subtype.totals.losses) * 100 }))
    .sort((a, b) => b.wilsonScore - a.wilsonScore
      || (b.totals.wins + b.totals.losses) - (a.totals.wins + a.totals.losses)
      || a.id.localeCompare(b.id))
    .slice(0, NCAAF_EZPZ_SUBTYPE_LIMIT);
}

export function ncaafRowsBeforeDecision(rows: SheetRow[], asOf: number, excludeGame?: AnyPick, identity = gameKey) {
  if (!Number.isFinite(asOf)) return [];
  return rows.filter(row => {
    const settled = stamp(row["Result Updated"]);
    const kickoff = stamp(row["Game Time"]);
    return settled != null && settled <= asOf && (kickoff == null || kickoff < settled)
      && (!excludeGame || identity(row) !== identity(excludeGame));
  });
}

export function buildNcaafEzpzLeaderboard(rows: SheetRow[], asOf = Date.now(), excludeGame?: AnyPick, policy?: FootballWilsonPolicy) {
  return rankNcaafEzpzSubtypes((policy?.buildSubtypes || buildNcaafTrendSubtypes)(
    ncaafRowsBeforeDecision(rows, asOf, excludeGame, policy?.gameIdentity || gameKey),
  ));
}

function validFinalDecision(play: AnyPick) {
  const kickoff = stamp(play.gameTime);
  const locked = stamp(play.lockedAt || play.frozenAt || play.updatedAt);
  return play.snapshotStatus === "FINAL_PREGAME" && kickoff != null && locked != null
    && kickoff - locked >= 10 * 60_000 && kickoff - locked <= 20 * 60_000;
}

// Archived eligibility uses the record captured at lock. It is never reranked
// against a later ledger: losing results cannot erase an already-posted pick.
export function isFootballWilsonArchivedPick(pick: AnyPick, version: string, effectiveAt: string) {
  const wins = finiteNcaafNumber(pick.rankingWins);
  const losses = finiteNcaafNumber(pick.rankingLosses);
  const units = finiteNcaafNumber(pick.rankingNetUnits);
  const rank = finiteNcaafNumber(pick.trendRank);
  const score = finiteNcaafNumber(pick.wilsonScore);
  const asOf = stamp(pick.rankingAsOf);
  const locked = stamp(pick.lockedAt);
  const odds = finiteNcaafNumber(String(pick.odds ?? "").replace(/−/g, "-"));
  return pick.selectorVersion === version && validFinalDecision(pick)
    && pick.source === "Trend Play" && Boolean(pick.trendSubtypeId)
    && ["spread", "total"].includes(key(pick.market)) && !pick.playerName && !pick.propMarket
    && wins != null && losses != null && Number.isInteger(wins) && Number.isInteger(losses)
    && wins >= 0 && losses >= 0 && wins * 5 > (wins + losses) * 3
    && units != null && units > 0 && rank != null && Number.isInteger(rank) && rank >= 1 && rank <= NCAAF_EZPZ_SUBTYPE_LIMIT
    && score != null && Math.abs(score - ncaafWilsonLowerBound(wins, losses) * 100) < 1e-7
    && asOf != null && asOf === locked && locked >= Date.parse(effectiveAt)
    && odds != null && Math.abs(odds) >= 100 && odds >= -150;
}

export function isNcaafWilsonArchivedPick(pick: AnyPick) {
  return isFootballWilsonArchivedPick(pick, NCAAF_EZPZ_POLICY_VERSION, NCAAF_WILSON_EFFECTIVE_AT);
}

export function selectNcaafWilsonEzpzPicks(
  plays: AnyPick[], rows: SheetRow[], today: string, now = Date.now(), archived: AnyPick[] = [],
  policy?: FootballWilsonPolicy,
): AnyPick[] {
  const identity = policy?.gameIdentity || gameKey;
  const signalsFor = policy?.signalsFor || ncaafTrendSignals;
  const version = policy?.version || NCAAF_EZPZ_POLICY_VERSION;
  const effectiveAt = policy?.effectiveAt || NCAAF_WILSON_EFFECTIVE_AT;
  const selected = new Map<string, AnyPick>();
  for (const pick of archived) {
    // Broad legacy subtypes remain valid historical decisions, but cannot be
    // carried into the current catalog-only card.
    if (pick.date === today && String(pick.trendSubtypeId || "").startsWith("catalog:")
      && isFootballWilsonArchivedPick(pick, version, effectiveAt) && Number(stamp(pick.lockedAt)) <= now && !selected.has(identity(pick))) {
      selected.set(identity(pick), pick);
    }
  }
  const current = plays.filter(play => String(play.date || play.recordDate || "") === today);
  const groups = new Map<string, AnyPick[]>();
  for (const play of current) {
    const groupKey = `${identity(play)}|${key(play.market)}`;
    groups.set(groupKey, [...(groups.get(groupKey) || []), play]);
  }
  const rankingCache = new Map<number, NcaafEzpzSubtype[]>();
  const candidates: AnyPick[] = [];
  for (const play of current) {
    const category = ncaafTrendCategory(play);
    const kickoff = stamp(play.gameTime);
    if (!category || kickoff == null || !String(play.game || "").trim() || play.playerName || play.propMarket) continue;
    if (play.source && !["trend play", "best + trend"].includes(String(play.source).trim().toLowerCase())) continue;
    const final = play.snapshotStatus === "FINAL_PREGAME";
    if (final ? !validFinalDecision(play) : play.snapshotStatus !== "LIVE" || kickoff <= now) continue;
    const asOf = final ? stamp(play.frozenAt || play.updatedAt) : now;
    if (asOf == null || asOf > now || asOf < Date.parse(effectiveAt)) continue;
    const rawOdds = String(play.odds ?? "").trim().replace(/−/g, "-");
    const odds = rawOdds ? finiteNcaafNumber(rawOdds) : -110;
    if (odds == null || Math.abs(odds) < 100 || odds < -150) continue;
    const ranking = rankingCache.get(asOf) || buildNcaafEzpzLeaderboard(rows, asOf, undefined, policy);
    rankingCache.set(asOf, ranking);
    // Valid settled timestamps already exclude this unstarted game. Also guard
    // its identity explicitly if a corrupt result timestamp precedes kickoff.
    const safeRanking = rows.some(row => identity(row) === identity(play) && stamp(row["Result Updated"]) != null
      && Number(stamp(row["Result Updated"])) <= asOf)
      ? buildNcaafEzpzLeaderboard(rows, asOf, play, policy) : ranking;
    const siblings = groups.get(`${identity(play)}|${key(play.market)}`) || [play];
    const signals = new Set(signalsFor(play, siblings));
    const index = safeRanking.findIndex(subtype => subtype.category === category && signals.has(subtype.signal));
    if (index < 0) continue;
    const subtype = safeRanking[index];
    const line = finiteNcaafNumber(play.line);
    if (line == null) continue;
    if (key(play.market) === "total" && line <= 0) continue;
    if (key(play.market) === "spread" && (!/[a-z]/i.test(String(play.selectionTeam || play.selection || ""))
      || /^(over|under)(?:\s|$)/i.test(String(play.selectionTeam || play.selection || "")))) continue;
    const selection = key(play.market) === "total"
      ? `${category} ${line}` : `${play.selectionTeam || play.selection} ${line > 0 ? "+" : ""}${line}`;
    if (!String(play.selectionTeam || play.selection || "").trim()) continue;
    const publicSide = siblings.find(sibling => key(sibling.selectionTeam || sibling.side || sibling.selection)
      !== key(play.selectionTeam || play.side || play.selection));
    candidates.push({
      ...play, source: "Trend Play", date: today, selection,
      odds: odds > 0 ? `+${odds}` : String(odds), oddsSource: rawOdds ? "SNAPSHOT" : "DEFAULT_110",
      score: subtype.wilsonScore, tier: subtype.label,
      qualification: `${subtype.label} • ${subtype.totals.record} (${subtype.totals.winPct.toFixed(1)}%) • ${subtype.totals.roiPct.toFixed(1)}% ROI • Wilson ${subtype.wilsonScore.toFixed(1)} • subtype rank #${index + 1}`,
      selectorVersion: version, trendSubtypeId: subtype.id, trendRank: index + 1,
      wilsonScore: subtype.wilsonScore, rankingAsOf: new Date(asOf).toISOString(),
      rankingRecord: subtype.totals.record, rankingWins: subtype.totals.wins, rankingLosses: subtype.totals.losses,
      rankingPushes: subtype.totals.pushes, rankingWinPct: subtype.totals.winPct,
      rankingRoiPct: subtype.totals.roiPct, rankingNetUnits: subtype.totals.netUnits ?? subtype.totals.unitsWon,
      rankingLastSeven: subtype.lastSevenTotals,
      lockedAt: final ? new Date(asOf).toISOString() : "",
      publicSideBetsPct: publicSide?.betsPct, publicSideMoneyPct: publicSide?.moneyPct,
      publicMovePct: publicSide?.publicMovementPct, lineMoveValue: publicSide?.lineMovementValue,
    });
  }
  candidates.sort((a, b) => b.wilsonScore - a.wilsonScore
    || b.rankingWins + b.rankingLosses - a.rankingWins - a.rankingLosses
    || a.trendSubtypeId.localeCompare(b.trendSubtypeId) || a.selection.localeCompare(b.selection));
  for (const pick of candidates) if (!selected.has(identity(pick))) selected.set(identity(pick), pick);
  return [...selected.values()].sort((a, b) => String(a.gameTime || "").localeCompare(String(b.gameTime || ""))
    || String(a.game || "").localeCompare(String(b.game || "")));
}
