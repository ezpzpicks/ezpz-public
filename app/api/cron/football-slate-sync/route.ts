import { NextRequest, NextResponse } from "next/server";
import { readSportWorksheet, writeSportWorksheet } from "../../../../lib/sportSheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

type SheetRow = Record<string, string>;

type EspnCompetitor = {
  homeAway?: string;
  team?: { abbreviation?: string; displayName?: string; shortDisplayName?: string };
};

type EspnEvent = {
  id?: string;
  date?: string;
  season?: { year?: number };
  competitions?: Array<{ competitors?: EspnCompetitor[] }>;
};

const DAILY_SLATE_HEADERS = [
  "Date", "Season", "Week", "Game ID", "Game", "Away Team", "Home Team",
  "Projected Away", "Projected Home", "Projected Margin", "Projected Total",
  "Away Score Low", "Away Score High", "Home Score Low", "Home Score High",
  "Market Home Spread", "Market Total", "Home Spread Odds", "Away Spread Odds",
  "Total Over Odds", "Total Under Odds", "Away ML", "Home ML",
  "Spread Pick", "Spread Probability", "Spread Edge", "Spread Grade", "Spread Confluence",
  "Total Pick", "Total Probability", "Total Edge", "Total Grade", "Total Confluence",
  "ML Pick", "ML Probability", "ML Odds", "ML Edge", "ML Grade", "ML Confluence",
  "Reliability", "Data Confidence", "Personnel Confidence", "Previous Season Weight",
  "Current Season Weight", "Away Offensive Absence", "Away Defensive Absence",
  "Home Offensive Absence", "Home Defensive Absence", "Weather Adjustment",
  "Roof", "Temperature", "Wind", "Model Version", "Notes",
];

const NFL_ABBRS = new Set([
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB",
  "HOU", "IND", "JAX", "KC", "LAC", "LAR", "LV", "MIA", "MIN", "NE", "NO", "NYG",
  "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS",
]);

const NFL_ALIASES: Record<string, string[]> = {
  ARI: ["arizona", "cardinals", "arizona cardinals", "arz"],
  ATL: ["atlanta", "falcons", "atlanta falcons"], BAL: ["baltimore", "ravens", "baltimore ravens", "blt"],
  BUF: ["buffalo", "bills", "buffalo bills"], CAR: ["carolina", "panthers", "carolina panthers"],
  CHI: ["chicago", "bears", "chicago bears"], CIN: ["cincinnati", "bengals", "cincinnati bengals"],
  CLE: ["cleveland", "browns", "cleveland browns", "clv"], DAL: ["dallas", "cowboys", "dallas cowboys"],
  DEN: ["denver", "broncos", "denver broncos"], DET: ["detroit", "lions", "detroit lions"],
  GB: ["green bay", "packers", "green bay packers"], HOU: ["houston", "texans", "houston texans", "hst"],
  IND: ["indianapolis", "colts", "indianapolis colts"], JAX: ["jacksonville", "jaguars", "jacksonville jaguars"],
  KC: ["kansas city", "chiefs", "kansas city chiefs"], LAC: ["los angeles chargers", "la chargers", "chargers"],
  LAR: ["los angeles rams", "la rams", "rams"], LV: ["las vegas", "raiders", "las vegas raiders", "oak"],
  MIA: ["miami", "dolphins", "miami dolphins"], MIN: ["minnesota", "vikings", "minnesota vikings"],
  NE: ["new england", "patriots", "new england patriots"], NO: ["new orleans", "saints", "new orleans saints"],
  NYG: ["new york giants", "ny giants", "giants"], NYJ: ["new york jets", "ny jets", "jets"],
  PHI: ["philadelphia", "eagles", "philadelphia eagles"], PIT: ["pittsburgh", "steelers", "pittsburgh steelers"],
  SEA: ["seattle", "seahawks", "seattle seahawks"], SF: ["san francisco", "49ers", "san francisco 49ers"],
  TB: ["tampa bay", "buccaneers", "tampa bay buccaneers"], TEN: ["tennessee", "titans", "tennessee titans"],
  WAS: ["washington", "commanders", "washington commanders", "wsh"],
};

function textKey(value: unknown) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function teamKey(value: unknown) {
  const raw = String(value || "").trim();
  const upper = raw.toUpperCase();
  if (NFL_ABBRS.has(upper)) return upper;
  const key = textKey(raw);
  for (const [abbr, aliases] of Object.entries(NFL_ALIASES)) {
    if (textKey(abbr) === key || aliases.some((alias) => {
      const aliasKey = textKey(alias);
      return key === aliasKey || key.includes(aliasKey) || aliasKey.includes(key);
    })) return abbr;
  }
  return upper || key;
}

