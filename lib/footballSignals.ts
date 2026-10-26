import { footballTeamGameKey, footballTeamKey, footballTeamPair, scoreFootballTeamTrends,
  type FootballTeamTrendScore, type TeamTrendHistory } from "./footballTeamTrends";
import { buildNcaafEzpzLeaderboard, type NcaafEzpzSubtype } from "./ncaafEzpzWilson";
import { buildNflEzpzLeaderboard } from "./nflEzpzWilson";
import { ncaafTrendCategory, ncaafTrendSignals } from "./ncaafPublicTrendLeaderboard";
import { nflTrendSignals } from "./nflPublicTrendLeaderboard";
import { footballCatalog } from "./footballTrendCatalog";
import { nflKickoffIso } from "./footballWeeklyMarket";
import { sosForTeam, type FootballSosSnapshot } from "./footballSos";
import type { FootballSport, SheetRow } from "./sportSheets";
import { buildNbaTrendLeaderboard, nbaModelFor, nbaTrendSignals } from "./nbaTrendLeaderboard";
import { buildSignalResearchDays, buildSignalResearchReport, type SignalResearchReport } from "./signalCombinationResearch";
import { quoteImpliedProbability, regradeModelQuote } from "./modelSignalQuote";
import { evaluateSignalMovement, type SignalMovement } from "./signalMovement";

import { signalPickThreshold, selectSignalEzpzPicks } from "./signalPicks";

type SignalSport = FootballSport | "NBA";
export type SignalsPolicy = { version: string; prefix: string; launchAt: string };

export const FOOTBALL_SIGNALS_VERSION = "football-signals-2026-10-18-v1";
export const FOOTBALL_SIGNALS_LAUNCH_AT = "2026-10-18T22:43:48.000Z";
export const FOOTBALL_SIGNALS_TAB = "football_signal_observations";
export const FOOTBALL_SIGNALS_HEADERS = ["Date", "Pick Key", "Game", "Market", "Selection", "Line", "Odds", "Captured At",
  "Policy Version", "Signal Count", "Source Count", "Combination", "SOS Tier", "Selected", "Result", "Result Updated", "Details JSON"];
const DEFAULT_POLICY: SignalsPolicy = { version: FOOTBALL_SIGNALS_VERSION, prefix: "football-signals-", launchAt: FOOTBALL_SIGNALS_LAUNCH_AT };
export type FootballSignalKey = "money" | "move" | "system" | "team" | "model" | "sos";
type AnyRow = Record<string, any>;
export type FootballSignal = { key: FootballSignalKey; active: boolean; available: boolean; value: number | null; level: string; reason: string };
export type PublicSignalMatch = NcaafEzpzSubtype & { rank: number; rules: string[]; selectionDescription: string };
export type FootballSignalSide = {
  id: string; date: string; gameKey: string; game: string; gameTime: string; awayTeam: string; homeTeam: string;
  market: "Spread" | "Total"; side: string; selection: string; line: number | null; odds: string;
  status: "LIVE" | "FINAL_PREGAME" | "MISSED_LOCK" | "UNAVAILABLE"; snapshotAt: string; recorded: boolean;
  signals: FootballSignal[]; signalCount: number; sourceCount: number; candidate: boolean; selected: boolean; mixed: boolean;
  combination: string; teamTrend: FootballTeamTrendScore | null; publicMatches: PublicSignalMatch[];
  teamGames: { team: string; date: string; opponent: string; venue: string; line: number | null; result: string }[];
  marketContext: { bets: number | null; money: number | null; openingBets: number | null; openingMoney: number | null;
    openingLine: number | null; openingOdds: string; publicChange: number | null; moneyChange: number | null;
    movementBasis: string; movementLabel: string; history: AnyRow[]; movement?: SignalMovement };
  modelContext: { play: string; grade: string; version: string; projection: number | null; probability: number | null; line: number | null; reason: string;
    regraded?: boolean; originalPlay?: string; originalGrade?: string; probabilityEstimated?: boolean };
  sosContext: { sourceUrl: string; capturedAt: string; teams: { team: string; rank: number; elo: number; opponentRecord: string }[]; gap: number | null };
  result: "W" | "L" | "P" | ""; resultUpdated: string;
  policyVersion?: string; oddsAssumed?: boolean;
};
export type FootballSignalsBoard = {
  version: string; sport: SignalSport; today: string; asOf: string; captureAvailable: boolean;
  sides: FootballSignalSide[]; archiveDates: string[]; summary: ReturnType<typeof signalRecord>;
  breakdowns: { dimension: string; label: string; record: ReturnType<typeof signalRecord> }[];
  history: { date: string; game: string; selection: string; market: string; odds: string; signalCount: number; combination: string; result: string }[];
  research?: SignalResearchReport;
};

