import { nbaDate, nbaTeamKey, settleNbaForecast } from "./nbaMarketCore";

type Row = Record<string, any>;
export const NBA_MODEL_RECORD_POLICY = "nba-latest-pregame-ab-v1";
export type NbaRecordTotals = { wins: number; losses: number; pushes: number; pending: number; totalBets: number;
  record: string; winPct: number | null; unitsWon: number; roiPct: number | null };
export type NbaModelPlay = { id: string; date: string; gameId: string; game: string; gameTime: string;
  market: "Spread" | "Total"; selection: string; grade: string; line: number; odds: string;
  result: string; lockedAt: string; modelVersion: string };
type ModelDay = { totals: NbaRecordTotals; byType: Record<string, NbaRecordTotals> };
export type NbaModelRecordState = { version: string; days: Record<string, ModelDay>; recent: NbaModelPlay[] };
export type NbaModelRecords = { policy: string; overall: NbaRecordTotals; last7Days: NbaRecordTotals;
  byType: { label: string; overall: NbaRecordTotals; last7Days: NbaRecordTotals }[]; history: NbaModelPlay[];
  availableDates: string[] };
const round = (n: number) => Math.round(n * 100) / 100;
const code = (value: unknown) => ({ WIN: "W", LOSS: "L", PUSH: "P", W: "W", L: "L", P: "P" }[String(value).toUpperCase()] || "");
const number = (value: unknown) => value == null || String(value).trim() === "" || !Number.isFinite(Number(value)) ? null : Number(value);
export function nbaRecordTotals(rows: { result: string; odds?: string }[]): NbaRecordTotals {
  const wins = rows.filter(r => code(r.result) === "W").length, losses = rows.filter(r => code(r.result) === "L").length;
  const pushes = rows.filter(r => code(r.result) === "P").length, settled = wins + losses + pushes;
  const unitsWon = rows.reduce((sum, row) => {
    const odds = Number(row.odds || -110);
    return sum + (code(row.result) === "L" ? -1 : code(row.result) === "W" ? odds > 0 ? odds / 100 : 100 / Math.abs(odds) : 0);
  }, 0);
  return { wins, losses, pushes, pending: rows.length - settled, totalBets: settled, record: `${wins}-${losses}-${pushes}`,
    winPct: wins + losses ? round(wins / (wins + losses) * 100) : null, unitsWon: round(unitsWon),
    roiPct: settled ? round(unitsWon / settled * 100) : null };
}
function combine(rows: NbaRecordTotals[]): NbaRecordTotals {
  const sum = (key: "wins" | "losses" | "pushes" | "pending") => rows.reduce((n, r) => n + r[key], 0);
  const wins = sum("wins"), losses = sum("losses"), pushes = sum("pushes"), totalBets = wins + losses + pushes;
  // Model records all use -110. Recalculate from counts to avoid daily rounding drift.
  const units = wins * 100 / 110 - losses;
  return { wins, losses, pushes, totalBets, pending: sum("pending"), record: `${wins}-${losses}-${pushes}`,
    winPct: wins + losses ? round(wins / (wins + losses) * 100) : null, unitsWon: round(units),
    roiPct: totalBets ? round(units / totalBets * 100) : null };
}

/** One deterministic pre-tipoff forecast per physical game; results never decide which run wins. */
export function latestNbaForecasts(forecasts: Row[], now = Date.now()): Row[] {
  const games = new Map<string, Row>();
  for (const f of forecasts) {
    const lock = Date.parse(f.lockedAt), tipoff = Date.parse(f.tipoff);
    if (!f.gameId || !f.away_team || !f.home_team || !Number.isFinite(lock) || !Number.isFinite(tipoff) || lock >= tipoff || lock > now) continue;
    const key = `${nbaDate(tipoff)}|${f.gameId}`, old = games.get(key);
    const tieKey = (row: Row) => `${row.modelVersion || ""}|${row.recordId || ""}`;
    if (!old || lock > Date.parse(old.lockedAt) || (lock === Date.parse(old.lockedAt) && tieKey(f) > tieKey(old))) games.set(key, f);
  }
  return [...games.values()].sort((a, b) => Date.parse(a.tipoff) - Date.parse(b.tipoff));
}

