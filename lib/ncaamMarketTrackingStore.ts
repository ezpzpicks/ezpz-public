import { createHash } from "node:crypto";
import { readTursoDatasetByDateKeys, runTursoSql, runTursoAtomicSql, invalidateTursoDatasetReadCache, type TursoRow } from "./tursoStore";
import { ncaamDate, ncaamTeamKey } from "./ncaamMarketCore";
import { ncaamTrackingInputs, ncaamBaselineTrackingInputs, ncaamTrackingFingerprint, buildNcaamTrackedForecast, validNcaamTrackingForecast, NcaamTrackingDataPending } from "./ncaamMarketTracking";
import { NCAAM_MARKET_TRACKING as P, NCAAM_REVERSED_SPREAD_FROM, NCAAM_REVERSED_SPREAD_MODEL, NCAAM_REVERSED_TOTAL_MODEL, NCAAM_REVERSED_TOTAL_FROM, NCAAM_TRACKING_ACTIVATION_TAB, NCAAM_TRACKING_FORECAST_TAB,
  type NcaamTrackingActivation } from "./ncaamMarketTrackingPolicy";
import { marketCapPolicyForNewCapture, marketTime } from "./ncaamMarketFlow";
type Row = Record<string, any>;
const q = (value: unknown) => `'${String(value ?? "").replaceAll("'", "''")}'`;
const parse = (rows: TursoRow[]) => rows.flatMap(row => { try { return [JSON.parse(row["Details JSON"])]; } catch { return []; } });
function canonical(value: any): string {
  return Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object"
    ? `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}` : JSON.stringify(value);
}
export const ncaamTrackingDigest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
/** Read only the latest payload per game; all earlier audit snapshots stay saved. */
export async function readNcaamTrackingLatestRows(date: string): Promise<TursoRow[]> {
  const selector = `sport='NCAAM' AND dataset=${q(NCAAM_TRACKING_FORECAST_TAB)} AND date_key=${q(date)}`;
  const result = await runTursoSql([`WITH ranked AS (SELECT row_index,ROW_NUMBER() OVER (PARTITION BY game_key ORDER BY snapshot_time DESC,row_index DESC) AS rank FROM dataset_rows WHERE ${selector}) SELECT d.payload_json FROM ranked r JOIN dataset_rows d ON d.sport='NCAAM' AND d.dataset=${q(NCAAM_TRACKING_FORECAST_TAB)} AND d.row_index=r.row_index WHERE r.rank=1`]);
  return result[0].map(row=>JSON.parse(row.payload_json));
}
export async function readNcaamTrackingActivation(): Promise<NcaamTrackingActivation | null> {
  const rows = parse(await readTursoDatasetByDateKeys("NCAAM", NCAAM_TRACKING_ACTIVATION_TAB, ["policy"]));
  if (!rows.length) return null;
  if (rows.length!==1 || rows[0].policy!==P.flow_policy || rows[0].modelVersion!==P.model_version || !Number.isFinite(Date.parse(rows[0].activatedAt))) throw new Error("Market tracking activation is invalid.");
  return rows[0];
}
/** Insert-only snapshots: first successful publication owns an identity forever. */
export async function appendNcaamTrackingRows(dataset: string, rows: TursoRow[]) {
  for (let start=0; start<rows.length; start+=10) {
    const batch = rows.slice(start,start+10), statements: string[] = [];
    for (const row of batch) {
      const identity = `sport='NCAAM' AND dataset=${q(dataset)} AND date_key=${q(row.Date)} AND game_key=${q(row["Game Key"])} AND market=${q(row.Market)} AND selection=${q(row.Selection)}`;
      const values = ["'NCAAM'",q(dataset),`(SELECT COALESCE(MAX(row_index),0)+1 FROM dataset_rows WHERE sport='NCAAM' AND dataset=${q(dataset)})`,q(JSON.stringify(row)),"''",q(row.Date),q(row["Game Key"]),q(row.Game),q(row.Market),q(row.Selection),"''",q(row["Snapshot Time ET"]||row["Updated At"]),q(row["Updated At"])];
      statements.push(`INSERT INTO dataset_rows (sport,dataset,row_index,payload_json,source_hash,date_key,game_key,game,market,selection,result,snapshot_time,imported_at) SELECT ${values.join(",")} WHERE NOT EXISTS (SELECT 1 FROM dataset_rows WHERE ${identity})`);
    }
    statements.push(`INSERT INTO dataset_manifest (sport,dataset,source_workbook,source_worksheet,headers_json,row_count,imported_at,source_kind) VALUES ('NCAAM',${q(dataset)},'turso-native',${q(dataset)},${q(JSON.stringify([...new Set(batch.flatMap(Object.keys))]))},(SELECT COALESCE(MAX(row_index),0) FROM dataset_rows WHERE sport='NCAAM' AND dataset=${q(dataset)}),${q(batch[0]["Updated At"])},'turso') ON CONFLICT(sport,dataset) DO UPDATE SET row_count=excluded.row_count,headers_json=excluded.headers_json,imported_at=excluded.imported_at`);
    try { await runTursoAtomicSql(statements); }
    finally { invalidateTursoDatasetReadCache("NCAAM",dataset); }
  }
}
async function activate(now: number) {
  const old = await readNcaamTrackingActivation();
  if (old) return old;
  const value: NcaamTrackingActivation = { policy:P.flow_policy, modelVersion:P.model_version, activatedAt:new Date(now).toISOString(), gradingStatus:"ungraded" };
  await appendNcaamTrackingRows(NCAAM_TRACKING_ACTIVATION_TAB,[{ Date:"policy","Game Key":P.flow_policy, Market:"Activation",Selection:P.model_version,"Updated At":value.activatedAt,"Details JSON":JSON.stringify(value) }]);
  const saved = await readNcaamTrackingActivation();
  if (!saved) throw new Error("Market tracking activation was not saved.");
  return saved;
}
export function reversedTotalForNewCapture(observed: number) {
  return process.env.NCAAM_TOTAL_REVERSAL_DISABLED !== "1" && observed >= Date.parse(NCAAM_REVERSED_TOTAL_FROM);
}
export function reversedSpreadForNewCapture(observed: number) {
  return reversedTotalForNewCapture(observed) && process.env.NCAAM_SPREAD_REVERSAL_DISABLED !== "1" && observed >= Date.parse(NCAAM_REVERSED_SPREAD_FROM);
}
export async function refreshNcaamMarketTracking(date: string, schedule: TursoRow[], now: number) {
  const capPolicy = marketCapPolicyForNewCapture();
  const activation = await activate(now);
  const [baseRows, splits, savedRows] = await Promise.all([
    readTursoDatasetByDateKeys("NCAAM","ncaam_model_forecasts",[date]),
    readTursoDatasetByDateKeys("NCAAM","weekly_market_trends",[date]),
    readNcaamTrackingLatestRows(date),
  ]);
  const baselines = parse(baseRows), saved = parse(savedRows), byId = new Map(baselines.map(f=>[f.recordId,f]));
  const valid = saved.filter(f=>byId.has(f.market_tracking?.baseline_forecast_record_id)
    && validNcaamTrackingForecast(f,byId.get(f.market_tracking.baseline_forecast_record_id),activation,now));
  const identities = new Set(valid.map(f=>f.recordId)), newRows: TursoRow[] = [], errors: {gameId:string;reason:string}[] = [];
  let waitingForBaseline = 0, waitingForFreshMarket = 0;
  for (const game of schedule.filter(g=>g.Date===date && g.Status==="STATUS_SCHEDULED" && Date.parse(g["Game Time"])>now)) {
    const gid = String(game["Game ID"]);
    if (valid.some(f=>f.gameId===gid && f.market_tracking.final_pregame)) continue;
    try {
      let inputs = ncaamTrackingInputs(game,splits,now);
      const cutoff = inputs?.finalPregame ? marketTime(inputs.observedAt) : now;
      const candidates = baselines.filter(f=>String(f.gameId)===gid && f.modelVersion===P.baseline_model
        && Date.parse(f.lockedAt)<=cutoff && Date.parse(f.tipoff)===Date.parse(game["Game Time"])
        && ncaamTeamKey(f.home_team)===ncaamTeamKey(game["Home Team"]) && ncaamTeamKey(f.away_team)===ncaamTeamKey(game["Away Team"]))
        .sort((a,b)=>Date.parse(b.lockedAt)-Date.parse(a.lockedAt)||String(b.recordId).localeCompare(String(a.recordId)));
      const base = candidates[0];
      if (!base) { waitingForBaseline++; continue; }
      if (!inputs) {
        inputs = ncaamBaselineTrackingInputs(base,candidates,now);
      }
      if (now-marketTime(inputs.observedAt)>P.maximum_market_age_minutes*60_000) { waitingForFreshMarket++; continue; }
      // Leave the established final window intact if the collector missed it.
      if (marketTime(game["Game Time"])-now<10*60_000 && !inputs.finalPregame) continue;
      const digest = ncaamTrackingDigest(ncaamTrackingFingerprint(base,inputs,capPolicy));
      const reversed = reversedTotalForNewCapture(marketTime(inputs.observedAt));
      const reversedSpread = reversedSpreadForNewCapture(marketTime(inputs.observedAt));
      const id = `${gid}|${reversedSpread ? NCAAM_REVERSED_SPREAD_MODEL : reversed ? NCAAM_REVERSED_TOTAL_MODEL : P.model_version}|${digest}`;
      if (identities.has(id)) continue;
      const forecast = buildNcaamTrackedForecast(base,inputs,activation,now,digest,capPolicy,reversed,reversedSpread);
      newRows.push({ Date:date,"Game Key":`${date}|ncaam|${gid}`,"Game ID":gid,Game:`${base.away_team} @ ${base.home_team}`,Market:"Forecast",Selection:forecast.recordId,"Snapshot Time ET":forecast.lockedAt,"Updated At":forecast.lockedAt,"Details JSON":JSON.stringify(forecast) });
    } catch (error) {
      if (error instanceof NcaamTrackingDataPending) waitingForFreshMarket++;
      else errors.push({gameId:gid,reason:error instanceof Error?error.message:String(error)});
    }
  }
  await appendNcaamTrackingRows(NCAAM_TRACKING_FORECAST_TAB,newRows);
  const modelVersion = reversedSpreadForNewCapture(now) ? NCAAM_REVERSED_SPREAD_MODEL : reversedTotalForNewCapture(now) ? NCAAM_REVERSED_TOTAL_MODEL : P.model_version;
  console.info("[ncaam-market-projection]",JSON.stringify({date,model:modelVersion,captured:newRows.length,waitingForBaseline,waitingForFreshMarket,errors}));
  return { modelVersion,activatedAt:activation.activatedAt,spreadPolicyEffectiveAt:NCAAM_REVERSED_SPREAD_FROM,totalPolicyEffectiveAt:NCAAM_REVERSED_TOTAL_FROM,gradingStatus:"ungraded",captured:newRows.length,waitingForBaseline,waitingForFreshMarket,errors };
}
