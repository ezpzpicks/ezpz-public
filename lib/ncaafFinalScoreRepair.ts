import {
  readSportWorksheet,
  upsertSportRows,
  type SheetRow,
} from "./sportSheets";

type RepairSummary = {
  date: string;
  checkedScheduleRows: number;
  resolvedFinalGames: number;
  repairedScheduleRows: number;
};

type FinalScore = {
  gameId: string;
  awayScore: number;
  homeScore: number;
};

function todayET(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function isoDate(value: unknown) {
  const raw = String(value || "").trim();
  const iso = raw.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const us = raw.match(/(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?/);
  if (!us) return "";
  const year = us[3] || todayET().slice(0, 4);
  return `${year}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
}

function gameId(row: SheetRow) {
  return String(row["Game ID"] || row["Game Key"] || "")
    .trim()
    .replace(/\.0$/, "");
}

function hasFinalScore(row: SheetRow) {
  const away = String(row["Away Score"] ?? "").trim();
  const home = String(row["Home Score"] ?? "").trim();
  return away !== "" && home !== "" && Number.isFinite(Number(away)) && Number.isFinite(Number(home));
}

function scoreNumber(value: any) {
  const parsed = Number(value?.value ?? value?.displayValue ?? value);
  return Number.isFinite(parsed) ? parsed : null;
}

function finalFromEvent(event: any): FinalScore | null {
  const competition = Array.isArray(event?.competitions) ? event.competitions[0] : null;
  if (!competition) return null;

  const status = competition?.status?.type || event?.status?.type || {};
  const completed = status?.completed === true ||
    String(status?.state || "").trim().toLowerCase() === "post" ||
    String(status?.name || "").trim().toLowerCase().includes("final");
  if (!completed) return null;

  const competitors = Array.isArray(competition?.competitors) ? competition.competitors : [];
  const away = competitors.find((entry: any) => String(entry?.homeAway || "").toLowerCase() === "away");
  const home = competitors.find((entry: any) => String(entry?.homeAway || "").toLowerCase() === "home");
  if (!away || !home) return null;

  const awayScore = scoreNumber(away?.score);
  const homeScore = scoreNumber(home?.score);
  const id = String(event?.id || competition?.id || "").trim().replace(/\.0$/, "");
  if (!id || awayScore == null || homeScore == null) return null;

  return { gameId: id, awayScore, homeScore };
}

function rowHeaders(rows: SheetRow[]) {
  const headers = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row || {})) headers.add(key);
  }
  return [...headers];
}

async function fetchTodayFinals(date: string) {
  const dateKey = date.replace(/-/g, "");
  const url = new URL("https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard");
  url.searchParams.set("dates", dateKey);
  url.searchParams.set("groups", "80");
  url.searchParams.set("limit", "200");

  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`ESPN NCAAF scoreboard returned ${response.status}`);
  }

  const payload = await response.json();
  const finals = new Map<string, FinalScore>();
  for (const event of Array.isArray(payload?.events) ? payload.events : []) {
    const final = finalFromEvent(event);
    if (final) finals.set(final.gameId, final);
  }
  return finals;
}

export async function repairTodayNcaafFinalScores(): Promise<RepairSummary> {
  const date = todayET();
  const schedule = await readSportWorksheet("NCAAF", "schedule");
  const candidates = schedule.filter((row) =>
    isoDate(row["Game Date"] || row.Date || "") === date &&
    Boolean(gameId(row)) &&
    !hasFinalScore(row),
  );

  if (!candidates.length) {
    return {
      date,
      checkedScheduleRows: 0,
      resolvedFinalGames: 0,
      repairedScheduleRows: 0,
    };
  }

  const finals = await fetchTodayFinals(date);
  const repaired = candidates.flatMap((row) => {
    const final = finals.get(gameId(row));
    if (!final) return [];
    return [{
      ...row,
      "Away Score": String(final.awayScore),
      "Home Score": String(final.homeScore),
      Completed: "TRUE",
    }];
  });

  if (repaired.length) {
    await upsertSportRows(
      "NCAAF",
      "schedule",
      rowHeaders(schedule),
      repaired,
      gameId,
    );
  }

  return {
    date,
    checkedScheduleRows: candidates.length,
    resolvedFinalGames: finals.size,
    repairedScheduleRows: repaired.length,
  };
}
