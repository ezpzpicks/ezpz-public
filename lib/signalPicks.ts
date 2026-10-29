import type { FootballSignalSide, FootballSignalsBoard } from "./footballSignals";

export const SIGNAL_EZPZ_EFFECTIVE_DATE = "2026-10-25";
export const SIGNAL_EZPZ_VERSION = "signal-ezpz-2026-10-25-v1";
export const signalPickThreshold = (sport?: string) => sport === "NFL" || sport === "NBA" ? 2 : 3;
export const SIGNAL_NAMES: Record<string, string> = { money: "Money support", move: "Line movement", system: "Public bet trends",
  team: "Team trends", model: "Model edge", sos: "Strength of schedule" };

/** Reclassify captured evidence, never rebuild its signals, quotes or results. */
export function signalPickQualifies(side: FootballSignalSide, sport: string) {
  const active = side.signals.filter(signal => signal.active && signal.available);
  const sources = [active.some(s => ["money", "move", "system"].includes(s.key)),
    active.some(s => s.key === "team"), active.some(s => s.key === "model")].filter(Boolean).length;
  const odds = Number(side.odds);
  return active.length === side.signalCount && new Set(active.map(s => s.key)).size === active.length
    && active.every(s => Object.hasOwn(SIGNAL_NAMES, s.key)) && active.length >= signalPickThreshold(sport) && sources >= 2
    && side.line != null && Number.isFinite(side.line) && (side.market !== "Total" || side.line > 0)
    && Number.isFinite(odds) && Math.abs(odds) >= 100 && odds >= -150;
}

/** One decision per game; ties wait rather than using results as a tiebreaker. */
export function selectSignalEzpzPicks(sides: FootballSignalSide[], sport: string, now = Date.now()) {
  const unique = new Map<string, FootballSignalSide>();
  for (const side of sides) {
    if (!signalPickQualifies(side, sport)) continue;
    const captured = Date.parse(side.snapshotAt), kickoff = Date.parse(side.gameTime), lead = kickoff - captured;
    const frozen = side.recorded && side.status === "FINAL_PREGAME" && captured <= now && lead >= 600_000 && lead <= 1_200_000;
    const preview = !side.recorded && side.candidate && side.status === "LIVE" && kickoff > now && !side.result;
    if (!frozen && !preview) continue;
    const previous = unique.get(side.id);
    if (!previous || (!previous.recorded && side.recorded)) unique.set(side.id, side);
  }
  const games = new Map<string, FootballSignalSide[]>();
  for (const side of unique.values()) {
    const key = `${side.date}|${side.gameKey}`;
    games.set(key, [...(games.get(key) || []), side]);
  }
  return [...games.values()].flatMap(group => {
    const highest = Math.max(...group.map(side => side.signalCount));
    const leaders = group.filter(side => side.signalCount === highest);
    return leaders.length === 1 ? leaders : [];
  }).sort((a, b) => a.gameTime.localeCompare(b.gameTime) || a.id.localeCompare(b.id));
}

export function signalPickForFeed(side: FootballSignalSide, sport: string) {
  const { marketContext, teamGames, publicMatches, ...evidence } = side;
  return { ...evidence, sport, source: "Signal Test", pickCategory: "signals", selectorVersion: SIGNAL_EZPZ_VERSION,
    selected: true, protectionStatus: "PASSED", snapshotStatus: side.recorded ? "FINAL_PREGAME" : "LIVE",
    lockedAt: side.recorded ? side.snapshotAt : "", frozenAt: side.recorded ? side.snapshotAt : "",
    threshold: signalPickThreshold(sport), tier: `${side.signalCount} signals`,
    signalKeys: side.signals.filter(s => s.active && s.available).map(s => s.key),
    qualification: side.signals.filter(s => s.active && s.available).map(s => SIGNAL_NAMES[s.key]).join(" + ") };
}

