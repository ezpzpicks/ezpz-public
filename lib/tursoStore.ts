import { AsyncLocalStorage } from "node:async_hooks";

export type TursoSport = "MLB" | "NFL" | "NCAAF" | "NCAAM";
export type TursoRow = Record<string, string>;
export type TursoIndexedRow = { index: number; row: TursoRow };
export type TursoDatasetState = {
  rows: TursoIndexedRow[];
  headers: string[];
  rowCount: number | null;
};

type PipelineResult = {
  type?: string;
  response?: {
    type?: string;
    result?: {
      cols?: Array<{ name?: string }>;
      rows?: Array<Array<{ type?: string; value?: string }>>;
      affected_row_count?: number;
    };
  };
};

type PipelineRequest =
  | { type: "execute"; stmt: { sql: string; args: never[] } }
  | { type: "close" };

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

const TURSO_READ_SCOPE = new AsyncLocalStorage<Map<string, TursoIndexedRow[]>>();

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

function sqlText(value: unknown) {
  if (value == null) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function firstRowValue(row: TursoRow, names: string[]) {
  for (const name of names) {
    const value = row?.[name];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function metadata(row: TursoRow) {
  return {
    dateKey: firstRowValue(row, ["Date", "date", "Record Date"]),
    gameKey: firstRowValue(row, ["Game Key", "gameKey", "Game ID", "gameId"]),
    game: firstRowValue(row, ["Game", "game", "Game Label"]),
    market: firstRowValue(row, ["Market", "market", "Bet Type", "Play Type"]),
    selection: firstRowValue(row, ["Selection", "selection", "Play", "Side"]),
    result: firstRowValue(row, ["Result", "result", "Status"]),
    snapshotTime: firstRowValue(row, ["Snapshot Time ET", "snapshotTime", "Locked At", "Result Updated"]),
  };
}

function hashText(input: string) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function logTursoIo(event: Record<string, unknown>) {
  console.info("[turso-io]", JSON.stringify(event));
}

function dataCacheKey(sport: TursoSport, dataset: string) {
  return `${sport}\u0000${dataset}`;
}

function cloneIndexedRows(rows: TursoIndexedRow[]) {
  return rows.map((item) => ({ index: item.index, row: { ...item.row } }));
}

function getScopedRows(sport: TursoSport, dataset: string) {
  const rows = TURSO_READ_SCOPE.getStore()?.get(dataCacheKey(sport, dataset));
  return rows ? cloneIndexedRows(rows) : null;
}

function setScopedRows(sport: TursoSport, dataset: string, rows: TursoIndexedRow[]) {
  TURSO_READ_SCOPE.getStore()?.set(dataCacheKey(sport, dataset), cloneIndexedRows(rows));
}

function invalidateScopedRows(sport: TursoSport, dataset: string) {
  TURSO_READ_SCOPE.getStore()?.delete(dataCacheKey(sport, dataset));
}

export async function withTursoReadCache<T>(fn: () => Promise<T>): Promise<T> {
  if (TURSO_READ_SCOPE.getStore()) return fn();
  return TURSO_READ_SCOPE.run(new Map<string, TursoIndexedRow[]>(), fn);
}

export function isTursoConfigured() {
  return Boolean(firstEnv(URL_ENV_NAMES) && firstEnv(TOKEN_ENV_NAMES));
}

async function pipeline(sqlStatements: string[]) {
  const rawUrl = firstEnv(URL_ENV_NAMES);
  const token = firstEnv(TOKEN_ENV_NAMES);
  if (!rawUrl || !token) throw new Error("Turso is not configured.");
  const base = endpoint(rawUrl).replace(/\/$/, "");
  const requests: PipelineRequest[] = sqlStatements.map((sql) => ({
    type: "execute" as const,
    stmt: { sql, args: [] as never[] },
  }));
  requests.push({ type: "close" });
  const response = await fetch(`${base}/v2/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ requests }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Turso request failed (${response.status}): ${text.slice(0, 600)}`);
  }
  const json = JSON.parse(text) as { results?: PipelineResult[] };
  for (const result of json.results || []) {
    if (result?.type === "error" || result?.response?.type === "error") {
      throw new Error(`Turso statement failed: ${JSON.stringify(result).slice(0, 800)}`);
    }
  }
  return json.results || [];
}

function decodeValue(value: { type?: string; value?: string } | undefined) {
  if (!value || value.type === "null") return "";
  return String(value.value ?? "");
}

function queryRows(result: PipelineResult | undefined) {
  const data = result?.response?.result;
  const columns = (data?.cols || []).map((column) => String(column?.name || ""));
  return (data?.rows || []).map((row) => {
    const object: Record<string, string> = {};
    columns.forEach((column, index) => {
      if (column) object[column] = decodeValue(row[index]);
    });
    return object;
  });
}

function comparableRow(value: unknown): TursoRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: TursoRow = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const item = (value as Record<string, unknown>)[key];
    result[key] = item == null ? "" : String(item);
  }
  return result;
}

