import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const URL_BASE="https://dknetwork.draftkings.com/draftkings-sportsbook-betting-splits/";

function decode(v:string){return v.replace(/&#x([0-9a-f]+);/gi,(_,c)=>String.fromCodePoint(parseInt(c,16))).replace(/&#(\d+);/g,(_,c)=>String.fromCodePoint(Number(c))).replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'");}
function tokens(raw:string){return decode(raw.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi," ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g,"\n")).split(/\r?\n/).map(x=>x.replace(/\s+/g," ").trim()).filter(Boolean);}
async function page(market:string,p:number){
 const u=new URL(URL_BASE); u.searchParams.set("tb_eg","NFL"); u.searchParams.set("tb_edate","n7days"); u.searchParams.set("tb_emt",market); u.searchParams.set("tb_page",String(p));
 const res=await fetch(u,{cache:"no-store",headers:{"User-Agent":"Mozilla/5.0 (compatible; EZPZ-Picks/1.0; +https://ezpzpicks.com)",Accept:"text/html,application/xhtml+xml"},signal:AbortSignal.timeout(15000)});
 const html=await res.text(); const t=tokens(html); const games:any[]=[];
 for(let i=0;i+1<t.length;i++){if(t[i].includes(" @ ")&&/\d{1,2}\/\d{1,2}/.test(t[i+1]||"")) games.push({game:t[i],date:t[i+1]});}
 const dateSelect=(html.match(/<select[^>]+name=["']tb_edate["'][^>]*>[\s\S]*?<\/select>/i)||[""])[0];
 return {market,p,status:res.status,bytes:html.length,games,dateSelect:p===1?dateSelect:""};
}
export async function GET(){
 const out:any[]=[]; for(const m of ["Spread","Total"]){for(let p=1;p<=10;p++){const r=await page(m,p); out.push(r); if(!r.games.length)break;}}
 return NextResponse.json({ok:true,out},{headers:{"Cache-Control":"no-store, max-age=0"}});
}
