import { readTursoDatasetByDateKeys, runTursoAtomicSql, runTursoSql, type TursoRow } from "./tursoStore";
import { buildTrialModel, buildTrialDecisions, settleTrialDecision, trialDate, trialDayStart, trialRecord,
  SELECTION_TRIAL_VERSION, FADE_TRIAL_VERSION, OPPOSITE_TRIAL_POLICY, TRIAL_POLICY, TRIAL_FEATURES,
  type TrialSport, type TrialSide, type TrialModel, type TrialDecision, type TrialMarket, type TrialCalibrationObservation } from "./selectionTrial";
import { buildFadeTrialModel, buildFadeTrialFromBase, buildFadeDecision, FADE_POLICY, type FadeModel } from "./selectionFade";

export const TRIAL_MODELS_TAB = "selection_trial_models";
export const TRIAL_DECISIONS_TAB = "selection_trial_decisions";
export const TRIAL_MLB_INPUTS_TAB = "selection_trial_mlb_inputs";
export const FADE_MODELS_TAB = "selection_fade_models";
const q = (value: unknown) => `'${String(value ?? "").replaceAll("'", "''")}'`;
const sourceTab = (sport: TrialSport) => sport === "MLB" ? TRIAL_MLB_INPUTS_TAB
  : sport === "NBA" ? "nba_signal_observations" : sport === "NCAAM" ? "ncaam_signal_observations" : "football_signal_observations";
const prefix = (sport: TrialSport) => sport === "MLB" ? "mlb-trial-" : sport === "NBA" ? "nba-signals-"
  : sport === "NCAAM" ? "ncaam-signals-" : "football-signals-";
const keyWhere = (sport: TrialSport, tab: string, row: TursoRow) => `sport=${q(sport)} AND dataset=${q(tab)} AND date_key=${q(row.Date)} AND game_key=${q(row["Game Key"])} AND market=${q(row.Market)} AND selection=${q(row.Selection)}`;

