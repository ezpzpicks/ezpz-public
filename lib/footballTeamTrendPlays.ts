import { footballTeamGameKey, footballTeamKey, footballTeamPair, scoreFootballTeamTrends,
  type FootballTeamTrendScore, type TeamTrendHistory } from "./footballTeamTrends";
import { isSavedTeamTrendCapture, isTeamTrendPostingTime, TEAM_TREND_READY_POLICY } from "./teamTrendPosting";

type Row = Record<string, any>;
type Sport = "NFL" | "NCAAF";
type Result = "W" | "L" | "P" | "";
export const TEAM_TREND_TEST_VERSION = "team-trend-test-2026-10-15-v1";
export const TEAM_TREND_TEST_THRESHOLD = 75;
export const TEAM_TREND_TEST_TAB = "team_trend_test_picks";
export const TEAM_TREND_TEST_HEADERS = ["Date", "Pick Key", "Game", "Market", "Selection", "Line", "Odds",
  "Game Time", "Strategy Version", "Threshold", "Result", "Saved At", "Result Updated", "Details JSON"];

export type TeamTrendTestPick = {
  id: string; strategyVersion: string; threshold: number; date: string; game: string; gameTime: string;
  awayTeam: string; homeTeam: string; market: "Spread" | "Total"; selection: string; selectionTeam: string;
  side: string; line: number; odds: "-110"; snapshotStatus: "LIVE" | "FINAL_PREGAME";
  teamTrendScore: FootballTeamTrendScore; capturedAt: string; savedAt: string; result: Result; resultUpdated: string;
  capturePolicy?: string;
};
export type TeamTrendTestStatus = {
  version: string; threshold: number; record: string; wins: number; losses: number; pushes: number;
  pending: number; graded: number; units: number; roiPct: number; awaitingHistory: number;
};

const num = (v: unknown): number | null => v == null || String(v).trim() === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null;
const dateOf = (r: Row) => String(r.date || r.Date || r["Game Date"] || "").slice(0, 10);
const marketOf = (r: Row) => /^spread$/i.test(String(r.market || r.Market)) ? "Spread" : /^total$/i.test(String(r.market || r.Market)) ? "Total" : "";
const pickKey = (r: Row, sport: Sport) => `${footballTeamGameKey(r, sport)}|${marketOf(r).toLowerCase()}`;
const grade = (margin: number): Result => Math.abs(margin) < 1e-8 ? "P" : margin > 0 ? "W" : "L";

function readSaved(rows: Row[], sport: Sport) {
  const saved = new Map<string, TeamTrendTestPick>();
  for (const row of rows) {
    try {
      const p = JSON.parse(String(row["Details JSON"] || "{}")) as TeamTrendTestPick;
      if (!p.strategyVersion?.startsWith("team-trend-test-") || p.snapshotStatus !== "FINAL_PREGAME"
        || !isSavedTeamTrendCapture(p)
        || !footballTeamPair(p) || !marketOf(p) || num(p.line) == null || num(p.threshold) == null
        || p.teamTrendScore?.score == null || p.teamTrendScore.score < p.threshold) continue;
      const id = pickKey(p, sport);
      if (!footballTeamGameKey(p, sport)) continue;
      saved.set(id, { ...p, id, result: ["W", "L", "P"].includes(row.Result) ? row.Result : p.result || "",
        resultUpdated: String(row["Result Updated"] || p.resultUpdated || "") });
    } catch { /* An invalid row cannot become a test pick. */ }
  }
  return saved;
}

function storageRow(p: TeamTrendTestPick) {
  return { Date: p.date, "Pick Key": p.id, Game: p.game, Market: p.market, Selection: p.selection, Line: String(p.line), Odds: "-110",
    "Game Time": p.gameTime, "Strategy Version": p.strategyVersion, Threshold: String(p.threshold), Result: p.result,
    "Saved At": p.savedAt, "Result Updated": p.resultUpdated, "Details JSON": JSON.stringify(p) };
}

function finalScores(rows: Row[], sport: Sport) {
  const scores = new Map<string, { away: string; home: string; a: number; h: number }>();
  for (const row of rows) {
    const pair = footballTeamPair(row), a = num(row["Away Score"]), h = num(row["Home Score"]);
    if (!pair || a == null || h == null || a < 0 || h < 0 || /^(false|no|0)$/i.test(String(row.Completed ?? ""))) continue;
    if (!a && !h && !/^(true|yes|1)$/i.test(String(row.Completed ?? ""))) continue;
    scores.set(footballTeamGameKey(row, sport), { away: footballTeamKey(pair[0], sport), home: footballTeamKey(pair[1], sport), a, h });
  }
  return scores;
}