function parsePayload(value: string): TursoRow {
  try {
    return comparableRow(JSON.parse(value || "{}"));
  } catch {
    return {};
  }
}

function sameRow(left: unknown, right: unknown) {
  return JSON.stringify(comparableRow(left)) === JSON.stringify(comparableRow(right));
}

function parseHeaders(value: string | undefined) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function indexedRowsFromResult(result: PipelineResult | undefined) {
  const rows: TursoIndexedRow[] = [];
  for (const record of queryRows(result)) {
    const index = Number(record.row_index || 0);
    if (!Number.isFinite(index) || index <= 0) continue;
    rows.push({ index, row: parsePayload(record.payload_json || "{}") });
  }
  return rows;
}

function projectColumns(row: TursoRow, columns?: string[]) {
  const projected = { ...row };
  for (const column of columns || []) {
    if (projected[column] === undefined) projected[column] = "";
  }
  return projected;
}

export async function readTursoDataset(
  sport: TursoSport,
  dataset: string,
  columns?: string[],
): Promise<TursoRow[]> {
  let indexed = getScopedRows(sport, dataset);
  let rowsRead = 0;
  if (!indexed) {
    const results = await pipeline([
      `SELECT row_index,payload_json FROM dataset_rows WHERE sport=${sqlText(sport)} AND dataset=${sqlText(dataset)} ORDER BY row_index ASC`,
    ]);
    indexed = indexedRowsFromResult(results[0]);
    rowsRead = indexed.length;
    setScopedRows(sport, dataset, indexed);
  }
  const records = indexed.map((item) => projectColumns(item.row, columns));
  logTursoIo({
    op: "read",
    sport,
    dataset,
    rowsRead,
    rowsReturned: records.length,
    cacheHit: rowsRead === 0,
    rowsWritten: 0,
    rowsDeleted: 0,
  });
  return records;
}

export async function readTursoDatasetByDateKeys(
  sport: TursoSport,
  dataset: string,
  dateKeys: string[],
  columns?: string[],
): Promise<TursoRow[]> {
  const normalizedDateKeys = [...new Set(dateKeys.map((value) => String(value || "").trim()).filter(Boolean))];
  if (!normalizedDateKeys.length) return [];

  const scoped = getScopedRows(sport, dataset);
  let indexed: TursoIndexedRow[];
  let rowsRead = 0;
  if (scoped) {
    const allowed = new Set(normalizedDateKeys);
    indexed = scoped.filter((item) => allowed.has(firstRowValue(item.row, ["Date", "date", "Record Date"])));
  } else {
    const dateSql = normalizedDateKeys.map((value) => sqlText(value)).join(",");
    const results = await pipeline([
      `SELECT row_index,payload_json FROM dataset_rows WHERE sport=${sqlText(sport)} AND dataset=${sqlText(dataset)} AND date_key IN (${dateSql}) ORDER BY row_index ASC`,
    ]);
    indexed = indexedRowsFromResult(results[0]);
    rowsRead = indexed.length;
  }

  const records = indexed.map((item) => projectColumns(item.row, columns));
  logTursoIo({
    op: "date-read",
    sport,
    dataset,
    dateKeys: normalizedDateKeys,
    rowsRead,
    rowsReturned: records.length,
    cacheHit: Boolean(scoped),
    rowsWritten: 0,
    rowsDeleted: 0,
  });
  return records;
}

