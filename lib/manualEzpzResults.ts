import { standardOfficialTracking } from "./officialTracking";
import { getApprovedManualPicks, type ManualApprovedPick } from "./manualEzpzPicks";
import { settleApprovedManualPick, type ManualFinal } from "./manualEzpzSettlement";
import { readTursoDatasetByDateKeys } from "./tursoStore";
import type { McpSport } from "./ezpzMcpPicks";

const scores = new Map<string, { at: number; value: Promise<ManualFinal[]> }>();
function number(value: unknown) {
  return value == null || String(value).trim() === "" ? NaN : Number(value);
}
async function savedFinals(sport: McpSport, dates: string[], now: number): Promise<ManualFinal[]> {
  const key = `${sport}|${dates.join(",")}`, previous = scores.get(key);
  if (previous && now - previous.at < 30000) return previous.value;
  const value = (async () => {
    const keys = dates.flatMap(date => { const [y, m, d] = date.split("-"); return [date, `${Number(m)}/${Number(d)}/${y}`, `${m}/${d}/${y}`]; });
    const rows = await readTursoDatasetByDateKeys(sport, "schedule", keys);
    return rows.map(row => {
      const stamp = Date.parse(row["Game Time"] || row.Time || "");
      const date = /^\d{4}-\d{2}-\d{2}$/.test(row.Date || "") ? row.Date : Number.isFinite(stamp)
        ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(stamp)) : "";
      return { sport, date, gameId: row["Game ID"] || "", gameTime: row["Game Time"] || row.Time || "",
        completed: /^(?:true|yes|1)$/i.test(row.Completed || ""), status: row.Status || "",
        away: { name: row["Away Team"] || "", score: number(row["Away Score"] ?? row["Actual Away"]) },
        home: { name: row["Home Team"] || "", score: number(row["Home Score"] ?? row["Actual Home"]) },
        observedAt: row["Result Updated"] || "", source: row.Source || "" };
    });
  })();
  if (scores.size > 30) scores.clear();
  scores.set(key, { at: now, value });
  try { return await value; } catch (error) { scores.delete(key); throw error; }
}

/** Public reads use already captured scores; they never collect games or change approval records. */
export async function readApprovedManualPickResults(sport: McpSport, date?: string, now = Date.now()): Promise<ManualApprovedPick[]> {
  const picks = getApprovedManualPicks(sport, date, now);
  const dates = [...new Set(picks.filter(pick => (!pick.result || pick.result === "PENDING")
    && Date.parse(pick.gameTime) < now).map(pick => pick.date))].sort();
  if (!dates.length) return picks.map(standardOfficialTracking);
  try {
    const finals: ManualFinal[] = [];
    for (let offset = 0; offset < dates.length; offset += 30)
      finals.push(...await savedFinals(sport, dates.slice(offset, offset + 30), now));
    return picks.map(pick => standardOfficialTracking(settleApprovedManualPick(pick, finals, now)));
  } catch {
    // A results outage cannot hide an approved selection or fabricate a settlement.
    return picks.map(standardOfficialTracking);
  }
}
