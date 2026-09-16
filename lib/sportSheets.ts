import {
  appendTursoDataset,
  ensureTursoDataset,
  isTursoConfigured,
  readTursoDataset,
  readTursoDatasetByDateKeys,
  readTursoDatasetState,
  replaceTursoDataset,
  type TursoRow,
} from "./tursoStore";

export type FootballSport = "NFL" | "NCAAF";
export type SheetRow = Record<string, string>;

type VolatileWritePolicy = {
  intervalMinutes: number;
  timestampField: string;
  ignoredFields: string[];
  jsonFields?: Record<string, string[]>;
};

const VOLATILE_WRITE_POLICIES: Record<string, VolatileWritePolicy> = {
  posted_games: {
    intervalMinutes: 30,
    timestampField: "Last Seen",
    ignoredFields: ["Last Seen"],
  },
  weekly_market_trends: {
    intervalMinutes: 10,
    timestampField: "Updated At",
    ignoredFields: ["Updated At"],
    jsonFields: { "Details JSON": ["updatedAt"] },
  },
  public_split_snapshots: {
    intervalMinutes: 10,
    timestampField: "Snapshot Time ET",
    ignoredFields: ["Snapshot Time ET"],
  },
  all_game_trends: {
    intervalMinutes: 10,
    timestampField: "Public Split Snapshot Time",
    ignoredFields: ["Public Split Snapshot Time"],
    jsonFields: { "Trend Score Details": ["updatedAt"] },
  },
};

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

function normalizedJson(value: unknown, ignoredKeys: string[]) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return raw;
    const copy = { ...(parsed as Record<string, unknown>) };
    for (const key of ignoredKeys) delete copy[key];
    return JSON.stringify(copy);
  } catch {
    return raw;
  }
}

function comparableRowForPolicy(row: SheetRow, policy: VolatileWritePolicy) {
  const ignored = new Set(policy.ignoredFields);
  const result: Record<string, string> = {};
  for (const key of Object.keys(row).sort()) {
    if (ignored.has(key)) continue;
    const jsonIgnored = policy.jsonFields?.[key];
    result[key] = jsonIgnored ? normalizedJson(row[key], jsonIgnored) : String(row[key] ?? "");
  }
  return JSON.stringify(result);
}

function parseStoredTimestamp(value: unknown) {
  const normalized = String(value || "")
    .trim()
    .replace(/ EDT$/, " -0400")
    .replace(/ EST$/, " -0500");
  if (!normalized) return null;
  const stamp = Date.parse(normalized);
  return Number.isFinite(stamp) ? stamp : null;
}

function maybeThrottleVolatileOnlyUpdate(
  worksheetName: string,
  previous: SheetRow | undefined,
  candidate: SheetRow,
) {
  const policy = VOLATILE_WRITE_POLICIES[worksheetName];
  if (!policy || !previous) return candidate;
  if (comparableRowForPolicy(previous, policy) !== comparableRowForPolicy(candidate, policy)) return candidate;

  const previousStamp = parseStoredTimestamp(previous[policy.timestampField]);
  if (previousStamp == null) return candidate;
  const ageMinutes = Math.max(0, (Date.now() - previousStamp) / 60_000);
  if (ageMinutes >= policy.intervalMinutes) return candidate;

  // DraftKings is still scraped every five minutes. When the market state did
  // not change, keep the durable row until its small freshness interval expires
  // instead of paying for a write whose only difference is the timestamp.
  return previous;
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

export async function readSportWorksheetByDateKeys(
  sport: FootballSport,
  worksheetName: string,
  dateKeys: string[],
  columns?: string[],
): Promise<SheetRow[]> {
  assertTursoConfigured();
  const rows = await readTursoDatasetByDateKeys(sport, worksheetName, dateKeys, columns);
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
    const previous = map.get(key);
    const candidate = { ...(previous || {}), ...normalized };
    map.set(key, maybeThrottleVolatileOnlyUpdate(worksheetName, previous, candidate));
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
  await appendTursoDataset(sport, worksheetName, normalizeRows(rows, headers), headers);
}

export function sportDatabaseLabel(sport: FootballSport) {
  return `${sport} Turso database`;
}
