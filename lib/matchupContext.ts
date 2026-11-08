import type { FootballSignalSide } from "./footballSignals";
import type { TeamTrendRecord, TeamTrendTeam } from "./footballTeamTrends";
import { buildTrialModel, buildTrialDecisions, buildTrialPreviews, trialPairedMarkets, trialDayStart, trialDigest,
  type TrialSide, type TrialSport, type TrialModel, type TrialDecision, type TrialFeatureSet } from "./selectionTrial";

export const MATCHUP_CONTEXT_VERSION = "matchup-context-2026-11-06-v1";
export type ContextSport = Exclude<TrialSport, "MLB">;
export type ModelForm = { wins: number; losses: number; pushes: number; games: number; netUnits: number };
export type ContextSide = TrialSide & Partial<Pick<FootballSignalSide, "teamTrend" | "marketContext" | "modelContext" | "sosContext">>
  & { contextModelForm?: ModelForm; contextAsOf?: string };
export type ContextModel = TrialModel & { modelForms: Record<string, ModelForm> };
export type ContextEvidence = { label: string; value: string; direction: "Supports" | "Opposes" | "Neutral"; sample: number | null };
export type ContextCase = { id: string; selection: string; evidence: ContextEvidence[]; disagreements: string[]; missing: string[];
  metrics?: { tickets: number | null; money: number | null; moneyGap: number | null; openingLine: number | null;
    teamScore: number | null; modelEdge: number | null; modelProjection: number | null; activeSignals: string[] } };
export type ContextDecision = TrialDecision & { cases: ContextCase[] };
export type ContextReview = ContextDecision & { reviewStatus: "PENDING" | "FINAL" | "MISSED_FINAL" };

const bound = (value: number) => Math.max(-1, Math.min(1, value));
const stamp = (value: unknown) => /(?:Z|[+-]\d{2}:?\d{2}|EDT|EST)$/i.test(String(value || ""))
  ? Date.parse(String(value).replace(/ EDT$/, " -0400").replace(/ EST$/, " -0500")) : NaN;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const direction = (value: number) => value > 0 ? "Supports" : value < 0 ? "Opposes" : "Neutral";
const emptyForm = (): ModelForm => ({ wins: 0, losses: 0, pushes: 0, games: 0, netUnits: 0 });
const formKey = (side: ContextSide) => `${side.market}|${side.modelContext?.version || ""}`;

function recordStrength(record: TeamTrendRecord | undefined) {
  if (!record || !Number.isSafeInteger(record.wins) || !Number.isSafeInteger(record.losses)
    || record.wins < 0 || record.losses < 0 || record.sample !== record.wins + record.losses + record.pushes) return 0;
  return (record.wins - record.losses) / (record.wins + record.losses + 4);
}

// A pending review can use records refreshed after its latest odds quote.
// Frozen observations retain their original quote-time evidence cutoff.
function contextAt(side: ContextSide) {
  return stamp(!side.recorded && side.contextAsOf ? side.contextAsOf : side.snapshotAt);
}

function capturedTeamRecords(side: ContextSide): TeamTrendTeam[] {
  const trend = side.teamTrend;
  return trend && trend.asOfDate === side.date && stamp(trend.capturedAt) <= contextAt(side) && trend.teams.length === 2
    ? trend.teams.filter(team => Object.values(team.records).some(record => record.sample > 0)) : [];
}

function capturedTeams(side: ContextSide): TeamTrendTeam[] {
  const teams = capturedTeamRecords(side);
  return teams.length === 2 && teams.every(team => team.hasData && team.missingGames === 0) ? teams : [];
}

function teamStrength(side: ContextSide, category: "betType" | "venue" | "recent") {
  const teams = capturedTeams(side);
  if (!teams.length) return 0;
  if (side.market === "Spread") return recordStrength(teams.find(team => !team.opposing)?.records[category]);
  return teams.reduce((sum, team) => sum + recordStrength(team.records[category]), 0) / teams.length;
}

function modelAvailable(side: ContextSide) {
  const context = side.modelContext;
  return Boolean(context?.version && finite(context.projection)
    && side.signals.some(signal => signal.key === "model" && signal.available)
    && (side.signals.some(signal => signal.key === "model" && signal.available && signal.active)
      || context.reason === "No existing qualifying model play on this side."));
}