export function trialSidesFromRows(sport: TrialSport, rows: TursoRow[]): TrialSide[] {
  return rows.flatMap(row => {
    try {
      const side = JSON.parse(row["Details JSON"]);
      if (side.date !== row.Date || side.id !== row["Pick Key"] || !String(row["Policy Version"] || side.policyVersion || "").startsWith(prefix(sport))
        || !["Spread", "Total", ...(sport === "MLB" ? ["Moneyline"] : [])].includes(side.market)
        || side.researchOrigin || !Array.isArray(side.signals)) return [];
      return [{ ...side, recorded: true, policyVersion: row["Policy Version"] || side.policyVersion,
        result: /^[WLP]$/.test(row.Result || "") ? row.Result : "", resultUpdated: row["Result Updated"] || "" } as TrialSide];
    } catch { return []; }
  });
}
async function sourceRows(sport: TrialSport, date: string, dates?: string[]) {
  if (dates) return readTursoDatasetByDateKeys(sport, sourceTab(sport), dates);
  // One bounded source read per sport/date, only when the collector first creates its frozen daily model.
  const crossYear = sport !== "MLB";
  const season = crossYear && Number(date.slice(5, 7)) < 7 ? Number(date.slice(0, 4)) - 1 : Number(date.slice(0, 4));
  const start = `${season}-${crossYear ? "07-01" : "01-01"}`;
  // Discard large chart/context arrays in SQL; only original flags, strengths, quote and labels enter the fit.
  const detail = `json_extract(payload_json,'$."Details JSON"')`;
  const signalId = `CASE WHEN type='object' THEN json_extract(value,'$.signal') ELSE NULL END`;
  const typeIds = `CASE WHEN json_type(${detail},'$.publicTypeIds')='array' THEN json_extract(${detail},'$.publicTypeIds') ELSE COALESCE((SELECT json_group_array(${signalId}) FROM json_each(${detail},'$.publicMatches') WHERE ${signalId} IS NOT NULL),'[]') END`;
  const compact = `CASE WHEN json_valid(${detail}) THEN json_set(json_remove(${detail},'$.marketContext','$.teamGames','$.publicMatches','$.teamTrend','$.sosContext','$.modelContext','$.comboScore'),'$.publicTypeIds',json(${typeIds})) ELSE '{}' END`;
  const result = await runTursoSql([`SELECT json_set(payload_json,'$."Details JSON"',printf('%s',${compact})) AS payload_json FROM dataset_rows INDEXED BY idx_dataset_rows_date WHERE sport=${q(sport)} AND dataset=${q(sourceTab(sport))} AND date_key>=${q(start)} AND date_key<${q(date)} ORDER BY date_key,row_index`]);
  return result[0].map(row => JSON.parse(row.payload_json) as TursoRow);
}
function parseModels(rows: TursoRow[], sport: TrialSport, date: string): TrialModel | null {
  const row = rows.find(r => r.Date === date && r.Selection === SELECTION_TRIAL_VERSION);
  if (!row) return null;
  const model = JSON.parse(row["Details JSON"]) as TrialModel;
  if (model.version !== SELECTION_TRIAL_VERSION || model.sport !== sport || model.date !== date
    || JSON.stringify(model.featureNames) !== JSON.stringify(TRIAL_FEATURES) || model.models.length !== 2
    || model.trainingCutoff !== new Date(trialDayStart(date)).toISOString()
    || model.models.some(m => m.beta.length !== TRIAL_FEATURES.length || m.beta.some(v => !Number.isFinite(v))
      || m.covariance.length !== TRIAL_FEATURES.length || m.covariance.some(r => r.length !== TRIAL_FEATURES.length || r.some(v => !Number.isFinite(v))))) {
    throw new Error("Saved trial model is invalid; refusing to overwrite its decisions");
  }
  return model;
}
function parseFadeModel(rows: TursoRow[], sport: TrialSport, date: string): FadeModel | null {
  const row = rows.find(r => r.Date === date && r.Selection === FADE_TRIAL_VERSION);
  if (!row) return null;
  const model = JSON.parse(row["Details JSON"]) as FadeModel;
  const cutoff = trialDayStart(date);
  if (model.version !== FADE_TRIAL_VERSION || model.sport !== sport || model.date !== date
    || model.trainingCutoff !== new Date(cutoff).toISOString() || model.baseModel.version !== SELECTION_TRIAL_VERSION
    || model.baseModel.sport !== sport || model.baseModel.date !== date || model.baseModel.trainingCutoff !== model.trainingCutoff
    || model.models.length !== 2 || model.baseModel.models.length !== 2
    || model.baseModel.models.some(m => m.beta.length !== TRIAL_FEATURES.length || m.beta.some(v => !Number.isFinite(v))
      || m.covariance.length !== TRIAL_FEATURES.length || m.covariance.some(r => r.length !== TRIAL_FEATURES.length || r.some(v => !Number.isFinite(v))))
    || model.models.some(m => !Number.isFinite(m.weight) || Math.abs(m.weight) > 1 || m.samples.some(s => s.date >= date
      || !Number.isFinite(s.knownAt) || s.knownAt >= cutoff || !Number.isFinite(s.margin) || !Number.isFinite(s.offset)
      || ![0, 1].includes(s.y) || !Array.isArray(s.publicTypeIds)))) throw new Error("Saved fade model is invalid");
  return model;
}
function decisionRows(rows: TursoRow[]): TrialDecision[] {
  return rows.filter(r => r.Selection === SELECTION_TRIAL_VERSION).map(row => {
    const decision = JSON.parse(row["Details JSON"]) as TrialDecision;
    if (decision.version !== SELECTION_TRIAL_VERSION || decision.date !== row.Date || decision.gameKey !== row["Game Key"]
      || !Array.isArray(decision.estimates) || decision.estimates.length !== 4) throw new Error("Saved trial decision is invalid");
    return decision;
  });
}
function modelRow(model: TrialModel): TursoRow {
  return { Date: model.date, "Game Key": `model|${SELECTION_TRIAL_VERSION}`, Market: "Model", Selection: SELECTION_TRIAL_VERSION,
    "Details JSON": JSON.stringify(model) };
}
function decisionRow(decision: TrialDecision): TursoRow {
  return { Date: decision.date, "Game Key": decision.gameKey, Game: decision.game, Market: "Trial", Selection: SELECTION_TRIAL_VERSION,
    Result: decision.estimates.every(e => decision.outcomes[e.id]) ? "SETTLED" : "PENDING",
    "Details JSON": JSON.stringify(decision) };
}
/** An atomic first insert owns each model/decision, even when collectors overlap. */
async function insertImmutable(sport: TrialSport, tab: string, rows: TursoRow[]) {
  if (!rows.length) return;
  const statements = rows.map(row => `INSERT INTO dataset_rows (sport,dataset,row_index,payload_json,source_hash,date_key,game_key,game,market,selection,result,snapshot_time,imported_at) SELECT ${q(sport)},${q(tab)},(SELECT COALESCE(MAX(row_index),0)+1 FROM dataset_rows WHERE sport=${q(sport)} AND dataset=${q(tab)}),${q(JSON.stringify(row))},'',${q(row.Date)},${q(row["Game Key"])},${q(row.Game)},${q(row.Market)},${q(row.Selection)},${q(row.Result)},'',${q(new Date().toISOString())} WHERE NOT EXISTS (SELECT 1 FROM dataset_rows WHERE ${keyWhere(sport, tab, row)})`);
  statements.push(`INSERT INTO dataset_manifest (sport,dataset,source_workbook,source_worksheet,headers_json,row_count,imported_at,source_kind) VALUES (${q(sport)},${q(tab)},'turso-native',${q(tab)},${q(JSON.stringify([...new Set(rows.flatMap(Object.keys))]))},(SELECT COALESCE(MAX(row_index),0) FROM dataset_rows WHERE sport=${q(sport)} AND dataset=${q(tab)}),${q(new Date().toISOString())},'turso') ON CONFLICT(sport,dataset) DO UPDATE SET row_count=excluded.row_count,imported_at=excluded.imported_at`);
  await runTursoAtomicSql(statements);
}

