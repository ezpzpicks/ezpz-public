import {
  buildFootballPublicData as buildLegacyFootballPublicData,
} from "./footballPublicDataLegacy";
import {
  readSportWorksheet,
  upsertSportRows,
  type FootballSport,
  type SheetRow,
} from "./sportSheets";

export {
  PUBLIC_SPLIT_HEADERS,
  ALL_GAME_TRENDS_HEADERS,
  __test__,
} from "./footballPublicDataLegacy";
export type { FootballMarket } from "./footballPublicDataLegacy";

const EZPZ_PICK_HISTORY_TAB = "ezpz_pick_history";
const EZPZ_PICK_HISTORY_HEADERS = [
  "Date",
  "Pick Key",
  "Game",
  "Market",
  "Selection",
  "Odds",
  "Source",
  "Snapshot Status",
  "Player",
  "Player Team",
  "Prop Market",
  "Prop Side",
  "Prop Line",
  "Result",
  "Result Updated",
  "Saved At",
  "Details JSON",
];

type ResultCode = "W" | "L" | "P" | "";
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

function resultCode(value: unknown): ResultCode {
  const key = String(value || "").trim().toUpperCase();
  if (["W", "WIN", "WON"].includes(key)) return "W";
  if (["L", "LOSS", "LOST"].includes(key)) return "L";
  if (["P", "PUSH"].includes(key)) return "P";
  return "";
}

function parseAmericanOdds(value: unknown) {
  const raw = String(value ?? "").trim().replace(/−/g, "-");
  if (!raw) return null;
  if (/^(?:even|evens|even money)$/i.test(raw)) return 100;
  const tokens = raw.match(/[+-]?\d+(?:\.\d+)?/g) || [];
  for (const token of [...tokens].reverse()) {
    const parsed = Number(token);
    if (!Number.isFinite(parsed) || Math.abs(parsed) < 100 || Math.abs(parsed) > 10000) continue;
    return Math.round(parsed);
  }
  return null;
}

function formatAmericanOdds(value: unknown) {
  const odds = parseAmericanOdds(value);
  if (odds == null) return "";
  return odds > 0 ? `+${odds}` : String(odds);
}

function lineNumber(value: unknown) {
  const matches = String(value || "").replace(/[−–—]/g, "-").match(/[+-]?\d+(?:\.\d+)?/g) || [];
  for (const raw of [...matches].reverse()) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && Math.abs(parsed) <= 100) return parsed;
  }
  return null;
}

function side(value: unknown) {
  const key = textKey(value);
  if (key.startsWith("under") || key.includes(" under ")) return "under";
  if (key.startsWith("over") || key.includes(" over ")) return "over";
  return "";
}

function rowDate(row: SheetRow) {
  return isoDate(row.Date || row["Game Date"] || "");
}

function rowGame(row: SheetRow) {
  const game = String(row.Game || "").trim();
  if (game) return game;
  const team = String(row.Team || "").trim();
  const opponent = String(row.Opponent || "").trim();
  return [team, opponent].filter(Boolean).join(" vs ");
}

function normalizedGame(value: unknown) {
  return textKey(value).replace(/\b(?:vs|at)\b/g, " ").replace(/\s+/g, " ").trim();
}

