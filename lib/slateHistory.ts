import { footballTeamKey, footballTeamPair } from "./footballTeamTrends";
import { readTursoDatasetByDateKeys, runTursoSql, type TursoRow } from "./tursoStore";

export type SlateHistorySport = "MLB" | "NFL" | "NCAAF" | "NCAAM";
export function slateDate(value: unknown): string {
  const raw = String(value || "").trim();
  const iso = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const date = iso ? `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`
    : us ? `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}` : "";
  const stamp = Date.parse(`${date}T12:00:00Z`);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === date ? date : "";
}
function dateKeys(date: string) {
  const [year, month, day] = date.split("-");
  return [...new Set([date, `${Number(month)}/${Number(day)}/${year}`, `${month}/${day}/${year}`, `${year}/${month}/${day}`])];
}
const rowDate = (row: TursoRow) => slateDate(row.Date || row["Game Date"] || row.date);
const nonEmpty = (row: TursoRow) => Object.fromEntries(Object.entries(row).filter(([, value]) => String(value ?? "").trim() !== ""));
function sameGame(a: TursoRow, b: TursoRow, sport: SlateHistorySport) {
  const id = (row: TursoRow) => String(row["Game ID"] || row["Game Key"] || "").trim();
  if (id(a) && id(a) === id(b)) return true;
  // MLB doubleheaders must retain their separate saved game identities.
  if (sport === "MLB" && id(a) && id(b)) return false;
  const pair = (row: TursoRow) => footballTeamPair({ ...row, Game: row.Game || row["Game Label"] });
  const left = pair(a), right = pair(b);
  const key = (team: string) => sport === "NFL" || sport === "NCAAF" ? footballTeamKey(team, sport)
    : team.toLowerCase().replace(/[^a-z0-9]/g, "");
  return Boolean(left && right && left.every((team, i) => key(team) === key(right[i])));
}

/** Join stored rows only; no live schedule, odds collection, grading, or model runs. */
export function mergeSavedSlate(sport: SlateHistorySport, date: string, models: TursoRow[], schedule: TursoRow[], tracker: TursoRow[]) {
  const rows: TursoRow[] = [];
  for (const row of schedule.filter(row => rowDate(row) === date)) {
    const existing = rows.find(candidate => sameGame(candidate, row, sport));
    if (existing) Object.assign(existing, nonEmpty(row));
    else rows.push({ ...row, Date: date });
  }
  for (const model of models.filter(row => rowDate(row) === date)) {
    const existing = rows.find(row => sameGame(row, model, sport));
    if (!existing) rows.push({ ...model, Date: date });
    else {
      // Preserve official matchup identity and kickoff while attaching saved model fields.
      const identity = Object.fromEntries(["Game ID", "Game Key", "Game", "Game Time", "Away Team", "Home Team"]
        .filter(key => existing[key]?.trim()).map(key => [key, existing[key]]));
      Object.assign(existing, nonEmpty(model), identity, { Date: date });
    }
  }
  if (sport !== "NFL") return rows;
  return rows.map(row => {
    const matching = tracker.filter(candidate => rowDate(candidate) === date && sameGame(row, candidate, sport));
    const projection = matching.find(candidate => candidate["Projected Away"]?.trim() && candidate["Projected Home"]?.trim());
    if (!projection) return row;
    const recovered: TursoRow = {};
    for (const field of ["Projected Away", "Projected Home", "Reliability", "Data Confidence", "Personnel Confidence", "Model Version"])
      recovered[field] = projection[field] || "";
    const away = Number(projection["Projected Away"]), home = Number(projection["Projected Home"]);
    if (Number.isFinite(away) && Number.isFinite(home)) {
      recovered["Projected Margin"] = (home - away).toFixed(1);
      recovered["Projected Total"] = (away + home).toFixed(1);
    }
    for (const market of ["Spread", "Total"]) {
      const play = matching.find(candidate => String(candidate["Bet Type"] || candidate.Market).toLowerCase().includes(market.toLowerCase()));
      if (!play) continue;
      recovered[`${market} Grade`] = play.Grade || play["Model Grade"] || "";
      recovered[`${market} Pick`] = play.Selection || "";
      recovered[`${market} Probability`] = play["Model Probability"] || "";
      recovered[`${market} Odds`] = play["Odds/Line"] || play.Odds || "";
    }
    return { ...nonEmpty(recovered), ...nonEmpty(row) };
  });
}

export async function readSlateDates(sport: SlateHistorySport) {
  // Read the covering date index, without loading archived payloads or chart history.
  const datasets = sport === "MLB" ? ["daily_slate"] : ["daily_slate", "schedule"];
  const result = await runTursoSql(datasets.map(dataset =>
    `SELECT DISTINCT date_key FROM dataset_rows INDEXED BY idx_dataset_rows_date WHERE sport='${sport}' AND dataset='${dataset}' AND date_key<>'' ORDER BY date_key DESC`));
  return [...new Set(result.flat().map(row => slateDate(row.date_key)).filter(Boolean))].sort().reverse();
}

export async function readSavedSlate(sport: SlateHistorySport, date: string) {
  if (!slateDate(date) || slateDate(date) !== date) throw new Error("Choose a valid slate date.");
  const keys = dateKeys(date);
  const [models, schedule, tracker] = await Promise.all([
    readTursoDatasetByDateKeys(sport, "daily_slate", keys),
    sport === "MLB" ? Promise.resolve([]) : readTursoDatasetByDateKeys(sport, "schedule", keys),
    sport === "NFL" ? readTursoDatasetByDateKeys(sport, "bet_tracker", keys) : Promise.resolve([]),
  ]);
  const slateToday = mergeSavedSlate(sport, date, models, schedule, tracker);
  return { ok: true, sport, today: date, slateToday, historicalSlate: true,
    // Prevent the football renderer from hydrating the current week's live data.
    footballWeeklyMarket: { ok: true, games: slateToday, splits: [] } };
}
