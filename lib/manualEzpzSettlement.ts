import { isStandardOfficialMarket, OFFICIAL_TRACKING_BASIS } from "./officialTracking";
import type { ManualApprovedPick } from "./manualEzpzPicks";
import { footballTeamKey } from "./footballTeamTrends";
import { normalizeTexasAmAlias } from "./texasAmAlias";

type Sport = ManualApprovedPick["sport"];
export type ManualFinalTeam = { name: string; aliases?: string[]; score: number };
export type ManualFinal = {
  sport: Sport; date: string; gameId: string; gameTime: string;
  completed: boolean; status: string; away: ManualFinalTeam; home: ManualFinalTeam;
  observedAt: string; source: string;
};

const aliases: Record<string, string> = {
  fiu: "florida international", umass: "massachusetts", uconn: "connecticut", uab: "alabama birmingham",
  "miami oh": "miami ohio", "miami ohio": "miami ohio", "miami fl": "miami",
  "ul monroe": "louisiana monroe", "maryland eastern shore": "maryland eastern shore",
  "prairie view a and m": "prairie view", "texas a and m corpus christi": "texas a and m corpus christi",
};
const nflCities: Record<string, string> = {
  arizona: "ARI", atlanta: "ATL", baltimore: "BAL", buffalo: "BUF", carolina: "CAR", chicago: "CHI",
  cincinnati: "CIN", cleveland: "CLE", dallas: "DAL", denver: "DEN", detroit: "DET", "green bay": "GB",
  houston: "HOU", indianapolis: "IND", jacksonville: "JAX", "kansas city": "KC", "las vegas": "LV",
  miami: "MIA", minnesota: "MIN", "new england": "NE", "new orleans": "NO", philadelphia: "PHI",
  pittsburgh: "PIT", seattle: "SEA", "san francisco": "SF", "tampa bay": "TB", tennessee: "TEN", washington: "WAS",
};
export function manualTeamKey(name: string, sport: Sport) {
  const key = normalizeTexasAmAlias(name).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
  const alias = Object.keys(aliases).sort((a, b) => b.length - a.length)
    .find(name => key === name || key.startsWith(`${name} `));
  const normalized = sport === "NFL" ? nflCities[key] || key
    : alias ? aliases[alias] + key.slice(alias.length) : key;
  return sport === "MLB" ? normalized : footballTeamKey(normalized, sport).replace(/\bsaint\b/g, "st");
}
function matches(name: string, team: ManualFinalTeam, sport: Sport) {
  const key = manualTeamKey(name, sport);
  return Boolean(key) && [team.name, ...(team.aliases || [])].some(alias => {
    const candidate = manualTeamKey(alias, sport);
    return key === candidate || candidate.startsWith(`${key} `);
  });
}
function matchup(game: string) {
  const pair = game.split(/\s+(?:@|at|vs\.?|versus)\s+/i).map(s => s.trim());
  return pair.length === 2 && pair.every(Boolean) ? pair : null;
}
function validFinal(game: ManualFinal, now: number) {
  const start = Date.parse(game.gameTime), observed = Date.parse(game.observedAt);
  return game.completed === true && /^(?:STATUS_)?FINAL$/i.test(game.status)
    && /^\d+$/.test(game.gameId) && /ESPN/i.test(game.source)
    && Number.isFinite(start) && start < now && Number.isFinite(observed) && start <= observed && observed <= now
    && [game.away.score, game.home.score].every(score => Number.isSafeInteger(score) && score >= 0)
    && !(["NBA", "NCAAM", "NCAAF"].includes(game.sport) && game.away.score === game.home.score);
}

/** Only outcomes are attached; approval, line, selection and price are never rewritten. */
export function settleApprovedManualPick(pick: ManualApprovedPick, finals: ManualFinal[], now = Date.now()): ManualApprovedPick {
  if (pick.result && pick.result !== "PENDING") return pick;
  if (!(Date.parse(pick.gameTime) < now)) return pick;
  const pair = matchup(pick.game);
  if (!pair) return pick;
  const id = pick.id.match(/(?:^|_)(\d{9})(?:_|$)/)?.[1];
  let candidates = finals.filter(game => game.sport === pick.sport && game.date === pick.date && validFinal(game, now)
    && (!id || game.gameId === id) && Date.parse(pick.approvedAt) <= Date.parse(game.gameTime)
    && ((matches(pair[0], game.away, pick.sport) && matches(pair[1], game.home, pick.sport))
      !== (matches(pair[0], game.home, pick.sport) && matches(pair[1], game.away, pick.sport))));
  const ids = new Set(candidates.map(game => game.gameId));
  if (ids.size > 1) candidates = candidates.filter(game => Math.abs(Date.parse(game.gameTime) - Date.parse(pick.gameTime)) <= 15 * 60000);
  if (new Set(candidates.map(game => game.gameId)).size !== 1) return pick;
  candidates.sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));
  const game = candidates[0];
  if (!game || candidates.some(other => other.observedAt === game.observedAt
    && (other.away.name !== game.away.name || other.home.name !== game.home.name
      || other.away.score !== game.away.score || other.home.score !== game.home.score))) return pick;
  const selection = pick.selection.replace(/[−–]/g, "-").trim();
  let margin: number | null = null;
  const line = pick.line == null || String(pick.line).trim() === "" ? null : Number(pick.line);
  if (/^total$/i.test(pick.market)) {
    const match = selection.match(/^(over|under)\s+(\d+(?:\.\d+)?)$/i);
    if (!match || line == null || !Number.isFinite(line) || line !== Number(match[2])) return pick;
    margin = (game.away.score + game.home.score - line) * (/^over$/i.test(match[1]) ? 1 : -1);
  } else if (/^(?:spread|moneyline|money line|ml)$/i.test(pick.market)) {
    const spread = selection.match(/^(.+?)\s+([+-]?\d+(?:\.\d+)?)$/);
    const name = /^spread$/i.test(pick.market) ? spread?.[1] : selection.replace(/\s+(?:ML|moneyline)$/i, "");
    if (!name || (/^spread$/i.test(pick.market) && (!spread || line == null || !Number.isFinite(line) || line !== Number(spread[2])))) return pick;
    const away = matches(name, game.away, pick.sport), home = matches(name, game.home, pick.sport);
    if (away === home) return pick;
    margin = (away ? game.away.score - game.home.score : game.home.score - game.away.score)
      + (/^spread$/i.test(pick.market) ? line! : 0);
  }
  if (margin == null) return pick; // Player props require their own verified outcome source.
  const standard = isStandardOfficialMarket(pick.market);
  const odds = standard ? -110 : /^[+-]?\d{3,4}$/.test(String(pick.odds || "")) ? Number(pick.odds) : NaN;
  if (!Number.isFinite(odds) || Math.abs(odds) < 100) return pick;
  const result = margin > 0 ? "W" : margin < 0 ? "L" : "P";
  const netUnits = result === "W" ? odds > 0 ? odds / 100 : 100 / -odds : result === "L" ? -1 : 0;
  const originalAway = matches(pair[0], game.away, pick.sport) ? game.away : game.home;
  const originalHome = originalAway === game.away ? game.home : game.away;
  return { ...pick, result, netUnits, ...(standard ? { trackingOdds: -110, trackingBasis: OFFICIAL_TRACKING_BASIS } : {}), resultSource: game.source,
    resultUpdated: game.observedAt, resultGameId: game.gameId,
    finalScore: { away: originalAway.score, home: originalHome.score } };
}