/** Called by existing scheduled producers only. No provider calls, publishing, or official record writes. */
export async function captureSelectionTrial(sport: TrialSport, sides: TrialSide[], incumbentIds: string[], now = Date.now(), stale = false) {
  const date = trialDate(now);
  let training: TrialSide[] | null = null;
  let fadeCandidate: FadeModel | null = null;
  let model = parseModels(await readTursoDatasetByDateKeys(sport, TRIAL_MODELS_TAB, [date]), sport, date);
  if (!model) {
    training = trialSidesFromRows(sport, await sourceRows(sport, date));
    const observations = new Map<TrialMarket, TrialCalibrationObservation[]>();
    const candidate = buildTrialModel(sport, date, training, now, (market, rows) => observations.set(market, rows));
    try { fadeCandidate = buildFadeTrialFromBase(candidate, observations, now); }
    catch (error) { console.error("[selection-fade] Initial calibration unavailable", { sport, date, error }); }
    const pending = await runTursoSql([`SELECT DISTINCT date_key FROM dataset_rows INDEXED BY idx_dataset_rows_date WHERE sport=${q(sport)} AND dataset=${q(TRIAL_DECISIONS_TAB)} AND date_key<${q(date)} AND selection=${q(SELECTION_TRIAL_VERSION)} AND result='PENDING'`]);
    candidate.pendingDates = pending[0].map(row => row.date_key);
    await insertImmutable(sport, TRIAL_MODELS_TAB, [modelRow(candidate)]);
    // Use the actual winner of an overlapping first-write race.
    model = parseModels(await readTursoDatasetByDateKeys(sport, TRIAL_MODELS_TAB, [date]), sport, date);
    if (!model) throw new Error("Trial daily model was not saved");
  }
  let fadeModel: FadeModel | null = null;
  try {
    fadeModel = parseFadeModel(await readTursoDatasetByDateKeys(sport, FADE_MODELS_TAB, [date]), sport, date);
    if (!fadeModel) {
      training ||= trialSidesFromRows(sport, await sourceRows(sport, date));
      const candidate = fadeCandidate || buildFadeTrialModel(sport, date, training, now);
      await insertImmutable(sport, FADE_MODELS_TAB, [{ Date: date, "Game Key": `model|${FADE_TRIAL_VERSION}`,
        Market: "Model", Selection: FADE_TRIAL_VERSION, "Details JSON": JSON.stringify(candidate) }]);
      fadeModel = parseFadeModel(await readTursoDatasetByDateKeys(sport, FADE_MODELS_TAB, [date]), sport, date);
    }
  } catch (error) { console.error("[selection-fade] Daily model unavailable", { sport, date, error }); }
  const dates = [...new Set([...Array.from({ length: 8 }, (_, i) => new Date(Date.parse(`${date}T12:00:00Z`) - i * 86400000).toISOString().slice(0, 10)),
    ...(model.pendingDates || []),
    ...sides.filter(s => s.recorded).map(s => s.date)])];
  const saved = decisionRows(await readTursoDatasetByDateKeys(sport, TRIAL_DECISIONS_TAB, dates));
  const existingKeys = new Set(saved.map(d => `${d.date}|${d.gameKey}`));
  const decisionAt = Math.max(now, Date.now());
  const fresh = stale ? [] : buildTrialDecisions(model, sides, incumbentIds, decisionAt)
    .filter(d => !existingKeys.has(`${d.date}|${d.gameKey}`)).map(d => {
      if (!fadeModel) return d;
      try { const fadeComparison = buildFadeDecision(fadeModel, d, sides); return fadeComparison ? { ...d, fadeComparison } : d; }
      catch (error) { console.error("[selection-fade] Card unavailable", { sport, date, error }); return d; }
    });
  await insertImmutable(sport, TRIAL_DECISIONS_TAB, fresh.map(decisionRow));
  const pending = saved.filter(d => d.estimates.some(e => !d.outcomes[e.id]));
  const suppliedDates = new Set(sides.filter(s => s.recorded).map(s => s.date));
  const missing = [...new Set(pending.map(d => d.date).filter(day => !suppliedDates.has(day)))];
  const settlement = [...sides, ...trialSidesFromRows(sport, await sourceRows(sport, date, missing))];
  const changed = pending.flatMap(d => {
    const next = settleTrialDecision(d, settlement, decisionAt);
    return next === d ? [] : [next];
  });
  if (changed.length) await runTursoAtomicSql(changed.map(d => {
    // Merge only settlement labels inside the string-valued Details JSON. First-write inputs remain intact.
    const details = `json_extract(payload_json,'$."Details JSON"')`;
    const labels = `json_patch(COALESCE(json_extract(${details},'$.outcomes'),'{}'),json(${q(JSON.stringify(d.outcomes))}))`;
    const status = `(CASE WHEN (SELECT COUNT(*) FROM json_each(${labels}))=4 THEN 'SETTLED' ELSE 'PENDING' END)`;
    return `UPDATE dataset_rows SET payload_json=json_set(payload_json,'$."Details JSON"',printf('%s',json_set(${details},'$.outcomes',${labels})),'$.Result',${status}),result=${status},imported_at=${q(new Date(decisionAt).toISOString())} WHERE ${keyWhere(sport, TRIAL_DECISIONS_TAB, decisionRow(d))}`;
  }));
  const status = { version: SELECTION_TRIAL_VERSION, modelId: model.id, captured: fresh.length, settledCards: changed.length,
    fadeModelId: fadeModel?.id || null, fadeCards: fresh.filter(d => d.fadeComparison).length,
    statuses: model.models.map(m => ({ market: m.market, status: m.status, trainingGames: m.games, calibrationGames: m.calibrationGames })) };
  console.info("[selection-trial]", JSON.stringify({ sport, date, ...status }));
  return status;
}

