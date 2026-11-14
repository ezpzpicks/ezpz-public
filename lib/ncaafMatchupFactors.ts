import type { SheetRow } from "./sportSheets";
import { footballTeamKey } from "./footballTeamTrends";
import { ncaafSpreadReviewReasons, ncaafTotalReviewReasons, validNcaafSelectionReview,
  type NcaafSelectionReview, type NcaafFactorsZ } from "./ncaafSelectionReview";

export const NCAAF_MATCHUP_POLICY = "ncaaf-sp-matchup-2026-11-14-v3";
const REVIEWED_MATCHUP_POLICY = "ncaaf-sp-matchup-2026-11-13-v2";
const RECORD_POLICIES = new Set([REVIEWED_MATCHUP_POLICY, NCAAF_MATCHUP_POLICY]);
const MATCHUP_POLICIES = new Set(["ncaaf-sp-matchup-2026-11-13-v1", ...RECORD_POLICIES]);
type Benchmark = { mean: number; sd: number; teams: number };
type Rating = { team: string; offense: number; defense: number; tempo: number; plays?: number; possessions?: number };
type Grade = { grade: "A" | "B" | "Research"; reason: string; as_of: string; kickoff: string;
  policy_version: string; policy_sha256: string; source_population_sha256: string; status: string;
  side?: string; selection_team?: string; projected_total?: number; projected_margin?: number;
  selection_review_policy?: NcaafSelectionReview; published_at?: string;
  thresholds?: { extreme_z: number; spread_max_market_line: number } };
export type NcaafMatchupFactors = {
  away: Rating; home: Rating; national: Record<"offense" | "defense" | "tempo", Benchmark>;
  source: string; source_url: string; season: number; observed_at: string; population_sha256: string;
  pace_source: string; pace_through_week: number;
};
export type NcaafMatchupContext = { factors: NcaafMatchupFactors; spread: Grade; total: Grade };
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const object = (text: string | undefined) => { try { const v = JSON.parse(text || ""); return v && typeof v === "object" && !Array.isArray(v) ? v : null; } catch { return null; } };
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const instant = (v: unknown) => typeof v === "string" && /(?:Z|[+-]\d{2}:\d{2})$/.test(v) ? Date.parse(v) : NaN;

/** Read captured factors only. Never replace older ratings with today's SP+. */
export function ncaafMatchupContext(row: SheetRow): NcaafMatchupContext | null {
  const policyVersion = row["Grading Policy Version"];
  if (!MATCHUP_POLICIES.has(policyVersion)) return null;
  const f = object(row["Matchup Factors JSON"]), spread = object(row["Matchup Spread JSON"]), total = object(row["Matchup Total JSON"]);
  if (!f || !spread || !total || f.source_url !== "https://pay.cfbupdate.com/sp-ratings"
    || typeof f.source !== "string" || f.season !== Number(row.Season) || !hash(f.population_sha256)
    || !Number.isFinite(instant(f.observed_at))) return null;
  for (const side of ["away", "home"] as const) {
    const r = f[side];
    if (!r || typeof r.team !== "string" || !footballTeamKey(r.team, "NCAAF")
      || footballTeamKey(r.team, "NCAAF") !== footballTeamKey(row[side === "away" ? "Away Team" : "Home Team"], "NCAAF") || !finite(r.offense) || !finite(r.defense)
      || !finite(r.tempo) || r.offense < 0 || r.offense > 90 || r.defense < 0 || r.defense > 90 || r.tempo < 7 || r.tempo > 20) return null;
  }
  for (const metric of ["offense", "defense", "tempo"] as const) {
    const b = f.national?.[metric];
    if (!b || !finite(b.mean) || !finite(b.sd) || b.sd <= 0 || !Number.isInteger(b.teams) || b.teams < (metric === "tempo" ? 100 : 125)) return null;
  }
  for (const g of [spread, total]) {
    const clock = instant(g.as_of), kickoff = instant(g.kickoff), observed = instant(f.observed_at);
    if (g.policy_version !== policyVersion || !hash(g.policy_sha256) || g.source_population_sha256 !== f.population_sha256
      || !["A", "B", "Research"].includes(g.grade) || typeof g.reason !== "string" || g.record_mode !== "live"
      || !(observed <= clock && clock < kickoff) || clock - observed > 8 * 86400000) return null;
  }
  return { factors: f, spread, total } as NcaafMatchupContext;
}

