import type { FootballSignalSide } from "./footballSignals";

export const SITUATION_START_DATE = "2026-11-06";
export const SITUATION_VERSION = "situation-ezpz-2026-11-06-v1";
export const SITUATION_SPORTS = ["NFL", "NCAAF", "NBA", "NCAAM"] as const;
export type SituationSport = typeof SITUATION_SPORTS[number];
type Market = FootballSignalSide["market"];
type Side = FootballSignalSide;
type Rule = { id: string; label: string; market: Market; seed: boolean; matches: (side: Side, other: Side, homeSide?: string) => boolean };
export type SituationQuote = { odds: string; assumed: boolean; ruleIds: string[] };
export type SituationRuleState = { id: string; label: string; market: Market; active: boolean; since: string;
  change: "seeded" | "watch" | "promoted" | "paused"; decided?: number; netUnits?: number };
export type SituationPolicy = { version: string; sport: SituationSport; date: string; reviewedAt: string; rules: SituationRuleState[] };
export type SituationResult = { date: string; gameKey: string; snapshotAt: string; result: "W" | "L" | "P"; quote: SituationQuote; officialRuleId?: string };

const time = (value: string | undefined) => Date.parse((value || "").replace(/ EDT$/, " -0400").replace(/ EST$/, " -0500"));
const percent = (value: number | null) => value != null && value > 0 && value < 100;
const opener = (side: Side) => time(side.marketContext.openingAt) < time(side.snapshotAt);
const growth = (side: Side, kind: "bets" | "money") => {
  const context = side.marketContext, first = kind === "bets" ? context.openingBets : context.openingMoney;
  return opener(side) && percent(first) ? context[kind]! - first! : -Infinity;
};
const lineChange = (side: Side) => opener(side) && side.marketContext.openingLine != null
  ? side.line! - side.marketContext.openingLine : NaN;
const moneyGap = (side: Side) => side.marketContext.money! - side.marketContext.bets!;

// Priority follows the one-pick-per-game backtest. Each rule also gets its own results.
const RULES: Record<SituationSport, Rule[]> = {
  NFL: [
    { id: "nfl-spread-fade-70", label: "Fade 70% spread tickets", market: "Spread", seed: true,
      matches: (_, other) => other.marketContext.bets! >= 70 },
    { id: "nfl-over-total-rise", label: "Over after total rises 0.5+", market: "Total", seed: true,
      matches: side => side.side === "Over" && lineChange(side) >= 0.5 },
    { id: "nfl-shortening-underdog", label: "Underdog spread shortens 0.5+", market: "Spread", seed: true,
      matches: side => side.line! > 0 && lineChange(side) <= -0.5 },
    { id: "nfl-over-balanced-tickets", label: "Over with 45–55% tickets", market: "Total", seed: false,
      matches: side => side.side === "Over" && side.marketContext.bets! >= 45 && side.marketContext.bets! <= 55 },
  ],
  NCAAF: [
    { id: "ncaaf-home-unchanged-spread", label: "Home spread matches its opener", market: "Spread", seed: true,
      matches: (side, _, homeSide) => side.side === homeSide && lineChange(side) === 0
        && percent(side.marketContext.openingBets) && percent(side.marketContext.openingMoney)
        && time(side.snapshotAt) - time(side.marketContext.openingAt) >= 12 * 60 * 60_000 },
    { id: "ncaaf-total-money-gap-15", label: "Total money exceeds tickets by 15+ points", market: "Total", seed: true,
      matches: side => moneyGap(side) >= 15 },
    { id: "ncaaf-underdog-fade-70", label: "Underdog against 70%+ spread tickets", market: "Spread", seed: false,
      matches: side => side.line! > 0 && side.marketContext.bets! <= 30 },
    { id: "ncaaf-under-money-gap-10-to-15", label: "Under money exceeds tickets by 10 to under 15 points", market: "Total", seed: false,
      matches: side => side.side === "Under" && moneyGap(side) >= 10 && moneyGap(side) < 15 },
  ],
  NBA: [
    { id: "nba-spread-60-60", label: "Spread with 60%+ tickets and money", market: "Spread", seed: true,
      matches: side => side.marketContext.bets! >= 60 && side.marketContext.money! >= 60 },
    { id: "nba-spread-money-growth", label: "Spread money rises 10+ points to 60%+", market: "Spread", seed: true,
      matches: side => growth(side, "money") >= 10 && side.marketContext.money! >= 60 },
    { id: "nba-spread-ticket-growth", label: "Spread tickets rise 7+ points", market: "Spread", seed: true,
      matches: side => growth(side, "bets") >= 7 },
    { id: "nba-spread-money-growth-below-60", label: "Spread money rises 10+ points and finishes below 60%", market: "Spread", seed: false,
      matches: side => growth(side, "money") >= 10 && side.marketContext.money! < 60 },
  ],
  NCAAM: [
    { id: "ncaam-under-balanced-tickets", label: "Under with 45–55% tickets", market: "Total", seed: true,
      matches: side => side.side === "Under" && side.marketContext.bets! >= 45 && side.marketContext.bets! <= 55 },
    { id: "ncaam-underdog-money-gap", label: "Underdog money exceeds tickets by 10+ points", market: "Spread", seed: false,
      matches: side => side.line! > 0 && moneyGap(side) >= 10 },
  ],
};