function todayET(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function isoDate(value: unknown) {
  const raw = String(value || "").trim();
  const match = raw.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  const us = raw.match(/(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?/);
  if (us) return `${us[3] || todayET().slice(0, 4)}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  return "";
}

function slateKey(row: SheetRow) {
  const date = isoDate(row.Date || row["Game Date"] || "");
  const away = teamKey(row["Away Team"]);
  const home = teamKey(row["Home Team"]);
  return date && away && home ? `${date}|${away}|${home}` : "";
}

function etDateFromIso(value: string) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? todayET(parsed) : "";
}

async function loadEspnGames(date: string): Promise<SheetRow[]> {
  const compactDate = date.replace(/-/g, "");
  const url = new URL("https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard");
  url.searchParams.set("dates", compactDate);
  url.searchParams.set("limit", "100");
  const response = await fetch(url, {
    cache: "no-store",
    headers: { "User-Agent": "Mozilla/5.0 (compatible; EZPZ-Picks/1.0; +https://ezpzpicks.com)" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`ESPN NFL schedule request failed ${response.status}`);
  const data = await response.json() as { events?: EspnEvent[] };
  const rows: SheetRow[] = [];
  for (const event of data.events || []) {
    if (event.date && etDateFromIso(event.date) !== date) continue;
    const competitors = event.competitions?.[0]?.competitors || [];
    const away = competitors.find((item) => item.homeAway === "away")?.team;
    const home = competitors.find((item) => item.homeAway === "home")?.team;
    const awayTeam = teamKey(away?.abbreviation || away?.displayName || away?.shortDisplayName || "");
    const homeTeam = teamKey(home?.abbreviation || home?.displayName || home?.shortDisplayName || "");
    if (!awayTeam || !homeTeam) continue;
    rows.push({
      Date: date,
      Season: String(event.season?.year || date.slice(0, 4)),
      Week: "",
      "Game ID": String(event.id || `${date}-${awayTeam}-${homeTeam}`),
      Game: `${awayTeam} @ ${homeTeam}`,
      "Away Team": awayTeam,
      "Home Team": homeTeam,
      Notes: "Schedule-only shell from ESPN; model projections populate when the matchup is built.",
    });
  }
  return rows;
}

function fallbackRows(date: string, trendRows: SheetRow[], snapshots: SheetRow[]) {
  const map = new Map<string, SheetRow>();
  const add = (row: SheetRow, source: string) => {
    const rowDate = isoDate(row.Date || row["Game Date"] || "");
    if (rowDate !== date) return;
    const away = teamKey(row["Away Team"]);
    const home = teamKey(row["Home Team"]);
    if (!away || !home) return;
    const shell: SheetRow = {
      Date: date,
      Season: date.slice(0, 4),
      Week: String(row.Week || ""),
      "Game ID": String(row["Game ID"] || row["Game Key"] || `${date}-${away}-${home}`),
      Game: `${away} @ ${home}`,
      "Away Team": away,
      "Home Team": home,
      Notes: `Schedule-only shell recovered from ${source}; model projections populate when the matchup is built.`,
    };
    const key = slateKey(shell);
    if (key && !map.has(key)) map.set(key, shell);
  };
  trendRows.forEach((row) => add(row, "football trend tracking"));
  snapshots.forEach((row) => add(row, "DraftKings snapshot tracking"));
  return [...map.values()];
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured." }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const date = todayET();
  try {
    const [existing, trends, snapshots] = await Promise.all([
      readSportWorksheet("NFL", "daily_slate"),
      readSportWorksheet("NFL", "all_game_trends"),
      readSportWorksheet("NFL", "public_split_snapshots"),
    ]);

    let discovered: SheetRow[] = [];
    let source = "ESPN";
    let warning = "";
    try {
      discovered = await loadEspnGames(date);
    } catch (error) {
      warning = error instanceof Error ? error.message : String(error);
    }
    if (!discovered.length) {
      discovered = fallbackRows(date, trends, snapshots);
      source = "stored football tracking";
    }

    const merged = new Map<string, SheetRow>();
    const passthrough: SheetRow[] = [];
    for (const row of existing) {
      const key = slateKey(row);
      if (key) merged.set(key, row);
      else passthrough.push(row);
    }
    let added = 0;
    for (const row of discovered) {
      const key = slateKey(row);
      if (!key || merged.has(key)) continue;
      merged.set(key, row);
      added += 1;
    }

    await writeSportWorksheet("NFL", "daily_slate", DAILY_SLATE_HEADERS, [...passthrough, ...merged.values()]);
    const todayRows = [...merged.values()].filter((row) => isoDate(row.Date) === date);
    return NextResponse.json({
      ok: true,
      sport: "NFL",
      date,
      source,
      discoveredGames: discovered.length,
      addedGames: added,
      slateGamesToday: todayRows.length,
      warning,
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    console.error("NFL slate schedule sync failed", error);
    return NextResponse.json({
      ok: false,
      sport: "NFL",
      date,
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
