import { trialDate, type TrialSide } from "./selectionTrial";

function timestamp(raw: unknown) {
  const text = String(raw || ""), match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)\s*(EDT|EST)$/i);
  if (!match) return Date.parse(text);
  const [, m, d, y, h, minute, sec, half, zone] = match;
  return Date.parse(`${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T${String(Number(h) % 12 + (half.toUpperCase() === "PM" ? 12 : 0)).padStart(2, "0")}:${minute}:${sec || "00"}${zone.toUpperCase() === "EDT" ? "-04:00" : "-05:00"}`);
}
export function mlbTrialSides(plays: Record<string, any>[], date: string): TrialSide[] {
  return plays.flatMap(p => {
    const capture = timestamp(p.frozenAt || p.lockedAt || p.updatedAt), start = timestamp(p.recordGameTime || p.gameTime);
    const market = p.market, gameKey = String(p.recordGameKey || p.gameKey || "");
    if (!gameKey || !["Moneyline", "Total"].includes(market) || p.snapshotStatus !== "FINAL_PREGAME"
      || !Number.isFinite(capture) || !Number.isFinite(start) || trialDate(start) !== date
      || start - capture < 600000 || start - capture > 1200000) return [];
    const side = market === "Total" ? p.side || p.selection : p.selectionTeam || p.selection;
    if (!side || (market === "Total" && !["Over", "Under"].includes(side))) return [];
    const num = (v: unknown) => v == null || String(v).trim() === "" || !Number.isFinite(Number(v)) ? null : Number(v);
    const bets = num(p.betsPct), money = num(p.moneyPct), gap = bets != null && money != null && bets >= 0 && bets <= 100 && money >= 0 && money <= 100
      && !(bets === money && [0, 100].includes(bets)) ? money - bets : null;
    const current = num(p.line), opening = num(p.openingLine);
    const movement = market === "Total" ? current != null && opening != null ? (current - opening) * (side === "Under" ? -1 : 1) : null
      : p.lineMovementBasis === "Implied Probability" ? num(p.lineMovementValue) : null;
    const selection = market === "Total" ? `${side} ${current}` : String(side);
    return [{ id: `${date}|${gameKey}|${market}|${side}`, date, gameKey, game: String(p.game || ""),
      gameTime: new Date(start).toISOString(), market, side, selection, line: market === "Moneyline" ? null : current,
      odds: String(p.odds || ""), snapshotAt: new Date(capture).toISOString(), status: "FINAL_PREGAME", recorded: true,
      policyVersion: "mlb-trial-raw-quotes-2026-11-04-v1", ...(typeof p.oddsAssumed === "boolean" ? { oddsAssumed: p.oddsAssumed } : {}),
      signals: ["money", "move", "system", "team", "model", "sos"].map(key => ({ key,
        available: key === "money" ? gap != null : key === "move" ? movement != null : false,
        active: key === "money" ? gap != null && gap >= 15 : key === "move" ? movement != null && movement >= .5 : false,
        value: key === "money" ? gap : key === "move" ? movement : null })), result: "", resultUpdated: "" } as TrialSide];
  });
}
