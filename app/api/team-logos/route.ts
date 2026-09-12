import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const revalidate = 86400;

type SupportedSport = "NFL" | "NCAAF" | "NCAAM";

type DirectoryEntry = {
  team?: {
    id?: string;
    displayName?: string;
    shortDisplayName?: string;
    name?: string;
    nickname?: string;
    location?: string;
    abbreviation?: string;
    slug?: string;
    logo?: string;
    logos?: Array<{ href?: string }>;
  };
};

const SPORT_PATHS: Record<SupportedSport, string> = {
  NFL: "football/nfl",
  NCAAF: "football/college-football",
  NCAAM: "basketball/mens-college-basketball",
};

function normalizeTeam(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\(\s*#?\d{1,2}\s*\)/g, " ")
    .replace(/(^|\s)#\d{1,2}(?=\s|$)/g, " ")
    .replace(/&/g, " and ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function GET(request: NextRequest) {
  const sport = String(request.nextUrl.searchParams.get("sport") || "").toUpperCase() as SupportedSport;
  const path = SPORT_PATHS[sport];
  if (!path) {
    return NextResponse.json({ ok: false, error: "sport must be NFL, NCAAF, or NCAAM", logos: {} }, { status: 400 });
  }

  try {
    const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${path}/teams?limit=1000`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(9000),
    });
    if (!response.ok) throw new Error(`ESPN team directory ${response.status}`);
    const payload = await response.json() as any;
    const rows: DirectoryEntry[] = payload?.sports?.[0]?.leagues?.[0]?.teams || [];
    const aliases = new Map<string, Set<string>>();

    for (const row of rows) {
      const team = row?.team;
      if (!team) continue;
      const logo = String(team.logos?.[0]?.href || team.logo || "").trim();
      if (!logo) continue;
      const location = String(team.location || "").trim();
      const nickname = String(team.nickname || team.name || "").trim();
      const names = [
        team.displayName,
        team.shortDisplayName,
        team.name,
        team.nickname,
        team.location,
        team.abbreviation,
        team.slug,
        location && nickname ? `${location} ${nickname}` : "",
      ];
      for (const name of names) {
        const key = normalizeTeam(name);
        if (!key) continue;
        const bucket = aliases.get(key) || new Set<string>();
        bucket.add(logo);
        aliases.set(key, bucket);
      }
    }

    const logos: Record<string, string> = {};
    for (const [alias, candidates] of aliases.entries()) {
      if (candidates.size === 1) logos[alias] = [...candidates][0];
    }

    return NextResponse.json(
      { ok: true, sport, logos },
      { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } },
    );
  } catch (error) {
    console.error("Team logo directory failed", sport, error);
    return NextResponse.json({ ok: false, sport, logos: {}, error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
