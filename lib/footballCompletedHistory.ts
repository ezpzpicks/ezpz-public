import { readMarketProjectionBundle } from "./marketProjectionStore";
import { trackedFootballRow } from "./marketProjectionTracking";
import { footballTeamKey } from "./footballTeamTrends";

export async function attachFootballHistory(sport:"NFL"|"NCAAF", date:string, rows:Record<string,string>[]) {
  const {activation,forecasts}=await readMarketProjectionBundle(sport,[date]);
  if (!activation) return rows;
  return rows.map(row=>{
    const tip=Date.parse(row["Game Time"]);
    const matches=forecasts.filter(f=>f.gameId===row["Game ID"] && f.market_tracking.baseline.date===date
      && Date.parse(f.tipoff)===tip && tip<Date.now()
      && footballTeamKey(f.home_team,sport)===footballTeamKey(row["Home Team"],sport)
      && footballTeamKey(f.away_team,sport)===footballTeamKey(row["Away Team"],sport));
    if (matches.length!==1) return row;
    const projected=trackedFootballRow({...row,"Game Date":date,"Source Game Time":row["Game Time"]},matches[0],activation);
    // Carry only display fields. The saved model, grades, lines and final stay intact.
    const fields=["Game Date","Source Game Time","Model Version","Market Tracking JSON","Market Tracking Updated At",
      "Projected Home","Projected Away","Projected Margin","Projected Total","Spread Pick","Total Pick",
      "Spread Edge","Total Edge","Market Home Spread","Market Total"];
    return {...row,"Completed Projection JSON":JSON.stringify(Object.fromEntries(fields.map(key=>[key,projected[key]])))};
  });
}
