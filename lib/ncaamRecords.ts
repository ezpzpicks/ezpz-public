import { ncaamDate, ncaamTeamKey, settleNcaamForecast } from "./ncaamMarketCore";
import { signalPickThreshold } from "./signalPicks";
import { ncaamMatchupGrade } from "./ncaamMatchupGrades";
import { ncaamSpreadGrade } from "./ncaamSpreadGrades";

type Row = Record<string, any>;
export const NCAAM_MODEL_RECORD_POLICY = "ncaam-matchup-total-records-v2";
const MODEL_LABELS = ["A Spread", "B Spread", "A Favorite Spread", "B Favorite Spread", "A Underdog Spread", "B Underdog Spread", "A Total", "B Total", "A Over", "B Over", "A Under", "B Under"];
export type NcaamRecordTotals = { wins: number; losses: number; pushes: number; pending: number; totalBets: number;
  record: string; winPct: number | null; unitsWon: number; roiPct: number | null };
export type NcaamModelPlay = { id: string; date: string; gameId: string; game: string; gameTime: string;
  market: "Spread" | "Total"; selection: string; grade: string; line: number; odds: string;
  result: string; lockedAt: string; modelVersion: string; recordMode?: "live" | "replay"; gradeReason?: string; spreadRole?: "Favorite" | "Underdog" | "Pickem" };
type ModelDay = { totals: NcaamRecordTotals; byType: Record<string, NcaamRecordTotals> };
export type NcaamModelRecordState = { version: string; days: Record<string, ModelDay>; recent: NcaamModelPlay[];
  replayDays?: Record<string, ModelDay>; replayRecent?: NcaamModelPlay[] };
type ModelRecordSummary = { policy: string; overall: NcaamRecordTotals; last7Days: NcaamRecordTotals;
  byType: { label: string; overall: NcaamRecordTotals; last7Days: NcaamRecordTotals }[]; history: NcaamModelPlay[];
  availableDates: string[] };
