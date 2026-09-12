"use client";

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
