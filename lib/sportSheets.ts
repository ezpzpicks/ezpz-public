import {
  appendTursoDataset,
  isTursoConfigured,
  readTursoDataset,
  replaceTursoDataset,
  type TursoRow,
} from "./tursoStore";

export type FootballSport = "NFL" | "NCAAF";
export type SheetRow = Record<string, string>;

function assertTursoConfigured() {
  if (!isTursoConfigured()) {
    throw new Error("Turso is not configured. Google Sheets is no longer a production fallback.");
  }
}

function normalizeRow(source: TursoRow | SheetRow, columns?: string[]): SheetRow {
  const row: SheetRow = {};
  for (const [key, value] of Object.entries(source || {})) {
    row[key] = String(value ?? "");
  }
  for (const column of columns || []) {
    if (row[column] === undefined) row[column] = "";
  }
  return row;
}

function normalizeRows(rows: Array<TursoRow | SheetRow>, columns?: string[]) {
  return rows.map((row) => normalizeRow(row, columns));
}

/**
 * Historical compatibility helper retained for callers that only need a stable
 * storage identity. There is no spreadsheet behind this identifier anymore.
 */
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
  const dataset = await readTursoDataset(sport, worksheetName);
  return normalizeRows(dataset?.rows || [], columns);
}

export async function ensureSportWorksheet(
  sport: FootballSport,
  worksheetName: string,
  headers: string[],
) {
  assertTursoConfigured();
  const existing = await readTursoDataset(sport, worksheetName);
  if (!existing) {
    await replaceTursoDataset(sport, worksheetName, [], headers);
    return;
  }
  const currentHeaders = existing.headers || [];
  const mergedHeaders = [...currentHeaders];
  for (const header of headers) {
    if (header && !mergedHeaders.includes(header)) mergedHeaders.push(header);
  }
  if (mergedHeaders.length !== currentHeaders.length) {
    await replaceTursoDataset(sport, worksheetName, existing.rows, mergedHeaders);
  }
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
  const existing = await readSportWorksheet(sport, worksheetName, headers);
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
  await replaceTursoDataset(sport, worksheetName, [...map.values()], headers);
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
  await appendTursoDataset(sport, worksheetName, normalizeRows(rows, headers));
}

export function sportDatabaseLabel(sport: FootballSport) {
  return `${sport} Turso database`;
}