/** Keep the chronology of the original chart, including a move back to the opener. */
export function contextLineHistory(side: ContextSide) {
  const at = stamp(side.snapshotAt), context = side.marketContext;
  const history = (context?.history || []).filter(point => stamp(point.snapshotTime) <= at
    && Number.isFinite(stamp(point.snapshotTime)) && point.line != null && String(point.line).trim() !== ""
    && Number.isFinite(Number(point.line))).sort((a, b) => stamp(a.snapshotTime) - stamp(b.snapshotTime));
  const conflicting = history.some((point, i) => i > 0 && stamp(point.snapshotTime) === stamp(history[i - 1].snapshotTime)
    && Number(point.line) !== Number(history[i - 1].line));
  if (conflicting) return { opening: null, net: 0, last: 0, movedAt: "", ticketsAtMove: null, historyAvailable: false };
  const opening = context?.openingLine;
  const opener = history.find(point => Number(point.line) === opening);
  const knownOpening = finite(opening) && ((stamp(context?.openingAt) < at) || Boolean(opener));
  const sign = side.market === "Total" && side.side === "Over" ? 1 : -1;
  const net = knownOpening && finite(side.line) ? (side.line - opening!) * sign : 0;
  let last = 0, movedAt = "", ticketsAtMove: number | null = null;
  for (let i = 1; i < history.length; i++) {
    const change = Number(history[i].line) - Number(history[i - 1].line);
    if (Math.abs(change) < 1e-9) continue;
    last = change * sign; movedAt = String(history[i].snapshotTime);
    const tickets = history[i].betsPct;
    ticketsAtMove = tickets != null && String(tickets).trim() !== "" && Number.isFinite(Number(tickets)) ? Number(tickets) : null;
  }
  return { opening: knownOpening ? opening! : null, net, last, movedAt, ticketsAtMove, historyAvailable: history.length > 1 };
}

function inputs(side: ContextSide, sport: TrialSport) {
  const context = side.marketContext, history = contextLineHistory(side);
  const percentage = (value: unknown) => finite(value) && value > 0 && value < 100 ? (value - 50) / 50 : 0;
  const tickets = percentage(context?.bets), money = percentage(context?.money);
  const gap = finite(context?.money) && finite(context?.bets) && context.money > 0 && context.money < 100
    && context.bets > 0 && context.bets < 100 ? bound((context.money - context.bets) / 50) : 0;
  const line = bound(history.net / 5), lastMove = bound(history.last / 5);
  const role = teamStrength(side, "betType"), venue = teamStrength(side, "venue"), recent = teamStrength(side, "recent");
  const teams = capturedTeams(side), score = teams.length && finite(side.teamTrend?.score) ? (side.teamTrend!.score! - 50) / 50 : 0;
  const model = side.signals.find(signal => signal.key === "model");
  const edge = modelAvailable(side) && finite(model?.value) ? bound(model.value / 15) : 0;
  const qualified = modelAvailable(side) && model?.active ? 1 : 0;
  const schedule = side.sosContext, age = contextAt(side) - stamp(schedule?.capturedAt);
  const sos = sport === "NCAAF" && side.market === "Spread" && finite(schedule?.gap) && age >= 0 && age <= 86_400_000
    ? bound(schedule.gap / 100) : 0;
  const form = side.contextModelForm || emptyForm();
  const formStrength = bound(form.netUnits / (form.games + 8));
  return { tickets, money, gap, line, lastMove, role, venue, recent, score, edge, qualified, sos, formStrength, history };
}

export const CONTEXT_FEATURE_NAMES = ["Baseline", "Ticket share", "Money share", "Money above tickets", "Opening to final line",
  "Latest line move", "Team role record", "Team venue record", "Team recent form", "Combined team trends", "Model edge",
  "Qualified model play", "Schedule strength", "Model edge with earlier model form", "Line movement against tickets",
  "Line movement against the model", "Line movement against team trends", "Team form against the model",
  "Schedule advantage with recent form", "Schedule advantage with venue form", "Latest move against the model"];

export const CONTEXT_FEATURE_SET: TrialFeatureSet = {
  version: MATCHUP_CONTEXT_VERSION, names: CONTEXT_FEATURE_NAMES,
  identity: side => {
    const context = side as ContextSide;
    return [context.teamTrend, context.marketContext, context.modelContext, context.sosContext, context.contextModelForm,
      ...(context.contextAsOf ? [context.contextAsOf] : [])];
  },
  values: (raw, sport) => {
    const x = inputs(raw as ContextSide, sport);
    return [1, x.tickets, x.money, x.gap, x.line, x.lastMove, x.role, x.venue, x.recent, x.score, x.edge, x.qualified, x.sos,
      x.edge * x.formStrength, x.line * Math.max(0, -x.tickets), x.line * Math.max(0, -x.edge),
      x.line * Math.max(0, -x.score), x.recent * Math.max(0, -x.edge), x.sos * Math.max(0, x.recent),
      x.sos * Math.max(0, x.venue), x.lastMove * Math.max(0, -x.edge)];
  },
};

