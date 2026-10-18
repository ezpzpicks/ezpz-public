import { footballTeamKey } from "./footballTeamTrends";
import { readSportWorksheet, upsertSportRows } from "./sportSheets";

export const FOOTBALL_SOS_TAB = "football_sos_snapshots";
const HEADERS = ["Season", "Fetched At", "Source URL", "Details JSON"];
export type FootballSosTeam = { team: string; key: string; rank: number; elo: number; opponentRecord: string; opponentWinPct: number };
export type FootballSosSnapshot = { season: number; fetchedAt: string; sourceUrl: string; teams: FootballSosTeam[] };

function text(html: string) {
  return html.replace(/<[^>]*>/g, " ").replace(/&(?:amp|#38);/g, "&").replace(/&nbsp;|&#160;/g, " ")
    .replace(/&#(?:0*39);|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
}

/** Read the current ELO SOS table, never the predicted/remaining schedule table. */
export function parseWarrenNolanSos(html: string, season: number, fetchedAt: string): FootballSosSnapshot {
  const table = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)]
    .map(match => match[1]).find(value => /ELO\s*SOS/i.test(text(value)) && /Opp.*Record/i.test(text(value)));
  if (!table) throw new Error("Warren Nolan current ELO SOS table was not found.");
  const teams: FootballSosTeam[] = [];
  for (const match of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(cell => text(cell[1]));
    if (cells.length < 5) continue;
    const [team, eloText, rankText, opponentRecord, pctText] = cells;
    const elo = Number(eloText.replace(/,/g, "")), rank = Number(rankText), opponentWinPct = Number(pctText);
    if (!team || !Number.isFinite(elo) || elo <= 0 || !Number.isInteger(rank) || rank < 1 || rank > 200
      || !Number.isFinite(opponentWinPct) || opponentWinPct < 0 || opponentWinPct > 1) continue;
    teams.push({ team, key: footballTeamKey(team, "NCAAF"), rank, elo, opponentRecord, opponentWinPct });
  }
  if (teams.length < 100 || new Set(teams.map(team => team.key)).size !== teams.length) {
    throw new Error("Warren Nolan SOS table is incomplete or has ambiguous team names.");
  }
  return { season, fetchedAt, sourceUrl: `https://www.warrennolan.com/fbs/${season}/sos-elo`, teams };
}

export function sosForTeam(snapshot: FootballSosSnapshot | null, team: string, asOf: number) {
  if (!snapshot) return null;
  const fetched = Date.parse(snapshot.fetchedAt);
  if (!Number.isFinite(fetched) || fetched > asOf || asOf - fetched > 24 * 60 * 60_000) return null;
  return snapshot.teams.find(row => row.key === footballTeamKey(team, "NCAAF")) || null;
}

/** Public reads use stored ratings; the existing background collector refreshes them. */
export async function loadFootballSos(season: number, refresh: boolean, now = Date.now()): Promise<FootballSosSnapshot | null> {
  let saved: FootballSosSnapshot | null = null;
  try {
    const rows = await readSportWorksheet("NCAAF", FOOTBALL_SOS_TAB, HEADERS);
    const row = rows.find(row => Number(row.Season) === season);
    const value = row ? JSON.parse(row["Details JSON"]) : null;
    if (value?.season === season && Array.isArray(value.teams) && value.teams.length >= 100 && value.fetchedAt) saved = value;
  } catch (error) { console.warn("CFB SOS snapshot read unavailable", error instanceof Error ? error.message : String(error)); }
  if (!refresh || (saved && now - Date.parse(saved.fetchedAt) < 6 * 60 * 60_000)) return saved;
  try {
    const response = await fetch(`https://www.warrennolan.com/fbs/${season}/sos-elo`, {
      signal: AbortSignal.timeout(10_000), cache: "no-store",
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!response.ok) throw new Error(`Warren Nolan HTTP ${response.status}`);
    const snapshot = parseWarrenNolanSos(await response.text(), season, new Date().toISOString());
    await upsertSportRows("NCAAF", FOOTBALL_SOS_TAB, HEADERS, [{ Season: String(season), "Fetched At": snapshot.fetchedAt,
      "Source URL": snapshot.sourceUrl, "Details JSON": JSON.stringify(snapshot) }], row => row.Season);
    return snapshot;
  } catch (error) {
    console.warn("CFB SOS refresh unavailable; retaining prior snapshot", error instanceof Error ? error.message : String(error));
    return saved;
  }
}
