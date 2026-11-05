import type { FadeDecision } from "./selectionFade";

/** Pure, versioned expected-value challenger. Never used by the official selector. */
export const SELECTION_TRIAL_VERSION = "selection-trial-2026-11-04-v1";
export const FADE_TRIAL_VERSION = "selection-fade-2026-11-04-v1";
export const TRIAL_POLICY = {
  ridge: 16, interceptRidge: 32, minTrainingGames: 40, minTrainingDates: 4,
  minCalibrationGames: 20, minCalibrationDates: 3, conservativeRoi: .02,
  uncertaintyZ: 1.281551565545, worstOdds: -150,
} as const;
/** Separate paper strategy. Never reinterpret an older frozen card as a new bet. */
export const OPPOSITE_TRIAL_POLICY = {
  version: "selection-opposite-test-2026-11-04-v1", minRawRoi: .02,
} as const;
export type TrialSport = "MLB" | "NFL" | "NCAAF" | "NBA" | "NCAAM";
export type TrialMarket = "Moneyline" | "Spread" | "Total";
export type TrialResult = "W" | "L" | "P" | "";
export type TrialSide = {
  id: string; date: string; gameKey: string; game: string; gameTime: string; scheduledGameTime?: string;
  market: TrialMarket; side: string; selection: string; line: number | null; odds: string;
  status: string; recorded: boolean; snapshotAt: string; policyVersion?: string; researchOrigin?: string;
  oddsAssumed?: boolean; lineSource?: unknown;
  publicTypeIds?: string[]; publicMatches?: { signal?: string }[];
  signals: { key: string; active: boolean; available: boolean; value?: number | null }[];
  result: TrialResult; resultUpdated: string;
};
export const TRIAL_FEATURES = ["baseline", "money", "movement", "publicLegacy", "publicGrouped", "team", "model", "sos",
  "moneyStrength", "movementStrength", "teamStrength", "modelStrength", "sosStrength", "marketWithModel", "marketWithTeam"];
type Pair = { key: string; date: string; gameKey: string; market: TrialMarket; a: TrialSide; b: TrialSide;
  x: number[]; offset: number; y: number | null; push: boolean; knownAt: number; };
export type TrialPairedMarket = Pair;
export type TrialCalibrationObservation = { date: string; gameKey: string; market: TrialMarket;
  knownAt: number; offset: number; margin: number; y: number; a: TrialSide; b: TrialSide; pushProbability: number };
type Fit = { beta: number[]; covariance: number[][]; games: number; dates: number; converged: boolean; };
export type TrialMarketModel = Fit & {
  market: TrialMarket; calibrationGames: number; calibrationDates: number; calibrationShrink: number;
  outOfTimeBrier: number | null; marketBrier: number | null; outOfTimeLogLoss: number | null;
  integerPushes: number; integerGames: number; trainingDigest: string;
  status: "Collecting training history" | "Collecting calibration history" | "Model fit unavailable" | "No supported edge yet" | "Trial estimates available";
};
export type TrialModel = { version: string; id: string; sport: TrialSport; date: string; createdAt: string;
  trainingCutoff: string; featureNames: string[]; models: TrialMarketModel[];
  sourceSides: number; acceptedPairs: number; rejectedSides: number; pendingDates?: string[]; };
export type TrialEstimate = {
  id: string; game: string; market: TrialMarket; selection: string; line: number | null; odds: string;
  quoteAt: string; priceBasis: "Assumed -110" | "Observed" | "Unverified provenance";
  probability: number; conservativeProbability: number; pushProbability: number;
  expectedRoi: number; conservativeRoi: number; eligible: boolean; reasons: string[];
  contributions: { feature: string; value: number }[];
};
export type TrialOutcome = { result: Exclude<TrialResult, "">; knownAt: string };
export type TrialPaperComparison = {
  version: string; candidateId: string | null; rawPickId: string | null; oppositePickId: string | null;
  rawEstimates: { id: string; probability: number; expectedRoi: number }[];
  reason: string;
  validation: { market: TrialMarket; games: number; dates: number; retainedWeight: number;
    rawBrier: number | null; marketBrier: number | null } | null;
};
export type TrialDecision = {
  version: string; modelId: string; sport: TrialSport; date: string; gameKey: string; game: string;
  gameTime: string; capturedAt: string; sourceSnapshotAt: string; trainingCutoff: string;
  estimates: TrialEstimate[]; pickId: string | null; incumbentId: string | null;
  outcomes: Record<string, TrialOutcome>;
  paperComparison?: TrialPaperComparison;
  fadeComparison?: FadeDecision;
};

