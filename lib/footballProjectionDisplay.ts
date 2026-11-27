import { normalMarketDisplay } from "./normalMarketDisplay";
import { footballTeamKey } from "./footballTeamTrends";
import { trackingModelVersion } from "./marketProjectionPolicy";

type Row = Record<string, string>;

const etClock = new Intl.DateTimeFormat("en-US", { timeZone:"America/New_York",hour:"numeric",minute:"2-digit" });
const etDate = new Intl.DateTimeFormat("en-CA", { timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit" });

/** Public Projections view only. Preserve the saved row if either market cannot be verified. */
export function footballProjectionDisplay(row: Row, sport: "NFL" | "NCAAF"): Row {
  if (row["Model Version"] !== trackingModelVersion(sport,true)) return row;
  let t;
  try { t = JSON.parse(row["Market Tracking JSON"]); } catch { return row; }
  if (!t) return row;
  const away = row["Away Team"], home = row["Home Team"];
  const [date, league, visitor, host, kickoff] = String(t.baseline_forecast_record_id).split("|");
  const tip = Number(kickoff);
  if (!away || !home || !Number.isFinite(new Date(tip).getTime()) || date !== row["Game Date"] || league !== sport
    || visitor !== footballTeamKey(away,sport) || host !== footballTeamKey(home,sport)
    || date !== etDate.format(tip) || (row["Source Game Time"] ? Date.parse(row["Source Game Time"]) !== tip
      : etClock.format(tip) !== row["Game Time"])) return row;
  const field = (key: string) => row[key]?.trim() ? Number(row[key]) : NaN;
  const line = field("Market Home Spread"), totalLine = field("Market Total");
  const savedMargin = field("Projected Margin"), savedTotal = field("Projected Total");
  const v = normalMarketDisplay(t,sport,tip,Date.parse(row["Market Tracking Updated At"]),away,home,line,totalLine,
    savedMargin,savedTotal,field("Projected Home"),field("Projected Away"));
  if (!v) return row;
  const { margin,total,edge,totalEdge } = v;
  return {...row, "Projected Margin":String(margin), "Projected Total":String(total),
    "Projected Home":String((total+margin)/2), "Projected Away":String((total-margin)/2),
    "Spread Edge":String(Math.abs(edge)), "Total Edge":String(Math.abs(totalEdge)),
    "Spread Pick":v.spreadPick, "Total Pick":v.totalPick,
    ...(Math.sign(savedMargin+line)!==Math.sign(edge) ? {"Spread Odds":""} : {}),
    ...(Math.sign(savedTotal-totalLine)!==Math.sign(totalEdge) ? {"Total Odds":""} : {}),
    "Market Tracking JSON":JSON.stringify(v.tracking)};
}
