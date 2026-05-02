import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";
import type { SheetRow } from "./metrics";

export const TRACKER_COLUMNS = [
  "Date", "Bet Type", "Selection", "Market", "Odds/Line",
  "Model %", "Implied %", "Edge %", "Result"
];

export const SLATE_COLUMNS = [
  "Date", "Game ID", "Game Label", "Away Team", "Home Team", "Better ML",
  "ML Odds", "ML Grade", "NRFI Grade", "Away Pitcher K + Grade",
  "Away Pitcher K Score", "Home Pitcher K + Grade", "Home Pitcher K Score"
];

function parseCredentials() {
  const raw = process.env.GOOGLE_CREDENTIALS;
  if (!raw) throw new Error("Missing GOOGLE_CREDENTIALS environment variable.");
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("GOOGLE_CREDENTIALS is not valid JSON.");
  }
}

async function getDoc() {
  const creds = parseCredentials();
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const sheetName = process.env.GOOGLE_SHEET_NAME;

  if (!sheetId && !sheetName) {
    throw new Error("Set GOOGLE_SHEET_ID if possible. GOOGLE_SHEET_NAME lookup is not supported by this public Next.js starter.");
  }

  const serviceAccountAuth = new JWT({
    email: creds.client_email,
    key: String(creds.private_key).replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive.file"],
  });

  const doc = new GoogleSpreadsheet(sheetId || sheetName!, serviceAccountAuth);
  await doc.loadInfo();
  return doc;
}

export async function readWorksheet(tabName: string, columns: string[]): Promise<SheetRow[]> {
  const doc = await getDoc();
  const sheet = doc.sheetsByTitle[tabName];
  if (!sheet) return [];
  const rows = await sheet.getRows();
  return rows.map((row) => {
    const obj: SheetRow = {};
    for (const header of sheet.headerValues) obj[header] = String(row.get(header) ?? "");
    for (const col of columns) {
      if (!(col in obj)) obj[col] = String(row.get(col) ?? "");
    }
    return obj;
  });
}
