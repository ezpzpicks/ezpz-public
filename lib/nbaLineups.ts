import { readTursoDatasetByDateKeys } from "./tursoStore";
import { saveNbaMarketRows } from "./nbaMarketStore";
import { NBA_LINEUP_SOURCE, lineupFinal, mergeNbaLineups, type NbaLineupGame, type NbaGameLineup } from "./nbaLineupsCore";
import { parseNbaLineupsHtml } from "./nbaLineupsSource";

const DATASET = "lineup_snapshots";

/** A single date-indexed row for the whole slate, shared by every public card. */
export async function readNbaSavedLineups(date: string): Promise<NbaGameLineup[]> {
  const rows = await readTursoDatasetByDateKeys("NBA", DATASET, [date]);
  if (!rows.length) return [];
  try {
    const values = JSON.parse(rows[0]["Details JSON"] || "[]");
    return Array.isArray(values) ? values.filter(lineup => lineup.date === date && lineup.gameId && lineup.away?.starters?.length === 5
      && lineup.home?.starters?.length === 5 && Number.isFinite(Date.parse(lineup.observedAt))) : [];
  } catch { return []; }
}

export async function refreshNbaLineups(date: string, games: NbaLineupGame[], persist: boolean, now = Date.now()) {
  const previous = await readNbaSavedLineups(date);
  // Keep the existing scheduler's 30m/5m cadence. Public visits never scrape.
  const needed = games.some(game => Date.parse(game.tipoff) >= now - 8 * 60 * 60_000
    && (!lineupFinal(previous.find(lineup => lineup.gameId === game.gameId)) || Date.parse(game.tipoff) > now));
  if (!needed) return { games: previous.length, changed: 0, delayed: false };
  try {
    const response = await fetch(NBA_LINEUP_SOURCE, { cache: "no-store", signal: AbortSignal.timeout(8_000),
      headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0" } });
    if (!response.ok) throw new Error(`NBA lineup source returned ${response.status}.`);
    const incoming = parseNbaLineupsHtml(await response.text(), date, games, new Date(now).toISOString());
    const comparable = (lineup: NbaGameLineup) => JSON.stringify({ ...lineup, observedAt: "" });
    let changed = 0;
    const updates = incoming.map(lineup => {
      const old = previous.find(value => value.gameId === lineup.gameId);
      if (old && comparable(old) === comparable(lineup)) return old;
      changed++; return lineup;
    });
    const lineups = mergeNbaLineups(previous, updates);
    if (persist && changed) await saveNbaMarketRows(DATASET, [{ Date: date, "Game Key": `nba-lineups|${date}`,
      Market: "Lineups", Selection: "NBA", "Details JSON": JSON.stringify(lineups) }]);
    return { games: lineups.length, changed, delayed: incoming.length < games.length };
  } catch (error) {
    console.warn("NBA lineup refresh delayed; retaining saved lineups", error instanceof Error ? error.message : String(error));
    return { games: previous.length, changed: 0, delayed: true };
  }
}
