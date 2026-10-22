import { runTursoSql } from "./tursoStore";
import { nbaDate, settleNbaForecast } from "./nbaMarketCore";

const q = (value: string) => `'${value.replaceAll("'", "''")}'`;
export async function readNbaForecasts(date: string): Promise<Record<string, any>[]> {
  return runTursoSql([`SELECT p.game_id,p.model_version,p.locked_at,json_extract(p.payload_json,'$.tipoff') AS tipoff,json_extract(p.payload_json,'$.selected') AS selected,json_extract(p.payload_json,'$.inputs.automation.phase') AS phase,json_extract(p.payload_json,'$.review_method') AS review_method,(SELECT json_extract(r.payload_json,'$.game') FROM nba_research_results r WHERE r.game_id=p.game_id ORDER BY r.observed_at DESC LIMIT 1) AS observed_game FROM nba_research_predictions p WHERE p.locked_at>=${q(`${date}T00:00:00+00:00`)} AND p.locked_at<${q(`${new Date(Date.parse(`${date}T00:00:00Z`)+2*86_400_000).toISOString().slice(0,10)}T00:00:00+00:00`)} ORDER BY p.locked_at DESC`])
    .then(result => result[0].flatMap(row => {
      if (!row.tipoff || nbaDate(Date.parse(row.tipoff)) !== date) return [];
      const selected = JSON.parse(row.selected);
      const settled = settleNbaForecast(selected, row.observed_game ? JSON.parse(row.observed_game) : null, row.game_id, row.locked_at);
      const { away_rotation, home_rotation, flags, ...summary } = selected;
      return [{ gameId: row.game_id, modelVersion: row.model_version, lockedAt: row.locked_at, tipoff: row.tipoff,
        phase: row.phase || "manual", reviewMethod: row.review_method || "manual", ...summary, ...settled }];
    })).catch(error => { if (String(error).toLowerCase().includes("no such table")) return []; throw error; });
}