const keys = ["money", "move", "system", "team", "model", "sos"];
const clamp = (n: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, n));
const sigmoid = (n: number) => 1 / (1 + Math.exp(-clamp(n, -30, 30)));
const logit = (p: number) => Math.log(clamp(p, .001, .999) / (1 - clamp(p, .001, .999)));
const dot = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + v * b[i], 0);
export const trialDate = (now: number) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date(now));
export function trialDayStart(date: string) {
  const target = Date.parse(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(target) || new Date(target).toISOString().slice(0, 10) !== date) throw new Error("Invalid trial date");
  let value = target;
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit",
      day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
    const part = (key: string) => parts.find(p => p.type === key)!.value;
    value += target - Date.parse(`${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}Z`);
  }
  return value;
}
export function trialDigest(value: unknown) {
  let h = 2166136261;
  for (const c of JSON.stringify(value)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, "0");
}
export function trialOdds(odds: string | number) {
  if (String(odds).trim() === "") return null;
  const n = Number(odds);
  return Number.isFinite(n) && Math.abs(n) >= 100 && Math.abs(n) <= 10000
    ? { odds: n, profit: n < 0 ? 100 / -n : n / 100, implied: n < 0 ? -n / (100 - n) : 100 / (100 + n) } : null;
}
function kickoff(side: TrialSide) { return Date.parse(side.scheduledGameTime || side.gameTime); }
function validSide(s: TrialSide, now: number) {
  const at = Date.parse(s.snapshotAt), start = kickoff(s);
  if (!Array.isArray(s.signals) || s.signals.some(v => !v || typeof v.active !== "boolean" || typeof v.available !== "boolean")) return false;
  const active = s.signals.filter(v => v.active);
  return Boolean(s.id && s.gameKey && s.game && s.selection && /^\d{4}-\d{2}-\d{2}$/.test(s.date)
    && s.policyVersion && !s.researchOrigin && !s.lineSource && s.recorded && s.status === "FINAL_PREGAME"
    && Number.isFinite(at) && at <= now && Number.isFinite(start) && trialDate(start) === s.date
    && start - at >= 600000 && start - at <= 1200000 && trialOdds(s.odds)
    && ["Moneyline", "Spread", "Total"].includes(s.market)
    && (s.market === "Moneyline" || (s.line != null && Number.isFinite(s.line) && Number.isInteger(s.line * 2)
      && (s.market !== "Total" || s.line > 0)))
    && s.signals.length <= keys.length
    && new Set(s.signals.map(v => v.key)).size === s.signals.length && s.signals.every(v => keys.includes(v.key))
    && active.every(v => v.available));
}
function sideFeatures(side: TrialSide, sport: TrialSport) {
  const active = (key: string) => Number(side.signals.some(s => s.key === key && s.active && s.available));
  const strength = (key: string, scale: number) => {
    const signal = side.signals.find(s => s.key === key);
    return signal?.available && typeof signal.value === "number" && Number.isFinite(signal.value) ? clamp(signal.value / scale) : 0;
  };
  const grouped = String(side.policyVersion).includes("grouped");
  const market = Math.max(active("money"), active("move"), active("system"));
  return [1, active("money"), active("move"), grouped ? 0 : active("system"), grouped ? active("system") : 0,
    active("team"), active("model"), active("sos"), strength("money", 50), strength("move", sport === "MLB" ? 1 : 5),
    strength("team", 100), strength("model", sport === "MLB" ? 3 : 15), strength("sos", 100),
    market * active("model"), market * active("team")];
}
function outcome(s: TrialSide, cutoff: number) {
  const at = /(?:Z|[+-]\d{2}:?\d{2}|EDT|EST)$/i.test(s.resultUpdated) ? Date.parse(s.resultUpdated) : NaN;
  return /^[WLP]$/.test(s.result) && Number.isFinite(at) && at > kickoff(s) && at < cutoff ? s.result : "";
}
function pairs(sides: TrialSide[], sport: TrialSport, now: number): { values: Pair[]; rejected: number } {
  const byId = new Map<string, TrialSide>(), conflicts = new Set<string>();
  let rejected = 0;
  for (const side of sides) {
    if (!validSide(side, now)) { rejected++; continue; }
    const previous = byId.get(side.id);
    const identity = (s: TrialSide) => JSON.stringify([s.date, s.gameKey, s.market, s.side, s.selection, s.line, s.odds,
      s.snapshotAt, s.gameTime, s.scheduledGameTime, s.policyVersion, s.signals]);
    if (previous && identity(previous) !== identity(side)) conflicts.add(side.id);
    else if (!previous || (Date.parse(side.resultUpdated) || -Infinity) > (Date.parse(previous.resultUpdated) || -Infinity)) byId.set(side.id, side);
  }
  const groups = new Map<string, TrialSide[]>();
  for (const side of byId.values()) {
    if (conflicts.has(side.id)) { rejected++; continue; }
    const key = `${side.date}|${side.gameKey}|${side.market}`;
    groups.set(key, [...(groups.get(key) || []), side]);
  }
  const values: Pair[] = [];
  for (const [key, g] of groups) {
    if (g.length !== 2) { rejected += g.length; continue; }
    g.sort((a, b) => a.id.localeCompare(b.id));
    if (g[0].market === "Total") g.sort((a, b) => Number(/^Over$/i.test(b.side)) - Number(/^Over$/i.test(a.side)));
    else if (g[0].market === "Spread") g.sort((a, b) => a.line! - b.line! || a.id.localeCompare(b.id));
    else g.sort((a, b) => trialOdds(b.odds)!.implied - trialOdds(a.odds)!.implied || a.id.localeCompare(b.id));
    const [a, b] = g;
    if (kickoff(a) !== kickoff(b) || a.policyVersion !== b.policyVersion || a.side === b.side
      || Math.abs(Date.parse(a.snapshotAt) - Date.parse(b.snapshotAt)) > 60000
      || (a.market === "Total" && (!/^Over$/i.test(a.side) || !/^Under$/i.test(b.side) || a.line !== b.line))
      || (a.market === "Spread" && Math.abs(a.line! + b.line!) > .00001)) { rejected += 2; continue; }
    const qa = trialOdds(a.odds)!, qb = trialOdds(b.odds)!, fa = sideFeatures(a, sport), fb = sideFeatures(b, sport);
    const ra = outcome(a, now), rb = outcome(b, now);
    const coherent = (ra === "W" && rb === "L") || (ra === "L" && rb === "W") || (ra === "P" && rb === "P");
    if (ra && rb && !coherent) { rejected += 2; continue; }
    values.push({ key, date: a.date, gameKey: a.gameKey, market: a.market, a, b,
      x: fa.map((v, i) => i ? (v - fb[i]) / 2 : 1), offset: logit(qa.implied / (qa.implied + qb.implied)),
      y: coherent && ra !== "P" ? Number(ra === "W") : null, push: coherent && ra === "P",
      knownAt: coherent ? Math.max(Date.parse(a.resultUpdated), Date.parse(b.resultUpdated)) : Infinity });
  }
  return { values, rejected };
}
export function trialPairedMarkets(sides: TrialSide[], sport: TrialSport, now: number) {
  return pairs(sides, sport, now);
}
function inverse(matrix: number[][]) {
  const n = matrix.length, a = matrix.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => Number(i === j))]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    if (Math.abs(a[col][col]) < 1e-10) throw new Error("Trial fit is singular");
    const scale = a[col][col]; a[col] = a[col].map(v => v / scale);
    for (let row = 0; row < n; row++) if (row !== col) {
      const factor = a[row][col]; a[row] = a[row].map((v, j) => v - factor * a[col][j]);
    }
  }
  return a.map(row => row.slice(n));
}
function fit(rows: Pair[]): Fit {
  const n = TRIAL_FEATURES.length, beta = Array(n).fill(0), diagonal = (i: number) => i ? TRIAL_POLICY.ridge : TRIAL_POLICY.interceptRidge;
  let covariance: number[][] = [], converged = false;
  const loss = (values: number[]) => values.reduce((sum, v, i) => sum + diagonal(i) * v * v / 2, 0)
    + rows.reduce((sum, row) => { const eta = row.offset + dot(values, row.x);
      return sum + (eta > 0 ? eta + Math.log1p(Math.exp(-eta)) : Math.log1p(Math.exp(eta))) - row.y! * eta; }, 0);
  for (let step = 0; step < 30; step++) {
    const gradient = beta.map((v, i) => diagonal(i) * v);
    const hessian = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i === j ? diagonal(i) : 0));
    for (const row of rows) {
      const p = sigmoid(row.offset + dot(beta, row.x)), residual = p - row.y!;
      for (let i = 0; i < n; i++) {
        gradient[i] += residual * row.x[i];
        for (let j = 0; j < n; j++) hessian[i][j] += p * (1 - p) * row.x[i] * row.x[j];
      }
    }
    covariance = inverse(hessian);
    const change = covariance.map(row => dot(row, gradient));
    const before = loss(beta);
    let rate = 1;
    while (rate > 1 / 4096 && loss(beta.map((v, i) => v - rate * change[i])) > before + 1e-10) rate /= 2;
    if (rate <= 1 / 4096) break;
    for (let i = 0; i < n; i++) beta[i] -= rate * change[i];
    if (Math.max(...change.map(Math.abs)) * rate < 1e-8) { converged = true; break; }
  }
  return { beta, covariance, games: rows.length, dates: new Set(rows.map(row => row.date)).size, converged };
}
function enough(rows: Pair[]) { return rows.length >= TRIAL_POLICY.minTrainingGames && new Set(rows.map(r => r.date)).size >= TRIAL_POLICY.minTrainingDates; }

