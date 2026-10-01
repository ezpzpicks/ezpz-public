import { NextResponse } from "next/server";
import { readSportWorksheet } from "../../../../lib/sportSheets";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Row = Record<string, string>;
type Base = {
  date: string; player: string; market: "Targets" | "Receptions"; line: number;
  projection: number; actual: number; targets: number; routes: number; tprr: number;
  routePart: number; role: number; actualTargets: number | null;
  recvTargets: number; recvRoutes: number; recvTprr: number; recvRoutePart: number; recvRole: number;
};

const text = (v: unknown) => String(v ?? "").trim();
const num = (v: unknown) => { const n = Number(text(v)); return Number.isFinite(n) ? n : null; };
const round = (v: number | null, d = 2) => v == null ? null : Number(v.toFixed(d));
const mean = (a: number[]) => a.length ? a.reduce((s,x)=>s+x,0)/a.length : null;
const key = (r: Row, market?: string) => `${text(r.Date)}|${text(r.Player)}|${market ?? text(r.Market)}`;
const roleMaybe = (s: unknown) => { const m = text(s).match(/live role(?:\/injury)? overlay\s+([0-9.]+)x/i); return m ? Number(m[1]) : null; };

function betResult(r: Base, p: number) {
  if (r.line <= 0) return "NA";
  if (r.actual === r.line) return "P";
  return p >= r.line ? (r.actual > r.line ? "W" : "L") : (r.actual < r.line ? "W" : "L");
}

function reconcile(targets:number, routes:number, tprr:number, routePart:number, role:number) {
  if (!(targets > 0 && routes > 0 && tprr > 0)) return targets;
  const routeTargets = routes * tprr;
  if (routeTargets < targets) return Math.max(routeTargets, targets - 1.0);
  const ratio = routeTargets / Math.max(targets, 0.01);
  const archetype = ratio >= 1.15 && routePart >= 0.45 && tprr >= 0.20 && role < 0.85;
  return archetype ? Math.min(routeTargets, targets + 1.5) : targets;
}

function ownHybridTarget(r: Base) {
  return reconcile(r.targets, r.routes, r.tprr, r.routePart, r.role);
}
function recvHybridTarget(r: Base) {
  return reconcile(r.recvTargets, r.recvRoutes, r.recvTprr, r.recvRoutePart, r.recvRole);
}
function recvFactor(r: Base) {
  return r.recvTargets > 0 ? recvHybridTarget(r) / r.recvTargets : 1;
}
function recvAnchoredProjection(r: Base) {
  return Math.max(0, r.projection * recvFactor(r));
}

function summarize(rows: Base[], fn: (r: Base)=>number) {
  const ae:number[]=[]; let w=0,l=0,p=0;
  for (const r of rows) {
    const pr = Math.max(0, fn(r));
    ae.push(Math.abs(r.actual - pr));
    const z = betResult(r, pr); if(z==="W")w++; else if(z==="L")l++; else if(z==="P")p++;
  }
  return {n:rows.length, mae:round(mean(ae)), marketN:w+l+p, record:`${w}-${l}-${p}`, winPct:w+l?round(100*w/(w+l),1):null};
}

function actualCatchPrior(rows: Base[]) {
  let rec = 0, tar = 0;
  for (const r of rows) if (r.market === "Receptions" && r.actualTargets != null && r.actualTargets > 0) { rec += r.actual; tar += r.actualTargets; }
  return tar > 0 ? rec/tar : 0.75;
}

function receptionWithCatchShrink(r: Base, weight: number, prior: number) {
  const base = recvAnchoredProjection(r);
  const currentRate = r.targets > 0 ? r.projection / r.targets : prior;
  const shrunkRate = (1-weight)*currentRate + weight*prior;
  const countTargetAfterFactor = r.targets * recvFactor(r);
  return Math.max(0, countTargetAfterFactor * shrunkRate);
}

