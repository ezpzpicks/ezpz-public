import { buildSignalResearchReport, RESEARCH_SIGNAL_KEYS, signalCombinationRecord, signalResearchSideGroup,
  type ResearchSideGroup, type SignalResearchDay } from "./signalCombinationResearch";
import type { FootballSignalSide } from "./footballSignals";

export const COMBO_SCORE_VERSION = "combo-score-2026-11-01-v1";
export const COMBO_SCORE_START_DATE = "2026-11-01";
// Add a dated policy when a sport or threshold is promoted. Never edit a past
// policy: its saved selections and records must remain reproducible.
const PICK_POLICIES = [
  { sport: "NCAAF", effectiveDate: "2026-11-01", threshold: 65, version: "combo-ezpz-ncaaf-2026-11-01-v1" },
] as const;
export function comboPickPolicy(sport: string, date: string) {
  return [...PICK_POLICIES].reverse().find(policy => policy.sport === sport && date >= policy.effectiveDate) || null;
}
export const comboScoreSupported = (sport: string) => ["NCAAF", "NFL", "NBA", "NCAAM"].includes(sport);
type ComboRecord = { combination: string; sideGroup: ResearchSideGroup; wins: number; losses: number; pushes: number };
export type ComboScore = {
  version: string; sport: string; score: number; rawScore: number; capturedAt: string;
  historyAsOf: string; historyDates: string[]; mode: "preview" | "locked";
  own: ComboRecord;
  opponent: ComboRecord & { id: string; gameKey: string; market: string; selection: string; line: number; snapshotAt: string };
};
const combination = (side: FootballSignalSide) => RESEARCH_SIGNAL_KEYS.filter(key =>
  side.signals.some(signal => signal.key === key && signal.active && signal.available)).join("+");
export function comboScoreValue(own: Pick<ComboRecord, "wins" | "losses">, opponent: Pick<ComboRecord, "wins" | "losses">) {
  const adjusted = (w: number, l: number) => (w + 10) / (w + l + 20);
  const rawScore = 100 * (adjusted(own.wins, own.losses) + adjusted(opponent.losses, opponent.wins)) / 2;
  return { rawScore, score: Math.max(0, Math.min(100, 50 + 3 * (rawScore - 50))) };
}
export function validSignalQuote(side: FootballSignalSide) {
  const active = side.signals.filter(signal => signal.active), odds = Number(side.odds);
  return side.line != null && Number.isFinite(side.line) && (side.market !== "Total" || side.line > 0)
    && ["Spread", "Total"].includes(side.market) && Number.isFinite(odds) && Math.abs(odds) >= 100 && odds >= -150
    && active.length === side.signalCount && new Set(active.map(signal => signal.key)).size === active.length
    && active.every(signal => signal.available && RESEARCH_SIGNAL_KEYS.includes(signal.key));
}
export function validComboFinalWindow(side: FootballSignalSide, now = Date.now()) {
  const captured = Date.parse(side.snapshotAt), kickoff = Date.parse(side.scheduledGameTime || side.gameTime);
  return side.status === "FINAL_PREGAME" && Number.isFinite(captured) && Number.isFinite(kickoff)
    && captured <= now && kickoff - captured >= 600_000 && kickoff - captured <= 1_200_000;
}
const countsValid = (r: ComboRecord) => r && [r.wins, r.losses, r.pushes].every(n => Number.isSafeInteger(n) && n >= 0);

