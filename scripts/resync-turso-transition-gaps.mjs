import crypto from "node:crypto";
import { google } from "googleapis";

const TARGETS = [
  { sport: "MLB", dataset: "bet_tracker" },
  { sport: "MLB", dataset: "ai_pick_selector" },
  { sport: "NFL", dataset: "odds_snapshot" },
  { sport: "NCAAF", dataset: "odds_snapshot" },
];
const URL_NAMES = ["TURSO_DATABASE_URL", "TURSO_URL", "turso_TURSO_DATABASE_URL", "DATABASE_URL"];
const TOKEN_NAMES = ["TURSO_AUTH_TOKEN", "TURSO_DATABASE_AUTH_TOKEN", "turso_TURSO_AUTH_TOKEN", "TURSO_TOKEN", "DATABASE_AUTH_TOKEN"];

function firstEnv(names) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return value;
  }
  return "";
}
function endpoint(value) {
  const text = String(value || "").trim().replace(/\/$/, "");
  if (text.startsWith("libsql://")) return `https://${text.slice("libsql://".length)}`;
  if (text.startsWith("https://") || text.startsWith("http://")) return text;
  return text ? `https://${text}` : "";
}
function sqlText(value) { return value == null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`; }
function credentials() {
  const raw = String(process.env.GOOGLE_CREDENTIALS || process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "").trim();
  if (!raw) throw new Error("Missing Google credentials.");
  try { return JSON.parse(raw); } catch { return JSON.parse(raw.replace(/\\n/g, "\n")); }
}
function extractSpreadsheetId(value) {
  const text = String(value || "").trim();
  const match = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match?.[1]) return match[1];
  return /^[a-zA-Z0-9-_]{20,}$/.test(text) ? text : "";
}
function quoteSheet(name) { return `'${String(name).replaceAll("'", "''")}'`; }
function resultRows(result) {
  const data = result?.response?.result || {};
  const cols = (data.cols || []).map((column) => String(column?.name || ""));
  return (data.rows || []).map((source) => {
    const row = {};
    cols.forEach((column, index) => {
      const cell = source[index];
      row[column] = !cell || cell.type === "null" ? "" : String(cell.value ?? "");
    });
    return row;
  });
}
function parseRows(values, headers) {
  if (!values?.length) return [];
  const actual = (values[0] || []).map((value) => String(value ?? "").trim());
  return values.slice(1).map((source) => {
    const row = {};
    for (const header of headers) {
      const index = actual.indexOf(header);
      row[header] = index >= 0 ? String(source?.[index] ?? "") : "";
    }
    return row;
  }).filter((row) => Object.values(row).some((value) => String(value).trim()));
}
function metadata(row) {
  const first = (...names) => {
    for (const name of names) {
      const value = row?.[name];
      if (value != null && String(value).trim()) return String(value).trim();
    }
    return "";
  };
  return {
    dateKey: first("Date", "date", "Record Date"),
    gameKey: first("Game Key", "gameKey", "Game ID", "gameId"),
    game: first("Game", "game", "Game Label"),
    market: first("Market", "market", "Bet Type", "Play Type"),
    selection: first("Selection", "selection", "Play", "Side"),
    result: first("Result", "result", "Status"),
    snapshotTime: first("Snapshot Time ET", "snapshotTime", "Locked At", "Result Updated"),
  };
}

const rawUrl = firstEnv(URL_NAMES);
const token = firstEnv(TOKEN_NAMES);
if (!rawUrl || !token) throw new Error("Turso is not configured.");
const base = endpoint(rawUrl);

async function pipeline(requests, label) {
  const response = await fetch(`${base}/v2/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [...requests, { type: "close" }] }),
    signal: AbortSignal.timeout(45_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Turso ${label} failed (${response.status}): ${text.slice(0, 500)}`);
  const json = JSON.parse(text);
  const results = json.results || [];
  const failed = results.find((result) => result?.type === "error" || result?.response?.type === "error");
  if (failed) throw new Error(`Turso ${label} statement failed: ${JSON.stringify(failed).slice(0, 600)}`);
  return results;
}

const auth = new google.auth.GoogleAuth({
  credentials: credentials(),
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly", "https://www.googleapis.com/auth/drive.readonly"],
});
const sheets = google.sheets({ version: "v4", auth });
const drive = google.drive({ version: "v3", auth });

async function findByName(name) {
  if (!name) return "";
  const escaped = String(name).replaceAll("'", "\\'");
  const response = await drive.files.list({
    q: `name='${escaped}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
    fields: "files(id,name)", pageSize: 10, supportsAllDrives: true, includeItemsFromAllDrives: true,
  });
  return String(response.data.files?.[0]?.id || "");
}
async function sharedId() {
  const raw = String(process.env.GOOGLE_SHEET_ID || process.env.GOOGLE_SHEET_NAME || "").trim();
  return extractSpreadsheetId(raw) || (raw ? await findByName(raw) : "");
}
async function workbookFor(sport) {
  const config = sport === "MLB"
    ? { ids: ["GOOGLE_SHEET_ID", "GOOGLE_SPREADSHEET_ID", "SPREADSHEET_ID"], names: ["GOOGLE_SHEET_NAME"], fallback: "" }
    : sport === "NFL"
      ? { ids: ["NFL_GOOGLE_SHEET_ID"], names: ["NFL_GOOGLE_SHEET_NAME"], fallback: "NFL Model Database" }
      : { ids: ["CFB_GOOGLE_SHEET_ID", "NCAAF_GOOGLE_SHEET_ID"], names: ["CFB_GOOGLE_SHEET_NAME", "NCAAF_GOOGLE_SHEET_NAME"], fallback: "CFB Model Database" };
  for (const key of config.ids) {
    const id = extractSpreadsheetId(String(process.env[key] || ""));
    if (id) return id;
  }
  for (const key of config.names) {
    const value = String(process.env[key] || "").trim();
    const direct = extractSpreadsheetId(value);
    if (direct) return direct;
    if (value) {
      const found = await findByName(value);
      if (found) return found;
    }
  }
  if (config.fallback) {
    const found = await findByName(config.fallback);
    if (found) return found;
  }
  return sharedId();
}

async function loadManifest(sport, dataset) {
  const results = await pipeline([{
    type: "execute",
    stmt: { sql: `SELECT source_worksheet,headers_json FROM dataset_manifest WHERE sport=${sqlText(sport)} AND dataset=${sqlText(dataset)} LIMIT 1`, args: [] },
  }], `${sport}/${dataset} manifest`);
  const row = resultRows(results[0])[0];
  if (!row) throw new Error(`Missing Turso manifest for ${sport}/${dataset}`);
  let headers = [];
  try { headers = JSON.parse(row.headers_json || "[]"); } catch {}
  if (!headers.length) throw new Error(`Missing headers for ${sport}/${dataset}`);
  return { sourceWorksheet: String(row.source_worksheet || ""), headers };
}

async function replaceDataset(sport, dataset, sourceWorksheet, headers, rows) {
  const savedAt = new Date().toISOString();
  const requests = [
    { type: "execute", stmt: { sql: "BEGIN IMMEDIATE", args: [] } },
    { type: "execute", stmt: { sql: `DELETE FROM dataset_rows WHERE sport=${sqlText(sport)} AND dataset=${sqlText(dataset)}`, args: [] } },
  ];
  const prefix = "INSERT OR REPLACE INTO dataset_rows (sport,dataset,row_index,payload_json,source_hash,date_key,game_key,game,market,selection,result,snapshot_time,imported_at) VALUES ";
  let tuples = [];
  let chars = prefix.length;
  const flush = () => {
    if (!tuples.length) return;
    requests.push({ type: "execute", stmt: { sql: prefix + tuples.join(","), args: [] } });
    tuples = [];
    chars = prefix.length;
  };
  rows.forEach((row, index) => {
    const payload = JSON.stringify(row);
    const hash = crypto.createHash("sha256").update(payload).digest("hex");
    const info = metadata(row);
    const tuple = `(${sqlText(sport)},${sqlText(dataset)},${index + 1},${sqlText(payload)},${sqlText(hash)},${sqlText(info.dateKey)},${sqlText(info.gameKey)},${sqlText(info.game)},${sqlText(info.market)},${sqlText(info.selection)},${sqlText(info.result)},${sqlText(info.snapshotTime)},${sqlText(savedAt)})`;
    if (tuples.length && (tuples.length >= 100 || chars + tuple.length > 320000)) flush();
    tuples.push(tuple);
    chars += tuple.length + 1;
  });
  flush();
  requests.push({
    type: "execute",
    stmt: {
      sql: `INSERT OR REPLACE INTO dataset_manifest (sport,dataset,source_workbook,source_worksheet,headers_json,row_count,imported_at,source_kind) VALUES (${sqlText(sport)},${sqlText(dataset)},'transition-resync',${sqlText(sourceWorksheet)},${sqlText(JSON.stringify(headers))},${rows.length},${sqlText(savedAt)},'google_sheets')`,
      args: [],
    },
  });
  requests.push({ type: "execute", stmt: { sql: "COMMIT", args: [] } });
  await pipeline(requests, `${sport}/${dataset} replace`);
  console.log(`[turso-resync] ${sport}/${dataset}: ${rows.length} authoritative Sheet rows copied to Turso`);
}

for (const target of TARGETS) {
  const manifest = await loadManifest(target.sport, target.dataset);
  const workbookId = await workbookFor(target.sport);
  if (!workbookId) throw new Error(`Could not resolve ${target.sport} workbook.`);
  const meta = await sheets.spreadsheets.get({ spreadsheetId: workbookId, fields: "sheets.properties(title)" });
  const titles = new Set((meta.data.sheets || []).map((sheet) => String(sheet.properties?.title || "").trim()).filter(Boolean));
  const candidates = target.sport === "NFL"
    ? [manifest.sourceWorksheet, target.dataset, `nfl_${target.dataset}`]
    : target.sport === "NCAAF"
      ? [manifest.sourceWorksheet, target.dataset, `cfb_${target.dataset}`, `ncaaf_${target.dataset}`]
      : [manifest.sourceWorksheet, target.dataset];
  const worksheet = candidates.filter(Boolean).find((candidate) => titles.has(candidate));
  if (!worksheet) throw new Error(`Could not resolve Sheet tab for ${target.sport}/${target.dataset}.`);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: workbookId,
    range: quoteSheet(worksheet),
    majorDimension: "ROWS",
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  const rows = parseRows(response.data.values || [], manifest.headers);
  await replaceDataset(target.sport, target.dataset, worksheet, manifest.headers, rows);
}
console.log("[turso-resync] complete");
