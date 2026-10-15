import { footballTeamGameKey, footballTeamKey, footballTeamPair } from "./footballTeamTrends";
import { upsertSportRows, type FootballSport, type SheetRow } from "./sportSheets";

export const TEAM_SEASON_HISTORY_TAB = "team_season_history";
const HEADERS = ["Date", "Game ID", "Game", "Away Team", "Home Team", "Away Score", "Home Score",
  "Completed", "Neutral Site", "Home Spread", "Total", "Odds", "History Source", "History URL", "History Checked At"];
const SOURCE = "ESPN completed-game closing lines";
const RETRY_AFTER_MS = 6 * 60 * 60 * 1000;
const MAX_GAMES_PER_REFRESH = 24;

function num(value: unknown): number | null {
  if (value == null || String(value).trim() === "") return null;
  const n = Number(String(value).replace(/^[ou]/i, "").replace(/[−–—]/g, "-"));
  return Number.isFinite(n) ? n : null;
}

function gameDate(row: Record<string, any>) {
  return String(row.Date || row.date || row["Game Date"] || "").slice(0, 10);
}

function seasonStart(date: string) {
  return `${Number(date.slice(0, 4)) - (Number(date.slice(5, 7)) < 7 ? 1 : 0)}-07-01`;
}

function closingLines(quote: Record<string, any>) {
  // ESPN's generic spread can be the favorite's line, even when it is away.
  // Prefer the explicitly signed home closing line; never infer its sign from price.
  let homeSpread = num(quote.pointSpread?.home?.close?.line);
  if (homeSpread == null) {
    const spread = num(quote.spread);
    if (spread === 0) homeSpread = 0;
    else if (spread != null && quote.homeTeamOdds?.favorite === true) homeSpread = -Math.abs(spread);
    else if (spread != null && quote.awayTeamOdds?.favorite === true) homeSpread = Math.abs(spread);
  }
  const total = num(quote.total?.over?.close?.line) ?? num(quote.total?.under?.close?.line) ?? num(quote.overUnder);
  return { homeSpread, total: total != null && total > 0 ? total : null };
}

/** Accept only the requested physical game, with completed final scores. */
export function parseEspnTeamSeasonGame(payload: any, sport: FootballSport, expected: SheetRow, now = Date.now()): SheetRow | null {
  const header = payload?.header;
  const competition = header?.competitions?.[0];
  if (String(header?.id || "") !== String(expected["Game ID"] || "") || competition?.status?.type?.completed !== true) return null;
  const entries = Array.isArray(competition.competitors) ? competition.competitors : [];
  const away = entries.find((e: any) => e.homeAway === "away"), home = entries.find((e: any) => e.homeAway === "home");
  const a = num(away?.score), h = num(home?.score);
  if (a == null || h == null || a < 0 || h < 0) return null;
  const stamp = Date.parse(String(competition.date || ""));
  if (!Number.isFinite(stamp) || stamp >= now) return null;
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(stamp));
  const name = (e: any) => String((sport === "NCAAF" ? e?.team?.location : e?.team?.displayName) || e?.team?.displayName || "");
  const row: SheetRow = { Date: date, "Game ID": String(header.id), "Away Team": name(away), "Home Team": name(home),
    Game: `${name(away)} @ ${name(home)}`, "Away Score": String(a), "Home Score": String(h), Completed: "TRUE",
    "Neutral Site": competition.neutralSite ? "TRUE" : "FALSE" };
  if (footballTeamGameKey(row, sport) !== footballTeamGameKey(expected, sport)) return null;
  const quotes = (Array.isArray(payload.pickcenter) ? payload.pickcenter : [])
    .map((quote: any) => ({ ...closingLines(quote), priority: num(quote.provider?.priority) ?? 999 }))
    .sort((a: any, b: any) => a.priority - b.priority);
  const quote = quotes.find((q: any) => q.homeSpread != null && q.total != null) || quotes.find((q: any) => q.homeSpread != null || q.total != null);
  return { ...row, "Home Spread": quote?.homeSpread == null ? "" : String(quote.homeSpread), Total: quote?.total == null ? "" : String(quote.total),
    Odds: "-110", "History Source": SOURCE,
    "History URL": `https://site.api.espn.com/apis/site/v2/sports/football/${sport === "NFL" ? "nfl" : "college-football"}/summary?event=${header.id}`,
    "History Checked At": new Date(now).toISOString() };
}

/** Refresh only in the existing snapshot job. Public page reads never fetch summaries. */
export async function refreshFootballTeamSeasonHistory(
  sport: FootballSport, schedule: SheetRow[], picks: Record<string, any>[], existing: SheetRow[], now = Date.now(),
): Promise<SheetRow[]> {
  const targets = picks.flatMap((pick, priority) => (footballTeamPair(pick) || []).map(team => ({ team: footballTeamKey(team, sport), before: gameDate(pick), priority })));
  const cached = new Map(existing.map(row => [footballTeamGameKey(row, sport), row]));
  const candidates = new Map<string, { row: SheetRow; priority: number }>();
  for (const row of schedule) {
    const date = gameDate(row), pair = footballTeamPair(row);
    if (!pair || !/^\d{8,12}$/.test(String(row["Game ID"] || "")) || !date) continue;
    if (/^(false|no|0)$/i.test(String(row.Completed || "")) || num(row["Away Score"]) == null || num(row["Home Score"]) == null) continue;
    const target = targets.find(t => date >= seasonStart(t.before) && date < t.before && pair.some(team => footballTeamKey(team, sport) === t.team));
    if (!target) continue;
    const key = footballTeamGameKey(row, sport), old = cached.get(key);
    if (old?.["History Source"] === SOURCE) {
      if (num(old.Total) != null && num(old["Home Spread"]) != null) continue;
      if (now - Date.parse(old["History Checked At"] || "") < RETRY_AFTER_MS) continue;
    }
    candidates.set(key, { row, priority: target.priority });
  }
  const pending = [...candidates.values()].sort((a, b) => a.priority - b.priority || gameDate(a.row).localeCompare(gameDate(b.row)))
    .slice(0, MAX_GAMES_PER_REFRESH).map(candidate => candidate.row);
  const fresh: SheetRow[] = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < pending.length) {
      const expected = pending[cursor++];
      const url = `https://site.api.espn.com/apis/site/v2/sports/football/${sport === "NFL" ? "nfl" : "college-football"}/summary?event=${expected["Game ID"]}`;
      try {
        const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const row = parseEspnTeamSeasonGame(await response.json(), sport, expected, now);
        if (row) fresh.push(row);
      } catch (error) {
        console.warn(`${sport} team season history ${expected["Game ID"]}: ${error instanceof Error ? error.message : "fetch failed"}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, worker));
  if (fresh.length) {
    await upsertSportRows(sport, TEAM_SEASON_HISTORY_TAB, HEADERS, fresh, row => footballTeamGameKey(row, sport));
    fresh.forEach(row => cached.set(footballTeamGameKey(row, sport), row));
  }
  return [...cached.values()];
}
