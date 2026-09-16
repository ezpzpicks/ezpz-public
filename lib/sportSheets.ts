import {
  appendTursoDataset,
  ensureTursoDataset,
  isTursoConfigured,
  readTursoDataset,
  readTursoDatasetState,
  replaceTursoDataset,
  type TursoRow,
} from "./tursoStore";

export type FootballSport = "NFL" | "NCAAF";
export type SheetRow = Record<string, string>;

function assertTursoConfigured() {
  if (!isTursoConfigured()) {
    throw new Error("Turso is not configured. No legacy storage fallback is available.");
  }
}

function normalizeRow(source: TursoRow | SheetRow, columns?: string[]): SheetRow {
  const row: SheetRow = {};
  for (const [key, value] of Object.entries(source || {})) row[key] = String(value ?? "");
  for (const column of columns || []) if (row[column] === undefined) row[column] = "";
  return row;
}

function normalizeRows(rows: Array<TursoRow | SheetRow>, columns?: string[]) {
  return rows.map((row) => normalizeRow(row, columns));
}

/** Historical compatibility identity. There is no spreadsheet behind it. */
export async function resolveSportSpreadsheetId(sport: FootballSport) {
  assertTursoConfigured();
  return `turso:${sport}`;
}

export async function readSportWorksheet(
  sport: FootballSport,
  worksheetName: string,
  columns?: string[],
): Promise<SheetRow[]> {
  assertTursoConfigured();
  const rows = await readTursoDataset(sport, worksheetName, columns);
  return normalizeRows(rows, columns);
}

export async function ensureSportWorksheet(
  sport: FootballSport,
  worksheetName: string,
  headers: string[],
) {
  assertTursoConfigured();
  await ensureTursoDataset(sport, worksheetName, headers);
}

export async function writeSportWorksheet(
  sport: FootballSport,
  worksheetName: string,
  headers: string[],
  rows: SheetRow[],
) {
  assertTursoConfigured();
  await replaceTursoDataset(sport, worksheetName, normalizeRows(rows, headers), headers);
}

export async function upsertSportRows(
  sport: FootballSport,
  worksheetName: string,
  headers: string[],
  rows: SheetRow[],
  keyFor: (row: SheetRow) => string,
) {
  assertTursoConfigured();

  // Read the current dataset once, including row indexes/manifest metadata, then
  // pass that same state into the differential writer. The old path read the
  // entire dataset here and then read it a second time inside replaceTursoDataset.
  const state = await readTursoDatasetState(sport, worksheetName, headers);
  const existing = normalizeRows(state.rows.map((item) => item.row), headers);
  const map = new Map<string, SheetRow>();
  for (const row of existing) {
    const key = keyFor(row);
    if (key) map.set(key, row);
  }
  for (const row of rows) {
    const normalized = normalizeRow(row, headers);
    const key = keyFor(normalized);
    if (!key) continue;
    map.set(key, { ...(map.get(key) || {}), ...normalized });
  }
  await replaceTursoDataset(sport, worksheetName, [...map.values()], headers, state);
}

export async function appendSportRows(
  sport: FootballSport,
  worksheetName: string,
  headers: string[],
  rows: SheetRow[],
) {
  assertTursoConfigured();
  if (!rows.length) return;
  await ensureSportWorksheet(sport, worksheetName, headers);
  await appendTursoDataset(sport, worksheetName, normalizeRows(rows, headers), headers);
}

export function sportDatabaseLabel(sport: FootballSport) {
  return `${sport} Turso database`;
}
