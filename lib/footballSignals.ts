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

export const FOOTBALL_SIGNALS_VERSION = "football-signals-2026-10-18-v1";
export const FOOTBALL_SIGNALS_LAUNCH_AT = "2026-10-18T22:43:48.000Z";
export const FOOTBALL_SIGNALS_TAB = "football_signal_observations";
export const FOOTBALL_SIGNALS_HEADERS = ["Date", "Pick Key", "Game", "Market", "Selection", "Line", "Odds", "Captured At",
  "Policy Version", "Signal Count", "Source Count", "Combination", "SOS Tier", "Selected", "Result", "Result Updated", "Details JSON"];
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
    movementBasis: string; movementLabel: string; history: AnyRow[] };
  modelContext: { play: string; grade: string; version: string; projection: number | null; probability: number | null; line: number | null; reason: string };
  sosContext: { sourceUrl: string; capturedAt: string; teams: { team: string; rank: number; elo: number; opponentRecord: string }[]; gap: number | null };
  result: "W" | "L" | "P" | ""; resultUpdated: string;
};
export type FootballSignalsBoard = {
  version: string; sport: FootballSport; today: string; asOf: string; captureAvailable: boolean;
  sides: FootballSignalSide[]; summary: ReturnType<typeof signalRecord>;
  breakdowns: { dimension: string; label: string; record: ReturnType<typeof signalRecord> }[];
  history: { date: string; game: string; selection: string; market: string; odds: string; signalCount: number; combination: string; result: string }[];
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
const lineIn = (selection: unknown) => signalNumber(String(selection || "").match(/(?:^|\s)([+-]?\d+(?:\.\d+)?)\s*$/)?.[1]);
function selectionKey(play: AnyRow, sport: FootballSport) {
  return play.market === "Total" ? (/^under/i.test(play.side || play.selection || "") ? "Under" : "Over")
    : footballTeamKey(String(play.selectionTeam || play.selection || "").replace(/\s+[+-]?\d+(?:\.\d+)?\s*$/, ""), sport);
}
function identifier(play: AnyRow, sport: FootballSport) { return `${footballTeamGameKey(play, sport)}|${play.market}|${selectionKey(play, sport)}`; }
const validOdds = (odds: string) => { const n = signalNumber(odds); return n != null && Math.abs(n) >= 100 && n >= -150; };
const tier = (n: number, levels: [number, number, number]) => n >= levels[2] ? "Very strong" : n >= levels[1] ? "Strong" : n >= levels[0] ? "Qualifying" : "Inactive";
function signal(key: FootballSignalKey, available: boolean, active: boolean, value: number | null, level: string, reason: string): FootballSignal {
  return { key, available, active: available && active, value: available ? value : null, level: available ? level : "Unavailable", reason };
}
function decisionAt(play: AnyRow, now: number) {
  const stamp = Date.parse(String(play.frozenAt || play.lockedAt || play.updatedAt || "").replace(/ EDT$/, " -0400").replace(/ EST$/, " -0500"));
  return play.snapshotStatus === "FINAL_PREGAME" && Number.isFinite(stamp) ? stamp : now;
}
export function signalFinalWindow(side: Pick<FootballSignalSide, "status" | "snapshotAt" | "gameTime">, now: number) {
  const kickoff = Date.parse(side.gameTime), stamp = Date.parse(side.snapshotAt);
  return side.status === "FINAL_PREGAME" && Number.isFinite(kickoff) && Number.isFinite(stamp)
    && stamp >= Date.parse(FOOTBALL_SIGNALS_LAUNCH_AT) && stamp <= now && stamp < kickoff
    && kickoff - stamp >= 10 * 60_000 && kickoff - stamp <= 20 * 60_000;
}
function matchRules(subtype: NcaafEzpzSubtype, sport: FootballSport) {
  const [, , pair, direction, filters] = subtype.signal.split(":");
  const config = footballCatalog(sport), rule = config.rules.find(rule => rule.id === pair);
  return { rules: [rule?.trigger || "Saved catalog membership", ...(filters || "").split(",").filter(Boolean)
    .map(id => { const filter = config.filters.find(filter => filter.id === id); return filter ? `${filter.label}: ${filter.condition}` : id; })],
    selectionDescription: rule?.selections[Number(direction)] || subtype.category };
}
function modelFor(play: AnyRow, sport: FootballSport, core: AnyRow) {
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
  return { active: Boolean(found && noWorse), available: hasModel, edge,
    context: { play: String(found?.play || ""), grade: String(found?.playType || slate?.[play.market + " Grade"] || ""),
      version: String(found?.modelVersion || slate?.["Model Version"] || ""), projection, line: modelLine,
      probability: signalNumber(found?.selectedProbability),
      reason: found ? noWorse ? "Matches an existing qualifying model play at an equal or better line."
        : "The current line is worse than the saved qualifying model line; awaiting model re-evaluation."
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
  const move = signalNumber(play.lineMovementValue), basis = String(play.lineMovementBasis || ""), movementLabel = String(play.lineMovementSignal || "");
  const positiveMove = play.lineMovementTone === "positive" || (play.signals || []).some((s: AnyRow) => s.signalType === "Line Movement" && s.tone === "positive")
    || /^(?:Line Movement Confirmation|(?:Strong )?Reverse Line Movement Support)$/.test(movementLabel);
  const movementAvailable = move != null && Boolean(movementLabel) && [play.market === "Spread" ? "Spread Line" : "Total Line", "Implied Probability"].includes(basis);
  const memberships = new Set(line == null ? [] : (sport === "NFL" ? nflTrendSignals : ncaafTrendSignals)(play, siblings));
  const category = ncaafTrendCategory(play);
  const publicMatches = ranking.slice(0, 20).map((subtype, i) => ({ ...subtype, rank: i + 1, ...matchRules(subtype, sport) }))
    .filter(subtype => subtype.category === category && memberships.has(subtype.signal));
  const teamTrend = scoreFootballTeamTrends(play, sport, history, asOf), grade = teamTrend?.score ?? null;
  const teamGames = (teamTrend?.teams || []).flatMap(team => [...new Set(Object.values(team.records).flatMap(r => r.gameKeys))].flatMap(key => {
    const game = history.get(key); if (!game) return [];
    const home = game.home === footballTeamKey(team.team, sport), invert = (r: string) => r === "W" ? "L" : r === "L" ? "W" : "P";
    const result = play.market === "Spread" ? game.spread && (home ? game.spread.homeResult : invert(game.spread.homeResult))
      : game.total && (selectionKey(play, sport) === "Under" ? invert(game.total.overResult) : game.total.overResult);
    return [{ team: team.team, date: game.date, opponent: home ? game.away : game.home, venue: game.neutral ? "Neutral" : home ? "Home" : "Away",
      line: play.market === "Spread" && game.spread ? (home ? game.spread.homeLine : -game.spread.homeLine) : null, result: result || "" }];
  }));
  const model = modelFor(play, sport, core);
  const schedule = [play.awayTeam, play.homeTeam].map(team => sosForTeam(sos || null, team, asOf));
  const completeSos = schedule.every(Boolean);
  const selectedIndex = footballTeamKey(play.selectionTeam || play.selection, sport) === footballTeamKey(play.homeTeam, sport) ? 1 : 0;
  const sosGap = completeSos ? schedule[1 - selectedIndex]!.rank - schedule[selectedIndex]!.rank : null;
  const signals: FootballSignal[] = [
    signal("money", pctValid && !placeholder, gap != null && gap >= 15, gap, gap == null ? "Unavailable" : tier(gap, [15, 25, 35]),
      "Money percentage minus bet percentage. Qualifying +15, strong +25, very strong +35 percentage points."),
    signal("move", movementAvailable, positiveMove && Number(move) > 0, move, positiveMove ? movementLabel : "Inactive",
      "Uses the existing market feed’s line movement classification and thresholds, including its RLM rules."),
    signal("system", Boolean(play.catalogEvaluation && !play.catalogEvaluation.invalid), publicMatches.length > 0
      && publicQuoteEligible,
      publicMatches[0]?.wilsonScore ?? null, publicMatches.length && publicQuoteEligible ? "Top-20 match" : "Inactive",
      publicQuoteEligible ? "Only the sport’s current top 20 Wilson-ranked, eligible catalog systems qualify. Multiple matches contribute one signal."
        : "The quote must also meet the existing price, kickoff and final-snapshot eligibility rules. Matching systems alone do not activate the signal."),
    signal("team", grade != null, grade != null && grade >= 75, grade, grade != null && grade >= 75 ? "Qualifying" : "Inactive",
      "Existing raw team grade: 50% bet type, 30% venue, 20% last five; average both teams. Qualifies at 75 or higher."),
    signal("model", model.available, model.active, model.edge, model.active ? model.context.grade : "Inactive", model.context.reason),
  ];
  if (sport === "NCAAF") signals.push(signal("sos", completeSos, play.market === "Spread" && sosGap != null && sosGap >= 25,
    play.market === "Total" && completeSos ? Math.abs(schedule[0]!.rank - schedule[1]!.rank) : sosGap,
    play.market === "Total" ? "Context only" : sosGap == null ? "Unavailable" : tier(sosGap, [25, 50, 75]),
    "Warren Nolan current ELO SOS: opponent rank minus selected team rank. Qualifying +25, strong +50, very strong +75. Totals receive no vote."));
  const active = signals.filter(s => s.active), signalCount = active.length;
  const sourceCount = [active.some(s => ["money", "move", "system"].includes(s.key)), active.some(s => s.key === "team"), active.some(s => s.key === "model")].filter(Boolean).length;
  const selection = play.market === "Total" ? `${selectionKey(play, sport)} ${line ?? "—"}` : `${play.selectionTeam || play.selection} ${line == null ? "—" : signed(line)}`;
  const odds = String(play.odds || "-110"), quoteValid = line != null && (play.market !== "Total" || line > 0) && validOdds(odds);
  return { id: identifier(play, sport), date: play.date, gameKey: footballTeamGameKey(play, sport), game: play.game,
    gameTime: nflKickoffIso(play.date, play.gameTime), awayTeam: play.awayTeam, homeTeam: play.homeTeam, market: play.market,
    side: selectionKey(play, sport), selection, line, odds, status: play.snapshotStatus || "LIVE",
    snapshotAt: play.snapshotStatus === "FINAL_PREGAME" ? new Date(asOf).toISOString()
      : new Date(Date.parse(String(play.updatedAt || "").replace(/ EDT$/, " -0400").replace(/ EST$/, " -0500")) || asOf).toISOString(), recorded: false,
    signals, signalCount, sourceCount, candidate: signalCount >= 3 && sourceCount >= 2 && quoteValid,
    selected: false, mixed: false, combination: active.map(s => s.key).join(" + "), teamTrend, teamGames, publicMatches,
    marketContext: { bets, money, openingBets: signalNumber(play.openingBetsPct), openingMoney: signalNumber(play.openingMoneyPct),
      openingLine: signalNumber(play.openingLine), openingOdds: String(play.openingOdds || ""), publicChange: signalNumber(play.publicMovementPct),
      moneyChange: signalNumber(play.sharpMovementPct), movementBasis: basis, movementLabel,
      history: (play.movementHistory || []).map((p: AnyRow) => ({ snapshotTime: p.snapshotTime, line: p.line, odds: p.odds, betsPct: p.betsPct, moneyPct: p.moneyPct })) },
    modelContext: model.context,
    sosContext: { sourceUrl: sos?.sourceUrl || "", capturedAt: completeSos ? sos!.fetchedAt : "", gap: sosGap,
      teams: completeSos ? schedule.map((s, i) => ({ team: [play.awayTeam, play.homeTeam][i], rank: s!.rank, elo: s!.elo, opponentRecord: s!.opponentRecord })) : [] },
    result: "", resultUpdated: "" };
}
type SignalsInput = { sport: FootballSport; core: AnyRow; history: TeamTrendHistory; storedRows?: SheetRow[] | null;
  sos?: FootballSosSnapshot | null; now?: number; capture?: boolean; leaderboard?: NcaafEzpzSubtype[];
  buildSubtypes?: Parameters<typeof buildNcaafEzpzLeaderboard>[3] extends infer T ? T : never };

function fromStored(row: SheetRow, now: number): FootballSignalSide | null {
  try { const side = JSON.parse(row["Details JSON"]); return row["Policy Version"] === FOOTBALL_SIGNALS_VERSION
    && side.id === row["Pick Key"] && Array.isArray(side.signals) && signalFinalWindow(side, now)
    ? { ...side, recorded: true, result: ["W", "L", "P"].includes(row.Result) ? row.Result : "", resultUpdated: row["Result Updated"] || "" } : null; }
  catch { return null; }
}
function storageRow(side: FootballSignalSide): SheetRow {
  return { Date: side.date, "Pick Key": side.id, Game: side.game, Market: side.market, Selection: side.selection, Line: String(side.line ?? ""), Odds: side.odds,
    "Captured At": side.snapshotAt, "Policy Version": FOOTBALL_SIGNALS_VERSION, "Signal Count": String(side.signalCount), "Source Count": String(side.sourceCount),
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
function signalRecord(sides: FootballSignalSide[]) {
  const wins = sides.filter(s => s.result === "W").length, losses = sides.filter(s => s.result === "L").length, pushes = sides.filter(s => s.result === "P").length;
  const netUnits = sides.reduce((sum, side) => sum + (side.result === "L" ? -1 : side.result === "W" ? Number(side.odds) > 0 ? Number(side.odds) / 100 : 100 / Math.abs(Number(side.odds)) : 0), 0);
  const bets = wins + losses + pushes;
  return { wins, losses, pushes, record: `${wins}-${losses}-${pushes}`, settled: bets, pending: sides.length - bets,
    winPct: wins + losses ? rounded(wins / (wins + losses) * 100) : null, netUnits: rounded(netUnits), roiPct: bets ? rounded(netUnits / bets * 100) : null };
}

export function buildFootballSignalsState(input: SignalsInput): { board: FootballSignalsBoard; changedRows: SheetRow[] } {
  const { sport, core, history, now = Date.now() } = input;
  const saved = (input.storedRows || []).map(row => fromStored(row, now)).filter((s): s is FootballSignalSide => Boolean(s));
  const stored = new Map(saved.map(side => [side.id, side])), updated = new Map(saved.map(side => [side.id, settle(side, input)]));
  const changedRows: SheetRow[] = [...updated.values()].filter(side => side.result !== stored.get(side.id)?.result).map(storageRow);
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
      const retrospective = kickoff <= now && at < Date.parse(FOOTBALL_SIGNALS_LAUNCH_AT);
      let ranking = rankings.get(at);
      if (!ranking) {
        ranking = retrospective ? [] : at === now && input.leaderboard ? input.leaderboard
          : sport === "NFL" ? buildNflEzpzLeaderboard(core.trendRecordRows || [], at)
          : buildNcaafEzpzLeaderboard(core.trendRecordRows || [], at, undefined, input.buildSubtypes);
        rankings.set(at, ranking);
      }
      const ownResult = (core.trendRecordRows || []).some((row: AnyRow) => footballTeamGameKey(row, sport) === footballTeamGameKey(play, sport)
        && Date.parse(row["Result Updated"] || "") <= at);
      if (ownResult) ranking = sport === "NFL" ? buildNflEzpzLeaderboard(core.trendRecordRows || [], at, play)
        : buildNcaafEzpzLeaderboard(core.trendRecordRows || [], at, play, input.buildSubtypes);
      const side = evaluateSide(play, plays, { ...input, history }, ranking);
      if (retrospective) {
        const publicSignal = side.signals.find(s => s.key === "system")!;
        Object.assign(publicSignal, { available: false, active: false, value: null, level: "Unavailable",
          reason: "This game predates the new test. Its full pregame Wilson ranking was not captured for this Signals view." });
      }
      if (retrospective || stale || !Number.isFinite(kickoff)) side.candidate = false;
      return side;
    });
    const candidates = evaluated.filter(side => side.candidate), highest = Math.max(0, ...candidates.map(s => s.signalCount));
    const leaders = candidates.filter(s => s.signalCount === highest);
    const paired = evaluated.length === 2 && evaluated.every(s => s.line != null && signalFinalWindow(s, now))
      && evaluated[0].side !== evaluated[1].side
      && Math.abs(Date.parse(evaluated[0].snapshotAt) - Date.parse(evaluated[1].snapshotAt)) <= 60_000
      && Math.abs(evaluated[0].market === "Spread" ? evaluated[0].line! + evaluated[1].line! : evaluated[0].line! - evaluated[1].line!) < 0.001;
    for (let side of evaluated) {
      if (!side.recorded) {
        side = { ...side, mixed: leaders.length > 1 && candidates.includes(side), selected: leaders.length === 1 && leaders[0] === side };
        if (input.capture && input.storedRows != null && !stale && paired && signalFinalWindow(side, now) && Date.parse(side.gameTime) > now) {
          side = { ...side, recorded: true }; changedRows.push(storageRow(side)); updated.set(side.id, side);
        }
      }
      sides.push(side);
    }
  }
  const selected = [...updated.values()].filter(s => s.selected), breakdowns: FootballSignalsBoard["breakdowns"] = [];
  for (const [dimension, value] of [["Market", (s: FootballSignalSide) => s.market], ["Signal count", (s: FootballSignalSide) => String(s.signalCount)],
    ["Combination", (s: FootballSignalSide) => s.combination], ["SOS tier", (s: FootballSignalSide) => s.signals.find(x => x.key === "sos")?.level || "Not used"]] as const) {
    const buckets = new Map<string, FootballSignalSide[]>();
    for (const side of selected) { const key = value(side); buckets.set(key, [...(buckets.get(key) || []), side]); }
    for (const [label, group] of buckets) breakdowns.push({ dimension, label, record: signalRecord(group) });
  }
  return { board: { version: FOOTBALL_SIGNALS_VERSION, sport, today: core.today, asOf: new Date(now).toISOString(), captureAvailable: input.storedRows != null,
    sides, summary: signalRecord(selected), breakdowns,
    history: selected.slice().sort((a, b) => b.gameTime.localeCompare(a.gameTime)).slice(0, 200).map(s => ({ date: s.date, game: s.game,
      selection: s.selection, market: s.market, odds: s.odds, signalCount: s.signalCount, combination: s.combination, result: s.result })) }, changedRows };
}
