import { readTursoDatasetByDateKeys, runTursoAtomicSql, runTursoSql, type TursoRow } from "./tursoStore";
import { readTrialSourceRows, trialSidesFromRows, insertTrialRows } from "./selectionTrialStore";
import { trialDate, trialOdds, settleTrialDecision } from "./selectionTrial";
import { signalRecord } from "./footballSignals";
import { buildContextModel, buildContextDecisions, buildContextPreviews, validContextModel, MATCHUP_CONTEXT_VERSION,
  type ContextModel, type ContextDecision, type ContextReview, type ContextSide, type ContextSport } from "./matchupContext";

export const CONTEXT_MODELS_TAB = "matchup_context_models";
export const CONTEXT_DECISIONS_TAB = "matchup_context_decisions";
export const CONTEXT_PENDING_TAB = "matchup_context_pending";
const q = (value: unknown) => `'${String(value ?? "").replaceAll("'", "''")}'`;
const details = `json_extract(payload_json,'$."Details JSON"')`;

function modelFromRows(rows: TursoRow[], sport: ContextSport, date: string): ContextModel | null {
  const row = rows.find(row => row.Selection === MATCHUP_CONTEXT_VERSION);
  if (!row) return null;
  const model = JSON.parse(row["Details JSON"]) as ContextModel;
  if (!validContextModel(model, sport, date)) throw new Error("Saved matchup context model is invalid");
  return model;
}

function decisionsFromRows(rows: TursoRow[]): ContextDecision[] {
  return rows.filter(row => row.Selection === MATCHUP_CONTEXT_VERSION).map(row => {
    const decision = JSON.parse(row["Details JSON"]) as ContextDecision;
    if (decision.version !== MATCHUP_CONTEXT_VERSION || decision.date !== row.Date || decision.gameKey !== row["Game Key"]
      || decision.estimates.length !== 4 || decision.cases.length !== 4) throw new Error("Saved matchup context decision is invalid");
    return decision;
  });
}

const decisionRow = (decision: ContextDecision): TursoRow => ({ Date: decision.date, "Game Key": decision.gameKey,
  Game: decision.game, Market: "Context", Selection: MATCHUP_CONTEXT_VERSION,
  Result: decision.estimates.every(estimate => decision.outcomes[estimate.id]) ? "SETTLED" : "PENDING",
  "Details JSON": JSON.stringify(decision) });

/** One refreshable slate preview; frozen decisions and their record have separate ownership. */
async function savePreviews(sport: ContextSport, date: string, reviews: ContextReview[], now: number) {
  const next = { updatedAt: new Date(now).toISOString(), reviews };
  const row = { Date: date, "Game Key": `pending|${MATCHUP_CONTEXT_VERSION}`, Market: "Context", Selection: MATCHUP_CONTEXT_VERSION,
    "Details JSON": JSON.stringify(next) };
  await insertTrialRows(sport, CONTEXT_PENDING_TAB, [row]);
  // Preserve the last pregame review when a game starts or leaves the feed.
  // Merge against the row inside the transaction so overlapping producers
  // cannot discard a review saved after either producer started its work.
  const merged = `(SELECT json_group_array(json(value)) FROM (
    SELECT value FROM json_each(${q(JSON.stringify(reviews))})
    UNION ALL SELECT old.value FROM json_each(${details},'$.reviews') old
      WHERE NOT EXISTS (SELECT 1 FROM json_each(${q(JSON.stringify(reviews))}) fresh
        WHERE json_extract(fresh.value,'$.gameKey')=json_extract(old.value,'$.gameKey'))))`;
  const retained = `printf('%s',json_set(${q(JSON.stringify(next))},'$.reviews',json(${merged})))`;
  await runTursoAtomicSql([`UPDATE dataset_rows SET payload_json=json_set(${q(JSON.stringify(row))},'$."Details JSON"',${retained}),imported_at=${q(new Date(now).toISOString())}
    WHERE sport=${q(sport)} AND dataset=${q(CONTEXT_PENDING_TAB)} AND date_key=${q(date)} AND selection=${q(MATCHUP_CONTEXT_VERSION)}
      AND json_extract(${details},'$.updatedAt')<${q(new Date(now).toISOString())}`]);
}

