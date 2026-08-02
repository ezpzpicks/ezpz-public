import { NextRequest, NextResponse } from "next/server";
import { readWorksheet } from "../../../../lib/googleSheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

type SheetRow = Record<string, string>;

const PUBLIC_SPLIT_TAB = "public_split_snapshots";

function todayET() {
  return new Date().toLocaleDateString("en-US", {
    timeZone: "America/New_York",
  });
}

function normalizeDate(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const isoMatch = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${Number(month)}/${Number(day)}/${year}`;
  }

  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (slashMatch) {
    const [, month, day, year] = slashMatch;
    return `${Number(month)}/${Number(day)}/${year.length === 2 ? `20${year}` : year}`;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime())
    ? raw
    : parsed.toLocaleDateString("en-US", { timeZone: "America/New_York" });
}

function textKey(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function scheduledGameStart(row: SheetRow) {
  const raw = [
    "Game Time",
    "Game Start Time",
    "Scheduled Start",
    "Start Time",
    "Game Time ET",
  ]
    .map((column) => String(row[column] || "").trim())
    .find(Boolean);
  if (!raw) return null;
  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function gameKey(row: SheetRow) {
  return [
    normalizeDate(row.Date || ""),
    textKey(row["Away Team"] || ""),
    textKey(row["Home Team"] || ""),
  ].join("|");
}

function isTrackingSnapshot(row: SheetRow) {
  return textKey(row["Match Confidence"] || "").includes(
    "15 minute tracking snapshot",
  );
}

async function safeReadTrackingRows() {
  try {
    return (await readWorksheet(PUBLIC_SPLIT_TAB)) as SheetRow[];
  } catch {
    return [];
  }
}

function captureTargets(
  slateRows: SheetRow[],
  snapshotRows: SheetRow[],
  now = Date.now(),
) {
  const today = todayET();
  const alreadyCaptured = new Set(
    snapshotRows
      .filter(isTrackingSnapshot)
      .filter((row) => textKey(row["Data Type"] || "") === "game market")
      .filter((row) => String(row["Public Bets %"] || "").trim() !== "")
      .filter((row) => String(row["Public Money %"] || "").trim() !== "")
      .map((row) => gameKey(row)),
  );

  return slateRows.filter((row) => {
    if (normalizeDate(row.Date || "") !== today) return false;
    const start = scheduledGameStart(row);
    if (start == null) return false;
    const minutesBeforeStart = (start - now) / 60_000;
    // One snapshot per game. The GitHub schedule is aligned to common MLB
    // first-pitch minutes; this tolerance also covers uncommon times and delays.
    if (minutesBeforeStart < 7 || minutesBeforeStart > 23) return false;
    return !alreadyCaptured.has(gameKey(row));
  });
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not configured." },
      { status: 500 },
    );
  }

  const authorization = request.headers.get("authorization");
  if (authorization !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [slateRows, snapshotRows] = await Promise.all([
      readWorksheet("daily_slate") as Promise<SheetRow[]>,
      safeReadTrackingRows(),
    ]);
    const targets = captureTargets(slateRows, snapshotRows);

    // Every scheduled run saves the latest market state so the first available
    // Public %, Sharp %, line, and odds become a durable opening baseline. When
    // a game enters the 7-23 minute window, the same call also locks its official
    // final-pregame snapshot for historical grading.
    const publicDataUrl = new URL("/api/public-data", request.url);
    publicDataUrl.searchParams.set("source", "cron");
    publicDataUrl.searchParams.set("scheduled", "1");
    if (targets.length) publicDataUrl.searchParams.set("tracking", "15m");

    const headers: Record<string, string> = {
      "x-ezpz-scheduled-snapshot": "true",
    };
    if (targets.length) headers["x-ezpz-background-snapshot"] = "true";

    const response = await fetch(publicDataUrl, {
      method: "GET",
      cache: "no-store",
      headers,
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      return NextResponse.json(
        {
          ok: false,
          targetGames: targets.map((row) => String(row.Game || gameKey(row))),
          error:
            payload?.error ||
            `Public-data route returned HTTP ${response.status}.`,
          publicDataStatus: response.status,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      snapshotType: targets.length
        ? "OPENING_BASELINE_REFRESH_AND_FINAL_15_MINUTE_LOCK"
        : "OPENING_BASELINE_REFRESH",
      targetGames: targets.map((row) => String(row.Game || gameKey(row))),
      ranAt: new Date().toISOString(),
      draftKingsStatus: payload?.draftKings?.status || "UNKNOWN",
      retainedCount: Number(payload?.draftKings?.retainedCount || 0),
      persistence: payload?.draftKings?.persistence || null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
