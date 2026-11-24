import { footballTeamKey } from "./footballTeamTrends";

type Sport = "NFL" | "NCAAF" | "NBA" | "NCAAM";

/** Resolve the named selection, including abbreviations, before using an edge fallback. */
export function selectedSpreadSide(sport: Sport, selection: string | undefined, away: string, home: string,
  homeMargin: number | null, homeLine: number | null): "away" | "home" | null {
  const name = String(selection || "").replace(/[−–]/g, "-")
    .replace(/\s+(?:[+-]?\d+(?:\.\d+)?|pk|pick(?:'em)?)\s*$/i, "").trim();
  const key = footballTeamKey(name, sport);
  const matches = (team: string) => {
    const other = footballTeamKey(team, sport);
    return Boolean(key && other && (key === other || other.startsWith(`${key} `) || key.startsWith(`${other} `)));
  };
  const a = matches(away), h = matches(home);
  if (a !== h) return a ? "away" : "home";
  if (homeMargin != null && homeLine != null && Number.isFinite(homeMargin + homeLine))
    return homeMargin + homeLine < 0 ? "away" : "home";
  return null;
}