/** Team records are the sole selection signal. Market rows supply only lines and kickoff metadata. */
export function buildTeamTrendTestState(input: {
  sport: Sport; today: string; markets: Row[]; history: TeamTrendHistory; storedRows: Row[];
  scheduleRows: Row[]; capture: boolean; earlyCapture?: boolean; now?: number;
}) {
  const { sport, today, history } = input, now = input.now ?? Date.now();
  const stamp = new Date(now).toISOString();
  const saved = readSaved(input.storedRows, sport), changed = new Map<string, Row>();
  const finals = finalScores(input.scheduleRows, sport);
  for (const [id, p] of saved) {
    if (now < Date.parse(p.gameTime)) continue;
    const score = finals.get(footballTeamGameKey(p, sport));
    if (!score) continue;
    let result: Result;
    if (p.market === "Total") result = grade((score.a + score.h - p.line) * (/^under$/i.test(p.side) ? -1 : 1));
    else {
      const selected = footballTeamKey(p.selectionTeam, sport);
      if (selected !== score.away && selected !== score.home) continue;
      result = grade((selected === score.home ? score.h - score.a : score.a - score.h) + p.line);
    }
    if (p.result === result) continue;
    const settled = { ...p, result, resultUpdated: stamp };
    saved.set(id, settled); changed.set(id, storageRow(settled));
  }

  const candidates = new Map<string, TeamTrendTestPick>(), awaiting = new Set<string>();
  for (const marketRow of input.markets) {
    const pair = footballTeamPair(marketRow), market = marketOf(marketRow), line = num(marketRow.line);
    const start = Date.parse(String(marketRow.gameTime || ""));
    if (!pair || !market || line == null || dateOf(marketRow) !== today || !Number.isFinite(start) || now >= start) continue;
    if (market === "Total" && line <= 0) continue;
    const final = String(marketRow.snapshotStatus || "").toUpperCase() === "FINAL_PREGAME";
    const base = { date: today, game: `${pair[0]} @ ${pair[1]}`, awayTeam: pair[0], homeTeam: pair[1], gameTime: new Date(start).toISOString(),
      market, odds: "-110" as const, snapshotStatus: final ? "FINAL_PREGAME" as const : "LIVE" as const,
      strategyVersion: TEAM_TREND_TEST_VERSION, threshold: TEAM_TREND_TEST_THRESHOLD, capturedAt: stamp, savedAt: "", result: "" as Result, resultUpdated: "" };
    const id = pickKey(base, sport);
    if (saved.has(id)) continue;
    let directions: Array<{ selection: string; selectionTeam: string; side: string; line: number }>;
    if (market === "Total") directions = ["Over", "Under"].map(side => ({ selection: `${side} ${line}`, selectionTeam: "", side, line }));
    else {
      const team = footballTeamKey(marketRow.selectionTeam || String(marketRow.selection || "").replace(/\s+[+-]?\d+(?:\.\d+)?\s*$/, ""), sport);
      const index = pair.findIndex(t => footballTeamKey(t, sport) === team);
      if (index < 0) continue;
      directions = pair.map((name, i) => {
        const spread = i === index ? line : -line;
        return { selection: `${name} ${spread > 0 ? "+" : ""}${spread}`, selectionTeam: name, side: "", line: spread };
      });
    }
    for (const direction of directions) {
      const draft = { ...base, ...direction, id };
      const score = scoreFootballTeamTrends({ ...draft, snapshotStatus: "LIVE" }, sport, history, now);
      if (!score || score.score == null) { awaiting.add(id); continue; }
      if (score.score < TEAM_TREND_TEST_THRESHOLD) continue;
      const pick = { ...draft, teamTrendScore: score } as TeamTrendTestPick;
      const prior = candidates.get(id);
      if (!prior || score.score > prior.teamTrendScore.score!
        || (score.score === prior.teamTrendScore.score && pick.snapshotStatus === "FINAL_PREGAME" && prior.snapshotStatus !== "FINAL_PREGAME")) candidates.set(id, pick);
    }
  }
  for (const [id, p] of candidates) {
    // Team evidence is ready independently of public betting's final quote.
    // The caller permits early capture only from a healthy current market feed.
    const ready = input.earlyCapture === true && isTeamTrendPostingTime(p.date, now);
    const finalQuote = p.snapshotStatus === "FINAL_PREGAME" && Date.parse(p.gameTime) - now <= 20 * 60_000;
    if (!input.capture || (!ready && !finalQuote)) continue;
    const locked = { ...p, snapshotStatus: "FINAL_PREGAME" as const, savedAt: stamp,
      ...(ready ? { capturePolicy: TEAM_TREND_READY_POLICY } : {}),
      teamTrendScore: { ...p.teamTrendScore, mode: "locked" as const } };
    saved.set(id, locked); changed.set(id, storageRow(locked));
  }
  const records = [...saved.values()].sort((a,b) => b.date.localeCompare(a.date) || a.game.localeCompare(b.game) || a.market.localeCompare(b.market));
  const current = new Map([...candidates, ...records.filter(p => p.date === today).map(p => [p.id, p] as const)]);
  const picks = [...current.values()].sort((a,b) => a.gameTime.localeCompare(b.gameTime) || a.game.localeCompare(b.game) || a.market.localeCompare(b.market));
  const wins = records.filter(p=>p.result === "W").length, losses = records.filter(p=>p.result === "L").length,
    pushes = records.filter(p=>p.result === "P").length, graded = wins + losses + pushes;
  const units = wins * 100 / 110 - losses;
  const status: TeamTrendTestStatus = { version: TEAM_TREND_TEST_VERSION, threshold: TEAM_TREND_TEST_THRESHOLD,
    record: `${wins}-${losses}-${pushes}`, wins, losses, pushes, pending: records.length - graded, graded,
    units: Math.round(units*100)/100, roiPct: graded ? Math.round(units/graded*1000)/10 : 0, awaitingHistory: awaiting.size };
  return { picks, records, status, changedRows: [...changed.values()] };
}