type FormSample = { date: string; id: string; key: string; gameTime: string; knownAt: number; result: string; profit: number };
function formSamples(sport: ContextSport, sides: ContextSide[], cutoff: number): FormSample[] {
  return trialPairedMarkets(sides, sport, cutoff, CONTEXT_FEATURE_SET).values.flatMap(pair => {
    if (!Number.isFinite(pair.knownAt) || pair.knownAt >= cutoff) return [];
    const qualified = [pair.a, pair.b].filter(side => side.signals.some(signal => signal.key === "model" && signal.active && signal.available));
    if (qualified.length !== 1) return [];
    const side = qualified[0] as ContextSide;
    if (!modelAvailable(side) || !side.result) return [];
    return [{ date: side.date, id: side.id, key: formKey(side), gameTime: side.gameTime, knownAt: pair.knownAt, result: side.result,
      profit: side.result === "L" ? -1 : side.result === "P" ? 0 : Number(side.odds) > 0 ? Number(side.odds) / 100 : 100 / Math.abs(Number(side.odds)) }];
  }).sort((a, b) => a.date.localeCompare(b.date) || a.gameTime.localeCompare(b.gameTime) || a.knownAt - b.knownAt || a.id.localeCompare(b.id));
}

function summarizeForm(samples: FormSample[], key: string, date: string, cutoff: number): ModelForm {
  const rows = samples.filter(row => row.key === key && row.date < date && row.knownAt < cutoff).slice(-20);
  return { wins: rows.filter(row => row.result === "W").length, losses: rows.filter(row => row.result === "L").length,
    pushes: rows.filter(row => row.result === "P").length, games: rows.length,
    netUnits: rows.reduce((sum, row) => sum + row.profit, 0) };
}

/** Every training row gets the model form that was known before its own snapshot. */
export function buildContextModel(sport: ContextSport, date: string, sides: ContextSide[], now: number): ContextModel {
  const cutoff = trialDayStart(date);
  const earlier = sides.filter(side => side.date < date && stamp(side.snapshotAt) < cutoff);
  const samples = formSamples(sport, earlier, cutoff);
  const training = earlier.map(side => ({ ...side, contextModelForm: summarizeForm(samples, formKey(side), side.date, stamp(side.snapshotAt)) }));
  const modelForms = Object.fromEntries([...new Set(earlier.map(formKey))].sort().map(key => [key, summarizeForm(samples, key, date, cutoff)]));
  const model = buildTrialModel(sport, date, training, now, undefined, CONTEXT_FEATURE_SET);
  return { ...model, id: `${model.id}|${trialDigest(modelForms)}`, modelForms };
}

