import crypto from "node:crypto";
import { google } from "googleapis";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

type Sport = "MLB" | "NFL" | "NCAAF";
type ManifestRow = {
  dataset: string;
  source_workbook: string;
  source_worksheet: string;
  headers_json: string;
  row_count: string;
  imported_at: string;
  source_kind: string;
};

type TursoValue = { type?: string; value?: string };
type TursoResult = {
  type?: string;
  response?: {
    type?: string;
    result?: { cols?: Array<{ name?: string }>; rows?: TursoValue[][] };
  };
};

const URL_ENV_NAMES = ["TURSO_DATABASE_URL", "TURSO_URL", "turso_TURSO_DATABASE_URL", "DATABASE_URL"];
const TOKEN_ENV_NAMES = ["TURSO_AUTH_TOKEN", "TURSO_DATABASE_AUTH_TOKEN", "turso_TURSO_AUTH_TOKEN", "TURSO_TOKEN", "DATABASE_AUTH_TOKEN"];

const DEFAULT_DATASETS: Record<Sport, string[]> = {
  MLB: [
    "daily_slate",
    "bet_tracker",
    "odds_snapshot",
    "pitcher_recent_form",
    "all_game_trends",
    "public_split_snapshots",
    "ai_pick_selector",
  ],
  NFL: [
    "daily_slate",
    "bet_tracker",
    "odds_snapshot",
    "prop_projections",
    "prop_tracker",
    "posted_games",
    "weekly_market_trends",
    "all_game_trends",
  ],
  NCAAF: [
    "daily_slate",
    "bet_tracker",
    "odds_snapshot",
    "posted_games",
    "weekly_market_trends",
    "all_game_trends",
    "public_split_snapshots",
  ],
};

function firstEnv(names: string[]) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return value;
  }
  return "";
}
function endpoint(value: string) {
  const text = String(value || "").trim().replace(/\/$/, "");
  if (text.startsWith("libsql://")) return `https://${text.slice("libsql://".length)}`;
  if (text.startsWith("https://") || text.startsWith("http://")) return text;
  return text ? `https://${text}` : "";
}
function sqlText(value: string) {
  return `'${String(value).replaceAll("'", "''")}'`;
}
function googleCredentials() {
  const raw = String(process.env.GOOGLE_CREDENTIALS || process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "").trim();
  if (!raw) throw new Error("Missing Google credentials.");
  try { return JSON.parse(raw); } catch { return JSON.parse(raw.replace(/\\n/g, "\n")); }
}
function extractSpreadsheetId(value: string) {
  const text = String(value || "").trim();
  const match = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match?.[1]) return match[1];
  return /^[a-zA-Z0-9-_]{20,}$/.test(text) ? text : "";
}
function quoteSheet(name: string) {
  return `'${String(name).replaceAll("'", "''")}'`;
}
function valueText(value: TursoValue | undefined) {
  if (!value || value.type === "null") return "";
  return String(value.value ?? "");
}
function tursoRows(result: TursoResult | undefined) {
  const data = result?.response?.result;
  const columns = (data?.cols || []).map((column) => String(column.name || ""));
  return (data?.rows || []).map((source) => {
    const row: Record<string, string> = {};
    columns.forEach((column, index) => { if (column) row[column] = valueText(source[index]); });
    return row;
  });
}
function digest(records: Record<string, string>[]) {
  return crypto.createHash("sha256").update(JSON.stringify(records)).digest("hex");
}
function projectRows(values: unknown[][], expectedHeaders: string[]) {
  if (!values.length) return [] as Record<string, string>[];
  const actualHeaders = (values[0] || []).map((value) => String(value ?? "").trim());
  const records = values.slice(1).map((source) => {
    const row: Record<string, string> = {};
    for (const header of expectedHeaders) {
      const index = actualHeaders.indexOf(header);
      row[header] = index >= 0 ? String(source?.[index] ?? "") : "";
    }
    return row;
  });
  return records.filter((row) => Object.values(row).some((value) => String(value).trim()));
}
function normalizePayload(payload: string, headers: string[]) {
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(payload || "{}"); } catch {}
  const row: Record<string, string> = {};
  for (const header of headers) row[header] = String(parsed?.[header] ?? "");
  return row;
}

