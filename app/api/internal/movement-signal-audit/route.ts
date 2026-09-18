import { NextResponse } from "next/server";
import { readSportWorksheet } from "../../../../lib/sportSheets";
import { readTursoDataset } from "../../../../lib/tursoStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Row = Record<string, string>;
type Sport = "NCAAF" | "MLB";
type Market = "Spread" | "Moneyline" | "Total";

const LINE_MIN = 0.5;
const LINE_STRONG = 1;
const IMPLIED_MIN = 1.5;
const IMPLIED_STRONG = 3;
const PUBLIC_MIN = 5;
const PUBLIC_STRONG = 10;

function text(value: unknown) {
  return String(value ?? "").trim();
}
function numberValue(value: unknown): number | null {
  const raw = text(value).replace(/%/g, "").replace(/[−–—]/g, "-");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
function lineValue(value: unknown): number | null {
  const raw = text(value).replace(/[−–—]/g, "-");
  if (!raw) return null;
  const match = raw.match(/[+-]?\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}
function impliedPct(value: unknown): number | null {
  const raw = text(value).replace(/[−–—]/g, "-");
  const match = raw.match(/[+-]?\d{3,4}/);
  if (!match) return null;
  const odds = Number(match[0]);
  if (!Number.isFinite(odds) || Math.abs(odds) < 100) return null;
  const p = odds < 0 ? Math.abs(odds) / (Math.abs(odds) + 100) : 100 / (odds + 100);
  return Math.round(p * 1000) / 10;
}
function resultCode(value: unknown) {
  const key = text(value).toUpperCase();
  if (["W", "WIN", "WON"].includes(key) || key.includes("WIN")) return "W";
  if (["L", "LOSS", "LOST"].includes(key) || key.includes("LOSS")) return "L";
  if (["P", "PUSH"].includes(key) || key.includes("PUSH")) return "P";
  return "";
}
function parseDetails(row: Row): Record<string, any> {
  for (const field of ["Trend Score Details", "Details JSON"]) {
    const raw = text(row[field]);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return {};
}
function rowDate(row: Row, details: Record<string, any>) {
  return text(row.Date || row["Game Date"] || details.date || details.recordDate);
}
function storedSignal(row: Row, details: Record<string, any>) {
  return text(
    row["Line Movement Signal"] ||
    details.lineMovementSignal ||
    (Array.isArray(details.signals)
      ? details.signals.find((s: any) => text(s?.signalType) === "Line Movement")?.signal
      : "")
  );
}
function publicMove(row: Row, details: Record<string, any>) {
  const stored = numberValue(row["Public Change %"] ?? details.publicMovementPct);
  if (stored != null) return stored;
  const opening = numberValue(
    row["Opening Public %"] ??
    row["Opening Bets %"] ??
    details.openingBetsPct
  );
  const current = numberValue(
    row["Current Public %"] ??
    row["Public Bets %"] ??
    row["Current Bets %"] ??
    details.betsPct
  );
  return opening != null && current != null ? Math.round((current - opening) * 10) / 10 : null;
}
function openingOdds(row: Row, details: Record<string, any>) {
  return text(
    row["Opening Public Split Odds"] ||
    row["Opening Odds"] ||
    details.openingOdds
  );
}
function currentOdds(row: Row, details: Record<string, any>) {
  return text(
    row["Public Split Odds"] ||
    row.Odds ||
    details.odds
  );
}
function openingLine(row: Row, details: Record<string, any>) {
  return lineValue(
    row["Opening Public Split Line"] ??
    row["Opening Line"] ??
    details.openingLine
  );
}
function currentLine(row: Row, details: Record<string, any>) {
  return lineValue(
    row["Public Split Line"] ??
    row.Line ??
    details.line
  );
}
function marketOf(row: Row, details: Record<string, any>): Market | null {
  const value = text(row.Market || details.market);
  if (value === "Spread" || value === "Moneyline" || value === "Total") return value;
  return null;
}
function sideOf(row: Row, details: Record<string, any>, market: Market) {
  if (market === "Total") return text(row.Side || row.Selection || details.side || details.selection);
  return text(row.Selection || details.selection || details.selectionTeam);
}
function selectedSideLineMove(market: Market, side: string, fromLine: number, toLine: number) {
  const rawMove = toLine - fromLine;
  if (market === "Spread") return Math.round(-rawMove * 10) / 10;
  if (market === "Total") {
    const under = side.toLowerCase().startsWith("under");
    return Math.round((under ? -rawMove : rawMove) * 10) / 10;
  }
  return null;
}
function historyLineMove(market: Market, side: string, label: unknown) {
  const values = text(label)
    .split("→")
    .map(lineValue)
    .filter((n): n is number => n != null);
  if (values.length < 2) return null;
  return selectedSideLineMove(market, side, values[values.length - 2], values[values.length - 1]);
}
function classify(publicMovementPct: number, value: number, basis: string) {
  const standard = basis === "Implied Probability" ? IMPLIED_MIN : LINE_MIN;
  const strongThreshold = basis === "Implied Probability" ? IMPLIED_STRONG : LINE_STRONG;
  const opposite =
    Math.abs(publicMovementPct) >= PUBLIC_MIN &&
    publicMovementPct * value < 0 &&
    Math.abs(value) >= standard;
  if (opposite) {
    const strong =
      Math.abs(publicMovementPct) >= PUBLIC_STRONG &&
      Math.abs(value) >= strongThreshold;
    if (value > 0) return strong ? "Strong Reverse Line Movement Support" : "Reverse Line Movement Support";
    return strong ? "Strong Reverse Line Movement Against" : "Reverse Line Movement Against";
  }
  return value > 0 ? "Line Movement Confirmation" : "Adverse Line Movement";
}
function expectedFootball(row: Row, details: Record<string, any>) {
  const market = marketOf(row, details);
  if (market !== "Spread" && market !== "Total") return null;
  const side = sideOf(row, details, market);
  const openLine = openingLine(row, details);
  const nowLine = currentLine(row, details);
  const pub = publicMove(row, details);
  if (pub == null) return null;

  let basis = "";
  let value: number | null = null;
  if (openLine != null && nowLine != null && Math.abs(nowLine - openLine) >= LINE_MIN) {
    basis = market === "Total" ? "Total Line" : "Spread Line";
    value = selectedSideLineMove(market, side, openLine, nowLine);
  }
  if (value == null) {
    const historyValue = historyLineMove(market, side, details.lineHistoryLabel);
    if (historyValue != null && Math.abs(historyValue) >= LINE_MIN) {
      basis = market === "Total" ? "Total Line History" : "Spread Line History";
      value = historyValue;
    }
  }
  if (value == null) {
    const storedBasis = text(row["Line Movement Basis"] || details.lineMovementBasis);
    const storedValue = numberValue(row["Line Movement Value"] ?? details.lineMovementValue);
    if (storedBasis.includes("Line") && storedValue != null) {
      basis = storedBasis;
      const v2 = text(details.movementVersion) === "football-selected-side-v2";
      value = v2
        ? storedValue
        : market === "Spread"
          ? Math.round(-storedValue * 10) / 10
          : Math.round((side.toLowerCase().startsWith("under") ? -storedValue : storedValue) * 10) / 10;
    }
  }
  if (value == null) {
    const openImp = numberValue(row["Opening Implied %"] ?? details.openingImpliedPct) ?? impliedPct(openingOdds(row, details));
    const nowImp = numberValue(row["Current Implied %"] ?? details.currentImpliedPct) ?? impliedPct(currentOdds(row, details));
    if (openImp != null && nowImp != null && Math.abs(nowImp - openImp) >= IMPLIED_MIN) {
      basis = "Implied Probability";
      value = Math.round((nowImp - openImp) * 10) / 10;
    }
  }
  if (value == null || Math.abs(value) < (basis === "Implied Probability" ? IMPLIED_MIN : LINE_MIN)) {
    return { market, side, publicMove: pub, basis, value, expected: "" };
  }
  return { market, side, publicMove: pub, basis, value, expected: classify(pub, value, basis) };
}
function expectedMlb(row: Row, details: Record<string, any>) {
  const market = marketOf(row, details);
  if (market !== "Moneyline" && market !== "Total") return null;
  const side = sideOf(row, details, market);
  const pub = publicMove(row, details);
  if (pub == null) return null;
  const openLine = openingLine(row, details);
  const nowLine = currentLine(row, details);

  let basis = "";
  let value: number | null = null;
  if (market === "Total" && openLine != null && nowLine != null) {
    const selected = selectedSideLineMove(market, side, openLine, nowLine);
    if (selected != null && Math.abs(selected) >= LINE_MIN) {
      basis = "Total Line";
      value = selected;
    }
  }
  if (value == null) {
    const openImp = numberValue(row["Opening Implied %"] ?? details.openingImpliedPct) ?? impliedPct(openingOdds(row, details));
    const nowImp = numberValue(row["Current Implied %"] ?? details.currentImpliedPct) ?? impliedPct(currentOdds(row, details));
    if (openImp != null && nowImp != null && Math.abs(nowImp - openImp) >= IMPLIED_MIN) {
      basis = "Implied Probability";
      value = Math.round((nowImp - openImp) * 10) / 10;
    }
  }
  if (value == null) return { market, side, publicMove: pub, basis, value, expected: "" };
  return { market, side, publicMove: pub, basis, value, expected: classify(pub, value, basis) };
}
function groupIncrement(target: Record<string, number>, key: string) {
  target[key] = (target[key] || 0) + 1;
}
function auditRows(sport: Sport, rows: Row[]) {
  const mismatchPairs: Record<string, number> = {};
  const byMarket: Record<string, { audited: number; mismatches: number; completedAudited: number; completedMismatches: number }> = {};
  const byExpected: Record<string, number> = {};
  const byStored: Record<string, number> = {};
  const examples: any[] = [];
  let eligible = 0;
  let mismatches = 0;
  let completedEligible = 0;
  let completedMismatches = 0;
  let storedBlankExpectedSignal = 0;
  let expectedBlankStoredSignal = 0;

  for (const row of rows) {
    const details = parseDetails(row);
    const state = sport === "NCAAF" ? expectedFootball(row, details) : expectedMlb(row, details);
    if (!state) continue;
    const stored = storedSignal(row, details);
    const expected = state.expected;
    const hasAnySignalContext =
      Boolean(stored) ||
      Boolean(expected) ||
      numberValue(row["Line Movement Value"] ?? details.lineMovementValue) != null ||
      Boolean(text(row["Line Movement Basis"] || details.lineMovementBasis));
    if (!hasAnySignalContext) continue;

    eligible += 1;
    const completed = Boolean(resultCode(row.Result || row.Status));
    if (completed) completedEligible += 1;
    byMarket[state.market] ||= { audited: 0, mismatches: 0, completedAudited: 0, completedMismatches: 0 };
    byMarket[state.market].audited += 1;
    if (completed) byMarket[state.market].completedAudited += 1;
    groupIncrement(byExpected, expected || "(blank)");
    groupIncrement(byStored, stored || "(blank)");

    const mismatch = stored !== expected;
    if (!mismatch) continue;
    mismatches += 1;
    byMarket[state.market].mismatches += 1;
    if (completed) {
      completedMismatches += 1;
      byMarket[state.market].completedMismatches += 1;
    }
    if (!stored && expected) storedBlankExpectedSignal += 1;
    if (stored && !expected) expectedBlankStoredSignal += 1;
    groupIncrement(mismatchPairs, `${stored || "(blank)"} -> ${expected || "(blank)"}`);
    if (examples.length < 30) {
      examples.push({
        date: rowDate(row, details),
        game: text(row.Game || details.game),
        market: state.market,
        selection: text(row.Selection || details.selection),
        side: state.side,
        openingLine: openingLine(row, details),
        currentLine: currentLine(row, details),
        openingOdds: openingOdds(row, details),
        currentOdds: currentOdds(row, details),
        publicMove: state.publicMove,
        basis: state.basis,
        selectedSideMove: state.value,
        stored,
        expected,
        completed,
        result: text(row.Result || row.Status),
      });
    }
  }

  const sortedPairs = Object.fromEntries(
    Object.entries(mismatchPairs).sort((a, b) => b[1] - a[1])
  );
  return {
    totalRows: rows.length,
    auditedRows: eligible,
    mismatches,
    matchRatePct: eligible ? Math.round(((eligible - mismatches) / eligible) * 10000) / 100 : 100,
    completedAuditedRows: completedEligible,
    completedMismatches,
    completedMatchRatePct: completedEligible ? Math.round(((completedEligible - completedMismatches) / completedEligible) * 10000) / 100 : 100,
    storedBlankExpectedSignal,
    expectedBlankStoredSignal,
    byMarket,
    mismatchPairs: sortedPairs,
    byExpected,
    byStored,
    examples,
  };
}

export async function GET() {
  const [cfbRows, mlbRows] = await Promise.all([
    readSportWorksheet("NCAAF", "all_game_trends"),
    readTursoDataset("MLB", "all_game_trends"),
  ]);
  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    definitions: {
      publicMoveMinimum: PUBLIC_MIN,
      strongPublicMoveMinimum: PUBLIC_STRONG,
      lineMoveMinimum: LINE_MIN,
      strongLineMoveMinimum: LINE_STRONG,
      impliedMoveMinimumPctPoints: IMPLIED_MIN,
      strongImpliedMoveMinimumPctPoints: IMPLIED_STRONG,
    },
    cfb: auditRows("NCAAF", cfbRows),
    mlb: auditRows("MLB", mlbRows),
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
