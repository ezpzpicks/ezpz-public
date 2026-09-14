import fs from "node:fs";

const path = "app/api/public-data-core.ts";
let text = fs.readFileSync(path, "utf8");

text = text.replace('import { google } from "googleapis";\n', "");
const tursoImport = 'import { appendTursoDataset, isTursoConfigured, readTursoDataset, replaceTursoDataset } from "../../lib/tursoStore";\n';
if (!text.includes(tursoImport)) {
  const anchor = 'import { buildFootballPublicData } from "../../lib/footballPublicData";\n';
  if (!text.includes(anchor)) throw new Error("public-data import anchor not found");
  text = text.replace(anchor, anchor + tursoImport);
}

const matrixStart = text.indexOf("type WorksheetMatrixRow = {");
const queueStart = text.indexOf("let publicSplitPersistenceQueue", matrixStart);
if (matrixStart < 0 || queueStart < 0) throw new Error("worksheet helper block markers not found");

const helperBlock = `type WorksheetMatrixRow = {
  sheetRow: number;
  values: string[];
  object: SheetRow;
};

type WorksheetMatrix = {
  headers: string[];
  rows: WorksheetMatrixRow[];
};

type SheetBlockUpdate = {
  sheetRow: number;
  fields: SheetRow;
};

function assertTursoStorage() {
  if (!isTursoConfigured()) {
    throw new Error("Turso is not configured. Google Sheets is no longer a production fallback.");
  }
}

function mainSheetsClient() {
  assertTursoStorage();
  return { spreadsheetId: "turso:MLB", sheets: null as any };
}

function matrixFromDataset(headers: string[], sourceRows: SheetRow[]): WorksheetMatrix {
  const rows = sourceRows.map((source, index) => {
    const object: SheetRow = {};
    for (const header of headers) object[header] = String(source?.[header] ?? "");
    return {
      sheetRow: index + 2,
      values: headers.map((header) => object[header]),
      object,
    };
  });
  return { headers, rows };
}

async function ensureWorksheet(
  _sheets: any,
  _spreadsheetId: string,
  tabName: string,
  headers: string[] = [],
) {
  assertTursoStorage();
  const existing = await readTursoDataset("MLB", tabName);
  if (!existing) {
    await replaceTursoDataset("MLB", tabName, [], headers);
    invalidateWorksheetReadCache(tabName);
    return;
  }
  const merged = [...(existing.headers || [])];
  for (const header of headers) if (header && !merged.includes(header)) merged.push(header);
  if (merged.length !== (existing.headers || []).length) {
    await replaceTursoDataset("MLB", tabName, existing.rows, merged);
    invalidateWorksheetReadCache(tabName);
  }
}

async function readWorksheetMatrixWithClient(
  _sheets: any,
  _spreadsheetId: string,
  tabName: string,
  createHeaders: string[] = [],
): Promise<WorksheetMatrix> {
  assertTursoStorage();
  await ensureWorksheet(null, "turso:MLB", tabName, createHeaders);
  const dataset = await readTursoDataset("MLB", tabName);
  const headers = [...(dataset?.headers || [])];
  for (const header of createHeaders) if (header && !headers.includes(header)) headers.push(header);
  return matrixFromDataset(headers, (dataset?.rows || []) as SheetRow[]);
}

async function writeWholeWorksheet(
  _sheets: any,
  _spreadsheetId: string,
  tabName: string,
  headers: string[],
  rows: SheetRow[],
) {
  assertTursoStorage();
  await replaceTursoDataset("MLB", tabName, rows, headers);
  invalidateWorksheetReadCache(tabName);
}

async function appendWorksheetRows(
  _sheets: any,
  _spreadsheetId: string,
  tabName: string,
  headers: string[],
  rows: SheetRow[],
) {
  if (!rows.length) return;
  assertTursoStorage();
  await ensureWorksheet(null, "turso:MLB", tabName, headers);
  await appendTursoDataset("MLB", tabName, rows);
  invalidateWorksheetReadCache(tabName);
}

async function writeWorksheetBlocks(
  _sheets: any,
  _spreadsheetId: string,
  tabName: string,
  matrix: WorksheetMatrix,
  updates: SheetBlockUpdate[],
  _startHeader: string,
  _endHeader: string,
) {
  if (!updates.length) return;
  assertTursoStorage();
  const headers = [...matrix.headers];
  for (const update of updates) {
    for (const key of Object.keys(update.fields || {})) {
      if (key && !headers.includes(key)) headers.push(key);
    }
  }
  const rows = matrix.rows.map((entry) => ({ ...entry.object }));
  for (const update of updates) {
    const index = Number(update.sheetRow) - 2;
    if (index < 0 || index >= rows.length) continue;
    rows[index] = { ...rows[index], ...update.fields };
  }
  await replaceTursoDataset("MLB", tabName, rows, headers);
  invalidateWorksheetReadCache(tabName);
}

`;
text = text.slice(0, matrixStart) + helperBlock + text.slice(queueStart);

// UFC is no longer a public-site tab, but keep its response contract harmlessly
// Turso-backed until the response type is removed in a separate UI cleanup.
const serviceStart = text.indexOf("function serviceAccountFromEnv()");
const ufcReadStart = text.indexOf("async function readUfcWorksheet", serviceStart);
if (serviceStart >= 0 && ufcReadStart >= 0) {
  const afterUfcRead = text.slice(ufcReadStart + 1).search(/\n(?:async )?function\s+/);
  if (afterUfcRead < 0) throw new Error("function following readUfcWorksheet not found");
  const ufcBlockEnd = ufcReadStart + 1 + afterUfcRead + 1;
  const ufcReplacement = `async function readUfcWorksheet(tabName: string): Promise<SheetRow[]> {
  assertTursoStorage();
  const dataset = await readTursoDataset("UFC", tabName);
  return ((dataset?.rows || []) as SheetRow[]).map((row) => ({ ...row }));
}

`;
  text = text.slice(0, serviceStart) + ufcReplacement + text.slice(ufcBlockEnd);
}

text = text
  .replaceAll("Response is stale while Google Sheets recovers", "Response is stale while data refresh recovers")
  .replaceAll("Google Sheets quota", "storage quota")
  .replaceAll("Sheets quota", "storage quota");

if (text.includes('from "googleapis"') || text.includes("google.")) {
  throw new Error("googleapis runtime reference remains in public-data-core.ts");
}

fs.writeFileSync(path, text);

// Trend lifecycle no longer uses the Google client; remove the obsolete import
// so the runtime has no googleapis dependency after the storage cutover.
const lifecyclePath = "lib/mlbTrendV2Lifecycle.ts";
let lifecycle = fs.readFileSync(lifecyclePath, "utf8");
lifecycle = lifecycle.replace('import { google } from "googleapis";\n', "");
if (lifecycle.includes('from "googleapis"') || lifecycle.includes("google.")) {
  throw new Error("googleapis runtime reference remains in mlbTrendV2Lifecycle.ts");
}
fs.writeFileSync(lifecyclePath, lifecycle);

fs.rmSync("scripts/turso_source_cutover.mjs", { force: true });
fs.rmSync(".github/workflows/turso-source-cutover.yml", { force: true });
