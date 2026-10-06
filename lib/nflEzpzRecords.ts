import { isPublicSplitEzpzPick } from "./ezpzPublicSplitEligibility";
import { NFL_CORE_SELECTOR_EFFECTIVE_DATE, savedNflCoreClass } from "./nflEzpzPolicy";

type Pick = Record<string, any>;

const NFL_TEAMS: Record<string, string> = {
  ari: "cardinals", atl: "falcons", bal: "ravens", buf: "bills",
  car: "panthers", chi: "bears", cin: "bengals", cle: "browns",
  dal: "cowboys", den: "broncos", det: "lions", gb: "packers",
  hou: "texans", ind: "colts", jac: "jaguars", jax: "jaguars",
  kc: "chiefs", lv: "raiders", lac: "chargers", la: "rams", lar: "rams",
  mia: "dolphins", min: "vikings", ne: "patriots", no: "saints",
  nyg: "giants", nyj: "jets", phi: "eagles", pit: "steelers",
  sea: "seahawks", sf: "49ers", tb: "buccaneers", ten: "titans",
  was: "commanders", wsh: "commanders",
};
const MASCOTS = new Set(Object.values(NFL_TEAMS));

function textKey(value: unknown) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isoDate(value: unknown) {
  const raw = String(value || "").trim();
  const iso = raw.match(/^(20\d{2})-(\d{2})-(\d{2})(?:$|T)/);
  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(20\d{2})$/);
  const date = iso ? iso[0].slice(0, 10) : us ? `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}` : "";
  const stamp = Date.parse(`${date}T12:00:00Z`);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === date ? date : "";
}

function teamKey(value: string) {
  const key = textKey(value);
  const mascot = key.split(" ").at(-1) || "";
  return NFL_TEAMS[key] || (MASCOTS.has(mascot) ? mascot : key);
}

function gameKey(value: unknown) {
  return String(value || "").split(/\s*(?:@|\bat\b|\bvs\.?\b|\bversus\b)\s*/i)
    .map(teamKey).filter(Boolean).sort().join("|");
}

function resultCode(value: unknown) {
  const key = String(value || "").trim().toUpperCase();
  if (["W", "WIN", "WON"].includes(key)) return "W";
  if (["L", "LOSS", "LOST"].includes(key)) return "L";
  if (["P", "PUSH"].includes(key)) return "P";
  return "";
}

function americanOdds(value: unknown) {
  const raw = String(value ?? "").trim().replace(/−/g, "-");
  if (/^(?:even|evs)$/i.test(raw)) return 100;
  const odds = Number(raw.match(/[+-]?\d{3,4}/)?.[0]);
  return Number.isFinite(odds) && Math.abs(odds) >= 100 ? odds : -110;
}

function finalSnapshot(pick: Pick) {
  return textKey(pick.snapshotStatus).startsWith("final");
}

function eligible(pick: Pick) {
  if (pick.qualified === false || pick.ezpzEligible === false || americanOdds(pick.odds) < -150) return false;
  if (/^(?:rejected|cancelled|canceled|pass|skipped|void)/.test(textKey(pick.snapshotStatus))) return false;
  const trend = isPublicSplitEzpzPick(pick);
  if (pick.date >= NFL_CORE_SELECTOR_EFFECTIVE_DATE) {
    return trend && Boolean(savedNflCoreClass(pick.market, pick.tier)) && finalSnapshot(pick);
  }
  // Keep published legacy qualifications, including graded snapshots whose
  // capture label was never advanced from LIVE to FINAL_PREGAME.
  if (trend) return true;
  if (!["best play", "best trend"].includes(textKey(pick.source)) || !finalSnapshot(pick)) return false;
  const yardage = ["passing yards", "rushing yards", "receiving yards"].includes(textKey(pick.propMarket));
  return !yardage || ["strong", "regular"].includes(textKey(pick.tier));
}

function decisionTime(pick: Pick) {
  return Math.max(0, ...[pick.lockedAt, pick.updatedAt, pick.savedAt].map((value) => {
    const stamp = Date.parse(String(value || "").replace(/ EDT$/, " -0400").replace(/ EST$/, " -0500"));
    return Number.isFinite(stamp) ? stamp : 0;
  }));
}