export async function readSelectionTrial(sport: TrialSport, date: string) {
  const [models, result, fadeModels] = await Promise.all([readTursoDatasetByDateKeys(sport, TRIAL_MODELS_TAB, [date]),
    runTursoSql([`SELECT payload_json FROM dataset_rows INDEXED BY idx_dataset_rows_date WHERE sport=${q(sport)} AND dataset=${q(TRIAL_DECISIONS_TAB)} AND date_key<=${q(date)} AND selection=${q(SELECTION_TRIAL_VERSION)} ORDER BY date_key DESC,row_index DESC`]),
    readTursoDatasetByDateKeys(sport, FADE_MODELS_TAB, [date])]);
  const all = decisionRows(result[0].map(r => JSON.parse(r.payload_json))), model = parseModels(models, sport, date);
  let fadeModel: FadeModel | null = null;
  try { fadeModel = parseFadeModel(fadeModels, sport, date); }
  catch (error) { console.error("[selection-fade] Saved report model unavailable", { sport, date, error }); }
  const paper = all.filter(d => d.paperComparison?.version === OPPOSITE_TRIAL_POLICY.version);
  const reversal = paper.filter(d => d.paperComparison!.oppositePickId);
  const fades = all.filter(d => d.fadeComparison?.version === FADE_TRIAL_VERSION);
  const selectedFades = fades.filter(d => d.fadeComparison!.pickId);
  const fadeOriginals = selectedFades.map(d => ({ ...d,
    pickId: d.fadeComparison!.estimates.find(e => e.id === d.fadeComparison!.pickId)!.sourceId }));
  return { ok: true, sport, date, version: SELECTION_TRIAL_VERSION, mode: "RESEARCH_ONLY", available: Boolean(model),
    policy: TRIAL_POLICY, model, trial: trialRecord(all, "trial"), comparison: trialRecord(all, "incumbent"),
    comparisonScope: "Incumbent selections on the same complete captured game cards and saved quotes; not its full official record.",
    capturedGames: all.length, passedGames: all.filter(d => !d.pickId).length, today: all.filter(d => d.date === date),
    paperTrial: { policy: OPPOSITE_TRIAL_POLICY, capturedGames: paper.length, reversalGames: reversal.length,
      startedAt: paper.length ? paper.map(d => d.capturedAt).sort()[0] : null,
      raw: trialRecord(paper, "raw"), matchedRaw: trialRecord(reversal, "raw"), opposite: trialRecord(reversal, "opposite"),
      comparisonScope: "Prospective versioned paper cards only. Matched raw and opposite records use the same reversal games and each side's saved price. Historical reversed records are excluded." },
    fadeTrial: { policy: FADE_POLICY, available: Boolean(fadeModel), capturedGames: fades.length,
      record: trialRecord(fades, "fade"), matchedOriginal: trialRecord(fadeOriginals, "trial"),
      model: fadeModel ? { id: fadeModel.id, createdAt: fadeModel.createdAt, trainingCutoff: fadeModel.trainingCutoff,
        models: fadeModel.models.map(({ samples, ...summary }) => ({ ...summary,
          trainingGames: fadeModel!.baseModel.models.find(m => m.market === summary.market)!.games,
          trainingDates: fadeModel!.baseModel.models.find(m => m.market === summary.market)!.dates })) } : null,
      note: "Separately calibrated fade probabilities and conservative ROI. New pregame cards only; historical replays are excluded. Uncertainty is approximate, not a validated confidence interval." },
    note: "Prospective trial only. Estimated returns are model estimates. No automatic promotion or publishing. Assumed and unverified prices are identified." };
}

