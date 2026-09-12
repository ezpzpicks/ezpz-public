from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    return source.replace(old, new, 1)


team_component = r'''"use client";

import { useEffect, useMemo, useState } from "react";

export type LogoSport = "NFL" | "NCAAF" | "NCAAM";
type LogoDirectory = Record<string, string>;

const directoryValues = new Map<LogoSport, LogoDirectory>();
const directoryPromises = new Map<LogoSport, Promise<LogoDirectory>>();

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

function loadDirectory(sport: LogoSport) {
  const cached = directoryValues.get(sport);
  if (cached) return Promise.resolve(cached);
  const pending = directoryPromises.get(sport);
  if (pending) return pending;

  const request = fetch(`/api/team-logos?sport=${sport}`, { cache: "force-cache" })
    .then(async (response) => {
      if (!response.ok) return {} as LogoDirectory;
      const payload = await response.json();
      return (payload?.logos || {}) as LogoDirectory;
    })
    .catch(() => ({} as LogoDirectory))
    .then((logos) => {
      directoryValues.set(sport, logos);
      return logos;
    });

  directoryPromises.set(sport, request);
  return request;
}

function findLogo(directory: LogoDirectory | undefined, team: string) {
  if (!directory) return "";
  const key = normalizeTeam(team);
  if (!key) return "";
  if (directory[key]) return directory[key];

  const matches = Object.entries(directory)
    .filter(([alias]) => alias.length >= 4 && (key.startsWith(`${alias} `) || alias.startsWith(`${key} `)))
    .map(([, logo]) => logo);
  return [...new Set(matches)].length === 1 ? matches[0] : "";
}

function parseMatchup(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const symbol = raw.split(/\s*@\s*/).map((part) => part.trim()).filter(Boolean);
  if (symbol.length === 2) return { away: symbol[0], home: symbol[1], separator: "AT" };
  const words = raw.split(/\s+(?:at|vs\.?|versus)\s+/i).map((part) => part.trim()).filter(Boolean);
  if (words.length === 2) return { away: words[0], home: words[1], separator: /\bvs\.?\b/i.test(raw) ? "VS" : "AT" };
  return null;
}

function selectionTeam(selection: string, matchup: string) {
  const teams = parseMatchup(matchup);
  if (!teams) return "";
  const selectionKey = normalizeTeam(selection.replace(/\s+[+-]?\d+(?:\.\d+)?(?:\s*\([+-]?\d{3,4}\))?\s*$/, ""));
  if (!selectionKey) return "";
  const candidates = [teams.away, teams.home].filter((team) => {
    const teamKey = normalizeTeam(team);
    return Boolean(teamKey && (selectionKey === teamKey || selectionKey.startsWith(`${teamKey} `) || teamKey.startsWith(`${selectionKey} `)));
  });
  return candidates.length === 1 ? candidates[0] : "";
}

export function TeamLogoName({
  sport,
  team,
  text,
  compact = false,
  className = "",
}: {
  sport: LogoSport;
  team: string;
  text?: string;
  compact?: boolean;
  className?: string;
}) {
  const initial = useMemo(() => findLogo(directoryValues.get(sport), team), [sport, team]);
  const [logo, setLogo] = useState(initial);

  useEffect(() => {
    let active = true;
    setLogo(findLogo(directoryValues.get(sport), team));
    loadDirectory(sport).then((directory) => {
      if (active) setLogo(findLogo(directory, team));
    });
    return () => { active = false; };
  }, [sport, team]);

  const label = text ?? team;
  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: compact ? 5 : 7,
        minWidth: 0,
        maxWidth: "100%",
        verticalAlign: "middle",
      }}
    >
      {logo ? (
        <img
          src={logo}
          alt={`${team} logo`}
          loading="lazy"
          decoding="async"
          onError={(event) => { event.currentTarget.style.display = "none"; }}
          style={{
            width: compact ? 18 : 24,
            height: compact ? 18 : 24,
            flex: "0 0 auto",
            objectFit: "contain",
            filter: "drop-shadow(0 2px 5px rgba(0,0,0,.28))",
          }}
        />
      ) : null}
      <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{label}</span>
    </span>
  );
}

export function MatchupWithLogos({
  sport,
  game,
  compact = false,
}: {
  sport: LogoSport;
  game: string;
  compact?: boolean;
}) {
  const matchup = parseMatchup(game);
  if (!matchup) return <span>{game}</span>;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: compact ? 6 : 9,
        maxWidth: "100%",
      }}
    >
      <TeamLogoName sport={sport} team={matchup.away} compact={compact} />
      <span style={{ opacity: 0.52, fontSize: compact ? ".72em" : ".76em", fontWeight: 900 }}>{matchup.separator}</span>
      <TeamLogoName sport={sport} team={matchup.home} compact={compact} />
    </span>
  );
}

export function SelectionWithTeamLogo({
  sport,
  selection,
  game,
  compact = false,
}: {
  sport: LogoSport;
  selection: string;
  game: string;
  compact?: boolean;
}) {
  const team = selectionTeam(selection, game);
  if (!team) return <span>{selection}</span>;
  return <TeamLogoName sport={sport} team={team} text={selection} compact={compact} />;
}
'''

