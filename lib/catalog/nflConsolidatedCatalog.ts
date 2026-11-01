/** Public reporting definitions. Original catalog memberships remain immutable evidence. */
export const NFL_CONSOLIDATED_VERSION = "nfl-grouped-2026-11-01-v1";
export const NFL_CONSOLIDATED_EFFECTIVE_AT = "2026-11-01T22:10:00.000Z";
export const NFL_CONSOLIDATED_SIGNAL_POLICY = "football-signals-nfl-grouped-2026-11-01-v2";
export type NflGroupCategory = "Spread" | "Favorite Spread" | "Underdog Spread" | "Over" | "Under";
export type NflConsolidatedType = {
  id: string; label: string; market: "Spread" | "Total"; category: NflGroupCategory;
  direction: number; pairs: string[]; rule: string;
};
const definitions: NflConsolidatedType[] = [];
function pair(id: string, label: string, market: "Spread" | "Total", pairs: string[], rule: string,
  scopes?: NflGroupCategory[][], directions = ["Follow", "Fade"]) {
  const categories: NflGroupCategory[][] = scopes || (market === "Spread" ? [["Spread"], ["Spread"]] : [["Over", "Under"], ["Over", "Under"]]);
  categories.forEach((groups, direction) => groups.forEach(category => definitions.push({
    id: `${id}-${direction}-${category.toLowerCase().replace(/\s+/g, "-")}`,
    label: `${label} ${directions[direction]}${category === "Spread" || directions[direction] === category ? "" : ` · ${category}`}`,
    market, category, direction, pairs, rule,
  })));
}
const bands = (prefix: string, values: number[], market: string) => values.map(n => `${prefix}-${n}-${market}`);
// Twenty spread families. Only line-support records retain both selected roles.
pair("public-mild-moderate", "Public 55–<75%", "Spread", bands("bd-band", [55, 65], "spread"), "Follow/fade a side with 55% to below 75% of tickets.");
pair("public-heavy", "Public 75%+", "Spread", bands("bd-band", [75, 85], "spread"), "Follow/fade a side with at least 75% of tickets.");
pair("public-heavy-favorite", "Public 70%+ Favorite", "Spread", ["bd-atleast-70-spread"], "Follow the favorite with at least 70% of tickets, or fade it with the underdog.", [["Favorite Spread"], ["Underdog Spread"]]);
pair("money-majority", "Money Majority 60%+", "Spread", ["hd-atleast-60-spread"], "Follow/fade a side with at least 60% of money.");
pair("money-heavy", "Money Majority 70%+", "Spread", ["hd-atleast-70-spread"], "Follow/fade a side with at least 70% of money.");
pair("money-ticket-gap", "Money–Ticket Gap 10+", "Spread", ["gap-atleast-10-spread"], "Follow/fade a side whose final money share exceeds ticket share by at least 10 points.");
pair("rlm", "Reverse Line Movement", "Spread", ["soft-rlm-spread", "rlm-current-spread", "strong-rlm-spread"], "Follow/fade line support of at least 0.5 points while ticket share falls at least 5 points.");
pair("line-support", "Line Support", "Spread", ["spread-any-support-spread"], "Follow/fade a line move of at least 0.5 points. Selected favorites and underdogs have separate records.", [["Favorite Spread", "Underdog Spread"], ["Favorite Spread", "Underdog Spread"]]);
pair("money-growth", "Money Share Growth 10+", "Spread", ["money-growth-10-spread"], "Follow/fade a side whose money share rose at least 10 points from opening to final.");
pair("ticket-growth", "Ticket Share Growth 7+", "Spread", ["ticket-growth-7-spread"], "Follow/fade a side whose ticket share rose at least 7 points from opening to final.");
pair("money-line-momentum", "Money Growth + Line Support", "Spread", ["money-momentum-with-line-support-spread", "nfl-spread-money-momentum-hour-spread", "strong-money-momentum-with-line-support-spread"], "Follow/fade money growth of at least 10 points plus line support of at least 0.5 points.");
pair("ticket-line-momentum", "Ticket Growth + Line Support", "Spread", ["ticket-momentum-with-line-support-spread", "strong-ticket-momentum-with-line-support-spread", "spread-ticket-current-spread"], "Follow/fade ticket growth of at least 7 points plus line support of at least 1 point.");
pair("public-money-agree", "Public + Money Agreement", "Spread", ["public-and-money-agree-spread", "extreme-public-and-money-agree-spread"], "Follow/fade a side with at least 60% of both tickets and money.");
pair("public-money-disagree", "Public–Money Disagreement", "Spread", ["public-versus-money-majority-spread", "extreme-public-versus-money-majority-spread"], "Follow/fade the ticket majority: at least 60% tickets and no more than 40% money.");
pair("stake-ratio", "Average Stake Ratio 2+", "Spread", ["stake-ratio-2-spread", "stake-ratio-3-spread", "stake-ratio-5-spread"], "Follow/fade a side whose estimated average stake is at least twice its opponent's.");
pair("money-outpaces-tickets", "Money Outpaces Ticket Growth", "Spread", ["money-outpaces-ticket-growth-spread"], "Use the original saved money-outpaces-ticket-growth condition.");
pair("opening-public-holds", "Opening Public Majority Holds", "Spread", ["opening-public-majority-holds-spread"], "Follow/fade a side with at least 60% of tickets at both opening and final.");
pair("opening-money-holds", "Opening Money Majority Holds", "Spread", ["opening-money-majority-holds-spread"], "Follow/fade a side with at least 60% of money at both opening and final.");
pair("unchanged-spread", "Unchanged Spread", "Spread", ["unchanged-home-spread-spread", "quiet-home-spread-spread"], "Select Home/Away when the home spread has not changed.", undefined, ["Home", "Away"]);
pair("balanced-spread", "Balanced Tickets + Money", "Spread", ["balanced-spread-tickets-and-money-spread"], "Select Home/Away when both home ticket and money shares are 45%–55%.", undefined, ["Home", "Away"]);
// Ten total families retain Over/Under as well as follow/fade direction.
pair("total-public-mild-moderate", "Public 55–<75%", "Total", bands("bd-band", [55, 65], "total"), "Follow/fade a total side with 55% to below 75% of tickets.");
pair("total-public-heavy", "Public 75%+", "Total", bands("bd-band", [75, 85], "total"), "Follow/fade a total side with at least 75% of tickets.");
pair("total-money-majority", "Money Majority 60%+", "Total", ["hd-atleast-60-total"], "Follow/fade a total side with at least 60% of money.");
pair("total-money-ticket-gap", "Money–Ticket Gap 10+", "Total", ["gap-atleast-10-total"], "Follow/fade a total side whose money share exceeds ticket share by at least 10 points.");
pair("total-rlm", "Reverse Line Movement", "Total", ["soft-rlm-total", "rlm-current-total", "strong-rlm-total"], "Follow/fade line support of at least 0.5 points while ticket share falls at least 5 points.");
pair("total-money-growth", "Money Share Growth 10+", "Total", ["money-growth-10-total"], "Follow/fade money-share growth of at least 10 points from opening to final.");
pair("total-ticket-growth", "Ticket Share Growth 7+", "Total", ["ticket-growth-7-total"], "Follow/fade ticket-share growth of at least 7 points from opening to final.");
pair("total-money-line", "Money Growth + Line Support", "Total", ["money-momentum-with-line-support-total", "nfl-total-money-momentum-hour-total", "nfl-combined-total-hour-total", "strong-money-momentum-with-line-support-total"], "Follow/fade money growth of at least 10 points plus line support of at least 0.5 points.");
pair("total-ticket-line", "Ticket Growth + Line Support", "Total", ["ticket-momentum-with-line-support-total", "strong-ticket-momentum-with-line-support-total"], "Follow/fade ticket growth of at least 7 points plus line support of at least 1 point.");
pair("total-public-money-agree", "Public + Money Agreement", "Total", ["public-and-money-agree-total", "extreme-public-and-money-agree-total"], "Follow/fade a total side with at least 60% of both tickets and money.");
// Seven fixed-direction total families collapse size and incidental filter variants.
pair("total-rise", "Total Rise 0.5+", "Total", ["total-increase-any-total", "nfl-market-move-hour-total"], "Over follows a rise of at least 0.5; Under fades it. The legacy hour-move membership is admitted only in the matching direction.", [["Over"], ["Under"]]);
pair("total-drop", "Total Drop 0.5+", "Total", ["total-drop-any-total"], "Under follows a drop of at least 0.5; Over fades it.", [["Under"], ["Over"]]);
pair("total-unchanged", "Unchanged Total", "Total", ["unchanged-total-total", "near-unchanged-total-total"], "Select Over/Under when the total is unchanged or has moved less than 0.5 points.", [["Over"], ["Under"]], ["Over", "Under"]);
pair("total-quiet", "Quiet Total", "Total", ["quiet-total-total"], "Select Over/Under when the total is unchanged and ticket and money share each move less than 5 points.", [["Over"], ["Under"]], ["Over", "Under"]);
pair("total-balanced-tickets", "Balanced Tickets", "Total", ["balanced-total-tickets-total"], "Select Over/Under when the Over ticket share is 45%–55%.", [["Over"], ["Under"]], ["Over", "Under"]);
pair("total-balanced-money", "Balanced Money", "Total", ["balanced-total-money-total"], "Select Over/Under when the Over money share is 45%–55%.", [["Over"], ["Under"]], ["Over", "Under"]);
pair("total-balanced-both", "Balanced Tickets + Money", "Total", ["balanced-total-tickets-and-money-total"], "Select Over/Under when both Over ticket and money shares are 45%–55%; ticket-only and money-only conditions are not substituted.", [["Over"], ["Under"]], ["Over", "Under"]);

export const NFL_CONSOLIDATED_TYPES: readonly NflConsolidatedType[] = definitions;
export const nflConsolidatedSignal = (id: string) => `nfl-group:${NFL_CONSOLIDATED_VERSION}:${id}`;
export function nflConsolidatedDefinition(signal: string) {
  return NFL_CONSOLIDATED_TYPES.find(type => nflConsolidatedSignal(type.id) === signal);
}