/** Earlier dates only; each fold also checks when each result became known. */
export function buildTrialModel(sport: TrialSport, date: string, sides: TrialSide[], createdAt: number,
  observeCalibration?: (market: TrialMarket, rows: TrialCalibrationObservation[]) => void): TrialModel {
  const cutoff = trialDayStart(date), raw = pairs(sides, sport, cutoff);
  const eligible = raw.values.filter(p => p.date < date && p.knownAt < cutoff).sort((a, b) => a.key.localeCompare(b.key));
  const markets: TrialMarket[] = sport === "MLB" ? ["Moneyline", "Total"] : ["Spread", "Total"];
  const models = markets.map(market => {
    const pool = eligible.filter(p => p.market === market), rows = pool.filter(p => p.y != null);
    const fitted = fit(rows), calibration: TrialCalibrationObservation[] = [];
    for (const day of [...new Set(rows.map(p => p.date))].sort()) {
      const dayCutoff = trialDayStart(day);
      const previous = rows.filter(p => p.date < day && p.knownAt < dayCutoff);
      if (!enough(previous)) continue;
      const f = fit(previous);
      if (!f.converged) continue;
      const earlierIntegers = pool.filter(p => p.date < day && p.knownAt < dayCutoff
        && p.a.market !== "Moneyline" && Number.isInteger(p.a.line));
      const pushRate = (earlierIntegers.filter(p => p.push).length + 1) / (earlierIntegers.length + 50);
      for (const row of rows.filter(p => p.date === day)) calibration.push({ date: day, gameKey: row.gameKey, market,
        knownAt: row.knownAt, offset: row.offset, margin: dot(f.beta, row.x), y: row.y!, a: row.a, b: row.b,
        pushProbability: row.a.market !== "Moneyline" && Number.isInteger(row.a.line) ? pushRate : 0 });
    }
    observeCalibration?.(market, calibration);
    // Fit only a shrink factor on prior chronological predictions. It cannot amplify an edge.
    let alpha = 0, best = Infinity;
    for (let step = 0; step <= 20; step++) {
      const value = step / 20;
      const loss = calibration.reduce((sum, row) => {
        const p = sigmoid(row.offset + value * row.margin);
        return sum - row.y * Math.log(p) - (1 - row.y) * Math.log(1 - p);
      }, 2 * value * value);
      if (loss < best - 1e-10) { best = loss; alpha = value; }
    }
    const n = calibration.length, dates = new Set(calibration.map(p => p.date)).size;
    const ready = enough(rows) && n >= TRIAL_POLICY.minCalibrationGames && dates >= TRIAL_POLICY.minCalibrationDates;
    return { ...fitted, market, calibrationGames: n, calibrationDates: dates, calibrationShrink: alpha,
      outOfTimeBrier: n ? calibration.reduce((s, r) => s + (sigmoid(r.offset + r.margin) - r.y) ** 2, 0) / n : null,
      marketBrier: n ? calibration.reduce((s, r) => s + (sigmoid(r.offset) - r.y) ** 2, 0) / n : null,
      outOfTimeLogLoss: n ? calibration.reduce((s, r) => { const p = sigmoid(r.offset + r.margin); return s - r.y * Math.log(p) - (1 - r.y) * Math.log(1 - p); }, 0) / n : null,
      integerPushes: pool.filter(p => p.push && p.a.market !== "Moneyline" && Number.isInteger(p.a.line)).length,
      integerGames: pool.filter(p => p.a.market !== "Moneyline" && Number.isInteger(p.a.line)).length,
      trainingDigest: trialDigest(rows.map(r => [r.key, r.x, r.offset, r.y, r.knownAt])),
      status: !fitted.converged ? "Model fit unavailable" : !enough(rows) ? "Collecting training history" : !ready ? "Collecting calibration history" : !alpha ? "No supported edge yet" : "Trial estimates available",
    } as TrialMarketModel;
  });
  const identity = [SELECTION_TRIAL_VERSION, sport, date, models];
  return { version: SELECTION_TRIAL_VERSION, id: `${SELECTION_TRIAL_VERSION}|${sport}|${date}|${trialDigest(identity)}`,
    sport, date, createdAt: new Date(createdAt).toISOString(), trainingCutoff: new Date(cutoff).toISOString(),
    featureNames: TRIAL_FEATURES, models, sourceSides: sides.length, acceptedPairs: eligible.length, rejectedSides: raw.rejected };
}
function estimate(pair: Pair, side: TrialSide, model: TrialMarketModel): TrialEstimate {
  const sign = side.id === pair.a.id ? 1 : -1, alpha = model.calibrationShrink;
  const margin = dot(model.beta, pair.x), eta = pair.offset + alpha * margin;
  const probability = sigmoid(sign * eta);
  const posteriorVariance = Math.max(0, dot(pair.x, model.covariance.map(row => dot(row, pair.x))));
  // A calibration sampling floor remains even when edge shrinkage is zero.
  const samplingSd = Math.sqrt(1 / (model.calibrationGames + 20));
  const sd = Math.max(Math.sqrt(posteriorVariance) * alpha, samplingSd);
  const conservativeProbability = sigmoid(sign * eta - TRIAL_POLICY.uncertaintyZ * sd);
  const integer = side.market !== "Moneyline" && Number.isInteger(side.line);
  const pushProbability = integer ? (model.integerPushes + 1) / (model.integerGames + 50) : 0;
  const quote = trialOdds(side.odds)!;
  const roi = (p: number) => (1 - pushProbability) * (p * quote.profit - (1 - p));
  const conservativeRoi = roi(conservativeProbability), reasons: string[] = [];
  if (model.status !== "Trial estimates available") reasons.push(model.status);
  if (quote.odds < TRIAL_POLICY.worstOdds) reasons.push("Price below -150 limit");
  if (conservativeRoi < TRIAL_POLICY.conservativeRoi) reasons.push("Insufficient edge after uncertainty and price");
  const contributions = TRIAL_FEATURES.map((feature, i) => ({ feature, value: sign * alpha * model.beta[i] * pair.x[i] }))
    .filter(r => Math.abs(r.value) > .0001).sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 5);
  return { id: side.id, game: side.game, market: side.market, selection: side.selection, line: side.line, odds: side.odds,
    quoteAt: side.snapshotAt, priceBasis: side.oddsAssumed === true ? "Assumed -110" : side.oddsAssumed === false ? "Observed" : "Unverified provenance",
    probability, conservativeProbability, pushProbability, expectedRoi: roi(probability), conservativeRoi,
    eligible: reasons.length === 0, reasons, contributions };
}

