import type { FootballSignalSide, FootballSignalsBoard } from "./footballSignals";
import { comboPickPolicy, validComboScore, validComboFinalWindow } from "./comboScore";
import { pendingSituationRule, savedSituationRule, SITUATION_VERSION, usesSituationRules } from "./situationRules";
export { comboPickPolicy } from "./comboScore";

export const SIGNAL_EZPZ_EFFECTIVE_DATE = "2026-10-25";
export const SIGNAL_EZPZ_VERSION = "signal-ezpz-2026-10-25-v1";
export const signalPickThreshold = (sport?: string) => sport === "NFL" || sport === "NBA" ? 2 : 3;
export const signalSelectorVersion = (sport: string, date: string) => usesSituationRules(sport, date) ? SITUATION_VERSION : comboPickPolicy(sport, date)?.version || SIGNAL_EZPZ_VERSION;
export const SIGNAL_NAMES: Record<string, string> = { money: "Money support", move: "Line movement", system: "Public bet trends",
  team: "Team trends", model: "Model edge", sos: "Strength of schedule" };

/** Reclassify captured evidence, never rebuild its signals, quotes or results. */
export function signalPickQualifies(side: FootballSignalSide, sport: string) {
  if (usesSituationRules(sport, side.date)) return Boolean(savedSituationRule(side, sport, Date.now()));
  const policy = comboPickPolicy(sport, side.date);
  if (sport === "NCAAM" && !policy) return false; // Await this sport's own calibration.
  if (policy) return validComboScore(side, sport) && side.comboScore!.score + 1e-9 >= policy.threshold;
  const active = side.signals.filter(signal => signal.active && signal.available);
  const sources = [active.some(s => ["money", "move", "system"].includes(s.key)),
    active.some(s => s.key === "team"), active.some(s => s.key === "model")].filter(Boolean).length;
  const odds = Number(side.odds);
  return active.length === side.signalCount && new Set(active.map(s => s.key)).size === active.length
    && active.every(s => Object.hasOwn(SIGNAL_NAMES, s.key)) && active.length >= signalPickThreshold(sport) && sources >= 2
    && side.line != null && Number.isFinite(side.line) && (side.market !== "Total" || side.line > 0)
    && Number.isFinite(odds) && Math.abs(odds) >= 100 && odds >= -150;
}

/** One decision per game. Combo scores require both opposing pairs to be saved. */
export function selectSignalEzpzPicks(sides: FootballSignalSide[], sport: string, now = Date.now()) {
  const unique = new Map<string, FootballSignalSide>();
  for (const side of sides) {
    if (usesSituationRules(sport, side.date)) {
      if (savedSituationRule(side, sport, now)
        || (pendingSituationRule(side, sport, now) && !unique.get(side.id)?.recorded)) unique.set(side.id, side);
      continue;
    }
    const policy = comboPickPolicy(sport, side.date);
    if (policy ? !validComboScore(side, sport) : !signalPickQualifies(side, sport)) continue;
    const captured = Date.parse(side.snapshotAt), kickoff = Date.parse(side.gameTime), lead = kickoff - captured;
    const frozen = side.recorded && (policy ? side.comboScore!.mode === "locked" && validComboFinalWindow(side, now)
      : side.status === "FINAL_PREGAME" && captured <= now && lead >= 600_000 && lead <= 1_200_000);
    const preview = !side.recorded && (policy ? side.comboScore!.mode === "preview" : side.candidate)
      && side.status === "LIVE" && kickoff > now && !side.result;
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
    if (usesSituationRules(sport, group[0].date)) {
      const locked = group.filter(side => savedSituationRule(side, sport, now));
      return locked.length ? locked.length === 1 ? locked : [] : group.length === 1 ? group : [];
    }
    const policy = comboPickPolicy(sport, group[0].date);
    if (policy) {
      // Wait for both markets: a later-arriving total must not replace a spread
      // that has already emitted the game's final-pick event.
      if (group.length !== 4 || group.filter(s => s.market === "Spread").length !== 2
        || group.filter(s => s.market === "Total").length !== 2
        || group.some(s => s.recorded !== group[0].recorded)
        || group.some(s => (s.scheduledGameTime || s.gameTime) !== (group[0].scheduledGameTime || group[0].gameTime))
        || group.some(s => s.comboScore!.opponent.id !== group.find(o => o.id !== s.id && o.market === s.market)?.id)) return [];
      const ordered = group.slice().sort((a, b) => b.comboScore!.score - a.comboScore!.score
        || Number(b.market === "Spread") - Number(a.market === "Spread")
        || b.selection.localeCompare(a.selection) || a.id.localeCompare(b.id));
      return signalPickQualifies(ordered[0], sport) ? [ordered[0]] : [];
    }
    const highest = Math.max(...group.map(side => side.signalCount));
    const leaders = group.filter(side => side.signalCount === highest);
    return leaders.length === 1 ? leaders : [];
  }).sort((a, b) => a.gameTime.localeCompare(b.gameTime) || a.id.localeCompare(b.id));
}

