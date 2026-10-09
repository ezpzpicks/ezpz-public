export const NCAAF_EZPZ_POLICY_VERSION = "ncaaf-movement-v5-sharp-totals";
export const NCAAF_SHARP_MIN_MONEY_OVER_BETS_PCT = 25;
export const NCAAF_SPREAD_TICKET_MOMENTUM_RULE = "Follow the spread side when the line moves at least 1 point toward it and its ticket share rises at least 7 percentage points, and either the selected team is a favorite laying less than 15 points or its ticket share rises by more than 20 percentage points. Either condition qualifies; both are not required.";
export const NCAAF_EZPZ_RULE = "NCAAF EZPZ Picks: one pick per game, Total Drop Fade first (Over after a 1.5+ point total drop), then Spread Ticket Momentum, then Sharp totals. " + NCAAF_SPREAD_TICKET_MOMENTUM_RULE + " Sharp totals select Over or Under when money share is at least 25 percentage points above bet share. Odds must be -150 or better; missing spread/total odds default to -110. RLM, Sharp spreads, and Public Fade remain tracked only. Records use verified final snapshots only.";

type MovementPlay = {
  market?: unknown;
  side?: unknown;
  selection?: unknown;
  openingLine?: unknown;
  line?: unknown;
  openingBetsPct?: unknown;
  betsPct?: unknown;
  moneyPct?: unknown;
  publicMovementPct?: unknown;
  lineMovementValue?: unknown;
  lineMovementBasis?: unknown;
};

export function finiteNcaafNumber(value: unknown): number | null {
  if (value == null || String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// This additional gate also checks archived picks carrying the older label.
// An opposite-side movement field is never used as the selected team's growth.
export function isNcaafSpreadMomentumSubset(play: MovementPlay) {
  const selectedLine = String(play.selection || "").replace(/−/g, "-").match(/\s([+-]?\d+(?:\.\d+)?)\s*$/);
  const current = finiteNcaafNumber(play.line) ?? finiteNcaafNumber(selectedLine?.[1]);
  if (current == null) return false;
  const smallFavorite = current < 0 && current > -15;
  const openingTickets = finiteNcaafNumber(play.openingBetsPct);
  const currentTickets = finiteNcaafNumber(play.betsPct);
  const strongTicketGrowth = openingTickets != null && currentTickets != null
    && openingTickets > 0 && openingTickets < 100 && currentTickets >= 0 && currentTickets <= 100
    && currentTickets - openingTickets > 20;
  return smallFavorite || strongTicketGrowth;
}

export function classifyNcaafMovement(play: MovementPlay) {
  const market = String(play.market || "").toLowerCase();
  const opening = finiteNcaafNumber(play.openingLine);
  const current = finiteNcaafNumber(play.line);
  if (opening == null || current == null) return { labels: [] as string[], score: 0 };
  if (market === "total" && String(play.side || play.selection).toLowerCase() === "over" && opening - current >= 1.5) {
    return { labels: ["Total Drop Fade"], score: 95 };
  }
  if (market === "spread") {
    const openingTickets = finiteNcaafNumber(play.openingBetsPct);
    const currentTickets = finiteNcaafNumber(play.betsPct);
    if (openingTickets != null && currentTickets != null && openingTickets > 0 && openingTickets < 100 && currentTickets >= 0 && currentTickets <= 100 && opening - current >= 1 && currentTickets - openingTickets >= 7 && isNcaafSpreadMomentumSubset(play)) {
      return { labels: ["Spread Ticket Momentum"], score: 90 };
    }
  }
  return { labels: [] as string[], score: 0 };
}

export function isNcaafSharpTotal(play: MovementPlay) {
  const selection = String(play.selection || "").trim();
  const side = String(play.side || selection).trim().toLowerCase();
  const line = finiteNcaafNumber(play.line) ?? finiteNcaafNumber(selection.match(/\s([+-]?\d+(?:\.\d+)?)\s*$/)?.[1]);
  const bets = finiteNcaafNumber(play.betsPct);
  const money = finiteNcaafNumber(play.moneyPct);
  return String(play.market || "").toLowerCase() === "total"
    && /^(over|under)(?:\s|$)/.test(side)
    && line != null && line > 0
    && bets != null && money != null
    && bets >= 0 && bets <= 100 && money >= 0 && money <= 100
    && money - bets >= NCAAF_SHARP_MIN_MONEY_OVER_BETS_PCT;
}

// Keep movement badges independent; Sharp is an additional EZPZ total candidate.
export function classifyNcaafEzpzTrend(play: MovementPlay) {
  const movement = classifyNcaafMovement(play);
  if (movement.labels.length) return movement;
  return isNcaafSharpTotal(play)
    ? { labels: ["Sharp"], score: 85 }
    : { labels: [] as string[], score: 0 };
}

type NcaafPick = MovementPlay & {
  source?: unknown;
  market?: unknown;
  game?: unknown;
  gameKey?: unknown;
  date?: unknown;
  tier?: unknown;
  qualification?: unknown;
  odds?: unknown;
  score?: unknown;
  snapshotStatus?: unknown;
  playerName?: unknown;
  propMarket?: unknown;
};

export function ncaafPickPriority(pick: NcaafPick) {
  const labels = `${pick.tier || ""} ${pick.qualification || ""}`;
  if (String(pick.market).toLowerCase() === "total" && /\bTotal Drop Fade\b/i.test(labels)) return 3;
  if (String(pick.market).toLowerCase() === "spread" && /\bSpread Ticket Momentum\b/i.test(labels) && isNcaafSpreadMomentumSubset(pick)) return 2;
  if (/\bSharp\b/i.test(labels) && isNcaafSharpTotal(pick)) return 1;
  return 0;
}

export function selectNcaafEzpzPicks<T extends NcaafPick>(picks: T[], finalOnly = false): T[] {
  const eligible = picks.map(pick => String(pick.odds ?? "").trim()
    ? pick
    : { ...pick, odds: "-110" }
  ).filter(pick => {
    const source = String(pick.source || "").trim().toLowerCase();
    const odds = finiteNcaafNumber(String(pick.odds ?? "").replace(/−/g, "-"));
    return (source === "trend play" || source === "best + trend") && ncaafPickPriority(pick) > 0 && !pick.playerName && !pick.propMarket
      && odds != null && Math.abs(odds) >= 100 && odds >= -150
      && (!finalOnly || pick.snapshotStatus === "FINAL_PREGAME");
  }).sort((a,b) => ncaafPickPriority(b) - ncaafPickPriority(a) || Number(b.score || 0) - Number(a.score || 0) || String(a.game || "").localeCompare(String(b.game || "")));
  const seen = new Set<string>();
  return eligible.filter(pick => {
    const game = String(pick.game || pick.gameKey || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const key = `${pick.date || ""}|${game}`;
    if (!game || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
