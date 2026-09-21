import { NextRequest, NextResponse } from "next/server";

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
    const snippets = (needle: string) => {
      const lower = html.toLowerCase();
      const target = needle.toLowerCase();
      const found: string[] = [];
      let from = 0;
      while (found.length < 4) {
        const index = lower.indexOf(target, from);
        if (index < 0) break;
        found.push(
          html.slice(Math.max(0, index - 140), Math.min(html.length, index + target.length + 220))
            .replace(/\s+/g, " "),
        );
        from = index + target.length;
      }
      return found;
    };
    return {
      name,
      url: url.toString(),
      status: response.status,
      bytes: html.length,
      contentType: response.headers.get("content-type"),
      hasUnable: /Unable to fetch data from server/i.test(html),
      hasColtsChiefs: /IND Colts @ KC Chiefs/i.test(html),
      hasGiantsRams: /NY Giants @ LA Rams/i.test(html),
      chiefsSnippets: snippets("Chiefs"),
      ramsSnippets: snippets("Rams"),
      filterSnippets: snippets("tb_eg"),
      upstreamUrl: response.url,
      responseDate: response.headers.get("date"),
      filterSelects: html.match(/<select\b[\s\S]*?<\/select>/gi),
      tableMarkup: html.match(/<table\b[\s\S]*?<\/table>/gi),
      tableSection: html.slice(html.indexOf('tb-tfilter'), html.indexOf('tb-tfilter') + 18000),
      scriptUrls: [...html.matchAll(/<script\b[^>]*src=["']([^"']+)["']/gi)].map(match => match[1]),
      title: (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim(),
    };
  } catch (error) {
    return { name, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function GET(request: NextRequest) {
  const sport = request.nextUrl.searchParams.get("sport") === "NCAAF" ? "NCAA Football" : "NFL";
  const dateRange = request.nextUrl.searchParams.get("range") === "n30days" ? "n30days" : "n7days";
  const common = { itm_content: sport, tb_eg: sport, tb_edate: dateRange };
  const results = [];
  results.push(await probe("direct-first", { ...common, tb_page: "1" }));
  results.push(await probe("league-only", { tb_eg: sport, tb_edate: dateRange }));
  results.push(await probe("all-first", { ...common, tb_emt: "0" }));
  results.push(await probe("spread-first", { ...common, tb_emt: "Spread" }));
  results.push(await probe("total-first", { ...common, tb_emt: "Total" }));
  results.push(await probe("all-page2", { ...common, tb_emt: "0", tb_page: "2" }));
  results.push(await probe("spread-page2", { ...common, tb_emt: "Spread", tb_page: "2" }));
  return NextResponse.json({ ok: true, results }, { headers: { "Cache-Control": "no-store" } });
}
