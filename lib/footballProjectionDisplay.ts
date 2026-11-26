import { footballTeamKey } from "./footballTeamTrends";
import { MARKET_PROJECTION_POLICY, REVERSED_MARKET_FROM, REVERSED_MARKET_POLICY, trackingModelVersion } from "./marketProjectionPolicy";

type Row = Record<string, string>;
const close = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a-b) <= 1e-6;
const etClock = new Intl.DateTimeFormat("en-US", { timeZone:"America/New_York",hour:"numeric",minute:"2-digit" });
const etDate = new Intl.DateTimeFormat("en-CA", { timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit" });

/** Public Projections view only. Preserve the saved row if either market cannot be verified. */
export function footballProjectionDisplay(row: Row, sport: "NFL" | "NCAAF"): Row {
  if (row["Model Version"] !== trackingModelVersion(sport,true)) return row;
  let t;
  try { t = JSON.parse(row["Market Tracking JSON"]); } catch { return row; }
  if (t?.sport !== sport || t.policy !== MARKET_PROJECTION_POLICY || t.status !== "applied"
    || t.adjustment_policy !== REVERSED_MARKET_POLICY || t.adjustment_policy_effective_at !== REVERSED_MARKET_FROM) return row;
  const away = row["Away Team"], home = row["Home Team"];
  const [date, league, visitor, host, kickoff] = String(t.baseline_forecast_record_id).split("|");
  const tip = Number(kickoff);
  if (!away || !home || !Number.isFinite(new Date(tip).getTime()) || date !== row["Game Date"] || league !== sport
    || visitor !== footballTeamKey(away,sport) || host !== footballTeamKey(home,sport)
    || date !== etDate.format(tip) || (row["Source Game Time"] ? Date.parse(row["Source Game Time"]) !== tip
      : etClock.format(tip) !== row["Game Time"])) return row;
  const field = (key: string) => row[key]?.trim() ? Number(row[key]) : NaN;
  const line = field("Market Home Spread"), totalLine = field("Market Total");
  const spread = t.original_spread_shadow, points = t.original_total_shadow;
  function matches(shadow: typeof spread, base: number, applied: number, projection: number) {
    return shadow && [shadow.baseline,shadow.adjustment,shadow.projection,base,applied].every(Number.isFinite)
      && close(shadow.baseline,base) && close(shadow.projection,base+shadow.adjustment)
      && close(applied,-2*shadow.adjustment) && close(projection,base+applied);
  }
  const savedMargin = field("Projected Margin"), savedTotal = field("Projected Total");
  if (!matches(spread,t.baseline_margin,t.spread_adjustment,savedMargin)
    || !matches(points,t.baseline_total,t.total_adjustment,savedTotal)
    || !Number.isFinite(line) || !Number.isFinite(totalLine) || totalLine<=0
    || spread.home_line !== line || points.line !== totalLine
    || !close(field("Projected Home"),(savedTotal+savedMargin)/2) || !close(field("Projected Away"),(savedTotal-savedMargin)/2)) return row;
  const margin = spread.baseline-spread.adjustment, total = points.baseline-points.adjustment;
  if (!(total>Math.abs(margin))) return row;
  const edge = margin+line, totalEdge = total-totalLine, pickLine = edge>0 ? line : -line;
  return {...row, "Projected Margin":String(margin), "Projected Total":String(total),
    "Projected Home":String((total+margin)/2), "Projected Away":String((total-margin)/2),
    "Spread Edge":String(Math.abs(edge)), "Total Edge":String(Math.abs(totalEdge)),
    "Spread Pick":Math.abs(edge)<1e-9 ? "No spread edge" : `${edge>0?home:away} ${pickLine>0?"+":""}${pickLine}`,
    "Total Pick":Math.abs(totalEdge)<1e-9 ? "No total edge" : `${totalEdge>0?"Over":"Under"} ${totalLine}`,
    ...(Math.sign(savedMargin+line)!==Math.sign(edge) ? {"Spread Odds":""} : {}),
    ...(Math.sign(savedTotal-totalLine)!==Math.sign(totalEdge) ? {"Total Odds":""} : {}),
    "Market Tracking JSON":JSON.stringify({...t,spread_adjustment:-spread.adjustment,total_adjustment:-points.adjustment})};
}
