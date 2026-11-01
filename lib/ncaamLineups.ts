import { readTursoDatasetByDateKeys } from "./tursoStore";
import { saveNcaamMarketRows } from "./ncaamMarketStore";
import { mergeNbaLineups, type NbaGameLineup } from "./nbaLineupsCore";
import type { NcaamGame } from "./ncaamMarketCore";
import { NCAAM_LINEUP_SOURCE, parseNcaamLineupsHtml, validNcaamLineupSource } from "./ncaamLineupsSource";

export async function readNcaamSavedLineups(date: string): Promise<NbaGameLineup[]> {
  const rows = await readTursoDatasetByDateKeys("NCAAM", "lineup_snapshots", [date]);
  try {
    const values = JSON.parse(rows[0]?.["Details JSON"] || "[]");
    return Array.isArray(values) ? values.filter(l => l?.sport === "NCAAM" && l.date === date && /^\d+$/.test(l.gameId)
      && validNcaamLineupSource(l.sourceUrl) && Number.isFinite(Date.parse(l.observedAt)) && Number.isFinite(Date.parse(l.tipoff))
      && [l.away, l.home].every(t => t?.confirmed === false && Array.isArray(t.starters) && t.starters.length <= 5 && Array.isArray(t.injuries))) : [];
  } catch { return []; }
}

/** Existing 30m/5m collector only; public page reads never call providers. */
export async function refreshNcaamLineups(date: string, games: NcaamGame[], persist: boolean, now = Date.now()) {
  const previous = await readNcaamSavedLineups(date), upcoming = games.filter(g => g.status === "STATUS_SCHEDULED" && Date.parse(g.tipoff) > now);
  if (!upcoming.length) return { games: previous.length, changed: 0, delayed: false };
  try {
    const pages = [NCAAM_LINEUP_SOURCE], incoming: NbaGameLineup[] = [];
    for (let index = 0; index < Math.min(pages.length, 3); index++) {
      const response = await fetch(pages[index], { cache: "no-store", signal: AbortSignal.timeout(8_000), headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0" } });
      if (!response.ok || (response.url && !validNcaamLineupSource(response.url))) throw new Error(`College lineup source returned ${response.status}.`);
      const received = Date.now(), age = Number(response.headers.get("age") || 0), server = Date.parse(response.headers.get("date") || "");
      if (!Number.isFinite(age) || age < 0) throw new Error("Invalid college lineup source age.");
      const observed = Math.min(received - age * 1000, Number.isFinite(server) ? server : received);
      const parsed = parseNcaamLineupsHtml(await response.text(), upcoming, new Date(observed).toISOString(), pages[index]);
      incoming.push(...parsed.lineups);
      if (upcoming.every(g => incoming.some(l => l.gameId === g.gameId))) break;
      pages.push(...parsed.links.filter(link => !pages.includes(link)));
    }
    // Persist new observations even when names are unchanged: source freshness
    // controls whether availability may affect a forecast near tipoff.
    const lineups = mergeNbaLineups(previous, incoming);
    if (persist && incoming.length) await saveNcaamMarketRows("lineup_snapshots", [{ Date: date, "Game Key": `ncaam-lineups|${date}`,
      Market: "Lineups", Selection: "NCAAM", "Updated At": new Date().toISOString(), "Details JSON": JSON.stringify(lineups) }]);
    return { games: lineups.length, changed: incoming.length, delayed: incoming.length < upcoming.length };
  } catch (error) {
    console.warn("NCAAM lineup refresh delayed", error instanceof Error ? error.message : String(error));
    return { games: previous.length, changed: 0, delayed: true };
  }
}
