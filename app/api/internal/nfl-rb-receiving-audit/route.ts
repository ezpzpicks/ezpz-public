import { NextResponse } from "next/server";
import { readSportWorksheet } from "../../../../lib/sportSheets";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Row = Record<string, string>;
type AuditRow = {
  date: string; player: string; slot: string; line: number; projection: number; actual: number;
  result: string; grade: string; probabilityEdgePct: number | null; projectionGapPct: number;
  projectedTargets: number | null; actualTargets: number | null; projectedReceptions: number | null;
  actualReceptions: number | null; projectedEfficiency: number | null; actualEfficiency: number | null;
  targetError: number | null; efficiencyError: number | null; residual: number; matchupIndex: number | null;
  roleOverlay: number | null; slotAdjustmentPct: number | null; modelVersion: string; confluence: string;
};

const RB_YPT_PRIOR = 6.15;
const text = (v: unknown) => String(v ?? "").trim();
const num = (v: unknown) => { const n = Number(text(v)); return Number.isFinite(n) ? n : null; };
const mean = (a: number[]) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const med = (a: number[]) => { if (!a.length) return null; const z=[...a].sort((x,y)=>x-y),m=Math.floor(z.length/2); return z.length%2?z[m]:(z[m-1]+z[m])/2; };
const round = (v: number | null, d=2) => v == null ? null : Number(v.toFixed(d));
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const key = (r: Row, withLine = false) => `${text(r.Date)}|${text(r.Player)}|${text(r.Market)}${withLine ? `|${text(r["Market Line"])}` : ""}`;