/** A mechanical reversal hypothesis, not an inferred profitable probability for the other side. */
function paperComparison(model: TrialModel, estimates: TrialEstimate[], raw: TrialEstimate[]): TrialPaperComparison {
  const candidate = raw.filter(e => e.expectedRoi >= OPPOSITE_TRIAL_POLICY.minRawRoi
    && trialOdds(e.odds)!.odds >= TRIAL_POLICY.worstOdds)
    .sort((a, b) => b.expectedRoi - a.expectedRoi || a.id.localeCompare(b.id))[0];
  const result: TrialPaperComparison = { version: OPPOSITE_TRIAL_POLICY.version,
    candidateId: candidate?.id || null, rawPickId: null, oppositePickId: null,
    rawEstimates: raw.map(({ id, probability, expectedRoi }) => ({ id, probability, expectedRoi })),
    reason: "No raw candidate reaches +2% estimated ROI at an eligible price.", validation: null };
  if (!candidate) return result;
  const fitted = model.models.find(m => m.market === candidate.market)!;
  result.validation = { market: fitted.market, games: fitted.calibrationGames, dates: fitted.calibrationDates,
    retainedWeight: fitted.calibrationShrink, rawBrier: fitted.outOfTimeBrier, marketBrier: fitted.marketBrier };
  if (!fitted.converged || fitted.games < TRIAL_POLICY.minTrainingGames || fitted.dates < TRIAL_POLICY.minTrainingDates) {
    result.reason = "The raw candidate needs a stable fit and enough earlier training games and dates.";
    return result;
  }
  result.rawPickId = candidate.id;
  if (estimates.find(e => e.id === candidate.id)!.eligible) {
    result.reason = "The strict trial accepts the raw candidate; no reversal is triggered.";
    return result;
  }
  if (fitted.calibrationGames < TRIAL_POLICY.minCalibrationGames || fitted.calibrationDates < TRIAL_POLICY.minCalibrationDates) {
    result.reason = "Not enough later-date validation history to test a reversal.";
    return result;
  }
  if (fitted.status !== "No supported edge yet" || fitted.calibrationShrink !== 0) {
    result.reason = "Calibration retains the learned direction. An uncertainty-only rejection does not trigger a reversal.";
    return result;
  }
  if (fitted.outOfTimeBrier == null || fitted.marketBrier == null || fitted.outOfTimeBrier <= fitted.marketBrier + 1e-12) {
    result.reason = "The raw probability error is not worse than the market baseline; no reversal is triggered.";
    return result;
  }
  const opposite = estimates.find(e => e.market === candidate.market && e.id !== candidate.id)!;
  if (trialOdds(opposite.odds)!.odds < TRIAL_POLICY.worstOdds) {
    result.reason = "The opposite side is below the -150 price limit.";
    return result;
  }
  result.oppositePickId = opposite.id;
  result.reason = "Paper reversal: calibration retains zero learned adjustment and earlier raw probability error exceeds the market baseline. This does not establish a profitable opposite-side probability.";
  return result;
}