export const signalNumber = (value: unknown): number | null => {
  if (value == null || String(value).trim() === "") return null;
  const n = Number(String(value).replace(/[−–—%]/g, c => c === "%" ? "" : "-"));
  return Number.isFinite(n) ? n : null;
};
const rounded = (n: number) => Math.round(n * 100) / 100;
const text = (value: unknown) => String(value || "").toLowerCase().trim();
const dateOf = (row: AnyRow) => String(row.date || row.Date || row["Game Date"] || "").slice(0, 10);
const signed = (n: number) => `${n > 0 ? "+" : ""}${rounded(n)}`;
const lineIn = (selection: unknown) => signalNumber(String(selection || "").replace(/[−–—]/g, "-").match(/(?:^|\s)([+-]?\d+(?:\.\d+)?)\s*$/)?.[1]);
function selectionKey(play: AnyRow, sport: SignalSport) {
  return play.market === "Total" ? (/^under/i.test(play.side || play.selection || "") ? "Under" : "Over")
    : footballTeamKey(String(play.selectionTeam || play.selection || "").replace(/\s+[+-]?\d+(?:\.\d+)?\s*$/, ""), sport);
}
function identifier(play: AnyRow, sport: SignalSport) { return `${footballTeamGameKey(play, sport)}|${play.market}|${selectionKey(play, sport)}`; }
const validOdds = (odds: string) => { const n = signalNumber(odds); return n != null && Math.abs(n) >= 100 && n >= -150; };
const tier = (n: number, levels: [number, number, number]) => n >= levels[2] ? "Very strong" : n >= levels[1] ? "Strong" : n >= levels[0] ? "Qualifying" : "Inactive";
function signal(key: FootballSignalKey, available: boolean, active: boolean, value: number | null, level: string, reason: string): FootballSignal {
  return { key, available, active: available && active, value: available ? value : null, level: available ? level : "Unavailable", reason };
}
function decisionAt(play: AnyRow, now: number) {
  const stamp = Date.parse(String(play.frozenAt || play.lockedAt || play.updatedAt || "").replace(/ EDT$/, " -0400").replace(/ EST$/, " -0500"));
  return play.snapshotStatus === "FINAL_PREGAME" && Number.isFinite(stamp) ? stamp : now;
}
export function signalFinalWindow(side: Pick<FootballSignalSide, "status" | "snapshotAt" | "gameTime">, now: number, launchAt = FOOTBALL_SIGNALS_LAUNCH_AT) {
  const kickoff = Date.parse(side.gameTime), stamp = Date.parse(side.snapshotAt);
  return side.status === "FINAL_PREGAME" && Number.isFinite(kickoff) && Number.isFinite(stamp)
    && stamp >= Date.parse(launchAt) && stamp <= now && stamp < kickoff
    && kickoff - stamp >= 10 * 60_000 && kickoff - stamp <= 20 * 60_000;
}
function matchRules(subtype: NcaafEzpzSubtype, sport: SignalSport) {
  const [, , pair, direction, filters] = subtype.signal.split(":");
  const config = footballCatalog(sport), rule = config.rules.find(rule => rule.id === pair);
  return { rules: [rule?.trigger || "Saved catalog membership", ...(filters || "").split(",").filter(Boolean)
    .map(id => { const filter = config.filters.find(filter => filter.id === id); return filter ? `${filter.label}: ${filter.condition}` : id; })],
    selectionDescription: rule?.selections[Number(direction)] || subtype.category };
}
function modelFor(play: AnyRow, sport: SignalSport, core: AnyRow, asOf: number) {
  if (sport === "NBA") return nbaModelFor(play, core.nbaForecasts || [], asOf);
  const key = footballTeamGameKey(play, sport), selected = selectionKey(play, sport);
  const found = (play.date === core.today ? core.bestPlays || [] : []).find((model: AnyRow) => {
    if (model.playerName || model.propMarket || model.role !== play.market || footballTeamGameKey({ ...model, date: play.date }, sport) !== key) return false;
    return selectionKey({ ...model, market: model.role, selection: model.play, selectionTeam: model.play, side: model.play }, sport) === selected;
  });
  const slate = (core.slateToday || []).find((row: AnyRow) => footballTeamGameKey(row, sport) === key);
  const homeProjection = signalNumber(slate?.["Projected Home"] ?? slate?.["Projected Home Score"]);
  const awayProjection = signalNumber(slate?.["Projected Away"] ?? slate?.["Projected Away Score"]);
  const totalProjection = signalNumber(slate?.["Projected Total"]);
  const spreadProjection = signalNumber(slate?.["Projected Spread"]);
  let projection = play.market === "Total" ? totalProjection : spreadProjection;
  if (play.market === "Spread") {
    if (homeProjection != null && awayProjection != null) projection = awayProjection - homeProjection;
    if (projection != null && selected === footballTeamKey(play.awayTeam, sport)) projection = -projection;
  }
  const modelLine = lineIn(found?.play), current = signalNumber(play.line);
  const noWorse = modelLine != null && current != null && (play.market === "Spread" ? current >= modelLine
    : selected === "Over" ? current <= modelLine : current >= modelLine);
  const edge = projection == null || current == null ? null : play.market === "Spread" ? current - projection
    : selected === "Over" ? projection - current : current - projection;
  const hasModel = Boolean(found || projection != null || slate?.["Model Version"]);
  const grade = String(found?.playType || slate?.[play.market + " Grade"] || "");
  const version = String(found?.modelVersion || slate?.["Model Version"] || "");
  const probability = found ? signalNumber(found.selectedProbability ?? slate?.[play.market + " Probability"]) : null;
  const builtAt = Date.parse(String(slate?.["Build At"] || ""));
  const kickoff = Date.parse(nflKickoffIso(play.date, play.gameTime));
  const future = Number.isFinite(builtAt) && (builtAt > asOf || builtAt >= kickoff);
  const pending = slate?.["Build Phase"] === "early" || /pending pregame/i.test(grade);
  const delta = modelLine == null || current == null ? 0 : play.market === "Spread" || selected === "Under" ? current - modelLine : modelLine - current;
  const regraded = found && !future && !pending && modelLine != null && current != null && edge != null
    ? regradeModelQuote({ sport, market: play.market, side: selected, version, savedLine: modelLine, line: current,
      savedEdge: signalNumber(slate?.[play.market + " Edge"]) ?? edge - delta, savedGrade: grade,
      probability, reliability: signalNumber(slate?.Reliability), confluence: signalNumber(slate?.[play.market + " Confluence"]),
      odds: String(play.odds || "-110") }) : null;
  const currentPrice = quoteImpliedProbability(play.odds || "-110");
  const savedPrice = quoteImpliedProbability(found?.oddsLine || "-110");
  const priceOkay = currentPrice != null && (probability != null ? probability > currentPrice : savedPrice != null && currentPrice <= savedPrice);
  const active = !future && !pending && (regraded ? regraded.active : Boolean(found && noWorse && priceOkay));
  const changed = Boolean(regraded && (Math.abs(delta) > 1e-9 || regraded.grade !== grade));
  const currentPlay = play.market === "Total" ? `${selected} ${current}`
    : `${String(play.selectionTeam || play.selection || "").replace(/\s+[+−–—-]?\d+(?:\.\d+)?\s*$/, "")} ${signed(current!)}`;
  return { active, available: hasModel, edge: regraded?.edge ?? edge,
    context: { play: regraded ? currentPlay : String(found?.play || ""), grade: regraded?.grade ?? grade,
      version, projection, line: regraded ? current : modelLine, probability: regraded?.probability ?? probability,
      ...(regraded ? { regraded: changed, originalPlay: String(found.play), originalGrade: grade, probabilityEstimated: regraded.estimated } : {}),
      reason: future ? "This model build was not available before the signal snapshot; no model signal is counted."
        : pending ? "Morning model preview only. The official pregame model build is pending; no model signal is counted yet."
        : regraded ? regraded.reason : found ? !priceOkay ? "The current price does not qualify for the saved model forecast."
        : noWorse ? "Matches an existing qualifying model play at an equal or better line."
        : "The changed line needs a supported model re-evaluation; the saved grade is not carried forward automatically."
        : hasModel ? "No existing qualifying model play on this side." : "No model run is available for this matchup." } };
}
function evaluateSide(play: AnyRow, siblings: AnyRow[], input: SignalsInput, ranking: NcaafEzpzSubtype[]): FootballSignalSide {
  const { sport, core, history, sos, now = Date.now() } = input, asOf = decisionAt(play, now);
  const kickoff = Date.parse(nflKickoffIso(play.date, play.gameTime));
  const finalStamp = Date.parse(String(play.frozenAt || play.lockedAt || play.updatedAt || "").replace(/ EDT$/, " -0400").replace(/ EST$/, " -0500"));
  const publicQuoteEligible = validOdds(String(play.odds || "-110")) && Number.isFinite(kickoff)
    && (play.snapshotStatus === "FINAL_PREGAME" ? Number.isFinite(finalStamp) && finalStamp <= now
      && kickoff - finalStamp >= 10 * 60_000 && kickoff - finalStamp <= 20 * 60_000
      : play.snapshotStatus === "LIVE" && kickoff > now);
  const line = signalNumber(play.line), bets = signalNumber(play.betsPct), money = signalNumber(play.moneyPct);
  const pctValid = bets != null && money != null && bets >= 0 && bets <= 100 && money >= 0 && money <= 100;
  const placeholder = (bets === 100 && money === 100) || (bets === 0 && money === 0);
  const gap = pctValid ? rounded(money! - bets!) : null;
  const movementLabel = String(play.lineMovementSignal || "");
  const movement = evaluateSignalMovement({ market: play.market, side: play.side || play.selection || "",
    openingLine: play.openingLine, line,
    retainedBasis: play.lineMovementBasis, retainedValue: signalNumber(play.lineMovementValue), retainedLabel: movementLabel });
  const memberships = new Set(line == null ? [] : (sport === "NBA" ? nbaTrendSignals : sport === "NFL" ? nflTrendSignals : ncaafTrendSignals)(play, siblings));
  const category = ncaafTrendCategory(play);
  const publicMatches = ranking.slice(0, 20).map((subtype, i) => ({ ...subtype, rank: i + 1, ...matchRules(subtype, sport) }))
    .filter(subtype => subtype.category === category && memberships.has(subtype.signal));
  const teamTrend = scoreFootballTeamTrends(play, sport, history, asOf, { allowMissingSpreadLine: true }), grade = teamTrend?.score ?? null;
  const teamGames = (teamTrend?.teams || []).flatMap(team => [...new Set(Object.values(team.records).flatMap(r => r.gameKeys))].flatMap(key => {
    const game = history.get(key); if (!game) return [];
    const home = game.home === footballTeamKey(team.team, sport), invert = (r: string) => r === "W" ? "L" : r === "L" ? "W" : "P";
    const result = play.market === "Spread" ? game.spread && (home ? game.spread.homeResult : invert(game.spread.homeResult))
      : game.total && (selectionKey(play, sport) === "Under" ? invert(game.total.overResult) : game.total.overResult);
    return [{ team: team.team, date: game.date, opponent: home ? game.away : game.home, venue: game.neutral ? "Neutral" : home ? "Home" : "Away",
      line: play.market === "Spread" && game.spread ? (home ? game.spread.homeLine : -game.spread.homeLine) : null, result: result || "" }];
  }));
  const model = modelFor(play, sport, core, asOf);
  const schedule = [play.awayTeam, play.homeTeam].map(team => sport === "NBA" ? null : sosForTeam(sos || null, team, asOf));
  const completeSos = schedule.every(Boolean);
  const selectedIndex = footballTeamKey(play.selectionTeam || play.selection, sport) === footballTeamKey(play.homeTeam, sport) ? 1 : 0;
  const sosGap = completeSos ? schedule[1 - selectedIndex]!.rank - schedule[selectedIndex]!.rank : null;
  const signals: FootballSignal[] = [
    signal("money", pctValid && !placeholder, gap != null && gap >= 15, gap, gap == null ? "Unavailable" : tier(gap, [15, 25, 35]),
      "Money percentage minus bet percentage. Qualifying +15, strong +25, very strong +35 percentage points."),
    signal("move", movement.available, movement.active, movement.value,
      movement.active ? "Qualifying" : "Inactive", movement.reason),
    signal("system", Boolean(play.catalogEvaluation && !play.catalogEvaluation.invalid), publicMatches.length > 0
      && publicQuoteEligible,
      publicMatches[0]?.wilsonScore ?? null, publicMatches.length && publicQuoteEligible ? "Top-20 match" : "Inactive",
      publicQuoteEligible ? "Only the sport’s current top 20 Wilson-ranked, eligible catalog systems qualify. Multiple matches contribute one signal."
        : "The quote must also meet the existing price, kickoff and final-snapshot eligibility rules. Matching systems alone do not activate the signal."),
    signal("team", grade != null, grade != null && grade >= 75, grade, grade != null && grade >= 75 ? "Qualifying" : "Inactive",
      play.market === "Spread" && line == null
        ? "The spread is unavailable. Season ATS records are shown for context; favorite/underdog records and the grade await the line."
        : teamTrend?.teams.some(team => team.missingGames > 0)
          ? "Available team records are shown, but the grade awaits missing historical market results."
          : "Existing raw team grade: 50% bet type, 30% venue, 20% last five; average both teams. Qualifies at 75 or higher."),
    signal("model", model.available, model.active, model.edge, model.active ? model.context.grade : "Inactive", model.context.reason),
  ];
  if (sport === "NCAAF") signals.push(signal("sos", completeSos, play.market === "Spread" && sosGap != null && sosGap >= 25,
    play.market === "Total" && completeSos ? Math.abs(schedule[0]!.rank - schedule[1]!.rank) : sosGap,
    play.market === "Total" ? "Context only" : sosGap == null ? "Unavailable" : tier(sosGap, [25, 50, 75]),
    "Warren Nolan current ELO SOS: opponent rank minus selected team rank. Qualifying +25, strong +50, very strong +75. Totals receive no vote."));
  const active = signals.filter(s => s.active), signalCount = active.length;
  const sourceCount = [active.some(s => ["money", "move", "system"].includes(s.key)), active.some(s => s.key === "team"), active.some(s => s.key === "model")].filter(Boolean).length;
  const selection = play.market === "Total" ? `${selectionKey(play, sport)}${line == null ? "" : ` ${line}`}`
    : `${play.selectionTeam || play.selection}${line == null ? "" : ` ${signed(line)}`}`;
  const odds = line == null ? "" : String(play.odds || "-110"), quoteValid = line != null && (play.market !== "Total" || line > 0) && validOdds(odds);
  return { id: identifier(play, sport), date: play.date, gameKey: footballTeamGameKey(play, sport), game: play.game,
    gameTime: nflKickoffIso(play.date, play.gameTime), awayTeam: play.awayTeam, homeTeam: play.homeTeam, market: play.market,
    side: selectionKey(play, sport), selection, line, odds, status: play.snapshotStatus || "LIVE",
    snapshotAt: play.snapshotStatus === "FINAL_PREGAME" ? new Date(asOf).toISOString()
      : new Date(Date.parse(String(play.updatedAt || "").replace(/ EDT$/, " -0400").replace(/ EST$/, " -0500")) || asOf).toISOString(), recorded: false,
    signals, signalCount, sourceCount, candidate: signalCount >= signalPickThreshold(sport) && sourceCount >= 2 && quoteValid,
    selected: false, mixed: false, combination: active.map(s => s.key).join(" + "), teamTrend, teamGames, publicMatches,
    marketContext: { bets, money, openingBets: signalNumber(play.openingBetsPct), openingMoney: signalNumber(play.openingMoneyPct),
      openingLine: signalNumber(play.openingLine), openingOdds: String(play.openingOdds || ""), publicChange: signalNumber(play.publicMovementPct),
      moneyChange: signalNumber(play.sharpMovementPct), movementBasis: movement.basis, movementLabel, movement,
      history: (play.movementHistory || []).map((p: AnyRow) => ({ snapshotTime: p.snapshotTime, line: p.line, odds: p.odds, betsPct: p.betsPct, moneyPct: p.moneyPct })) },
    modelContext: model.context,
    sosContext: { sourceUrl: sos?.sourceUrl || "", capturedAt: completeSos ? sos!.fetchedAt : "", gap: sosGap,
      teams: completeSos ? schedule.map((s, i) => ({ team: [play.awayTeam, play.homeTeam][i], rank: s!.rank, elo: s!.elo, opponentRecord: s!.opponentRecord })) : [] },
    policyVersion: (input.policy || DEFAULT_POLICY).version,
    oddsAssumed: play.observedPriceMissing === true || play.oddsSource === "DEFAULT_110" || !play.odds ? true
      : play.observedPriceMissing === false || play.oddsSource === "SNAPSHOT" ? false : undefined,
    result: "", resultUpdated: "" };
}
type SignalsInput = { sport: SignalSport; core: AnyRow; history: TeamTrendHistory; storedRows?: SheetRow[] | null;
  sos?: FootballSosSnapshot | null; now?: number; capture?: boolean; leaderboard?: NcaafEzpzSubtype[];
  leaderboardAsOf?: number; policy?: SignalsPolicy;
  buildSubtypes?: Parameters<typeof buildNcaafEzpzLeaderboard>[3] extends infer T ? T : never };

