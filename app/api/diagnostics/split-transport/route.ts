import { NextRequest, NextResponse } from "next/server";
import { loadScoresAndOddsConsensus, type ScoresAndOddsSport } from "../../../../lib/scoresAndOddsBettingSplits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

function firstEnv(names: string[]) {
  return names.map((name) => String(process.env[name] || "").trim()).find(Boolean) || "";
}

function failure(error: unknown) {
  const value = error as { name?: string; message?: string; code?: string; cause?: { code?: string; message?: string } };
  return { name: value?.name, message: value?.message, code: value?.cause?.code || value?.code };
}

export async function GET(request: NextRequest) {
  // Temporary read-only investigation endpoint; never available in production.
  if (process.env.VERCEL_ENV !== "preview") return new NextResponse(null, { status: 404 });
  const rawUrl = firstEnv(["TURSO_DATABASE_URL", "TURSO_URL", "turso_TURSO_DATABASE_URL", "DATABASE_URL"]);
  const token = firstEnv(["TURSO_AUTH_TOKEN", "TURSO_DATABASE_AUTH_TOKEN", "turso_TURSO_AUTH_TOKEN", "TURSO_TOKEN", "DATABASE_AUTH_TOKEN"]);
  if (!rawUrl || !token) return NextResponse.json({ configured: false }, { status: 503 });
  const base = rawUrl.replace(/^libsql:\/\//, "https://").replace(/\/$/, "");
  const close = request.nextUrl.searchParams.get("close") === "1";
  const began = Date.now();
  const probes: Record<string, unknown>[] = [];

  async function read(label: string, sql: string) {
    const start = Date.now();
    try {
      const response = await fetch(`${base}/v2/pipeline`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(close ? { Connection: "close" } : {}) },
        body: JSON.stringify({ requests: [{ type: "execute", stmt: { sql, args: [] } }, { type: "close" }] }),
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      const body = await response.text();
      const result = JSON.parse(body)?.results?.[0];
      const ok = response.ok && result?.type === "ok" && result?.response?.type === "execute";
      const probe = { label, ok, status: response.status, ms: Date.now() - start, bytes: body.length, rows: result?.response?.result?.rows?.length || 0 };
      probes.push(probe);
      return probe;
    } catch (error) {
      const probe = { label, ok: false, ms: Date.now() - start, ...failure(error) };
      probes.push(probe);
      return probe;
    }
  }

  const manifest = "SELECT sport,dataset,row_count,imported_at FROM dataset_manifest WHERE sport IN ('MLB','NFL','NCAAF') AND dataset IN ('weekly_market_trends','public_split_snapshots','public_split_history')";
  await Promise.all(Array.from({ length: 5 }, (_, i) => read(`warm-${i + 1}`, manifest)));
  const sources = await Promise.all((["NFL", "NCAAF", "MLB"] as ScoresAndOddsSport[]).map(async (sport) => {
    const start = Date.now();
    try {
      const result = await loadScoresAndOddsConsensus(sport);
      return { sport, ok: true, splits: result.splits.length, ms: Date.now() - start };
    } catch (error) {
      return { sport, ok: false, ms: Date.now() - start, ...failure(error) };
    }
  }));
  await Promise.all([
    read("nfl-weekly", "SELECT row_index,payload_json FROM dataset_rows WHERE sport='NFL' AND dataset='weekly_market_trends' ORDER BY row_index ASC"),
    read("ncaaf-weekly", "SELECT row_index,payload_json FROM dataset_rows WHERE sport='NCAAF' AND dataset='weekly_market_trends' ORDER BY row_index ASC"),
  ]);
  for (let i = 0; i < 6; i += 1) await read(`after-source-${i + 1}`, manifest);
  return NextResponse.json({ close, ms: Date.now() - began, sources, probes }, { headers: { "Cache-Control": "no-store" } });
}
