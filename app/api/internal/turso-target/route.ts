import { NextResponse } from "next/server";
import { readTursoDataset } from "../../../../lib/tursoStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const URL_NAMES = ["TURSO_DATABASE_URL", "TURSO_URL", "turso_TURSO_DATABASE_URL", "DATABASE_URL"];

function target() {
  for (const name of URL_NAMES) {
    const raw = String(process.env[name] || "").trim();
    if (!raw) continue;
    const normalized = raw.startsWith("libsql://") ? `https://${raw.slice("libsql://".length)}` : raw;
    try {
      return { key: name, host: new URL(normalized).host };
    } catch {
      return { key: name, host: "invalid-url" };
    }
  }
  return { key: "", host: "" };
}

export async function GET() {
  const info = target();
  let nflPropCount: number | null = null;
  let error = "";
  try {
    nflPropCount = (await readTursoDataset("NFL", "prop_projections")).length;
  } catch (exc) {
    error = exc instanceof Error ? exc.message : String(exc);
  }
  return NextResponse.json({ ...info, nflPropCount, error });
}
