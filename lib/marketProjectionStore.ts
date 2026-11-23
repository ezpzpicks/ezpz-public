import { createHash } from "node:crypto";
import { readTursoDatasetByDateKeys, runTursoSql, runTursoAtomicSql, invalidateTursoDatasetReadCache, type TursoRow } from "./tursoStore";
import { MARKET_PROJECTION_POLICY as POLICY, MARKET_PROJECTION_PARAMETERS as P, MARKET_PROJECTION_ACTIVATION as ACTIVATION,
  MARKET_PROJECTION_UPDATES as UPDATES, trackingModelVersion, type TrackingSport, type MarketProjectionActivation } from "./marketProjectionPolicy";
import { buildMarketTrackedProjection, validMarketTrackedProjection, projectionTrackingInputs, projectionFingerprint,
  ProjectionDataPending, projectionTime, projectionGameKey, type ProjectionBaseline } from "./marketProjectionTracking";

type Row = Record<string, any>;
const q = (value: unknown) => `'${String(value ?? "").replaceAll("'", "''")}'`;
const decode = (rows: TursoRow[]) => rows.map(r => JSON.parse(r["Details JSON"]));
const canonical = (v: any): string => Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object"
  ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}` : JSON.stringify(v);
export const projectionDigest = (v: unknown) => createHash("sha256").update(canonical(v)).digest("hex");
export async function readMarketProjectionActivation(sport: TrackingSport): Promise<MarketProjectionActivation | null> {
  const rows = decode(await readTursoDatasetByDateKeys(sport, ACTIVATION, ["policy"]));
  if (!rows.length) return null;
  const a = rows[0];
  if (rows.length !== 1 || a.sport !== sport || a.policy !== POLICY || a.modelVersion !== trackingModelVersion(sport)
    || !Number.isFinite(projectionTime(a.activatedAt)) || a.gradingStatus !== "ungraded") throw new Error("Invalid market tracking activation.");
  return a;
}
export async function readMarketProjectionUpdates(sport: TrackingSport, dates: string[]): Promise<Row[]> {
  if (!dates.length) return [];
  if (dates.length > 10 || dates.some(d => !/^\d{4}-\d{2}-\d{2}$/.test(d))) throw new Error("Choose bounded tracking slate dates.");
  const where = `sport=${q(sport)} AND dataset=${q(UPDATES)} AND date_key IN (${dates.map(q).join(",")})`;
  const result = await runTursoSql([`WITH ranked AS (SELECT row_index,ROW_NUMBER() OVER (PARTITION BY game_key ORDER BY CASE WHEN market='Final Forecast' THEN 0 ELSE 1 END,snapshot_time DESC,row_index DESC) AS rank FROM dataset_rows WHERE ${where}) SELECT d.payload_json FROM ranked r JOIN dataset_rows d ON d.sport=${q(sport)} AND d.dataset=${q(UPDATES)} AND d.row_index=r.row_index WHERE r.rank=1`]);
  return decode(result[0].map(r => JSON.parse(r.payload_json)));
}
/** Immutable, idempotent snapshots. No existing forecast, quote or grade is updated. */
export async function appendMarketProjectionRows(sport: TrackingSport, dataset: string, rows: TursoRow[]) {
  if (![ACTIVATION, UPDATES].includes(dataset)) throw new Error("Unsupported tracking dataset.");
  for (let start = 0; start < rows.length; start += 10) {
    const batch = rows.slice(start, start + 10), statements: string[] = [];
    for (const row of batch) {
      const where = `sport=${q(sport)} AND dataset=${q(dataset)} AND date_key=${q(row.Date)} AND game_key=${q(row["Game Key"])} AND market=${q(row.Market)} AND selection=${q(row.Selection)}`;
      const freezeGate = dataset === UPDATES ? ` AND NOT EXISTS(SELECT 1 FROM dataset_rows WHERE sport=${q(sport)} AND dataset=${q(dataset)} AND date_key=${q(row.Date)} AND game_key=${q(row["Game Key"])} AND market='Final Forecast')` : "";
      const values = [q(sport), q(dataset), `(SELECT COALESCE(MAX(row_index),0)+1 FROM dataset_rows WHERE sport=${q(sport)} AND dataset=${q(dataset)})`, q(JSON.stringify(row)), "''",
        q(row.Date), q(row["Game Key"]), q(row.Game), q(row.Market), q(row.Selection), "''", q(row["Snapshot Time ET"] || row["Updated At"]), q(row["Updated At"])];
      statements.push(`INSERT INTO dataset_rows (sport,dataset,row_index,payload_json,source_hash,date_key,game_key,game,market,selection,result,snapshot_time,imported_at) SELECT ${values.join(",")} WHERE NOT EXISTS(SELECT 1 FROM dataset_rows WHERE ${where})${freezeGate}`);
    }
    statements.push(`INSERT INTO dataset_manifest (sport,dataset,source_workbook,source_worksheet,headers_json,row_count,imported_at,source_kind) VALUES (${q(sport)},${q(dataset)},'turso-native',${q(dataset)},${q(JSON.stringify([...new Set(batch.flatMap(Object.keys))]))},(SELECT COALESCE(MAX(row_index),0) FROM dataset_rows WHERE sport=${q(sport)} AND dataset=${q(dataset)}),${q(batch[0]["Updated At"])},'turso') ON CONFLICT(sport,dataset) DO UPDATE SET headers_json=excluded.headers_json,row_count=excluded.row_count,imported_at=excluded.imported_at`);
    try { await runTursoAtomicSql(statements); } finally { invalidateTursoDatasetReadCache(sport, dataset); }
  }
}
async function activate(sport: TrackingSport, now: number) {
  const existing = await readMarketProjectionActivation(sport); if (existing) return existing;
  const a: MarketProjectionActivation = { sport, policy: POLICY, modelVersion: trackingModelVersion(sport), activatedAt: new Date(now).toISOString(), gradingStatus: "ungraded" };
  await appendMarketProjectionRows(sport, ACTIVATION, [{ Date: "policy", "Game Key": POLICY, Market: "Activation", Selection: a.modelVersion,
    "Updated At": a.activatedAt, "Details JSON": JSON.stringify(a) }]);
  const saved = await readMarketProjectionActivation(sport); if (!saved) throw new Error("Tracking activation was not saved."); return saved;
}
export function verifiedMarketProjections(rows: Row[], activation: MarketProjectionActivation | null, now: number) {
  if (!activation) return [];
  return rows.filter(f => {
    if (!validMarketTrackedProjection(f, activation, now)) return false;
    const t = f.market_tracking;
    return t.input_digest === projectionDigest(projectionFingerprint(t.baseline, { histories: t.histories, observedAt: t.decision_as_of, finalPregame: t.final_pregame, source: t.source }));
  });
}
export async function readMarketProjectionBundle(sport: TrackingSport, dates: string[], now = Date.now()) {
  const [activation, rows] = await Promise.all([readMarketProjectionActivation(sport), readMarketProjectionUpdates(sport, dates)]);
  return { activation, forecasts: verifiedMarketProjections(rows, activation, now) };
}
export async function refreshMarketProjections(sport: TrackingSport, baselines: ProjectionBaseline[], splits: TursoRow[], dates: string[], now: number) {
  const activation = await activate(sport, now), saved = verifiedMarketProjections(await readMarketProjectionUpdates(sport, dates), activation, now);
  const previous = new Map(saved.map(f => [projectionGameKey(sport, f.market_tracking.baseline.date, f.away_team, f.home_team, f.tipoff), f]));
  const grouped = new Map<string, ProjectionBaseline[]>();
  for (const base of baselines.filter(b => b.sport === sport && projectionTime(b.tipoff) > now && projectionTime(b.lockedAt) <= now)) {
    const key = projectionGameKey(sport, base.date, base.away_team, base.home_team, base.tipoff);
    grouped.set(key, [...(grouped.get(key) || []), base]);
  }
  const rows: TursoRow[] = [], errors: {game:string;reason:string}[] = [];
  let waitingForFreshMarket = 0, waitingForBaseline = 0, frozen = 0;
  for (const [key, candidates] of grouped) {
    const old = previous.get(key); if (old?.market_tracking.final_pregame) { frozen++; continue; }
    try {
      const ordered = candidates.sort((a,b) => projectionTime(b.lockedAt) - projectionTime(a.lockedAt) || b.recordId.localeCompare(a.recordId));
      let base = ordered[0];
      const inputs = projectionTrackingInputs(base, splits, now), cutoff = inputs.finalPregame ? projectionTime(inputs.observedAt) : now;
      const eligible = ordered.filter(b => projectionTime(b.lockedAt) <= cutoff && now - projectionTime(b.lockedAt) <= 30 * 3600000);
      if (!eligible.length) { waitingForBaseline++; continue; } base = eligible[0];
      if (projectionTime(base.tipoff) - now < 10 * 60000 && !inputs.finalPregame) continue;
      const digest = projectionDigest(projectionFingerprint(base, inputs));
      if (old?.market_tracking.input_digest === digest) continue;
      const f = buildMarketTrackedProjection(base, inputs, activation, now, digest);
      rows.push({ Date: base.date, "Game Key": key, "Game ID": base.gameId, Game: `${base.away_team} @ ${base.home_team}`,
        Market: inputs.finalPregame ? "Final Forecast" : "Forecast", Selection: f.recordId, "Snapshot Time ET": f.lockedAt, "Updated At": f.lockedAt, "Details JSON": JSON.stringify(f) });
    } catch (error) {
      if (error instanceof ProjectionDataPending) waitingForFreshMarket++;
      else errors.push({game:key,reason:error instanceof Error ? error.message : String(error)});
    }
  }
  await appendMarketProjectionRows(sport, UPDATES, rows);
  const result = { sport, modelVersion: activation.modelVersion, activatedAt: activation.activatedAt, gradingStatus: "ungraded",
    captured: rows.length, baselineGames: grouped.size, waitingForFreshMarket, waitingForBaseline, frozen, errors };
  console.info("[market-projection]", JSON.stringify(result)); return result;
}
/** Legacy grade eligibility is decided before latest-per-game selection. */
export function mergeTrackedBasketballForecasts(baselines: Row[], updates: Row[], activation: MarketProjectionActivation | null, now: number): Row[] {
  if (!activation) return baselines;
  const cutoff = projectionTime(activation.activatedAt), valid = verifiedMarketProjections(updates, activation, now);
  const games = new Set(valid.map(f => `${f.gameId}|${projectionTime(f.tipoff)}`));
  return [...baselines.filter(f => projectionTime(f.lockedAt) < cutoff || !games.has(`${f.gameId}|${projectionTime(f.tipoff)}`)).map(f => ({ ...f,
    legacy_grade_eligible: projectionTime(f.lockedAt) < cutoff,
    ...(projectionTime(f.tipoff) > cutoff ? { grading_status: "awaiting_market_tracking_grades", market_tracking_effective_at: activation.activatedAt } : {}) })), ...valid];
}