export function signalPickForFeed(side: FootballSignalSide, sport: string) {
  const { marketContext, teamGames, publicMatches, ...evidence } = side;
  if (usesSituationRules(sport, side.date)) {
    const rule = savedSituationRule(side, sport, Date.parse(side.snapshotAt))
      || pendingSituationRule(side, sport, Date.parse(side.snapshotAt));
    return { ...evidence, sport, source: "Situation Rule", pickCategory: "signals", selectorVersion: SITUATION_VERSION,
      selectionMethod: "situation_rule", ruleId: rule?.id, selected: true, protectionStatus: "PASSED",
      snapshotStatus: side.recorded ? "FINAL_PREGAME" : "LIVE", lockedAt: side.recorded ? side.snapshotAt : "", frozenAt: side.recorded ? side.snapshotAt : "",
      tier: rule?.label, qualification: rule?.label };
  }
  const policy = comboPickPolicy(sport, side.date);
  return { ...evidence, ...(policy ? { gameTime: side.scheduledGameTime || side.gameTime } : {}), sport,
    source: policy ? "Combo Score" : "Signal Test", pickCategory: "signals", selectorVersion: signalSelectorVersion(sport, side.date),
    selectionMethod: policy ? "combo_score" : "signal_count",
    selected: true, protectionStatus: "PASSED", snapshotStatus: side.recorded ? "FINAL_PREGAME" : "LIVE",
    lockedAt: side.recorded ? side.snapshotAt : "", frozenAt: side.recorded ? side.snapshotAt : "",
    threshold: policy?.threshold ?? signalPickThreshold(sport), tier: policy ? `Score ${side.comboScore?.score.toFixed(1)}` : `${side.signalCount} signals`,
    ...(policy ? { score: side.comboScore?.score, scoreThreshold: policy.threshold, scoreVersion: side.comboScore?.version } : {}),
    signalKeys: side.signals.filter(s => s.active && s.available).map(s => s.key),
    qualification: side.signals.filter(s => s.active && s.available).map(s => SIGNAL_NAMES[s.key]).join(" + ") };
}

