import { buildFootballPublicData as buildFootballPublicDataWithHistory } from "./footballPublicDataHistory";
import { overlayPublishedDirectTrendRows } from "./footballDirectTrendLedger";
import type { FootballSport, SheetRow } from "./sportSheets";

export {
  PUBLIC_SPLIT_HEADERS,
  ALL_GAME_TRENDS_HEADERS,
  __test__,
} from "./footballPublicDataHistory";
export type { FootballMarket } from "./footballPublicDataHistory";

type AnyPick = Record<string, any>;

function textKey(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/−/g, "-")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isoDate(value: unknown) {
  const raw = String(value || "").trim();
  const iso = raw.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const us = raw.match(/(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?/);
  if (!us) return "";
  const year = us[3] || String(new Date().getFullYear());
  return `${year}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
}

function normalizeTeam(value: unknown) {
  const aliases: Record<string, string> = {
    pitt: "pittsburgh",
    "missouri st": "missouri state",
    "mississippi st": "mississippi state",
    "michigan st": "michigan state",
    "ohio st": "ohio state",
    "penn st": "penn state",
    "washington st": "washington state",
    "fresno st": "fresno state",
  };
  const key = textKey(value).replace(/\bst\b/g, "state").replace(/\s+/g, " ").trim();
  return aliases[key] || key;
}

function normalizeGame(value: unknown) {
  const raw = String(value || "").trim();
  const parts = raw
    .split(/\s*(?:@|\bat\b|\bvs\.?\b|\bversus\b)\s*/i)
    .map(normalizeTeam)
    .filter(Boolean);
  return parts.length === 2 ? `${parts[0]}|${parts[1]}` : textKey(raw);
}

function normalizedMarket(value: unknown) {
  const key = textKey(value);
  if (key.includes("total")) return "Total";
  if (key.includes("spread") || key.includes("run line")) return "Spread";
  return "";
}

function directPublishedPick(pick: AnyPick) {
  const source = textKey(pick.source);
  const labels = textKey(`${pick.tier || ""} ${pick.trendTier || ""} ${pick.qualification || ""}`);
  return (source === "trend play" || source === "best trend") &&
    (labels.includes("rlm") || labels.includes("public fade") || labels.includes("sharp"));
}

function historyGroupKey(pick: AnyPick) {
  const date = isoDate(pick.date || pick.Date);
  const game = normalizeGame(pick.game || pick.Game);
  const market = normalizedMarket(pick.market || pick.Market);
  return date && game && market ? `${date}|${game}|${market}` : "";
}

function trendGroupKey(row: SheetRow) {
  const date = isoDate(row.Date || row["Game Date"]);
  const game = normalizeGame(row.Game || `${row["Away Team"] || ""} @ ${row["Home Team"] || ""}`);
  const market = normalizedMarket(row.Market || row["Bet Type"]);
  return date && game && market ? `${date}|${game}|${market}` : "";
}

function timestamp(value: unknown) {
  const raw = String(value || "")
    .trim()
    .replace(/ EDT$/, " -0400")
    .replace(/ EST$/, " -0500");
  if (!raw) return 0;
  const stamp = Date.parse(raw);
  return Number.isFinite(stamp) ? stamp : 0;
}

function pickTime(pick: AnyPick) {
  return Math.max(
    timestamp(pick.gameTime),
    timestamp(pick.lockedAt),
    timestamp(pick.updatedAt),
    timestamp(pick.resultUpdated),
  );
}

function snapshotRank(pick: AnyPick) {
  return textKey(pick.snapshotStatus) === "final pregame" ? 2 : 1;
}

function duplicateLinePenalty(pick: AnyPick) {
  const numbers = String(pick.selection || pick.play || "").match(/[+-]?\d+(?:\.\d+)?/g) || [];
  return numbers.some((value, index) => index > 0 && value === numbers[index - 1]) ? 1 : 0;
}

function preferPublishedPick(current: AnyPick, candidate: AnyPick) {
  const rankDiff = snapshotRank(candidate) - snapshotRank(current);
  if (rankDiff !== 0) return rankDiff > 0 ? candidate : current;
  const timeDiff = pickTime(candidate) - pickTime(current);
  if (timeDiff !== 0) return timeDiff > 0 ? candidate : current;
  const penaltyDiff = duplicateLinePenalty(candidate) - duplicateLinePenalty(current);
  if (penaltyDiff !== 0) return penaltyDiff < 0 ? candidate : current;
  return candidate;
}

function authoritativeDirectHistory(rows: AnyPick[]) {
  const grouped = new Map<string, AnyPick>();
  for (const pick of rows || []) {
    if (!directPublishedPick(pick)) continue;
    const key = historyGroupKey(pick);
    if (!key) continue;
    const previous = grouped.get(key);
    grouped.set(key, previous ? preferPublishedPick(previous, pick) : pick);
  }
  return [...grouped.values()].sort((a, b) => {
    const byDate = isoDate(b.date || b.Date).localeCompare(isoDate(a.date || a.Date));
    if (byDate) return byDate;
    return pickTime(b) - pickTime(a);
  });
}

export async function buildFootballPublicData(
  sport: FootballSport,
  options: { forceFresh?: boolean; persist?: boolean } = {},
): Promise<Record<string, any>> {
  const data = (await buildFootballPublicDataWithHistory(sport, options)) as Record<string, any>;
  const trendRows = Array.isArray(data.trendRecordRows) ? data.trendRecordRows as SheetRow[] : [];
  const published = authoritativeDirectHistory(
    Array.isArray(data.aiPickRecordRows) ? data.aiPickRecordRows : [],
  );

  // Any published direct-trend decision owns its game+market record identity,
  // even if its FINAL grade is still pending. This prevents a stale LIVE row or
  // a later reconstruction from being counted in its place.
  const publishedGroups = new Set(published.map(historyGroupKey).filter(Boolean));
  const legacyFallbackRows = trendRows.filter((row) => {
    const key = trendGroupKey(row);
    return !key || !publishedGroups.has(key);
  });

  return {
    ...data,
    trendRecordRows: overlayPublishedDirectTrendRows(
      legacyFallbackRows,
      published,
      sport,
    ),
  };
}
