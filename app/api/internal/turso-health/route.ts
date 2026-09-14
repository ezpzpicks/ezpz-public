import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function firstEnv(names: string[]) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return { name, value };
  }
  return { name: "", value: "" };
}

function httpEndpoint(databaseUrl: string) {
  const trimmed = String(databaseUrl || "").trim();
  if (trimmed.startsWith("libsql://")) return `https://${trimmed.slice("libsql://".length)}`;
  if (trimmed.startsWith("https://")) return trimmed;
  if (trimmed.startsWith("http://")) return trimmed;
  return trimmed ? `https://${trimmed}` : "";
}

export async function GET() {
  if (process.env.VERCEL_ENV !== "preview") {
    return new NextResponse(null, { status: 404 });
  }

  const database = firstEnv([
    "TURSO_DATABASE_URL",
    "TURSO_URL",
    "DATABASE_URL",
  ]);
  const token = firstEnv([
    "TURSO_AUTH_TOKEN",
    "TURSO_DATABASE_AUTH_TOKEN",
    "TURSO_TOKEN",
    "DATABASE_AUTH_TOKEN",
  ]);

  const result: Record<string, unknown> = {
    configured: Boolean(database.value && token.value),
    databaseVariable: database.name || null,
    tokenVariable: token.name || null,
    databaseHost: null,
    connectionOk: false,
  };

  if (!database.value || !token.value) {
    return NextResponse.json(result, { status: 503 });
  }

  const endpoint = httpEndpoint(database.value).replace(/\/$/, "");
  try {
    result.databaseHost = new URL(endpoint).host;
  } catch {
    result.databaseHost = "invalid-url";
  }

  try {
    const response = await fetch(`${endpoint}/v2/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.value}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requests: [
          {
            type: "execute",
            stmt: { sql: "SELECT 1 AS ok", args: [] },
          },
          { type: "close" },
        ],
      }),
      cache: "no-store",
    });

    result.connectionOk = response.ok;
    result.status = response.status;
    if (!response.ok) {
      const body = await response.text();
      result.error = body.slice(0, 500);
    }

    return NextResponse.json(result, { status: response.ok ? 200 : 502 });
  } catch (error: any) {
    result.error = String(error?.message || error || "Unknown Turso connection error").slice(0, 500);
    return NextResponse.json(result, { status: 502 });
  }
}