export async function GET() {
  const [cal, proj] = await Promise.all([
    readSportWorksheet("NFL", "prop_calibration") as Promise<Row[]>,
    readSportWorksheet("NFL", "prop_projections") as Promise<Row[]>,
  ]);

  const projMap = new Map<string, Row>();
  const recvMap = new Map<string, Row>();
  for (const p of proj) {
    if (text(p.Position) !== "RB") continue;
    projMap.set(key(p), p);
    if (text(p.Market) === "Receiving Yards") recvMap.set(`${text(p.Date)}|${text(p.Player)}`, p);
  }

  const targetActual = new Map<string, number>();
  for (const c of cal) {
    if (text(c.Position) !== "RB" || text(c.Market) !== "Targets") continue;
    const a = num(c["Actual Result"]); if (a != null) targetActual.set(`${text(c.Date)}|${text(c.Player)}`, a);
  }

  const rows: Base[] = [];
  const seen = new Set<string>();
  for (const c of cal) {
    const market = text(c.Market);
    if (text(c.Position) !== "RB" || (market !== "Targets" && market !== "Receptions")) continue;
    const projection = num(c.Projection), actual = num(c["Actual Result"]), line = num(c["Market Line"]) ?? 0;
    if (projection == null || actual == null) continue;
    const p = projMap.get(key(c)) || {};
    const recv = recvMap.get(`${text(c.Date)}|${text(c.Player)}`) || {};

    const targets = num(p["Projected Targets"]) ?? (market === "Targets" ? projection : num(recv["Projected Targets"]));
    const routes = num(p["Projected Routes"]) ?? num(recv["Projected Routes"]);
    const tprr = num(p["Targets Per Route"]) ?? num(recv["Targets Per Route"]);
    const routePart = num(p["Route Participation"]) ?? num(recv["Route Participation"]);
    const recvTargets = num(recv["Projected Targets"]), recvRoutes = num(recv["Projected Routes"]), recvTprr = num(recv["Targets Per Route"]), recvRoutePart = num(recv["Route Participation"]);
    if (targets == null || targets <= 0 || routes == null || tprr == null || routePart == null || recvTargets == null || recvTargets <= 0 || recvRoutes == null || recvTprr == null || recvRoutePart == null) continue;

    const d = `${key(c)}|${projection}`; if (seen.has(d)) continue; seen.add(d);
    const actualTargets = market === "Targets" ? actual : (num(c["Actual Opportunity"]) ?? targetActual.get(`${text(c.Date)}|${text(c.Player)}`) ?? null);
    const recvRole = roleMaybe(recv.Confluence) ?? 1;
    const ownRole = roleMaybe(p.Confluence) ?? recvRole;
    rows.push({
      date:text(c.Date), player:text(c.Player), market:market as "Targets"|"Receptions", line, projection, actual,
      targets, routes, tprr, routePart, role:ownRole, actualTargets,
      recvTargets, recvRoutes, recvTprr, recvRoutePart, recvRole,
    });
  }

  rows.sort((a,b)=>a.date.localeCompare(b.date)||a.player.localeCompare(b.player)||a.market.localeCompare(b.market));
  const pre = rows.filter(r=>r.date < "2026-09-27"), hold = rows.filter(r=>r.date === "2026-09-27");
  const split = (x:Base[],m:Base["market"])=>x.filter(r=>r.market===m);
  const tPre=split(pre,"Targets"), tHold=split(hold,"Targets"), tAll=split(rows,"Targets");
  const rPre=split(pre,"Receptions"), rHold=split(hold,"Receptions"), rAll=split(rows,"Receptions");
  const prior = actualCatchPrior(rPre);
  const weights=[0,0.25,0.5,0.75,1];
  const catchGrid=weights.map(w=>({weight:w,train:summarize(rPre,r=>receptionWithCatchShrink(r,w,prior)),holdout:summarize(rHold,r=>receptionWithCatchShrink(r,w,prior)),all:summarize(rAll,r=>receptionWithCatchShrink(r,w,prior))}));
  const bestCatch=[...catchGrid].sort((a,b)=>(a.train.mae??999)-(b.train.mae??999))[0];
  const affectedOwn=(x:Base[])=>x.filter(r=>Math.abs(ownHybridTarget(r)-r.targets)>1e-9).length;
  const affectedRecv=(x:Base[])=>x.filter(r=>Math.abs(recvFactor(r)-1)>1e-9).length;

  const gibbs=rows.filter(r=>/jahmyr\s+gibbs/i.test(r.player)).map(r=>({
    date:r.date, market:r.market, line:r.line, current:r.projection, actual:r.actual,
    countTargets:round(r.targets), countRouteTargets:round(r.routes*r.tprr), ownHybridTargets:round(ownHybridTarget(r)),
    recvTargets:round(r.recvTargets), recvRouteTargets:round(r.recvRoutes*r.recvTprr), recvHybridTargets:round(recvHybridTarget(r)),
    recvRole:round(r.recvRole,2), recvFactor:round(recvFactor(r),3), recvAnchoredProjection:round(recvAnchoredProjection(r)),
    bestCatchProjection:r.market==="Receptions"?round(receptionWithCatchShrink(r,bestCatch.weight,prior)):null,
  }));

  return NextResponse.json({
    counts:{all:rows.length,pre:pre.length,holdout:hold.length,targets:tAll.length,receptions:rAll.length},
    targets:{
      current:{pre:summarize(tPre,r=>r.projection),holdout:summarize(tHold,r=>r.projection),all:summarize(tAll,r=>r.projection)},
      ownRowHybrid:{affectedPre:affectedOwn(tPre),affectedHoldout:affectedOwn(tHold),pre:summarize(tPre,r=>ownHybridTarget(r)),holdout:summarize(tHold,r=>ownHybridTarget(r)),all:summarize(tAll,r=>ownHybridTarget(r))},
      receivingFactorHybrid:{affectedPre:affectedRecv(tPre),affectedHoldout:affectedRecv(tHold),pre:summarize(tPre,r=>recvAnchoredProjection(r)),holdout:summarize(tHold,r=>recvAnchoredProjection(r)),all:summarize(tAll,r=>recvAnchoredProjection(r))},
    },
    receptions:{
      empiricalCatchRatePrior:round(prior,4),
      current:{pre:summarize(rPre,r=>r.projection),holdout:summarize(rHold,r=>r.projection),all:summarize(rAll,r=>r.projection)},
      receivingFactorHybrid:{affectedPre:affectedRecv(rPre),affectedHoldout:affectedRecv(rHold),pre:summarize(rPre,r=>recvAnchoredProjection(r)),holdout:summarize(rHold,r=>recvAnchoredProjection(r)),all:summarize(rAll,r=>recvAnchoredProjection(r))},
      catchRateGrid:catchGrid,
      selectedOnTrain:bestCatch,
    },
    gibbs,
  });
}
