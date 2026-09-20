import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const DK_URL = "https://dknetwork.draftkings.com/draftkings-sportsbook-betting-splits/";

function decodeHtml(value: string) {
  return value.replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
}

function tokens(raw: string) {
  return decodeHtml(String(raw || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, "\n"))
    .split(/\r?\n/).map((item) => item.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
}

async function probe(label: string, params: Record<string, string>, page: number) {
  const target = new URL(DK_URL);
  Object.entries(params).forEach(([key, value]) => target.searchParams.set(key, value));
  target.searchParams.set("tb_page", String(page));
  const response = await fetch(target, {
    cache: "no-store",
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; EZPZ-Picks/1.0; +https://ezpzpicks.com)",
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(15_000),
  });
  const html = await response.text();
  const input = tokens(html);
  const games: Array<{ game: string; date: string }> = [];
  for (let i = 0; i + 1 < input.length; i += 1) {
    if (input[i].includes(" @ ") && /\d{1,2}\/\d{1,2}/.test(input[i + 1] || "")) {
      games.push({ game: input[i], date: input[i + 1] });
    }
  }
  const selectMatch = html.match(/<select[^>]+(?:name|id)=["'][^"']*(?:tb_eg|event)[^"']*["'][^>]*>[\s\S]*?<\/select>/i);
  return {
    label,
    params,
    page,
    status: response.status,
    bytes: html.length,
    games: games.slice(0, 25),
    gameCount: games.length,
    hasNext: /(?:>\s*Next\s*<|aria-label=["']Next["'])/i.test(html),
    selectSnippet: selectMatch ? selectMatch[0].slice(0, 5000) : "",
  };
}

export async function GET(_request: NextRequest) {
  const variants = [
    { label: "current-84240", params: { tb_eg: "84240", itm_content: "84240", tb_edate: "n7days", tb_emt: "Spread" } },
    { label: "nfl-only-filter", params: { tb_eg: "NFL", tb_edate: "n7days", tb_emt: "Spread" } },
    { label: "nfl-with-84240-content", params: { tb_eg: "NFL", itm_content: "84240", tb_edate: "n7days", tb_emt: "Spread" } },
    { label: "nfl-with-88808-content", params: { tb_eg: "NFL", itm_content: "88808", tb_edate: "n7days", tb_emt: "Spread" } },
    { label: "nfl-no-market-filter", params: { tb_eg: "NFL", tb_edate: "n7days" } },
    { label: "ncaa-only-filter", params: { tb_eg: "NCAA Football", tb_edate: "n7days", tb_emt: "Spread" } },
  ];
  const pages = [1, 2, 5, 10];
  const results = [];
  for (const variant of variants) {
    for (const page of pages) {
      try {
        results.push(await probe(variant.label, variant.params, page));
      } catch (error) {
        results.push({ label: variant.label, params: variant.params, page, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  return NextResponse.json({ ok: true, results }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
