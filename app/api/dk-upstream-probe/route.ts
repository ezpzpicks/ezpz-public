import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const BASE = "https://dknetwork.draftkings.com/draftkings-sportsbook-betting-splits/";

async function probe(name: string, params: Record<string, string>) {
  const url = new URL(BASE);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; EZPZ-Picks/1.0; +https://ezpzpicks.com)",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(12000),
    });
    const html = await response.text();
    const normalized = html.replace(/&amp;/g, "&").replace(/\s+/g, " ");
    const games = [...normalized.matchAll(/>([^<>]{2,80}\s@\s[^<>]{2,80})<\/g)]
      .slice(0, 30)
      .map((match) => match[1].trim());
    return {
      name,
      url: url.toString(),
      status: response.status,
      bytes: html.length,
      contentType: response.headers.get("content-type"),
      hasUnable: /Unable to fetch data from server/i.test(html),
      hasColtsChiefs: /IND Colts @ KC Chiefs/i.test(html),
      hasGiantsRams: /NY Giants @ LA Rams/i.test(html),
      gameMatches: games,
      title: (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim(),
    };
  } catch (error) {
    return { name, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function GET() {
  const common = { itm_content: "NFL", tb_eg: "NFL", tb_edate: "n30days" };
  const results = [];
  results.push(await probe("root", {}));
  results.push(await probe("all-first", { ...common, tb_emt: "0" }));
  results.push(await probe("spread-first", { ...common, tb_emt: "Spread" }));
  results.push(await probe("total-first", { ...common, tb_emt: "Total" }));
  results.push(await probe("all-page2", { ...common, tb_emt: "0", tb_page: "2" }));
  results.push(await probe("spread-page2", { ...common, tb_emt: "Spread", tb_page: "2" }));
  return NextResponse.json({ ok: true, results }, { headers: { "Cache-Control": "no-store" } });
}
