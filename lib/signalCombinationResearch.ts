/** Descriptive research from frozen observations; never selects or posts bets. */
export const SIGNAL_RESEARCH_VERSION = "signal-combinations-2026-10-23-v1";
export const SIGNAL_RESEARCH_FORWARD_AT = "2026-10-23T22:27:21.000Z";
export const RESEARCH_SIGNAL_KEYS = ["money", "move", "system", "team", "model", "sos"] as const;
type SignalKey = typeof RESEARCH_SIGNAL_KEYS[number];
export type ResearchPhase = "history" | "forward";
export type ResearchStats = {
  wins: number; losses: number; pushes: number; pending: number; netUnits: number;
  assumedPrices: number; unknownPrices: number;
};
export type ResearchCell = { market: string; phase: ResearchPhase; combination: string; stats: ResearchStats };
export type SignalResearchDay = { version: string; policyVersion: string; date: string; cells: ResearchCell[] };
export type SignalResearchReport = {
  version: string; sport: string; policyVersion: string; forwardFrom: string; dates: string[]; cells: ResearchCell[];
};
export type ResearchObservation = {
  id: string; date: string; market: string; line: number | null; odds: string; recorded: boolean;
  status: string; snapshotAt: string; gameTime: string; policyVersion?: string; oddsAssumed?: boolean;
  signalCount: number; signals: { key: string; active: boolean; available: boolean }[];
  result: string; resultUpdated: string;
};
const labels: Record<SignalKey, string> = {
  money: "Money support", move: "Line movement", system: "Public trend", team: "Team trend", model: "Model", sos: "SOS",
};
const empty = (): ResearchStats => ({ wins: 0, losses: 0, pushes: 0, pending: 0, netUnits: 0, assumedPrices: 0, unknownPrices: 0 });
const round = (n: number) => Math.round(n * 100) / 100;
const keysOf = (combination: string) => combination ? combination.split("+") as SignalKey[] : [];
export const signalCombinationLabel = (combination: string) => keysOf(combination).map(key => labels[key]).join(" + ") || "No active signals";
function add(target: ResearchStats, value: ResearchStats) {
  for (const key of Object.keys(target) as (keyof ResearchStats)[]) target[key] += value[key];
  return target;
}
function record(stats: ResearchStats) {
  const settled = stats.wins + stats.losses + stats.pushes;
  return { ...stats, netUnits: round(stats.netUnits), settled, samples: settled + stats.pending,
    record: `${stats.wins}-${stats.losses}-${stats.pushes}`,
    winPct: stats.wins + stats.losses ? round(stats.wins / (stats.wins + stats.losses) * 100) : null,
    roiPct: settled ? round(stats.netUnits / settled * 100) : null };
}
function mergeCells(cells: ResearchCell[]) {
  const merged = new Map<string, ResearchCell>();
  for (const cell of cells) {
    const key = `${cell.market}|${cell.phase}|${cell.combination}`;
    if (!merged.has(key)) merged.set(key, { ...cell, stats: empty() });
    add(merged.get(key)!.stats, cell.stats);
  }
  return [...merged.values()].sort((a, b) => a.market.localeCompare(b.market) || a.phase.localeCompare(b.phase) || a.combination.localeCompare(b.combination));
}

