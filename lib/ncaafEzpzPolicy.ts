export const NCAAF_EZPZ_POLICY_VERSION = "ncaaf-movement-v2";
export const NCAAF_EZPZ_RULE = "NCAAF EZPZ Picks: one pick per game, Total Drop Fade first (Over after a 1.5+ point total drop), then Spread Ticket Momentum (1+ point spread move toward the team and 7+ point ticket-share increase). Odds must be -150 or better. RLM, Sharp, and Public Fade remain tracked only.";

type MovementPlay = {
  market?: unknown;
  side?: unknown;
  selection?: unknown;
  openingLine?: unknown;
  line?: unknown;
  openingBetsPct?: unknown;
  betsPct?: unknown;
  publicMovementPct?: unknown;
  lineMovementValue?: unknown;
  lineMovementBasis?: unknown;
};

export function finiteNcaafNumber(value: unknown): number | null {
  if (value == null || String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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
    if (openingTickets != null && currentTickets != null && openingTickets > 0 && openingTickets < 100 && currentTickets >= 0 && currentTickets <= 100 && opening - current >= 1 && currentTickets - openingTickets >= 7) {
      return { labels: ["Spread Ticket Momentum"], score: 90 };
    }
  }
  return { labels: [] as string[], score: 0 };
}

type NcaafPick = {
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
  if (String(pick.market).toLowerCase() === "total" && /\bTotal Drop Fade\b/i.test(labels)) return 2;
  if (String(pick.market).toLowerCase() === "spread" && /\bSpread Ticket Momentum\b/i.test(labels)) return 1;
  return 0;
}

export function selectNcaafEzpzPicks<T extends NcaafPick>(picks: T[], finalOnly = false): T[] {
  const eligible = picks.filter(pick => {
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
