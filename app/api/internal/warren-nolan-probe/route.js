import { NextResponse } from "next/server";
export const dynamic="force-dynamic";export const revalidate=0;
export async function GET(){const u="https://www.warrennolan.com/fbs/2025/elo";const r=await fetch(u,{headers:{"user-agent":"Mozilla/5.0"},cache:"no-store"});const t=await r.text();return NextResponse.json({status:r.status,len:t.length,sample:t.slice(0,12000)});}
