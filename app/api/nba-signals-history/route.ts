import { NextRequest, NextResponse } from "next/server";
import { readTursoDatasetByDateKeys } from "../../../lib/tursoStore";
import { readSavedFootballSignalsForDate } from "../../../lib/footballSignals";
import { NBA_SIGNALS_POLICY, NBA_SIGNALS_TAB } from "../../../lib/nbaTrendLeaderboard";
import { buildSignalResearchDays, buildSignalResearchReport } from "../../../lib/signalCombinationResearch";
import { readNbaSavedLineups } from "../../../lib/nbaLineups";

import { consolidatedSignalPolicy } from "../../../lib/catalog/consolidatedSportCatalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get("date") || "";
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T12:00:00Z`) : NaN;
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== date) {
    return NextResponse.json({ ok: false, error: "Choose a valid NBA slate date." }, { status: 400 });
  }
  try {
    const [rows, lineups] = await Promise.all([readTursoDatasetByDateKeys("NBA", NBA_SIGNALS_TAB, [date]), readNbaSavedLineups(date)]);
    const sides = readSavedFootballSignalsForDate(rows, date, Date.now(), NBA_SIGNALS_POLICY);
    const groupedPolicy = consolidatedSignalPolicy("NBA");
    const policy = sides.some(side => side.policyVersion === groupedPolicy) ? groupedPolicy : NBA_SIGNALS_POLICY.version;
    const research = buildSignalResearchReport("NBA", policy, buildSignalResearchDays(sides, policy));
    const legacyResearch = policy !== NBA_SIGNALS_POLICY.version ? buildSignalResearchReport("NBA", NBA_SIGNALS_POLICY.version,
      buildSignalResearchDays(sides, NBA_SIGNALS_POLICY.version)) : undefined;
    return NextResponse.json({ ok: true, sport: "NBA", date, sides, research, ...(legacyResearch ? { legacyResearch } : {}), lineups },
      { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    console.error("NBA Signals archive read failed", { date, error });
    return NextResponse.json({ ok: false, error: "The saved slate could not be loaded. Please try again." }, { status: 503 });
  }
}