export function nbaModelPlays(forecasts: Row[], schedule: Row[] = [], now = Date.now()): NbaModelPlay[] {
  return latestNbaForecasts(forecasts, now).flatMap(f => {
    const game = schedule.find(g => g["Game ID"] === f.gameId && Date.parse(g["Game Time"]) === Date.parse(f.tipoff)
      && nbaTeamKey(g["Away Team"]) === nbaTeamKey(f.away_team) && nbaTeamKey(g["Home Team"]) === nbaTeamKey(f.home_team));
    const away = number(game?.["Away Score"]), home = number(game?.["Home Score"]), observed = Date.parse(game?.["Result Updated"] || "");
    const final = game?.Completed === "TRUE" && game.Status === "STATUS_FINAL" && away != null && home != null && away > 0 && home > 0 && away !== home
      && Number.isFinite(observed) && observed > Date.parse(f.tipoff) && observed <= now;
    const settled = final ? settleNbaForecast(f, { game_id: f.gameId, completed: true, status: "STATUS_FINAL", tipoff: f.tipoff,
      source: { observed_at: game!["Result Updated"] }, away: { name: f.away_team, score: away }, home: { name: f.home_team, score: home } }, f.gameId, f.lockedAt) : f;
    return (["Spread", "Total"] as const).flatMap(market => {
      const prefix = market === "Spread" ? "spread" : "total", grade = String(f[`${prefix}_grade`] || "");
      const selection = String(f[`${prefix}_pick`] || ""), saved = number(market === "Spread" ? f.market?.home_spread : f.market?.total);
      const line = number(selection.match(/\s([+-]?\d+(?:\.\d+)?)\s*$/)?.[1]);
      const team = selection.replace(/\s[+-]?\d+(?:\.\d+)?\s*$/, "");
      const homeSide = nbaTeamKey(team) === nbaTeamKey(f.home_team), awaySide = nbaTeamKey(team) === nbaTeamKey(f.away_team);
      if (!["A", "B"].includes(grade) || saved == null || line == null || !selection
        || (market === "Total" ? saved <= 0 || !/^(Over|Under)\s/.test(selection) || Math.abs(line - saved) > .001
          : (!homeSide && !awaySide) || Math.abs(line - (homeSide ? saved : -saved)) > .001)) return [];
      const result = String(settled[`${prefix}Result`] || "PENDING");
      if (["EXCLUDED", "NO LINE", "PASS"].includes(result)) return [];
      return [{ id: `${nbaDate(Date.parse(f.tipoff))}|${f.gameId}|${market}`, date: nbaDate(Date.parse(f.tipoff)), gameId: f.gameId,
        game: `${f.away_team} @ ${f.home_team}`, gameTime: f.tipoff, market, selection, grade, line, odds: "-110",
        result: code(result), lockedAt: f.lockedAt, modelVersion: f.modelVersion }];
    });
  });
}

/** The collector changes only active days; the public board reads compact saved totals. */
export function updateNbaModelRecords(previous: NbaModelRecordState | undefined, forecasts: Row[], schedule: Row[], now = Date.now(), dates?: string[]): NbaModelRecordState {
  const state = previous?.version === NBA_MODEL_RECORD_POLICY ? previous : { version: NBA_MODEL_RECORD_POLICY, days: {}, recent: [] };
  const plays = nbaModelPlays(forecasts, schedule, now), days = { ...state.days };
  const changed = new Set(dates || [...new Set(plays.map(p => p.date))]);
  for (const date of changed) {
    const rows = plays.filter(p => p.date === date);
    days[date] = { totals: nbaRecordTotals(rows), byType: Object.fromEntries(["A Spread", "B Spread", "A Total", "B Total"]
      .map(label => [label, nbaRecordTotals(rows.filter(p => `${p.grade} ${p.market}` === label))])) };
  }
  return { version: NBA_MODEL_RECORD_POLICY, days, recent: [...state.recent.filter(p => !changed.has(p.date)), ...plays.filter(p => changed.has(p.date))]
    .sort((a, b) => b.date.localeCompare(a.date) || Date.parse(b.gameTime) - Date.parse(a.gameTime) || a.id.localeCompare(b.id)).slice(0, 100) };
}

export function summarizeNbaModelRecords(state: NbaModelRecordState, today: string): NbaModelRecords {
  const start = new Date(Date.parse(`${today}T12:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10);
  const days = Object.entries(state.days).filter(([day]) => day <= today);
  const recent = days.filter(([day]) => day >= start);
  return { policy: NBA_MODEL_RECORD_POLICY, overall: combine(days.map(([, d]) => d.totals)), last7Days: combine(recent.map(([, d]) => d.totals)),
    byType: ["A Spread", "B Spread", "A Total", "B Total"].map(label => ({ label,
      overall: combine(days.flatMap(([, d]) => d.byType[label] ? [d.byType[label]] : [])),
      last7Days: combine(recent.flatMap(([, d]) => d.byType[label] ? [d.byType[label]] : [])) })),
    history: state.recent.filter(p => p.date <= today), availableDates: days.map(([date]) => date).sort() };
}

/** Preserve the existing 3+ / two-source qualification; an unresolved game tie stays unselected. */
export function nbaEzpzSelections<T extends { id: string; date: string; game: string; signalCount: number; result: string; odds: string }>(rows: T[]): T[] {
  const unique = new Map(rows.filter(row => row.signalCount >= 3).map(row => [row.id, row]));
  const games = new Map<string, T[]>();
  for (const row of unique.values()) {
    const key = `${row.date}|${row.game.split(/\s*(?:@|\bat\b)\s*/i).map(nbaTeamKey).sort().join("|")}`;
    games.set(key, [...(games.get(key) || []), row]);
  }
  return [...games.values()].flatMap(group => {
    const highest = Math.max(...group.map(row => row.signalCount)), leaders = group.filter(row => row.signalCount === highest);
    return leaders.length === 1 ? leaders : [];
  });
}
