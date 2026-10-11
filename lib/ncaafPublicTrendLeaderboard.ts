import { classifyNcaafMovement, finiteNcaafNumber, isNcaafSharpPlay } from "./ncaafEzpzPolicy";
import { isVerifiedNcaafTrendRecord } from "./ncaafTrendRecordPolicy";

export const NCAAF_PUBLIC_TREND_LIMIT = 20;

type SheetRow = Record<string, string>;
type TrendSide = Record<string, unknown>;
export type NcaafTrendCategory = "Favorite Spread" | "Underdog Spread" | "Pick'em Spread" | "Over" | "Under";
export type NcaafTrendTotals = {
  record: string;
  totalBets: number;
  wins: number;
  losses: number;
  pushes: number;
  winPct: number;
  unitsWon: number;
  roiPct: number;
};
export type NcaafPublicTrendSubtype = {
  id: string;
  signal: string;
  category: NcaafTrendCategory;
  label: string;
  totals: NcaafTrendTotals;
};

function textKey(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function ncaafTrendSubtypeId(signal: string, category: NcaafTrendCategory) {
  return `${textKey(signal)}|${textKey(category)}`;
}

export function ncaafTrendCategory(play: TrendSide): NcaafTrendCategory | null {
  const market = textKey(play.market);
  if (market === "total") {
    const side = textKey(play.side || play.selection);
    return side.startsWith("over") ? "Over" : side.startsWith("under") ? "Under" : null;
  }
  if (market !== "spread") return null;
  const line = finiteNcaafNumber(play.line);
  if (line == null) return null;
  return line < 0 ? "Favorite Spread" : line > 0 ? "Underdog Spread" : "Pick'em Spread";
}

function sideKey(play: TrendSide) {
  return textKey(textKey(play.market) === "total"
    ? play.side || play.selection
    : play.selectionTeam || play.selection);
}

function percentage(value: unknown) {
  const n = finiteNcaafNumber(value);
  return n != null && n >= 0 && n <= 100 ? n : null;
}

// These are memberships, not pick eligibility. Hidden and losing signals keep
// their records; presentation filters only after all memberships are graded.
export function ncaafTrendSignals(play: TrendSide, siblings: TrendSide[]): string[] {
  if (!ncaafTrendCategory(play)) return [];
  const labels: string[] = [];
  if (isNcaafSharpPlay(play)) labels.push("Sharp");
  labels.push(...classifyNcaafMovement(play).labels);

  const ownKey = sideKey(play);
  const publicSide = siblings.find(candidate =>
    textKey(candidate.market) === textKey(play.market) && sideKey(candidate) !== ownKey);
  if (!publicSide) return labels;

  const bets = percentage(publicSide.betsPct);
  const money = percentage(publicSide.moneyPct);
  if (bets != null && money != null && bets > 75 && bets - money >= 55) labels.push("Public Fade");

  const openingBets = percentage(publicSide.openingBetsPct);
  const publicMove = finiteNcaafNumber(publicSide.publicMovementPct);
  const lineMove = finiteNcaafNumber(publicSide.lineMovementValue);
  const basis = String(publicSide.lineMovementBasis || "");
  const lineMarketMatches = textKey(play.market) === "spread"
    ? basis.includes("Spread") : basis.includes("Total Line");
  if (lineMarketMatches && openingBets != null && openingBets > 0 && openingBets < 100
    && publicMove != null && publicMove >= 5 && lineMove != null && lineMove <= -1.5) labels.push("RLM");
  return labels;
}

function recordSide(row: SheetRow): TrendSide {
  return {
    market: row.Market,
    selection: row["Public Split Selection"] || row.Selection,
    selectionTeam: row["Public Split Selection"] || row.Selection,
    side: row.Side || row.Selection,
    line: row["Public Split Line"] || row.Line,
    openingLine: row["Opening Public Split Line"] || row["Opening Line"] || row["Opening Total"],
    betsPct: row["Public Bets %"] || row["Current Public %"],
    moneyPct: row["Public Money %"] || row["Current Sharp %"],
    openingBetsPct: row["Opening Public %"] || row["Opening Bets %"],
    publicMovementPct: row["Public Change %"],
    lineMovementValue: row["Line Movement Value"],
    lineMovementBasis: row["Line Movement Basis"],
  };
}

function resultCode(row: SheetRow) {
  const result = String(row.Result || row.Status || "").toUpperCase().trim();
  return ["W", "WIN", "WON"].includes(result) ? "W"
    : ["L", "LOSS", "LOST"].includes(result) ? "L"
    : ["P", "PUSH"].includes(result) ? "P" : "";
}

function recordTotals(rows: SheetRow[]): NcaafTrendTotals {
  let wins = 0, losses = 0, pushes = 0, units = 0;
  for (const row of rows) {
    const result = resultCode(row);
    if (result === "W") {
      wins++;
      const supplied = finiteNcaafNumber(row["Public Split Odds"] || row.Odds);
      const odds = supplied != null && Math.abs(supplied) >= 100 ? supplied : -110;
      units += odds > 0 ? odds / 100 : 100 / Math.abs(odds);
    } else if (result === "L") { losses++; units--; }
    else if (result === "P") pushes++;
  }
  const decisions = wins + losses;
  const totalBets = decisions + pushes;
  return {
    record: `${wins}-${losses}-${pushes}`, totalBets, wins, losses, pushes,
    winPct: decisions ? Math.round(wins / decisions * 1000) / 10 : 0,
    unitsWon: Math.round(units * 100) / 100,
    roiPct: totalBets ? Math.round(units / totalBets * 1000) / 10 : 0,
  };
}

// Rank exact fractions before rounding the displayed percentage. Push-only and
// ungraded types have no win percentage and cannot earn a public badge.
export function rankNcaafPublicTrendSubtypes(subtypes: NcaafPublicTrendSubtype[]) {
  return subtypes.filter(row => row.totals.wins + row.totals.losses > 0)
    .sort((a, b) => {
      const aDecisions = a.totals.wins + a.totals.losses;
      const bDecisions = b.totals.wins + b.totals.losses;
      return b.totals.wins / bDecisions - a.totals.wins / aDecisions
        || bDecisions - aDecisions || a.id.localeCompare(b.id);
    }).slice(0, NCAAF_PUBLIC_TREND_LIMIT);
}

export function buildNcaafPublicTrendLeaderboard(rows: SheetRow[]): NcaafPublicTrendSubtype[] {
  const groups = new Map<string, Map<string, SheetRow>>();
  for (const row of rows) {
    if (!isVerifiedNcaafTrendRecord(row) || !resultCode(row)) continue;
    const groupKey = row["Direct Trend Group Key"] || [row.Date, textKey(row.Game), textKey(row.Market)].join("|");
    const group = groups.get(groupKey) || new Map<string, SheetRow>();
    const selection = sideKey(recordSide(row));
    if (!selection) continue;
    if (!group.has(selection)) group.set(selection, row);
    groups.set(groupKey, group);
  }
  const buckets = new Map<string, { signal: string; category: NcaafTrendCategory; rows: SheetRow[] }>();
  for (const group of groups.values()) {
    const uniqueRows = [...group.values()];
    const plays = uniqueRows.map(recordSide);
    for (let i = 0; i < uniqueRows.length; i++) {
      const category = ncaafTrendCategory(plays[i]);
      if (!category) continue;
      for (const signal of ncaafTrendSignals(plays[i], plays)) {
        const id = ncaafTrendSubtypeId(signal, category);
        const bucket = buckets.get(id) || { signal, category, rows: [] };
        bucket.rows.push(uniqueRows[i]);
        buckets.set(id, bucket);
      }
    }
  }
  return rankNcaafPublicTrendSubtypes([...buckets].map(([id, bucket]) => ({
    id, signal: bucket.signal, category: bucket.category,
    label: `${bucket.signal} - ${bucket.category}`, totals: recordTotals(bucket.rows),
  })));
}

export function visibleNcaafTrendBadges(
  play: TrendSide, siblings: TrendSide[], leaderboard: readonly NcaafPublicTrendSubtype[],
) {
  const category = ncaafTrendCategory(play);
  if (!category) return [];
  const signals = new Set(ncaafTrendSignals(play, siblings));
  return leaderboard.slice(0, NCAAF_PUBLIC_TREND_LIMIT)
    .filter(subtype => subtype.category === category && signals.has(subtype.signal));
}