function fromStored(row: SheetRow, now: number, policy = DEFAULT_POLICY): FootballSignalSide | null {
  try { const side = JSON.parse(row["Details JSON"]); return String(row["Policy Version"] || "").startsWith(policy.prefix)
    && side.id === row["Pick Key"] && Array.isArray(side.signals) && signalFinalWindow(side, now, policy.launchAt)
    ? { ...side, policyVersion: row["Policy Version"], recorded: true,
      result: ["W", "L", "P"].includes(row.Result) ? row.Result : "", resultUpdated: row["Result Updated"] || "" } : null; }
  catch { return null; }
}
/** Replay saved evidence directly, including sides that never qualified as picks. */
export function readSavedFootballSignalsForDate(rows: SheetRow[], date: string, now = Date.now(), policy = DEFAULT_POLICY): FootballSignalSide[] {
  return rows.filter(row => row.Date === date).map(row => fromStored(row, now, policy))
    .filter((side): side is FootballSignalSide => Boolean(side && side.date === date && ["Spread", "Total"].includes(side.market)))
    .sort((a, b) => a.gameTime.localeCompare(b.gameTime) || a.market.localeCompare(b.market) || a.selection.localeCompare(b.selection));
}
function storageRow(side: FootballSignalSide, policy = DEFAULT_POLICY): SheetRow {
  return { Date: side.date, "Pick Key": side.id, Game: side.game, Market: side.market, Selection: side.selection, Line: String(side.line ?? ""), Odds: side.odds,
    "Captured At": side.snapshotAt, "Policy Version": policy.version, "Signal Count": String(side.signalCount), "Source Count": String(side.sourceCount),
    Combination: side.combination, "SOS Tier": side.signals.find(s => s.key === "sos")?.level || "Not used", Selected: side.selected ? "TRUE" : "FALSE",
    Result: side.result, "Result Updated": side.resultUpdated, "Details JSON": JSON.stringify({ ...side, recorded: true }) };
}
function settle(side: FootballSignalSide, input: SignalsInput): FootballSignalSide {
  if (side.result) return side;
  const { core, sport } = input;
  const scores = [...(core.teamTrendScheduleRows || []), ...(core.trendRecordRows || []), ...(core.betTrackerRows || [])].find((row: AnyRow) =>
    footballTeamGameKey(row, sport) === side.gameKey && (/^(true|yes|1)$/i.test(String(row.Completed || "")) || /^[WLP]$/i.test(row.Result || ""))
    && signalNumber(row["Away Score"] ?? row["Actual Away Runs"]) != null && signalNumber(row["Home Score"] ?? row["Actual Home Runs"]) != null);
  if (!scores || side.line == null) return side;
  const pair = footballTeamPair(scores)!;
  const a = signalNumber(scores["Away Score"] ?? scores["Actual Away Runs"])!, h = signalNumber(scores["Home Score"] ?? scores["Actual Home Runs"])!;
  const margin = side.market === "Total" ? (side.side === "Under" ? side.line - a - h : a + h - side.line)
    : (side.side === footballTeamKey(pair[0], sport) ? a - h : h - a) + side.line;
  return { ...side, result: Math.abs(margin) < 0.0001 ? "P" : margin > 0 ? "W" : "L",
    resultUpdated: String(scores["Result Updated"] || scores["History Checked At"] || new Date(input.now || Date.now()).toISOString()) };
}
export function signalRecord(sides: Pick<FootballSignalSide, "result" | "odds">[]) {
  const wins = sides.filter(s => s.result === "W").length, losses = sides.filter(s => s.result === "L").length, pushes = sides.filter(s => s.result === "P").length;
  const netUnits = sides.reduce((sum, side) => sum + (side.result === "L" ? -1 : side.result === "W" ? Number(side.odds) > 0 ? Number(side.odds) / 100 : 100 / Math.abs(Number(side.odds)) : 0), 0);
  const bets = wins + losses + pushes;
  return { wins, losses, pushes, record: `${wins}-${losses}-${pushes}`, settled: bets, pending: sides.length - bets,
    winPct: wins + losses ? rounded(wins / (wins + losses) * 100) : null, netUnits: rounded(netUnits), roiPct: bets ? rounded(netUnits / bets * 100) : null };
}

