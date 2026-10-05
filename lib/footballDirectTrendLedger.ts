import type { FootballSport, SheetRow } from "./sportSheets";

type AnyPick = Record<string, any>;
type ResultCode = "W" | "L" | "P" | "";
type DirectTrendSignal = "RLM" | "Public Fade" | "Sharp" | "Market Move" | "Money Momentum";

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

function resultCode(value: unknown): ResultCode {
  const key = String(value || "").trim().toUpperCase();
  if (["W", "WIN", "WON"].includes(key)) return "W";
  if (["L", "LOSS", "LOST"].includes(key)) return "L";
  if (["P", "PUSH"].includes(key)) return "P";
  return "";
}

function directSignals(pick: AnyPick): DirectTrendSignal[] {
  const key = textKey(`${pick.tier || ""} ${pick.trendTier || ""} ${pick.qualification || ""}`);
  const signals: DirectTrendSignal[] = [];
  if (key.includes("rlm")) signals.push("RLM");
  if (key.includes("public fade")) signals.push("Public Fade");
  if (key.includes("sharp")) signals.push("Sharp");
  if (key.includes("market move")) signals.push("Market Move");
  if (key.includes("money momentum")) signals.push("Money Momentum");
  return signals;
}

function directTrendSource(pick: AnyPick) {
  const source = textKey(pick.source);
  return source === "trend play" || source === "best trend";
}

function normalizeTeamToken(value: string) {
  const aliases: Record<string, string> = {
    "pitt": "pittsburgh",
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
    .map((part) => normalizeTeamToken(part))
    .filter(Boolean);
  if (parts.length === 2) return `${parts[0]}|${parts[1]}`;
  return textKey(raw);
}

function normalizedMarket(value: unknown) {
  const key = textKey(value);
  if (key.includes("total")) return "Total";
  if (key.includes("spread") || key.includes("run line")) return "Spread";
  return "";
}

function groupKeyFromPick(pick: AnyPick) {
  const date = isoDate(pick.date || pick.Date);
  const game = normalizeGame(pick.game || pick.Game);
  const market = normalizedMarket(pick.market || pick.Market);
  return date && game && market ? `${date}|${game}|${market}` : "";
}

function groupKeyFromTrendRow(row: SheetRow) {
  const date = isoDate(row.Date || row["Game Date"]);
  const game = normalizeGame(row.Game || `${row["Away Team"] || ""} @ ${row["Home Team"] || ""}`);
  const market = normalizedMarket(row.Market || row["Bet Type"]);
  return date && game && market ? `${date}|${game}|${market}` : "";
}

function parseEpoch(value: unknown) {
  const raw = String(value || "").trim()
    .replace(/ EDT$/, " -0400")
    .replace(/ EST$/, " -0500");
  if (!raw) return 0;
  const stamp = Date.parse(raw);
  return Number.isFinite(stamp) ? stamp : 0;
}

function snapshotRank(pick: AnyPick) {
  return textKey(pick.snapshotStatus) === "final pregame" ? 2 : 1;
}

function selectionPenalty(pick: AnyPick) {
  const selection = String(pick.selection || pick.play || "").trim();
  const numbers = selection.match(/[+-]?\d+(?:\.\d+)?/g) || [];
  if (numbers.length < 2) return 0;
  return numbers.some((value, index) => index > 0 && value === numbers[index - 1]) ? 1 : 0;
}

function preferredPick(current: AnyPick, candidate: AnyPick) {
  const rankDiff = snapshotRank(candidate) - snapshotRank(current);
  if (rankDiff !== 0) return rankDiff > 0 ? candidate : current;
  const candidateStamp = Math.max(
    parseEpoch(candidate.lockedAt),
    parseEpoch(candidate.updatedAt),
    parseEpoch(candidate.resultUpdated),
  );
  const currentStamp = Math.max(
    parseEpoch(current.lockedAt),
    parseEpoch(current.updatedAt),
    parseEpoch(current.resultUpdated),
  );
  if (candidateStamp !== currentStamp) return candidateStamp > currentStamp ? candidate : current;
  const penaltyDiff = selectionPenalty(candidate) - selectionPenalty(current);
  if (penaltyDiff !== 0) return penaltyDiff < 0 ? candidate : current;
  return candidate;
}

/**
 * One authoritative published decision per game + market.
 * A FINAL_PREGAME row supersedes earlier LIVE line variants. When legacy history
 * has no final marker, the latest graded published row is retained.
 */
export function canonicalPublishedDirectTrendPicks(aiPickRows: AnyPick[]) {
  const canonical = new Map<string, AnyPick>();
  for (const pick of aiPickRows || []) {
    if (!directTrendSource(pick) || !resultCode(pick.result || pick.Result)) continue;
    if (!directSignals(pick).length) continue;
    const key = groupKeyFromPick(pick);
    if (!key) continue;
    const previous = canonical.get(key);
    canonical.set(key, previous ? preferredPick(previous, pick) : pick);
  }
  return [...canonical.values()];
}

function numberFrom(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/[−–—]/g, "-").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function lineFromPick(pick: AnyPick) {
  const direct = numberFrom(pick.line ?? pick.Line);
  if (direct != null) return direct;
  const matches = String(pick.selection || pick.play || "")
    .replace(/[−–—]/g, "-")
    .match(/[+-]?\d+(?:\.\d+)?/g) || [];
  for (const raw of [...matches].reverse()) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && Math.abs(parsed) <= 100) return parsed;
  }
  return null;
}

