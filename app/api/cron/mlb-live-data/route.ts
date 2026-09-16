import { NextRequest, NextResponse } from "next/server";
import { GET as runPublicDataV2 } from "../../public-data-v2/route";
import { repairHistoricalEzpzGrades } from "../../../../lib/ezpzHistoricalGrading";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 180;

const MLB_TRACKING_START_MINUTE_ET = 10 * 60 + 30;
const MLB_TRACKING_END_MINUTE_ET = 4 * 60 + 30;
const RETRY_DELAYS_MS = [12_000];

function easternClock(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value || 0);
  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hour = get("hour");
  const minute = get("minute");
  return {
    date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    hour,
    minute,
    minuteOfDay: hour * 60 + minute,
  };
}

function isMlbTrackingWindow(minuteOfDay: number) {
  return (
    minuteOfDay >= MLB_TRACKING_START_MINUTE_ET ||
    minuteOfDay <= MLB_TRACKING_END_MINUTE_ET
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(request: NextRequest) {
  const cronSecret = String(process.env.CRON_SECRET || "").trim();
  if (!cronSecret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not configured." },
      { status: 500 },
    );
  }

  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const clock = easternClock();
  if (!isMlbTrackingWindow(clock.minuteOfDay)) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      source: "VERCEL_CRON",
      dateET: clock.date,
      timeET: `${String(clock.hour).padStart(2, "0")}:${String(clock.minute).padStart(2, "0")}`,
      reason: "Outside the 10:30 AM-4:30 AM ET MLB tracking window.",
    });
  }

  const target = new URL("/api/public-data-v2", request.url);
  target.searchParams.set("scheduled", "1");
  target.searchParams.set("tracking", "v2");
  target.searchParams.set("compact", "1");

  let lastStatus = 0;
  let lastError = "";

  for (let attempt = 1; attempt <= RETRY_DELAYS_MS.length + 1; attempt += 1) {
    try {
      // Run the refresh handler directly inside this invocation instead of
      // making an HTTP request back into the same Vercel deployment. The
      // previous self-fetch could return an intermediary/protected response
      // with HTTP 200 but no { ok: true }, causing the cron to report a false
      // 502 even though the underlying refresh route itself was healthy.
      const scheduledRequest = new NextRequest(target, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${cronSecret}`,
          "x-ezpz-v2-tracking": "true",
          "x-ezpz-scheduled-snapshot": "true",
          "x-ezpz-live-source": "vercel-cron",
        },
      });
      const response = await runPublicDataV2(scheduledRequest);

      lastStatus = response.status;
      const payload = await response.json().catch(() => null);
      if (response.ok && payload?.ok) {
        let historicalGradeRepair = null;
        let historicalGradeRepairError = "";
        try {
          historicalGradeRepair = await repairHistoricalEzpzGrades();
        } catch (error) {
          historicalGradeRepairError =
            error instanceof Error ? error.message : String(error);
          console.warn("Historical EZPZ grade repair failed", historicalGradeRepairError);
        }

        return NextResponse.json(
          {
            ok: true,
            source: "VERCEL_CRON",
            attempt,
            dateET: clock.date,
            timeET: `${String(clock.hour).padStart(2, "0")}:${String(clock.minute).padStart(2, "0")}`,
            today: payload?.today || "",
            draftKingsStatus:
              payload?.draftKingsStatus || payload?.draftKings?.status || "UNKNOWN",
            aiPickCount: Number(
              payload?.aiPickCount ??
                (Array.isArray(payload?.aiPicks) ? payload.aiPicks.length : 0),
            ),
            trendPlayCount: Number(
              payload?.trendPlayCount ??
                (Array.isArray(payload?.trendPlays) ? payload.trendPlays.length : 0),
            ),
            mlbResultSync: payload?.mlbResultSync || null,
            historicalGradeRepair,
            historicalGradeRepairError,
          },
          { headers: { "Cache-Control": "no-store, max-age=0" } },
        );
      }

      lastError =
        String(payload?.error || "").trim() ||
        `public-data-v2 returned HTTP ${response.status}`;
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt > RETRY_DELAYS_MS.length) break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt > RETRY_DELAYS_MS.length) break;
    }

    await sleep(RETRY_DELAYS_MS[attempt - 1]);
  }

  console.error("Vercel MLB live-data cron failed", {
    status: lastStatus,
    error: lastError,
  });
  return NextResponse.json(
    {
      ok: false,
      source: "VERCEL_CRON",
      status: lastStatus,
      error: lastError || "MLB live-data capture failed.",
    },
    { status: 502, headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}