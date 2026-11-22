import { nflTrendGameIdentity } from "./nflTrendIdentity";

type Row = Record<string, string>;
const SPREAD = "nfl-independent-spread-v1-2026-11-22";
const TOTAL = "nfl-total-tree4-unit-agreement-v1-2026-11-22";
export type NflPendingGame = {
  id: string; game: string; gameTime: string; market: "Spread" | "Total";
  pick: string; grade: string; projection: number; line: number; edge: number;
  builtAt: string; quoteObservedAt: string;
};
function number(value: unknown) {
  if (value == null || String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function component(raw: string) {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
  } catch { return {}; }
}
function identity(row: Row) {
  return nflTrendGameIdentity({ ...row, Game: row.Game || `${row["Away Team"]} @ ${row["Home Team"]}` });
}
function equal(a: unknown, b: unknown) {
  const x = number(a), y = number(b);
  return x != null && y != null && Math.abs(x - y) < 1e-6;
}

/** Publish only saved current-model qualifiers; finalization withdraws the whole preview. */
export function buildNflPendingGames(previews: Row[], slate: Row[], date: string, now = Date.now()): NflPendingGame[] {
  const finalized = new Set(slate.filter(row => row.Date === date && row["Build Phase"] !== "early"
    && (row["Build Phase"] === "pregame" || row["Model Version"] || row["Projected Away"])).map(identity));
  const unique = new Map<string, NflPendingGame>();
  for (const row of previews) {
    const kickoff = Date.parse(row["Game Time"]), built = Date.parse(row["Build At"]);
    const homeLine = number(row["Market Home Spread"]), totalLine = number(row["Market Total"]);
    if (row.Date !== date || row["Build Phase"] !== "early" || !row.Game
      || !Number.isFinite(kickoff) || kickoff <= now || !Number.isFinite(built) || built > now + 60_000
      || homeLine == null || totalLine == null || totalLine <= 0
      || finalized.has(identity(row)) || row["Spread Model Version"] !== SPREAD || row["Total Model Version"] !== TOTAL) continue;
    for (const market of ["Spread", "Total"] as const) {
      const c = component(row[`${market} Model JSON`] || "");
      const version = market === "Spread" ? SPREAD : TOTAL;
      const edge = number(c.edge), saved = number(row[market === "Spread" ? "Market Home Spread" : "Market Total"]);
      const grade = row[`${market} Grade`], pick = row[`${market} Pick`];
      if (c.version !== version || c.ready !== true || edge == null || saved == null || !pick) continue;
      const featureTotal = number(c.features?.market_total_centered);
      if (!equal(c.features?.market_margin, -homeLine) || featureTotal == null || !equal(featureTotal + 45, totalLine)) continue;
      let projection: number, line: number;
      if (market === "Spread") {
        const margin = number(c.margin);
        if (grade !== "B Spread" || Math.abs(edge) < 3.5 || margin == null
          || !equal(c.features?.market_margin, -saved) || !equal(edge, margin + saved)) continue;
        line = edge >= 0 ? saved : -saved;
        projection = edge >= 0 ? -margin : margin;
      } else {
        const tree = number(c.tree_total), regression = number(c.regression_total), confirmation = number(c.regression_edge);
        if (tree == null || regression == null || confirmation == null || saved <= 0
          || grade !== (edge > 0 ? "Over" : "Under") || Math.abs(edge) < 4
          || c.agreement !== true || edge * confirmation <= 0
          || !equal(edge, tree - saved) || !equal(confirmation, regression - saved)) continue;
        line = saved; projection = tree;
      }
      const id = `${identity(row)}|${market}`;
      const play = { id, game: row.Game, gameTime: row["Game Time"], market, pick, grade,
        projection, line, edge: Math.abs(edge), builtAt: row["Build At"], quoteObservedAt: row["Quote Observed At"] || "" };
      if (!unique.has(id) || built >= Date.parse(unique.get(id)!.builtAt)) unique.set(id, play);
    }
  }
  return [...unique.values()].sort((a, b) => a.gameTime.localeCompare(b.gameTime) || a.game.localeCompare(b.game) || a.market.localeCompare(b.market));
}
