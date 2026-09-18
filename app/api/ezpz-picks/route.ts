import { NextRequest, NextResponse } from "next/server";
import {
  readEzpzCurrentPicks,
  type EzpzCurrentSport,
} from "../../../lib/ezpzCurrentPicks";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 15;

const SUPPORTED_SPORTS = new Set<EzpzCurrentSport>(["MLB", "NFL", "NCAAF"]);
const MAX_SNAPSHOT_AGE_MS = 20 * 60_000;

type AnyRow = Record<string, any>;

function firstValue(...values: unknown[]) {
  for (const value of values) {
    if (value === 0) return 0;
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function todayET() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function inferredLine(value: unknown) {
  const text = String(value || "").trim().replace(/[−–—]/g, "-");
  const matches = text.match(/[+-]?\d+(?:\.\d+)?/g) || [];
  if (!matches.length) return "";
  const parsed = Number(matches[matches.length - 1]);
  if (!Number.isFinite(parsed) || Math.abs(parsed) > 100) return "";
  return String(parsed);
}

function normalizePick(pick: AnyRow, sport: string) {
  const awayTeam = String(firstValue(pick.awayTeam, pick["Away Team"]));
  const homeTeam = String(firstValue(pick.homeTeam, pick["Home Team"]));
  const game = String(
    firstValue(
      pick.game,
      pick.Game,
      awayTeam && homeTeam ? `${awayTeam} @ ${homeTeam}` : "",
    ),
  );
  const market = String(firstValue(pick.market, pick.Market, pick.propMarket, pick["Prop Market"]));
  const selection = String(firstValue(pick.selection, pick.Selection, pick.play, pick.Play));
  const play = String(firstValue(pick.play, pick.Play, selection));

  return {
    sport,
    date: String(firstValue(pick.date, pick.Date)),
    gameTime: String(firstValue(pick.gameTime, pick["Game Time"], pick["Game Time ET"])),
    game,
    awayTeam,
    homeTeam,
    market,
    selection,
    play,
    line: firstValue(
      pick.line,
      pick.Line,
      pick.propLine,
      pick["Prop Line"],
      pick.altLine,
      inferredLine(selection || play),
    ),
    odds: firstValue(pick.odds, pick.Odds, pick.americanOdds, pick["American Odds"], pick.altOdds),
    playerName: String(firstValue(pick.playerName, pick.Player, pick["Player Name"])),
    propMarket: String(firstValue(pick.propMarket, pick["Prop Market"])),
    propSide: String(firstValue(pick.propSide, pick["Prop Side"])),
    propLine: firstValue(pick.propLine, pick["Prop Line"]),
    source: String(firstValue(pick.source, pick.Source)),
    bestPlayType: String(firstValue(pick.bestPlayType, pick["Best Play Type"])),
    grade: String(firstValue(pick.grade, pick.playGrade, pick.bestPlayGrade, pick.Grade)),
    tier: String(firstValue(pick.trendTier, pick.v2Tier, pick.tier, pick.Tier)),
    label: String(firstValue(pick.snapshotStatus, pick.status, pick.Status)),
    snapshotStatus: String(firstValue(pick.snapshotStatus, pick["Snapshot Status"])),
    result: String(firstValue(pick.result, pick.Result)),
  };
}

export async function GET(request: NextRequest) {
  const requested = String(request.nextUrl.searchParams.get("sport") || "MLB").trim().toUpperCase();
  if (!SUPPORTED_SPORTS.has(requested as EzpzCurrentSport)) {
    return NextResponse.json(
      { ok: false, error: `Unsupported sport: ${requested}`, supportedSports: [...SUPPORTED_SPORTS] },
      { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  const sport = requested as EzpzCurrentSport;

  try {
    const snapshot = await readEzpzCurrentPicks(sport);
    if (!snapshot) {
      return NextResponse.json(
        {
          ok: false,
          sport,
          error: "No persisted EZPZ picks snapshot is available yet.",
        },
        { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } },
      );
    }

    const updatedAtMs = Date.parse(snapshot.updatedAt);
    const snapshotAgeMs = Number.isFinite(updatedAtMs) ? Date.now() - updatedAtMs : Number.POSITIVE_INFINITY;
    const currentDate = todayET();
    const stale = snapshot.date !== currentDate || snapshotAgeMs > MAX_SNAPSHOT_AGE_MS;

    if (stale) {
      return NextResponse.json(
        {
          ok: false,
          sport,
          error: "The persisted EZPZ picks snapshot is stale.",
          snapshotDate: snapshot.date,
          snapshotUpdatedAt: snapshot.updatedAt,
          snapshotAgeSeconds: Number.isFinite(snapshotAgeMs)
            ? Math.max(0, Math.round(snapshotAgeMs / 1000))
            : null,
        },
        { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } },
      );
    }

    const picks = snapshot.picks.map((pick: AnyRow) => normalizePick(pick, sport));

    return NextResponse.json(
      {
        ok: true,
        sport,
        date: snapshot.date,
        generatedAt: new Date().toISOString(),
        sourceUpdatedAt: snapshot.sourceUpdatedAt || snapshot.updatedAt,
        snapshotUpdatedAt: snapshot.updatedAt,
        snapshotAgeSeconds: Math.max(0, Math.round(snapshotAgeMs / 1000)),
        source: "persisted-cron-snapshot",
        pickCount: picks.length,
        picks,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120",
        },
      },
    );
  } catch (error) {
    console.error("EZPZ picks snapshot API failed", error);
    return NextResponse.json(
      { ok: false, sport, error: error instanceof Error ? error.message : String(error) },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
