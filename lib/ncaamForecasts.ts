import { readTursoDatasetByDateKeys, runTursoSql } from "./tursoStore";
import { attachNcaamMatchupGrades, NCAAM_MATCHUP_GRADE_TAB } from "./ncaamMatchupGrades";

export const NCAAM_FORECAST_TAB = "ncaam_model_forecasts";
const decode = (rows: Record<string, string>[]) => rows.map(row => JSON.parse(row["Details JSON"]));
export async function readNcaamForecasts(date: string) {
  const [forecasts, grades] = await Promise.all([
    readTursoDatasetByDateKeys("NCAAM", NCAAM_FORECAST_TAB, [date]),
    readTursoDatasetByDateKeys("NCAAM", NCAAM_MATCHUP_GRADE_TAB, [date]),
  ]);
  return attachNcaamMatchupGrades(decode(forecasts), grades);
}
/** One-time season rollup seed; ordinary reads use the saved analysis state. */
export async function readNcaamForecastHistory(date: string) {
  const year = Number(date.slice(0, 4)) - (Number(date.slice(5, 7)) < 7 ? 1 : 0);
  const q = (s: string) => `'${s.replaceAll("'", "''")}'`;
  const result = await runTursoSql([`SELECT dataset,payload_json FROM dataset_rows WHERE sport='NCAAM' AND dataset IN ('${NCAAM_FORECAST_TAB}','${NCAAM_MATCHUP_GRADE_TAB}') AND date_key>=${q(`${year}-07-01`)} AND date_key<=${q(date)}`]);
  const forecasts = result[0].filter(row => row.dataset === NCAAM_FORECAST_TAB).map(row => JSON.parse(row.payload_json));
  const grades = result[0].filter(row => row.dataset === NCAAM_MATCHUP_GRADE_TAB).map(row => JSON.parse(row.payload_json));
  return attachNcaamMatchupGrades(decode(forecasts), grades);
}