async function tursoPipeline(base: string, token: string, requests: Array<Record<string, unknown>>) {
  const response = await fetch(`${base}/v2/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [...requests, { type: "close" }] }),
    cache: "no-store",
    signal: AbortSignal.timeout(45_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Turso returned ${response.status}: ${text.slice(0, 500)}`);
  const json = JSON.parse(text) as { results?: TursoResult[] };
  const results = json.results || [];
  const failed = results.find((result) => result?.type === "error" || result?.response?.type === "error");
  if (failed) throw new Error(`Turso statement failed: ${JSON.stringify(failed).slice(0, 700)}`);
  return results;
}

export async function GET(request: NextRequest) {
  if (process.env.VERCEL_ENV !== "preview") return new NextResponse(null, { status: 404 });

  const requestedSport = String(request.nextUrl.searchParams.get("sport") || "MLB").toUpperCase();
  if (!(["MLB", "NFL", "NCAAF"] as string[]).includes(requestedSport)) {
    return NextResponse.json({ ok: false, error: "sport must be MLB, NFL, or NCAAF" }, { status: 400 });
  }
  const sport = requestedSport as Sport;
  const requestedDatasets = String(request.nextUrl.searchParams.get("datasets") || "")
    .split(",").map((value) => value.trim()).filter(Boolean);
  const wantedDatasets = requestedDatasets.length ? requestedDatasets : DEFAULT_DATASETS[sport];

  try {
    const rawUrl = firstEnv(URL_ENV_NAMES);
    const token = firstEnv(TOKEN_ENV_NAMES);
    if (!rawUrl || !token) throw new Error("Turso is not configured in this preview deployment.");
    const base = endpoint(rawUrl);

    const auth = new google.auth.GoogleAuth({
      credentials: googleCredentials(),
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly", "https://www.googleapis.com/auth/drive.readonly"],
    });
    const sheets = google.sheets({ version: "v4", auth });
    const drive = google.drive({ version: "v3", auth });

    const findByName = async (name: string) => {
      if (!name) return "";
      const escaped = name.replaceAll("'", "\\'");
      const response = await drive.files.list({
        q: `name='${escaped}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
        fields: "files(id,name)", pageSize: 10, supportsAllDrives: true, includeItemsFromAllDrives: true,
      });
      return String(response.data.files?.[0]?.id || "");
    };
    const resolveConfigured = async (ids: string[], names: string[], defaultName: string) => {
      for (const key of ids) {
        const id = extractSpreadsheetId(String(process.env[key] || ""));
        if (id) return { id, shared: false };
      }
      for (const key of names) {
        const configured = String(process.env[key] || "").trim();
        const id = extractSpreadsheetId(configured);
        if (id) return { id, shared: false };
        if (configured) {
          const found = await findByName(configured);
          if (found) return { id: found, shared: false };
        }
      }
      if (defaultName) {
        const found = await findByName(defaultName);
        if (found) return { id: found, shared: false };
      }
      const sharedRaw = String(process.env.GOOGLE_SHEET_ID || process.env.GOOGLE_SHEET_NAME || "").trim();
      let sharedId = extractSpreadsheetId(sharedRaw);
      if (!sharedId && sharedRaw) sharedId = await findByName(sharedRaw);
      return { id: sharedId, shared: Boolean(sharedId) };
    };

    const workbook = sport === "MLB"
      ? await resolveConfigured(["GOOGLE_SHEET_ID", "GOOGLE_SPREADSHEET_ID", "SPREADSHEET_ID"], ["GOOGLE_SHEET_NAME"], "")
      : sport === "NFL"
        ? await resolveConfigured(["NFL_GOOGLE_SHEET_ID"], ["NFL_GOOGLE_SHEET_NAME"], "NFL Model Database")
        : await resolveConfigured(["CFB_GOOGLE_SHEET_ID", "NCAAF_GOOGLE_SHEET_ID"], ["CFB_GOOGLE_SHEET_NAME", "NCAAF_GOOGLE_SHEET_NAME"], "CFB Model Database");
    if (!workbook.id) throw new Error(`Could not resolve the ${sport} Google workbook.`);

    const manifestResults = await tursoPipeline(base, token, [{
      type: "execute",
      stmt: {
        sql: `SELECT dataset,source_workbook,source_worksheet,headers_json,row_count,imported_at,source_kind FROM dataset_manifest WHERE sport=${sqlText(sport)} ORDER BY dataset`,
        args: [],
      },
    }]);
    const manifest = tursoRows(manifestResults[0]) as unknown as ManifestRow[];
    const byDataset = new Map(manifest.map((row) => [row.dataset, row]));

    const metadata = await sheets.spreadsheets.get({
      spreadsheetId: workbook.id,
      fields: "properties(title),sheets.properties(title)",
    });
    const workbookTitle = String(metadata.data.properties?.title || workbook.id);
    const titles = new Set((metadata.data.sheets || []).map((sheet) => String(sheet.properties?.title || "").trim()).filter(Boolean));

    const plan = wantedDatasets.map((dataset) => {
      const manifestRow = byDataset.get(dataset);
      const candidates = sport === "NFL"
        ? [dataset, `nfl_${dataset}`]
        : sport === "NCAAF"
          ? [dataset, `cfb_${dataset}`, `ncaaf_${dataset}`]
          : [dataset];
      if (manifestRow?.source_kind === "google_sheets" && manifestRow.source_worksheet) candidates.unshift(manifestRow.source_worksheet);
      const physical = candidates.find((candidate) => titles.has(candidate)) || "";
      let headers: string[] = [];
      try { headers = JSON.parse(manifestRow?.headers_json || "[]"); } catch {}
      return { dataset, physical, headers, manifestRow };
    });

    const readable = plan.filter((item) => item.physical && item.headers.length);
    const sheetResponse = readable.length ? await sheets.spreadsheets.values.batchGet({
      spreadsheetId: workbook.id,
      ranges: readable.map((item) => quoteSheet(item.physical)),
      majorDimension: "ROWS",
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    }) : { data: { valueRanges: [] } };

    const sheetRows = new Map<string, Record<string, string>[]>();
    readable.forEach((item, index) => {
      const values = (sheetResponse.data.valueRanges?.[index]?.values || []) as unknown[][];
      sheetRows.set(item.dataset, projectRows(values, item.headers));
    });

    const results = [] as Array<Record<string, unknown>>;
    for (const item of plan) {
      if (!item.manifestRow) {
        results.push({ dataset: item.dataset, ok: false, reason: "missing_turso_manifest" });
        continue;
      }
      if (!item.physical) {
        results.push({ dataset: item.dataset, ok: false, reason: "missing_google_worksheet" });
        continue;
      }
      if (!item.headers.length) {
        results.push({ dataset: item.dataset, ok: false, reason: "missing_manifest_headers" });
        continue;
      }

      const tursoResult = await tursoPipeline(base, token, [{
        type: "execute",
        stmt: {
          sql: `SELECT payload_json FROM dataset_rows WHERE sport=${sqlText(sport)} AND dataset=${sqlText(item.dataset)} ORDER BY row_index ASC`,
          args: [],
        },
      }]);
      const tursoData = tursoRows(tursoResult[0]).map((row) => normalizePayload(row.payload_json || "{}", item.headers));
      const googleData = sheetRows.get(item.dataset) || [];
      const googleHash = digest(googleData);
      const tursoHash = digest(tursoData);
      const rowCountMatch = googleData.length === tursoData.length;
      const contentMatch = googleHash === tursoHash;
      results.push({
        dataset: item.dataset,
        worksheet: item.physical,
        ok: rowCountMatch && contentMatch,
        googleRows: googleData.length,
        tursoRows: tursoData.length,
        rowCountMatch,
        contentMatch,
        googleHash,
        tursoHash,
        tursoUpdatedAt: item.manifestRow.imported_at,
      });
    }

    const matches = results.filter((result) => result.ok).length;
    return NextResponse.json({
      ok: matches === results.length,
      sport,
      workbook: workbookTitle,
      checked: results.length,
      matches,
      mismatches: results.length - matches,
      results,
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: String(error?.message || error || "Unknown parity error").slice(0, 1200) }, { status: 500 });
  }
}
