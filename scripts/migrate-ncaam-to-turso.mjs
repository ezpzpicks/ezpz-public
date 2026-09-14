import crypto from "node:crypto";
import { google } from "googleapis";

function firstEnv(names) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return value;
  }
  return "";
}
function endpoint(value) {
  if (value.startsWith("libsql://")) return `https://${value.slice("libsql://".length)}`;
  if (value.startsWith("https://") || value.startsWith("http://")) return value;
  return value ? `https://${value}` : "";
}
function sqlText(value) {
  if (value == null) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}
function googleCredentials() {
  const raw = String(process.env.GOOGLE_CREDENTIALS || process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "").trim();
  if (!raw) throw new Error("Missing GOOGLE_CREDENTIALS.");
  try { return JSON.parse(raw); } catch { return JSON.parse(raw.replace(/\\n/g, "\n")); }
}
function extractSpreadsheetId(value) {
  const text = String(value || "").trim();
  const match = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match?.[1]) return match[1];
  return /^[a-zA-Z0-9-_]{20,}$/.test(text) ? text : "";
}
function rowsToObjects(values) {
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
function metadata(row) {
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

const rawUrl = firstEnv(["TURSO_DATABASE_URL", "TURSO_URL", "turso_TURSO_DATABASE_URL", "DATABASE_URL"]);
const token = firstEnv(["TURSO_AUTH_TOKEN", "TURSO_DATABASE_AUTH_TOKEN", "turso_TURSO_AUTH_TOKEN", "TURSO_TOKEN", "DATABASE_AUTH_TOKEN"]);
if (!rawUrl || !token) throw new Error("Turso is not configured.");
const base = endpoint(rawUrl).replace(/\/$/, "");

async function pipeline(sqlStatements, label) {
  const requests = sqlStatements.map((sql) => ({ type: "execute", stmt: { sql, args: [] } }));
  requests.push({ type: "close" });
  const response = await fetch(`${base}/v2/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests }),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Turso ${label} failed (${response.status}): ${text.slice(0, 800)}`);
  const json = JSON.parse(text);
  for (const result of json.results || []) {
    if (result?.type === "error" || result?.response?.type === "error") {
      throw new Error(`Turso ${label} statement failed: ${JSON.stringify(result).slice(0, 1000)}`);
    }
  }
}

const auth = new google.auth.GoogleAuth({
  credentials: googleCredentials(),
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly", "https://www.googleapis.com/auth/drive.readonly"],
});
const sheets = google.sheets({ version: "v4", auth });
const drive = google.drive({ version: "v3", auth });

async function findByName(name) {
  const escaped = String(name).replaceAll("'", "\\'");
  const response = await drive.files.list({
    q: `name='${escaped}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
    fields: "files(id,name)", pageSize: 10, supportsAllDrives: true, includeItemsFromAllDrives: true,
  });
  return String(response.data.files?.[0]?.id || "").trim();
}
async function resolveWorkbook() {
  for (const envName of ["CBB_GOOGLE_SHEET_ID", "NCAAM_GOOGLE_SHEET_ID"]) {
    const direct = extractSpreadsheetId(process.env[envName] || "");
    if (direct) return { id: direct, shared: false };
  }
  for (const envName of ["CBB_GOOGLE_SHEET_NAME", "NCAAM_GOOGLE_SHEET_NAME"]) {
    const configured = String(process.env[envName] || "").trim();
    const direct = extractSpreadsheetId(configured);
    if (direct) return { id: direct, shared: false };
    if (configured) {
      const found = await findByName(configured);
      if (found) return { id: found, shared: false };
    }
  }
  const dedicated = await findByName("CBB Model Database");
  if (dedicated) return { id: dedicated, shared: false };
  const sharedValue = String(process.env.GOOGLE_SHEET_ID || process.env.GOOGLE_SHEET_NAME || "").trim();
  let shared = extractSpreadsheetId(sharedValue);
  if (!shared && sharedValue) shared = await findByName(sharedValue);
  return { id: shared, shared: Boolean(shared) };
}
function quoteSheet(name) { return `'${String(name).replaceAll("'", "''")}'`; }

function tuple(dataset, row, index, importedAt) {
  const payload = JSON.stringify(row);
  const hash = crypto.createHash("sha256").update(payload).digest("hex");
  const info = metadata(row);
  return `('NCAAM',${sqlText(dataset)},${index + 1},${sqlText(payload)},${sqlText(hash)},${sqlText(info.dateKey)},${sqlText(info.gameKey)},${sqlText(info.game)},${sqlText(info.market)},${sqlText(info.selection)},${sqlText(info.result)},${sqlText(info.snapshotTime)},${sqlText(importedAt)})`;
}

async function replaceDataset(dataset, workbookTitle, worksheetTitle, headers, rows) {
  const importedAt = new Date().toISOString();
  await pipeline([`DELETE FROM dataset_rows WHERE sport='NCAAM' AND dataset=${sqlText(dataset)}`], `${dataset} reset`);
  const prefix = "INSERT OR REPLACE INTO dataset_rows (sport,dataset,row_index,payload_json,source_hash,date_key,game_key,game,market,selection,result,snapshot_time,imported_at) VALUES ";
  let batch = [];
  let size = prefix.length;
  const flush = async () => {
    if (!batch.length) return;
    await pipeline([prefix + batch.join(",")], `${dataset} insert`);
    batch = [];
    size = prefix.length;
  };
  for (let index = 0; index < rows.length; index += 1) {
    const item = tuple(dataset, rows[index], index, importedAt);
    if (batch.length && (batch.length >= 100 || size + item.length > 350_000)) await flush();
    batch.push(item);
    size += item.length + 1;
  }
  await flush();
  await pipeline([
    `INSERT OR REPLACE INTO dataset_manifest (sport,dataset,source_workbook,source_worksheet,headers_json,row_count,imported_at,source_kind) VALUES ('NCAAM',${sqlText(dataset)},${sqlText(workbookTitle)},${sqlText(worksheetTitle)},${sqlText(JSON.stringify(headers))},${rows.length},${sqlText(importedAt)},'google_sheets')`,
  ], `${dataset} manifest`);
  console.log(`[turso-migrate-ncaam] ${dataset}: ${rows.length} rows`);
}

async function main() {
  const workbook = await resolveWorkbook();
  if (!workbook.id) throw new Error("CBB/NCAAM Google workbook could not be resolved.");
  const meta = await sheets.spreadsheets.get({ spreadsheetId: workbook.id, fields: "properties(title),sheets.properties(title)" });
  const workbookTitle = String(meta.data.properties?.title || "CBB Model Database");
  const allTitles = (meta.data.sheets || []).map((item) => String(item.properties?.title || "").trim()).filter(Boolean);
  const titles = workbook.shared ? allTitles.filter((title) => /^(cbb|ncaam)_/i.test(title)) : allTitles;
  console.log(`[turso-migrate-ncaam] ${workbookTitle}: ${titles.length} worksheets`);
  let datasetCount = 0;
  let rowCount = 0;
  for (let offset = 0; offset < titles.length; offset += 15) {
    const chunk = titles.slice(offset, offset + 15);
    const response = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: workbook.id,
      ranges: chunk.map(quoteSheet),
      majorDimension: "ROWS",
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    });
    for (let index = 0; index < chunk.length; index += 1) {
      const physical = chunk[index];
      const parsed = rowsToObjects(response.data.valueRanges?.[index]?.values || []);
      if (!parsed.headers.some(Boolean)) continue;
      const dataset = workbook.shared ? physical.replace(/^(cbb|ncaam)_/i, "") : physical;
      await replaceDataset(dataset, workbookTitle, physical, parsed.headers, parsed.rows);
      datasetCount += 1;
      rowCount += parsed.rows.length;
    }
  }
  console.log(`[turso-migrate-ncaam] complete datasets=${datasetCount} rows=${rowCount}`);
}

main().catch((error) => {
  console.error(`[turso-migrate-ncaam] FAILED: ${error?.stack || error}`);
  process.exit(1);
});
