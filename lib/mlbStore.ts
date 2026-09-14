import { isTursoConfigured, readTursoDataset, type TursoRow } from "./tursoStore";

export type SheetRow = Record<string, string>;

function assertTursoConfigured() {
  if (!isTursoConfigured()) {
    throw new Error("Turso is not configured. No legacy storage fallback is available.");
  }
}

function copyRow(source: TursoRow): SheetRow {
  const row: SheetRow = {};
  for (const [key, value] of Object.entries(source || {})) {
    row[key] = String(value ?? "");
  }
  return row;
}

/**
 * Compatibility entry point for the existing public-data code.
 * The historical module name is retained temporarily to avoid a large unrelated
 * API refactor, but every read is served exclusively from Turso.
 */
export async function readWorksheet(tabName: string): Promise<SheetRow[]> {
  assertTursoConfigured();
  const datasetName = String(tabName || "").trim();
  if (!datasetName) return [];
  const rows = await readTursoDataset("MLB", datasetName);
  return rows.map(copyRow);
}
