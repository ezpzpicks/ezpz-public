import { google } from "googleapis";

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

const CORE_PUBLIC_TABS = [
  "daily_slate",
  "bet_tracker",
  "all_game_trends",
  "public_split_snapshots",
  "odds_snapshot",
] as const;

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

async function createSportSpreadsheet(config: SportSheetConfig) {
  const sheets = await sheetsClient();
  const response = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: config.spreadsheetName },
      sheets: CORE_PUBLIC_TABS.map((title) => ({
        properties: {
          title,
          gridProperties: { rowCount: 2000, columnCount: 120 },
        },
      })),
    },
    fields: "spreadsheetId,properties.title",
  });
  const spreadsheetId = String(response.data.spreadsheetId || "").trim();
  if (!spreadsheetId) {
    throw new Error(`${config.sport} database could not be created.`);
  }
  console.log(
    `Created ${config.sport} database "${config.spreadsheetName}" (${spreadsheetId}).`,
  );
  return spreadsheetId;
}

const spreadsheetIdCache = new Map<FootballSport, string>();
const spreadsheetResolutionInFlight = new Map<FootballSport, Promise<string>>();

export async function resolveSportSpreadsheetId(sport: FootballSport) {
  const cached = spreadsheetIdCache.get(sport);
  if (cached) return cached;

  const active = spreadsheetResolutionInFlight.get(sport);
  if (active) return active;

  const operation = (async () => {
    const config = sportSheetConfig(sport);
    if (config.spreadsheetId) return config.spreadsheetId;

    const auth = await authClient();
    const drive = google.drive({ version: "v3", auth: auth as any });
    const escaped = config.spreadsheetName.replace(/'/g, "\\'");
    const response = await drive.files.list({
      q: `name='${escaped}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
      fields: "files(id,name)",
      pageSize: 10,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    const file = response.data.files?.[0];
    if (file?.id) return file.id;

    // The admin model also creates its sport workbook on first use. This
    // fallback removes the one-time manual dependency for a brand-new sport:
    // the public service creates the same named workbook and standard public
    // tabs, then the admin/model service opens that exact workbook by name and
    // fills its model-specific tabs normally.
    return createSportSpreadsheet(config);
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

export async function readSportWorksheet(
  sport: FootballSport,
  worksheetName: string,
  columns?: string[],
): Promise<SheetRow[]> {
  const spreadsheetId = await resolveSportSpreadsheetId(sport);
  const sheets = await sheetsClient();
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: quoteSheetName(worksheetName),
    });
    return rowsToObjects((response.data.values || []) as string[][], columns);
  } catch (error: any) {
    const code = Number(error?.code || error?.response?.status || 0);
    const message = String(error?.message || "");
    if (code === 400 && /unable to parse range|requested entity was not found/i.test(message)) {
      return [];
    }
    throw error;
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
  const titles = await worksheetTitles(sport);
  if (!titles.has(worksheetName)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: worksheetName,
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
      range: `${quoteSheetName(worksheetName)}!1:1`,
    });
    const current = (response.data.values?.[0] || []).map((value) => String(value || "").trim());
    if (!current.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${quoteSheetName(worksheetName)}!A1`,
        valueInputOption: "RAW",
        requestBody: { values: [headers] },
      });
    }
  }
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
  const values = rows.map((row) => headers.map((header) => String(row[header] ?? "")));
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: quoteSheetName(worksheetName),
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${quoteSheetName(worksheetName)}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [headers, ...values] },
  });
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

export function sportDatabaseLabel(sport: FootballSport) {
  const config = sportSheetConfig(sport);
  return config.spreadsheetName || config.spreadsheetId;
}