export async function readTursoDatasetState(
  sport: TursoSport,
  dataset: string,
  columns?: string[],
): Promise<TursoDatasetState> {
  let indexed = getScopedRows(sport, dataset);
  let dataRowsRead = 0;
  let manifestResult: PipelineResult | undefined;

  if (indexed) {
    const manifestResults = await pipeline([
      `SELECT headers_json,row_count FROM dataset_manifest WHERE sport=${sqlText(sport)} AND dataset=${sqlText(dataset)} LIMIT 1`,
    ]);
    manifestResult = manifestResults[0];
  } else {
    const results = await pipeline([
      `SELECT row_index,payload_json FROM dataset_rows WHERE sport=${sqlText(sport)} AND dataset=${sqlText(dataset)} ORDER BY row_index ASC`,
      `SELECT headers_json,row_count FROM dataset_manifest WHERE sport=${sqlText(sport)} AND dataset=${sqlText(dataset)} LIMIT 1`,
    ]);
    indexed = indexedRowsFromResult(results[0]);
    dataRowsRead = indexed.length;
    setScopedRows(sport, dataset, indexed);
    manifestResult = results[1];
  }

  const rows = indexed.map((item) => ({ index: item.index, row: projectColumns(item.row, columns) }));
  const manifestRows = queryRows(manifestResult);
  const manifest = manifestRows[0];
  const state = {
    rows,
    headers: parseHeaders(manifest?.headers_json),
    rowCount: manifest ? Number(manifest.row_count || 0) : null,
  };
  logTursoIo({
    op: "state-read",
    sport,
    dataset,
    rowsRead: dataRowsRead + manifestRows.length,
    dataRowsRead,
    rowsReturned: rows.length,
    cacheHit: dataRowsRead === 0,
    rowsWritten: 0,
    rowsDeleted: 0,
  });
  return state;
}

export async function ensureTursoDataset(
  sport: TursoSport,
  dataset: string,
  headers: string[] = [],
) {
  const targetHeaders = headers.map((value) => String(value));
  const results = await pipeline([
    `SELECT headers_json,row_count FROM dataset_manifest WHERE sport=${sqlText(sport)} AND dataset=${sqlText(dataset)} LIMIT 1`,
  ]);
  const manifestRows = queryRows(results[0]);
  const manifest = manifestRows[0];
  if (manifest) {
    const currentHeaders = parseHeaders(manifest.headers_json);
    if (JSON.stringify(currentHeaders) === JSON.stringify(targetHeaders)) {
      logTursoIo({ op: "ensure", sport, dataset, rowsRead: manifestRows.length, rowsWritten: 0, rowsDeleted: 0 });
      return;
    }
    const savedAt = new Date().toISOString();
    await pipeline([
      `UPDATE dataset_manifest SET headers_json=${sqlText(JSON.stringify(targetHeaders))}, imported_at=${sqlText(savedAt)} WHERE sport=${sqlText(sport)} AND dataset=${sqlText(dataset)}`,
    ]);
    logTursoIo({ op: "ensure", sport, dataset, rowsRead: manifestRows.length, rowsWritten: 1, rowsDeleted: 0 });
    return;
  }

  const countResults = await pipeline([
    `SELECT COUNT(*) AS row_count FROM dataset_rows WHERE sport=${sqlText(sport)} AND dataset=${sqlText(dataset)}`,
  ]);
  const countRows = queryRows(countResults[0]);
  const rowCount = Number(countRows[0]?.row_count || 0);
  const savedAt = new Date().toISOString();
  await pipeline([
    `INSERT OR REPLACE INTO dataset_manifest (sport,dataset,source_workbook,source_worksheet,headers_json,row_count,imported_at,source_kind) VALUES (${sqlText(sport)},${sqlText(dataset)},'turso-native',${sqlText(dataset)},${sqlText(JSON.stringify(targetHeaders))},${rowCount},${sqlText(savedAt)},'turso')`,
  ]);
  logTursoIo({ op: "ensure", sport, dataset, rowsRead: manifestRows.length + countRows.length, rowsWritten: 1, rowsDeleted: 0 });
}

function rowTuple(sport: TursoSport, dataset: string, row: TursoRow, index: number, savedAt: string) {
  const payload = JSON.stringify(row);
  const info = metadata(row);
  return `(${sqlText(sport)},${sqlText(dataset)},${index},${sqlText(payload)},${sqlText(hashText(payload))},${sqlText(info.dateKey)},${sqlText(info.gameKey)},${sqlText(info.game)},${sqlText(info.market)},${sqlText(info.selection)},${sqlText(info.result)},${sqlText(info.snapshotTime)},${sqlText(savedAt)})`;
}

