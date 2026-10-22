import type { ScoresAndOddsMarketSplit } from "./scoresAndOddsBettingSplits";
import type { TursoRow } from "./tursoStore";

export const NBA_MARKET_POLICY = "nba-scoresandodds-v1";
export const NBA_MARKET_SOURCE = "ScoresAndOdds";
export const NBA_ASSUMED_ODDS = "-110";
export type NbaGame = {
  gameId: string; date: string; tipoff: string; away: string; home: string;
  awayId: string; homeId: string; status: string; completed: boolean;
  awayScore: number | null; homeScore: number | null; aliases: { away: string[]; home: string[] };
};
export const nbaDate = (now = Date.now()) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date(now));
export const nbaTeamKey = (name: string) => name.toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/\b(l\.?a\.?)\b/g, "los angeles")
  .replace(/[^a-z0-9]+/g, " ").trim();
export const nbaRowKey = (row: TursoRow) => [row.Date, row["Game Key"], row.Market, row.Selection].join("|");
const finite = (value: unknown) => value !== "" && value != null && Number.isFinite(Number(value)) ? Number(value) : null;

export function normalizeNbaSlate(payload: any, date: string): NbaGame[] {
  if (!Array.isArray(payload?.events)) throw new Error("ESPN NBA slate is missing events.");
  const games: NbaGame[] = [];
  for (const event of payload.events) {
    if (Number(event?.season?.type) !== 2) continue;
    if (!Array.isArray(event.competitions) || event.competitions.length !== 1) throw new Error("Malformed NBA competition.");
    const competition = event.competitions[0];
    const competitors = competition.competitors || [];
    const away = competitors.find((p: any) => p.homeAway === "away");
    const home = competitors.find((p: any) => p.homeAway === "home");
    const tipoff = String(competition.date || event.date || ""), start = Date.parse(tipoff);
    if (competitors.length !== 2 || !away?.team?.id || !home?.team?.id || !Number.isFinite(start)
      || nbaDate(start) !== date || !/^\d+$/.test(String(event.id)) || String(away.team.id) === String(home.team.id)) {
      throw new Error("NBA schedule identity or Eastern date is invalid.");
    }
    const status = competition.status?.type || event.status?.type;
    if (!status?.name || !["pre", "in", "post"].includes(status.state)) throw new Error("NBA game status is missing.");
    const aliases = (team: any) => [team.displayName, team.shortDisplayName, team.location, team.abbreviation,
      team.name, team.nickname, team.slug, team.id === "20" ? "Philadelphia" : ""].filter(Boolean).map(String);
    const completed = status.completed === true;
    const aScore = completed ? finite(typeof away.score === "object" ? away.score.value : away.score) : null;
    const hScore = completed ? finite(typeof home.score === "object" ? home.score.value : home.score) : null;
    if (completed && (status.name !== "STATUS_FINAL" || aScore == null || hScore == null || aScore <= 0 || hScore <= 0 || aScore === hScore)) {
      throw new Error("Invalid final NBA scores.");
    }
    // Unknown start times remain visible but cannot acquire market locks.
    games.push({ gameId: String(event.id), date, tipoff,
      away: String(away.team.displayName), home: String(home.team.displayName),
      awayId: String(away.team.id), homeId: String(home.team.id),
      status: competition.timeValid !== true && event.timeValid !== true ? "UNKNOWN_TIME" : status.name,
      completed, awayScore: aScore, homeScore: hScore,
      aliases: { away: aliases(away.team), home: aliases(home.team) } });
  }
  if (new Set(games.map(g => g.gameId)).size !== games.length) throw new Error("Duplicate NBA games.");
  return games.sort((a, b) => Date.parse(a.tipoff) - Date.parse(b.tipoff));
}

export function bindNbaSplits(splits: ScoresAndOddsMarketSplit[], games: NbaGame[], now = Date.now()) {
  const rows: TursoRow[] = [], missing: string[] = [], errors: string[] = [];
  for (const game of games.filter(g => g.status === "STATUS_SCHEDULED" && Date.parse(g.tipoff) > now)) {
    const matches = (value: string, side: "away" | "home") => game.aliases[side].some(alias => nbaTeamKey(alias) === nbaTeamKey(value));
    const candidates = splits.filter(split => (!split.date || split.date === game.date)
      && matches(split.awayTeam, "away") && matches(split.homeTeam, "home")
      && (split.market === "Spread" || split.market === "Total"));
    const selected = new Map<string, ScoresAndOddsMarketSplit>();
    let conflict = false;
    for (const split of candidates) {
      const side = split.market === "Total" ? split.side : matches(split.selectionTeam, "away") ? "away" : matches(split.selectionTeam, "home") ? "home" : "";
      if (!side) continue;
      const key = `${split.market}|${side}`, previous = selected.get(key);
      if (previous && (previous.line !== split.line || previous.betsPct !== split.betsPct || previous.moneyPct !== split.moneyPct)) conflict = true;
      selected.set(key, split);
    }
    const quartet = [selected.get("Spread|away"), selected.get("Spread|home"), selected.get("Total|Over"), selected.get("Total|Under")];
    const label = `${game.away} @ ${game.home}`;
    if (conflict || quartet.some(s => !s || s.line == null || !Number.isFinite(s.line)
      || !Number.isFinite(s.betsPct) || !Number.isFinite(s.moneyPct) || s.betsPct < 0 || s.betsPct > 100 || s.moneyPct < 0 || s.moneyPct > 100)) {
      missing.push(label); if (candidates.length) errors.push(`${label}: incomplete or conflicting market sides`); continue;
    }
    const [a, h, over, under] = quartet as ScoresAndOddsMarketSplit[];
    if (Math.abs(a.line! + h.line!) > 0.001 || over.line! <= 0 || Math.abs(over.line! - under.line!) > 0.001
      || [[a,h],[over,under]].some(pair => Math.abs(pair[0].betsPct + pair[1].betsPct - 100) > 2 || Math.abs(pair[0].moneyPct + pair[1].moneyPct - 100) > 2)) {
      missing.push(label); errors.push(`${label}: inconsistent lines or percentages`); continue;
    }
    for (let i = 0; i < quartet.length; i++) {
      const split = quartet[i]!;
      rows.push({ Date: game.date, "Game ID": game.gameId, "Game Key": `${game.date}|nba|${game.gameId}`,
        "Game Time": game.tipoff, Game: label, "Away Team": game.away, "Home Team": game.home,
        "Away Team ID": game.awayId, "Home Team ID": game.homeId,
        Market: split.market, Selection: i === 0 ? game.away : i === 1 ? game.home : split.side,
        Side: split.side, Line: String(split.line), Odds: NBA_ASSUMED_ODDS,
        "Current Bets %": String(split.betsPct), "Current Handle %": String(split.moneyPct),
        "Public Gap %": String(split.moneyPct - split.betsPct), "Updated At": new Date(now).toISOString(),
        "Snapshot Status": "LIVE", Source: NBA_MARKET_SOURCE, "Source URL": split.sourceUrl,
        "Market Policy": NBA_MARKET_POLICY, "Odds Basis": "Assumed -110 spread/total prices" });
    }
  }
  return { rows, missing, errors };
}

