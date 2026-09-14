export type TursoSport = "MLB" | "NFL" | "NCAAF" | "NCAAM";
export type TursoRow = Record<string, string>;

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
    stmt: { sql, args: [] },
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

export async function readTursoDataset(
  sport: TursoSport,
  dataset: string,
  columns?: string[],
): Promise<TursoRow[]> {
  const results = await pipeline([
    `SELECT payload_json FROM dataset_rows WHERE sport=${sqlText(sport)} AND dataset=${sqlText(dataset)} ORDER BY row_index ASC`,
  ]);
  return queryRows(results[0]).map((record) => {
    let parsed: TursoRow = {};
    try {
      parsed = JSON.parse(record.payload_json || "{}") as TursoRow;
    } catch {
      parsed = {};
    }
    for (const column of columns || []) {
      if (parsed[column] === undefined) parsed[column] = "";
    }
    return parsed;
  });
}

function rowTuple(sport: TursoSport, dataset: string, row: TursoRow, index: number, savedAt: string) {
  const payload = JSON.stringify(row);
  const info = metadata(row);
  return `(${sqlText(sport)},${sqlText(dataset)},${index},${sqlText(payload)},${sqlText(hashText(payload))},${sqlText(info.dateKey)},${sqlText(info.gameKey)},${sqlText(info.game)},${sqlText(info.market)},${sqlText(info.selection)},${sqlText(info.result)},${sqlText(info.snapshotTime)},${sqlText(savedAt)})`;
}

async function insertRows(sport: TursoSport, dataset: string, rows: TursoRow[], startIndex = 1) {
  if (!rows.length) return;
  const savedAt = new Date().toISOString();
  const prefix = "INSERT OR REPLACE INTO dataset_rows (sport,dataset,row_index,payload_json,source_hash,date_key,game_key,game,market,selection,result,snapshot_time,imported_at) VALUES ";
  let tuples: string[] = [];
  let chars = prefix.length;
  const flush = async () => {
    if (!tuples.length) return;
    await pipeline([prefix + tuples.join(",")]);
    tuples = [];
    chars = prefix.length;
  };
  for (let offset = 0; offset < rows.length; offset += 1) {
    const tuple = rowTuple(sport, dataset, rows[offset], startIndex + offset, savedAt);
    if (tuples.length && (tuples.length >= 100 || chars + tuple.length > 350_000)) await flush();
    tuples.push(tuple);
    chars += tuple.length + 1;
  }
  await flush();
}

export async function replaceTursoDataset(
  sport: TursoSport,
  dataset: string,
  rows: TursoRow[],
  headers?: string[],
) {
  await pipeline([
    `DELETE FROM dataset_rows WHERE sport=${sqlText(sport)} AND dataset=${sqlText(dataset)}`,
  ]);
  await insertRows(sport, dataset, rows, 1);
  const savedAt = new Date().toISOString();
  await pipeline([
    `INSERT OR REPLACE INTO dataset_manifest (sport,dataset,source_workbook,source_worksheet,headers_json,row_count,imported_at,source_kind) VALUES (${sqlText(sport)},${sqlText(dataset)},'turso-native',${sqlText(dataset)},${sqlText(JSON.stringify(headers || []))},${rows.length},${sqlText(savedAt)},'turso')`,
  ]);
}

export async function appendTursoDataset(sport: TursoSport, dataset: string, rows: TursoRow[]) {
  if (!rows.length) return;
  const results = await pipeline([
    `SELECT COALESCE(MAX(row_index),0) AS max_row FROM dataset_rows WHERE sport=${sqlText(sport)} AND dataset=${sqlText(dataset)}`,
  ]);
  const current = Number(queryRows(results[0])[0]?.max_row || 0);
  await insertRows(sport, dataset, rows, current + 1);
}

export async function tursoDatasetCount(sport: TursoSport, dataset: string) {
  const results = await pipeline([
    `SELECT COUNT(*) AS row_count FROM dataset_rows WHERE sport=${sqlText(sport)} AND dataset=${sqlText(dataset)}`,
  ]);
  return Number(queryRows(results[0])[0]?.row_count || 0);
}
