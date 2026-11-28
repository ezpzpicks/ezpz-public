import { nbaNormalDisplay } from "./normalMarketDisplay";
import { ncaamNormalDisplay } from "./ncaamTotalDisplay";
import { NCAAM_REVERSED_SPREAD_MODEL } from "./ncaamMarketTrackingPolicy";

type Row = Record<string, any>;
export const missingPregameAdjustment = "Saved pregame adjustment unavailable";

export function pregameAdjustmentLabel(final: boolean, published: string) {
  const time = new Intl.DateTimeFormat("en-US", {timeZone:"America/New_York",hour:"numeric",minute:"2-digit"}).format(Date.parse(published));
  return `${final ? "Frozen pregame" : "Last saved pregame"} · ${time} ET`;
}

/** Use original captures only. Sorting uses capture status and clocks, never scores or results. */
export function completedBasketballProjection<T extends Row>(rows: T[], game: Record<string,string>, sport:"NCAAM"|"NBA") {
  let best: {saved:T; label:string; frozen:boolean; published:number} | undefined;
  for (const saved of rows) {
    const t=saved.market_tracking;
    if (!t || saved.gameId!==game["Game ID"] || typeof t.final_pregame!=="boolean"
      || !/^[0-9a-f]{64}$/.test(t.input_digest) || saved.recordId!==`${saved.gameId}|${saved.modelVersion}|${t.input_digest}`) continue;
    const tip=Date.parse(saved.tipoff), quote=Date.parse(t.decision_as_of), published=Date.parse(t.published_at);
    if (!(published===Date.parse(saved.lockedAt) && quote<=published && published<tip && Date.parse(t.baseline_captured_at)<=published)) continue;
    if (t.final_pregame && (!(tip-quote>=600000 && tip-quote<=1200000) || Date.parse(t.baseline_captured_at)>quote)) continue;
    if (sport==="NCAAM") {
      const view=ncaamNormalDisplay(saved,game);
      if (saved.modelVersion!==NCAAM_REVERSED_SPREAD_MODEL || !view.normalTotal || !view.normalSpread) continue;
    } else if (nbaNormalDisplay(saved,game)===saved) continue;
    if (!best || Number(t.final_pregame)>Number(best.frozen) || (t.final_pregame===best.frozen && published>best.published))
      best={saved,label:pregameAdjustmentLabel(t.final_pregame,t.published_at),frozen:t.final_pregame,published};
  }
  return best;
}