/** Validate persisted scoring inputs; a displayed number alone cannot qualify. */
export function validComboScore(side: FootballSignalSide, sport: string) {
  const value = side.comboScore, group = signalResearchSideGroup(side);
  if (!value || !value.own || !value.opponent || value.version !== COMBO_SCORE_VERSION || value.sport !== sport || !group || !validSignalQuote(side)
    || value.capturedAt !== side.snapshotAt || value.own.sideGroup !== group || value.own.combination !== combination(side)
    || !countsValid(value.own) || !countsValid(value.opponent) || !Array.isArray(value.historyDates)
    || value.historyDates.some(date => !/^\d{4}-\d{2}-\d{2}$/.test(date) || date >= side.date)
    || !Number.isFinite(Date.parse(value.historyAsOf)) || Date.parse(value.historyAsOf) < Date.parse(value.capturedAt)
    || Date.parse(value.historyAsOf) >= Date.parse(side.scheduledGameTime || side.gameTime)
    || value.opponent.id === side.id || value.opponent.gameKey !== side.gameKey || value.opponent.market !== side.market
    || !Number.isFinite(value.opponent.line) || Math.abs(side.market === "Spread"
      ? side.line! + value.opponent.line : side.line! - value.opponent.line) > .001
    || value.opponent.sideGroup !== ({ Favorite: "Underdog", Underdog: "Favorite", "Pick'em": "Pick'em", Over: "Under", Under: "Over" } as const)[group]
    || !Number.isFinite(Date.parse(value.opponent.snapshotAt))
    || Math.abs(Date.parse(value.opponent.snapshotAt) - Date.parse(side.snapshotAt)) > 60_000) return false;
  const calculated = comboScoreValue(value.own, value.opponent);
  return Number.isFinite(value.score) && Number.isFinite(value.rawScore)
    && Math.abs(value.score - calculated.score) < 1e-8 && Math.abs(value.rawScore - calculated.rawScore) < 1e-8;
}

/** Uses only earlier game dates. Persisted scores are never recomputed later. */
export function attachComboScores(sides: FootballSignalSide[], sport: string, days: Record<string, SignalResearchDay>,
  policyVersion: string, now = Date.now(), allowPreview = true): FootballSignalSide[] {
  if (!comboScoreSupported(sport)) return sides;
  const reports = new Map<string, ReturnType<typeof buildSignalResearchReport>>();
  const pairs = new Map<string, FootballSignalSide[]>();
  for (const side of sides) {
    const key = `${side.date}|${side.gameKey}|${side.market}`;
    pairs.set(key, [...(pairs.get(key) || []), side]);
  }
  return sides.map(side => {
    if (side.date < COMBO_SCORE_START_DATE || side.recorded || side.lineSource || !validSignalQuote(side)) return side;
    const pair = pairs.get(`${side.date}|${side.gameKey}|${side.market}`)!;
    if (pair.length !== 2) return side;
    const opponent = pair.find(other => other.id !== side.id);
    if (!opponent || !validSignalQuote(opponent) || opponent.lineSource || opponent.side === side.side
      || side.gameTime !== opponent.gameTime || Math.abs(side.market === "Spread"
        ? side.line! + opponent.line! : side.line! - opponent.line!) > .001
      || Math.abs(Date.parse(side.snapshotAt) - Date.parse(opponent.snapshotAt)) > 60_000) return side;
    const captured = Date.parse(side.snapshotAt);
    if (!Number.isFinite(captured) || captured > now) return side;
    const locked = validComboFinalWindow(side, now) && validComboFinalWindow(opponent, now)
      && Date.parse(side.scheduledGameTime || side.gameTime) > now;
    const preview = allowPreview && side.status === "LIVE" && opponent.status === "LIVE"
      && Date.parse(side.scheduledGameTime || side.gameTime) > now && !side.result;
    if (!locked && !preview) return side;
    if (!reports.has(side.date)) reports.set(side.date, buildSignalResearchReport(sport, policyVersion,
      Object.fromEntries(Object.entries(days).filter(([date]) => date < side.date))));
    const report = reports.get(side.date)!;
    const own = signalCombinationRecord(report, side), opp = signalCombinationRecord(report, opponent);
    if (!own || !opp) return side;
    const record = (r: typeof own): ComboRecord => ({ combination: r.combination, sideGroup: r.sideGroup,
      wins: r.wins, losses: r.losses, pushes: r.pushes });
    const comboScore: ComboScore = { version: COMBO_SCORE_VERSION, sport, ...comboScoreValue(own, opp),
      capturedAt: side.snapshotAt, historyAsOf: new Date(now).toISOString(), historyDates: report.dates,
      mode: locked ? "locked" : "preview", own: record(own),
      opponent: { ...record(opp), id: opponent.id, gameKey: opponent.gameKey, market: opponent.market,
        selection: opponent.selection, line: opponent.line!, snapshotAt: opponent.snapshotAt } };
    return { ...side, comboScore };
  });
}
