import { NextResponse } from "next/server";
import { readSportWorksheet } from "../../../../lib/sportSheets";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Row = Record<string, string>;
type Base = {
  date: string; player: string; market: "Targets" | "Receptions"; line: number;
  projection: number; actual: number; targets: number; routes: number; tprr: number;
  routePart: number; role: number; actualTargets: number | null;
};

const text = (v: unknown) => String(v ?? "").trim();
const num = (v: unknown) => { const n = Number(text(v)); return Number.isFinite(n) ? n : null; };
const round = (v: number | null, d = 2) => v == null ? null : Number(v.toFixed(d));
const mean = (a: number[]) => a.length ? a.reduce((s,x)=>s+x,0)/a.length : null;
const key = (r: Row, market?: string) => `${text(r.Date)}|${text(r.Player)}|${market ?? text(r.Market)}`;
const role = (s: unknown) => { const m = text(s).match(/live role(?:\/injury)? overlay\s+([0-9.]+)x/i); return m ? Number(m[1]) : 1; };

function betResult(r: Base, p: number) {
  if (r.line <= 0) return "NA";
  if (r.actual === r.line) return "P";
  return p >= r.line ? (r.actual > r.line ? "W" : "L") : (r.actual < r.line ? "W" : "L");
}

function hybridTarget(r: Base) {
  if (!(r.targets > 0 && r.routes > 0 && r.tprr > 0)) return r.targets;
  const routeTargets = r.routes * r.tprr;
  if (routeTargets < r.targets) return Math.max(routeTargets, r.targets - 1.0);
  const ratio = routeTargets / Math.max(r.targets, 0.01);
  const archetype = ratio >= 1.15 && r.routePart >= 0.45 && r.tprr >= 0.20 && r.role < 0.85;
  return archetype ? Math.min(routeTargets, r.targets + 1.5) : r.targets;
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

function receptionProjection(r: Base, weight: number, prior: number, useHybrid: boolean) {
  const target = useHybrid ? hybridTarget(r) : r.targets;
  const currentRate = r.targets > 0 ? r.projection / r.targets : prior;
  const rate = (1-weight)*currentRate + weight*prior;
  return Math.max(0, target * rate);
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
    if (targets == null || targets <= 0 || routes == null || tprr == null || routePart == null) continue;
    const d = `${key(c)}|${projection}`; if (seen.has(d)) continue; seen.add(d);
    const actualTargets = market === "Targets" ? actual : (num(c["Actual Opportunity"]) ?? targetActual.get(`${text(c.Date)}|${text(c.Player)}`) ?? null);
    rows.push({date:text(c.Date), player:text(c.Player), market:market as "Targets"|"Receptions", line, projection, actual, targets, routes, tprr, routePart, role:role(p.Confluence || recv.Confluence), actualTargets});
  }
  rows.sort((a,b)=>a.date.localeCompare(b.date)||a.player.localeCompare(b.player)||a.market.localeCompare(b.market));
  const pre = rows.filter(r=>r.date < "2026-09-27"), hold = rows.filter(r=>r.date === "2026-09-27");
  const split = (x:Base[],m:Base["market"])=>x.filter(r=>r.market===m);
  const tPre=split(pre,"Targets"), tHold=split(hold,"Targets"), tAll=split(rows,"Targets");
  const rPre=split(pre,"Receptions"), rHold=split(hold,"Receptions"), rAll=split(rows,"Receptions");
  const prior = actualCatchPrior(rPre);
  const weights=[0,0.25,0.5,0.75,1];
  const grid=weights.map(w=>({weight:w,train:summarize(rPre,r=>receptionProjection(r,w,prior,true)),holdout:summarize(rHold,r=>receptionProjection(r,w,prior,true)),all:summarize(rAll,r=>receptionProjection(r,w,prior,true))}));
  const best=[...grid].sort((a,b)=>(a.train.mae??999)-(b.train.mae??999))[0];
  const affected=(x:Base[])=>x.filter(r=>Math.abs(hybridTarget(r)-r.targets)>1e-9).length;
  const samples=rows.filter(r=>/jahmyr\s+gibbs/i.test(r.player)).map(r=>({date:r.date,market:r.market,line:r.line,current:r.projection,actual:r.actual,currentTargets:round(r.targets),routeTargets:round(r.routes*r.tprr),hybridTargets:round(hybridTarget(r)),routePart:round(r.routePart,3),tprr:round(r.tprr,3),role:round(r.role,2),targetOnlyProjection:round(r.market==="Targets"?hybridTarget(r):receptionProjection(r,0,prior,true)),bestReceptionProjection:r.market==="Receptions"?round(receptionProjection(r,best.weight,prior,true)):null}));

  return NextResponse.json({
    counts:{all:rows.length,pre:pre.length,holdout:hold.length,targets:tAll.length,receptions:rAll.length},
    targets:{
      current:{pre:summarize(tPre,r=>r.projection),holdout:summarize(tHold,r=>r.projection),all:summarize(tAll,r=>r.projection)},
      hybrid:{affectedPre:affected(tPre),affectedHoldout:affected(tHold),pre:summarize(tPre,r=>hybridTarget(r)),holdout:summarize(tHold,r=>hybridTarget(r)),all:summarize(tAll,r=>hybridTarget(r))}
    },
    receptions:{
      empiricalCatchRatePrior:round(prior,4),
      current:{pre:summarize(rPre,r=>r.projection),holdout:summarize(rHold,r=>r.projection),all:summarize(rAll,r=>r.projection)},
      targetHybridOnly:{affectedPre:affected(rPre),affectedHoldout:affected(rHold),pre:summarize(rPre,r=>receptionProjection(r,0,prior,true)),holdout:summarize(rHold,r=>receptionProjection(r,0,prior,true)),all:summarize(rAll,r=>receptionProjection(r,0,prior,true))},
      catchRateGrid:grid,
      selectedOnTrain:best
    },
    gibbs:samples
  });
}
