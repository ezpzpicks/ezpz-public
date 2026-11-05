import { buildTrialModel, trialDayStart, trialDigest, trialOdds, trialPairedMarkets, FADE_TRIAL_VERSION,
  TRIAL_POLICY, type TrialCalibrationObservation, type TrialDecision, type TrialEstimate, type TrialMarket,
  type TrialModel, type TrialPairedMarket, type TrialSide, type TrialSport } from "./selectionTrial";

/** Fixed before the requested replay. These are research settings, not tuned winning-pick thresholds. */
export const FADE_POLICY = {
  version: FADE_TRIAL_VERSION, globalPenalty: 2, combinationPenalty: 4, publicTypePenalty: 8,
  minLocalGames: 10, minLocalDates: 3, minValidationGames: 20, minValidationDates: 3,
  minRawRoi: .02, conservativeRoi: .02, uncertaintyZ: TRIAL_POLICY.uncertaintyZ,
  worstOdds: TRIAL_POLICY.worstOdds, samplingPriorGames: 20,
} as const;
type Context = { combination: string; publicTypeIds: string[] };
export type FadeSample = Context & { key: string; date: string; knownAt: number; offset: number;
  margin: number; y: number; rawRoi: number; sourceWins: boolean };
type SignedFit = { weight: number; variance: number };
type ContextFit = SignedFit & { level: "Sport and market" | "Signal combination" | "Public types";
  combinationGames: number; combinationDates: number; publicTypeGames: number; publicTypeDates: number };
export type FadeMarketModel = { market: TrialMarket; samples: FadeSample[]; weight: number;
  calibrationGames: number; calibrationDates: number; validationGames: number; validationDates: number;
  validationBrier: number | null; validationMarketBrier: number | null;
  rawPositiveGames: number; rawTwoPercentGames: number };
export type FadeModel = { version: string; id: string; sport: TrialSport; date: string;
  createdAt: string; trainingCutoff: string; baseModel: TrialModel; models: FadeMarketModel[] };
export type FadeEstimate = TrialEstimate & { sourceId: string; sourceSelection: string;
  sourceRawRoi: number; calibrationWeight: number; direction: "Follow" | "Neutral" | "Fade";
  supportLevel: ContextFit["level"]; combination: string; publicTypeIds: string[];
  support: { calibrationGames: number; calibrationDates: number; validationGames: number;
    validationDates: number; combinationGames: number; combinationDates: number;
    publicTypeGames: number; publicTypeDates: number; rawTwoPercentGames: number } };
