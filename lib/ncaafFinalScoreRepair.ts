import {
  readSportWorksheet,
  upsertSportRows,
  type SheetRow,
} from "./sportSheets";

type RepairSummary = {
  date: string;
  checkedScheduleRows: number;
  checkedScoreboards: number;
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
  const completed = ["true", "1", "yes", "completed"].includes(
    String(row.Completed ?? "").trim().toLowerCase(),
  );
  return completed && away !== "" && home !== "" &&
    Number.isFinite(Number(away)) && Number.isFinite(Number(home));
}

function scoreNumber(value: any) {
  const raw = value?.value ?? value?.displayValue ?? value;
  if (raw == null || String(raw).trim() === "") return null;
  const parsed = Number(raw);
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

type ScoreboardRequest = { year: number; seasonType: number; week?: number; date?: string };

function scoreboardRequest(row: SheetRow, date: string): ScoreboardRequest {
  const season = Number(row.Season || date.slice(0, 4));
  const rawWeek = String(row.Week ?? "").trim();
  const week = rawWeek ? Number(rawWeek) : NaN;
  const kind = String(row["Season Type"] ?? "").trim().toLowerCase();
  const seasonType = kind === "postseason" || kind === "3" ? 3 : 2;
  if (Number.isInteger(week) && week >= 0 && week <= 18 &&
      Number.isInteger(season) && season >= 2000 && season <= 2100) {
    return { year: season, seasonType, week };
  }
  return { year: Number(date.slice(0, 4)), seasonType, date };
}

async function fetchFinals(request: ScoreboardRequest) {
  const url = new URL("https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard");
  url.searchParams.set("dates", request.date ? request.date.replace(/-/g, "") : String(request.year));
  url.searchParams.set("groups", "80");
  url.searchParams.set("limit", "500");
  if (request.week !== undefined) {
    url.searchParams.set("seasontype", String(request.seasonType));
    url.searchParams.set("week", String(request.week));
  }

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

export async function repairNcaafFinalScores(): Promise<RepairSummary> {
  const date = todayET();
  const schedule = await readSportWorksheet("NCAAF", "schedule");
  const earliestYear = Number(date.slice(0, 4)) - 1;
  const candidates = schedule.filter((row) => {
    const gameDate = isoDate(row["Game Date"] || row.Date || "");
    return Boolean(gameDate) && gameDate <= date &&
      Number(gameDate.slice(0, 4)) >= earliestYear &&
      Boolean(gameId(row)) && !hasFinalScore(row);
  });

  if (!candidates.length) {
    return {
      date,
      checkedScheduleRows: 0,
      checkedScoreboards: 0,
      resolvedFinalGames: 0,
      repairedScheduleRows: 0,
    };
  }

  const requests = new Map<string, ScoreboardRequest>();
  for (const row of candidates) {
    const request = scoreboardRequest(row, isoDate(row["Game Date"] || row.Date || ""));
    requests.set(JSON.stringify(request), request);
  }

  const finals = new Map<string, FinalScore>();
  let failedScoreboards = 0;
  const batches = [...requests.values()];
  for (let offset = 0; offset < batches.length; offset += 8) {
    const results = await Promise.allSettled(batches.slice(offset, offset + 8).map(fetchFinals));
    for (const result of results) {
      if (result.status === "rejected") {
        failedScoreboards += 1;
        continue;
      }
      for (const [id, final] of result.value) finals.set(id, final);
    }
  }
  if (failedScoreboards === requests.size) {
    throw new Error(`All ${requests.size} ESPN NCAAF scoreboards failed`);
  }

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
    checkedScoreboards: requests.size,
    resolvedFinalGames: finals.size,
    repairedScheduleRows: repaired.length,
  };
}