function insertStatements(
  sport: TursoSport,
  dataset: string,
  indexedRows: Array<{ index: number; row: TursoRow }>,
  savedAt: string,
) {
  if (!indexedRows.length) return [];
  const prefix = "INSERT OR REPLACE INTO dataset_rows (sport,dataset,row_index,payload_json,source_hash,date_key,game_key,game,market,selection,result,snapshot_time,imported_at) VALUES ";
  const statements: string[] = [];
  let tuples: string[] = [];
  let chars = prefix.length;
  const flush = () => {
    if (!tuples.length) return;
    statements.push(prefix + tuples.join(","));
    tuples = [];
    chars = prefix.length;
  };
  for (const item of indexedRows) {
    const tuple = rowTuple(sport, dataset, item.row, item.index, savedAt);
    if (tuples.length && (tuples.length >= 100 || chars + tuple.length > 350_000)) flush();
    tuples.push(tuple);
    chars += tuple.length + 1;
  }
  flush();
  return statements;
}

export async function replaceTursoDataset(
  sport: TursoSport,
  dataset: string,
  rows: TursoRow[],
  headers?: string[],
  currentState?: TursoDatasetState,
) {
  const state = currentState || (await readTursoDatasetState(sport, dataset));
  const current = new Map<number, TursoRow>();
  for (const item of state.rows) current.set(item.index, item.row);

  const targetHeaders = headers === undefined ? state.headers : headers.map((value) => String(value));
  const changed: Array<{ index: number; row: TursoRow }> = [];
  rows.forEach((row, offset) => {
    const index = offset + 1;
    if (!sameRow(current.get(index) || {}, row)) changed.push({ index, row });
  });

  let maxExistingIndex = 0;
  for (const index of current.keys()) maxExistingIndex = Math.max(maxExistingIndex, index);
  const trailingIndexes = [...current.keys()].filter((index) => index > rows.length);
  const hasTrailingRows = trailingIndexes.length > 0;
  const manifestChanged =
    JSON.stringify(state.headers) !== JSON.stringify(targetHeaders) || state.rowCount !== rows.length;

  if (!changed.length && !hasTrailingRows && !manifestChanged) {
    logTursoIo({ op: "sync", sport, dataset, rowsRead: 0, rowsTarget: rows.length, rowsWritten: 0, rowsDeleted: 0, changedRows: 0 });
    return;
  }

  const savedAt = new Date().toISOString();
  const statements = ["BEGIN IMMEDIATE", ...insertStatements(sport, dataset, changed, savedAt)];
  if (hasTrailingRows) {
    statements.push(
      `DELETE FROM dataset_rows WHERE sport=${sqlText(sport)} AND dataset=${sqlText(dataset)} AND row_index>${rows.length}`,
    );
  }
  statements.push(
    `INSERT OR REPLACE INTO dataset_manifest (sport,dataset,source_workbook,source_worksheet,headers_json,row_count,imported_at,source_kind) VALUES (${sqlText(sport)},${sqlText(dataset)},'turso-native',${sqlText(dataset)},${sqlText(JSON.stringify(targetHeaders))},${rows.length},${sqlText(savedAt)},'turso')`,
    "COMMIT",
  );
  await pipeline(statements);
  setScopedRows(
    sport,
    dataset,
    rows.map((row, offset) => ({ index: offset + 1, row: comparableRow(row) })),
  );
  logTursoIo({
    op: "sync",
    sport,
    dataset,
    rowsRead: 0,
    rowsTarget: rows.length,
    rowsWritten: changed.length + 1,
    rowsDeleted: trailingIndexes.length,
    changedRows: changed.length,
    manifestWrite: 1,
    maxExistingIndex,
  });
}