function roleOverlay(value: unknown) {
  const m = text(value).match(/live role(?:\/injury)? overlay\s+([0-9.]+)x/i);
  return m ? Number(m[1]) : null;
}
function slotAdjustment(value: unknown) {
  const m = text(value).match(/slot matchup[\s\S]*?applied\s+([+-]?[0-9.]+)%/i);
  return m ? Number(m[1]) : null;
}
function probabilityEdgePct(row: Row) {
  const raw = num(row["Probability Edge"] ?? row.Edge); if (raw == null) return null;
  return Math.abs(raw) <= 1 ? raw * 100 : raw;
}
function group(rows: AuditRow[]) {
  const ae=rows.map(r=>Math.abs(r.residual));
  const targetErr=rows.map(r=>r.targetError).filter((v):v is number=>v!=null);
  const effErr=rows.map(r=>r.efficiencyError).filter((v):v is number=>v!=null);
  const role=rows.map(r=>r.roleOverlay).filter((v):v is number=>v!=null);
  const matchup=rows.map(r=>r.matchupIndex).filter((v):v is number=>v!=null);
  const gap=rows.map(r=>r.projectionGapPct), prob=rows.map(r=>r.probabilityEdgePct).filter((v):v is number=>v!=null);
  return {n:rows.length,mae:round(mean(ae)),medianAE:round(med(ae)),bias:round(mean(rows.map(r=>r.residual))),avgTargetError:round(mean(targetErr)),avgEfficiencyError:round(mean(effErr)),avgRoleOverlay:round(mean(role),3),avgMatchupIndex:round(mean(matchup),3),avgProjectionGapPct:round(mean(gap),1),avgProbabilityEdgePct:round(mean(prob),1)};
}
function resultForProjection(r: AuditRow, projection: number) {
  if (r.actual === r.line) return "P";
  if (projection >= r.line) return r.actual > r.line ? "W" : "L";
  return r.actual < r.line ? "W" : "L";
}
function candidateSummary(rows: AuditRow[], fn: (r: AuditRow) => number) {
  let w=0,l=0,p=0; const absErr:number[]=[], residuals:number[]=[], projections:number[]=[];
  for (const r of rows) {
    const projection=Math.max(0,fn(r)); projections.push(projection);
    absErr.push(Math.abs(r.actual-projection)); residuals.push(r.actual-projection);
    const res=resultForProjection(r,projection); if(res==="W")w++; else if(res==="L")l++; else p++;
  }
  return {n:rows.length,mae:round(mean(absErr)),medianAE:round(med(absErr)),bias:round(mean(residuals)),avgProjection:round(mean(projections)),record:`${w}-${l}-${p}`,winPct:w+l?round(100*w/(w+l),1):null};
}
function candidates(rows: AuditRow[]) {
  const current=(r:AuditRow)=>r.projection;
  const role=(r:AuditRow)=>r.roleOverlay && r.roleOverlay>0 ? r.roleOverlay : 1;
  const match=(r:AuditRow)=>r.matchupIndex && r.matchupIndex>0 ? r.matchupIndex : 1;
  const targets=(r:AuditRow)=>r.projectedTargets ?? (r.projectedEfficiency && r.projectedEfficiency>0 ? r.projection/r.projectedEfficiency : 0);
  const eff=(r:AuditRow)=>r.projectedEfficiency ?? (targets(r)>0 ? r.projection/targets(r) : 0);
  const shrunkEff=(r:AuditRow,w:number)=>(1-w)*eff(r)+w*RB_YPT_PRIOR;
  const out:Record<string,ReturnType<typeof candidateSummary>>={};
  const defs:Record<string,(r:AuditRow)=>number>={
    current, market:r=>r.line,
    noRole:r=>r.projection/role(r),
    halfRole:r=>r.projection/role(r)*(1+0.5*(role(r)-1)),
    capRole10:r=>r.projection/role(r)*clamp(role(r),0.90,1.10),
    noMatchup:r=>r.projection/match(r),
    halfMatchup:r=>r.projection/match(r)*(1+0.5*(match(r)-1)),
    capMatchup10:r=>r.projection/match(r)*clamp(match(r),0.90,1.10),
    noRoleNoMatchup:r=>r.projection/(role(r)*match(r)),
    halfRoleHalfMatchup:r=>r.projection/(role(r)*match(r))*(1+0.5*(role(r)-1))*(1+0.5*(match(r)-1)),
    targetPlus1:r=>r.projection+eff(r), targetPlus2:r=>r.projection+2*eff(r), targetPlus3:r=>r.projection+3*eff(r),
    target125:r=>r.projection*1.25, target140:r=>r.projection*1.40,
    yptPrior50:r=>targets(r)*shrunkEff(r,0.50), yptPrior80:r=>targets(r)*shrunkEff(r,0.80),
    noRoleYptPrior80:r=>(targets(r)/role(r))*shrunkEff(r,0.80),
    targetPlus2YptPrior80:r=>(targets(r)+2)*shrunkEff(r,0.80),
  };
  for(const [name,fn] of Object.entries(defs)) out[name]=candidateSummary(rows,fn);
  return out;
}
function trackerAudit(r: Row): AuditRow | null {
  if(text(r.Market)!=="Receiving Yards"||text(r.Position)!=="RB")return null;
  const line=num(r["Market Line"]),projection=num(r.Projection),actual=num(r["Actual Result"]); if(line==null||line<=0||projection==null||actual==null)return null;
  const projectedTargets=num(r["Projected Targets"]),actualTargets=num(r["Actual Targets"]),projectedReceptions=num(r["Projected Receptions"]),actualReceptions=num(r["Actual Receptions"]),projectedEfficiency=num(r.Efficiency);
  const actualEfficiency=actualTargets!=null&&actualTargets>0?actual/actualTargets:null;
  const projectionEdgeRaw=num(r["Projection Edge"]),projectionGap=projectionEdgeRaw!=null?Math.abs(projectionEdgeRaw):Math.abs(projection-line);
  return {date:text(r.Date),player:text(r.Player),slot:text(r.Slot),line,projection,actual,result:"",grade:text(r.Grade),probabilityEdgePct:probabilityEdgePct(r),projectionGapPct:100*projectionGap/line,projectedTargets,actualTargets,projectedReceptions,actualReceptions,projectedEfficiency,actualEfficiency,targetError:projectedTargets!=null&&actualTargets!=null?actualTargets-projectedTargets:null,efficiencyError:projectedEfficiency!=null&&actualEfficiency!=null?actualEfficiency-projectedEfficiency:null,residual:actual-projection,matchupIndex:num(r["Matchup Index"]),roleOverlay:roleOverlay(r.Confluence),slotAdjustmentPct:slotAdjustment(r.Confluence),modelVersion:text(r["Model Version"]),confluence:text(r.Confluence)};
}
function calibrationAudit(r: Row, enriched: Row | undefined): AuditRow | null {
  if(text(r.Market)!=="Receiving Yards"||text(r.Position)!=="RB")return null;
  const line=num(r["Market Line"]),projection=num(r.Projection),actual=num(r["Actual Result"]); if(line==null||line<=0||projection==null||actual==null)return null;
  const projectedTargets=num(r["Projected Opportunity"]),actualTargets=num(r["Actual Opportunity"]),projectedEfficiency=num(r["Projected Efficiency"]),actualEfficiency=num(r["Actual Efficiency"]);
  const projectionGap=Math.abs(projection-line), source=enriched || {};
  return {date:text(r.Date),player:text(r.Player),slot:text(source.Slot),line,projection,actual,result:"",grade:text(source.Grade),probabilityEdgePct:probabilityEdgePct(source),projectionGapPct:100*projectionGap/line,projectedTargets,actualTargets,projectedReceptions:num(source["Projected Receptions"]),actualReceptions:null,projectedEfficiency,actualEfficiency,targetError:projectedTargets!=null&&actualTargets!=null?actualTargets-projectedTargets:null,efficiencyError:projectedEfficiency!=null&&actualEfficiency!=null?actualEfficiency-projectedEfficiency:null,residual:actual-projection,matchupIndex:num(source["Matchup Index"]),roleOverlay:roleOverlay(source.Confluence),slotAdjustmentPct:slotAdjustment(source.Confluence),modelVersion:text(r["Model Version"]||source["Model Version"]),confluence:text(source.Confluence)};
}

