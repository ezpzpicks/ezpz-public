import { nflTrendTeamKey } from "./nflTrendIdentity";
import { isVerifiedNcaafTrendRecord } from "./ncaafTrendRecordPolicy";
import { COLLEGE_FOOTBALL_TEAMS } from "./collegeFootballTeamAliases";
import { nbaTeamKey } from "./nbaMarketCore";
import { normalizeTexasAmAlias } from "./texasAmAlias";

type Row = Record<string, any>;
type Sport = "NFL" | "NCAAF" | "NBA";
type Result = "W" | "L" | "P";
type Venue = "Home" | "Away" | "Neutral";
type Role = "Favorite" | "Underdog" | "Pick'em";
type Category = "betType" | "venue" | "recent";

export const FOOTBALL_TEAM_TREND_VERSION = "team-trends-2026-10-15-v2";
// Change the version when tuning weights; saved final picks keep their version.
export const FOOTBALL_TEAM_TREND_WEIGHTS = Object.freeze({ betType: 50, venue: 30, recent: 20 });

export type TeamTrendRecord = {
  label: string;
  wins: number;
  losses: number;
  pushes: number;
  record: string;
  sample: number;
  winPct: number | null;
  supportPct: number;
  weight: number;
  gameKeys: string[];
};

export type TeamTrendTeam = {
  team: string;
  venue: Venue;
  role: Role | null;
  opposing: boolean;
  score: number;
  hasData: boolean;
  trackedGames: number;
  seasonGames: number;
  missingGames: number;
  records: Record<Category, TeamTrendRecord>;
};

export type FootballTeamTrendScore = {
  version: string;
  weights: Record<Category, number>;
  score: number | null;
  teams: TeamTrendTeam[];
  capturedAt: string;
  asOfDate: string;
  mode: "preview" | "locked" | "replay";
  scope: "Tracked current-season games" | "Current-season games";
  method: "Raw hit rates";
};

type Game = {
  key: string;
  date: string;
  away: string;
  home: string;
  neutral: boolean;
  identityPriority: number;
  completed?: boolean;
  knownAt?: string;
  spread?: { homeLine: number; homeResult: Result; priority: number; stamp: string };
  total?: { overResult: Result; priority: number; stamp: string };
};

export type TeamTrendHistory = Map<string, Game>;