export function contextCase(side: ContextSide, sport: ContextSport): ContextCase {
  const x = inputs(side, sport), evidence: ContextEvidence[] = [], missing: string[] = [];
  const add = (label: string, value: string, strength: number, sample: number | null = null) => {
    evidence.push({ label, value, direction: direction(strength), sample });
  };
  const market = side.marketContext;
  if (finite(market?.bets) && finite(market?.money)) add(side.recorded ? "Final betting split" : "Current betting split", `${market.bets}% tickets · ${market.money}% money`, x.gap);
  else missing.push("Betting splits unavailable");
  if (x.history.opening != null) add("Tracked line", `${x.history.opening} → ${side.line}`, x.line);
  else missing.push("Opening line timing unavailable");
  if (x.history.movedAt) add("Latest line move", `${x.history.movedAt} · ${x.history.ticketsAtMove ?? "Unknown"}% tickets on this side at the move`, x.lastMove);
  const teamRecords = capturedTeamRecords(side);
  for (const team of teamRecords) {
    for (const category of ["betType", "venue", "recent"] as const) {
      const record = team.records[category];
      add(`${team.team} · ${record.label}`, record.record, recordStrength(record) * (team.opposing ? -1 : 1), record.sample);
    }
    if (team.missingGames > 0) {
      add(`${team.team} · Record coverage`, `${team.trackedGames} of ${team.seasonGames} season games graded`, 0, team.trackedGames);
      missing.push(`${team.team}: ${team.missingGames} season ${team.missingGames === 1 ? "game has" : "games have"} no graded market record; team-record scoring waits for complete coverage`);
    }
  }
  if (!teamRecords.length) missing.push("Team records unavailable at the review cutoff");
  else if (teamRecords.length < 2) missing.push("Only one team has graded market records; team-record scoring waits for both teams");
  if (modelAvailable(side)) {
    add("Saved model", `${side.modelContext!.grade} · edge ${side.signals.find(signal => signal.key === "model")?.value ?? "Unknown"} points at this line`, x.edge);
    const form = side.contextModelForm || emptyForm();
    add("Earlier qualified model results", `${form.wins}–${form.losses}–${form.pushes} · ${form.netUnits.toFixed(2)}u · same sport, market and model version`, x.edge * x.formStrength, form.games);
  } else missing.push("A usable pregame model projection is unavailable");
  if (x.sos) add("Schedule comparison", `${Math.abs(side.sosContext!.gap!)} rank places ${x.sos > 0 ? "tougher" : "easier"}`, x.sos);
  const directions = [["Line movement", x.line || x.lastMove], ["Public tickets", x.tickets], ["Team trends", x.score],
    ["Model projection", x.edge], ["Schedule strength", x.sos]] as const;
  const disagreements: string[] = [];
  directions.forEach(([a, first], i) => directions.slice(i + 1).forEach(([b, second]) => {
    if (Math.abs(first) >= 0.05 && Math.abs(second) >= 0.05 && first * second < 0) disagreements.push(`${a} and ${b.toLowerCase()} point in opposite directions`);
  }));
  return { id: side.id, selection: side.selection, evidence, disagreements, missing,
    metrics: { tickets: finite(market?.bets) ? market.bets : null, money: finite(market?.money) ? market.money : null,
      moneyGap: finite(market?.bets) && finite(market?.money) ? market.money - market.bets : null,
      openingLine: x.history.opening,
      teamScore: capturedTeams(side).length && finite(side.teamTrend?.score) ? side.teamTrend!.score : null,
      modelEdge: modelAvailable(side) ? side.signals.find(signal => signal.key === "model")?.value ?? null : null,
      modelProjection: modelAvailable(side) ? side.modelContext!.projection : null,
      activeSignals: side.signals.filter(signal => signal.active && signal.available).map(signal => signal.key) } };
}

export function buildContextDecisions(model: ContextModel, sides: ContextSide[], incumbentIds: string[], now: number): ContextDecision[] {
  return compareContext(model, sides, incumbentIds, now, false);
}

export function buildContextPreviews(model: ContextModel, sides: ContextSide[], incumbentIds: string[], now: number): ContextReview[] {
  return compareContext(model, sides, incumbentIds, now, true).map(decision => ({ ...decision, reviewStatus: "PENDING" }));
}

function compareContext(model: ContextModel, sides: ContextSide[], incumbentIds: string[], now: number, preview: boolean): ContextDecision[] {
  const enriched = sides.map(side => ({ ...side, contextAsOf: preview ? new Date(now).toISOString() : undefined,
    contextModelForm: model.modelForms[formKey(side)] || emptyForm() }));
  const byId = new Map(enriched.map(side => [side.id, side]));
  // The saved quote must originate in the 10–20 minute window, but a slow
  // collector may finish after that window. Never finalize at/after kickoff.
  const decisions = preview ? buildTrialPreviews(model, enriched, incumbentIds, now, CONTEXT_FEATURE_SET)
    : buildTrialDecisions(model, enriched, incumbentIds, now, CONTEXT_FEATURE_SET, true);
  return decisions.map(decision => ({ ...decision,
    cases: decision.estimates.map(estimate => contextCase(byId.get(estimate.id)!, model.sport as ContextSport)) }));
}

export function validContextModel(model: ContextModel, sport: ContextSport, date: string) {
  return model.version === MATCHUP_CONTEXT_VERSION && model.sport === sport && model.date === date
    && JSON.stringify(model.featureNames) === JSON.stringify(CONTEXT_FEATURE_NAMES) && model.modelForms != null
    && model.trainingCutoff === new Date(trialDayStart(date)).toISOString() && model.models.length === 2
    && ["Spread", "Total"].every(market => model.models.some(fit => fit.market === market))
    && Object.values(model.modelForms).every(form => [form.wins, form.losses, form.pushes, form.games].every(value => Number.isSafeInteger(value) && value >= 0)
      && form.games === form.wins + form.losses + form.pushes && Number.isFinite(form.netUnits))
    && model.models.every(market => market.beta.length === CONTEXT_FEATURE_NAMES.length && market.beta.every(Number.isFinite)
      && market.covariance.length === CONTEXT_FEATURE_NAMES.length && market.covariance.every(row => row.length === CONTEXT_FEATURE_NAMES.length && row.every(Number.isFinite)));
}