function preferPick(left: Pick, right: Pick) {
  // A frozen decision owns the game even if its grade is still pending.
  const finalDiff = Number(finalSnapshot(right)) - Number(finalSnapshot(left));
  if (finalDiff) return finalDiff > 0 ? right : left;
  if (left.date >= NFL_CORE_SELECTOR_EFFECTIVE_DATE) {
    const priorityDiff = savedNflCoreClass(right.market, right.tier)!.priority - savedNflCoreClass(left.market, left.tier)!.priority;
    if (priorityDiff) return priorityDiff < 0 ? right : left;
  }
  const timeDiff = decisionTime(right) - decisionTime(left);
  if (timeDiff) return timeDiff > 0 ? right : left;
  // Grading may enrich an otherwise identical saved decision. Never use its
  // outcome to choose between different selections or lines.
  const selectionKey = (value: unknown) => String(value || "").toLowerCase().replace(/−/g, "-").replace(/\s+/g, " ").trim();
  const sameSelection = selectionKey(left.selection) === selectionKey(right.selection);
  if (sameSelection && Boolean(resultCode(left.result)) !== Boolean(resultCode(right.result))) {
    return resultCode(right.result) ? right : left;
  }
  return `${left.market}|${left.selection}`.localeCompare(`${right.market}|${right.selection}`) <= 0 ? left : right;
}

export function selectNflEzpzHistory(rows: Pick[], today: string) {
  const asOf = isoDate(today);
  const selected = new Map<string, Pick>();
  for (const raw of rows) {
    const pick: Pick = { ...raw, date: isoDate(raw.date), result: resultCode(raw.result) };
    const game = gameKey(pick.game);
    if (!asOf || !pick.date || pick.date > asOf || !game || !pick.selection || !eligible(pick)) continue;
    const identity = pick.date >= NFL_CORE_SELECTOR_EFFECTIVE_DATE
      ? `${pick.date}|${game}`
      : `${pick.date}|${game}|${textKey(pick.market)}|${textKey(pick.playerName)}|${textKey(pick.propMarket)}`;
    const previous = selected.get(identity);
    selected.set(identity, previous ? preferPick(previous, pick) : pick);
  }
  return [...selected.values()].sort((a, b) => b.date.localeCompare(a.date) || String(a.game).localeCompare(String(b.game)));
}

function recordTotals(rows: Pick[], label: string) {
  let wins = 0, losses = 0, pushes = 0, units = 0;
  for (const pick of rows) {
    const result = resultCode(pick.result);
    if (result === "W") {
      wins += 1;
      const odds = americanOdds(pick.odds);
      units += odds > 0 ? odds / 100 : 100 / Math.abs(odds);
    } else if (result === "L") { losses += 1; units -= 1; }
    else if (result === "P") pushes += 1;
  }
  const totalBets = wins + losses + pushes;
  const decisions = wins + losses;
  return {
    label, record: `${wins}-${losses}-${pushes}`, totalBets, wins, losses, pushes,
    winPct: decisions ? Math.round(wins / decisions * 1000) / 10 : 0,
    unitsWon: Math.round(units * 100) / 100,
    roiPct: totalBets ? Math.round(units / totalBets * 1000) / 10 : 0,
  };
}

export function buildNflEzpzRecords(rows: Pick[], today: string) {
  const history = selectNflEzpzHistory(rows, today);
  const asOf = isoDate(today);
  const cutoff = Date.parse(`${asOf}T12:00:00Z`) - 6 * 86_400_000;
  const windowStart = Number.isFinite(cutoff) ? new Date(cutoff).toISOString().slice(0, 10) : "";
  const settled = history.filter((pick) => resultCode(pick.result));
  return {
    asOf, windowStart, history,
    last7Days: recordTotals(settled.filter((pick) => pick.date >= windowStart), "EZPZ Picks - Last 7 Days"),
    overall: recordTotals(settled, "EZPZ Picks - Running Total"),
  };
}