function totalSide(value: unknown) {
  const key = textKey(value);
  if (key.startsWith("under") || key.includes(" under ")) return "Under";
  if (key.startsWith("over") || key.includes(" over ")) return "Over";
  return "";
}

function spreadSelection(value: unknown) {
  return String(value || "")
    .replace(/(?:\s+[+−-]?\d+(?:\.\d+)?)+\s*$/, "")
    .trim();
}

function gameTeams(value: unknown) {
  const raw = String(value || "").trim();
  const parts = raw.split(/\s*(?:@|\bat\b|\bvs\.?\b|\bversus\b)\s*/i).map((part) => part.trim()).filter(Boolean);
  return parts.length === 2 ? { away: parts[0], home: parts[1] } : { away: "", home: "" };
}

function sameLooseTeam(a: unknown, b: unknown) {
  const left = normalizeTeamToken(String(a || ""));
  const right = normalizeTeamToken(String(b || ""));
  if (!left || !right) return false;
  if (left === right || left.includes(right) || right.includes(left)) return true;
  const leftParts = left.split(" ");
  const rightParts = right.split(" ");
  return leftParts[leftParts.length - 1] === rightParts[rightParts.length - 1];
}

function inverseResult(result: ResultCode): ResultCode {
  if (result === "W") return "L";
  if (result === "L") return "W";
  return result;
}

function americanOddsText(value: unknown) {
  const raw = String(value || "").replace(/−/g, "-").trim();
  const match = raw.match(/[+-]?\d{3,4}/);
  if (!match) return "-110";
  const odds = Number(match[0]);
  return Number.isFinite(odds) ? (odds > 0 ? `+${odds}` : String(odds)) : "-110";
}

