import { NextRequest, NextResponse } from "next/server";
import { GET as getPublicDataV2 } from "../public-data-v2/route";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 120;

const SUPPORTED_SPORTS = new Set(["MLB", "NFL", "NCAAF"]);

type AnyRow = Record<string, any>;

function firstValue(...values: unknown[]) {
  for (const value of values) {
    if (value === 0) return 0;
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
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

  return {
    sport,
    date: String(firstValue(pick.date, pick.Date)),
    gameTime: String(firstValue(pick.gameTime, pick["Game Time"], pick["Game Time ET"])),
    game,
    awayTeam,
    homeTeam,
    market,
    selection,
    play: String(firstValue(pick.play, pick.Play, selection)),
    line: firstValue(pick.line, pick.Line, pick.propLine, pick["Prop Line"], pick.altLine),
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
  const sport = String(request.nextUrl.searchParams.get("sport") || "MLB").trim().toUpperCase();
  if (!SUPPORTED_SPORTS.has(sport)) {
    return NextResponse.json(
      { ok: false, error: `Unsupported sport: ${sport}`, supportedSports: [...SUPPORTED_SPORTS] },
      { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  try {
    const upstreamUrl = new URL(request.url);
    upstreamUrl.pathname = "/api/public-data-v2";
    upstreamUrl.search = "";
    upstreamUrl.searchParams.set("sport", sport);

    const upstreamRequest = new NextRequest(upstreamUrl, {
      method: "GET",
      headers: request.headers,
    });
    const upstreamResponse = await getPublicDataV2(upstreamRequest);
    const contentType = upstreamResponse.headers.get("content-type") || "";

    if (!contentType.includes("application/json")) {
      return NextResponse.json(
        { ok: false, sport, error: "EZPZ public data did not return JSON" },
        { status: 502, headers: { "Cache-Control": "no-store, max-age=0" } },
      );
    }

    const payload = (await upstreamResponse.json()) as AnyRow;
    if (!upstreamResponse.ok || payload?.ok === false) {
      return NextResponse.json(
        {
          ok: false,
          sport,
          error: String(payload?.error || payload?.message || `Public data returned HTTP ${upstreamResponse.status}`),
        },
        { status: upstreamResponse.status || 502, headers: { "Cache-Control": "no-store, max-age=0" } },
      );
    }

    const rawPicks = Array.isArray(payload?.aiPicks) ? payload.aiPicks : [];
    const picks = rawPicks.map((pick: AnyRow) => normalizePick(pick, sport));

    return NextResponse.json(
      {
        ok: true,
        sport,
        date: String(firstValue(payload?.today, payload?.date)),
        generatedAt: new Date().toISOString(),
        sourceUpdatedAt: String(firstValue(payload?.lastUpdated, payload?.generatedAt)),
        pickCount: picks.length,
        picks,
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    console.error("EZPZ picks API failed", error);
    return NextResponse.json(
      { ok: false, sport, error: error instanceof Error ? error.message : String(error) },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