export function isSignalFeedPick(pick: Record<string, any>, sport: string): boolean {
  if (pick.pickCategory !== "signals" || pick.selectorVersion !== SIGNAL_EZPZ_VERSION || pick.selected !== true
    || pick.threshold !== signalPickThreshold(sport) || !Array.isArray(pick.signals)) return false;
  if (!signalPickQualifies(pick as FootballSignalSide, sport)) return false;
  const lead = Date.parse(pick.gameTime) - Date.parse(pick.snapshotAt);
  return pick.snapshotStatus === "LIVE" ? !pick.recorded
    : pick.snapshotStatus === "FINAL_PREGAME" && pick.recorded === true && pick.snapshotAt === pick.lockedAt
      && lead >= 600_000 && lead <= 1_200_000;
}

/** Lightweight replay for result readers; no model or market collectors are imported. */
export function savedSignalPicks(rows: Record<string, string>[], sport: string, date: string) {
  const policyPrefix = sport === "NBA" ? "nba-signals-" : "football-signals-";
  const sides = rows.flatMap(row => {
    try {
      const side = JSON.parse(row["Details JSON"]);
      return row.Date === date && side.date === date && side.id === row["Pick Key"] && Array.isArray(side.signals)
        && String(row["Policy Version"] || "").startsWith(policyPrefix)
        ? [{ ...side, recorded: true, result: /^[WLP]$/.test(row.Result) ? row.Result : "", resultUpdated: row["Result Updated"] || "" }] : [];
    } catch { return []; }
  });
  return selectSignalEzpzPicks(sides, sport);
}

export function signalEzpzPayload(board: FootballSignalsBoard | undefined, sport: string, today: string) {
  const picks = board ? selectSignalEzpzPicks(board.sides, sport).filter(side => side.date === today).map(side => signalPickForFeed(side, sport)) : [];
  const history = (board?.history || []).map(row => ({ ...row, source: "Signal Test", selectorVersion: SIGNAL_EZPZ_VERSION,
    selected: true, snapshotStatus: "FINAL_PREGAME" }));
  const totals = (rows: typeof history) => {
    let wins = 0, losses = 0, pushes = 0, units = 0;
    for (const row of rows) {
      if (row.result === "W") { wins++; units += Number(row.odds) > 0 ? Number(row.odds) / 100 : 100 / Math.abs(Number(row.odds)); }
      else if (row.result === "L") { losses++; units--; } else if (row.result === "P") pushes++;
    }
    const totalBets = wins + losses + pushes;
    return { record: `${wins}-${losses}-${pushes}`, wins, losses, pushes, totalBets,
      winPct: wins + losses ? Math.round(wins / (wins + losses) * 10000) / 100 : 0,
      unitsWon: Math.round(units * 100) / 100, roiPct: totalBets ? Math.round(units / totalBets * 10000) / 100 : 0 };
  };
  const todayStamp = Date.parse(`${today}T12:00:00Z`);
  const cutoff = Number.isFinite(todayStamp) ? new Date(todayStamp - 6 * 86_400_000).toISOString().slice(0, 10) : "";
  const summary = board?.summary;
  return { aiPicks: picks, aiPickRecordRows: history, ezpzRecords: { asOf: today, windowStart: cutoff, history,
    overall: summary ? { ...totals([]), ...summary, totalBets: summary.settled, unitsWon: summary.netUnits,
      winPct: summary.winPct ?? 0, roiPct: summary.roiPct ?? 0 } : totals([]),
    last7Days: totals(history.filter(row => row.date >= cutoff && row.date <= today)) },
    aiSelectorStatus: { selectorVersion: SIGNAL_EZPZ_VERSION, selectedCount: picks.length,
      message: `${sport} EZPZ Picks: ${signalPickThreshold(sport)}+ signals across at least two evidence sources. One pick per game; tied leaders wait. Final pregame quotes are saved.`,
      threshold: signalPickThreshold(sport) } };
}