export function isSignalFeedPick(pick: Record<string, any>, sport: string, now = Date.now()): boolean {
  if (usesSituationRules(sport, String(pick.date || ""))) {
    const saved = savedSituationRule(pick as FootballSignalSide, sport, now);
    const pending = pendingSituationRule(pick as FootballSignalSide, sport, now);
    const rule = saved || pending;
    return Boolean(rule && pick.pickCategory === "signals" && pick.selectorVersion === SITUATION_VERSION
      && pick.selectionMethod === "situation_rule" && pick.ruleId === rule.id && pick.selected === true
      && pick.protectionStatus === "PASSED" && Array.isArray(pick.signals)
      && (saved ? pick.snapshotStatus === "FINAL_PREGAME" && pick.snapshotAt === pick.lockedAt && pick.snapshotAt === pick.frozenAt
        : pick.snapshotStatus === "LIVE" && !pick.lockedAt && !pick.frozenAt));
  }
  const policy = comboPickPolicy(sport, String(pick.date || ""));
  if (pick.pickCategory !== "signals" || pick.selectorVersion !== signalSelectorVersion(sport, String(pick.date || "")) || pick.selected !== true
    || pick.threshold !== (policy?.threshold ?? signalPickThreshold(sport)) || !Array.isArray(pick.signals)) return false;
  if (!signalPickQualifies(pick as FootballSignalSide, sport)) return false;
  if (!policy && pick.selectionMethod !== undefined && pick.selectionMethod !== "signal_count") return false;
  if (policy && (pick.selectionMethod !== "combo_score" || pick.score !== pick.comboScore?.score
    || pick.scoreThreshold !== policy.threshold || pick.scoreVersion !== pick.comboScore?.version)) return false;
  const lead = Date.parse(pick.gameTime) - Date.parse(pick.snapshotAt);
  return pick.snapshotStatus === "LIVE" ? !pick.recorded && (!policy || pick.comboScore?.mode === "preview")
    : pick.snapshotStatus === "FINAL_PREGAME" && pick.recorded === true && pick.snapshotAt === pick.lockedAt
      && (policy ? pick.comboScore?.mode === "locked" && validComboFinalWindow(pick as FootballSignalSide, now) : lead >= 600_000 && lead <= 1_200_000);
}

/** Lightweight replay for result readers; no model or market collectors are imported. */
export function savedSignalPicks(rows: Record<string, string>[], sport: string, date: string) {
  const policyPrefix = sport === "NBA" ? "nba-signals-" : sport === "NCAAM" ? "ncaam-signals-" : "football-signals-";
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
  const policy = comboPickPolicy(sport, today);
  const situation = usesSituationRules(sport, today);
  const history = (board?.history || []).filter(row => situation ? usesSituationRules(sport, row.date) : !policy || signalSelectorVersion(sport, row.date) === policy.version)
    .map(row => ({ ...row, source: situation ? "Situation Rule" : comboPickPolicy(sport, row.date) ? "Combo Score" : "Signal Test", selectorVersion: signalSelectorVersion(sport, row.date),
    selected: true, snapshotStatus: "FINAL_PREGAME" }));
  const totals = (rows: typeof history) => {
    let wins = 0, losses = 0, pushes = 0, units = 0;
    for (const row of rows) {
      if (row.result === "W") { wins++; units += Number(row.odds) > 0 ? Number(row.odds) / 100 : 100 / Math.abs(Number(row.odds)); }
      else if (row.result === "L") { losses++; units--; } else if (row.result === "P") pushes++;
    }
    const totalBets = wins + losses + pushes;
    return { record: `${wins}-${losses}-${pushes}`, wins, losses, pushes, totalBets, pending: rows.length - totalBets,
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
    aiSelectorStatus: { selectedCount: picks.length,
      message: situation ? `${sport} EZPZ Picks use sport-specific play types. Pending picks update with live quotes; one pick per game locks at the final pregame snapshot.`
        : sport === "NCAAM" && !policy ? "NCAAM combo scores are collecting history. An official threshold has not been calibrated yet." : policy ? `${sport} EZPZ Picks: combo score ${policy.threshold} or higher. Highest score per game; original pregame scoring inputs are saved.`
        : `${sport} EZPZ Picks: ${signalPickThreshold(sport)}+ signals across at least two evidence sources. One pick per game; tied leaders wait. Final pregame quotes are saved.`,
      selectorVersion: signalSelectorVersion(sport, today), selectionMethod: situation ? "situation_rule" : sport === "NCAAM" && !policy ? "pending_calibration" : policy ? "combo_score" : "signal_count",
      threshold: situation || (sport === "NCAAM" && !policy) ? null : policy?.threshold ?? signalPickThreshold(sport),
      ...(situation ? { situationPolicy: board?.situationPolicy ?? null } : { scoreCalibration: !policy && ["NFL", "NBA", "NCAAM"].includes(sport) ? "In review" : undefined }) } };
}
