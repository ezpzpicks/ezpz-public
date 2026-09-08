import { google } from "googleapis";
import { readWorksheet, type SheetRow } from "./googleSheets";
import {
  type AnyRow,
  type V2TrendPlay,
  MLB_TREND_V2_MAX_FAVORITE_PRICE,
  parseAmericanOdds,
  scoreTrendBoardV2,
} from "./mlbTrendV2";

export type MlbTrendV2Status = "COLLECTING" | "SHADOW" | "ACTIVE";
type Market = "Moneyline" | "Total";

type FeatureName =
  | "implied"
  | "legacy"
  | "gapPct"
  | "publicMovementPct"
  | "sharpMovementPct"
  | "lineMovementValue"
  | "sig_BALANCED_PUBLIC_SHARP_SPLIT"
  | "sig_REVERSE_LINE_MOVEMENT_AGAINST"
  | "sig_HEAVY_PUBLIC_SHARP_AGREEMENT"
  | "sig_ADVERSE_LINE_MOVEMENT"
  | "sig_STRONG_SHARP_SUPPORT"
  | "sig_STRONG_SHARP_REJECTION"
  | "sig_REVERSE_LINE_MOVEMENT_SUPPORT"
  | "sig_SHARP_REJECTION"
  | "sig_SHARP_SUPPORT"
  | "sig_LINE_MOVEMENT_CONFIRMATION"
  | "sig_STRONG_REVERSE_LINE_MOVEMENT_AGAINST"
  | "sig_STRONG_REVERSE_LINE_MOVEMENT_SUPPORT"
  | "sig_EXTREME_PUBLIC_SHARP_AGREEMENT"
  | "dog_rlm_against"
  | "dog_strong_rlm_against"
  | "under_line_confirm";

const FEATURES: FeatureName[] = [
  "implied", "legacy", "gapPct", "publicMovementPct", "sharpMovementPct", "lineMovementValue",
  "sig_BALANCED_PUBLIC_SHARP_SPLIT", "sig_REVERSE_LINE_MOVEMENT_AGAINST",
  "sig_HEAVY_PUBLIC_SHARP_AGREEMENT", "sig_ADVERSE_LINE_MOVEMENT", "sig_STRONG_SHARP_SUPPORT",
  "sig_STRONG_SHARP_REJECTION", "sig_REVERSE_LINE_MOVEMENT_SUPPORT", "sig_SHARP_REJECTION",
  "sig_SHARP_SUPPORT", "sig_LINE_MOVEMENT_CONFIRMATION", "sig_STRONG_REVERSE_LINE_MOVEMENT_AGAINST",
  "sig_STRONG_REVERSE_LINE_MOVEMENT_SUPPORT", "sig_EXTREME_PUBLIC_SHARP_AGREEMENT",
  "dog_rlm_against", "dog_strong_rlm_against", "under_line_confirm",
];

const MODEL_TAB = "trend_v2_models";
const MODEL_HEADERS = [
  "Sport", "Status", "Active Model Version", "Active Model AUC", "Candidate Model Version",
  "Candidate AUC", "Baseline AUC", "Legacy AUC", "Evaluation Source", "Graded W/L", "Frozen W/L",
  "Unique Games", "Unique Dates", "Last Evaluated ET", "Promotion Reason",
  "Active Model JSON", "Candidate Model JSON",
];

const MIN_GRADED = 200;
const MIN_FROZEN = 100;
const MIN_GAMES = 75;
const MIN_DATES = 8;
const MIN_CANDIDATE_AUC = 0.55;
const MIN_BASELINE_LIFT = 0.01;
const MIN_LEGACY_LIFT = 0.02;
const MIN_INCUMBENT_REPLACEMENT_LIFT = 0.01;

type ModelSpec = {
  features: FeatureName[];
  median: number[];
  mean: number[];
  scale: number[];
  coef: number[];
  intercept: number;
  trainedRows: number;
  trainedDates: number;
};

type ActiveMarketModel = {
  version: string;
  auc: number;
  spec: ModelSpec;
};

type ActiveModelSet = Partial<Record<Market, ActiveMarketModel>>;

type CandidateMarketModel = {
  version: string;
  candidateAuc: number | null;
  baselineAuc: number | null;
  legacyAuc: number | null;
  spec: ModelSpec | null;
  evaluationSource: string;
  rows: number;
  frozenRows: number;
};

type CandidateModelSet = Partial<Record<Market, CandidateMarketModel>>;

type Example = {
  date: string;
  gameKey: string;
  market: Market;
  y: 0 | 1;
  legacy: number;
  x: Array<number | null>;
  source: AnyRow;
  frozen: boolean;
};

type ValidationEntry = {
  example: Example;
  probability: number;
};

type ValidationResult = {
  candidateAuc: number;
  baselineAuc: number;
  legacyAuc: number;
  entries: ValidationEntry[];
};

export type MlbTrendV2Lifecycle = {
  sport: "MLB";
  status: MlbTrendV2Status;
  activeModelVersion: string;
  activeModelAuc: number | null;
  candidateModelVersion: string;
  candidateAuc: number | null;
  baselineAuc: number | null;
  legacyAuc: number | null;
  evaluationSource: string;
  gradedRows: number;
  frozenRows: number;
  uniqueGames: number;
  uniqueDates: number;
  evaluatedAt: string;
  reason: string;
  activeMarkets: Market[];
};

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(/%/g, "").replace(/−/g, "-").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function textKey(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/−/g, "-")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isoDate(value: unknown) {
  const raw = String(value || "").trim();
  const iso = raw.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const us = raw.match(/(\d{1,2})\/(\d{1,2})\/(20\d{2})/);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  return raw;
}

