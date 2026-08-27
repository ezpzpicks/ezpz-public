import fs from "node:fs";

function replaceOnce(text, oldText, newText, label) {
  if (text.includes(newText)) return text;
  const count = text.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one target, found ${count}`);
  return text.replace(oldText, newText);
}

const path = "lib/footballPublicData.ts";
let text = fs.readFileSync(path, "utf8");

if (!text.includes("async function loadFootballWeekSchedule(")) {
  const anchor = "function numericLine(value: unknown) {";
  if (!text.includes(anchor)) throw new Error("football live schedule helper anchor not found");
  const helper = [
    "function etKickoffParts(value: unknown) {",
    "  const date = new Date(String(value || \"\"));",
    "  if (!Number.isFinite(date.getTime())) return { date: \"\", time: \"\" };",
    "  const parts = new Intl.DateTimeFormat(\"en-US\", {",
    "    timeZone: \"America/New_York\", year: \"numeric\", month: \"2-digit\", day: \"2-digit\",",
    "  }).formatToParts(date);",
    "  const get = (type: string) => parts.find((part) => part.type === type)?.value || \"\";",
    "  const time = new Intl.DateTimeFormat(\"en-US\", {",
    "    timeZone: \"America/New_York\", hour: \"numeric\", minute: \"2-digit\", hour12: true,",
    "  }).format(date);",
    "  return { date: get(\"year\") + \"-\" + get(\"month\") + \"-\" + get(\"day\"), time };",
    "}",
    "",
    "function nonEmptyMerge(base: SheetRow, next: SheetRow) {",
    "  const out: SheetRow = { ...base };",
    "  for (const [key, value] of Object.entries(next)) {",
    "    if (String(value ?? \"\").trim() !== \"\") out[key] = String(value);",
    "  }",
    "  return out;",
    "}",
    "",
    "function footballScheduleKey(row: SheetRow, sport: FootballSport) {",
    "  const id = String(row[\"Game ID\"] || \"\").trim();",
    "  if (id) return \"id:\" + id;",
    "  const date = isoDate(row.Date || row[\"Game Date\"] || \"\");",
    "  return \"team:\" + date + \"|\" + normalizeTeam(row[\"Away Team\"], sport) + \"|\" + normalizeTeam(row[\"Home Team\"], sport);",
    "}",
    "",
    "async function loadFootballWeekSchedule(sport: FootballSport, start: string, end: string): Promise<SheetRow[]> {",
    "  const league = sport === \"NFL\" ? \"nfl\" : \"college-football\";",
    "  const url = new URL(\"https://site.api.espn.com/apis/site/v2/sports/football/\" + league + \"/scoreboard\");",
    "  url.searchParams.set(\"dates\", start.replace(/-/g, \"\") + \"-\" + end.replace(/-/g, \"\"));",
    "  url.searchParams.set(\"limit\", \"1000\");",
    "  if (sport === \"NCAAF\") url.searchParams.set(\"groups\", \"80\");",
    "  try {",
    "    const response = await fetch(url, { headers: { Accept: \"application/json\" }, cache: \"no-store\" });",
    "    if (!response.ok) return [];",
    "    const payload = await response.json() as any;",
    "    const rows: SheetRow[] = [];",
    "    for (const event of Array.isArray(payload?.events) ? payload.events : []) {",
    "      const competition = Array.isArray(event?.competitions) ? event.competitions[0] : null;",
    "      if (!competition) continue;",
    "      const competitors = Array.isArray(competition?.competitors) ? competition.competitors : [];",
    "      const home = competitors.find((entry: any) => String(entry?.homeAway || \"\").toLowerCase() === \"home\") || competitors[0];",
    "      const away = competitors.find((entry: any) => String(entry?.homeAway || \"\").toLowerCase() === \"away\") || competitors[1];",
    "      const teamName = (entry: any) => String(entry?.team?.displayName || entry?.team?.shortDisplayName || entry?.team?.name || \"\").trim();",
    "      const awayTeam = teamName(away);",
    "      const homeTeam = teamName(home);",
    "      if (!awayTeam || !homeTeam) continue;",
    "      const kickoff = etKickoffParts(competition?.date || event?.date);",
    "      if (!kickoff.date) continue;",
    "      const completed = Boolean(competition?.status?.type?.completed || event?.status?.type?.completed);",
    "      rows.push({",
    "        Date: kickoff.date,",
    "        \"Game Date\": kickoff.date,",
    "        \"Game Time\": kickoff.time,",
    "        \"Game ID\": String(event?.id || competition?.id || \"\"),",
    "        Game: awayTeam + \" @ \" + homeTeam,",
    "        \"Away Team\": awayTeam,",
    "        \"Home Team\": homeTeam,",
    "        Completed: completed ? \"TRUE\" : \"FALSE\",",
    "        \"Away Score\": completed ? String(away?.score ?? \"\") : \"\",",
    "        \"Home Score\": completed ? String(home?.score ?? \"\") : \"\",",
    "      });",
    "    }",
    "    return rows;",
    "  } catch {",
    "    return [];",
    "  }",
    "}",
    "",
    "function mergeFootballSchedules(saved: SheetRow[], live: SheetRow[], sport: FootballSport) {",
    "  const merged = new Map<string, SheetRow>();",
    "  for (const row of live) merged.set(footballScheduleKey(row, sport), row);",
    "  for (const row of saved) {",
    "    const key = footballScheduleKey(row, sport);",
    "    merged.set(key, nonEmptyMerge(merged.get(key) || {}, row));",
    "  }",
    "  return [...merged.values()];",
    "}",
    "",
    "function mergeFootballTrackingSlate(projected: SheetRow[], schedule: SheetRow[], sport: FootballSport, referenceDate: string) {",
    "  const merged = new Map<string, SheetRow>();",
    "  for (const row of schedule.filter((entry) => inFootballTrackingWeek(entry, sport, referenceDate))) {",
    "    merged.set(footballScheduleKey(row, sport), row);",
    "  }",
    "  for (const row of projected.filter((entry) => inFootballTrackingWeek(entry, sport, referenceDate))) {",
    "    const key = footballScheduleKey(row, sport);",
    "    merged.set(key, nonEmptyMerge(merged.get(key) || {}, row));",
    "  }",
    "  return [...merged.values()].sort((a, b) => {",
    "    const dateCompare = isoDate(a.Date || a[\"Game Date\"] || \"\").localeCompare(isoDate(b.Date || b[\"Game Date\"] || \"\"));",
    "    if (dateCompare) return dateCompare;",
    "    return parseEventTimeKey(gameTime(a)).localeCompare(parseEventTimeKey(gameTime(b)));",
    "  });",
    "}",
    "",
    "",
  ].join("\n");
  text = text.replace(anchor, helper + anchor);
}

text = replaceOnce(
  text,
  "  const [slateAll,tracker,schedule,trendExisting,snapshotExisting]=await Promise.all([readSportWorksheet(sport,\"daily_slate\"),readSportWorksheet(sport,\"bet_tracker\"),readSportWorksheet(sport,\"schedule\"),readSportWorksheet(sport,\"all_game_trends\",ALL_GAME_TRENDS_HEADERS),readSportWorksheet(sport,\"public_split_snapshots\",PUBLIC_SPLIT_HEADERS)]);\n  const trackingSlate=slateAll.filter((row)=>inFootballTrackingWeek(row,sport,today));\n  const slate=trackingSlate;\n  let trendRows=settleTrendRows(trendExisting,schedule,sport);",
  "  const [slateAll,tracker,schedule,trendExisting,snapshotExisting]=await Promise.all([readSportWorksheet(sport,\"daily_slate\"),readSportWorksheet(sport,\"bet_tracker\"),readSportWorksheet(sport,\"schedule\"),readSportWorksheet(sport,\"all_game_trends\",ALL_GAME_TRENDS_HEADERS),readSportWorksheet(sport,\"public_split_snapshots\",PUBLIC_SPLIT_HEADERS)]);\n  const liveSchedule=await loadFootballWeekSchedule(sport,trackingWeek.start,trackingWeek.end);\n  const footballSchedule=mergeFootballSchedules(schedule,liveSchedule,sport);\n  const trackingSlate=mergeFootballTrackingSlate(slateAll,footballSchedule,sport,today);\n  const slate=trackingSlate;\n  let trendRows=settleTrendRows(trendExisting,footballSchedule,sport);",
  "weekly football live schedule merge",
);

fs.writeFileSync(path, text);
console.log("Applied live ESPN weekly schedule fallback for NFL/CFB public tracking.");
