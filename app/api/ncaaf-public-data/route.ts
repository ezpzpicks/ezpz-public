import { NextRequest, NextResponse } from "next/server";
import { buildFootballPublicData } from "../../../lib/footballPublicData";
import { repairNcaafFinalScores } from "../../../lib/ncaafFinalScoreRepair";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

type SheetRow = Record<string, string>;

type FootballPlay = {
  game?: string;
  awayTeam?: string;
  homeTeam?: string;
};

function isoDate(value: unknown) {
  const raw = String(value || "").trim();
  const iso = raw.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;

  const us = raw.match(/(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?/);
  if (!us) return "";
  const year = us[3] || new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
  }).format(new Date());
  return `${year}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
}

function textKey(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sameTeam(left: unknown, right: unknown) {
  const a = textKey(left);
  const b = textKey(right);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  return a.replace(/\s+/g, "").includes(b.replace(/\s+/g, "")) ||
    b.replace(/\s+/g, "").includes(a.replace(/\s+/g, ""));
}

function playMatchesSlateRow(play: FootballPlay, row: SheetRow) {
  const away = row["Away Team"] || row.Away || "";
  const home = row["Home Team"] || row.Home || "";
  if (sameTeam(play.awayTeam, away) && sameTeam(play.homeTeam, home)) return true;

  const rowGame = row.Game || `${away} @ ${home}`;
  return Boolean(textKey(play.game) && textKey(play.game) === textKey(rowGame));
}

export async function GET(request: NextRequest) {
  const scheduled = ["1", "true", "yes"].includes(
    String(request.nextUrl.searchParams.get("scheduled") || "").trim().toLowerCase(),
  );
  const forceFresh = scheduled || request.nextUrl.searchParams.get("refresh") === "1";

  try {
    let finalScoreRepair: unknown = null;
    if (forceFresh) {
      try {
        finalScoreRepair = await repairNcaafFinalScores();
      } catch (error) {
        console.warn("NCAAF final-score repair failed", error);
        finalScoreRepair = {
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    const data = await buildFootballPublicData("NCAAF", {
      forceFresh,
      persist: scheduled,
    });

    // Keep read-only record verification small enough to inspect without the
    // full model, live feed, and movement-chart payload.
    if (request.nextUrl.searchParams.get("recordsOnly") === "1") {
      return NextResponse.json({
        ok: data.ok, sport: "NCAAF", today: data.today, lastUpdated: data.lastUpdated,
        trendRecordPolicy: data.trendRecordPolicy,
        trendRecordRows: data.trendRecordRows || [],
      }, { headers: { "Cache-Control": "no-store, max-age=0" } });
    }

    const today = data.today;
    const todaySlate = (data.slateToday || []).filter((row: SheetRow) =>
      isoDate(row.Date || row["Game Date"] || "") === today,
    );
    const bestPlays = (data.bestPlays || []).filter((play: FootballPlay) =>
      todaySlate.some((row: SheetRow) => playMatchesSlateRow(play, row)),
    );
    // Public-split EZPZ picks do not require a model projection to be saved.
    const aiPicks = (data.aiPicks || []).filter((pick: FootballPlay & { date?: string }) =>
      isoDate(pick.date || today) === today,
    );

    return NextResponse.json({
      ...data,
      finalScoreRepair,
      bestPlays,
      aiPicks,
      aiSelectorStatus: data.aiSelectorStatus
        ? { ...data.aiSelectorStatus, selectedCount: aiPicks.length }
        : data.aiSelectorStatus,
      tiles: {
        ...data.tiles,
        bestPlaysToday: bestPlays.length,
      },
    });
  } catch (error) {
    console.error("NCAAF daily public data failed", error);
    return NextResponse.json(
      { ok: false, sport: "NCAAF", error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}