function todayET(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function nowET(date = new Date()) {
  return `${todayET(date)} ${new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(date)} ET`;
}

function impliedFromOdds(value: unknown) {
  const odds = parseAmericanOdds(value);
  if (!odds) return null;
  return odds > 0
    ? (100 / (odds + 100)) * 100
    : (Math.abs(odds) / (Math.abs(odds) + 100)) * 100;
}

function parseDetails(row: SheetRow): Record<string, any> {
  const raw = String(row["Trend Score Details"] || "").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function canonicalSignal(value: unknown) {
  const key = textKey(value);
  if (!key) return "";
  if (key.includes("strong reverse") && key.includes("against")) return "STRONG_REVERSE_LINE_MOVEMENT_AGAINST";
  if (key.includes("strong reverse") && key.includes("support")) return "STRONG_REVERSE_LINE_MOVEMENT_SUPPORT";
  if (key.includes("reverse") && key.includes("against")) return "REVERSE_LINE_MOVEMENT_AGAINST";
  if (key.includes("reverse") && key.includes("support")) return "REVERSE_LINE_MOVEMENT_SUPPORT";
  if (key.includes("adverse line movement")) return "ADVERSE_LINE_MOVEMENT";
  if (key.includes("line movement confirmation")) return "LINE_MOVEMENT_CONFIRMATION";
  if (key.includes("extreme") && key.includes("agreement")) return "EXTREME_PUBLIC_SHARP_AGREEMENT";
  if (key.includes("heavy") && key.includes("agreement")) return "HEAVY_PUBLIC_SHARP_AGREEMENT";
  if (key.includes("strong handle above") || key.includes("strong sharp support")) return "STRONG_SHARP_SUPPORT";
  if (key.includes("strong handle below") || key.includes("strong sharp rejection")) return "STRONG_SHARP_REJECTION";
  if (key.includes("handle above") || key.includes("sharp support")) return "SHARP_SUPPORT";
  if (key.includes("handle below") || key.includes("sharp rejection")) return "SHARP_REJECTION";
  if (key.includes("balanced")) return "BALANCED_PUBLIC_SHARP_SPLIT";
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function signalSet(source: Record<string, any>) {
  const set = new Set<string>();
  for (const signal of Array.isArray(source.signals) ? source.signals : []) {
    const key = String(signal?.signalKey || canonicalSignal(signal?.signal) || "").trim();
    if (key) set.add(key);
  }
  for (const raw of [
    source.warning,
    source.publicWarning,
    source["Public Warning"],
    source.lineMovementSignal,
    source["Line Movement Signal"],
  ]) {
    const key = canonicalSignal(raw);
    if (key) set.add(key);
  }
  const compact = String(source.trendSignals || source["Trend Signals"] || "");
  for (const part of compact.split(/[|;,]+/)) {
    const key = canonicalSignal(part);
    if (key) set.add(key);
  }
  return set;
}

function normalizedSideGroup(source: Record<string, any>) {
  const direct = String(source.sideGroup || "").trim();
  if (direct) return direct;
  const market = String(source.market || source.Market || "");
  if (market === "Total") {
    const side = textKey(source.side || source.Side || source.selection || source.Selection);
    return side.startsWith("under") ? "Under" : side.startsWith("over") ? "Over" : "";
  }
  const odds = parseAmericanOdds(source.odds ?? source.Odds ?? source["Public Split Odds"]);
  if (!odds) return "";
  return odds < 0 ? "Favorite" : "Underdog";
}

function featureVector(source: Record<string, any>): Array<number | null> {
  const signals = signalSet(source);
  const sideGroup = normalizedSideGroup(source);
  const market = String(source.market || source.Market || "");
  const dog = sideGroup === "Underdog";
  const under = market === "Total" && sideGroup === "Under";
  const value: Record<FeatureName, number | null> = {
    implied:
      finite(source.currentImpliedPct ?? source["Current Implied %"] ?? source.v2ImpliedProbability) ??
      impliedFromOdds(source.odds ?? source.Odds ?? source["Public Split Odds"]),
    legacy: finite(source.legacyScore ?? source.score ?? source["Trend Score"]),
    gapPct: finite(source.gapPct ?? source["Public Gap %"]),
    publicMovementPct: finite(source.publicMovementPct ?? source["Public Change %"]),
    sharpMovementPct: finite(source.sharpMovementPct ?? source["Sharp Change %"]),
    lineMovementValue: finite(source.lineMovementValue ?? source["Line Movement Value"]),
    sig_BALANCED_PUBLIC_SHARP_SPLIT: signals.has("BALANCED_PUBLIC_SHARP_SPLIT") ? 1 : 0,
    sig_REVERSE_LINE_MOVEMENT_AGAINST: signals.has("REVERSE_LINE_MOVEMENT_AGAINST") ? 1 : 0,
    sig_HEAVY_PUBLIC_SHARP_AGREEMENT: signals.has("HEAVY_PUBLIC_SHARP_AGREEMENT") ? 1 : 0,
    sig_ADVERSE_LINE_MOVEMENT: signals.has("ADVERSE_LINE_MOVEMENT") ? 1 : 0,
    sig_STRONG_SHARP_SUPPORT: signals.has("STRONG_SHARP_SUPPORT") ? 1 : 0,
    sig_STRONG_SHARP_REJECTION: signals.has("STRONG_SHARP_REJECTION") ? 1 : 0,
    sig_REVERSE_LINE_MOVEMENT_SUPPORT: signals.has("REVERSE_LINE_MOVEMENT_SUPPORT") ? 1 : 0,
    sig_SHARP_REJECTION: signals.has("SHARP_REJECTION") ? 1 : 0,
    sig_SHARP_SUPPORT: signals.has("SHARP_SUPPORT") ? 1 : 0,
    sig_LINE_MOVEMENT_CONFIRMATION: signals.has("LINE_MOVEMENT_CONFIRMATION") ? 1 : 0,
    sig_STRONG_REVERSE_LINE_MOVEMENT_AGAINST: signals.has("STRONG_REVERSE_LINE_MOVEMENT_AGAINST") ? 1 : 0,
    sig_STRONG_REVERSE_LINE_MOVEMENT_SUPPORT: signals.has("STRONG_REVERSE_LINE_MOVEMENT_SUPPORT") ? 1 : 0,
    sig_EXTREME_PUBLIC_SHARP_AGREEMENT: signals.has("EXTREME_PUBLIC_SHARP_AGREEMENT") ? 1 : 0,
    dog_rlm_against: dog && signals.has("REVERSE_LINE_MOVEMENT_AGAINST") ? 1 : 0,
    dog_strong_rlm_against: dog && signals.has("STRONG_REVERSE_LINE_MOVEMENT_AGAINST") ? 1 : 0,
    under_line_confirm: under && signals.has("LINE_MOVEMENT_CONFIRMATION") ? 1 : 0,
  };
  return FEATURES.map((feature) => value[feature]);
}

function resultCode(value: unknown): 0 | 1 | null {
  const key = String(value || "").trim().toUpperCase();
  if (["W", "WIN", "WON"].includes(key)) return 1;
  if (["L", "LOSS", "LOST"].includes(key)) return 0;
  return null;
}

function historicalSource(row: SheetRow, detail: Record<string, any>): AnyRow {
  const market = String(detail.market || row.Market || "");
  const odds = row["Public Split Odds"] || row.Odds || detail.odds || "";
  const side = String(detail.side || row.Side || row.Selection || "");
  const source: AnyRow = {
    ...detail,
    market,
    Market: market,
    score: finite(row["Trend Score"] ?? detail.score) ?? 0,
    legacyScore: finite(row["Trend Score"] ?? detail.score) ?? 0,
    odds,
    Odds: odds,
    selection: detail.selection || row.Selection || "",
    Selection: row.Selection || detail.selection || "",
    side,
    Side: side,
    sideGroup: detail.sideGroup || "",
    gapPct: finite(row["Public Gap %"] ?? detail.gapPct),
    currentImpliedPct: finite(row["Current Implied %"] ?? detail.currentImpliedPct),
    publicMovementPct: finite(row["Public Change %"] ?? detail.publicMovementPct),
    sharpMovementPct: finite(row["Sharp Change %"] ?? detail.sharpMovementPct),
    lineMovementValue: finite(row["Line Movement Value"] ?? detail.lineMovementValue),
    warning: row["Public Warning"] || detail.warning || "",
    publicWarning: row["Public Warning"] || detail.warning || "",
    lineMovementSignal: row["Line Movement Signal"] || detail.lineMovementSignal || "",
    trendSignals: row["Trend Signals"] || "",
  };
  if (!Array.isArray(source.signals)) source.signals = [];
  return source;
}

function isFrozenRow(row: SheetRow, detail: Record<string, any>) {
  const snapshotStatus = String(detail.snapshotStatus || "").toUpperCase();
  const gradingVersion = String(detail.gradingVersion || "").toLowerCase();
  const matchConfidence = String(row["Public Split Match Confidence"] || "").toLowerCase();
  const snapshotTime = String(row["Public Split Snapshot Time"] || "").trim();
  return snapshotStatus === "FINAL_PREGAME" ||
    gradingVersion.includes("frozen") ||
    matchConfidence.includes("final 15-minute") ||
    (snapshotTime !== "" && matchConfidence.includes("final"));
}

function examplesFromRows(rows: SheetRow[]) {
  const output: Example[] = [];
  for (const row of rows) {
    const y = resultCode(row.Result || row.Status);
    if (y == null) continue;
    const detail = parseDetails(row);
    const market = String(detail.market || row.Market || "");
    if (market !== "Moneyline" && market !== "Total") continue;
    const legacy = finite(row["Trend Score"] ?? detail.score) ?? 0;
    if (legacy <= 0) continue;
    const source = historicalSource(row, detail);
    const vector = featureVector(source);
    if (vector[0] == null || vector[1] == null) continue;
    const date = isoDate(row.Date || detail.date);
    if (!date) continue;
    output.push({
      date,
      gameKey: String(row["Game Key"] || detail.gameKey || row.Game || "").trim(),
      market,
      y,
      legacy,
      x: vector,
      source,
      frozen: isFrozenRow(row, detail),
    });
  }
  return output;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function sigmoid(value: number) {
  const bounded = Math.max(-30, Math.min(30, value));
  return 1 / (1 + Math.exp(-bounded));
}

function fitModel(rows: Example[]): ModelSpec | null {
  if (rows.length < 20) return null;
  const width = FEATURES.length;
  const medians = Array.from({ length: width }, (_, column) =>
    median(rows.map((row) => row.x[column]).filter((value): value is number => value != null && Number.isFinite(value))),
  );
  const filled = rows.map((row) =>
    row.x.map((value, column) => value == null || !Number.isFinite(value) ? medians[column] : value),
  );
  const means = Array.from(
    { length: width },
    (_, column) => filled.reduce((sum, row) => sum + row[column], 0) / filled.length,
  );
  const scales = Array.from({ length: width }, (_, column) => {
    const variance = filled.reduce((sum, row) => sum + (row[column] - means[column]) ** 2, 0) / filled.length;
    const scale = Math.sqrt(variance);
    return Number.isFinite(scale) && scale > 1e-8 ? scale : 1;
  });
  const matrix = filled.map((row) =>
    row.map((value, column) => (value - means[column]) / scales[column]),
  );
  const positiveRate = Math.min(
    0.999,
    Math.max(0.001, rows.reduce((sum, row) => sum + row.y, 0) / rows.length),
  );
  let intercept = Math.log(positiveRate / (1 - positiveRate));
  const coef = Array(width).fill(0) as number[];
  const lambda = 4;
  for (let iteration = 0; iteration < 450; iteration += 1) {
    const grad = Array(width).fill(0) as number[];
    let gradIntercept = 0;
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      let linear = intercept;
      for (let column = 0; column < width; column += 1) {
        linear += coef[column] * matrix[rowIndex][column];
      }
      const error = sigmoid(linear) - rows[rowIndex].y;
      gradIntercept += error;
      for (let column = 0; column < width; column += 1) {
        grad[column] += error * matrix[rowIndex][column];
      }
    }
    const rate = 0.12 / Math.sqrt(1 + iteration / 40);
    intercept -= rate * (gradIntercept / rows.length);
    for (let column = 0; column < width; column += 1) {
      const regularized = grad[column] / rows.length + (lambda / rows.length) * coef[column];
      coef[column] -= rate * regularized;
    }
  }
  return {
    features: FEATURES,
    median: medians,
    mean: means,
    scale: scales,
    coef,
    intercept,
    trainedRows: rows.length,
    trainedDates: new Set(rows.map((row) => row.date)).size,
  };
}

function predictModel(spec: ModelSpec, vector: Array<number | null>) {
  let linear = spec.intercept;
  for (let column = 0; column < spec.features.length; column += 1) {
    const raw = vector[column];
    const value = raw == null || !Number.isFinite(raw) ? spec.median[column] : raw;
    linear += spec.coef[column] * ((value - spec.mean[column]) / (spec.scale[column] || 1));
  }
  return sigmoid(linear);
}

function auc(labels: number[], scores: number[]) {
  if (labels.length !== scores.length || !labels.length) return NaN;
  const positives = labels.reduce((sum, label) => sum + (label === 1 ? 1 : 0), 0);
  const negatives = labels.length - positives;
  if (!positives || !negatives) return NaN;
  const ranked = scores
    .map((score, index) => ({ score, index }))
    .sort((a, b) => a.score - b.score);
  const ranks = Array(scores.length).fill(0) as number[];
  let cursor = 0;
  while (cursor < ranked.length) {
    let end = cursor + 1;
    while (end < ranked.length && Math.abs(ranked[end].score - ranked[cursor].score) < 1e-12) end += 1;
    const averageRank = (cursor + 1 + end) / 2;
    for (let i = cursor; i < end; i += 1) ranks[ranked[i].index] = averageRank;
    cursor = end;
  }
  let positiveRankSum = 0;
  labels.forEach((label, index) => {
    if (label === 1) positiveRankSum += ranks[index];
  });
  return (positiveRankSum - (positives * (positives + 1)) / 2) / (positives * negatives);
}

function baselineProbability(example: Example) {
  try {
    const scored = scoreTrendBoardV2([example.source], []);
    const probability = finite(scored[0]?.v2Probability);
    return probability == null ? null : probability / 100;
  } catch {
    return null;
  }
}

function validation(rows: Example[]): ValidationResult | null {
  const dates = [...new Set(rows.map((row) => row.date))].sort();
  if (rows.length < 40 || dates.length < 4) return null;
  const rawBounds = [
    Math.floor(dates.length * 0.55),
    Math.floor(dates.length * 0.70),
    Math.floor(dates.length * 0.85),
    dates.length,
  ];
  const bounds = rawBounds.map((value, index) => Math.max(index + 2, Math.min(dates.length, value)));
  const entries: ValidationEntry[] = [];
  for (let fold = 0; fold < 3; fold += 1) {
    const trainEnd = bounds[fold];
    const testEnd = bounds[fold + 1];
    if (trainEnd >= dates.length || testEnd <= trainEnd) continue;
    const trainDates = new Set(dates.slice(0, trainEnd));
    const testDates = new Set(dates.slice(trainEnd, testEnd));
    const train = rows.filter((row) => trainDates.has(row.date));
    const test = rows.filter((row) => testDates.has(row.date));
    if (train.length < 30 || test.length < 5) continue;
    const spec = fitModel(train);
    if (!spec) continue;
    for (const example of test) {
      entries.push({ example, probability: predictModel(spec, example.x) });
    }
  }
  if (entries.length < 10) {
    const splitIndex = Math.max(1, Math.floor(dates.length * 0.7));
    const trainDates = new Set(dates.slice(0, splitIndex));
    const testDates = new Set(dates.slice(splitIndex));
    const train = rows.filter((row) => trainDates.has(row.date));
    const test = rows.filter((row) => testDates.has(row.date));
    const spec = fitModel(train);
    if (!spec || test.length < 5) return null;
    for (const example of test) {
      entries.push({ example, probability: predictModel(spec, example.x) });
    }
  }
  const usable = entries
    .map((entry) => ({ entry, baseline: baselineProbability(entry.example) }))
    .filter((item): item is { entry: ValidationEntry; baseline: number } => item.baseline != null);
  if (usable.length < 10) return null;
  const labels = usable.map((item) => item.entry.example.y);
  const candidateAuc = auc(labels, usable.map((item) => item.entry.probability));
  const baselineAuc = auc(labels, usable.map((item) => item.baseline));
  const legacyAuc = auc(labels, usable.map((item) => item.entry.example.legacy));
  if (![candidateAuc, baselineAuc, legacyAuc].every(Number.isFinite)) return null;
  return {
    candidateAuc,
    baselineAuc,
    legacyAuc,
    entries: usable.map((item) => item.entry),
  };
}

function parseModelSpec(raw: unknown): ModelSpec | null {
  const parsed = raw as ModelSpec;
  if (!parsed || !Array.isArray(parsed.features) || parsed.features.join("|") !== FEATURES.join("|")) return null;
  if (!Array.isArray(parsed.coef) || parsed.coef.length !== FEATURES.length) return null;
  if (!Array.isArray(parsed.median) || parsed.median.length !== FEATURES.length) return null;
  if (!Array.isArray(parsed.mean) || parsed.mean.length !== FEATURES.length) return null;
  if (!Array.isArray(parsed.scale) || parsed.scale.length !== FEATURES.length) return null;
  return parsed;
}

function parseActiveSet(raw: unknown): ActiveModelSet {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(String(raw || "{}")) : raw;
    if (!parsed || typeof parsed !== "object") return {};
    const output: ActiveModelSet = {};
    for (const market of ["Moneyline", "Total"] as Market[]) {
      const item = (parsed as Record<string, any>)[market];
      const spec = parseModelSpec(item?.spec);
      const aucValue = finite(item?.auc);
      if (spec && aucValue != null && item?.version) {
        output[market] = { version: String(item.version), auc: aucValue, spec };
      }
    }
    return output;
  } catch {
    return {};
  }
}

function average(values: Array<number | null | undefined>) {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function credentials() {
  const raw = process.env.GOOGLE_CREDENTIALS || process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";
  if (!raw) throw new Error("Missing Google credentials for MLB Trend V2 lifecycle.");
  try {
    return JSON.parse(raw);
  } catch {
    return JSON.parse(raw.replace(/\\n/g, "\n"));
  }
}

function spreadsheetId() {
  const id =
    process.env.GOOGLE_SHEET_ID ||
    process.env.GOOGLE_SPREADSHEET_ID ||
    process.env.SPREADSHEET_ID ||
    "";
  if (!id) throw new Error("Missing GOOGLE_SHEET_ID for MLB Trend V2 lifecycle.");
  return id;
}

let sheetsPromise: Promise<ReturnType<typeof google.sheets>> | null = null;

async function sheetsClient() {
  if (!sheetsPromise) {
    sheetsPromise = (async () => {
      const auth = new google.auth.GoogleAuth({
        credentials: credentials(),
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      });
      return google.sheets({ version: "v4", auth });
    })();
  }
  return sheetsPromise;
}

function colName(index: number) {
  let value = index;
  let out = "";
  while (value > 0) {
    const mod = (value - 1) % 26;
    out = String.fromCharCode(65 + mod) + out;
    value = Math.floor((value - 1) / 26);
  }
  return out;
}

async function ensureRegistryTab() {
  const sheets = await sheetsClient();
  const id = spreadsheetId();
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: id,
    fields: "sheets.properties",
  });
  const existing = (meta.data.sheets || []).find(
    (sheet) => sheet.properties?.title === MODEL_TAB,
  );
  if (!existing) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: {
        requests: [{
          addSheet: {
            properties: {
              title: MODEL_TAB,
              gridProperties: {
                rowCount: 100,
                columnCount: Math.max(20, MODEL_HEADERS.length),
              },
            },
          },
        }],
      },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: id,
      range: `'${MODEL_TAB}'!A1:${colName(MODEL_HEADERS.length)}1`,
      valueInputOption: "RAW",
      requestBody: { values: [MODEL_HEADERS] },
    });
  }
}

