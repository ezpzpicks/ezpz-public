import {
  readTursoDataset,
  replaceTursoDataset,
  type TursoRow,
  type TursoSport,
} from "./tursoStore";
import { isPublicSplitEzpzPick } from "./ezpzPublicSplitEligibility";
import { NFL_EZPZ_POLICY_VERSION } from "./nflEzpzPolicy";
import { NCAAF_EZPZ_POLICY_VERSION } from "./ncaafEzpzPolicy";
import { captureEzpzFinalPickEvents } from "./ezpzMcpEvents";

export type EzpzCurrentSport = Extract<TursoSport, "MLB" | "NFL" | "NCAAF">;

const DATASET = "current_ezpz_picks";
const HEADERS = [
  "Kind",
  "Date",
  "Updated At",
  "Source Updated At",
  "Pick Count",
  "Source Stale",
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

function normalizedDate(value: unknown) {
  const raw = String(value || "").trim();
  const iso = raw.match(/^(20\d{2})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(20\d{2})$/);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  return raw;
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

function currentPickEligible(pick: AnyRow, sport: EzpzCurrentSport) {
  if (sport === "MLB") return true;
  const version = sport === "NFL" ? NFL_EZPZ_POLICY_VERSION : NCAAF_EZPZ_POLICY_VERSION;
  return pick.selectorVersion === version && String(pick.trendSubtypeId || "").startsWith("catalog:")
    && (sport !== "NCAAF" || isPublicSplitEzpzPick(pick));
}

export async function persistEzpzCurrentPicks(
  sport: EzpzCurrentSport,
  payload: AnyRow,
) {
  const picks = (Array.isArray(payload?.aiPicks) ? payload.aiPicks : [])
    .filter((pick: AnyRow) => currentPickEligible(pick, sport));
  const date = normalizedDate(firstValue(payload?.today, payload?.date));
  const updatedAt = new Date().toISOString();
  const sourceUpdatedAt = String(firstValue(payload?.lastUpdated, payload?.generatedAt, updatedAt));
  const sourceStale = payload?.stale === true || payload?.draftKings?.stale === true
    || payload?.draftKings?.displayMode === "STALE_FALLBACK";

  const rows: TursoRow[] = [
    {
      Kind: "META",
      Date: date,
      "Updated At": updatedAt,
      "Source Updated At": sourceUpdatedAt,
      "Pick Count": String(picks.length),
      "Source Stale": sourceStale ? "TRUE" : "FALSE",
      "Details JSON": "",
    },
    ...picks.map((pick: AnyRow) => ({
      Kind: "PICK",
      Date: normalizedDate(firstValue(pick?.date, pick?.Date, date)),
      "Updated At": updatedAt,
      "Source Updated At": sourceUpdatedAt,
      "Pick Count": "",
      "Details JSON": safeJson(pick),
    })),
  ];

  await replaceTursoDataset(sport, DATASET, rows, HEADERS);
  // The durable snapshot owns the trigger. Delivery failures must not invalidate a saved pick.
  try {
    if (!sourceStale) await captureEzpzFinalPickEvents(sport, picks);
  } catch {
    console.warn("[ezpz-mcp] final-pick event capture deferred", { sport });
  }
}

export async function readEzpzCurrentPicks(sport: EzpzCurrentSport) {
  const rows = await readTursoDataset(sport, DATASET, HEADERS);
  const meta = rows.find((row) => String(row.Kind || "").toUpperCase() === "META");
  if (!meta) return null;

  const picks = rows
    .filter((row) => String(row.Kind || "").toUpperCase() === "PICK")
    .map((row) => parseJson(row["Details JSON"]))
    .filter((row): row is AnyRow => Boolean(row))
    .filter((pick) => currentPickEligible(pick, sport));

  return {
    sport,
    date: String(meta.Date || ""),
    updatedAt: String(meta["Updated At"] || ""),
    sourceUpdatedAt: String(meta["Source Updated At"] || ""),
    sourceStale: String(meta["Source Stale"] || "").toUpperCase() === "TRUE",
    pickCount: sport === "MLB" ? Number(meta["Pick Count"] || picks.length || 0) : picks.length,
    picks,
  };
}
