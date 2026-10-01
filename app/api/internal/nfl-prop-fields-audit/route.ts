import { NextResponse } from "next/server";
import { readSportWorksheet } from "../../../../lib/sportSheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Row = Record<string, string>;

export async function GET() {
  const rows = (await readSportWorksheet("NFL", "prop_projections")) as Row[];
  const cur = rows.filter(r => String(r["Model Version"] || "").includes("v4.18"));
  const keys = Array.from(new Set(cur.flatMap(r => Object.keys(r)))).sort();
  const wanted = ["Braelon Allen","Jahmyr Gibbs","Rashid Shaheed","Xavier Hutchinson","Ashton Jeanty","Kenneth Walker III","David Montgomery","Quinshon Judkins"];
  const sample = cur.filter(r => wanted.includes(String(r.Player || r["Player Name"] || ""))).slice(0,50);
  return NextResponse.json({ok:true,total:rows.length,current:cur.length,keys,sample},{headers:{"Cache-Control":"no-store,max-age=0"}});
}