export function usesSituationRules(sport: string, date: string): sport is SituationSport {
  return Object.hasOwn(RULES, sport) && /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= SITUATION_START_DATE;
}

export function situationFinalWindow(side: Pick<Side, "status" | "gameTime" | "scheduledGameTime" | "snapshotAt">, now: number) {
  const captured = time(side.snapshotAt), lead = time(side.gameTime) - captured;
  return side.status === "FINAL_PREGAME" && captured <= now && lead >= 600_000 && lead <= 1_200_000
    && (!side.scheduledGameTime || time(side.scheduledGameTime) === time(side.gameTime));
}

function number(value: unknown) {
  return value == null || String(value).trim() === "" ? NaN : Number(String(value).replace(/[−–—]/g, "-"));
}

function price(side: Side, sport: SituationSport) {
  const { bets, money, history } = side.marketContext;
  const raw = history.filter(point => time(point.snapshotTime) === time(side.snapshotAt));
  if (raw.some(point => number(point.line) !== side.line || number(point.betsPct) !== bets || number(point.moneyPct) !== money)) return null;
  const seen = new Set(raw.map(point => number(point.odds)).filter(odds => Number.isFinite(odds) && Math.abs(odds) >= 100));
  if (seen.size > 1) return null;
  const observed = sport === "NFL" || sport === "NCAAF" ? [...seen][0] : side.oddsAssumed === false ? number(side.odds) : undefined;
  if (observed != null && (!Number.isFinite(observed) || Math.abs(observed) < 100 || observed !== number(side.odds))) return null;
  return { odds: String(observed ?? -110), assumed: observed == null };
}

/** Classify the two sides of a newly captured market with its original quotes. */
export function situationMarketQuotes(pair: Side[], sport: SituationSport, now: number, homeSide?: string): SituationQuote[] {
  if (pair.length !== 2) return [];
  const [a, b] = pair;
  if (a.id === b.id || a.gameKey !== b.gameKey || a.date !== b.date || a.side === b.side || !a.side || !b.side || a.market !== b.market
    || a.gameTime !== b.gameTime || Math.abs(time(a.snapshotAt) - time(b.snapshotAt)) > 30_000
    || pair.some(side => !situationFinalWindow(side, now) || time(side.gameTime) <= now || !Number.isFinite(side.line)
      || !percent(side.marketContext.bets) || !percent(side.marketContext.money))) return [];
  if (a.market === "Spread" ? Math.abs(a.line! + b.line!) > 0.001
    : a.line! <= 0 || Math.abs(a.line! - b.line!) > 0.001 || ![a.side, b.side].includes("Over") || ![a.side, b.side].includes("Under")) return [];
  if (Math.abs(a.marketContext.bets! + b.marketContext.bets! - 100) > 1 || Math.abs(a.marketContext.money! + b.marketContext.money! - 100) > 1) return [];
  const prices = pair.map(side => price(side, sport));
  if (prices.some(quote => !quote)) return [];
  return pair.map((side, i) => ({ ...prices[i]!, ruleIds: Number(prices[i]!.odds) < -150 ? []
    : RULES[sport].filter(rule => rule.market === side.market && rule.matches(side, pair[1 - i], homeSide)).map(rule => rule.id) }));
}

