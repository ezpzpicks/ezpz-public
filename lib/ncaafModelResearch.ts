import { footballTeamKey, footballTeamPair } from "./footballTeamTrends";
import type { SheetRow } from "./sportSheets";

function num(value: unknown): number | null {
  if (value == null || String(value).trim() === "") return null;
  const n = Number(String(value).replace(/[−–—]/g, "-"));
  return Number.isFinite(n) ? n : null;
}
function key(value: unknown) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
export function ncaafResearchTrackerKey(row: SheetRow) {
  return [String(row.Date || "").slice(0, 10), row["Game ID"] || row["Game Key"] || "",
    key(row["Bet Type"] || row.Market), key(row.Selection)].join("|");
}

const RESEARCH_FIELDS = ["Margin Residual", "Total Residual", "Closing Line", "Closing Line Value",
  "Closing Line Source", "Closing Line Provider", "Closing Line Captured At"];

/** Public display rows can have derived grades; persist research fields only. */
export function mergeNcaafResearchPatches(stored: SheetRow[], changes: SheetRow[]) {
  const originals = new Map(stored.map(row => [ncaafResearchTrackerKey(row), row]));
  return changes.flatMap(change => {
    const original = originals.get(ncaafResearchTrackerKey(change));
    if (!original) return [];
    const fields = Object.fromEntries(RESEARCH_FIELDS.filter(field => field in change
      && String(change[field] ?? "").trim() !== ""
      && String(original[field] ?? "").trim() === ""
      && (!field.startsWith("Closing Line") || num(original["Closing Line"]) == null))
      .map(field => [field, change[field]]));
    if (!Object.keys(fields).length) return [];
    return [{ ...original, ...fields }];
  });
}

/** Reuse already-loaded results/history. Never fetch odds, change picks, or grade outcomes. */
export function ncaafModelResearchPatches(tracker: SheetRow[], history: SheetRow[]) {
  const byGame = new Map(history.filter(row => row["Game ID"] && row.Date).map(row =>
    [`${row.Date.slice(0, 10)}|${row["Game ID"]}`, row]));
  const changed: SheetRow[] = [];
  for (const row of tracker) {
    const market = key(row["Bet Type"] || row.Market);
    if (!["spread", "total"].includes(market)) continue;
    const patch: SheetRow = {};
    const a = num(row["Actual Away"]), h = num(row["Actual Home"]);
    const pa = num(row["Projected Away"]), ph = num(row["Projected Home"]);
    if (a != null && h != null && pa != null && ph != null && /^(win|loss|push|w|l|p)$/i.test(row.Result || "")) {
      if (num(row["Margin Residual"]) == null) patch["Margin Residual"] = String(Math.round(((h - a) - (ph - pa)) * 10000) / 10000);
      if (num(row["Total Residual"]) == null) patch["Total Residual"] = String(Math.round(((h + a) - (ph + pa)) * 10000) / 10000);
    }
    const close = byGame.get(`${String(row.Date || "").slice(0, 10)}|${row["Game ID"] || ""}`);
    const entry = String(row.Selection || "").replace(/[−–—]/g, "-").match(/([+-]?\d+(?:\.\d+)?)\s*$/);
    // Historical generic ESPN quotes are useful research references, but they
    // cannot silently become an observed explicit closing quote in the tracker.
    if (close?.["Closing Quote Kind"] === "EXPLICIT_CLOSE" && entry && num(row["Closing Line"]) == null) {
      const originalLine = Number(entry[1]);
      let selectedClose: number | null = null, clv: number | null = null;
      const pair = footballTeamPair(row), closingPair = footballTeamPair(close);
      const sameMatch = pair && closingPair && pair.every((team, i) =>
        footballTeamKey(team, "NCAAF") === footballTeamKey(closingPair[i], "NCAAF"));
      if (sameMatch && market === "total") {
        selectedClose = num(close["Closing Total"]);
        const side = key(row.Selection).split(" ")[0];
        if (selectedClose != null && selectedClose > 0 && ["over", "under"].includes(side))
          clv = (selectedClose - originalLine) * (side === "over" ? 1 : -1);
      } else if (sameMatch && market === "spread") {
        const homeClose = num(close["Closing Home Spread"]);
        const picked = footballTeamKey(row.Selection.slice(0, entry.index).trim(), "NCAAF");
        const away = footballTeamKey(closingPair![0], "NCAAF"), home = footballTeamKey(closingPair![1], "NCAAF");
        if (homeClose != null && (picked === home || picked === away)) {
          selectedClose = picked === home ? homeClose : -homeClose;
          clv = originalLine - selectedClose;
        }
      }
      if (selectedClose != null && clv != null) Object.assign(patch, {
        "Closing Line": String(selectedClose), "Closing Line Value": String(Math.round(clv * 10000) / 10000),
        "Closing Line Source": "ESPN explicit close", "Closing Line Provider": close["Closing Provider"] || "",
        "Closing Line Captured At": close["History Checked At"] || "",
      });
    }
    if (Object.keys(patch).length) changed.push({ ...row, ...patch });
  }
  return changed;
}