export function buildFootballSignalsState(input: SignalsInput): { board: FootballSignalsBoard; changedRows: SheetRow[] } {
  const { sport, core, history, now = Date.now() } = input;
  const policy = input.policy || DEFAULT_POLICY;
  const archived = (input.storedRows || []).flatMap(row => {
    const side = fromStored(row, now, policy);
    return side ? [{ side, policy: row["Policy Version"] }] : [];
  });
  const saved = archived.filter(row => row.policy === policy.version).map(row => row.side);
  const stored = new Map(saved.map(side => [side.id, side])), updated = new Map(saved.map(side => [side.id, settle(side, input)]));
  const changedRows: SheetRow[] = [...updated.values()].filter(side => side.result !== stored.get(side.id)?.result).map(side => storageRow(side, policy));
  const marketPlays = new Map<string, AnyRow>();
  const displayStart = core.draftKings?.trackingWeekStart || core.today;
  for (const raw of core.trendPlays || []) {
    if (!["Spread", "Total"].includes(raw.market) || !footballTeamPair(raw)) continue;
    const pair = footballTeamPair(raw)!, play = { ...raw, date: raw.date || raw.recordDate || core.today, awayTeam: raw.awayTeam || pair[0], homeTeam: raw.homeTeam || pair[1] };
    if (play.date < displayStart) continue;
    marketPlays.set(identifier(play, sport), play);
  }
  // Include scheduled matchups even before a market feed has posted both sides.
  for (const row of [...(core.teamTrendScheduleRows || []), ...(core.slateToday || [])]) {
    const date = dateOf(row), pair = footballTeamPair(row);
    const start = core.draftKings?.trackingWeekStart || core.today, end = core.draftKings?.trackingWeekEnd || core.today;
    if (!pair || !date || date < start || date > end) continue;
    for (const market of ["Spread", "Total"] as const) for (const selection of market === "Spread" ? pair : ["Over", "Under"]) {
      const play = { date, game: row.Game || `${pair[0]} @ ${pair[1]}`, gameTime: row["Game Time"] || "", awayTeam: pair[0], homeTeam: pair[1], market,
        selection, selectionTeam: market === "Spread" ? selection : "", side: market === "Total" ? selection : "", snapshotStatus: "UNAVAILABLE" };
      if (!marketPlays.has(identifier(play, sport))) marketPlays.set(identifier(play, sport), play);
    }
  }
  const groups = new Map<string, AnyRow[]>();
  for (const play of marketPlays.values()) {
    const key = `${footballTeamGameKey(play, sport)}|${play.market}`;
    groups.set(key, [...(groups.get(key) || []), play]);
  }
  const rankings = new Map<number, NcaafEzpzSubtype[]>();
  const stale = core.stale === true || core.draftKings?.stale === true || core.draftKings?.displayMode === "STALE_FALLBACK";
  const sides: FootballSignalSide[] = [];
  for (const plays of groups.values()) {
    const evaluated = plays.map(play => {
      const previous = updated.get(identifier(play, sport));
      if (previous) return previous;
      const at = decisionAt(play, now), kickoff = Date.parse(nflKickoffIso(play.date, play.gameTime));
      // A new feature cannot retrospectively create pregame evidence.
      const retrospective = kickoff <= now && at < Date.parse(policy.launchAt);
      let ranking = rankings.get(at);
      if (!ranking) {
        ranking = retrospective ? [] : input.leaderboard && (at === now || (input.leaderboardAsOf != null && input.leaderboardAsOf <= at)) ? input.leaderboard
          : sport === "NBA" ? buildNbaTrendLeaderboard(core.trendRecordRows || [], at)
          : sport === "NFL" ? buildNflEzpzLeaderboard(core.trendRecordRows || [], at)
          : buildNcaafEzpzLeaderboard(core.trendRecordRows || [], at, undefined, input.buildSubtypes);
        rankings.set(at, ranking);
      }
      const ownResult = (core.trendRecordRows || []).some((row: AnyRow) => footballTeamGameKey(row, sport) === footballTeamGameKey(play, sport)
        && Date.parse(row["Result Updated"] || "") <= at);
      if (ownResult) ranking = sport === "NBA" ? buildNbaTrendLeaderboard((core.trendRecordRows || []).filter((row: AnyRow) => footballTeamGameKey(row, sport) !== footballTeamGameKey(play, sport)), at)
        : sport === "NFL" ? buildNflEzpzLeaderboard(core.trendRecordRows || [], at, play)
        : buildNcaafEzpzLeaderboard(core.trendRecordRows || [], at, play, input.buildSubtypes);
      const side = evaluateSide(play, plays, { ...input, history }, ranking);
      if (retrospective) {
        const publicSignal = side.signals.find(s => s.key === "system")!;
        Object.assign(publicSignal, { available: false, active: false, value: null, level: "Unavailable",
          reason: "This game predates the new test. Its full pregame Wilson ranking was not captured for this Signals view." });
      }
      if (retrospective || stale || !Number.isFinite(kickoff) || (sport === "NBA" && kickoff <= now)) side.candidate = false;
      return side;
    });
    const candidates = evaluated.filter(side => side.candidate), highest = Math.max(0, ...candidates.map(s => s.signalCount));
    const leaders = candidates.filter(s => s.signalCount === highest);
    const paired = evaluated.length === 2 && evaluated.every(s => s.line != null && signalFinalWindow(s, now, policy.launchAt))
      && evaluated[0].side !== evaluated[1].side
      && Math.abs(Date.parse(evaluated[0].snapshotAt) - Date.parse(evaluated[1].snapshotAt)) <= 60_000
      && Math.abs(evaluated[0].market === "Spread" ? evaluated[0].line! + evaluated[1].line! : evaluated[0].line! - evaluated[1].line!) < 0.001;
    for (let side of evaluated) {
      if (!side.recorded) {
        side = { ...side, mixed: leaders.length > 1 && candidates.includes(side), selected: leaders.length === 1 && leaders[0] === side };
        if (input.capture && input.storedRows != null && !stale && paired && signalFinalWindow(side, now, policy.launchAt) && Date.parse(side.gameTime) > now) {
          side = { ...side, recorded: true }; changedRows.push(storageRow(side, policy)); updated.set(side.id, side);
        }
      }
      sides.push(side);
    }
  }
  // Keep captured games visible if the current market feed drops them after kickoff.
  // Earlier weeks are loaded separately by date so the main board stays bounded.
  const visibleIds = new Set(sides.map(side => side.id));
  const visibleDates = new Set(sides.map(side => side.date));
  const displayEnd = core.draftKings?.trackingWeekEnd || core.today;
  for (const side of updated.values()) {
    if (!visibleIds.has(side.id) && (visibleDates.has(side.date) || (side.date >= displayStart && side.date <= displayEnd))) sides.push(side);
  }
  const selected = selectSignalEzpzPicks([...updated.values()], sport, now), breakdowns: FootballSignalsBoard["breakdowns"] = [];
  for (const [dimension, value] of [["Market", (s: FootballSignalSide) => s.market], ["Signal count", (s: FootballSignalSide) => String(s.signalCount)],
    ["Combination", (s: FootballSignalSide) => s.combination], ["SOS tier", (s: FootballSignalSide) => s.signals.find(x => x.key === "sos")?.level || "Not used"]] as const) {
    const buckets = new Map<string, FootballSignalSide[]>();
    for (const side of selected) { const key = value(side); buckets.set(key, [...(buckets.get(key) || []), side]); }
    for (const [label, group] of buckets) breakdowns.push({ dimension, label, record: signalRecord(group) });
  }
  const pickIds = new Set(selectSignalEzpzPicks(sides, sport, now).map(side => side.id));
  const displaySides = sides.map(side => ({ ...side, selected: pickIds.has(side.id) }));
  const archiveDates = [...new Set([...archived.map(row => row.side.date), ...[...updated.values()].map(side => side.date)])].sort();
  const research = buildSignalResearchReport(sport, policy.version, buildSignalResearchDays([...updated.values()], policy.version, now));
  return { board: { version: policy.version, sport, today: core.today, asOf: new Date(now).toISOString(), captureAvailable: input.storedRows != null,
    sides: displaySides, archiveDates, summary: signalRecord(selected), breakdowns, research,
    history: selected.slice().sort((a, b) => b.gameTime.localeCompare(a.gameTime)).slice(0, 200).map(s => ({ date: s.date, game: s.game,
      selection: s.selection, market: s.market, odds: s.odds, signalCount: s.signalCount, combination: s.combination, result: s.result })) }, changedRows };
}