function syntheticRowsForPick(pick: AnyPick, sport: FootballSport): SheetRow[] {
  const date = isoDate(pick.date || pick.Date);
  const game = String(pick.game || pick.Game || "").trim();
  const market = normalizedMarket(pick.market || pick.Market);
  const result = resultCode(pick.result || pick.Result);
  const signals = directSignals(pick);
  const line = lineFromPick(pick);
  if (!date || !game || !market || !result || !signals.length || line == null) return [];

  const hasRlm = signals.includes("RLM");
  const hasFade = signals.includes("Public Fade");
  const hasSharp = signals.includes("Sharp");
  const hasMarketMove = signals.includes("Market Move");
  const hasMoneyMomentum = signals.includes("Money Momentum");
  const teams = gameTeams(game);
  const selection = market === "Total"
    ? totalSide(pick.selection || pick.play)
    : spreadSelection(pick.selection || pick.play);
  if (!selection) return [];
  const oppositeSelection = market === "Total"
    ? (selection === "Under" ? "Over" : "Under")
    : sameLooseTeam(selection, teams.away)
      ? teams.home || "Opponent"
      : sameLooseTeam(selection, teams.home)
        ? teams.away || "Opponent"
        : "Opponent";

  // These rows are record-ledger rows, not display-market rows. Encode only the
  // signals that were actually published so current rule code cannot invent or
  // erase a historical qualification later.
  const selectedBets = 40;
  const selectedMoney = hasSharp ? (sport === "NCAAF" ? 85 : 70) : hasMoneyMomentum ? 50 : 40;
  const openingSelectedMoney = hasMoneyMomentum ? selectedMoney - 10 : selectedMoney;
  const selectedLineMove = hasMarketMove ? 1 : hasMoneyMomentum ? 0.5 : 0;
  let publicBets = 60;
  let publicMoney = 60;
  if (hasFade) {
    publicBets = 80;
    publicMoney = sport === "NCAAF" ? 20 : 60;
  } else if (hasRlm) {
    publicBets = 65;
    publicMoney = 65;
  }

  const rawPublicMove = Math.abs(Number(pick.publicMovePct ?? pick.publicMovementPct));
  const publicMove = hasRlm ? Math.max(5, Number.isFinite(rawPublicMove) ? rawPublicMove : 5) : 0;
  let openingPublic = publicBets - publicMove;
  if (!(openingPublic > 0 && openingPublic < 100)) openingPublic = Math.max(1, Math.min(99, publicBets - 5));
  const rawLineMove = Math.abs(Number(pick.lineMoveValue ?? pick.lineMovementValue));
  const lineMove = hasRlm ? -Math.max(1.5, Number.isFinite(rawLineMove) ? rawLineMove : 1.5) : 0;
  const gameKey = `PUBLISHED|${date}|${normalizeGame(game)}|${market}`;
  const odds = americanOddsText(pick.odds || pick.Odds);
  const tier = signals.join(" + ");

  const common: SheetRow = {
    Date: date,
    "Game Key": gameKey,
    Game: game,
    "Game Time": String(pick.gameTime || ""),
    "Away Team": teams.away,
    "Home Team": teams.home,
    Market: market,
    "Trend Play": "TRUE",
    "Trend Tier": tier,
    "Trend Signals": tier,
    "Direct Trend Group Key": gameKey,
    "Public Split Source": "Published EZPZ history",
    "Public Split Match Confidence": "Published graded pick",
    "Result Source": "ezpz_pick_history",
  };

  const selectedRow: SheetRow = {
    ...common,
    Selection: selection,
    Side: market === "Total" ? selection : "",
    Line: String(line),
    Odds: odds,
    "Public Split Selection": selection,
    "Public Split Line": String(line),
    "Public Split Odds": odds,
    "Public Bets %": String(selectedBets),
    "Current Public %": String(selectedBets),
    "Opening Public %": String(selectedBets),
    "Public Change %": "0",
    "Public Money %": String(selectedMoney),
    "Current Sharp %": String(selectedMoney),
    "Opening Sharp %": String(openingSelectedMoney),
    "Sharp Change %": String(selectedMoney - openingSelectedMoney),
    "Line Movement Basis": market === "Total" ? "Total Line" : "Spread Line",
    "Line Movement Value": String(selectedLineMove),
    Result: result,
  };

  const oppositeLine = market === "Spread" ? -line : line;
  const oppositeRow: SheetRow = {
    ...common,
    Selection: oppositeSelection,
    Side: market === "Total" ? oppositeSelection : "",
    Line: String(oppositeLine),
    Odds: "-110",
    "Public Split Selection": oppositeSelection,
    "Public Split Line": String(oppositeLine),
    "Public Split Odds": "-110",
    "Public Bets %": String(publicBets),
    "Current Public %": String(publicBets),
    "Opening Public %": String(openingPublic),
    "Public Change %": String(publicMove),
    "Public Money %": String(publicMoney),
    "Current Sharp %": String(publicMoney),
    "Opening Sharp %": String(publicMoney),
    "Sharp Change %": "0",
    "Line Movement Basis": market === "Total" ? "Total Line" : "Spread Line",
    "Line Movement Value": String(lineMove),
    Result: inverseResult(result),
  };

  return [selectedRow, oppositeRow];
}

/**
 * Overlay the published/graded EZPZ direct-trend ledger onto generic historical
 * split rows. Any game+market that has a graded published pick is removed from
 * the reconstructed source and replaced by a deterministic pair encoding the
 * actual published signal(s). Older markets without saved EZPZ history keep the
 * legacy reconstruction as a fallback.
 */
export function overlayPublishedDirectTrendRows(
  trendRows: SheetRow[],
  aiPickRows: AnyPick[],
  sport: FootballSport,
) {
  const canonical = canonicalPublishedDirectTrendPicks(aiPickRows);
  if (!canonical.length) return trendRows;
  const overrides = new Set(canonical.map(groupKeyFromPick).filter(Boolean));
  const preserved = (trendRows || []).filter((row) => {
    const key = groupKeyFromTrendRow(row);
    return !key || !overrides.has(key);
  });
  const published = canonical.flatMap((pick) => syntheticRowsForPick(pick, sport));
  return [...preserved, ...published];
}

export const __test__ = {
  directSignals,
  groupKeyFromPick,
  groupKeyFromTrendRow,
  syntheticRowsForPick,
};