function text(value: unknown) {
  return normalizeTexasAmAlias(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[−–—]/g, "-").replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

const COLLEGE_ALIASES: Record<string, string> = {
  wku: "western kentucky", shsu: "sam houston", "sam houston state": "sam houston",
  "app state": "appalachian state", "app st": "appalachian state",
  fiu: "florida international", "florida intl": "florida international", fau: "florida atlantic",
  ucf: "central florida", usf: "south florida", usc: "southern california",
  lsu: "louisiana state", smu: "southern methodist", tcu: "texas christian",
  byu: "brigham young", utsa: "texas san antonio", utep: "texas el paso",
  unlv: "nevada las vegas", uconn: "connecticut", umass: "massachusetts",
  "nc state": "north carolina state", ecu: "east carolina", niu: "northern illinois",
  "ole miss": "mississippi", pitt: "pittsburgh", "southern miss": "southern mississippi",
  "miami fl": "miami", "miami oh": "miami ohio", "miami ohio": "miami ohio",
  mtsu: "middle tennessee", "middle tennessee state": "middle tennessee",
  "jax state": "jacksonville state", "la tech": "louisiana tech",
  "ul lafayette": "louisiana", "louisiana lafayette": "louisiana",
  "ul monroe": "louisiana monroe", ulm: "louisiana monroe",
  "san jose st": "san jose state", "sac state": "sacramento state",
};

function collegeKey(value: unknown) {
  const key = text(value).replace(/\buniversity\b/g, "").trim();
  return COLLEGE_ALIASES[key] || key.replace(/\bst$/g, "state");
}

const collegeNames = new Map<string, Set<string>>();
for (const [school, ...aliases] of COLLEGE_FOOTBALL_TEAMS) {
  const canonical = collegeKey(school);
  for (const name of [school, ...aliases]) {
    const alias = text(name);
    if (!alias) continue;
    const candidates = collegeNames.get(alias) || new Set<string>();
    candidates.add(canonical);
    collegeNames.set(alias, candidates);
  }
}

export function footballTeamKey(value: unknown, sport: Sport) {
  if (sport === "NBA") return nbaTeamKey(String(value || ""));
  if (sport === "NFL") return nflTrendTeamKey(value);
  const raw = text(value);
  if (COLLEGE_ALIASES[raw]) return COLLEGE_ALIASES[raw];
  const candidates = collegeNames.get(raw);
  return candidates?.size === 1 ? [...candidates][0] : collegeKey(value);
}
const teamKey = footballTeamKey;

function dateKey(value: unknown) {
  const raw = String(value ?? "");
  const iso = raw.match(/(20\d{2})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  const us = raw.match(/(\d{1,2})\/(\d{1,2})\/(20\d{2})/);
  return us ? `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}` : "";
}

export function footballTeamPair(row: Row): [string, string] | null {
  const away = String(row.awayTeam || row["Away Team"] || "").trim();
  const home = String(row.homeTeam || row["Home Team"] || "").trim();
  if (away && home) return [away, home];
  const parts = String(row.game || row.Game || "").split(/\s*(?:@|\bat\b|\bvs\.?\b|\bversus\b)\s*/i).filter(Boolean);
  return parts.length === 2 ? [parts[0].trim(), parts[1].trim()] : null;
}
const teams = footballTeamPair;

export function footballTeamGameKey(row: Row, sport: Sport) {
  const pair = teams(row), date = dateKey(row.date || row.Date || row["Game Date"]);
  return pair && date ? `${date}|${pair.map(t => teamKey(t, sport)).sort().join("|")}` : "";
}

function completedSchedule(row: Row) {
  if (/^(false|no|0)$/i.test(String(row.Completed ?? ""))) return false;
  const a = number(row["Away Score"]), h = number(row["Home Score"]);
  return a != null && h != null && (a + h > 0 || /^(true|yes|1)$/i.test(String(row.Completed ?? "")));
}

function number(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const n = Number(String(value).replace(/[−–—]/g, "-"));
  return Number.isFinite(n) ? n : null;
}

function lineFromSelection(value: unknown) {
  const match = String(value || "").replace(/[−–—]/g, "-").match(/(?:^|\s)([+-]?\d+(?:\.\d+)?)\s*$/);
  return match ? number(match[1]) : null;
}

function result(value: unknown): Result | null {
  const key = text(value);
  return ["w", "win", "won"].includes(key) ? "W" : ["l", "loss", "lost"].includes(key) ? "L" : ["p", "push"].includes(key) ? "P" : null;
}

function inverse(value: Result): Result { return value === "W" ? "L" : value === "L" ? "W" : "P"; }
function grade(margin: number): Result { return Math.abs(margin) < 0.001 ? "P" : margin > 0 ? "W" : "L"; }
function role(line: number): Role { return line < 0 ? "Favorite" : line > 0 ? "Underdog" : "Pick'em"; }

function neutral(row: Row) {
  return /^(true|yes|1)$/i.test(String(row.neutralSite ?? row["Neutral Site"] ?? row.Neutral ?? ""))
    || text(row.Venue || row.Location) === "neutral";
}

/** One observation per physical game/market, not one per trend or source alias. */
export function buildTeamTrendHistory(sport: Sport, trendRows: Row[] = [], trackerRows: Row[] = [], scheduleRows?: Row[], seasonRows: Row[] = []): TeamTrendHistory {
  const history: TeamTrendHistory = new Map();
  const schedule = new Map<string, Row>();
  for (const row of [...(scheduleRows || []), ...seasonRows]) {
    const pair = teams(row), date = dateKey(row.Date || row["Game Date"]);
    if (!pair || !date) continue;
    const away = teamKey(pair[0], sport), home = teamKey(pair[1], sport);
    const key = `${date}|${[away, home].sort().join("|")}`;
    schedule.set(key, row);
    const priority = row["History Source"] === "ESPN completed-game closing lines" ? 4 : 2;
    const game: Game = { ...history.get(key), key, date, away, home, neutral: neutral(row), identityPriority: priority,
      completed: completedSchedule(row) };
    if (sport === "NBA") game.knownAt = String(row["Result Updated"] || row["History Checked At"] || "");
    if (game.completed) {
      const a = number(row["Away Score"])!, h = number(row["Home Score"])!;
      const total = number(row.Total), homeLine = number(row["Home Spread"]);
      const stamp = String(row["History Checked At"] || "");
      if (total != null && total > 0) game.total = { overResult: grade(a + h - total), priority, stamp };
      if (homeLine != null) game.spread = { homeLine, homeResult: grade(h - a + homeLine), priority, stamp };
    }
    history.set(key, game);
  }
  const consume = (row: Row, verified: boolean) => {
    if (row.Player || row.playerName || row["Prop Market"]) return;
    const pair = teams(row), date = dateKey(row.date || row.Date);
    const market = text(row.market || row.Market || row["Bet Type"]);
    if (!pair || !date || !["spread", "total"].includes(market)) return;
    let away = teamKey(pair[0], sport), home = teamKey(pair[1], sport);
    if (!away || !home || away === home) return;
    const key = `${date}|${[away, home].sort().join("|")}`;
    const official = schedule.get(key);
    // Model tracker rows can contain a stale matchup skeleton. When the core
    // supplies its already-loaded schedule, require a real completed matchup.
    if (!verified && scheduleRows !== undefined) {
      if (!official || !completedSchedule(official)) return;
      const officialTeams = teams(official)!;
      away = teamKey(officialTeams[0], sport); home = teamKey(officialTeams[1], sport);
    }
    const priority = verified ? 3 : official ? 2 : 1;
    const previous = history.get(key);
    const game: Game = previous ? { ...previous } : { key, date, away, home, neutral: neutral(row), identityPriority: priority };
    if (game.away !== away || game.home !== home) {
      if (priority <= game.identityPriority) return;
      // A verified market can correct a model row's reversed home designation.
      game.away = away; game.home = home;
      if (game.spread) game.spread = { ...game.spread, homeLine: -game.spread.homeLine, homeResult: inverse(game.spread.homeResult) };
    }
    game.identityPriority = Math.max(priority, game.identityPriority);
    game.neutral ||= neutral(row);
    const selection = String(row["Public Split Selection"] || row.selection || row.Selection || row.Pick || row.Side || "");
    const selectedLine = lineFromSelection(selection);
    const line = verified ? number(row["Public Split Line"]) ?? number(row.Line) ?? selectedLine
      : selectedLine ?? number(row.Line);
    if (line == null) return;
    const awayScore = !verified && official ? number(official["Away Score"])
      : number(row["Actual Away Runs"] ?? row["Actual Away"] ?? row["Away Score"]);
    const homeScore = !verified && official ? number(official["Home Score"])
      : number(row["Actual Home Runs"] ?? row["Actual Home"] ?? row["Home Score"]);
    const recorded = result(row.Result || row.result || row.Status);
    if (!recorded && (awayScore == null || homeScore == null)) return;
    game.completed = true;
    if (sport === "NBA") game.knownAt = String(row["Result Updated"] || "");
    const stamp = String(row["Public Split Snapshot Time"] || row["Result Updated"] || "");
    if (market === "total") {
      const direction = text(selection || row.Side);
      if (!direction.startsWith("over") && !direction.startsWith("under")) return;
      const overResult = awayScore != null && homeScore != null ? grade(awayScore + homeScore - Math.abs(line))
        : direction.startsWith("under") ? inverse(recorded!) : recorded!;
      if (!game.total || priority > game.total.priority || (priority === game.total.priority && stamp > game.total.stamp)) {
        game.total = { overResult, priority, stamp };
      }
    } else {
      const selectedTeam = teamKey(selection.replace(/\s+[+-]?\d+(?:\.\d+)?\s*$/, ""), sport);
      if (selectedTeam !== away && selectedTeam !== home) return;
      const homeLine = selectedTeam === home ? line : -line;
      const homeResult = awayScore != null && homeScore != null ? grade(homeScore - awayScore + homeLine)
        : selectedTeam === home ? recorded! : inverse(recorded!);
      if (!game.spread || priority > game.spread.priority || (priority === game.spread.priority && stamp > game.spread.stamp)) {
        game.spread = { homeLine, homeResult, priority, stamp };
      }
    }
    history.set(key, game);
  };
  trackerRows.forEach(row => consume(row, false));
  trendRows.filter(isVerifiedNcaafTrendRecord).forEach(row => consume(row, true));
  return history;
}

function record(label: string, observations: Array<{ game: Game; result: Result }>, weight: number, opposing: boolean): TeamTrendRecord {
  const wins = observations.filter(g => g.result === "W").length;
  const losses = observations.filter(g => g.result === "L").length;
  const pushes = observations.filter(g => g.result === "P").length;
  const winPct = wins + losses ? 100 * wins / (wins + losses) : null;
  return { label, wins, losses, pushes, record: `${wins}-${losses}-${pushes}`, sample: observations.length,
    winPct, supportPct: winPct == null ? 50 : opposing ? 100 - winPct : winPct,
    weight, gameKeys: observations.map(g => g.game.key) };
}

export function isSavedTeamTrendScore(value: unknown): value is FootballTeamTrendScore {
  const v = value as FootballTeamTrendScore | undefined;
  return Boolean(v && typeof v.version === "string" && v.version.startsWith("team-trends-")
    && ["locked", "replay"].includes(v.mode) && Array.isArray(v.teams) && v.teams.length === 2);
}

/** Pure scoring: no Bayesian update, selection threshold, network call or write. */
export function scoreFootballTeamTrends(
  pick: Row, sport: Sport, history: TeamTrendHistory, now = Date.now(),
  options: { allowMissingSpreadLine?: boolean } = {},
): FootballTeamTrendScore | null {
  if (pick.playerName || !["spread", "total"].includes(text(pick.market))) return null;
  const pair = teams(pick), date = dateKey(pick.date);
  if (!pair || !date) return null;
  const spread = text(pick.market) === "spread";
  const direction = text(pick.side || pick.selection).startsWith("under") ? "Under" : "Over";
  const selected = teamKey(String(pick.selectionTeam || pick.selection || "").replace(/\s+[+-]?\d+(?:\.\d+)?\s*$/, ""), sport);
  const selectedLine = number(pick.line) ?? lineFromSelection(pick.selection);
  const keys = pair.map(t => teamKey(t, sport));
  if (spread && (!keys.includes(selected) || (selectedLine == null && !options.allowMissingSpreadLine))) return null;
  // Keep the scoring scope within a football season, including Jan/Feb playoffs.
  const year = Number(date.slice(0, 4)) - (Number(date.slice(5, 7)) < 7 ? 1 : 0);
  const seasonStart = `${year}-07-01`;
  const targetKey = `${date}|${[...keys].sort().join("|")}`;
  const targetNeutral = neutral(pick) || Boolean(history.get(targetKey)?.neutral);
  const scoredTeams: TeamTrendTeam[] = pair.map((team, index) => {
    const key = keys[index], venue: Venue = targetNeutral ? "Neutral" : index === 0 ? "Away" : "Home";
    const opposing = spread && key !== selected;
    const ownLine = spread && selectedLine != null ? (opposing ? -selectedLine : selectedLine) : null;
    const currentRole = ownLine == null ? null : role(ownLine);
    const seasonGames = [...history.values()].filter(g => g.date >= seasonStart && g.date < date && g.completed && (g.away === key || g.home === key)
      && (sport !== "NBA" || (Number.isFinite(Date.parse(g.knownAt || "")) && Date.parse(g.knownAt!) <= now)))
      .sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
    const observations = seasonGames
      .flatMap(game => {
        const ownHome = game.home === key;
        const own = spread ? game.spread && (ownHome ? game.spread.homeResult : inverse(game.spread.homeResult))
          : game.total && (direction === "Under" ? inverse(game.total.overResult) : game.total.overResult);
        return own ? [{ game, result: own }] : [];
      });
    const ownVenue = (g: Game): Venue => g.neutral ? "Neutral" : g.home === key ? "Home" : "Away";
    const ownRole = (g: Game) => g.spread ? role(g.home === key ? g.spread.homeLine : -g.spread.homeLine) : null;
    const marketLabel = spread ? "ATS" : direction;
    const weights = FOOTBALL_TEAM_TREND_WEIGHTS;
    const betType = record(spread ? currentRole ? `${currentRole} ATS` : "Overall ATS" : `Overall ${direction}`,
      spread && currentRole ? observations.filter(g => ownRole(g.game) === currentRole) : observations, weights.betType, opposing);
    const venueRecord = record(`${venue} ${marketLabel}`, observations.filter(g => ownVenue(g.game) === venue), weights.venue, opposing);
    const recentKeys = new Set(seasonGames.slice(-5).map(g => g.key));
    const recent = record(`Last 5 ${marketLabel}`, observations.filter(g => recentKeys.has(g.game.key)), weights.recent, opposing);
    const records = { betType, venue: venueRecord, recent };
    const score = Object.values(records).reduce((sum, r) => sum + r.weight * r.supportPct / 100, 0);
    return { team, venue, role: currentRole, opposing, score, hasData: observations.some(g => g.result !== "P"),
      trackedGames: observations.length, seasonGames: seasonGames.length, missingGames: seasonGames.length - observations.length, records };
  });
  const start = Date.parse(String(pick.gameTime || ""));
  const final = text(pick.snapshotStatus) === "final pregame";
  const mode = !final ? "preview" : Number.isFinite(start) && now < start ? "locked" : "replay";
  return { version: sport === "NBA" ? "team-trends-nba-2026-10-22-v1" : FOOTBALL_TEAM_TREND_VERSION, weights: { ...FOOTBALL_TEAM_TREND_WEIGHTS },
    // Signals may show season records before a spread is available. A role-free
    // record is context only and must never supply a qualifying grade.
    score: (!spread || selectedLine != null) && scoredTeams.every(t => t.hasData && !t.missingGames)
      ? scoredTeams.reduce((sum, t) => sum + t.score, 0) / 2 : null,
    teams: scoredTeams, capturedAt: new Date(now).toISOString(), asOfDate: date, mode,
    scope: sport === "NBA" ? "Tracked current-season games" : "Current-season games", method: "Raw hit rates" };
}

export function withFootballTeamTrends(pick: Row, sport: Sport, history: TeamTrendHistory, saved?: Row, now = Date.now()) {
  // Retain captured evidence and its weight version through settlement and later tuning.
  const captured = saved?.teamTrendScore ?? pick.teamTrendScore;
  const start = Date.parse(String(pick.gameTime || ""));
  if (isSavedTeamTrendScore(captured)
    && (!Number.isFinite(start) || now >= start || (captured.version === FOOTBALL_TEAM_TREND_VERSION
      && captured.score != null && captured.teams.every(t => !t.missingGames)))) return { ...pick, teamTrendScore: captured };
  const score = scoreFootballTeamTrends(pick, sport, history, now);
  return score ? { ...pick, teamTrendScore: score } : pick;
}