/** MLB starts its own original quote archive; old ranking scores never become probability inputs. */
export async function captureMlbSelectionTrial(payload: Record<string, any>, now = Date.now()) {
  const date = trialDate(now);
  const existing = await readTursoDatasetByDateKeys("MLB", TRIAL_MLB_INPUTS_TAB,
    Array.from({ length: 8 }, (_, i) => new Date(Date.parse(`${date}T12:00:00Z`) - i * 86400000).toISOString().slice(0, 10)));
  const sides = trialSidesFromRows("MLB", existing), records = (payload.trendRecordRows || []) as Record<string, any>[];
  const { mlbTrialSides } = await import("./selectionTrialMlb");
  const quotes = mlbTrialSides(payload.trendPlays || [], date);
  const newSides = quotes.filter(s => !sides.some(old => old.id === s.id));
  const rows = newSides.map(s => ({ Date: s.date, "Game Key": s.gameKey, Market: s.market, Selection: s.id,
    "Pick Key": s.id, "Policy Version": s.policyVersion!, Result: "", "Result Updated": "", "Details JSON": JSON.stringify(s) }));
  await insertImmutable("MLB", TRIAL_MLB_INPUTS_TAB, rows);
  const updated = [...sides, ...newSides].map(side => {
    const record = records.find(r => r.date === side.date && String(r.gameKey) === side.gameKey && r.market === side.market
      && String(r.selection).replace(/\s+[+-]?\d+(?:\.\d+)?$/, "") === side.selection.replace(/\s+[+-]?\d+(?:\.\d+)?$/, ""));
    if (!record || !/^[WLP]$/.test(record.result) || Date.parse(side.gameTime) >= now) return side;
    try {
      const original = JSON.parse(record.trendScoreDetails || "{}");
      if (Number(original.line) !== side.line && side.market !== "Moneyline") return side;
      if (String(record.odds) !== side.odds) return side;
      return { ...side, result: record.result, resultUpdated: side.result === record.result ? side.resultUpdated : new Date(now).toISOString() } as TrialSide;
    } catch { return side; }
  });
  const changes = updated.filter(s => s.result && sides.find(old => old.id === s.id)?.result !== s.result);
  if (changes.length) await runTursoAtomicSql(changes.map(s => {
    const row = { Date: s.date, "Game Key": s.gameKey, Market: s.market, Selection: s.id };
    return `UPDATE dataset_rows SET payload_json=json_set(payload_json,'$.Result',${q(s.result)},'$."Result Updated"',${q(s.resultUpdated)}),result=${q(s.result)},imported_at=${q(new Date(now).toISOString())} WHERE ${keyWhere("MLB", TRIAL_MLB_INPUTS_TAB, row)}`;
  }));
  const ids = (payload.aiPicks || []).filter((p: Record<string, any>) => p.selected !== false).map((p: Record<string, any>) =>
    updated.find(s => s.gameKey === String(p.gameKey) && s.market === p.market && s.selection === (p.play || p.selection))?.id).filter(Boolean);
  return captureSelectionTrial("MLB", updated, ids, now, payload.draftKings?.stale === true || payload.stale === true);
}