export type NcaamModelRecords = ModelRecordSummary & { replay?: ModelRecordSummary };
const round = (n: number) => Math.round(n * 100) / 100;
const code = (value: unknown) => ({ WIN: "W", LOSS: "L", PUSH: "P", W: "W", L: "L", P: "P" }[String(value).toUpperCase()] || "");
const number = (value: unknown) => value == null || String(value).trim() === "" || !Number.isFinite(Number(value)) ? null : Number(value);
export function ncaamRecordTotals(rows: { result: string; odds?: string }[]): NcaamRecordTotals {
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
function combine(rows: NcaamRecordTotals[]): NcaamRecordTotals {
  const sum = (key: "wins" | "losses" | "pushes" | "pending") => rows.reduce((n, r) => n + r[key], 0);
  const wins = sum("wins"), losses = sum("losses"), pushes = sum("pushes"), totalBets = wins + losses + pushes;
  // Model records all use -110. Recalculate from counts to avoid daily rounding drift.
  const units = wins * 100 / 110 - losses;
  return { wins, losses, pushes, totalBets, pending: sum("pending"), record: `${wins}-${losses}-${pushes}`,
    winPct: wins + losses ? round(wins / (wins + losses) * 100) : null, unitsWon: round(units),
    roiPct: totalBets ? round(units / totalBets * 100) : null };
}

/** One deterministic pre-tipoff forecast per physical game; results never decide which run wins. */
export function latestNcaamForecasts(forecasts: Row[], now = Date.now()): Row[] {
  const games = new Map<string, Row>();
  for (const f of forecasts) {
    const lock = Date.parse(f.lockedAt), tipoff = Date.parse(f.tipoff);
    if (!f.gameId || !f.away_team || !f.home_team || !Number.isFinite(lock) || !Number.isFinite(tipoff) || lock >= tipoff || lock > now) continue;
    const key = `${ncaamDate(tipoff)}|${f.gameId}`, old = games.get(key);
    const tieKey = (row: Row) => `${row.modelVersion || ""}|${row.recordId || ""}`;
    if (!old || lock > Date.parse(old.lockedAt) || (lock === Date.parse(old.lockedAt) && tieKey(f) > tieKey(old))) games.set(key, f);
  }
  return [...games.values()].sort((a, b) => Date.parse(a.tipoff) - Date.parse(b.tipoff));
}

export function ncaamModelPlays(forecasts: Row[], schedule: Row[] = [], now = Date.now()): NcaamModelPlay[] {
  return latestNcaamForecasts(forecasts, now).flatMap(f => {
    const game = schedule.find(g => g["Game ID"] === f.gameId && Date.parse(g["Game Time"]) === Date.parse(f.tipoff)
      && ncaamTeamKey(g["Away Team"]) === ncaamTeamKey(f.away_team) && ncaamTeamKey(g["Home Team"]) === ncaamTeamKey(f.home_team));
    const away = number(game?.["Away Score"]), home = number(game?.["Home Score"]), observed = Date.parse(game?.["Result Updated"] || "");
    const final = game?.Completed === "TRUE" && game.Status === "STATUS_FINAL" && away != null && home != null && away > 0 && home > 0 && away !== home
      && Number.isFinite(observed) && observed > Date.parse(f.tipoff) && observed <= now;
    const settled = final ? settleNcaamForecast(f, { game_id: f.gameId, completed: true, status: "STATUS_FINAL", tipoff: f.tipoff,
      source: { observed_at: game!["Result Updated"] }, away: { name: f.away_team, score: away }, home: { name: f.home_team, score: home } }, f.gameId, f.lockedAt) : f;
    return (["Spread", "Total"] as const).flatMap(market => {
      const matchup = market === "Total" ? ncaamMatchupGrade(f) : ncaamSpreadGrade(f);
      const prefix = market === "Spread" ? "spread" : "total", grade = String(f[`${prefix}_grade`] || "");
      const selection = String(f[`${prefix}_pick`] || ""), saved = number(market === "Spread" ? f.market?.home_spread : f.market?.total);
      const line = number(selection.match(/\s([+-]?\d+(?:\.\d+)?)\s*$/)?.[1]);
      const team = selection.replace(/\s[+-]?\d+(?:\.\d+)?\s*$/, "");
      const homeSide = ncaamTeamKey(team) === ncaamTeamKey(f.home_team), awaySide = ncaamTeamKey(team) === ncaamTeamKey(f.away_team);
      if (!["A", "B"].includes(grade) || saved == null || line == null || !selection
        || (market === "Total" ? saved <= 0 || !/^(Over|Under)\s/.test(selection) || Math.abs(line - saved) > .001
          : (!homeSide && !awaySide) || Math.abs(line - (homeSide ? saved : -saved)) > .001)) return [];
      const result = String(settled[`${prefix}Result`] || "PENDING");
      if (["EXCLUDED", "NO LINE", "PASS"].includes(result)) return [];
      return [{ id: `${ncaamDate(Date.parse(f.tipoff))}|${f.gameId}|${market}`, date: ncaamDate(Date.parse(f.tipoff)), gameId: f.gameId,
        game: `${f.away_team} @ ${f.home_team}`, gameTime: f.tipoff, market, selection, grade, line, odds: "-110",
        result: code(result), lockedAt: f.lockedAt, modelVersion: matchup?.policy_version || f.modelVersion,
        ...(matchup ? { recordMode: matchup.record_mode, gradeReason: matchup.reason } : {}),
        ...(market === "Spread" && matchup && "role" in matchup ? { spreadRole: matchup.role } : {}) }];
    });
  });
}

/** The collector changes only active days; the public board reads compact saved totals. */
export function updateNcaamModelRecords(previous: NcaamModelRecordState | undefined, forecasts: Row[], schedule: Row[], now = Date.now(), dates?: string[]): NcaamModelRecordState {
  const state = previous?.version === NCAAM_MODEL_RECORD_POLICY ? previous : { version: NCAAM_MODEL_RECORD_POLICY, days: {}, recent: [] };
  const plays = ncaamModelPlays(forecasts, schedule, now), days = { ...state.days }, replayDays = { ...state.replayDays };
  const changed = new Set(dates || [...new Set(plays.map(p => p.date))]);
  for (const date of changed) {
    const summarize = (rows: NcaamModelPlay[]) => ({ totals: ncaamRecordTotals(rows), byType: Object.fromEntries(MODEL_LABELS
      .map(label => [label, ncaamRecordTotals(rows.filter(p => `${p.grade} ${p.market}` === label
        || (p.market === "Total" && `${p.grade} ${p.selection.split(" ")[0]}` === label)
        || (p.market === "Spread" && `${p.grade} ${p.spreadRole} Spread` === label)))])) });
    days[date] = summarize(plays.filter(p => p.date === date && p.recordMode !== "replay"));
    replayDays[date] = summarize(plays.filter(p => p.date === date && p.recordMode === "replay"));
  }
  const recent = (old: NcaamModelPlay[], replay: boolean) => [...old.filter(p => !changed.has(p.date)),
    ...plays.filter(p => changed.has(p.date) && (p.recordMode === "replay") === replay)]
    .sort((a, b) => b.date.localeCompare(a.date) || Date.parse(b.gameTime) - Date.parse(a.gameTime) || a.id.localeCompare(b.id)).slice(0, 100);
  return { version: NCAAM_MODEL_RECORD_POLICY, days, replayDays, recent: recent(state.recent, false), replayRecent: recent(state.replayRecent || [], true) };
}

export function summarizeNcaamModelRecords(state: NcaamModelRecordState, today: string): NcaamModelRecords {
  const start = new Date(Date.parse(`${today}T12:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10);
  const summary = (savedDays: Record<string, ModelDay>, history: NcaamModelPlay[]): ModelRecordSummary => {
    const days = Object.entries(savedDays).filter(([day]) => day <= today);
    const recent = days.filter(([day]) => day >= start);
    return { policy: NCAAM_MODEL_RECORD_POLICY, overall: combine(days.map(([, d]) => d.totals)), last7Days: combine(recent.map(([, d]) => d.totals)),
    byType: MODEL_LABELS.map(label => ({ label,
      overall: combine(days.flatMap(([, d]) => d.byType[label] ? [d.byType[label]] : [])),
      last7Days: combine(recent.flatMap(([, d]) => d.byType[label] ? [d.byType[label]] : [])) })),
    history: history.filter(p => p.date <= today), availableDates: days.map(([date]) => date).sort() };
  };
  return { ...summary(state.days, state.recent), replay: summary(state.replayDays || {}, state.replayRecent || []) };
}

/** Summarize qualified signal tests at the current NCAAM threshold; tied leaders wait. */
export function ncaamEzpzSelections<T extends { id: string; date: string; game: string; signalCount: number; result: string; odds: string }>(rows: T[]): T[] {
  const unique = new Map(rows.filter(row => row.signalCount >= signalPickThreshold("NCAAM")).map(row => [row.id, row]));
  const games = new Map<string, T[]>();
  for (const row of unique.values()) {
    const key = `${row.date}|${row.game.split(/\s*(?:@|\bat\b)\s*/i).map(ncaamTeamKey).sort().join("|")}`;
    games.set(key, [...(games.get(key) || []), row]);
  }
  return [...games.values()].flatMap(group => {
    const highest = Math.max(...group.map(row => row.signalCount)), leaders = group.filter(row => row.signalCount === highest);
    return leaders.length === 1 ? leaders : [];
  });
}