/** Replays captured flags only. No current projections or leaderboards enter it. */
export function buildSignalResearchDays(observations: ResearchObservation[], policyVersion: string, now = Date.now()): Record<string, SignalResearchDay> {
  const unique = new Map<string, { side: ResearchObservation; fingerprint: string }>(), conflicts = new Set<string>();
  for (const side of observations) {
    if (!side.recorded || side.policyVersion !== policyVersion || side.status !== "FINAL_PREGAME"
      || !side.id || !/^\d{4}-\d{2}-\d{2}$/.test(side.date) || !side.market || !Array.isArray(side.signals)
      || side.line == null || !Number.isFinite(side.line) || (side.market === "Total" && side.line <= 0)) continue;
    const odds = Number(side.odds), captured = Date.parse(side.snapshotAt), kickoff = Date.parse(side.gameTime);
    if (!Number.isFinite(odds) || Math.abs(odds) < 100 || odds < -150 || !Number.isFinite(captured) || !Number.isFinite(kickoff)
      || captured > now || kickoff - captured < 10 * 60_000 || kickoff - captured > 20 * 60_000) continue;
    const active = side.signals.filter(signal => signal.active);
    if (active.some(signal => !signal.available || !RESEARCH_SIGNAL_KEYS.includes(signal.key as SignalKey))
      || new Set(active.map(signal => signal.key)).size !== active.length || active.length !== side.signalCount) continue;
    const combination = RESEARCH_SIGNAL_KEYS.filter(key => active.some(signal => signal.key === key)).join("+");
    const fingerprint = JSON.stringify([side.date, side.market, side.line, odds, side.snapshotAt, combination, side.oddsAssumed]);
    const previous = unique.get(side.id);
    if (previous && previous.fingerprint !== fingerprint) { conflicts.add(side.id); continue; }
    // A settlement update may replace an outcome, never the original decision.
    const validResultTime = (value: ResearchObservation) => {
      const at = Date.parse(value.resultUpdated);
      return /^[WLP]$/.test(value.result) && Number.isFinite(at) && at > kickoff && at <= now ? at : -Infinity;
    };
    if (!previous || validResultTime(side) > validResultTime(previous.side)) unique.set(side.id, { side, fingerprint });
  }
  const days: Record<string, SignalResearchDay> = {};
  for (const [id, { side }] of unique) {
    if (conflicts.has(id)) continue;
    const settledAt = Date.parse(side.resultUpdated), kickoff = Date.parse(side.gameTime);
    const result = Number.isFinite(settledAt) && settledAt > kickoff && settledAt <= now ? side.result : "";
    const stats = empty(), odds = Number(side.odds);
    if (result === "W") { stats.wins = 1; stats.netUnits = odds > 0 ? odds / 100 : 100 / Math.abs(odds); }
    else if (result === "L") { stats.losses = 1; stats.netUnits = -1; }
    else if (result === "P") stats.pushes = 1;
    else stats.pending = 1;
    if (side.oddsAssumed === true) stats.assumedPrices = 1;
    else if (side.oddsAssumed !== false) stats.unknownPrices = 1;
    const day = days[side.date] ||= { version: SIGNAL_RESEARCH_VERSION, policyVersion, date: side.date, cells: [] };
    day.cells.push({ market: side.market,
      phase: Date.parse(side.snapshotAt) >= Date.parse(SIGNAL_RESEARCH_FORWARD_AT) ? "forward" : "history",
      combination: RESEARCH_SIGNAL_KEYS.filter(key => side.signals.some(signal => signal.key === key && signal.active)).join("+"), stats });
  }
  for (const day of Object.values(days)) day.cells = mergeCells(day.cells);
  return days;
}

/** Daily aggregates are replaced when outcomes change, so repeated ticks cannot double count. */
export function buildSignalResearchReport(sport: string, policyVersion: string, days: Record<string, SignalResearchDay>): SignalResearchReport {
  const valid = Object.values(days).filter(day => day.version === SIGNAL_RESEARCH_VERSION && day.policyVersion === policyVersion);
  return { version: SIGNAL_RESEARCH_VERSION, sport, policyVersion, forwardFrom: SIGNAL_RESEARCH_FORWARD_AT,
    dates: valid.map(day => day.date).sort(), cells: mergeCells(valid.flatMap(day => day.cells)) };
}

export function signalResearchView(report: SignalResearchReport, market: string, phase: ResearchPhase | "all" = "all") {
  const cells = report.cells.filter(cell => cell.market === market && (phase === "all" || cell.phase === phase));
  const total = record(cells.reduce((sum, cell) => add(sum, cell.stats), empty()));
  const counts = ["0", "1", "2", "3+"].map(label => ({ label, record: record(cells
    .filter(cell => label === "3+" ? keysOf(cell.combination).length >= 3 : keysOf(cell.combination).length === Number(label))
    .reduce((sum, cell) => add(sum, cell.stats), empty())) }));
  const combinations = new Map<string, ResearchStats>();
  for (const cell of cells) if (keysOf(cell.combination).length >= 2) {
    if (!combinations.has(cell.combination)) combinations.set(cell.combination, empty());
    add(combinations.get(cell.combination)!, cell.stats);
  }
  const exact = [...combinations].map(([combination, stats]) => ({ combination, signalCount: keysOf(combination).length, record: record(stats) }))
    .sort((a, b) => b.record.settled - a.record.settled || b.record.samples - a.record.samples || a.combination.localeCompare(b.combination));
  const individual = RESEARCH_SIGNAL_KEYS.map(key => ({ key, label: labels[key], record: record(cells.filter(cell => keysOf(cell.combination).includes(key))
    .reduce((sum, cell) => add(sum, cell.stats), empty())) })).filter(row => row.record.samples);
  return { total, counts, exact, individual };
}