export function savedSituationRule(side: Side, sport: SituationSport, now: number) {
  const rule = RULES[sport].find(rule => rule.id === side.situationRuleId && rule.market === side.market);
  const odds = number(side.odds), quote = side.situationQuote;
  return rule && side.recorded === true && quote && Array.isArray(quote.ruleIds) && quote.ruleIds.includes(rule.id) && quote.odds === side.odds
    && typeof quote.assumed === "boolean" && quote.assumed === side.oddsAssumed && (!quote.assumed || odds === -110) && Math.abs(odds) >= 100 && odds >= -150
    && Number.isFinite(side.line) && (side.market !== "Total" || side.line! > 0) && situationFinalWindow(side, now) ? rule : undefined;
}

export function situationWinners(sides: Side[], policy: SituationPolicy, now: number): Side[] {
  const games = new Map<string, Side[]>();
  for (const side of sides) {
    if (side.date !== policy.date || !side.recorded || !side.situationQuote || !situationFinalWindow(side, now) || time(side.gameTime) <= now) continue;
    const group = games.get(side.gameKey) || [];
    group.push(side);
    games.set(side.gameKey, group);
  }
  const picks: Side[] = [];
  for (const group of games.values()) {
    for (const rule of policy.rules) {
      if (!rule.active) continue;
      const pair = group.filter(side => side.market === rule.market);
      // Give the higher-priority market time to arrive before freezing a lower-priority play.
      if (pair.length !== 2) break;
      const matches = pair.filter(side => side.situationQuote!.ruleIds.includes(rule.id));
      if (matches.length > 1) break;
      if (!matches.length) continue;
      const [side] = matches;
      picks.push({ ...side, odds: side.situationQuote!.odds, oddsAssumed: side.situationQuote!.assumed, situationRuleId: rule.id, selected: true });
      break;
    }
  }
  return picks;
}

const units = (row: SituationResult) => row.result === "L" ? -1
  : row.result === "W" ? Number(row.quote.odds) > 0 ? Number(row.quote.odds) / 100 : 100 / Math.abs(Number(row.quote.odds)) : 0;
const net = (rows: SituationResult[]) => rows.reduce((sum, row) => sum + units(row), 0);

export function reviewSituationRules(sport: SituationSport, date: string, now: number, previous: SituationPolicy | undefined, results: SituationResult[]): SituationPolicy {
  const rules = RULES[sport].map((rule, priority) => {
    const prior = previous?.rules.find(state => state.id === rule.id);
    const start: SituationRuleState = prior || { id: rule.id, label: rule.label, market: rule.market, active: rule.seed,
      since: date, change: rule.seed ? "seeded" : "watch" };
    const groups = new Map<string, SituationResult[]>();
    for (const row of results) {
      if (row.date < start.since || row.date >= date || !row.quote.ruleIds.includes(rule.id)) continue;
      const lockedPriority = RULES[sport].findIndex(rule => rule.id === row.officialRuleId);
      if (lockedPriority >= 0 && lockedPriority < priority) continue;
      const key = `${row.date}|${row.gameKey}`, group = groups.get(key) || [];
      group.push(row);
      groups.set(key, group);
    }
    const decided = [...groups.values()].filter(group => group.length === 1).map(([row]) => row).filter(row => row.result !== "P")
      .sort((a, b) => a.date.localeCompare(b.date) || a.snapshotAt.localeCompare(b.snapshotAt) || a.gameKey.localeCompare(b.gameKey));
    const total = net(decided), state = { ...start, decided: decided.length, netUnits: Math.round(total * 100) / 100 };
    if (decided.length < 20) return state;
    if (state.active) {
      return net(decided.slice(-20, -10)) < -1e-9 && net(decided.slice(-10)) < -1e-9
        ? { ...state, active: false, since: date, change: "paused" as const } : state;
    }
    const slates = [...new Set(decided.map(row => row.date))], split = Math.floor(slates.length / 2);
    const best = Math.max(...slates.map(day => net(decided.filter(row => row.date === day))));
    return slates.length >= 4 && total + 1e-9 >= 0.05 * decided.length && net(decided.filter(row => row.date < slates[split])) > 1e-9
      && net(decided.filter(row => row.date >= slates[split])) > 1e-9 && total - best > 1e-9
      ? { ...state, active: true, since: date, change: "promoted" as const } : state;
  });
  return { version: SITUATION_VERSION, sport, date, reviewedAt: new Date(now).toISOString(), rules };
}
