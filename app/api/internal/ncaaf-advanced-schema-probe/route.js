import { NextResponse } from "next/server";
import { parquetReadObjects } from "hyparquet";
import { compressors } from "hyparquet-compressors";
export const dynamic="force-dynamic";export const revalidate=0;export const maxDuration=60;
const base="https://raw.githubusercontent.com/sportsdataverse/cfbfastR-cfb-data/main/cfb";
async function one(name){try{const u=`${base}/${name}/parquet/${name}_2025.parquet`,r=await fetch(u,{cache:"force-cache"});if(!r.ok)return{name,status:r.status};const rows=await parquetReadObjects({file:await r.arrayBuffer(),compressors});return{name,status:200,n:rows.length,keys:Object.keys(rows[0]??{})}}catch(e){return{name,error:String(e?.message??e)}}}
export async function GET(){return NextResponse.json(await Promise.all(["adv_situational","adv_drives","adv_drive_scripting","adv_defensive"].map(one)))}
