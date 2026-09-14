import crypto from "node:crypto";
import { google } from "googleapis";

const URL_NAMES = ["TURSO_DATABASE_URL", "TURSO_URL", "turso_TURSO_DATABASE_URL", "DATABASE_URL"];
const TOKEN_NAMES = ["TURSO_AUTH_TOKEN", "TURSO_DATABASE_AUTH_TOKEN", "turso_TURSO_AUTH_TOKEN", "TURSO_TOKEN", "DATABASE_AUTH_TOKEN"];
const CRITICAL = {
  MLB: ["daily_slate", "bet_tracker", "odds_snapshot", "pitcher_recent_form", "all_game_trends", "public_split_snapshots", "ai_pick_selector"],
  NFL: ["daily_slate", "bet_tracker", "odds_snapshot", "prop_projections", "prop_tracker", "posted_games", "weekly_market_trends", "all_game_trends"],
  NCAAF: ["daily_slate", "bet_tracker", "odds_snapshot", "posted_games", "weekly_market_trends", "all_game_trends", "public_split_snapshots"],
};

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
function sqlText(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function credentials() {
  const raw = String(process.env.GOOGLE_CREDENTIALS || process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "").trim();
  if (!raw) throw new Error("Missing Google credentials for parity audit.");
  try { return JSON.parse(raw); } catch { return JSON.parse(raw.replace(/\\n/g, "\n")); }
}
function extractSpreadsheetId(value) {
  const text = String(value || "").trim();
  const match = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match?.[1]) return match[1];
  return /^[a-zA-Z0-9-_]{20,}$/.test(text) ? text : "";
}
function quoteSheet(name) { return `'${String(name).replaceAll("'", "''")}'`; }
function digest(records) { return crypto.createHash("sha256").update(JSON.stringify(records)).digest("hex"); }
function valueText(value) { return !value || value.type === "null" ? "" : String(value.value ?? ""); }
function resultRows(result) {
  const data = result?.response?.result || {};
  const columns = (data.cols || []).map((column) => String(column?.name || ""));
  return (data.rows || []).map((source) => {
    const row = {};
    columns.forEach((column, index) => { if (column) row[column] = valueText(source[index]); });
    return row;
  });
}
function projectGoogle(values, headers) {
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
function projectTurso(payload, headers) {
  let parsed = {};
  try { parsed = JSON.parse(payload || "{}"); } catch {}
  const row = {};
  for (const header of headers) row[header] = String(parsed?.[header] ?? "");
  return row;
}

const rawUrl = firstEnv(URL_NAMES);
const token = firstEnv(TOKEN_NAMES);
if (!rawUrl || !token) throw new Error("Turso is not configured in the preview build.");
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
  if (failed) throw new Error(`Turso ${label} statement error: ${JSON.stringify(failed).slice(0, 600)}`);
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
async function sharedWorkbookId() {
  const raw = String(process.env.GOOGLE_SHEET_ID || process.env.GOOGLE_SHEET_NAME || "").trim();
  const direct = extractSpreadsheetId(raw);
  return direct || (raw ? await findByName(raw) : "");
}
async function resolveWorkbook(sport) {
  const plans = sport === "MLB"
    ? { ids: ["GOOGLE_SHEET_ID", "GOOGLE_SPREADSHEET_ID", "SPREADSHEET_ID"], names: ["GOOGLE_SHEET_NAME"], defaultName: "" }
    : sport === "NFL"
      ? { ids: ["NFL_GOOGLE_SHEET_ID"], names: ["NFL_GOOGLE_SHEET_NAME"], defaultName: "NFL Model Database" }
      : { ids: ["CFB_GOOGLE_SHEET_ID", "NCAAF_GOOGLE_SHEET_ID"], names: ["CFB_GOOGLE_SHEET_NAME", "NCAAF_GOOGLE_SHEET_NAME"], defaultName: "CFB Model Database" };
  for (const key of plans.ids) {
    const id = extractSpreadsheetId(String(process.env[key] || ""));
    if (id) return { id, shared: false };
  }
  for (const key of plans.names) {
    const configured = String(process.env[key] || "").trim();
    const id = extractSpreadsheetId(configured);
    if (id) return { id, shared: false };
    if (configured) {
      const found = await findByName(configured);
      if (found) return { id: found, shared: false };
    }
  }
  if (plans.defaultName) {
    const found = await findByName(plans.defaultName);
    if (found) return { id: found, shared: false };
  }
  const shared = await sharedWorkbookId();
  return { id: shared, shared: Boolean(shared) };
}

async function auditSport(sport) {
  const workbook = await resolveWorkbook(sport);
  if (!workbook.id) throw new Error(`Could not resolve ${sport} Google workbook.`);
  const manifestResults = await pipeline([{
    type: "execute",
    stmt: { sql: `SELECT dataset,source_worksheet,headers_json,imported_at,source_kind FROM dataset_manifest WHERE sport=${sqlText(sport)} ORDER BY dataset`, args: [] },
  }], `${sport} manifest`);
  const manifest = resultRows(manifestResults[0]);
  const manifestMap = new Map(manifest.map((row) => [row.dataset, row]));
  const metadata = await sheets.spreadsheets.get({ spreadsheetId: workbook.id, fields: "properties(title),sheets.properties(title)" });
  const title = String(metadata.data.properties?.title || workbook.id);
  const titles = new Set((metadata.data.sheets || []).map((sheet) => String(sheet.properties?.title || "").trim()).filter(Boolean));

  const plan = CRITICAL[sport].map((dataset) => {
    const manifestRow = manifestMap.get(dataset);
    let headers = [];
    try { headers = JSON.parse(manifestRow?.headers_json || "[]"); } catch {}
    const candidates = sport === "NFL"
      ? [manifestRow?.source_kind === "google_sheets" ? manifestRow.source_worksheet : "", dataset, `nfl_${dataset}`]
      : sport === "NCAAF"
        ? [manifestRow?.source_kind === "google_sheets" ? manifestRow.source_worksheet : "", dataset, `cfb_${dataset}`, `ncaaf_${dataset}`]
        : [manifestRow?.source_kind === "google_sheets" ? manifestRow.source_worksheet : "", dataset];
    const physical = candidates.filter(Boolean).find((candidate) => titles.has(candidate)) || "";
    return { dataset, manifestRow, headers, physical };
  });

  const readable = plan.filter((item) => item.physical && item.headers.length);
  const batch = readable.length ? await sheets.spreadsheets.values.batchGet({
    spreadsheetId: workbook.id,
    ranges: readable.map((item) => quoteSheet(item.physical)),
    majorDimension: "ROWS",
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  }) : { data: { valueRanges: [] } };
  const googleMap = new Map();
  readable.forEach((item, index) => {
    googleMap.set(item.dataset, projectGoogle(batch.data.valueRanges?.[index]?.values || [], item.headers));
  });

  const output = [];
  for (const item of plan) {
    if (!item.manifestRow) {
      output.push({ dataset: item.dataset, ok: false, reason: "missing_turso_manifest" });
      continue;
    }
    if (!item.physical) {
      output.push({ dataset: item.dataset, ok: false, reason: "missing_google_worksheet" });
      continue;
    }
    if (!item.headers.length) {
      output.push({ dataset: item.dataset, ok: false, reason: "missing_manifest_headers" });
      continue;
    }
    const tursoResults = await pipeline([{
      type: "execute",
      stmt: { sql: `SELECT payload_json FROM dataset_rows WHERE sport=${sqlText(sport)} AND dataset=${sqlText(item.dataset)} ORDER BY row_index ASC`, args: [] },
    }], `${sport}/${item.dataset}`);
    const turso = resultRows(tursoResults[0]).map((row) => projectTurso(row.payload_json, item.headers));
    const googleRows = googleMap.get(item.dataset) || [];
    const rowCountMatch = googleRows.length === turso.length;
    const contentMatch = digest(googleRows) === digest(turso);
    output.push({
      dataset: item.dataset,
      ok: rowCountMatch && contentMatch,
      googleRows: googleRows.length,
      tursoRows: turso.length,
      rowCountMatch,
      contentMatch,
      tursoUpdatedAt: item.manifestRow.imported_at,
    });
  }
  const matches = output.filter((row) => row.ok).length;
  console.log(`[turso-parity] ${sport} workbook=${title} matches=${matches}/${output.length}`);
  for (const row of output) console.log(`[turso-parity] ${sport}/${row.dataset} ${row.ok ? "MATCH" : "MISMATCH"} ${JSON.stringify(row)}`);
  return { sport, matches, checked: output.length, output };
}

const all = [];
for (const sport of ["MLB", "NFL", "NCAAF"]) {
  try {
    all.push(await auditSport(sport));
  } catch (error) {
    console.log(`[turso-parity] ${sport} AUDIT_ERROR ${String(error?.message || error)}`);
    all.push({ sport, matches: 0, checked: CRITICAL[sport].length, error: String(error?.message || error) });
  }
}
const totalChecked = all.reduce((sum, item) => sum + Number(item.checked || 0), 0);
const totalMatches = all.reduce((sum, item) => sum + Number(item.matches || 0), 0);
console.log(`[turso-parity] SUMMARY matches=${totalMatches}/${totalChecked}`);