function rowToObject(headers: string[], row: any[]) {
  const out: SheetRow = {};
  headers.forEach((header, index) => {
    out[header] = String(row[index] ?? "");
  });
  return out;
}

async function registryRow() {
  await ensureRegistryTab();
  const sheets = await sheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `'${MODEL_TAB}'!A:${colName(MODEL_HEADERS.length)}`,
  });
  const values = (response.data.values || []) as any[][];
  if (!values.length) return undefined;
  const headers = values[0].map((value) => String(value || "").trim());
  return values
    .slice(1)
    .map((row) => rowToObject(headers, row))
    .find((row) => String(row.Sport || "").toUpperCase() === "MLB");
}

async function upsertRegistryRow(row: SheetRow) {
  await ensureRegistryTab();
  const sheets = await sheetsClient();
  const id = spreadsheetId();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: `'${MODEL_TAB}'!A:${colName(MODEL_HEADERS.length)}`,
  });
  const values = (response.data.values || []) as any[][];
  const headers = values.length
    ? values[0].map((value) => String(value || "").trim())
    : MODEL_HEADERS;
  let targetRow = -1;
  for (let index = 1; index < values.length; index += 1) {
    const object = rowToObject(headers, values[index] || []);
    if (String(object.Sport || "").toUpperCase() === "MLB") {
      targetRow = index + 1;
      break;
    }
  }
  const cells = MODEL_HEADERS.map((header) => String(row[header] ?? ""));
  if (targetRow > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: id,
      range: `'${MODEL_TAB}'!A${targetRow}:${colName(MODEL_HEADERS.length)}${targetRow}`,
      valueInputOption: "RAW",
      requestBody: { values: [cells] },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: id,
      range: `'${MODEL_TAB}'!A:${colName(MODEL_HEADERS.length)}`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [cells] },
    });
  }
}

