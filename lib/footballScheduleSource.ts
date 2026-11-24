import type { FootballSport, SheetRow } from "./sportSheets";

function etKickoffParts(value: unknown) {
  const date = new Date(String(value || ""));
  if (!Number.isFinite(date.getTime())) return { date: "", time: "" };
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true,
  }).format(date);
  return { date: get("year") + "-" + get("month") + "-" + get("day"), time };
}

function footballWeekDates(start: string, end: string) {
  const dates: string[] = [];
  let stamp = Date.parse(start + "T12:00:00Z");
  const endStamp = Date.parse(end + "T12:00:00Z");
  while (Number.isFinite(stamp) && stamp <= endStamp) {
    dates.push(new Date(stamp).toISOString().slice(0, 10));
    stamp += 86_400_000;
  }
  return dates;
}

export async function loadFootballWeekSchedule(sport: FootballSport, start: string, end: string): Promise<SheetRow[]> {
  const league = sport === "NFL" ? "nfl" : "college-football";
  const payloads = await Promise.all(footballWeekDates(start, end).map(async (date) => {
    const url = new URL("https://site.api.espn.com/apis/site/v2/sports/football/" + league + "/scoreboard");
    url.searchParams.set("dates", date.replace(/-/g, ""));
    url.searchParams.set("limit", "1000");
    if (sport === "NCAAF") url.searchParams.set("groups", "80");
    try {
      const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(8_000) });
      if (!response.ok) return null;
      return await response.json() as any;
    } catch {
      return null;
    }
  }));
  const rows: SheetRow[] = [];
  const seen = new Set<string>();
  for (const payload of payloads) {
    for (const event of Array.isArray(payload?.events) ? payload.events : []) {
      const eventId = String(event?.id || "");
      if (eventId && seen.has(eventId)) continue;
      if (eventId) seen.add(eventId);
      const competition = Array.isArray(event?.competitions) ? event.competitions[0] : null;
      if (!competition) continue;
      const competitors = Array.isArray(competition?.competitors) ? competition.competitors : [];
      const home = competitors.find((entry: any) => String(entry?.homeAway || "").toLowerCase() === "home") || competitors[0];
      const away = competitors.find((entry: any) => String(entry?.homeAway || "").toLowerCase() === "away") || competitors[1];
      // College schedule matching uses school identities. ESPN displayName
      // includes mascots ("Miami (OH) RedHawks"), which cannot match the saved
      // "Miami (OH)" row and would leave its old kickoff in the Signals board.
      const teamName = (entry: any) => String(
        (sport === "NCAAF" ? entry?.team?.shortDisplayName : entry?.team?.displayName)
        || entry?.team?.displayName || entry?.team?.shortDisplayName || entry?.team?.name || "",
      ).trim();
      const awayTeam = teamName(away);
      const homeTeam = teamName(home);
      if (!awayTeam || !homeTeam) continue;
      const kickoff = etKickoffParts(competition?.date || event?.date);
      if (!kickoff.date) continue;
      const completed = Boolean(competition?.status?.type?.completed || event?.status?.type?.completed);
      rows.push({
        Date: kickoff.date,
        "Game Date": kickoff.date,
        "Game Time": kickoff.time,
        "Game ID": String(event?.id || competition?.id || ""),
        Game: awayTeam + " @ " + homeTeam,
        "Away Team": awayTeam,
        "Home Team": homeTeam,
        Completed: completed ? "TRUE" : "FALSE",
        ...(sport === "NCAAF" ? {
          "Source Game Time": String(competition?.date || event?.date || ""),
          "Time Valid": competition?.timeValid === true || event?.timeValid === true ? "TRUE" : "FALSE",
          Status: String(competition?.status?.type?.name || event?.status?.type?.name || ""),
        } : {}),
        "Neutral Site": competition.neutralSite ? "TRUE" : "FALSE",
        "Away Score": completed ? String(away?.score ?? "") : "",
        "Home Score": completed ? String(home?.score ?? "") : "",
      });
    }
  }
  return rows;
}