export function advanceNbaMarkets(incoming: TursoRow[], previous: TursoRow[], now = Date.now()) {
  const prior = new Map(previous.map(row => [nbaRowKey(row), row]));
  const latest: TursoRow[] = [], history: TursoRow[] = [], finals: TursoRow[] = [];
  for (const row of incoming) {
    const old = prior.get(nbaRowKey(row));
    if (old?.["Snapshot Status"] === "FINAL_PREGAME") continue;
    const lead = (Date.parse(row["Game Time"]) - now) / 60_000;
    if (lead < 10) continue; // Never manufacture a missed final lock from late/in-game data.
    const status = lead <= 20 ? "FINAL_PREGAME" : "LIVE";
    let points: any[] = [];
    if (old?.["Details JSON"]) {
      const parsed = JSON.parse(old["Details JSON"]);
      if (!Array.isArray(parsed.movementHistory)) throw new Error("NBA movement history is malformed.");
      points = parsed.movementHistory;
    }
    const point = { snapshotTime: new Date(now).toISOString(), line: Number(row.Line), odds: NBA_ASSUMED_ODDS,
      betsPct: Number(row["Current Bets %"]), moneyPct: Number(row["Current Handle %"]) };
    const last = points.at(-1);
    const changed = !last || ["line","betsPct","moneyPct"].some(k => last[k] !== (point as any)[k]);
    if (changed || status === "FINAL_PREGAME") points = [...points, point];
    const next = { ...row, "Opening Line": old?.["Opening Line"] ?? row.Line,
      "Opening Odds": NBA_ASSUMED_ODDS, "Opening Bets %": old?.["Opening Bets %"] ?? row["Current Bets %"],
      "Opening Handle %": old?.["Opening Handle %"] ?? row["Current Handle %"],
      "First Tracked At": old?.["First Tracked At"] || point.snapshotTime,
      "Bets Change %": String(Number(row["Current Bets %"]) - Number(old?.["Opening Bets %"] ?? row["Current Bets %"])),
      "Handle Change %": String(Number(row["Current Handle %"]) - Number(old?.["Opening Handle %"] ?? row["Current Handle %"])),
      "Snapshot Status": status, "Frozen At": status === "FINAL_PREGAME" ? point.snapshotTime : "",
      "Details JSON": JSON.stringify({ movementHistory: points, policy: NBA_MARKET_POLICY }) };
    latest.push(next);
    if (changed || status === "FINAL_PREGAME") history.push({ ...next, "Snapshot Time ET": point.snapshotTime,
      "Bets %": row["Current Bets %"], "Handle %": row["Current Handle %"] });
    if (status === "FINAL_PREGAME") finals.push({ ...next, "Snapshot Time ET": point.snapshotTime });
  }
  return { latest, history, finals };
}

export function settleNbaForecast(selected: any, game: any, gameId: string, lockedAt: string) {
  const pending = { spreadResult: "PENDING", totalResult: "PENDING" };
  if (!game?.completed || game.status !== "STATUS_FINAL") return pending;
  if (![lockedAt, game.tipoff, game.source?.observed_at].every(value => Number.isFinite(Date.parse(value)))
    || game.game_id !== gameId || game.away?.name !== selected.away_team || game.home?.name !== selected.home_team
    || Date.parse(lockedAt) >= Date.parse(game.tipoff) || Date.parse(game.source?.observed_at) <= Date.parse(game.tipoff)) {
    return { spreadResult: "EXCLUDED", totalResult: "EXCLUDED" };
  }
  const grade = (edge: number | null, actual: number) => edge == null ? "NO LINE" : edge === 0 ? "PASS"
    : Math.abs(actual) < 1e-9 ? "PUSH" : edge * actual > 0 ? "WIN" : "LOSS";
  const margin = Number(game.home.score)-Number(game.away.score), total = Number(game.home.score)+Number(game.away.score);
  return { spreadResult: grade(selected.home_spread_edge ?? null, margin + Number(selected.market?.home_spread || 0)),
    totalResult: grade(selected.total_edge ?? null, total - Number(selected.market?.total || 0)) };
}