export async function appendTursoDataset(
  sport: TursoSport,
  dataset: string,
  rows: TursoRow[],
  headers: string[] = [],
) {
  if (!rows.length) return;

  const scoped = getScopedRows(sport, dataset);
  let currentMax = 0;
  let currentCount = 0;
  let rowsRead = 0;

  if (scoped) {
    currentCount = scoped.length;
    for (const item of scoped) currentMax = Math.max(currentMax, item.index);
  } else {
    const results = await pipeline([
      `SELECT COALESCE(MAX(row_index),0) AS max_row, COUNT(*) AS row_count FROM dataset_rows WHERE sport=${sqlText(sport)} AND dataset=${sqlText(dataset)}`,
    ]);
    const aggregateRows = queryRows(results[0]);
    const aggregate = aggregateRows[0] || {};
    currentMax = Number(aggregate.max_row || 0);
    currentCount = Number(aggregate.row_count || 0);
    rowsRead += aggregateRows.length;
  }

  let targetHeaders = headers.map(String);
  if (!headers.length) {
    const results = await pipeline([
      `SELECT headers_json FROM dataset_manifest WHERE sport=${sqlText(sport)} AND dataset=${sqlText(dataset)} LIMIT 1`,
    ]);
    const manifestRows = queryRows(results[0]);
    targetHeaders = parseHeaders(manifestRows[0]?.headers_json);
    rowsRead += manifestRows.length;
  }

  const savedAt = new Date().toISOString();
  const indexed = rows.map((row, offset) => ({ index: currentMax + offset + 1, row }));
  const statements = [
    "BEGIN IMMEDIATE",
    ...insertStatements(sport, dataset, indexed, savedAt),
    `INSERT OR REPLACE INTO dataset_manifest (sport,dataset,source_workbook,source_worksheet,headers_json,row_count,imported_at,source_kind) VALUES (${sqlText(sport)},${sqlText(dataset)},'turso-native',${sqlText(dataset)},${sqlText(JSON.stringify(targetHeaders))},${currentCount + rows.length},${sqlText(savedAt)},'turso')`,
    "COMMIT",
  ];
  await pipeline(statements);

  if (scoped) {
    setScopedRows(sport, dataset, [
      ...scoped,
      ...indexed.map((item) => ({ index: item.index, row: comparableRow(item.row) })),
    ]);
  } else {
    invalidateScopedRows(sport, dataset);
  }

  logTursoIo({
    op: "append",
    sport,
    dataset,
    rowsRead,
    rowsWritten: rows.length + 1,
    rowsDeleted: 0,
    appendedRows: rows.length,
    cacheExtended: Boolean(scoped),
  });
}


export type TursoDatasetPatch = {
  match: TursoRow;
  fields: TursoRow;
};

/**
 * Patch selected JSON fields on existing dataset rows without replacing the dataset.
 *
 * Public-data refreshes run concurrently with builder saves. Replacing a whole
 * dataset from an earlier read can erase a builder row that was committed after
 * that read. This helper uses the denormalized identity columns on dataset_rows
 * and SQLite json_patch() so unrelated fields written by another process survive.
 */
export async function patchTursoDatasetRows(
  sport: TursoSport,
  dataset: string,
  patches: TursoDatasetPatch[],
) {
  if (!patches.length) return;

  const savedAt = new Date().toISOString();
  const statements = ["BEGIN IMMEDIATE"];

  for (const patch of patches) {
    const info = metadata(comparableRow(patch.match));
    const fields = comparableRow(patch.fields);
    if (!Object.keys(fields).length) continue;

    const selectors: string[] = [
      `sport=${sqlText(sport)}`,
      `dataset=${sqlText(dataset)}`,
    ];

    if (info.dateKey) selectors.push(`date_key=${sqlText(info.dateKey)}`);
    if (info.gameKey) {
      selectors.push(`game_key=${sqlText(info.gameKey)}`);
    } else if (info.game) {
      selectors.push(`game=${sqlText(info.game)}`);
    }
    if (info.market) selectors.push(`market=${sqlText(info.market)}`);
    if (info.selection) selectors.push(`selection=${sqlText(info.selection)}`);

    // Date + game identity is required. Never fall back to a stale positional
    // row number because a builder save can remove/re-append a shell row.
    if (!info.dateKey || (!info.gameKey && !info.game)) {
      throw new Error(
        `Cannot patch ${sport}/${dataset} row without stable date/game identity.`,
      );
    }

    const patchJson = JSON.stringify(fields);
    statements.push(
      `UPDATE dataset_rows SET payload_json=json_patch(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,${sqlText(patchJson)}),source_hash='',imported_at=${sqlText(savedAt)} WHERE ${selectors.join(" AND ")}`,
    );
  }

  statements.push("COMMIT");
  if (statements.length <= 2) return;
  await pipeline(statements);
  invalidateScopedRows(sport, dataset);
  logTursoIo({
    op: "patch",
    sport,
    dataset,
    rowsRead: 0,
    rowsWritten: statements.length - 2,
    rowsDeleted: 0,
    requestedPatches: patches.length,
  });
}

export async function tursoDatasetCount(sport: TursoSport, dataset: string) {
  const results = await pipeline([
    `SELECT COUNT(*) AS row_count FROM dataset_rows WHERE sport=${sqlText(sport)} AND dataset=${sqlText(dataset)}`,
  ]);
  const rows = queryRows(results[0]);
  const count = Number(rows[0]?.row_count || 0);
  logTursoIo({ op: "count", sport, dataset, rowsRead: rows.length, rowsWritten: 0, rowsDeleted: 0 });
  return count;
}
