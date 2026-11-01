import { readTursoDatasetByDateKeys, runTursoSql } from "./tursoStore";

export const NCAAM_FORECAST_TAB = "ncaam_model_forecasts";
const decode = (rows: Record<string, string>[]) => rows.map(row => JSON.parse(row["Details JSON"]));
export async function readNcaamForecasts(date: string) {
  return decode(await readTursoDatasetByDateKeys("NCAAM", NCAAM_FORECAST_TAB, [date]));
}
/** One-time season rollup seed; ordinary reads use the saved analysis state. */
export async function readNcaamForecastHistory(date: string) {
  const year = Number(date.slice(0, 4)) - (Number(date.slice(5, 7)) < 7 ? 1 : 0);
  const q = (s: string) => `'${s.replaceAll("'", "''")}'`;
  const result = await runTursoSql([`SELECT payload_json FROM dataset_rows WHERE sport='NCAAM' AND dataset='${NCAAM_FORECAST_TAB}' AND date_key>=${q(`${year}-07-01`)} AND date_key<=${q(date)}`]);
  return decode(result[0].map(row => JSON.parse(row.payload_json)));
}
