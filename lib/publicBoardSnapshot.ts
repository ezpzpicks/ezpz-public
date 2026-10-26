import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";
import { runTursoSql } from "./tursoStore";
import { compactFootballPublicDisplay } from "./footballPublicDisplay";

export type PublicBoardSport = "MLB" | "NFL" | "NCAAF";
export const PUBLIC_BOARD_VERSION = "saved-public-board-v1";
const compress = promisify(gzip), decompress = promisify(gunzip);
const table = "public_board_snapshots";
const sql = (value: unknown) => `'${String(value).replaceAll("'", "''")}'`;
const dateET = (now: number) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date(now));

type SavedBoard = {
  body: Buffer; date: string; savedAt: number; sourceStale: boolean; intervalMinutes: number;
  bytes: number; compressedBytes: number;
};
const cache = new Map<PublicBoardSport, { readAt: number; board: SavedBoard }>();
const inFlight = new Map<PublicBoardSport, Promise<SavedBoard | null>>();

/** Only scheduled producers call this. A public read never creates a table or rebuilds a board. */
export async function persistPublicBoardSnapshot(sport: PublicBoardSport, payload: Record<string, any>, startedAt = Date.now()) {
  const date = String(payload.today || "").replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, "$3-$1-$2");
  if (!payload.ok || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !payload.tiles
    || !Array.isArray(payload.bestPlays) || !Array.isArray(payload.slateToday)) {
    throw new Error(`Refusing to publish an incomplete ${sport} public board.`);
  }
  const sourceStale = payload.stale === true || payload.draftKings?.stale === true
    || payload.draftKings?.displayMode === "STALE_FALLBACK";
  const intervalMinutes = Number(payload.refreshIntervalMinutes) || 30;
  // Keep all tab data and every intermediate chart observation. Compression is
  // performed once by the producer, rather than serializing megabytes per visit.
  const display = sport === "MLB" ? payload : compactFootballPublicDisplay({ ...payload,
    trendPlays: payload.trendPlays,
    ...(payload.footballWeeklyMarket ? { footballWeeklyMarket: compactFootballPublicDisplay(payload.footballWeeklyMarket, true, true, true) } : {}),
  }, true, true, true);
  const text = JSON.stringify({ ...display, sport, publicBoard: {
    version: PUBLIC_BOARD_VERSION, savedAt: new Date(startedAt).toISOString(),
    sourceDate: date, sourceStale, refreshIntervalMinutes: intervalMinutes,
  } });
  const body = await compress(Buffer.from(text));
  await runTursoSql([
    `CREATE TABLE IF NOT EXISTS ${table} (sport TEXT PRIMARY KEY, version TEXT NOT NULL, source_date TEXT NOT NULL, saved_at INTEGER NOT NULL, source_stale INTEGER NOT NULL, interval_minutes INTEGER NOT NULL, body_gzip TEXT NOT NULL, body_bytes INTEGER NOT NULL, compressed_bytes INTEGER NOT NULL)`,
    `INSERT INTO ${table} (sport,version,source_date,saved_at,source_stale,interval_minutes,body_gzip,body_bytes,compressed_bytes) VALUES (${sql(sport)},${sql(PUBLIC_BOARD_VERSION)},${sql(date)},${startedAt},${sourceStale ? 1 : 0},${intervalMinutes},${sql(body.toString("base64"))},${Buffer.byteLength(text)},${body.length}) ON CONFLICT(sport) DO UPDATE SET version=excluded.version,source_date=excluded.source_date,saved_at=excluded.saved_at,source_stale=excluded.source_stale,interval_minutes=excluded.interval_minutes,body_gzip=excluded.body_gzip,body_bytes=excluded.body_bytes,compressed_bytes=excluded.compressed_bytes WHERE excluded.saved_at >= ${table}.saved_at`,
  ]);
  cache.delete(sport);
  const result = { sport, date, savedAt: new Date(startedAt).toISOString(), bytes: Buffer.byteLength(text), compressedBytes: body.length, sourceStale };
  console.info("[public-board] published", JSON.stringify(result));
  return result;
}

async function readBoard(sport: PublicBoardSport): Promise<SavedBoard | null> {
  const existing = cache.get(sport);
  if (existing && Date.now() - existing.readAt < 30_000) return existing.board;
  const pending = inFlight.get(sport);
  if (pending) return pending;
  const operation = (async () => {
    try {
      const results = await runTursoSql([
        `SELECT source_date,saved_at,source_stale,interval_minutes,body_gzip,body_bytes,compressed_bytes FROM ${table} WHERE sport=${sql(sport)} AND version=${sql(PUBLIC_BOARD_VERSION)} LIMIT 1`,
      ]);
      const row = results[0]?.[0];
      if (!row?.body_gzip) return null;
      const board: SavedBoard = { body: Buffer.from(row.body_gzip, "base64"), date: row.source_date,
        savedAt: Number(row.saved_at), sourceStale: row.source_stale === "1", intervalMinutes: Number(row.interval_minutes),
        bytes: Number(row.body_bytes), compressedBytes: Number(row.compressed_bytes) };
      cache.set(sport, { readAt: Date.now(), board });
      console.info("[public-board] read", JSON.stringify({ sport, rows: 1, bytes: board.compressedBytes }));
      return board;
    } catch (error) {
      // A storage outage can serve the last successful board, never run collectors.
      if (existing) return existing.board;
      if (/no such table/i.test(String(error))) return null;
      throw error;
    }
  })();
  inFlight.set(sport, operation);
  try { return await operation; }
  finally { if (inFlight.get(sport) === operation) inFlight.delete(sport); }
}

export async function savedPublicBoardResponse(request: NextRequest, sport: PublicBoardSport) {
  try {
    const board = await readBoard(sport);
    if (!board) return NextResponse.json({ ok: false, sport, pending: true,
      error: `${sport} is preparing its saved board. Please try again shortly.` },
    { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "15" } });
    const stale = board.sourceStale || board.date !== dateET(Date.now())
      || Date.now() - board.savedAt > Math.max(10, board.intervalMinutes * 2) * 60_000;
    const headers: Record<string, string> = {
      "Content-Type": "application/json", "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
      Vary: "Accept-Encoding", "X-EZPZ-Board-Version": PUBLIC_BOARD_VERSION,
      "X-EZPZ-Board-Saved-At": new Date(board.savedAt).toISOString(),
      "X-EZPZ-Board-Stale": String(stale), "X-EZPZ-Board-Date": board.date,
    };
    if (request.nextUrl.searchParams.get("inspect") === "1") return NextResponse.json({ ok: true, sport,
      version: PUBLIC_BOARD_VERSION, date: board.date, savedAt: headers["X-EZPZ-Board-Saved-At"],
      stale, bytes: board.bytes, compressedBytes: board.compressedBytes }, { headers });
    if (/\bgzip\b/.test(request.headers.get("accept-encoding") || "")) {
      headers["Content-Encoding"] = "gzip";
      return new NextResponse(new Uint8Array(board.body), { headers });
    }
    return new NextResponse(new Uint8Array(await decompress(board.body)), { headers });
  } catch (error) {
    console.error("[public-board] read failed", { sport, error });
    return NextResponse.json({ ok: false, sport, error: "The saved board is temporarily unavailable. Please try again." },
      { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "15" } });
  }
}