function sameGame(a: unknown, b: unknown) {
  const left = normalizedGame(a);
  const right = normalizedGame(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const leftTokens = new Set(left.split(" ").filter((token) => token.length > 1));
  const rightTokens = new Set(right.split(" ").filter((token) => token.length > 1));
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return overlap >= Math.min(3, Math.max(2, Math.min(leftTokens.size, rightTokens.size)));
}

function isPropPick(pick: AnyPick) {
  return textKey(pick.market) === "player prop" || Boolean(String(pick.playerName || pick.Player || "").trim());
}

function pickKey(pick: AnyPick, dateOverride = "") {
  const date = isoDate(dateOverride || pick.date || pick.Date);
  const game = normalizedGame(pick.game || pick.Game);
  const market = textKey(pick.market || pick.Market);
  const player = textKey(pick.playerName || pick.Player);
  if (player || market === "player prop") {
    const propMarket = textKey(pick.propMarket || pick["Prop Market"] || pick.market || pick.Market);
    const propSide = textKey(pick.propSide || pick["Prop Side"] || side(pick.selection || pick.Selection));
    const propLine = String(pick.propLine ?? pick["Prop Line"] ?? lineNumber(pick.selection || pick.Selection) ?? "").trim();
    return `${date}|${game}|prop|${player}|${propMarket}|${propSide}|${propLine}`;
  }
  if (market.includes("total")) {
    const direction = side(pick.selection || pick.Selection);
    const line = lineNumber(pick.selection || pick.Selection || pick.line || pick.Line);
    return `${date}|${game}|total|${direction}|${line ?? ""}`;
  }
  const team = textKey(String(pick.selection || pick.Selection || "").replace(/\s+[+-]?\d+(?:\.\d+)?\s*$/, ""));
  return `${date}|${game}|spread|${team}`;
}

function historyRowFromPick(pick: AnyPick, today: string, previous?: SheetRow): SheetRow {
  const date = isoDate(pick.date || today) || today;
  const now = new Date().toISOString();
  const result = resultCode(pick.result || pick.Result || previous?.Result);
  const details = {
    ...pick,
    date,
    result,
  };
  return {
    Date: date,
    "Pick Key": pickKey(pick, date),
    Game: String(pick.game || ""),
    Market: String(pick.market || ""),
    Selection: String(pick.selection || ""),
    Odds: String(pick.odds || ""),
    Source: String(pick.source || ""),
    "Snapshot Status": String(pick.snapshotStatus || ""),
    Player: String(pick.playerName || ""),
    "Player Team": String(pick.playerTeam || ""),
    "Prop Market": String(pick.propMarket || ""),
    "Prop Side": String(pick.propSide || ""),
    "Prop Line": String(pick.propLine ?? ""),
    Result: result,
    "Result Updated": String(pick.resultUpdated || previous?.["Result Updated"] || ""),
    "Saved At": String(previous?.["Saved At"] || now),
    "Details JSON": JSON.stringify(details),
  };
}

function stripTrailingLine(value: unknown) {
  return textKey(String(value || "").replace(/\s+[+-]?\d+(?:\.\d+)?\s*$/, ""));
}

function rowMatchesHistory(row: SheetRow, history: SheetRow) {
  if (rowDate(row) !== isoDate(history.Date)) return false;
  if (!sameGame(rowGame(row), history.Game)) return false;

  const historyPlayer = textKey(history.Player);
  if (historyPlayer) {
    const rowPlayer = textKey(row.Player || row["Player Name"] || "");
    if (!rowPlayer || rowPlayer !== historyPlayer) return false;
    const historyMarket = textKey(history["Prop Market"] || history.Market);
    const rowMarket = textKey(row.Market || row["Bet Type"] || "");
    if (historyMarket && rowMarket && !(historyMarket.includes(rowMarket) || rowMarket.includes(historyMarket))) return false;
    const historySide = textKey(history["Prop Side"] || side(history.Selection));
    const rowSide = textKey(side(row.Pick || row.Side || row.Selection));
    if (historySide && rowSide && historySide !== rowSide) return false;
    const historyLine = lineNumber(history["Prop Line"] || history.Selection);
    const rowLine = lineNumber(row["Market Line"] || row.Line || row["Prop Line"] || row.Pick || row.Selection);
    if (historyLine != null && rowLine != null && Math.abs(historyLine - rowLine) > 0.01) return false;
    return true;
  }

  const historyMarket = textKey(history.Market);
  const rowMarket = textKey(row.Market || row["Bet Type"] || "");
  if (historyMarket.includes("total")) {
    if (!rowMarket.includes("total")) return false;
    const historySide = side(history.Selection);
    const rowSide = side(row.Selection || row.Side || row.Pick);
    if (historySide && rowSide && historySide !== rowSide) return false;
    const historyLine = lineNumber(history.Selection);
    const rowLine = lineNumber(row.Selection || row.Line || row["Odds/Line"]);
    return historyLine == null || rowLine == null || Math.abs(historyLine - rowLine) <= 0.01;
  }

  if (historyMarket.includes("spread")) {
    if (!rowMarket.includes("spread") && !textKey(row["Bet Type"]).includes("spread")) return false;
    const historyTeam = stripTrailingLine(history.Selection);
    const rowTeam = stripTrailingLine(row.Selection || row.Pick);
    return Boolean(historyTeam && rowTeam && (historyTeam === rowTeam || historyTeam.includes(rowTeam) || rowTeam.includes(historyTeam)));
  }

  return textKey(history.Selection) === textKey(row.Selection || row.Pick || row.Side);
}

function settledResultForHistory(history: SheetRow, data: AnyPick) {
  const source = textKey(history.Source);
  const tracker = Array.isArray(data.betTrackerRows) ? data.betTrackerRows as SheetRow[] : [];
  const trends = Array.isArray(data.trendRecordRows) ? data.trendRecordRows as SheetRow[] : [];
  const pools: SheetRow[][] = [];
  if (source.includes("trend")) pools.push(trends);
  if (source.includes("best") || !source) pools.push(tracker);
  if (!pools.length) pools.push(tracker, trends);
  for (const pool of pools) {
    const match = pool.find((row) => rowMatchesHistory(row, history) && resultCode(row.Result || row.Status));
    if (match) {
      return {
        result: resultCode(match.Result || match.Status),
        updated: String(match["Result Updated"] || match["Updated At"] || new Date().toISOString()),
      };
    }
  }
  return { result: resultCode(history.Result), updated: String(history["Result Updated"] || "") };
}

function historyPickFromRow(row: SheetRow): AnyPick {
  let details: AnyPick = {};
  try {
    const parsed = JSON.parse(String(row["Details JSON"] || "{}"));
    if (parsed && typeof parsed === "object") details = parsed;
  } catch {}
  return {
    ...details,
    date: isoDate(row.Date),
    game: String(row.Game || details.game || ""),
    market: String(row.Market || details.market || ""),
    selection: String(row.Selection || details.selection || ""),
    odds: String(row.Odds || details.odds || ""),
    source: String(row.Source || details.source || ""),
    snapshotStatus: String(row["Snapshot Status"] || details.snapshotStatus || ""),
    playerName: String(row.Player || details.playerName || ""),
    playerTeam: String(row["Player Team"] || details.playerTeam || ""),
    propMarket: String(row["Prop Market"] || details.propMarket || ""),
    propSide: String(row["Prop Side"] || details.propSide || ""),
    propLine: String(row["Prop Line"] || details.propLine || ""),
    result: resultCode(row.Result || details.result),
    resultUpdated: String(row["Result Updated"] || details.resultUpdated || ""),
  };
}

function directTrendSideKey(play: AnyPick) {
  return textKey(play.market) === "total"
    ? textKey(play.side || play.selection)
    : textKey(play.selection || play.selectionTeam);
}

function directNflTrendLabels(play: AnyPick, plays: AnyPick[]) {
  const labels: string[] = [];

  const ownBets = Number(play.betsPct);
  const ownMoney = Number(play.moneyPct);
  if (
    Number.isFinite(ownBets) &&
    Number.isFinite(ownMoney) &&
    ownMoney - ownBets >= 25
  ) {
    labels.push("Sharp");
  }

  const ownKey = directTrendSideKey(play);
  const publicSide = plays.find((candidate) =>
    textKey(candidate.game) === textKey(play.game) &&
    textKey(candidate.market) === textKey(play.market) &&
    directTrendSideKey(candidate) !== ownKey
  );
  if (!publicSide) return { labels, publicSide: null as AnyPick | null };

  const publicBets = Number(publicSide.betsPct);
  const publicMoney = Number(publicSide.moneyPct);
  const placeholderSplit =
    (publicBets === 100 && publicMoney === 100) ||
    (publicBets === 0 && publicMoney === 0);

  if (!placeholderSplit && Number.isFinite(publicBets) && publicBets >= 80) {
    labels.push("Public Fade");
  }

  const openingPublicBets = Number(publicSide.openingBetsPct);
  const publicMove = Number(publicSide.publicMovementPct);
  const lineMove = Number(publicSide.lineMovementValue);
  if (
    textKey(play.market) === "spread" &&
    Number.isFinite(openingPublicBets) &&
    openingPublicBets > 0 &&
    openingPublicBets < 100 &&
    String(publicSide.lineMovementBasis || "").includes("Spread") &&
    Number.isFinite(publicMove) &&
    publicMove >= 5 &&
    Number.isFinite(lineMove) &&
    lineMove <= -1.5
  ) {
    labels.push("Strong RLM");
  }

  return { labels, publicSide };
}

function directNflTrendPick(play: AnyPick, plays: AnyPick[], today: string): AnyPick | null {
  const { labels, publicSide } = directNflTrendLabels(play, plays);
  if (!labels.length) return null;

  const odds = parseAmericanOdds(play.odds);
  if (odds == null || odds < -150) return null;

  const lineValue = Number(play.line);
  const line = Number.isFinite(lineValue) ? `${lineValue > 0 ? "+" : ""}${lineValue}` : "";
  const selection = textKey(play.market) === "total"
    ? `${play.side || play.selection} ${line}`.trim()
    : `${play.selection || play.selectionTeam} ${line}`.trim();

  const details: string[] = [];
  if (labels.includes("Sharp")) {
    details.push(`money exceeds bets by ${Math.round(Number(play.moneyPct) - Number(play.betsPct))} pts`);
  }
  if (labels.includes("Public Fade") && publicSide) {
    details.push(`fade ${Math.round(Number(publicSide.betsPct))}% public side`);
  }
  if (labels.includes("Strong RLM") && publicSide) {
    details.push(
      `public bets +${Math.round(Number(publicSide.publicMovementPct))} pts while spread moved ${Math.abs(Number(publicSide.lineMovementValue)).toFixed(1)} pts against that side`,
    );
  }

  return {
    date: today,
    source: "Trend Play",
    game: String(play.game || ""),
    market: textKey(play.market) === "total" ? "Total" : "Spread",
    selection,
    odds: formatAmericanOdds(odds),
    score: labels.includes("Strong RLM") ? 85 : 80,
    tier: labels.join(" + "),
    qualification: `${labels.join(" + ")} • ${details.join(" • ")}`,
    betsPct: Number(play.betsPct),
    moneyPct: Number(play.moneyPct),
    gapPct: Math.round((Number(play.moneyPct) - Number(play.betsPct)) * 10) / 10,
    publicSideBetsPct: publicSide ? Number(publicSide.betsPct) : undefined,
    publicSideMoneyPct: publicSide ? Number(publicSide.moneyPct) : undefined,
    publicMovePct: publicSide ? Number(publicSide.publicMovementPct) : undefined,
    lineMoveValue: publicSide ? Number(publicSide.lineMovementValue) : undefined,
    snapshotStatus: String(play.snapshotStatus || "LIVE"),
  };
}

function directNflTrendPicks(core: AnyPick, today: string) {
  const plays = (Array.isArray(core.trendPlays) ? core.trendPlays : [])
    .filter((play: AnyPick) => isoDate(play.date || play.recordDate || play.Date || today) === today);
  const picks = plays
    .map((play: AnyPick) => directNflTrendPick(play, plays, today))
    .filter((pick: AnyPick | null): pick is AnyPick => Boolean(pick));
  const deduped = new Map<string, AnyPick>();
  for (const pick of picks) deduped.set(pickKey(pick, today), pick);
  return [...deduped.values()];
}

function mergeCurrentPicks(basePicks: AnyPick[], trendPicks: AnyPick[], today: string) {
  const merged = new Map<string, AnyPick>();
  for (const pick of basePicks) merged.set(pickKey(pick, today), pick);
  for (const trend of trendPicks) {
    const key = pickKey(trend, today);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, trend);
      continue;
    }
    merged.set(key, {
      ...existing,
      source: "Best + Trend",
      score: Math.max(Number(existing.score || 0), Number(trend.score || 0)),
      tier: [existing.tier, trend.tier].filter(Boolean).join(" + "),
      qualification: [existing.qualification, trend.qualification].filter(Boolean).join(" • "),
      snapshotStatus: trend.snapshotStatus || existing.snapshotStatus,
    });
  }
  return [...merged.values()];
}