route_component = r'''import { NextRequest, NextResponse } from "next/server";

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
'''

(ROOT / "app/TeamLogoName.tsx").write_text(team_component)
route_path = ROOT / "app/api/team-logos/route.ts"
route_path.parent.mkdir(parents=True, exist_ok=True)
route_path.write_text(route_component)

# Optimized NFL board
path = ROOT / "app/FootballBoard.tsx"
source = path.read_text()
if 'from "./TeamLogoName"' not in source:
    source = replace_once(
        source,
        'import LegacyFootballBoard from "./FootballBoardLegacy";\n',
        'import LegacyFootballBoard from "./FootballBoardLegacy";\nimport { MatchupWithLogos, SelectionWithTeamLogo, TeamLogoName } from "./TeamLogoName";\n',
        "FootballBoard import",
    )
source = replace_once(source,
    '<span className="nflEyebrow">{play.playerTeam || "NFL"} • {play.propMarket || "Player Prop"}</span>',
    '<span className="nflEyebrow"><TeamLogoName sport="NFL" team={play.playerTeam || ""} text={play.playerTeam || "NFL"} compact /> • {play.propMarket || "Player Prop"}</span>',
    "NFL model player team")
source = replace_once(source,
    '<h3>{play.play}</h3>\n          <p>{play.game}</p>',
    '<h3><SelectionWithTeamLogo sport="NFL" selection={play.play || ""} game={play.game || ""} /></h3>\n          <p><MatchupWithLogos sport="NFL" game={play.game || ""} compact /></p>',
    "NFL model game hero")
source = replace_once(source,
    '<h3>{play.playerName || play.play}</h3>\n            <p>{play.game}</p>',
    '<h3>{play.playerName || play.play}</h3>\n            <p><MatchupWithLogos sport="NFL" game={play.game || ""} compact /></p>',
    "NFL model prop matchup")
source = replace_once(source,
    '<span className="nflEyebrow">{pick.playerTeam || "NFL"} • {pick.propMarket || "Player Prop"}</span>',
    '<span className="nflEyebrow"><TeamLogoName sport="NFL" team={pick.playerTeam || ""} text={pick.playerTeam || "NFL"} compact /> • {pick.propMarket || "Player Prop"}</span>',
    "NFL EZPZ player team")
source = replace_once(source,
    '<h3>{pick.playerName || pick.selection}</h3>\n            <p>{pick.game}</p>',
    '<h3>{pick.playerName || pick.selection}</h3>\n            <p><MatchupWithLogos sport="NFL" game={pick.game || ""} compact /></p>',
    "NFL EZPZ prop matchup")
source = replace_once(source,
    '<span>{pick.game}</span>\n          <h3>{pick.selection}</h3>',
    '<span><MatchupWithLogos sport="NFL" game={pick.game || ""} compact /></span>\n          <h3><SelectionWithTeamLogo sport="NFL" selection={pick.selection || ""} game={pick.game || ""} /></h3>',
    "NFL EZPZ game selection")
path.write_text(source)

# Legacy NFL + NCAAF board
path = ROOT / "app/FootballBoardLegacy.tsx"
source = path.read_text()
if 'from "./TeamLogoName"' not in source:
    source = replace_once(
        source,
        'import { useEffect, useMemo, useState } from "react";\n',
        'import { useEffect, useMemo, useState } from "react";\nimport { MatchupWithLogos, SelectionWithTeamLogo, TeamLogoName } from "./TeamLogoName";\n',
        "Legacy import",
    )
source = replace_once(source,
    'function FbRecentResults({ rows }: { rows: SheetRow[] }) {',
    'function FbRecentResults({ rows, sport }: { rows: SheetRow[]; sport: Sport }) {',
    "Recent results props")
source = replace_once(source,
    '<td>{row.Game}</td><td>{row["Bet Type"] || row.Market}</td><td><strong>{row.Selection}</strong></td>',
    '<td><MatchupWithLogos sport={sport} game={row.Game || ""} compact /></td><td>{row["Bet Type"] || row.Market}</td><td><strong><SelectionWithTeamLogo sport={sport} selection={row.Selection || ""} game={row.Game || ""} compact /></strong></td>',
    "Recent results logos")
source = replace_once(source,
    '<div className="cardSub footballMatchup">{play.game}</div>',
    '<div className="cardSub footballMatchup"><MatchupWithLogos sport={sport} game={play.game} compact /></div>',
    "Best play matchup")
source = replace_once(source,
    '<div className="projection footballProjection">{play.play}</div>',
    '<div className="projection footballProjection"><SelectionWithTeamLogo sport={sport} selection={play.play} game={play.game} /></div>',
    "Best play selection")
source = replace_once(source,
    '<strong>{split.selection || play.play}</strong>',
    '<strong><SelectionWithTeamLogo sport={sport} selection={split.selection || play.play} game={play.game} compact /></strong>',
    "Best play DK selection")
