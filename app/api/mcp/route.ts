import { NextRequest, NextResponse } from "next/server";
import { handleEzpzMcp, MCP_VERSION } from "../../../lib/ezpzMcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;
const MAX_REQUEST_BYTES = 16_384;
const HEADERS = { "Cache-Control": "no-store", "MCP-Protocol-Version": MCP_VERSION };

export async function GET() {
  return NextResponse.json({ name: "EZPZ Picks", version: "1.0.0", protocolVersion: MCP_VERSION,
    serverUrl: "https://ezpzpicks.com/api/mcp", authentication: "none",
    tools: ["get_ezpz_picks", "get_finalized_pick"], events: ["ezpz.pick.finalized"],
    description: "Read public EZPZ picks and subscribe to finalized-pick notifications. Publishing uses your separate Buffer connection.",
  }, { headers: HEADERS });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const allowed = new Set([request.nextUrl.origin, "https://ezpzpicks.com", "https://www.ezpzpicks.com", "https://chatgpt.com"]);
  if (origin && !allowed.has(origin)) return NextResponse.json({ error: "Origin not allowed." }, { status: 403, headers: HEADERS });
  if (Number(request.headers.get("content-length") || 0) > MAX_REQUEST_BYTES) return new NextResponse(null, { status: 413, headers: HEADERS });
  // Bound the streamed body too; a missing Content-Length must not bypass the limit.
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_REQUEST_BYTES) { await reader.cancel(); return new NextResponse(null, { status: 413, headers: HEADERS }); }
      chunks.push(part.value);
    }
  }
  let body: unknown;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON." } }, { status: 400, headers: HEADERS }); }
  const response = await handleEzpzMcp(body);
  const requestedVersion = request.headers.get("mcp-protocol-version");
  const version = (response as any)?.result?.protocolVersion
    || (["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"].includes(requestedVersion || "") ? requestedVersion : MCP_VERSION);
  const headers = { ...HEADERS, "MCP-Protocol-Version": version };
  return response === null ? new NextResponse(null, { status: 202, headers }) : NextResponse.json(response, { headers });
}