function lifecycleFromRow(row?: SheetRow): MlbTrendV2Lifecycle {
  const activeSet = parseActiveSet(row?.["Active Model JSON"]);
  return {
    sport: "MLB",
    status: (String(row?.Status || "COLLECTING") as MlbTrendV2Status),
    activeModelVersion: String(row?.["Active Model Version"] || ""),
    activeModelAuc: finite(row?.["Active Model AUC"]),
    candidateModelVersion: String(row?.["Candidate Model Version"] || ""),
    candidateAuc: finite(row?.["Candidate AUC"]),
    baselineAuc: finite(row?.["Baseline AUC"]),
    legacyAuc: finite(row?.["Legacy AUC"]),
    evaluationSource: String(row?.["Evaluation Source"] || ""),
    gradedRows: Number(row?.["Graded W/L"] || 0),
    frozenRows: Number(row?.["Frozen W/L"] || 0),
    uniqueGames: Number(row?.["Unique Games"] || 0),
    uniqueDates: Number(row?.["Unique Dates"] || 0),
    evaluatedAt: String(row?.["Last Evaluated ET"] || ""),
    reason: String(row?.["Promotion Reason"] || "Waiting for first evaluation."),
    activeMarkets: (["Moneyline", "Total"] as Market[]).filter((market) => Boolean(activeSet[market])),
  };
}