/** Producers refresh pending reviews and own final capture/settlement. Pages only read saved analysis. */
export async function captureMatchupContext(sport: ContextSport, sides: ContextSide[], incumbentIds: string[], now = Date.now(), stale = false) {
  const date = trialDate(now);
  const [pending] = await runTursoSql([`SELECT DISTINCT date_key FROM dataset_rows INDEXED BY idx_dataset_rows_date
    WHERE sport=${q(sport)} AND dataset=${q(CONTEXT_DECISIONS_TAB)} AND date_key<=${q(date)} AND result='PENDING'`]);
  const pendingDates = pending.map(row => row.date_key);
  const dates = [...new Set([date, ...pendingDates, ...sides.filter(side => side.recorded && side.date <= date).map(side => side.date)])];
  const saved = decisionsFromRows(await readTursoDatasetByDateKeys(sport, CONTEXT_DECISIONS_TAB, dates));
  const quoteKey = (side: ContextSide) => JSON.stringify([side.id, side.snapshotAt, side.line, side.odds]);
  const supplied = new Set(sides.filter(side => side.recorded).map(quoteKey));
  const missing = [...new Set(saved.filter(decision => decision.estimates.some(estimate => !supplied.has(
    JSON.stringify([estimate.id, estimate.quoteAt, estimate.line, estimate.odds])))).map(decision => decision.date))];
  const settlement = [...sides, ...trialSidesFromRows(sport, await readTrialSourceRows(sport, date, missing))];
  const changed = saved.flatMap(decision => {
    const next = settleTrialDecision(decision, settlement, now);
    return next === decision ? [] : [{ ...next, outcomes: Object.fromEntries(Object.entries(next.outcomes)
      .map(([id, outcome]) => [id, { ...outcome, knownAt: new Date(outcome.knownAt).toISOString() }])) } as ContextDecision];
  });
  if (changed.length) await runTursoAtomicSql(changed.map(decision => {
    const labels = `json_patch(COALESCE(json_extract(${details},'$.outcomes'),'{}'),json(${q(JSON.stringify(decision.outcomes))}))`;
    const status = `CASE WHEN (SELECT COUNT(*) FROM json_each(${labels}))=4 THEN 'SETTLED' ELSE 'PENDING' END`;
    return `UPDATE dataset_rows SET payload_json=json_set(payload_json,'$."Details JSON"',printf('%s',json_set(${details},'$.outcomes',${labels})),'$.Result',${status}),
      result=${status},imported_at=${q(new Date(now).toISOString())} WHERE sport=${q(sport)} AND dataset=${q(CONTEXT_DECISIONS_TAB)}
      AND date_key=${q(decision.date)} AND game_key=${q(decision.gameKey)} AND selection=${q(MATCHUP_CONTEXT_VERSION)}
      AND NOT EXISTS (SELECT 1 FROM json_each(${details},'$.outcomes') old JOIN json_each(${q(JSON.stringify(decision.outcomes))}) incoming ON old.key=incoming.key
        WHERE json_extract(old.value,'$.knownAt')>json_extract(incoming.value,'$.knownAt')
          OR (json_extract(old.value,'$.knownAt')=json_extract(incoming.value,'$.knownAt')
            AND json_extract(old.value,'$.result')<>json_extract(incoming.value,'$.result')))`;
  }));
  const existing = new Set(saved.map(decision => decision.gameKey));
  const candidate = sides.some(side => side.date === date && side.recorded && !existing.has(side.gameKey)
    && Date.parse(side.gameTime) - now >= 600_000 && Date.parse(side.gameTime) - now <= 1_200_000);
  const previewCandidate = sides.some(side => side.date === date && !side.recorded && !existing.has(side.gameKey)
    && ["LIVE", "FINAL_PREGAME"].includes(side.status) && Date.parse(side.scheduledGameTime || side.gameTime) > now);
  if (stale || (!candidate && !previewCandidate)) return { captured: 0, settled: changed.length, pending: 0 };

  let model = modelFromRows(await readTursoDatasetByDateKeys(sport, CONTEXT_MODELS_TAB, [date]), sport, date);
  if (!model) {
    const training = trialSidesFromRows(sport, await readTrialSourceRows(sport, date, undefined, true)) as ContextSide[];
    const prepared = buildContextModel(sport, date, training, now);
    await insertTrialRows(sport, CONTEXT_MODELS_TAB, [{ Date: date, "Game Key": `model|${MATCHUP_CONTEXT_VERSION}`,
      Market: "Model", Selection: MATCHUP_CONTEXT_VERSION, "Details JSON": JSON.stringify(prepared) }]);
    model = modelFromRows(await readTursoDatasetByDateKeys(sport, CONTEXT_MODELS_TAB, [date]), sport, date);
    if (!model) throw new Error("Matchup context model was not saved");
  }
  const decisionAt = Math.max(now, Date.now());
  const fresh = buildContextDecisions(model, sides, incumbentIds, decisionAt)
    .filter(decision => !existing.has(decision.gameKey));
  await insertTrialRows(sport, CONTEXT_DECISIONS_TAB, fresh.map(decisionRow));
  const frozen = new Set([...existing, ...fresh.map(decision => decision.gameKey)]);
  const previews = buildContextPreviews(model, sides, incumbentIds, decisionAt).filter(review => !frozen.has(review.gameKey));
  await savePreviews(sport, date, previews, decisionAt);
  return { captured: fresh.length, settled: changed.length, pending: previews.length, modelId: model.id };
}

