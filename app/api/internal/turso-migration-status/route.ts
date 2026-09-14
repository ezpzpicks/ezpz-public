import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const URL_ENV_NAMES = [
  "TURSO_DATABASE_URL",
  "TURSO_URL",
  "turso_TURSO_DATABASE_URL",
  "DATABASE_URL",
];
const TOKEN_ENV_NAMES = [
  "TURSO_AUTH_TOKEN",
  "TURSO_DATABASE_AUTH_TOKEN",
  "turso_TURSO_AUTH_TOKEN",
  "TURSO_TOKEN",
  "DATABASE_AUTH_TOKEN",
];

function firstEnv(names: string[]) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return value;
  }
  return "";
}

function endpoint(value: string) {
  if (value.startsWith("libsql://")) return `https://${value.slice("libsql://".length)}`;
  if (value.startsWith("https://") || value.startsWith("http://")) return value;
  return value ? `https://${value}` : "";
}

type Value = { type?: string; value?: string };
type Result = {
  type?: string;
  response?: {
    type?: string;
    result?: {
      cols?: Array<{ name?: string }>;
      rows?: Value[][];
    };
  };
};

function valueText(value: Value | undefined) {
  if (!value || value.type === "null") return "";
  return String(value.value ?? "");
}

function rows(result: Result | undefined) {
  const data = result?.response?.result;
  const columns = (data?.cols || []).map((column) => String(column.name || ""));
  return (data?.rows || []).map((source) => {
    const row: Record<string, string> = {};
    columns.forEach((column, index) => {
      if (column) row[column] = valueText(source[index]);
    });
    return row;
  });
}

export async function GET() {
  if (process.env.VERCEL_ENV !== "preview") {
    return new NextResponse(null, { status: 404 });
  }

  const rawUrl = firstEnv(URL_ENV_NAMES);
  const token = firstEnv(TOKEN_ENV_NAMES);
  if (!rawUrl || !token) {
    return NextResponse.json({ ok: false, error: "Turso is not configured." }, { status: 503 });
  }

  const base = endpoint(rawUrl).replace(/\/$/, "");
  const requests = [
    {
      type: "execute",
      stmt: {
        sql: "SELECT sport, dataset, row_count, source_workbook, source_worksheet, imported_at, source_kind FROM dataset_manifest ORDER BY sport, dataset",
        args: [],
      },
    },
    {
      type: "execute",
      stmt: {
        sql: "SELECT sport, COUNT(*) AS rows, COUNT(DISTINCT dataset) AS datasets FROM dataset_rows GROUP BY sport ORDER BY sport",
        args: [],
      },
    },
    {
      type: "execute",
      stmt: {
        sql: "SELECT id, started_at, completed_at, status, details_json FROM migration_runs ORDER BY id DESC LIMIT 5",
        args: [],
      },
    },
    { type: "close" },
  ];

  try {
    const response = await fetch(`${base}/v2/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ requests }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    if (!response.ok) {
      return NextResponse.json({ ok: false, error: `Turso returned ${response.status}` }, { status: 502 });
    }
    const json = JSON.parse(text) as { results?: Result[] };
    const results = json.results || [];
    const failures = results.filter((result) => result?.type === "error" || result?.response?.type === "error");
    if (failures.length) {
      return NextResponse.json({ ok: false, error: "One or more Turso audit queries failed." }, { status: 502 });
    }
    const manifest = rows(results[0]);
    const totals = rows(results[1]).map((row) => ({
      sport: row.sport,
      rows: Number(row.rows || 0),
      datasets: Number(row.datasets || 0),
    }));
    const runs = rows(results[2]).map((row) => ({
      id: Number(row.id || 0),
      startedAt: row.started_at,
      completedAt: row.completed_at || null,
      status: row.status,
      details: (() => {
        try { return JSON.parse(row.details_json || "{}"); } catch { return {}; }
      })(),
    }));

    return NextResponse.json({
      ok: true,
      databaseHost: new URL(base).host,
      totals,
      manifest,
      runs,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: String(error?.message || error || "Unknown Turso audit error").slice(0, 500) },
      { status: 502 },
    );
  }
}
