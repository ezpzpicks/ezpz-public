import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const URLS = {
  NFL: "https://www.scoresandodds.com/nfl/consensus-picks",
  NCAAF: "https://www.scoresandodds.com/ncaaf/consensus-picks",
  MLB: "https://www.scoresandodds.com/mlb/consensus-picks",
} as const;

function decodeHtml(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function tokens(raw: string) {
  return decodeHtml(
    raw
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
      .replace(/<[^>]+>/g, "\n"),
  )
    .split(/\r?\n/)
    .map((v) => v.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

async function probe(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(15_000),
  });
  const raw = await response.text();
  const input = tokens(raw);
  const hits = input
    .map((value, index) => ({ value, index }))
    .filter((item) => /% of Bets/i.test(item.value))
    .slice(0, 8)
    .map((item) => ({
      index: item.index,
      tokens: input.slice(Math.max(0, item.index - 8), item.index + 18),
    }));
  const marker = raw.search(/%\s*of\s*Bets/i);
  return {
    status: response.status,
    length: raw.length,
    tokenCount: input.length,
    title: input.find((v) => /Consensus Picks/i.test(v)) || "",
    hits,
    rawSnippet: marker >= 0 ? raw.slice(Math.max(0, marker - 1200), marker + 2200) : "",
  };
}

export async function GET() {
  const entries = await Promise.all(
    Object.entries(URLS).map(async ([sport, url]) => [sport, await probe(url)] as const),
  );
  return NextResponse.json(Object.fromEntries(entries), {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