/** Recheck the saved support at a new quote without restoring the old edge ladder. */
export function ncaafMatchupQuoteReview(row: SheetRow, market: "Spread" | "Total", line: number,
  selection: string, asOf: number) {
  const fail = (reason: string) => ({ valid: false, reason });
  const context = ncaafMatchupContext(row);
  if (!context || !Number.isFinite(line)) return fail("Saved SP+ matchup factors are unavailable for this quote");
  const g = market === "Spread" ? context.spread : context.total;
  if (!["A", "B"].includes(g.grade) || !(instant(g.as_of) <= asOf && asOf < instant(g.kickoff))
    || (g.published_at && !(instant(g.published_at) <= asOf))) return fail("No qualifying SP+ grade was available before this decision");
  const z = Object.fromEntries((["home", "away"] as const).map(side => [side,
    Object.fromEntries((["offense", "defense", "tempo"] as const).map(metric => [metric,
      (context.factors[side][metric] - context.factors.national[metric].mean) / context.factors.national[metric].sd]))])) as NcaafFactorsZ;
  if (market === "Spread") {
    if (g.side !== "home" && g.side !== "away") return fail("Saved SP+ spread side is unavailable");
    if (footballTeamKey(g.selection_team || "", "NCAAF") !== selection)
      return fail("The current side differs from the saved SP+ spread selection");
    const margin = g.side === "home" ? g.projected_margin : -(g.projected_margin ?? NaN);
    const roleTempo = (z.home.tempo + z.away.tempo) / 2 * (line < 0 ? 1 : line > 0 ? -1 : 0);
    if (!finite(margin) || margin + line <= 0) return fail("Point projection does not support this spread");
    if (Math.abs(line) >= (g.thresholds?.spread_max_market_line ?? 20)) return fail("Large spread remains projection-only");
    if (roleTempo <= -(g.thresholds?.extreme_z ?? 1)) return fail("Extreme tempo conflicts with the selected spread role");
  } else if ((g.side !== "Over" && g.side !== "Under") || g.side !== selection
    || !finite(g.projected_total) || (g.side === "Over" ? g.projected_total <= line : g.projected_total >= line))
    return fail("Point projection does not support this total side");
  // Retain historical preference checks only for captures made under that
  // policy. Current candidates use the underlying SP+ matchup grades.
  if (g.policy_version === REVIEWED_MATCHUP_POLICY) {
    const p = g.selection_review_policy;
    if (!validNcaafSelectionReview(p)) return fail("Saved NCAAF selection preferences are unavailable");
    const reasons = market === "Spread" ? ncaafSpreadReviewReasons(z, g.side as "home" | "away", line, p)
      : ncaafTotalReviewReasons(z, g.side || "", p);
    if (reasons.length) return fail(reasons.join("; "));
  }
  return { valid: true, reason: "Saved SP+ matchup support still qualifies at this quote" };
}

/** Fresh policy records do not inherit the former edge-only grade history. */
export function ncaafMatchupRecordSummary(rows: SheetRow[], today: string) {
  const seen = new Set<string>();
  const selected = rows.filter(row => {
    if (!RECORD_POLICIES.has(row["Grading Policy Version"]) || !/^[AB] (Spread|Total)$/.test(row.Grade || "")
      || !/^(Win|Loss|Push|W|L|P)$/i.test(row.Result || "")) return false;
    const market = String(row["Bet Type"] || row.Market || "").toLowerCase();
    if (!["spread", "total"].includes(market) || !row["Game ID"] || !row.Date) return false;
    const key = [row.Date, row["Game ID"], market].join("|");
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  const summarize = (values: SheetRow[]) => {
    let wins = 0, losses = 0, pushes = 0, units = 0;
    for (const row of values) {
      const result = row.Result.toLowerCase(), odds = Number(row["Odds/Line"] || row.Odds || -110);
      if (!Number.isFinite(odds) || Math.abs(odds) < 100) continue;
      if (["win", "w"].includes(result)) { wins++; units += odds < 0 ? 100 / -odds : odds / 100; }
      else if (["loss", "l"].includes(result)) { losses++; units--; }
      else pushes++;
    }
    const totalBets = wins + losses + pushes;
    return { label: "SP+ matchup model", wins, losses, pushes, totalBets, record: `${wins}-${losses}-${pushes}`,
      unitsWon: Math.round(units * 100) / 100, winPct: wins + losses ? Math.round(1000 * wins / (wins + losses)) / 10 : 0,
      roiPct: totalBets ? Math.round(units / totalBets * 1000) / 10 : 0 };
  };
  const clock = Date.parse(`${today}T12:00:00Z`);
  return { overall: summarize(selected), last7Days: summarize(selected.filter(row => {
    const age = (clock - Date.parse(`${row.Date.slice(0, 10)}T12:00:00Z`)) / 86400000;
    return age >= 0 && age < 7;
  })) };
}
