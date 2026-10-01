import { NextResponse } from "next/server";
import { readSportWorksheet } from "../../../../lib/sportSheets";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Row = Record<string, string>;

type AuditRow = {
  date: string;
  player: string;
  slot: string;
  line: number;
  projection: number;
  actual: number;
  result: string;
  grade: string;
  probabilityEdgePct: number | null;
  projectionGapPct: number;
  projectedTargets: number | null;
  actualTargets: number | null;
  projectedReceptions: number | null;
  actualReceptions: number | null;
  projectedEfficiency: number | null;
  actualEfficiency: number | null;
  targetError: number | null;
  efficiencyError: number | null;
  residual: number;
  matchupIndex: number | null;
  roleOverlay: number | null;
  slotAdjustmentPct: number | null;
  modelVersion: string;
  confluence: string;
};

const text = (v: unknown) => String(v ?? "").trim();
const num = (v: unknown) => {
  const n = Number(text(v));
  return Number.isFinite(n) ? n : null;
};
const mean = (a: number[]) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const med = (a: number[]) => {
  if (!a.length) return null;
  const z = [...a].sort((x, y) => x - y);
  const m = Math.floor(z.length / 2);
  return z.length % 2 ? z[m] : (z[m - 1] + z[m]) / 2;
};
const round = (v: number | null, d = 2) => v == null ? null : Number(v.toFixed(d));
const pct = (v: number | null) => v == null ? null : round(v * 100, 1);

function roleOverlay(value: unknown) {
  const m = text(value).match(/live role overlay\s+([0-9.]+)x/i);
  return m ? Number(m[1]) : null;
}

function slotAdjustment(value: unknown) {
  const m = text(value).match(/slot matchup[\s\S]*?applied\s+([+-]?[0-9.]+)%/i);
  return m ? Number(m[1]) : null;
}

function probabilityEdgePct(row: Row) {
  const raw = num(row["Probability Edge"] ?? row.Edge);
  if (raw == null) return null;
  return Math.abs(raw) <= 1 ? raw * 100 : raw;
}

function group(rows: AuditRow[]) {
  const ae = rows.map(r => Math.abs(r.residual));
  const targetErr = rows.map(r => r.targetError).filter((v): v is number => v != null);
  const effErr = rows.map(r => r.efficiencyError).filter((v): v is number => v != null);
  const role = rows.map(r => r.roleOverlay).filter((v): v is number => v != null);
  const matchup = rows.map(r => r.matchupIndex).filter((v): v is number => v != null);
  const gap = rows.map(r => r.projectionGapPct);
  const probEdge = rows.map(r => r.probabilityEdgePct).filter((v): v is number => v != null);
  return {
    n: rows.length,
    mae: round(mean(ae)),
    medianAE: round(med(ae)),
    bias: round(mean(rows.map(r => r.residual))),
    avgTargetError: round(mean(targetErr)),
    avgEfficiencyError: round(mean(effErr)),
    avgRoleOverlay: round(mean(role), 3),
    avgMatchupIndex: round(mean(matchup), 3),
    avgProjectionGapPct: round(mean(gap), 1),
    avgProbabilityEdgePct: round(mean(probEdge), 1),
  };
}

function direction(row: AuditRow) {
  return row.projection >= row.line ? "Over" : "Under";
}

function gradingResult(row: AuditRow) {
  const d = direction(row);
  if (row.actual === row.line) return "P";
  if (d === "Over") return row.actual > row.line ? "W" : "L";
  return row.actual < row.line ? "W" : "L";
}

export async function GET() {
  const tracker = await readSportWorksheet("NFL", "prop_tracker") as Row[];
  const rows: AuditRow[] = [];

  for (const r of tracker) {
    if (text(r.Market) !== "Receiving Yards") continue;
    if (text(r.Position) !== "RB") continue;
    const line = num(r["Market Line"]);
    const projection = num(r.Projection);
    const actual = num(r["Actual Result"]);
    if (line == null || line <= 0 || projection == null || actual == null) continue;

    const projectedTargets = num(r["Projected Targets"]);
    const actualTargets = num(r["Actual Targets"]);
    const projectedReceptions = num(r["Projected Receptions"]);
    const actualReceptions = num(r["Actual Receptions"]);
    const projectedEfficiency = num(r.Efficiency);
    const actualEfficiency = actualTargets != null && actualTargets > 0 ? actual / actualTargets : null;
    const projectionEdgeRaw = num(r["Projection Edge"]);
    const projectionGap = projectionEdgeRaw != null ? Math.abs(projectionEdgeRaw) : Math.abs(projection - line);

    rows.push({
      date: text(r.Date),
      player: text(r.Player),
      slot: text(r.Slot),
      line,
      projection,
      actual,
      result: "",
      grade: text(r.Grade),
      probabilityEdgePct: probabilityEdgePct(r),
      projectionGapPct: 100 * projectionGap / line,
      projectedTargets,
      actualTargets,
      projectedReceptions,
      actualReceptions,
      projectedEfficiency,
      actualEfficiency,
      targetError: projectedTargets != null && actualTargets != null ? actualTargets - projectedTargets : null,
      efficiencyError: projectedEfficiency != null && actualEfficiency != null ? actualEfficiency - projectedEfficiency : null,
      residual: actual - projection,
      matchupIndex: num(r["Matchup Index"]),
      roleOverlay: roleOverlay(r.Confluence),
      slotAdjustmentPct: slotAdjustment(r.Confluence),
      modelVersion: text(r["Model Version"]),
      confluence: text(r.Confluence),
    });
  }

  for (const r of rows) r.result = gradingResult(r);
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.player.localeCompare(b.player));

  const wins = rows.filter(r => r.result === "W");
  const losses = rows.filter(r => r.result === "L");
  const overs = rows.filter(r => direction(r) === "Over");
  const unders = rows.filter(r => direction(r) === "Under");
  const gibbs = rows.filter(r => /jahmyr\s+gibbs/i.test(r.player));
  const recent = rows.filter(r => r.date >= "2026-09-01");
  const recentWins = recent.filter(r => r.result === "W");
  const recentLosses = recent.filter(r => r.result === "L");

  const byPlayer = Object.fromEntries(
    [...new Set(rows.map(r => r.player))]
      .sort()
      .map(player => {
        const z = rows.filter(r => r.player === player);
        return [player, {
          ...group(z),
          record: `${z.filter(r => r.result === "W").length}-${z.filter(r => r.result === "L").length}-${z.filter(r => r.result === "P").length}`,
        }];
      })
  );

  return NextResponse.json({
    counts: { all: rows.length, recent: recent.length, gibbs: gibbs.length },
    overall: group(rows),
    recent: {
      all: group(recent),
      wins: group(recentWins),
      losses: group(recentLosses),
      record: `${recentWins.length}-${recentLosses.length}-${recent.filter(r => r.result === "P").length}`,
    },
    wins: group(wins),
    losses: group(losses),
    overs: { ...group(overs), record: `${overs.filter(r => r.result === "W").length}-${overs.filter(r => r.result === "L").length}-${overs.filter(r => r.result === "P").length}` },
    unders: { ...group(unders), record: `${unders.filter(r => r.result === "W").length}-${unders.filter(r => r.result === "L").length}-${unders.filter(r => r.result === "P").length}` },
    gibbs: { summary: group(gibbs), rows: gibbs },
    byPlayer,
    rows,
  });
}
