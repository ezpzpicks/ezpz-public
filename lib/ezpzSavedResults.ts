import { readTursoDatasetByDateKeys } from "./tursoStore";
import { normalizeMcpPick, MCP_SPORTS, type McpSport } from "./ezpzMcpPicks";
import { TEAM_TREND_TEST_TAB } from "./footballTeamTrendPlays";

export const EZPZ_RESULT_SPORTS = MCP_SPORTS;
type Row = Record<string, any>;
type Category = "public_bet_trend" | "team_trend";

function resultCode(value: unknown): "W" | "L" | "P" | null {
  const text = String(value ?? "").trim().toUpperCase();
  if (["W", "WIN", "WON"].includes(text)) return "W";
  if (["L", "LOSS", "LOST"].includes(text)) return "L";
  if (["P", "PUSH"].includes(text)) return "P";
  return null;
}

/** Read captured decisions and their stored grades; never collect, select or settle. */
export function savedResultFromRow(sport: McpSport, row: Row, category: Category) {
  let details: Row = {};
  try {
    const parsed = JSON.parse(String(row["Details JSON"] || "{}"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) details = parsed;
  } catch { return null; }
  const raw: Row = {
    ...details,
    date: row.Date || details.date,
    game: row.Game || details.game,
    market: row.Market || details.market,
    selection: row.Selection || details.selection || row.Play || details.play,
    gameTime: row["Game Time"] || details.gameTime,
    source: row.Source || details.source,
    snapshotStatus: row["Snapshot Status"] || details.snapshotStatus,
    line: row.Line !== undefined && row.Line !== "" ? row.Line : details.line,
    savedAt: row["Saved At"] || details.savedAt,
    pickCategory: category,
  };
  // The MLB daily ledger contains only the durable selected Trend v2 decisions.
  if (sport === "MLB") {
    if (!(row["Candidate ID"] || details.candidateId)) return null;
    raw.selected = details.selected ?? true;
    raw.protectionStatus = details.protectionStatus || "PASSED";
    raw.snapshotStatus = details.snapshotStatus || "FINAL_PREGAME";
    raw.lockedAt = row["Locked At"] || details.lockedAt;
    raw.source = "Trend Play";
  } else if (category === "public_bet_trend") {
    // Model/prop history shares this ledger but is outside the EZPZ trend recap.
    if (!/trend/i.test(String(raw.source || "")) || row.Player || details.playerName) return null;
  } else {
    // Team decisions retain numeric lines for the existing captured-pick validator.
    if (raw.line !== undefined && raw.line !== "") raw.line = Number(raw.line);
  }
  const pick = normalizeMcpPick(sport, raw);
  if (!pick || pick.snapshotStatus !== "FINAL_PREGAME") return null;
  const result = resultCode(row.Result ?? details.result);
  return {
    pickId: pick.pickId, sport, date: pick.date, gameTime: pick.gameTime,
    game: pick.game, market: pick.market, selection: pick.selection, line: pick.line,
    pickCategory: category, pickLabel: pick.pickLabel,
    result, settlementStatus: result ? "SETTLED" as const : "PENDING" as const,
    resultUpdated: String(row["Result Updated"] || details.resultUpdated || ""),
    finalizedAt: pick.finalizedAt,
  };
}

export async function readSavedEzpzResults(sport: McpSport, date: string) {
  const publicDataset = sport === "MLB" ? "trend_v2_daily_picks" : "ezpz_pick_history";
  const sources: Array<[string, Category]> = [[publicDataset, "public_bet_trend"]];
  if (sport !== "MLB") sources.push([TEAM_TREND_TEST_TAB, "team_trend"]);
  const groups = await Promise.all(sources.map(async ([dataset, category]) => {
    const rows = await readTursoDatasetByDateKeys(sport, dataset, [date]);
    return rows.map(row => savedResultFromRow(sport, row, category))
      .filter((pick): pick is NonNullable<typeof pick> => Boolean(pick && pick.date === date));
  }));
  const unique = new Map<string, NonNullable<ReturnType<typeof savedResultFromRow>>>();
  for (const pick of groups.flat()) {
    const key = JSON.stringify([pick.pickCategory, pick.game, pick.market, pick.selection, pick.line]);
    const prior = unique.get(key);
    if (prior && prior.result !== pick.result) throw new Error("Conflicting saved results; recap verification is required.");
    unique.set(key, pick);
  }
  return [...unique.values()].sort((a, b) => a.gameTime.localeCompare(b.gameTime)
    || a.game.localeCompare(b.game) || a.pickCategory.localeCompare(b.pickCategory) || a.market.localeCompare(b.market));
}