source = replace_once(source,
    'function TrendSelectionRow({ play, selectionRank, initiallyOpen }: { play: TrendPlay; selectionRank: number; initiallyOpen: boolean }) {',
    'function TrendSelectionRow({ play, selectionRank, initiallyOpen, sport }: { play: TrendPlay; selectionRank: number; initiallyOpen: boolean; sport: Sport }) {',
    "Trend row props")
source = replace_once(source,
    '<strong>{trendPickLabel(play)}</strong>',
    '<strong><SelectionWithTeamLogo sport={sport} selection={trendPickLabel(play)} game={play.game} compact /></strong>',
    "Trend row selection")
source = replace_once(source,
    'function TrendGameCard({ game, plays }: { game: string; plays: TrendPlay[] }) {',
    'function TrendGameCard({ game, plays, sport }: { game: string; plays: TrendPlay[]; sport: Sport }) {',
    "Trend game props")
source = replace_once(source,
    '<div className="cardTitle">{game}</div>',
    '<div className="cardTitle"><MatchupWithLogos sport={sport} game={game} compact /></div>',
    "Trend game matchup")
source = replace_once(source,
    '            initiallyOpen={false}\n          />',
    '            initiallyOpen={false}\n            sport={sport}\n          />',
    "Trend row sport pass")
source = replace_once(source,
    '<span>{pick.game}</span>\n            <span className={`aiStatusBadge ${isFinal ? "final" : "pending"}`}>',
    '<span><MatchupWithLogos sport={sport} game={pick.game} compact /></span>\n            <span className={`aiStatusBadge ${isFinal ? "final" : "pending"}`}>',
    "EZPZ summary matchup")
source = replace_once(source,
    '<strong>{pick.selection}</strong>\n        </div>\n        <div className="aiPickSummaryOdds">',
    '<strong><SelectionWithTeamLogo sport={sport} selection={pick.selection} game={pick.game} compact /></strong>\n        </div>\n        <div className="aiPickSummaryOdds">',
    "EZPZ summary selection")
source = replace_once(source,
    '<strong>{pick.selection}</strong>\n          <small>{pick.game}</small>',
    '<strong><SelectionWithTeamLogo sport={sport} selection={pick.selection} game={pick.game} /></strong>\n          <small><MatchupWithLogos sport={sport} game={pick.game} compact /></small>',
    "EZPZ expanded selection")
source = replace_once(source,
    'function SlateCard({ row, splits }: { row: SheetRow; splits: DraftKingsSplit[] }) {',
    'function SlateCard({ row, splits, sport }: { row: SheetRow; splits: DraftKingsSplit[]; sport: Sport }) {',
    "Slate card props")
source = replace_once(source,
    '<div><span>Away</span><strong>{row["Away Team"] || "Away"}</strong></div>',
    '<div><span>Away</span><strong><TeamLogoName sport={sport} team={row["Away Team"] || ""} text={row["Away Team"] || "Away"} /></strong></div>',
    "Slate away logo")
source = replace_once(source,
    '<div><span>Home</span><strong>{row["Home Team"] || "Home"}</strong></div>',
    '<div><span>Home</span><strong><TeamLogoName sport={sport} team={row["Home Team"] || ""} text={row["Home Team"] || "Home"} /></strong></div>',
    "Slate home logo")
source = replace_once(source,
    '<strong>{row["Spread Pick"] || "No model play"}</strong>',
    '<strong><SelectionWithTeamLogo sport={sport} selection={row["Spread Pick"] || "No model play"} game={game} /></strong>',
    "Slate spread selection")
source = replace_once(source,
    '              {split.market}: {split.selection} {split.odds} • {split.betsPct}% bets / {split.moneyPct}% handle{split.warning ? ` • ${split.warning}` : ""}',
    '              {split.market}: <SelectionWithTeamLogo sport={sport} selection={split.selection} game={game} compact /> {split.odds} • {split.betsPct}% bets / {split.moneyPct}% handle{split.warning ? ` • ${split.warning}` : ""}',
    "Slate DK selection")
source = replace_once(source,
    '<TrendGameCard key={group.plays[0]?.gameKey || group.game} game={group.game} plays={group.plays} />',
    '<TrendGameCard key={group.plays[0]?.gameKey || group.game} game={group.game} plays={group.plays} sport={sport} />',
    "Trend game sport pass")
source = replace_once(source,
    '<div className="slateDropdownTitle">{game}</div>',
    '<div className="slateDropdownTitle"><MatchupWithLogos sport={sport} game={game} compact /></div>',
    "Full slate dropdown matchup")
source = replace_once(source,
    '<SlateCard row={row} splits={splits} />',
    '<SlateCard row={row} splits={splits} sport={sport} />',
    "Slate card sport pass")
source = replace_once(source,
    '<FbRecentResults rows={trackerRows} />',
    '<FbRecentResults rows={trackerRows} sport={sport} />',
    "Recent results sport pass")
path.write_text(source)

print("Applied reusable team-logo parity to NFL/NCAAF views; NCAAM logo directory support is ready for its live board.")