export async function GET() {
  const [tracker, calibration, projections]=await Promise.all([
    readSportWorksheet("NFL","prop_tracker") as Promise<Row[]>,
    readSportWorksheet("NFL","prop_calibration") as Promise<Row[]>,
    readSportWorksheet("NFL","prop_projections") as Promise<Row[]>,
  ]);
  const rows=tracker.map(trackerAudit).filter((r):r is AuditRow=>Boolean(r));
  for(const r of rows)r.result=resultForProjection(r,r.projection);
  rows.sort((a,b)=>a.date.localeCompare(b.date)||a.player.localeCompare(b.player));

  const exactMap=new Map<string,Row>(), fallbackMap=new Map<string,Row>();
  for(const p of projections){ if(text(p.Market)!=="Receiving Yards"||text(p.Position)!=="RB")continue; exactMap.set(key(p,true),p); fallbackMap.set(key(p,false),p); }
  const seen=new Set<string>(), completed:AuditRow[]=[];
  for(const c of calibration){
    if(text(c.Market)!=="Receiving Yards"||text(c.Position)!=="RB")continue;
    const dedupe=`${key(c,false)}|${text(c["Market Line"])}|${text(c.Projection)}`; if(seen.has(dedupe))continue; seen.add(dedupe);
    const enriched=exactMap.get(key(c,true))||fallbackMap.get(key(c,false)); const row=calibrationAudit(c,enriched); if(row)completed.push(row);
  }
  for(const r of completed)r.result=resultForProjection(r,r.projection);
  completed.sort((a,b)=>a.date.localeCompare(b.date)||a.player.localeCompare(b.player));

  const wins=rows.filter(r=>r.result==="W"),losses=rows.filter(r=>r.result==="L"),gibbs=rows.filter(r=>/jahmyr\s+gibbs/i.test(r.player));
  const modern=rows.filter(r=>r.date>="2026-09-13"),v418=rows.filter(r=>r.modelVersion.includes("v4.18"));
  const completedEnriched=completed.filter(r=>r.roleOverlay!=null||r.matchupIndex!=null);
  const completedModern=completed.filter(r=>r.date>="2026-09-13");
  const byPlayer=Object.fromEntries([...new Set(rows.map(r=>r.player))].sort().map(player=>{const z=rows.filter(r=>r.player===player);return[player,{...group(z),record:`${z.filter(r=>r.result==="W").length}-${z.filter(r=>r.result==="L").length}-${z.filter(r=>r.result==="P").length}`}]}));
  return NextResponse.json({
    counts:{tracked:rows.length,modernTracked:modern.length,v418Tracked:v418.length,gibbs:gibbs.length,allCompleted:completed.length,enrichedCompleted:completedEnriched.length},
    tracked:{current:{overall:group(rows),wins:group(wins),losses:group(losses)},counterfactuals:{all:candidates(rows),modern:candidates(modern),v418:candidates(v418),gibbs:candidates(gibbs)}},
    allCompleted:{overall:group(completed),modern:group(completedModern),counterfactuals:{all:candidates(completed),modern:candidates(completedModern),enriched:candidates(completedEnriched)}},
    gibbs:{summary:group(gibbs),rows:gibbs},byPlayer,trackedRows:rows,completedRows:completed,
  });
}