export async function getMlbTrendV2Lifecycle() {
  return lifecycleFromRow(await registryRow());
}

function buildCandidate(
  market: Market,
  allRows: Example[],
  frozenRows: Example[],
  strictReady: boolean,
) {
  const gradedMarket = allRows.filter((row) => row.market === market);
  const frozenMarket = frozenRows.filter((row) => row.market === market);
  const shadowValidation = gradedMarket.length >= 60 ? validation(gradedMarket) : null;
  const strictValidation = strictReady && frozenMarket.length >= 40 ? validation(frozenMarket) : null;
  const selectedValidation = strictValidation || shadowValidation;
  const trainingRows = strictValidation ? frozenMarket : gradedMarket;
  const spec = trainingRows.length >= 40 ? fitModel(trainingRows) : null;
  const version = `mlb-trend-v2-auto-${market.toLowerCase()}-${todayET()}`;
  const candidate: CandidateMarketModel = {
    version,
    candidateAuc: selectedValidation?.candidateAuc ?? null,
    baselineAuc: selectedValidation?.baselineAuc ?? null,
    legacyAuc: selectedValidation?.legacyAuc ?? null,
    spec,
    evaluationSource: strictValidation
      ? "FINAL_PREGAME"
      : shadowValidation
        ? "ALL_GRADED_SHADOW"
        : "INSUFFICIENT_DATA",
    rows: gradedMarket.length,
    frozenRows: frozenMarket.length,
  };
  return { candidate, strictValidation: Boolean(strictValidation) };
}

