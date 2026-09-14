import crypto from "node:crypto";
import { google } from "googleapis";

const TURSO_URL_NAMES = ["TURSO_DATABASE_URL", "TURSO_URL", "turso_TURSO_DATABASE_URL", "DATABASE_URL"];
const TURSO_TOKEN_NAMES = ["TURSO_AUTH_TOKEN", "TURSO_DATABASE_AUTH_TOKEN", "turso_TURSO_AUTH_TOKEN", "TURSO_TOKEN", "DATABASE_AUTH_TOKEN"];

function firstEnv(names) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return { name, value };
  }
  return { name: "", value: "" };
}
function tursoEndpoint(value) {
  if (value.startsWith("libsql://")) return `https://${value.slice("libsql://".length)}`;
  if (value.startsWith("https://") || value.startsWith("http://")) return value;
  return value ? `https://${value}` : "";
}
function sqlText(value) {
  if (value == null) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}
function credentials() {
  const raw = String(process.env.GOOGLE_CREDENTIALS || process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "").trim();
  if (!raw) throw new Error("Missing GOOGLE_CREDENTIALS for migration.");
  try { return JSON.parse(raw); } catch { return JSON.parse(raw.replace(/\\n/g, "\n")); }
}
function extractSpreadsheetId(value) {
  const trimmed = String(value || "").trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match?.[1]) return match[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) return trimmed;
  return "";
}
function rowObject(values) {
  if (!Array.isArray(values) || !values.length) return { headers: [], rows: [] };
  const headers = values[0].map((value) => String(value ?? "").trim());
  const rows = values.slice(1).map((source) => {
    const row = {};
    headers.forEach((header, index) => { if (header) row[header] = String(source?.[index] ?? "").trim(); });
    return row;
  }).filter((row) => Object.values(row).some((value) => String(value).trim()));
  return { headers, rows };
}
function firstRowValue(row, names) {
  for (const name of names) {
    const value = row?.[name];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return "";
}
function commonFields(row) {
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

const database = firstEnv(TURSO_URL_NAMES);
const token = firstEnv(TURSO_TOKEN_NAMES);
if (!database.value || !token.value) throw new Error("Turso integration variables are missing from this deployment.");
const tursoBase = tursoEndpoint(database.value).replace(/\/$/, "");

async function pipeline(sqlStatements, label = "pipeline") {
  const requests = sqlStatements.map((sql) => ({ type: "execute", stmt: { sql, args: [] } }));
  requests.push({ type: "close" });
  const response = await fetch(`${tursoBase}/v2/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token.value}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests }),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Turso ${label} failed (${response.status}): ${text.slice(0, 800)}`);
  let json = null;
  try { json = JSON.parse(text); } catch {}
  for (const result of json?.results || []) {
    if (result?.type === "error" || result?.response?.type === "error") {
      throw new Error(`Turso ${label} statement error: ${JSON.stringify(result).slice(0, 1200)}`);
    }
  }
  return json;
}

async function initSchema() {
  console.log("[turso-migrate] creating permanent dataset schema");
  await pipeline([
    `CREATE TABLE IF NOT EXISTS dataset_rows (
      sport TEXT NOT NULL, dataset TEXT NOT NULL, row_index INTEGER NOT NULL,
      payload_json TEXT NOT NULL, source_hash TEXT NOT NULL,
      date_key TEXT, game_key TEXT, game TEXT, market TEXT, selection TEXT, result TEXT, snapshot_time TEXT,
      imported_at TEXT NOT NULL,
      PRIMARY KEY (sport, dataset, row_index)
    )`,
    `CREATE TABLE IF NOT EXISTS dataset_manifest (
      sport TEXT NOT NULL, dataset TEXT NOT NULL,
      source_workbook TEXT NOT NULL, source_worksheet TEXT NOT NULL,
      headers_json TEXT NOT NULL, row_count INTEGER NOT NULL, imported_at TEXT NOT NULL,
      source_kind TEXT NOT NULL DEFAULT 'google_sheets',
      PRIMARY KEY (sport, dataset)
    )`,
    `CREATE TABLE IF NOT EXISTS migration_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL, completed_at TEXT,
      status TEXT NOT NULL, details_json TEXT NOT NULL DEFAULT '{}'
    )`,
    `CREATE INDEX IF NOT EXISTS idx_dataset_rows_date ON dataset_rows (sport, dataset, date_key)`,
    `CREATE INDEX IF NOT EXISTS idx_dataset_rows_game ON dataset_rows (sport, dataset, game_key)`,
    `CREATE INDEX IF NOT EXISTS idx_dataset_rows_market ON dataset_rows (sport, dataset, market, selection)`,
    `CREATE INDEX IF NOT EXISTS idx_dataset_rows_snapshot ON dataset_rows (sport, dataset, snapshot_time)`,
  ], "schema");
  console.log("[turso-migrate] schema ready");
}

const auth = new google.auth.GoogleAuth({
  credentials: credentials(),
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly", "https://www.googleapis.com/auth/drive.readonly"],
});
const sheets = google.sheets({ version: "v4", auth });
const drive = google.drive({ version: "v3", auth });

async function findSpreadsheetByName(name) {
  if (!name) return "";
  const escaped = String(name).replaceAll("'", "\\'");
  const response = await drive.files.list({
    q: `name='${escaped}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
    fields: "files(id,name)", pageSize: 10, supportsAllDrives: true, includeItemsFromAllDrives: true,
  });
  return String(response.data.files?.[0]?.id || "").trim();
}
async function resolveWorkbook({ idNames, nameNames, defaultName, fallbackId }) {
  for (const name of idNames) {
    const direct = extractSpreadsheetId(process.env[name] || "");
    if (direct) return { id: direct, sharedFallback: false };
  }
  for (const name of nameNames) {
    const configured = String(process.env[name] || "").trim();
    const direct = extractSpreadsheetId(configured);
    if (direct) return { id: direct, sharedFallback: false };
    if (configured) {
      const found = await findSpreadsheetByName(configured);
      if (found) return { id: found, sharedFallback: false };
    }
  }
  if (defaultName) {
    const found = await findSpreadsheetByName(defaultName);
    if (found) return { id: found, sharedFallback: false };
  }
  return fallbackId ? { id: fallbackId, sharedFallback: true } : { id: "", sharedFallback: false };
}
function quoteSheet(name) { return `'${String(name).replaceAll("'", "''")}'`; }

async function readWorkbook(spreadsheetId, selector, sport) {
  console.log(`[turso-migrate] ${sport}: reading workbook metadata`);
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "properties(title),sheets.properties(title,hidden)" });
  const workbookTitle = String(meta.data.properties?.title || spreadsheetId);
  const allTitles = (meta.data.sheets || []).map((sheet) => String(sheet.properties?.title || "").trim()).filter(Boolean);
  const selected = allTitles.filter(selector);
  console.log(`[turso-migrate] ${sport}: ${workbookTitle} has ${selected.length} selected worksheets`);
  const datasets = [];
  for (let offset = 0; offset < selected.length; offset += 15) {
    const chunk = selected.slice(offset, offset + 15);
    const response = await sheets.spreadsheets.values.batchGet({
      spreadsheetId, ranges: chunk.map((title) => quoteSheet(title)), majorDimension: "ROWS",
      valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "FORMATTED_STRING",
    });
    for (let index = 0; index < chunk.length; index += 1) {
      const physicalTitle = chunk[index];
      const parsed = rowObject(response.data.valueRanges?.[index]?.values || []);
      if (!parsed.headers.some(Boolean)) continue;
      datasets.push({ workbookTitle, physicalTitle, headers: parsed.headers, rows: parsed.rows });
    }
  }
  return datasets;
}

function rowTuple(sport, dataset, row, index, importedAt) {
  const payload = JSON.stringify(row);
  const hash = crypto.createHash("sha256").update(payload).digest("hex");
  const c = commonFields(row);
  return `(${sqlText(sport)},${sqlText(dataset)},${index + 1},${sqlText(payload)},${sqlText(hash)},${sqlText(c.dateKey)},${sqlText(c.gameKey)},${sqlText(c.game)},${sqlText(c.market)},${sqlText(c.selection)},${sqlText(c.result)},${sqlText(c.snapshotTime)},${sqlText(importedAt)})`;
}

async function insertRowsBatched(sport, dataset, rows, importedAt) {
  const prefix = `INSERT OR REPLACE INTO dataset_rows (sport,dataset,row_index,payload_json,source_hash,date_key,game_key,game,market,selection,result,snapshot_time,imported_at) VALUES `;
  let tuples = [];
  let chars = prefix.length;
  const flush = async () => {
    if (!tuples.length) return;
    await pipeline([prefix + tuples.join(",")], `${sport}/${dataset} insert`);
    tuples = [];
    chars = prefix.length;
  };
  for (let index = 0; index < rows.length; index += 1) {
    const tuple = rowTuple(sport, dataset, rows[index], index, importedAt);
    if (tuples.length && (tuples.length >= 100 || chars + tuple.length > 350_000)) await flush();
    tuples.push(tuple);
    chars += tuple.length + 1;
  }
  await flush();
}

async function replaceDataset(sport, dataset, sourceWorkbook, sourceWorksheet, headers, rows) {
  const importedAt = new Date().toISOString();
  await pipeline([`DELETE FROM dataset_rows WHERE sport=${sqlText(sport)} AND dataset=${sqlText(dataset)}`], `${sport}/${dataset} reset`);
  await insertRowsBatched(sport, dataset, rows, importedAt);
  await pipeline([
    `INSERT OR REPLACE INTO dataset_manifest (sport,dataset,source_workbook,source_worksheet,headers_json,row_count,imported_at,source_kind) VALUES (${sqlText(sport)},${sqlText(dataset)},${sqlText(sourceWorkbook)},${sqlText(sourceWorksheet)},${sqlText(JSON.stringify(headers))},${rows.length},${sqlText(importedAt)},'google_sheets')`,
  ], `${sport}/${dataset} manifest`);
  console.log(`[turso-migrate] ${sport}/${dataset}: ${rows.length} rows`);
}

async function main() {
  console.log(`[turso-migrate] starting host=${new URL(tursoBase).host}`);
  await initSchema();

  const sharedConfigured = String(process.env.GOOGLE_SHEET_ID || process.env.GOOGLE_SHEET_NAME || "").trim();
  let sharedId = extractSpreadsheetId(sharedConfigured);
  if (!sharedId && sharedConfigured) sharedId = await findSpreadsheetByName(sharedConfigured);
  console.log(`[turso-migrate] shared Google workbook=${sharedId ? "resolved" : "not configured"}`);

  const mlb = await resolveWorkbook({ idNames: ["GOOGLE_SHEET_ID", "GOOGLE_SPREADSHEET_ID", "SPREADSHEET_ID"], nameNames: ["GOOGLE_SHEET_NAME"], defaultName: "", fallbackId: "" });
  const nfl = await resolveWorkbook({ idNames: ["NFL_GOOGLE_SHEET_ID"], nameNames: ["NFL_GOOGLE_SHEET_NAME"], defaultName: "NFL Model Database", fallbackId: sharedId });
  const cfb = await resolveWorkbook({ idNames: ["CFB_GOOGLE_SHEET_ID", "NCAAF_GOOGLE_SHEET_ID"], nameNames: ["CFB_GOOGLE_SHEET_NAME", "NCAAF_GOOGLE_SHEET_NAME"], defaultName: "CFB Model Database", fallbackId: sharedId });
  console.log(`[turso-migrate] workbooks MLB=${Boolean(mlb.id)} NFL=${Boolean(nfl.id)} NCAAF=${Boolean(cfb.id)}`);

  const plans = [];
  if (mlb.id) plans.push({ sport: "MLB", id: mlb.id, selector: (title) => !/^(nfl|cfb|ncaaf|cbb|ncaam)_/i.test(title), datasetName: (title) => title });
  if (nfl.id) plans.push({ sport: "NFL", id: nfl.id, selector: nfl.sharedFallback ? (title) => /^nfl_/i.test(title) : () => true, datasetName: (title) => nfl.sharedFallback ? title.replace(/^nfl_/i, "") : title });
  if (cfb.id) plans.push({ sport: "NCAAF", id: cfb.id, selector: cfb.sharedFallback ? (title) => /^(cfb|ncaaf)_/i.test(title) : () => true, datasetName: (title) => cfb.sharedFallback ? title.replace(/^(cfb|ncaaf)_/i, "") : title });
  if (!plans.length) throw new Error("No Google Sheets workbooks could be resolved for migration.");

  const runStarted = new Date().toISOString();
  await pipeline([`INSERT INTO migration_runs (started_at,status,details_json) VALUES (${sqlText(runStarted)},'running','{}')`], "migration run start");

  const summary = [];
  for (const plan of plans) {
    const datasets = await readWorkbook(plan.id, plan.selector, plan.sport);
    let rows = 0;
    for (const source of datasets) {
      const dataset = plan.datasetName(source.physicalTitle);
      await replaceDataset(plan.sport, dataset, source.workbookTitle, source.physicalTitle, source.headers, source.rows);
      rows += source.rows.length;
    }
    summary.push({ sport: plan.sport, datasets: datasets.length, rows });
  }

  const completedAt = new Date().toISOString();
  await pipeline([`UPDATE migration_runs SET completed_at=${sqlText(completedAt)}, status='complete', details_json=${sqlText(JSON.stringify(summary))} WHERE id=(SELECT MAX(id) FROM migration_runs)`], "migration run complete");
  console.log(`[turso-migrate] complete ${JSON.stringify(summary)}`);
}

main().catch(async (error) => {
  console.error(`[turso-migrate] FAILED: ${error?.stack || error}`);
  try {
    await pipeline([`UPDATE migration_runs SET completed_at=${sqlText(new Date().toISOString())}, status='failed', details_json=${sqlText(JSON.stringify({ error: String(error?.message || error).slice(0, 1500) }))} WHERE id=(SELECT MAX(id) FROM migration_runs)`], "migration failure record");
  } catch {}
  process.exit(1);
});
