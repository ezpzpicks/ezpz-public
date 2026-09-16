import { AnyRow } from "./mlbTrendV2";
import {
  appendTursoDataset,
  isTursoConfigured,
  readTursoDataset,
  replaceTursoDataset,
  type TursoRow,
} from "./tursoStore";

const SNAPSHOT_TAB = "trend_v2_snapshots";
const DAILY_PICK_TAB = "trend_v2_daily_picks";

export const V2_SNAPSHOT_HEADERS = [
  "Snapshot Time ET","Date","Game Key","Game Time","Game","Away Team","Home Team","Market","Selection","Side","Line","Odds","V2 Score","V2 Tier","V2 Market Gap","V2 Ranking Probability","Market Implied Probability","V2 Daily Rank","V2 Data Complete","V2 Direction","V2/Legacy Agreement","Legacy Trend Score","Legacy Trend Tier","Minutes To Start","Daily Eligible","Model Version","Details JSON",
];
export const V2_DAILY_PICK_HEADERS = [
  "Date","Candidate ID","Game Key","Game Time","Game","Away Team","Home Team","Market","Play","Selection","Line","Odds","V2 Score","V2 Tier","V2 Market Gap","V2 Ranking Probability","Market Implied Probability","Legacy Trend Score","Legacy Trend Tier","V2/Legacy Agreement","V2 Data Complete","Daily Rank","Early Premium","Required Gap","Locked At","Result","Units","Result Updated","Model Version","Details JSON",
];

function assertTursoConfigured() {
  if (!isTursoConfigured()) {
    throw new Error("Turso is not configured. No legacy storage fallback is available.");
  }
}

function tursoRows(rows: AnyRow[]): TursoRow[] {
  return rows.map((row) => {
    const out: TursoRow = {};
    for (const [key, value] of Object.entries(row || {})) out[key] = String(value ?? "");
    return out;
  });
}

function anyRows(rows: TursoRow[], headers: string[]): AnyRow[] {
  return rows.map((source) => {
    const row: AnyRow = {};
    for (const header of headers) row[header] = String(source?.[header] ?? "");
    return row;
  });
}

export async function readV2Tab(name: "snapshots" | "daily") {
  assertTursoConfigured();
  const tab = name === "snapshots" ? SNAPSHOT_TAB : DAILY_PICK_TAB;
  const headers = name === "snapshots" ? V2_SNAPSHOT_HEADERS : V2_DAILY_PICK_HEADERS;
  // A SELECT against a not-yet-created logical dataset safely returns no rows,
  // so there is no reason to perform a separate manifest existence read here.
  const rows = await readTursoDataset("MLB", tab, headers);
  return anyRows(rows, headers);
}

export async function appendV2Rows(name: "snapshots" | "daily", rows: AnyRow[]) {
  if (!rows.length) return;
  assertTursoConfigured();
  const tab = name === "snapshots" ? SNAPSHOT_TAB : DAILY_PICK_TAB;
  const headers = name === "snapshots" ? V2_SNAPSHOT_HEADERS : V2_DAILY_PICK_HEADERS;
  // appendTursoDataset creates/updates the manifest atomically with the append.
  await appendTursoDataset("MLB", tab, tursoRows(rows), headers);
}

export async function replaceV2DailyRows(rows: AnyRow[]) {
  assertTursoConfigured();
  await replaceTursoDataset("MLB", DAILY_PICK_TAB, tursoRows(rows), V2_DAILY_PICK_HEADERS);
}
