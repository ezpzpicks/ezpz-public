import { google } from "googleapis";

export type SheetRow = Record<string, string>;

// Keep these broad so your existing public-data route can import them safely.
// Your route can still request any worksheet; these are just the expected public columns.
export const SLATE_COLUMNS = [
  "Game ID",
  "Game Label",
  "Away Team",
  "Home Team",
  "Better ML",
  "ML Grade",
  "ML Odds",
  "Moneyline Odds",
  "Odds",
  "NRFI Grade",
  "Away Pitcher K + Grade",
  "Home Pitcher K + Grade",
  "Away Pitcher K Score",
  "Home Pitcher K Score",
  "Total Runs Projection",
  "Total Runs Grade",
  "Total Runs Line",
  "Total Runs Edge",
  "Total Runs Confluence",
  "Total Runs Odds",
  "Away Pitcher Headshot URL",
  "Away Pitcher Headshot",
  "Away Pitcher Image URL",
  "Home Pitcher Headshot URL",
  "Home Pitcher Headshot",
  "Home Pitcher Image URL",
];

export const TRACKER_COLUMNS = [
  "Date",
  "Game",
  "Play",
  "Play Type",
  "Bet Type",
  "Market",
  "Odds",
  "Odds/Line",
  "Line",
  "Result",
  "Status",
  "Units Won",
  "Units",
  "Score",
  "Is Green",
  "Away Team",
  "Home Team",
  "Headshot URL",
  "Player Team",
  "Moneyline %",
  "Projected Ks",
  "6-Inning Ks",
  "Six Inning Ks",
  "Volatility",
  "Alt Line",
  "Alt Odds",
  "Total Runs Projection",
  "Total Runs Line",
  "Total Runs Edge",
  "Total Runs Confluence",
  "Favorite Pick",
  "Handpicked Record",
  "Favorite Rank",
  "Favorite Tag",
  "Favorite Notes",
];

function parseCredentials() {
  const raw = process.env.GOOGLE_CREDENTIALS;
  if (!raw) {
    throw new Error("Missing GOOGLE_CREDENTIALS environment variable.");
  }

  try {
    return JSON.parse(raw);
  } catch {
    // Handles env vars that were pasted with escaped newlines/extra wrapping.
    return JSON.parse(raw.replace(/\\n/g, "\n"));
  }
}

let authPromise: Promise<InstanceType<typeof google.auth.GoogleAuth>> | null = null;

async function getAuth() {
  if (!authPromise) {
    authPromise = Promise.resolve(
      new google.auth.GoogleAuth({
        credentials: parseCredentials(),
        scopes: [
          "https://www.googleapis.com/auth/spreadsheets.readonly",
          "https://www.googleapis.com/auth/drive.readonly",
        ],
      }),
    );
  }
  return authPromise;
}

async function getAccessToken() {
  const auth = await getAuth();
  const accessToken = await auth.getAccessToken();
  if (!accessToken) {
    throw new Error("Google auth returned an empty access token.");
  }
  return accessToken;
}

function extractSpreadsheetId(value: string) {
  const trimmed = String(value || "").trim();
  const urlMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (urlMatch?.[1]) return urlMatch[1];

  // Raw spreadsheet IDs are usually long and contain letters, numbers, _ and -.
  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) return trimmed;

  return "";
}

async function resolveSpreadsheetId(accessToken: string) {
  const configured = process.env.GOOGLE_SHEET_ID || process.env.GOOGLE_SHEET_NAME || "";
  const directId = extractSpreadsheetId(configured);
  if (directId) return directId;

  if (!configured.trim()) {
    throw new Error("Missing GOOGLE_SHEET_NAME or GOOGLE_SHEET_ID environment variable.");
  }

  const query = `name='${configured.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", query);
  url.searchParams.set("fields", "files(id,name)");
  url.searchParams.set("pageSize", "10");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Could not find Google Sheet by name: ${response.status} ${text}`);
  }

  const json = await response.json();
  const file = json.files?.[0];
  if (!file?.id) {
    throw new Error(`No Google Sheet found named "${configured}". Make sure it is shared with the service account email.`);
  }

  return String(file.id);
}

function rowsToObjects(values: string[][], columns?: string[]) {
  if (!values.length) return [];

  const header = values[0].map((cell) => String(cell || "").trim());
  const wanted = columns && columns.length ? columns : header;

  return values.slice(1).map((row) => {
    const object: SheetRow = {};

    for (const column of wanted) {
      const index = header.findIndex((h) => h.toLowerCase() === column.toLowerCase());
      object[column] = index >= 0 ? String(row[index] ?? "").trim() : "";
    }

    // Also preserve every raw header from the sheet so old route code can reference custom names.
    header.forEach((column, index) => {
      if (column && object[column] === undefined) {
        object[column] = String(row[index] ?? "").trim();
      }
    });

    return object;
  });
}

export async function readWorksheet(worksheetName: string, columns?: string[]): Promise<SheetRow[]> {
  const accessToken = await getAccessToken();
  const spreadsheetId = await resolveSpreadsheetId(accessToken);
  const encodedRange = encodeURIComponent(`'${worksheetName}'`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodedRange}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Could not read worksheet "${worksheetName}": ${response.status} ${text}`);
  }

  const json = await response.json();
  return rowsToObjects((json.values || []) as string[][], columns);
}
