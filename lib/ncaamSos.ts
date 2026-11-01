import { readTursoDatasetByDateKeys } from "./tursoStore";
import { saveNcaamMarketRows } from "./ncaamMarketStore";
import { ncaamTeamKey } from "./ncaamMarketCore";
import type { FootballSosSnapshot } from "./footballSos";

export const NCAAM_SOS_TAB = "ncaam_warrennolan_snapshots";
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&amp;|&#38;/g, "&")
  .replace(/&nbsp;|&#160;/g, " ").replace(/&#0*39;|&apos;/g, "'").replace(/\s+/g, " ").trim();
function rows(html: string, header: RegExp) {
  const table = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map(m => m[1]).find(t => header.test(text(t)));
  if (!table) throw new Error("Warren Nolan NCAAM table is unavailable.");
  return [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map(m => [...m[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(c => text(c[1]))).filter(r => r.length >= 5);
}
/** Basketball has current RPI SOS and separate team ELO, not football ELO SOS. */
export function parseNcaamWarrenNolan(eloHtml: string, sosHtml: string, season: number, fetchedAt: string): FootballSosSnapshot {
  const elo = new Map(rows(eloHtml, /Team\s+Record\s+ELO\s+Rank/i).map(r => [ncaamTeamKey(r[0]), Number(r[2].replaceAll(",", ""))]));
  const teams = rows(sosHtml, /Team\s+SOS\s+Rank\s+Opp\s+Record/i).map(r => ({ team: r[0], key: ncaamTeamKey(r[0]),
    rank: Number(r[2]), elo: elo.get(ncaamTeamKey(r[0]))!, opponentRecord: r[3], opponentWinPct: Number(r[4]), sos: Number(r[1]) }));
  if (teams.length < 300 || new Set(teams.map(t => t.key)).size !== teams.length || teams.some(t => !t.key
    || !Number.isInteger(t.rank) || t.rank < 1 || t.rank > 400 || !Number.isFinite(t.elo) || t.elo <= 0
    || !Number.isFinite(t.opponentWinPct) || t.opponentWinPct < 0 || t.opponentWinPct > 1
    || !Number.isFinite(t.sos) || t.sos < 0 || t.sos > 1)) throw new Error("Incomplete or ambiguous Warren Nolan NCAAM ratings.");
  return { season, fetchedAt, sourceUrl: `https://www.warrennolan.com/basketball/${season}/sos-rpi`, teams };
}
export function ncaamSosForTeam(snapshot: FootballSosSnapshot | null, team: string, asOf: number) {
  const observed = Date.parse(snapshot?.fetchedAt || "");
  if (!snapshot || !Number.isFinite(observed) || observed > asOf || asOf - observed > 86_400_000) return null;
  const key = ncaamTeamKey(team);
  const matches = snapshot.teams.filter(t => t.key === key || key.startsWith(t.key + " "));
  const found = matches.length === 1 ? matches[0] : null;
  return found;
}
export async function loadNcaamSos(season: number, refresh = false, now = Date.now()): Promise<FootballSosSnapshot | null> {
  const saved = await readTursoDatasetByDateKeys("NCAAM", NCAAM_SOS_TAB, [`season-${season}`]);
  const parsed = saved[0] ? JSON.parse(saved[0]["Details JSON"]) as FootballSosSnapshot : null;
  const snapshot = parsed?.season === season && Array.isArray(parsed.teams) && parsed.teams.length >= 300 ? parsed : null;
  const age = now - Date.parse(snapshot?.fetchedAt || "");
  if (!refresh || (snapshot && age >= 0 && age < 6 * 3_600_000)) return snapshot;
  try {
    const urls = ["elo", "sos-rpi"].map(path => `https://www.warrennolan.com/basketball/${season}/${path}`);
    const html = await Promise.all(urls.map(async url => {
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12_000), headers: { "User-Agent": "Mozilla/5.0" } });
      if (!response.ok) throw new Error(`Warren Nolan NCAAM HTTP ${response.status}`);
      return response.text();
    }));
    const value = parseNcaamWarrenNolan(html[0], html[1], season, new Date().toISOString());
    await saveNcaamMarketRows(NCAAM_SOS_TAB, [{ Date: `season-${season}`, "Game Key": `warrennolan|${season}`, Market: "Ratings", Selection: "NCAAM",
      "Details JSON": JSON.stringify(value), "Source URL": value.sourceUrl, "ELO Source URL": urls[0], "SOS Metric": "Current RPI SOS" }]);
    return value;
  } catch (error) { console.warn("NCAAM Warren Nolan refresh unavailable", error instanceof Error ? error.message : String(error)); return snapshot; }
}
