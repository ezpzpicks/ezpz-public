import { readTursoDatasetByDateKeys, runTursoSql } from "./tursoStore";
import { nflKickoffIso } from "./footballWeeklyMarket";
import { footballTeamGameKey } from "./footballTeamTrends";
import { readMarketProjectionBundle, refreshMarketProjections } from "./marketProjectionStore";
import { normalizeProjectionBaseline, projectionTime, projectionGameKey, trackedFootballRow } from "./marketProjectionTracking";
import { trackingModelVersion } from "./marketProjectionPolicy";

type Sport = "NFL" | "NCAAF";
type Row = Record<string, any>;
const day = (now: number) => new Intl.DateTimeFormat("en-CA", {timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(now));
const isoDay = (v: unknown) => String(v || "").replace(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, (_,m,d,y) => `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`);
const kickoff = (r: Row) => nflKickoffIso(isoDay(r.Date || r["Game Date"]), String(r["Game Time"] || r.Time || ""));
const key = (sport: Sport, r: Row) => projectionGameKey(sport, isoDay(r.Date || r["Game Date"]), r["Away Team"], r["Home Team"], kickoff(r));
export async function refreshFootballMarketProjections(sport: Sport, now: number) {
  const dates = Array.from({length:8},(_,i) => day(now + i * 86400000));
  const dateKeys = dates.flatMap(d => {const [y,m,a]=d.split("-");return [d,`${m}/${a}/${y}`,`${Number(m)}/${Number(a)}/${y}`];});
  const [slate, previews, splits] = await Promise.all([
    readTursoDatasetByDateKeys(sport,"daily_slate",dateKeys),
    readTursoDatasetByDateKeys(sport,"game_previews",dateKeys),
    readTursoDatasetByDateKeys(sport,"weekly_market_trends",dateKeys),
  ]);
  // Schedule rows use Game Date, which the admin's legacy metadata does not
  // index as date_key. Resolve only missing slate clocks by indexed Game ID.
  const missingIds = sport === "NCAAF" ? [...new Set(slate.filter(r => !Number.isFinite(projectionTime(kickoff(r))))
    .map(r => String(r["Game ID"] || "")).filter(Boolean))].slice(0,200) : [];
  const q = (v: string) => `'${v.replaceAll("'", "''")}'`;
  const schedule = missingIds.length ? (await runTursoSql([`SELECT payload_json FROM dataset_rows WHERE sport='NCAAF' AND dataset='schedule' AND game_key IN (${missingIds.map(q).join(",")}) LIMIT 400`]))[0].map(r => JSON.parse(r.payload_json)) : [];
  const bases = ([...slate.map(r => ({row:r,sourceDataset:"daily_slate" as const})),
    ...previews.map(r => ({row:r,sourceDataset:"game_previews" as const}))]).flatMap(({row,sourceDataset}) => {
    const r = sport === "NCAAF" ? withNcaafScheduleClock(row,schedule) : row;
    const b=normalizeProjectionBaseline(sport,r,isoDay(r.Date || r["Game Date"]),kickoff(r));
    return b ? [{...b,...(sport === "NCAAF" ? {sourceDataset} : {})}] : [];
  });
  const markets = splits.map(r => ({...r,Date:isoDay(r.Date),"Game Time":nflKickoffIso(isoDay(r.Date),r["Game Time"])}));
  return refreshMarketProjections(sport,bases,markets,dates,now);
}
/** Called before signal selection; the original model ledger remains unchanged. */
export async function applyFootballMarketProjections(sport: Sport, core: Row, now = Date.now()) {
  if (sport === "NCAAF") {
    const today = day(now);
    const previews = await readTursoDatasetByDateKeys(sport, "game_previews", [today]);
    core = {...core, slateToday: mergeNcaafPreviews(core.slateToday || [], previews, now)};
  }
  const dates = [...new Set<string>((core.slateToday || []).map((r:Row) => isoDay(r.Date || r["Game Date"])))].filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(0,8);
  if (!dates.length) dates.push(day(now));
  const {activation,forecasts} = await readMarketProjectionBundle(sport,dates,now);
  const marketTracking = {modelVersion:trackingModelVersion(sport),profile:"balanced",activatedAt:activation?.activatedAt || null,gradingStatus:"ungraded",historicalRecordsRegraded:false};
  if (!activation) return {...core,marketTracking};
  const byGame = new Map(forecasts.map(f => [projectionGameKey(sport,f.market_tracking.baseline.date,f.away_team,f.home_team,f.tipoff),f]));
  const held = new Set<string>();
  const slateToday = (core.slateToday || []).map((row: Row) => {
    if (projectionTime(kickoff(row)) <= projectionTime(activation.activatedAt)) return row;
    held.add(footballTeamGameKey(row,sport));
    const forecast = byGame.get(key(sport,row));
    const baseline = forecast?.market_tracking?.baseline;
    const previewOverlay = sport === "NCAAF" && (baseline?.sourceDataset === "game_previews" || baseline?.original?.["Build Phase"] === "preview");
    const authoritativeRow = row["Build Phase"] !== "preview" && row["Model Version"] && row["Projected Away"];
    return trackedFootballRow(row,previewOverlay && authoritativeRow ? undefined : forecast,activation);
  });
  const bestPlays = (core.bestPlays || []).filter((p:Row) => p.playerName || p.propMarket || !["Spread","Total"].includes(p.role)
    || !held.has(footballTeamGameKey({...p,date:isoDay(p.date || core.today)},sport)));
  return {...core,slateToday,bestPlays,marketTracking,marketTrackingBaselineSlate:core.slateToday,marketTrackingBaselinePlays:core.bestPlays,
    tiles:{...core.tiles,bestPlaysToday:bestPlays.length}};
}

/** Display-only previews never enter historical records or pick selection. */
export function mergeNcaafPreviews(slate: Row[], previews: Row[], now: number): Row[] {
  const result = [...slate];
  for (const row of previews) {
    const date = isoDay(row.Date || row["Game Date"]);
    const base = normalizeProjectionBaseline("NCAAF", row, date, kickoff(row));
    if (row["Build Phase"] !== "preview" || date !== day(now) || !base
      || projectionTime(base.lockedAt) > now || projectionTime(base.tipoff) <= now) continue;
    const index = result.findIndex(r => String(r["Game ID"]) === base.gameId || key("NCAAF", r) === key("NCAAF", row));
    if (index >= 0 && (result[index]["Model Version"] || result[index]["Projected Away"])) continue;
    const preview = {...(index >= 0 ? result[index] : {}), ...row,
      "Spread Grade": "Ungraded preview", "Total Grade": "Ungraded preview", "ML Grade": "Ungraded preview"};
    if (index >= 0) result[index] = preview;
    else result.push(preview);
  }
  return result;
}

/** Resolve legacy slate clocks only from one matching saved schedule identity. */
export function withNcaafScheduleClock(row: Row, schedule: Row[]): Row {
  if (Number.isFinite(projectionTime(kickoff(row)))) return row;
  const date = isoDay(row.Date || row["Game Date"]);
  const matches = schedule.filter(s => String(s["Game ID"]) === String(row["Game ID"])
    && isoDay(s["Game Date"] || s.Date) === date
    && footballTeamGameKey({...s,Date:date},"NCAAF") === footballTeamGameKey({...row,Date:date},"NCAAF"));
  const times = [...new Set(matches.map(kickoff).filter(t => Number.isFinite(projectionTime(t))))];
  if (times.length !== 1 || matches.some(s => /^(true|1|yes)$/i.test(String(s.Completed || "")))) return row;
  // Midnight is the schedule import's unknown-time placeholder, not evidence.
  const local = new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",hourCycle:"h23",hour:"2-digit",minute:"2-digit"}).format(new Date(times[0]));
  return local === "00:00" ? row : {...row,"Game Time":times[0]};
}