export async function readMatchupContext(sport: ContextSport, date: string, now = Date.now()) {
  const model = modelFromRows(await readTursoDatasetByDateKeys(sport, CONTEXT_MODELS_TAB, [date]), sport, date);
  // Read pending first so a concurrent final capture always takes precedence below.
  const pendingRows = await readTursoDatasetByDateKeys(sport, CONTEXT_PENDING_TAB, [date]);
  const saved = decisionsFromRows(await readTursoDatasetByDateKeys(sport, CONTEXT_DECISIONS_TAB, [date]));
  const frozen = new Set(saved.map(decision => decision.gameKey));
  const previews = pendingRows.filter(row => row.Selection === MATCHUP_CONTEXT_VERSION).flatMap(row => {
    const pending = JSON.parse(row["Details JSON"]) as { reviews: ContextReview[] };
    return pending.reviews.filter(review => review.version === MATCHUP_CONTEXT_VERSION && review.sport === sport && review.date === date
      && review.reviewStatus === "PENDING" && review.estimates.length === 4 && review.cases.length === 4
      && Date.parse(review.sourceSnapshotAt) <= Date.parse(review.capturedAt)
      && Date.parse(review.capturedAt) < Date.parse(review.gameTime) && Date.parse(review.capturedAt) <= now
      && !frozen.has(review.gameKey)).map(review => ({ ...review,
        reviewStatus: Date.parse(review.gameTime) <= now ? "MISSED_FINAL" as const : "PENDING" as const }));
  });
  const today: ContextReview[] = [...saved.map(decision => ({ ...decision, reviewStatus: "FINAL" as const })), ...previews]
    .sort((a, b) => a.gameTime.localeCompare(b.gameTime) || a.gameKey.localeCompare(b.gameKey));
  const [records, counts] = await runTursoSql([
    `SELECT json_extract(e.value,'$.odds') AS odds, json_extract(e.value,'$.priceBasis') AS priceBasis,
      COALESCE(json_extract(o.value,'$.result'),'') AS result FROM dataset_rows r INDEXED BY idx_dataset_rows_date,
      json_each(${details},'$.estimates') e LEFT JOIN json_each(${details},'$.outcomes') o ON o.key=json_extract(e.value,'$.id')
      WHERE r.sport=${q(sport)} AND r.dataset=${q(CONTEXT_DECISIONS_TAB)} AND r.date_key<=${q(date)}
        AND r.selection=${q(MATCHUP_CONTEXT_VERSION)} AND json_extract(e.value,'$.id')=json_extract(${details},'$.pickId')`,
    `SELECT COUNT(*) AS games, SUM(CASE WHEN json_extract(${details},'$.pickId') IS NULL THEN 1 ELSE 0 END) AS passed
      FROM dataset_rows INDEXED BY idx_dataset_rows_date WHERE sport=${q(sport)} AND dataset=${q(CONTEXT_DECISIONS_TAB)}
        AND date_key<=${q(date)} AND selection=${q(MATCHUP_CONTEXT_VERSION)}`,
  ]);
  const priced = records.filter(row => trialOdds(row.odds)).map(row => ({ odds: row.odds, result: row.result as "W" | "L" | "P" | "" }));
  return { ok: true, available: Boolean(model || today.length), version: MATCHUP_CONTEXT_VERSION, sport, date,
    model: model ? { id: model.id, trainingCutoff: model.trainingCutoff,
      models: model.models.map(({ beta, covariance, ...summary }) => summary) } : null,
    capturedGames: Number(counts[0]?.games || 0), passedGames: Number(counts[0]?.passed || 0),
    pendingGames: previews.filter(review => review.reviewStatus === "PENDING").length,
    missedFinalGames: previews.filter(review => review.reviewStatus === "MISSED_FINAL").length,
    record: { ...signalRecord(priced), assumedPrices: records.filter(row => row.priceBasis === "Assumed -110").length,
      unverifiedPrices: records.filter(row => row.priceBasis === "Unverified provenance").length }, today };
}