export async function evaluateMlbTrendV2(
  options: { force?: boolean } = {},
): Promise<MlbTrendV2Lifecycle> {
  const existing = await registryRow();
  if (!options.force && String(existing?.["Last Evaluated ET"] || "").startsWith(todayET())) {
    return lifecycleFromRow(existing);
  }

  const history = await readWorksheet("all_game_trends");
  const graded = examplesFromRows(history);
  const frozen = graded.filter((row) => row.frozen);
  const uniqueGames = new Set(graded.map((row) => row.gameKey).filter(Boolean)).size;
  const uniqueDates = new Set(graded.map((row) => row.date).filter(Boolean)).size;
  const frozenGames = new Set(frozen.map((row) => row.gameKey).filter(Boolean)).size;
  const frozenDates = new Set(frozen.map((row) => row.date).filter(Boolean)).size;
  const strictReady =
    graded.length >= MIN_GRADED &&
    frozen.length >= MIN_FROZEN &&
    frozenGames >= MIN_GAMES &&
    frozenDates >= MIN_DATES;

  const candidates: CandidateModelSet = {};
  const activeSet = parseActiveSet(existing?.["Active Model JSON"]);
  const promotionNotes: string[] = [];
  const evaluationSources = new Set<string>();

  for (const market of ["Moneyline", "Total"] as Market[]) {
    const { candidate, strictValidation } = buildCandidate(market, graded, frozen, strictReady);
    candidates[market] = candidate;
    evaluationSources.add(candidate.evaluationSource);
    const incumbent = activeSet[market];
    const candidateAuc = candidate.candidateAuc;
    const baselineAuc = candidate.baselineAuc;
    const legacyAuc = candidate.legacyAuc;

    const passesPerformance =
      strictValidation &&
      candidate.spec != null &&
      candidateAuc != null &&
      baselineAuc != null &&
      legacyAuc != null &&
      candidateAuc >= MIN_CANDIDATE_AUC &&
      candidateAuc >= baselineAuc + MIN_BASELINE_LIFT &&
      candidateAuc >= legacyAuc + MIN_LEGACY_LIFT;

    const beatsIncumbent =
      !incumbent ||
      candidateAuc == null ||
      candidateAuc >= incumbent.auc + MIN_INCUMBENT_REPLACEMENT_LIFT;

    if (passesPerformance && beatsIncumbent && candidate.spec && candidateAuc != null) {
      activeSet[market] = {
        version: candidate.version,
        auc: candidateAuc,
        spec: candidate.spec,
      };
      promotionNotes.push(
        `${market} promoted: OOS AUC ${candidateAuc.toFixed(3)} vs baseline ${baselineAuc!.toFixed(3)} and legacy ${legacyAuc!.toFixed(3)}.`,
      );
    } else if (incumbent) {
      promotionNotes.push(
        `${market} incumbent retained${candidateAuc == null ? "" : `; challenger AUC ${candidateAuc.toFixed(3)}`}.`,
      );
    } else if (candidate.evaluationSource === "INSUFFICIENT_DATA") {
      promotionNotes.push(`${market} collecting history.`);
    } else if (!strictValidation) {
      promotionNotes.push(`${market} shadow only; frozen promotion sample not ready.`);
    } else {
      promotionNotes.push(`${market} challenger did not clear every promotion gate.`);
    }
  }

  const activeMarkets = (["Moneyline", "Total"] as Market[]).filter((market) => Boolean(activeSet[market]));
  const hasShadow = Object.values(candidates).some(
    (candidate) => candidate?.evaluationSource !== "INSUFFICIENT_DATA",
  );
  const status: MlbTrendV2Status = activeMarkets.length
    ? "ACTIVE"
    : hasShadow
      ? "SHADOW"
      : "COLLECTING";

  const candidateAuc = average(
    Object.values(candidates).map((candidate) => candidate?.candidateAuc),
  );
  const baselineAuc = average(
    Object.values(candidates).map((candidate) => candidate?.baselineAuc),
  );
  const legacyAuc = average(
    Object.values(candidates).map((candidate) => candidate?.legacyAuc),
  );
  const activeAuc = average(activeMarkets.map((market) => activeSet[market]?.auc));
  const candidateVersion = `mlb-trend-v2-auto-${todayET()}`;
  const activeVersion = activeMarkets
    .map((market) => activeSet[market]?.version)
    .filter(Boolean)
    .join(" | ");

  const row: SheetRow = {
    Sport: "MLB",
    Status: status,
    "Active Model Version": activeVersion,
    "Active Model AUC": activeAuc == null ? "" : activeAuc.toFixed(6),
    "Candidate Model Version": candidateVersion,
    "Candidate AUC": candidateAuc == null ? "" : candidateAuc.toFixed(6),
    "Baseline AUC": baselineAuc == null ? "" : baselineAuc.toFixed(6),
    "Legacy AUC": legacyAuc == null ? "" : legacyAuc.toFixed(6),
    "Evaluation Source": evaluationSources.has("FINAL_PREGAME")
      ? "FINAL_PREGAME"
      : evaluationSources.has("ALL_GRADED_SHADOW")
        ? "ALL_GRADED_SHADOW"
        : "INSUFFICIENT_DATA",
    "Graded W/L": String(graded.length),
    "Frozen W/L": String(frozen.length),
    "Unique Games": String(uniqueGames),
    "Unique Dates": String(uniqueDates),
    "Last Evaluated ET": nowET(),
    "Promotion Reason": promotionNotes.join(" "),
    "Active Model JSON": JSON.stringify(activeSet),
    "Candidate Model JSON": JSON.stringify(candidates),
  };
  await upsertRegistryRow(row);
  return lifecycleFromRow(row);
}

