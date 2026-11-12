import { NextRequest, NextResponse } from "next/server";
import { MCP_SPORTS } from "../../../../lib/ezpzMcpPicks";
import { getApprovedManualPicks, manualPickForMcp } from "../../../../lib/manualEzpzPicks";
import { captureEzpzFinalPickEvents } from "../../../../lib/ezpzMcpEvents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const headers = { "Cache-Control": "no-store, max-age=0" };
const PUBLISH_LEAD_MS = 30 * 60_000;

/**
 * Publish trigger is deliberately independent of the signal/model builders.
 * A selected research candidate cannot become official from a scheduled job.
 * Only a manually approved manifest row within 30 minutes of kickoff
 * can enqueue an existing ezpz.pick.finalized subscription event.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401, headers });
  }
  const now = Date.now();
  const due = getApprovedManualPicks(undefined, undefined, now).filter(row => {
    const remaining = Date.parse(row.gameTime) - now;
    return remaining > 0 && remaining <= PUBLISH_LEAD_MS;
  });
  // Almost all checks have no due approved pick. Avoid any database reads/writes.
  if (!due.length) return NextResponse.json({ ok: true, eligible: 0, delivery: [] }, { headers });

  const delivery = [];
  for (const sport of MCP_SPORTS) {
    const picks = due.filter(row => row.sport === sport);
    if (!picks.length) continue;
    try {
      const result = await captureEzpzFinalPickEvents(sport, picks.map(manualPickForMcp), now);
      delivery.push({ sport, approved: picks.length, ...result, ok: true });
    } catch (error) {
      console.error("[ezpz-manual] approved-pick delivery failed", { sport, error });
      delivery.push({ sport, approved: picks.length, ok: false });
    }
  }
  const ok = delivery.every(result => result.ok);
  return NextResponse.json({ ok, eligible: due.length, delivery },
    { status: ok ? 200 : 500, headers });
}