export type FadeDecision = { version: string; modelId: string; estimates: FadeEstimate[]; pickId: string | null };
const sigmoid = (value: number) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, value))));
const dot = (a: number[], b: number[]) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const dates = (rows: FadeSample[]) => new Set(rows.map(row => row.date)).size;
const active = (side: TrialSide) => side.signals.filter(s => s.active && s.available).map(s => s.key).sort();
export function fadePublicTypeIds(side: TrialSide): string[] {
  if (!active(side).includes("system")) return [];
  const ids = Array.isArray(side.publicTypeIds) ? side.publicTypeIds
    : Array.isArray(side.publicMatches) ? side.publicMatches.map(m => m?.signal) : [];
  return [...new Set(ids
    .filter((id): id is string => typeof id === "string" && id.length > 0 && id.length < 1024))].sort();
}
function context(source: TrialSide, opposite: TrialSide): Context {
  const role = source.market === "Spread" ? source.line! < 0 ? "Favorite" : source.line! > 0 ? "Underdog" : "Pickem"
    : source.market === "Total" ? source.side : trialOdds(source.odds)!.implied >= trialOdds(opposite.odds)!.implied ? "Favorite" : "Underdog";
  const family = String(source.policyVersion).includes("grouped") ? "grouped" : "legacy";
  return { combination: `${source.market}|${role}|${active(source).join("+") || "none"}>${active(opposite).join("+") || "none"}|${family}`,
    publicTypeIds: fadePublicTypeIds(source) };
}
function rawSource(a: TrialSide, b: TrialSide, offset: number, margin: number, pushProbability = 0) {
  const p = sigmoid(offset + margin), qa = trialOdds(a.odds)!, qb = trialOdds(b.odds)!;
  const ea = (1 - pushProbability) * (p * qa.profit - (1 - p));
  const eb = (1 - pushProbability) * ((1 - p) * qb.profit - p);
  return ea > eb || (ea === eb && a.id.localeCompare(b.id) < 0)
    ? { source: a, opposite: b, roi: ea, sign: 1 } : { source: b, opposite: a, roi: eb, sign: -1 };
}
/** Signed logit adjustment: -1 reverses, zero uses market, +1 follows. */
function fitSigned(rows: FadeSample[], center = 0, penalty: number = FADE_POLICY.globalPenalty): SignedFit {
  let weight = 0, best = Infinity;
  for (let step = -20; step <= 20; step++) {
    const candidate = step / 20;
    const loss = rows.reduce((sum, row) => {
      const p = sigmoid(row.offset + candidate * row.margin);
      return sum - row.y * Math.log(p) - (1 - row.y) * Math.log(1 - p);
    }, penalty * (candidate - center) ** 2);
    if (loss < best - 1e-10 || (Math.abs(loss - best) <= 1e-10 && Math.abs(candidate) < Math.abs(weight))) {
      best = loss; weight = candidate;
    }
  }
  const curvature = rows.reduce((sum, row) => {
    const p = sigmoid(row.offset + weight * row.margin);
    return sum + p * (1 - p) * row.margin ** 2;
  }, 2 * penalty);
  return { weight, variance: 1 / curvature };
}
const contextFits = new WeakMap<FadeSample[], { global: SignedFit; values: Map<string, ContextFit> }>();
function fitContext(rows: FadeSample[], current: Context): ContextFit {
  let cached = contextFits.get(rows);
  if (!cached) { cached = { global: fitSigned(rows), values: new Map() }; contextFits.set(rows, cached); }
  const key = JSON.stringify([current.combination, current.publicTypeIds]);
  const existing = cached.values.get(key); if (existing) return existing;
  const global = cached.global, combination = rows.filter(row => row.combination === current.combination);
  const publicTypes = combination.filter(row => row.publicTypeIds.some(id => current.publicTypeIds.includes(id)));
  let result: ContextFit = { ...global, level: "Sport and market", combinationGames: combination.length,
    combinationDates: dates(combination), publicTypeGames: publicTypes.length, publicTypeDates: dates(publicTypes) };
  for (const [pool, penalty, level] of [[combination, FADE_POLICY.combinationPenalty, "Signal combination"],
    [publicTypes, FADE_POLICY.publicTypePenalty, "Public types"]] as const) {
    if (pool.length < FADE_POLICY.minLocalGames || dates(pool) < FADE_POLICY.minLocalDates) continue;
    const local = fitSigned(pool, result.weight, penalty);
    // Nested pools overlap: do not add their sample counts or treat them as independent precision.
    result = { ...result, weight: local.weight, variance: Math.max(result.variance, local.variance), level };
  }
  cached.values.set(key, result);
  return result;
}
function sample(row: TrialCalibrationObservation): FadeSample {
  const choice = rawSource(row.a, row.b, row.offset, row.margin, row.pushProbability);
  return { ...context(choice.source, choice.opposite), key: `${row.date}|${row.gameKey}|${row.market}`,
    date: row.date, knownAt: row.knownAt, offset: row.offset, margin: row.margin, y: row.y,
    rawRoi: choice.roi, sourceWins: choice.sign === 1 ? row.y === 1 : row.y === 0 };
}

