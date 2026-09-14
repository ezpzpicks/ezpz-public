import { google } from "googleapis";
import { unstable_cache } from "next/cache";
import {
  appendTursoDataset,
  isTursoConfigured,
  replaceTursoDataset,
} from "./tursoStore";

export type FootballSport = "NFL" | "NCAAF";
export type SheetRow = Record<string, string>;

type SportSheetConfig = {
  sport: FootballSport;
  spreadsheetId: string;
  spreadsheetName: string;
};

const DEFAULT_NAMES: Record<FootballSport, string> = {
  NFL: "NFL Model Database",
  NCAAF: "CFB Model Database",
};

function parseCredentials() {
  const raw = String(process.env.GOOGLE_CREDENTIALS || "").trim();
  if (!raw) throw new Error("Missing GOOGLE_CREDENTIALS environment variable.");
  try {
    return JSON.parse(raw);
  } catch {
    return JSON.parse(raw.replace(/\\n/g, "\n"));
  }
}

function firstEnv(names: string[]) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return value;
  }
  return "";
}

function extractSpreadsheetId(value: string) {
  const trimmed = String(value || "").trim();
  const urlMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (urlMatch?.[1]) return urlMatch[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) return trimmed;
  return "";
}

function sportSheetConfig(sport: FootballSport): SportSheetConfig {
  if (sport === "NFL") {
    return {
      sport,
      spreadsheetId: firstEnv(["NFL_GOOGLE_SHEET_ID"]),
      spreadsheetName: firstEnv(["NFL_GOOGLE_SHEET_NAME"]) || DEFAULT_NAMES.NFL,
    };
  }
  return {
    sport,
    spreadsheetId: firstEnv(["CFB_GOOGLE_SHEET_ID", "NCAAF_GOOGLE_SHEET_ID"]),
    spreadsheetName:
      firstEnv(["CFB_GOOGLE_SHEET_NAME", "NCAAF_GOOGLE_SHEET_NAME"]) || DEFAULT_NAMES.NCAAF,
  };
}

let authClientPromise: ReturnType<InstanceType<typeof google.auth.GoogleAuth>["getClient"]> | null = null;

async function authClient() {
  if (!authClientPromise) {
    const auth = new google.auth.GoogleAuth({
      credentials: parseCredentials(),
      scopes: [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive.readonly",
      ],
    });
    authClientPromise = auth.getClient();
  }
  return authClientPromise;
}

async function sheetsClient() {
  const auth = await authClient();
  return google.sheets({ version: "v4", auth: auth as any });
}

