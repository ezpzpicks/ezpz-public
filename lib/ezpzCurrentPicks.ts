import {
  readTursoDataset,
  replaceTursoDataset,
  type TursoRow,
  type TursoSport,
} from "./tursoStore";

export type EzpzCurrentSport = Extract<TursoSport, "MLB" | "NFL" | "NCAAF">;

const DATASET = "current_ezpz_picks";
const HEADERS = [
  "Kind",
  "Date",
  "Updated At",
  "Source Updated At",
  "Pick Count",
  "Details JSON",
];

type AnyRow = Record<string, any>;

function firstValue(...values: unknown[]) {
  for (const value of values) {
    if (value === 0) return 0;
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "{}";
  }
}

function parseJson(value: unknown): AnyRow | null {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as AnyRow)
      : null;
  } catch {
    return null;
  }
}

export async function persistEzpzCurrentPicks(
  sport: EzpzCurrentSport,
  payload: AnyRow,
) {
  const picks = Array.isArray(payload?.aiPicks) ? payload.aiPicks : [];
  const date = String(firstValue(payload?.today, payload?.date));
  const updatedAt = new Date().toISOString();
  const sourceUpdatedAt = String(firstValue(payload?.lastUpdated, payload?.generatedAt, updatedAt));

  const rows: TursoRow[] = [
    {
      Kind: "META",
      Date: date,
      "Updated At": updatedAt,
      "Source Updated At": sourceUpdatedAt,
      "Pick Count": String(picks.length),
      "Details JSON": "",
    },
    ...picks.map((pick: AnyRow) => ({
      Kind: "PICK",
      Date: String(firstValue(pick?.date, pick?.Date, date)),
      "Updated At": updatedAt,
      "Source Updated At": sourceUpdatedAt,
      "Pick Count": "",
      "Details JSON": safeJson(pick),
    })),
  ];

  await replaceTursoDataset(sport, DATASET, rows, HEADERS);
}

export async function readEzpzCurrentPicks(sport: EzpzCurrentSport) {
  const rows = await readTursoDataset(sport, DATASET, HEADERS);
  const meta = rows.find((row) => String(row.Kind || "").toUpperCase() === "META");
  if (!meta) return null;

  const picks = rows
    .filter((row) => String(row.Kind || "").toUpperCase() === "PICK")
    .map((row) => parseJson(row["Details JSON"]))
    .filter((row): row is AnyRow => Boolean(row));

  return {
    sport,
    date: String(meta.Date || ""),
    updatedAt: String(meta["Updated At"] || ""),
    sourceUpdatedAt: String(meta["Source Updated At"] || ""),
    pickCount: Number(meta["Pick Count"] || picks.length || 0),
    picks,
  };
}
