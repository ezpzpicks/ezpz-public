import { NextResponse } from "next/server";
import { readSportWorksheet } from "../../../lib/sportSheets";
export const runtime="nodejs"; export const dynamic="force-dynamic"; export const revalidate=0;
function n(v:any){const x=Number(v);return Number.isFinite(x)?x:0}
export async function GET(){
 const rows=await readSportWorksheet("NFL","prop_projections");
 const atd=rows.filter((r:any)=>String(r.Date||"")==="2026-09-20"&&String(r.Market||"")==="Anytime TD");
 const teams:any={};
 for(const r of atd){
   const team=String(r.Team||"");
   if(!teams[team]) teams[team]={team,lambdaSum:0,probSum:0,count:0,players:[],expectedTeamTds:null};
   const lam=n(r.Projection), prob=n(r["Model Probability"]);
   teams[team].lambdaSum+=lam; teams[team].probSum+=prob; teams[team].count++;
   const m=String(r.Confluence||"").match(/Projected\s+([0-9.]+)\s+team TDs/i);
   if(m) teams[team].expectedTeamTds=Number(m[1]);
   teams[team].players.push({player:r.Player,slot:r.Slot,lambda:lam,prob,role:n(r["Role Confidence"]),reliability:n(r.Reliability),odds:r["Over Odds"],edge:r["Probability Edge"],confluence:r.Confluence});
 }
 return NextResponse.json({ok:true,teams:Object.values(teams).map((x:any)=>({...x,lambdaSum:+x.lambdaSum.toFixed(3),probSum:+x.probSum.toFixed(3),ratio:x.expectedTeamTds?+(x.lambdaSum/x.expectedTeamTds).toFixed(3):null}))},{headers:{"Cache-Control":"no-store,max-age=0"}});
}