async function findSpreadsheetByName(name: string) {
  const auth = await authClient();
  const drive = google.drive({ version: "v3", auth: auth as any });
  const escaped = String(name).replace(/'/g, "\\'");
  const response = await drive.files.list({
    q: `name='${escaped}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
    fields: "files(id,name)",
    pageSize: 10,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return String(response.data.files?.[0]?.id || "").trim();
}

const spreadsheetIdCache = new Map<FootballSport, string>();
const spreadsheetResolutionInFlight = new Map<FootballSport, Promise<string>>();
const sharedContainerSports = new Set<FootballSport>();

const SPORT_WORKSHEET_READ_CACHE_TTL_MS = 60_000;
const SPORT_WORKSHEET_READ_STALE_MS = 30 * 60_000;
const SPORT_WORKSHEET_SHARED_CACHE_SECONDS = 60;

const VOLATILE_WORKSHEET_CACHE_TTL_MS = 5_000;
const VOLATILE_WORKSHEET_STALE_MS = 30_000;
const VOLATILE_WORKSHEETS = new Set(["prop_projections"]);

type SportWorksheetCacheEntry = {
  savedAt: number;
  rows: SheetRow[];
};

const sportWorksheetReadCache = new Map<string, SportWorksheetCacheEntry>();
const sportWorksheetReadInFlight = new Map<string, Promise<SheetRow[]>>();

function sportWorksheetCacheKey(sport: FootballSport, worksheetName: string) {
  return `${sport}|${worksheetName}`;
}

function sportWorksheetReadTtlMs(worksheetName: string) {
  return VOLATILE_WORKSHEETS.has(String(worksheetName || "").trim().toLowerCase())
    ? VOLATILE_WORKSHEET_CACHE_TTL_MS
    : SPORT_WORKSHEET_READ_CACHE_TTL_MS;
}

function sportWorksheetStaleMs(worksheetName: string) {
  return VOLATILE_WORKSHEETS.has(String(worksheetName || "").trim().toLowerCase())
    ? VOLATILE_WORKSHEET_STALE_MS
    : SPORT_WORKSHEET_READ_STALE_MS;
}

function copySportRows(rows: SheetRow[], columns?: string[]) {
  return rows.map((source) => {
    const row: SheetRow = { ...source };
    for (const column of columns || []) {
      if (row[column] === undefined) row[column] = "";
    }
    return row;
  });
}

async function mirrorSportReplace(
  sport: FootballSport,
  worksheetName: string,
  headers: string[],
  rows: SheetRow[],
) {
  if (!isTursoConfigured()) return;
  try {
    await replaceTursoDataset(sport, worksheetName, copySportRows(rows), headers);
  } catch (error) {
    console.error(
      `[turso-dual-write] ${sport}/${worksheetName} replace failed; Google Sheets remains authoritative.`,
      error,
    );
  }
}

async function mirrorSportAppend(
  sport: FootballSport,
  worksheetName: string,
  rows: SheetRow[],
) {
  if (!isTursoConfigured() || !rows.length) return;
  try {
    await appendTursoDataset(sport, worksheetName, copySportRows(rows));
  } catch (error) {
    console.error(
      `[turso-dual-write] ${sport}/${worksheetName} append failed; Google Sheets remains authoritative.`,
      error,
    );
  }
}

function isSheetsQuotaError(error: any) {
  const code = Number(error?.code || error?.response?.status || 0);
  const message = String(error?.message || error?.response?.data?.error?.message || "").toUpperCase();
  return (
    code === 429 ||
    (code === 403 && (message.includes("QUOTA") || message.includes("RATE LIMIT"))) ||
    message.includes("RATE_LIMIT_EXCEEDED") ||
    message.includes("QUOTA EXCEEDED") ||
    message.includes("READ REQUESTS PER MINUTE PER USER")
  );
}

function invalidateSportWorksheetReadCache(sport: FootballSport, worksheetName: string) {
  sportWorksheetReadCache.delete(sportWorksheetCacheKey(sport, worksheetName));
}

function physicalWorksheetName(sport: FootballSport, worksheetName: string) {
  return sharedContainerSports.has(sport)
    ? `${sport === "NCAAF" ? "cfb" : "nfl"}_${worksheetName}`
    : worksheetName;
}

async function resolveSharedContainerId(sport: FootballSport) {
  const configured = firstEnv(["GOOGLE_SHEET_ID", "GOOGLE_SHEET_NAME"]);
  if (!configured) {
    throw new Error(
      `${sport} database is not configured and no shared GOOGLE_SHEET_ID/GOOGLE_SHEET_NAME fallback is available.`,
    );
  }

  const direct = extractSpreadsheetId(configured);
  const spreadsheetId = direct || (await findSpreadsheetByName(configured));
  if (!spreadsheetId) {
    throw new Error(
      `${sport} database is not configured and the shared Google Sheet "${configured}" could not be found.`,
    );
  }
  sharedContainerSports.add(sport);
  return spreadsheetId;
}

export async function resolveSportSpreadsheetId(sport: FootballSport) {
  const cached = spreadsheetIdCache.get(sport);
  if (cached) return cached;

  const active = spreadsheetResolutionInFlight.get(sport);
  if (active) return active;

  const operation = (async () => {
    const config = sportSheetConfig(sport);
    if (config.spreadsheetId) return config.spreadsheetId;

    const dedicated = await findSpreadsheetByName(config.spreadsheetName);
    if (dedicated) return dedicated;

    return resolveSharedContainerId(sport);
  })();

  spreadsheetResolutionInFlight.set(sport, operation);
  try {
    const spreadsheetId = await operation;
    spreadsheetIdCache.set(sport, spreadsheetId);
    return spreadsheetId;
  } finally {
    spreadsheetResolutionInFlight.delete(sport);
  }
}

function rowsToObjects(values: string[][], columns?: string[]) {
  if (!values.length) return [] as SheetRow[];
  const header = values[0].map((value) => String(value || "").trim());
  const wanted = columns?.length ? columns : header;
  return values.slice(1).map((source) => {
    const row: SheetRow = {};
    for (const column of wanted) {
      const index = header.findIndex((value) => value.toLowerCase() === column.toLowerCase());
      row[column] = index >= 0 ? String(source[index] ?? "").trim() : "";
    }
    header.forEach((column, index) => {
      if (column && row[column] === undefined) row[column] = String(source[index] ?? "").trim();
    });
    return row;
  });
}

function quoteSheetName(name: string) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

const readSportWorksheetShared = unstable_cache(
  async (
    sport: FootballSport,
    worksheetName: string,
    _freshnessBucket = 0,
  ): Promise<SheetRow[]> => {
    const spreadsheetId = await resolveSportSpreadsheetId(sport);
    const sheets = await sheetsClient();
    const physicalName = physicalWorksheetName(sport, worksheetName);
    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: quoteSheetName(physicalName),
      });
      return rowsToObjects((response.data.values || []) as string[][]);
    } catch (error: any) {
      const code = Number(error?.code || error?.response?.status || 0);
      const message = String(error?.message || "");
      if (code === 400 && /unable to parse range|requested entity was not found/i.test(message)) {
        return [];
      }
      throw error;
    }
  },
  ["ezpz-public-sport-worksheet-v2"],
  { revalidate: SPORT_WORKSHEET_SHARED_CACHE_SECONDS },
);

export async function readSportWorksheet(
  sport: FootballSport,
  worksheetName: string,
  columns?: string[],
): Promise<SheetRow[]> {
  const key = sportWorksheetCacheKey(sport, worksheetName);
  const now = Date.now();
  const cacheTtlMs = sportWorksheetReadTtlMs(worksheetName);
  const staleMs = sportWorksheetStaleMs(worksheetName);
  const cached = sportWorksheetReadCache.get(key);

  if (cached && now - cached.savedAt < cacheTtlMs) {
    return copySportRows(cached.rows, columns);
  }

  const active = sportWorksheetReadInFlight.get(key);
  if (active) return copySportRows(await active, columns);

  const operation = (async () => {
    try {
      const freshnessBucket = cacheTtlMs < SPORT_WORKSHEET_READ_CACHE_TTL_MS
        ? Math.floor(Date.now() / cacheTtlMs)
        : 0;
      const rows = await readSportWorksheetShared(sport, worksheetName, freshnessBucket);
      sportWorksheetReadCache.set(key, { savedAt: Date.now(), rows: copySportRows(rows) });
      return rows;
    } catch (error: any) {
      if (cached && Date.now() - cached.savedAt < staleMs && isSheetsQuotaError(error)) {
        console.warn(`Using stale ${sport} ${worksheetName} worksheet cache after Sheets quota error.`);
        return copySportRows(cached.rows, columns);
      }
      throw error;
    }
  })();

  sportWorksheetReadInFlight.set(key, operation);
  try {
    return copySportRows(await operation, columns);
  } finally {
    if (sportWorksheetReadInFlight.get(key) === operation) {
      sportWorksheetReadInFlight.delete(key);
    }
  }
}

async function worksheetTitles(sport: FootballSport) {
  const spreadsheetId = await resolveSportSpreadsheetId(sport);
  const sheets = await sheetsClient();
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties(title)",
  });
  return new Set(
    (metadata.data.sheets || [])
      .map((sheet) => String(sheet.properties?.title || ""))
      .filter(Boolean),
  );
}

export async function ensureSportWorksheet(
  sport: FootballSport,
  worksheetName: string,
  headers: string[],
) {
  const spreadsheetId = await resolveSportSpreadsheetId(sport);
  const sheets = await sheetsClient();
  const physicalName = physicalWorksheetName(sport, worksheetName);
  const titles = await worksheetTitles(sport);
  if (!titles.has(physicalName)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: physicalName,
                gridProperties: { rowCount: 2000, columnCount: Math.max(20, headers.length + 5) },
              },
            },
          },
        ],
      },
    });
  }
  if (headers.length) {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${quoteSheetName(physicalName)}!1:1`,
    });
    const current = (response.data.values?.[0] || []).map((value) => String(value || "").trim());
    if (!current.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${quoteSheetName(physicalName)}!A1`,
        valueInputOption: "RAW",
        requestBody: { values: [headers] },
      });
    }
  }
  invalidateSportWorksheetReadCache(sport, worksheetName);
}

export async function writeSportWorksheet(
  sport: FootballSport,
  worksheetName: string,
  headers: string[],
  rows: SheetRow[],
) {
  await ensureSportWorksheet(sport, worksheetName, headers);
  const spreadsheetId = await resolveSportSpreadsheetId(sport);
  const sheets = await sheetsClient();
  const physicalName = physicalWorksheetName(sport, worksheetName);
  const values = rows.map((row) => headers.map((header) => String(row[header] ?? "")));
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: quoteSheetName(physicalName),
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${quoteSheetName(physicalName)}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [headers, ...values] },
  });
  invalidateSportWorksheetReadCache(sport, worksheetName);
  await mirrorSportReplace(sport, worksheetName, headers, rows);
}

export async function upsertSportRows(
  sport: FootballSport,
  worksheetName: string,
  headers: string[],
  rows: SheetRow[],
  keyFor: (row: SheetRow) => string,
) {
  const existing = await readSportWorksheet(sport, worksheetName, headers);
  const map = new Map<string, SheetRow>();
  for (const row of existing) {
    const key = keyFor(row);
    if (key) map.set(key, row);
  }
  for (const row of rows) {
    const key = keyFor(row);
    if (!key) continue;
    map.set(key, { ...(map.get(key) || {}), ...row });
  }
  await writeSportWorksheet(sport, worksheetName, headers, [...map.values()]);
}

export async function appendSportRows(
  sport: FootballSport,
  worksheetName: string,
  headers: string[],
  rows: SheetRow[],
) {
  if (!rows.length) return;
  await ensureSportWorksheet(sport, worksheetName, headers);
  const spreadsheetId = await resolveSportSpreadsheetId(sport);
  const sheets = await sheetsClient();
  const physicalName = physicalWorksheetName(sport, worksheetName);
  const values = rows.map((row) => headers.map((header) => String(row[header] ?? "")));
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${quoteSheetName(physicalName)}!A1`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });
  invalidateSportWorksheetReadCache(sport, worksheetName);
  await mirrorSportAppend(sport, worksheetName, rows);
}

export function sportDatabaseLabel(sport: FootballSport) {
  if (sharedContainerSports.has(sport)) {
    return `${sport === "NCAAF" ? "CFB" : "NFL"} namespace in shared model database`;
  }
  const config = sportSheetConfig(sport);
  return config.spreadsheetName || config.spreadsheetId;
}