export function validateFadeCalibration(rows: FadeSample[]) {
  const validation: { key: string; date: string; p: number; marketP: number; y: number }[] = [];
  for (const day of [...new Set(rows.map(row => row.date))].sort()) {
    const dayCutoff = trialDayStart(day);
    const earlier = rows.filter(row => row.date < day && row.knownAt < dayCutoff);
    if (earlier.length < TRIAL_POLICY.minCalibrationGames || dates(earlier) < TRIAL_POLICY.minCalibrationDates) continue;
    for (const row of rows.filter(row => row.date === day)) {
      const fit = fitContext(earlier, row);
      validation.push({ key: row.key, date: day, p: sigmoid(row.offset + fit.weight * row.margin), marketP: sigmoid(row.offset), y: row.y });
    }
  }
  return validation;
}

/** Only earlier dates/outcomes enter either the raw fit or the signed calibrator. */
export function buildFadeTrialModel(sport: TrialSport, date: string, sides: TrialSide[], createdAt: number): FadeModel {
  const observations = new Map<TrialMarket, TrialCalibrationObservation[]>();
  const baseModel = buildTrialModel(sport, date, sides, createdAt, (market, rows) => observations.set(market, rows));
  return buildFadeTrialFromBase(baseModel, observations, createdAt);
}

/** Reuses the collector's raw fit instead of fitting its historical folds twice. */
export function buildFadeTrialFromBase(baseModel: TrialModel,
  observations: Map<TrialMarket, TrialCalibrationObservation[]>, createdAt: number): FadeModel {
  const { sport, date } = baseModel;
  const models = baseModel.models.map(base => {
    const rows = (observations.get(base.market) || []).map(sample), validation = validateFadeCalibration(rows);
    return { market: base.market, samples: rows, weight: fitSigned(rows).weight,
      calibrationGames: rows.length, calibrationDates: dates(rows), validationGames: validation.length,
      validationDates: new Set(validation.map(row => row.date)).size,
      validationBrier: validation.length ? validation.reduce((s, r) => s + (r.p - r.y) ** 2, 0) / validation.length : null,
      validationMarketBrier: validation.length ? validation.reduce((s, r) => s + (r.marketP - r.y) ** 2, 0) / validation.length : null,
      rawPositiveGames: rows.filter(row => row.rawRoi > 0).length,
      rawTwoPercentGames: rows.filter(row => row.rawRoi >= FADE_POLICY.minRawRoi).length };
  });
  return { version: FADE_TRIAL_VERSION, id: `${FADE_TRIAL_VERSION}|${sport}|${date}|${trialDigest([baseModel.id, FADE_POLICY, models])}`,
    sport, date, createdAt: new Date(createdAt).toISOString(), trainingCutoff: baseModel.trainingCutoff, baseModel, models };
}