async function readHistory(sport: FootballSport) {
  try {
    return await readSportWorksheet(sport, EZPZ_PICK_HISTORY_TAB, EZPZ_PICK_HISTORY_HEADERS);
  } catch {
    return [] as SheetRow[];
  }
}

export async function buildFootballPublicData(
  sport: FootballSport,
  options: { forceFresh?: boolean; persist?: boolean } = {},
) {
  const core = await buildLegacyFootballPublicData(sport, options) as AnyPick;
  const today = isoDate(core.today) || new Date().toISOString().slice(0, 10);
  let history = await readHistory(sport);

  const baseCurrentPicks = (Array.isArray(core.aiPicks) ? core.aiPicks : [])
    .map((pick: AnyPick) => ({ ...pick, date: isoDate(pick.date) || today }));
  const directTrendPicks = sport === "NFL" ? directNflTrendPicks(core, today) : [];
  const currentPicks = mergeCurrentPicks(baseCurrentPicks, directTrendPicks, today);
  const existingByKey = new Map(history.map((row) => [String(row["Pick Key"] || pickKey(row, row.Date)), row]));
  const currentRows = currentPicks
    .map((pick: AnyPick) => historyRowFromPick(pick, today, existingByKey.get(pickKey(pick, today))))
    .filter((row: SheetRow) => Boolean(row["Pick Key"]));

  if (options.persist && currentRows.length) {
    await upsertSportRows(
      sport,
      EZPZ_PICK_HISTORY_TAB,
      EZPZ_PICK_HISTORY_HEADERS,
      currentRows,
      (row) => String(row["Pick Key"] || pickKey(row, row.Date)),
    );
    history = await readHistory(sport);
  } else if (currentRows.length) {
    const merged = new Map(history.map((row) => [String(row["Pick Key"] || pickKey(row, row.Date)), row]));
    for (const row of currentRows) merged.set(String(row["Pick Key"]), { ...(merged.get(String(row["Pick Key"])) || {}), ...row });
    history = [...merged.values()];
  }

  let gradingChanged = false;
  const gradedHistory = history.map((row) => {
    const settled = settledResultForHistory(row, core);
    if (!settled.result || settled.result === resultCode(row.Result)) return row;
    gradingChanged = true;
    return {
      ...row,
      Result: settled.result,
      "Result Updated": settled.updated,
    };
  });

  if (options.persist && gradingChanged) {
    await upsertSportRows(
      sport,
      EZPZ_PICK_HISTORY_TAB,
      EZPZ_PICK_HISTORY_HEADERS,
      gradedHistory,
      (row) => String(row["Pick Key"] || pickKey(row, row.Date)),
    );
  }

  const historyMap = new Map(gradedHistory.map((row) => [String(row["Pick Key"] || pickKey(row, row.Date)), row]));
  const enrichedCurrentPicks = currentPicks.map((pick: AnyPick) => {
    const row = historyMap.get(pickKey(pick, today));
    if (!row) return pick;
    return {
      ...pick,
      result: resultCode(row.Result),
      resultUpdated: String(row["Result Updated"] || ""),
    };
  });

  const aiPickRecordRows = gradedHistory
    .map(historyPickFromRow)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(a.game || "").localeCompare(String(b.game || "")));

  const aiSelectorStatus = sport === "NFL"
    ? {
        ...(core.aiSelectorStatus || {}),
        message: enrichedCurrentPicks.length
          ? "NFL EZPZ Picks live: Model Plays require HOT Last-7 and -150 or better. Trend Plays qualify directly as Public Fade (fade an 80%+ bet side), Strong RLM, or Sharp (money 25+ points over bets)."
          : "No NFL EZPZ Picks qualify right now. Trend Plays qualify directly as Public Fade, Strong RLM, or Sharp.",
        selectedCount: enrichedCurrentPicks.length,
      }
    : core.aiSelectorStatus;

  return {
    ...core,
    aiPicks: enrichedCurrentPicks,
    aiPickRecordRows,
    aiSelectorStatus,
  };
}
