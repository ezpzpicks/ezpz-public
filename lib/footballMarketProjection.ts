import { readTursoDatasetByDateKeys } from "./tursoStore";
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
    sport === "NFL" ? readTursoDatasetByDateKeys(sport,"game_previews",dateKeys) : Promise.resolve([]),
    readTursoDatasetByDateKeys(sport,"weekly_market_trends",dateKeys),
  ]);
  const bases = [...slate,...previews].flatMap(r => {const b=normalizeProjectionBaseline(sport,r,isoDay(r.Date || r["Game Date"]),kickoff(r));return b?[b]:[];});
  const markets = splits.map(r => ({...r,Date:isoDay(r.Date),"Game Time":nflKickoffIso(isoDay(r.Date),r["Game Time"])}));
  return refreshMarketProjections(sport,bases,markets,dates,now);
}
/** Called before signal selection; the original model ledger remains unchanged. */
export async function applyFootballMarketProjections(sport: Sport, core: Row, now = Date.now()) {
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
    return trackedFootballRow(row,byGame.get(key(sport,row)),activation);
  });
  const bestPlays = (core.bestPlays || []).filter((p:Row) => p.playerName || p.propMarket || !["Spread","Total"].includes(p.role)
    || !held.has(footballTeamGameKey({...p,date:isoDay(p.date || core.today)},sport)));
  return {...core,slateToday,bestPlays,marketTracking,marketTrackingBaselineSlate:core.slateToday,marketTrackingBaselinePlays:core.bestPlays,
    tiles:{...core.tiles,bestPlaysToday:bestPlays.length}};
}
