import { NextResponse } from "next/server";
import { readSportWorksheet } from "../../../../lib/sportSheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Row = Record<string, string>;

function num(v: unknown): number | null {
  const n = Number(String(v ?? "").replace(/%/g, "").trim());
  return Number.isFinite(n) ? n : null;
}
function resultCode(v: unknown): "W" | "L" | "P" | "" {
  const s = String(v ?? "").trim().toUpperCase();
  if (["W", "WIN", "WON"].includes(s)) return "W";
  if (["L", "LOSS", "LOST"].includes(s)) return "L";
  if (["P", "PUSH"].includes(s)) return "P";
  return "";
}
function side(row: Row): string {
  const p = String(row.Pick ?? "").trim().toLowerCase();
  if (p.startsWith("over")) return "Over";
  if (p.startsWith("under")) return "Under";
  if (p.includes("anytime td")) return "Anytime TD";
  return String(row.Side ?? "").trim() || "Other";
}
function americanProfit(odds: number | null): number | null {
  if (odds == null || odds === 0) return null;
  return odds > 0 ? odds / 100 : 100 / Math.abs(odds);
}
function median(values: number[]): number | null {
  if (!values.length) return null;
  const a = [...values].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function stats(rows: Row[]) {
  const completed = rows.filter(r => resultCode(r.Result));
  const w = completed.filter(r => resultCode(r.Result) === "W").length;
  const l = completed.filter(r => resultCode(r.Result) === "L").length;
  const p = completed.filter(r => resultCode(r.Result) === "P").length;
  const decided = w + l;
  const rcs = completed.map(r => num(r["Role Confidence"])).filter((x): x is number => x != null);
  let profit = 0;
  let roiN = 0;
  for (const r of completed) {
    const rc = resultCode(r.Result);
    const odds = num(r["Pick Odds"]);
    const winProfit = americanProfit(odds);
    if (rc === "P") { roiN += 1; continue; }
    if (rc === "L") { profit -= 1; roiN += 1; continue; }
    if (rc === "W" && winProfit != null) { profit += winProfit; roiN += 1; }
  }
  return {
    n: completed.length, w, l, p,
    winRate: decided ? +(100 * w / decided).toFixed(2) : null,
    avgRoleConfidence: rcs.length ? +(rcs.reduce((a,b)=>a+b,0)/rcs.length).toFixed(2) : null,
    medianRoleConfidence: median(rcs) == null ? null : +median(rcs)!.toFixed(2),
    profitUnits: +profit.toFixed(3),
    roiPct: roiN ? +(100 * profit / roiN).toFixed(2) : null,
  };
}
function pearsonRoleVsWin(rows: Row[]) {
  const pairs = rows.map(r => [num(r["Role Confidence"]), resultCode(r.Result)] as const)
    .filter(([rc, res]) => rc != null && (res === "W" || res === "L")) as Array<readonly [number,"W"|"L"]>;
  if (pairs.length < 2) return null;
  const xs = pairs.map(x=>x[0]);
  const ys = pairs.map(x=>x[1] === "W" ? 1 : 0);
  const mx = xs.reduce((a,b)=>a+b,0)/xs.length;
  const my = ys.reduce((a,b)=>a+b,0)/ys.length;
  let cov=0,vx=0,vy=0;
  for(let i=0;i<xs.length;i++) { const dx=xs[i]-mx, dy=ys[i]-my; cov+=dx*dy; vx+=dx*dx; vy+=dy*dy; }
  if (!vx || !vy) return null;
  return +(cov/Math.sqrt(vx*vy)).toFixed(4);
}
function group(rows: Row[], keyFn: (r: Row)=>string) {
  const m = new Map<string, Row[]>();
  for (const r of rows) {
    const k = keyFn(r) || "(blank)";
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  }
  return Object.fromEntries([...m.entries()].sort((a,b)=>b[1].length-a[1].length).map(([k,v])=>[k, stats(v)]));
}
function cutoffTable(rows: Row[]) {
  const thresholds = [0,40,45,50,55,60,62.5,65,67.5,70,72.5,75,77.5,80,82.5,85];
  return thresholds.map(t => {
    const kept = rows.filter(r => (num(r["Role Confidence"]) ?? -Infinity) >= t && resultCode(r.Result));
    const removed = rows.filter(r => (num(r["Role Confidence"]) ?? -Infinity) < t && resultCode(r.Result));
    return { minRoleConfidence: t, kept: stats(kept), removed: stats(removed) };
  });
}
function bands(rows: Row[]) {
  const defs: Array<[string, number, number]> = [
    ["<50", -Infinity, 50], ["50-54.9",50,55], ["55-59.9",55,60], ["60-64.9",60,65],
    ["65-69.9",65,70], ["70-74.9",70,75], ["75-79.9",75,80], ["80+",80,Infinity],
  ];
  return defs.map(([label,lo,hi]) => ({ label, ...stats(rows.filter(r => { const x=num(r["Role Confidence"]); return x!=null && x>=lo && x<hi; })) }));
}

export async function GET() {
  const tracker = await readSportWorksheet("NFL", "prop_tracker");
  const completed = tracker.filter(r => resultCode(r.Result));
  const withRc = completed.filter(r => num(r["Role Confidence"]) != null);
  const winners = withRc.filter(r => resultCode(r.Result) === "W");
  const losers = withRc.filter(r => resultCode(r.Result) === "L");

  const markets = [...new Set(withRc.map(r => String(r.Market ?? "").trim()).filter(Boolean))].sort();
  const marketCutoffs = Object.fromEntries(markets.map(m => [m, cutoffTable(withRc.filter(r => String(r.Market ?? "").trim() === m))]));
  const marketBands = Object.fromEntries(markets.map(m => [m, bands(withRc.filter(r => String(r.Market ?? "").trim() === m))]));

  const marketSideKeys = [...new Set(withRc.map(r => `${String(r.Market ?? "").trim()}|${side(r)}`))].sort();
  const marketSide = Object.fromEntries(marketSideKeys.map(k => {
    const [m,s] = k.split("|");
    const rows = withRc.filter(r => String(r.Market ?? "").trim() === m && side(r) === s);
    return [k, { overall: stats(rows), cutoffs: cutoffTable(rows), bands: bands(rows), correlation: pearsonRoleVsWin(rows) }];
  }));

  return NextResponse.json({
    ok: true,
    source: "NFL prop_tracker",
    totals: { trackerRows: tracker.length, completedRows: completed.length, completedWithRoleConfidence: withRc.length },
    overall: stats(withRc),
    winners: stats(winners),
    losers: stats(losers),
    roleConfidenceWinCorrelation: pearsonRoleVsWin(withRc),
    cutoffs: cutoffTable(withRc),
    bands: bands(withRc),
    byMarket: group(withRc, r => String(r.Market ?? "").trim()),
    byMarketSide: group(withRc, r => `${String(r.Market ?? "").trim()} | ${side(r)}`),
    byPosition: group(withRc, r => String(r.Position ?? "").trim()),
    byGrade: group(withRc, r => String(r.Grade ?? "").trim()),
    byModelVersion: group(withRc, r => String(r["Model Version"] ?? "").trim()),
    marketCutoffs,
    marketBands,
    marketSide,
    rows: withRc.map(r => ({
      date: r.Date, player: r.Player, position: r.Position, slot: r.Slot, market: r.Market,
      pick: r.Pick, pickOdds: r["Pick Odds"], grade: r.Grade, result: r.Result,
      roleConfidence: r["Role Confidence"], reliability: r.Reliability,
      probabilityEdge: r["Probability Edge"], projectionEdge: r["Projection Edge"],
      modelVersion: r["Model Version"], opportunityError: r["Opportunity Error"], efficiencyError: r["Efficiency Error"],
    })),
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
