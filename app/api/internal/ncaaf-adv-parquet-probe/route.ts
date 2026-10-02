import { NextResponse } from "next/server";
import { parquetReadObjects } from "hyparquet";
export const dynamic="force-dynamic";export const revalidate=0;export const maxDuration=60;
export async function GET(){const url="https://raw.githubusercontent.com/sportsdataverse/cfbfastR-cfb-data/main/cfb/adv_team/parquet/adv_team_2025.parquet";const res=await fetch(url,{cache:"force-cache"});if(!res.ok)throw new Error(`fetch ${res.status}`);const buf=await res.arrayBuffer();const rows=await parquetReadObjects({file:buf});const first=(rows[0]??{}) as Record<string,unknown>;return NextResponse.json({bytes:buf.byteLength,rows:rows.length,keys:Object.keys(first),sample:rows.slice(0,3)});}
