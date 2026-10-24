import { runTursoSql } from "./tursoStore";
import { nbaDate, settleNbaForecast } from "./nbaMarketCore";

const q = (value: string) => `'${value.replaceAll("'", "''")}'`;
async function readForecasts(start: string, end: string, includeDate: (date: string) => boolean): Promise<Record<string, any>[]> {
  return runTursoSql([`SELECT p.record_id,p.game_id,p.model_version,p.locked_at,json_extract(p.payload_json,'$.tipoff') AS tipoff,json_extract(p.payload_json,'$.selected') AS selected,json_extract(p.payload_json,'$.inputs.automation.phase') AS phase,json_extract(p.payload_json,'$.review_method') AS review_method,(SELECT json_extract(r.payload_json,'$.game') FROM nba_research_results r WHERE r.game_id=p.game_id ORDER BY r.observed_at DESC,r.observation_id DESC LIMIT 1) AS observed_game FROM nba_research_predictions p WHERE p.locked_at>=${q(start)} AND p.locked_at<${q(end)} ORDER BY p.locked_at DESC`])
    .then(result => result[0].flatMap(row => {
      if (!row.tipoff || !Number.isFinite(Date.parse(row.tipoff)) || !includeDate(nbaDate(Date.parse(row.tipoff)))) return [];
      const selected = JSON.parse(row.selected);
      const settled = settleNbaForecast(selected, row.observed_game ? JSON.parse(row.observed_game) : null, row.game_id, row.locked_at);
      const { away_rotation, home_rotation, flags, ...summary } = selected;
      return [{ recordId: row.record_id, gameId: row.game_id, modelVersion: row.model_version, lockedAt: row.locked_at, tipoff: row.tipoff,
        phase: row.phase || "manual", reviewMethod: row.review_method || "manual", ...summary, ...settled }];
    })).catch(error => { if (String(error).toLowerCase().includes("no such table")) return []; throw error; });
}

const endOfRead = (date: string) => `${new Date(Date.parse(`${date}T12:00:00Z`) + 2 * 86400000).toISOString().slice(0, 10)}T00:00:00+00:00`;
export function readNbaForecasts(date: string) {
  return readForecasts(`${date}T00:00:00+00:00`, endOfRead(date), day => day === date);
}

/** Used once to seed compact season totals, rather than on ordinary collector ticks. */
export function readNbaForecastHistory(date: string) {
  const year = Number(date.slice(0, 4)) - (Number(date.slice(5, 7)) < 7 ? 1 : 0), start = `${year}-07-01`;
  return readForecasts(`${start}T00:00:00+00:00`, endOfRead(date), day => day >= start && day <= date);
}