function strengthScore(gap: number) {
  if (!Number.isFinite(gap)) return 0;
  if (gap < 5) return Math.max(0, Math.min(59, Math.round(50 + gap * 2)));
  if (gap < 10) return Math.max(60, Math.min(68, Math.round(60 + (gap - 5) * 1.8)));
  if (gap < 20) return Math.max(69, Math.min(84, Math.round(69 + (gap - 10) * 1.6)));
  return Math.max(85, Math.min(100, Math.round(85 + (gap - 20) * 0.75)));
}

function tierFor(score: number, winner: boolean, eligible: boolean) {
  if (!winner || !eligible || score < 60) return "Pass";
  if (score >= 85) return "Elite";
  if (score >= 69) return "Strong";
  return "Good";
}

function pairKey(play: AnyRow) {
  return `${String(play.v2GameKey || play.recordGameKey || play.game || "")}|${String(play.market || "")}`;
}

async function activeSetFromRegistry() {
  const row = await registryRow();
  return { row, activeSet: parseActiveSet(row?.["Active Model JSON"]) };
}

export async function applyMlbTrendV2Adaptive(
  scored: V2TrendPlay[],
): Promise<{ plays: V2TrendPlay[]; lifecycle: MlbTrendV2Lifecycle }> {
  let lifecycle: MlbTrendV2Lifecycle;
  try {
    lifecycle = await evaluateMlbTrendV2();
  } catch (error) {
    console.warn("MLB Trend V2 lifecycle evaluation failed; static V2 retained.", error);
    return {
      plays: scored,
      lifecycle: {
        sport: "MLB",
        status: "COLLECTING",
        activeModelVersion: "",
        activeModelAuc: null,
        candidateModelVersion: "",
        candidateAuc: null,
        baselineAuc: null,
        legacyAuc: null,
        evaluationSource: "ERROR",
        gradedRows: 0,
        frozenRows: 0,
        uniqueGames: 0,
        uniqueDates: 0,
        evaluatedAt: "",
        reason: "Adaptive lifecycle unavailable; static Sept. 7 V2 baseline retained.",
        activeMarkets: [],
      },
    };
  }

  let row: SheetRow | undefined;
  let activeSet: ActiveModelSet = {};
  try {
    ({ row, activeSet } = await activeSetFromRegistry());
  } catch (error) {
    console.warn("MLB Trend V2 active registry read failed; static V2 retained.", error);
    return { plays: scored, lifecycle };
  }

  if (lifecycle.status !== "ACTIVE" || !Object.keys(activeSet).length) {
    return { plays: scored, lifecycle };
  }

  const initial = scored.map((play) => {
    const market = play.market as Market;
    const active = activeSet[market];
    if (!active) return { ...play };
    const vector = featureVector(play);
    const probability = predictModel(active.spec, vector);
    const implied =
      vector[0] ??
      finite(play.v2ImpliedProbability) ??
      impliedFromOdds(play.odds) ??
      50;
    const odds = parseAmericanOdds(play.odds);
    const dataComplete =
      vector[0] != null &&
      vector[1] != null &&
      vector[2] != null &&
      Number(vector[1] || 0) > 0 &&
      Array.isArray(play.signals) &&
      play.signals.length > 0 &&
      odds !== 0;
    return {
      ...play,
      v2Probability: probability * 100,
      v2MarketGap: probability * 100 - implied,
      v2ImpliedProbability: implied,
      v2DataComplete: dataComplete,
      v2ModelVersion: active.version,
      v2PlayablePrice: odds > 0 || odds >= MLB_TREND_V2_MAX_FAVORITE_PRICE,
      v2Direction: false,
      v2LegacyAgreement: false,
      v2DailyEligible: false,
      v2DailyRank: null,
    } as V2TrendPlay;
  });

  const groups = new Map<string, V2TrendPlay[]>();
  for (const play of initial) {
    const key = pairKey(play);
    const group = groups.get(key) || [];
    group.push(play);
    groups.set(key, group);
  }

  const resolved: V2TrendPlay[] = [];
  for (const group of groups.values()) {
    const directionWinner = [...group].sort(
      (a, b) =>
        Number(b.v2MarketGap) - Number(a.v2MarketGap) ||
        Number(b.v2Probability) - Number(a.v2Probability),
    )[0];
    const legacyWinner = [...group].sort(
      (a, b) => Number(b.legacyScore) - Number(a.legacyScore),
    )[0];
    for (const play of group) {
      const winner = Boolean(directionWinner && play === directionWinner && group.length >= 2);
      const agreement = Boolean(winner && legacyWinner && play === legacyWinner);
      const market = play.market as Market;
      const directionEligible =
        winner &&
        Boolean(play.v2DataComplete) &&
        Boolean((play as AnyRow).v2PlayablePrice) &&
        (market === "Total" || agreement);
      const rawScore = strengthScore(Number(play.v2MarketGap));
      const finalScore = winner ? rawScore : Math.min(59, rawScore);
      const v2Tier = tierFor(finalScore, winner, directionEligible);
      resolved.push({
        ...play,
        score: finalScore,
        tier: v2Tier,
        v2Score: finalScore,
        v2Tier,
        v2Direction: winner,
        v2LegacyAgreement: agreement,
        v2DailyEligible: directionEligible,
      } as unknown as V2TrendPlay);
    }
  }

  const ranked = resolved
    .filter((play) => play.v2Direction && play.v2DailyEligible)
    .sort((a, b) => Number(b.v2MarketGap) - Number(a.v2MarketGap));
  const rank = new Map(
    ranked.map((play, index) => [`${play.v2GameKey}|${play.market}`, index + 1]),
  );
  const plays = resolved.map((play) => ({
    ...play,
    v2DailyRank: play.v2Direction
      ? rank.get(`${play.v2GameKey}|${play.market}`) || null
      : null,
  })) as V2TrendPlay[];

  return {
    plays,
    lifecycle: lifecycleFromRow(row),
  };
}