/** Scores are available for research even when entry/history requirements reject a selection. */
export function estimateFadeTrial(model: FadeModel, pair: TrialPairedMarket, side: TrialSide): FadeEstimate {
  const base = model.baseModel.models.find(m => m.market === pair.market)!, signed = model.models.find(m => m.market === pair.market)!;
  const pushProbability = side.market !== "Moneyline" && Number.isInteger(side.line)
    ? (base.integerPushes + 1) / (base.integerGames + 50) : 0;
  const margin = dot(base.beta, pair.x), source = rawSource(pair.a, pair.b, pair.offset, margin, pushProbability);
  const current = context(source.source, source.opposite), fit = fitContext(signed.samples, current);
  const sign = side.id === pair.a.id ? 1 : -1, eta = pair.offset + fit.weight * margin;
  const probability = sigmoid(sign * eta), betaVariance = Math.max(0, dot(pair.x, base.covariance.map(row => dot(row, pair.x))));
  // Approximate logit uncertainty includes fitted weights, signed calibration and a sampling floor.
  const variance = Math.max(fit.weight ** 2 * betaVariance + margin ** 2 * fit.variance,
    1 / (signed.validationGames + FADE_POLICY.samplingPriorGames));
  const conservativeProbability = sigmoid(sign * eta - FADE_POLICY.uncertaintyZ * Math.sqrt(variance));
  const quote = trialOdds(side.odds)!, roi = (p: number) => (1 - pushProbability) * (p * quote.profit - (1 - p));
  const reasons: string[] = [];
  if (!base.converged || base.games < TRIAL_POLICY.minTrainingGames || base.dates < TRIAL_POLICY.minTrainingDates) reasons.push("Insufficient stable training history");
  if (signed.calibrationGames < TRIAL_POLICY.minCalibrationGames || signed.calibrationDates < TRIAL_POLICY.minCalibrationDates) reasons.push("Insufficient signed calibration history");
  if (signed.validationGames < FADE_POLICY.minValidationGames || signed.validationDates < FADE_POLICY.minValidationDates) reasons.push("Insufficient later validation of the signed calibration");
  if (fit.weight >= 0) reasons.push(fit.weight ? "Calibration supports following the raw direction" : "Calibration found no supported direction");
  if (side.id !== source.opposite.id) reasons.push("This is the raw candidate, rather than its opposite");
  if (source.roi < FADE_POLICY.minRawRoi) reasons.push("Original raw candidate does not reach +2% estimated ROI");
  if (quote.odds < FADE_POLICY.worstOdds || trialOdds(source.source.odds)!.odds < FADE_POLICY.worstOdds) reasons.push("Price below -150 limit");
  if (roi(conservativeProbability) < FADE_POLICY.conservativeRoi) reasons.push("Fade ROI below +2% after uncertainty and price");
  return { id: side.id, game: side.game, market: side.market, selection: side.selection, line: side.line, odds: side.odds,
    quoteAt: side.snapshotAt, priceBasis: side.oddsAssumed === true ? "Assumed -110" : side.oddsAssumed === false ? "Observed" : "Unverified provenance",
    probability, conservativeProbability, pushProbability, expectedRoi: roi(probability), conservativeRoi: roi(conservativeProbability),
    eligible: reasons.length === 0, reasons, contributions: [], sourceId: source.source.id, sourceSelection: source.source.selection,
    sourceRawRoi: source.roi, calibrationWeight: fit.weight, direction: fit.weight < 0 ? "Fade" : fit.weight > 0 ? "Follow" : "Neutral",
    supportLevel: fit.level, combination: current.combination, publicTypeIds: current.publicTypeIds,
    support: { calibrationGames: signed.calibrationGames, calibrationDates: signed.calibrationDates,
      validationGames: signed.validationGames, validationDates: signed.validationDates,
      combinationGames: fit.combinationGames, combinationDates: fit.combinationDates,
      publicTypeGames: fit.publicTypeGames, publicTypeDates: fit.publicTypeDates, rawTwoPercentGames: signed.rawTwoPercentGames } };
}

/** Attaches a separately versioned estimate only to a newly captured, complete pregame card. */
export function buildFadeDecision(model: FadeModel, decision: TrialDecision, sides: TrialSide[]): FadeDecision | null {
  if (model.version !== FADE_TRIAL_VERSION || model.sport !== decision.sport || model.date !== decision.date
    || Date.parse(model.createdAt) > Date.parse(decision.capturedAt)) return null;
  const originals = sides.filter(s => decision.estimates.some(e => e.id === s.id && e.line === s.line
    && e.odds === s.odds && e.quoteAt === s.snapshotAt));
  const pairs = trialPairedMarkets(originals, model.sport, Date.parse(decision.capturedAt)).values;
  if (pairs.length !== 2 || new Set(pairs.map(p => p.market)).size !== 2) return null;
  const estimates = pairs.flatMap(pair => [estimateFadeTrial(model, pair, pair.a), estimateFadeTrial(model, pair, pair.b)]);
  const candidates = estimates.filter(e => e.eligible).sort((a, b) => b.conservativeRoi - a.conservativeRoi || a.id.localeCompare(b.id));
  return { version: FADE_TRIAL_VERSION, modelId: model.id, estimates, pickId: candidates[0]?.id || null };
}