/** Freeze only complete, contemporaneous game cards while still in the final window. */
export function buildTrialDecisions(model: TrialModel, sides: TrialSide[], incumbentIds: string[], now: number): TrialDecision[] {
  if (model.version !== SELECTION_TRIAL_VERSION || trialDate(now) !== model.date || Date.parse(model.createdAt) > now) return [];
  const values = pairs(sides.filter(s => s.date === model.date), model.sport, now).values;
  const groups = new Map<string, Pair[]>();
  for (const pair of values) groups.set(pair.gameKey, [...(groups.get(pair.gameKey) || []), pair]);
  const decisions: TrialDecision[] = [];
  for (const [gameKey, group] of groups) {
    const expected = model.sport === "MLB" ? ["Moneyline", "Total"] : ["Spread", "Total"];
    const quotes = group.flatMap(pair => [pair.a, pair.b]);
    const times = quotes.map(kickoff), snapshots = quotes.map(s => Date.parse(s.snapshotAt));
    if (group.length !== 2 || expected.some(m => !group.some(p => p.market === m)) || new Set(times).size !== 1
      || times[0] - now < 600000 || times[0] - now > 1200000 || quotes.some(s => s.result)
      || Math.max(...snapshots) - Math.min(...snapshots) > 60000) continue;
    const estimates = group.flatMap(pair => {
      const marketModel = model.models.find(m => m.market === pair.market);
      return marketModel ? [estimate(pair, pair.a, marketModel), estimate(pair, pair.b, marketModel)] : [];
    });
    if (estimates.length !== 4) continue;
    const raw = group.flatMap(pair => {
      const marketModel = { ...model.models.find(m => m.market === pair.market)!, calibrationShrink: 1 };
      return [estimate(pair, pair.a, marketModel), estimate(pair, pair.b, marketModel)];
    });
    const candidates = estimates.filter(e => e.eligible).sort((a, b) => b.conservativeRoi - a.conservativeRoi
      || b.expectedRoi - a.expectedRoi || a.id.localeCompare(b.id));
    const incumbent = estimates.filter(e => incumbentIds.includes(e.id));
    decisions.push({ version: SELECTION_TRIAL_VERSION, modelId: model.id, sport: model.sport, date: model.date,
      gameKey, game: quotes[0].game, gameTime: new Date(times[0]).toISOString(), capturedAt: new Date(now).toISOString(),
      sourceSnapshotAt: new Date(Math.max(...snapshots)).toISOString(), trainingCutoff: model.trainingCutoff,
      estimates, pickId: candidates[0]?.id || null, incumbentId: incumbent.length === 1 ? incumbent[0].id : null, outcomes: {},
      paperComparison: paperComparison(model, estimates, raw) });
  }
  return decisions;
}
/** Settlement can change outcomes only. Quotes, model inputs and selection stay frozen. */
export function settleTrialDecision(decision: TrialDecision, sides: TrialSide[], now: number): TrialDecision {
  const outcomes = { ...decision.outcomes };
  for (const prediction of decision.estimates) {
    const matching = sides.filter(s => s.id === prediction.id && s.date === decision.date && s.gameKey === decision.gameKey
      && s.line === prediction.line && s.odds === prediction.odds && s.selection === prediction.selection
      && s.snapshotAt === prediction.quoteAt && kickoff(s) === Date.parse(decision.gameTime) && validSide(s, now));
    const labels = matching.map(s => outcome(s, now + 1)).filter(Boolean);
    if (!labels.length || new Set(labels).size !== 1) continue;
    const source = matching.find(s => s.result === labels[0])!;
    if ((!outcomes[prediction.id] || outcomes[prediction.id].result !== source.result)
      && (!outcomes[prediction.id] || Date.parse(source.resultUpdated) >= Date.parse(outcomes[prediction.id].knownAt))) outcomes[prediction.id] = {
      result: source.result as Exclude<TrialResult, "">, knownAt: source.resultUpdated,
    };
  }
  return JSON.stringify(outcomes) === JSON.stringify(decision.outcomes) ? decision : { ...decision, outcomes };
}
export function trialRecord(decisions: TrialDecision[], type: "trial" | "incumbent" | "raw" | "opposite" | "fade") {
  let wins = 0, losses = 0, pushes = 0, pending = 0, units = 0, assumedPrices = 0, unverifiedPrices = 0;
  for (const d of decisions) {
    const paper = d.paperComparison?.version === OPPOSITE_TRIAL_POLICY.version ? d.paperComparison : null;
    const id = type === "trial" ? d.pickId : type === "incumbent" ? d.incumbentId
      : type === "raw" ? paper?.rawPickId : type === "opposite" ? paper?.oppositePickId
      : d.fadeComparison?.version === FADE_TRIAL_VERSION ? d.fadeComparison.pickId : null;
    const estimate = d.estimates.find(e => e.id === id);
    if (!estimate) continue;
    if (estimate.priceBasis === "Assumed -110") assumedPrices++;
    if (estimate.priceBasis === "Unverified provenance") unverifiedPrices++;
    const result = d.outcomes[id!]?.result;
    if (result === "W") { wins++; units += trialOdds(estimate.odds)!.profit; }
    else if (result === "L") { losses++; units--; } else if (result === "P") pushes++; else pending++;
  }
  const settled = wins + losses + pushes;
  return { record: `${wins}-${losses}-${pushes}`, wins, losses, pushes, pending, settled, netUnits: units,
    roiPct: settled ? units / settled * 100 : null, assumedPrices, unverifiedPrices };
}
