import {
  footballPublicSplitWarning,
  readExternalFootballMarket,
  syncExternalFootballMarkets,
  type ExternalFootballMarketSourceConfig,
  type ExternalFootballMarketSplit,
} from "./footballWeeklyMarket";
import {
  ensureSportWorksheet,
  readSportWorksheet,
  upsertSportRows,
  type FootballSport,
  type SheetRow,
} from "./sportSheets";

const LUMIFY_BASE_URL = "https://lumify.ai";
const BETMGM_BOOKMAKER = "betmgm";
const EVENT_CATALOG_TAB = "betmgm_event_catalog";

export const BETMGM_MARKET_CONFIG: ExternalFootballMarketSourceConfig = {
  source: "BetMGM",
  sourceUrl: "https://lumify.ai/docs/reference#betting-splits",
  postedGamesTab: "betmgm_posted_games",
  weeklyTrendsTab: "betmgm_weekly_market_trends",
  marketHistoryTab: "betmgm_odds_snapshot",
  resultHistoryTab: "betmgm_all_game_trends",
};

const EVENT_CATALOG_HEADERS = [
  "Date", "Game Key", "Game Time", "Game", "Away Team", "Home Team",
  "Event ID", "Starts At UTC", "Status", "Source", "Source URL",
  "First Seen", "Last Seen", "Last Snapshot",
];

type LumifyParticipant = {
  role?: string;
  team?: { name?: string; abbreviation?: string };
};

type LumifyEvent = {
  id?: number;
  name?: string;
  starts_at?: string;
  status?: string;
  participants?: LumifyParticipant[];
  odds?: {
    available?: boolean;
    bookmakers?: Array<{
      bookmaker?: string;
      markets?: Array<{
        key?: string;
        outcomes?: Array<{
          outcome?: string;
          price?: number;
          point?: number | null;
          is_main?: boolean;
        }>;
      }>;
    }>;
  };
};

type LumifySplitSide = {
  bets_pct?: number;
  handle_pct?: number;
  price?: number | null;
  line?: number | null;
};

type LumifySplitBook = {
  bookmaker?: string;
  name?: string;
  moneyline?: { home?: LumifySplitSide; away?: LumifySplitSide };
  spread?: { home?: LumifySplitSide; away?: LumifySplitSide };
  total?: { over?: LumifySplitSide; under?: LumifySplitSide };
};

type LumifySplits = {
  event_id?: number;
  available?: boolean;
  captured_at?: string | null;
  bookmakers?: LumifySplitBook[];
};

function apiKey() {
  return String(process.env.LUMIFY_API_KEY || "").trim();
}

export function betMgmTrackingConfigured() {
  return Boolean(apiKey());
}

function nowIso() {
  return new Date().toISOString();
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

function dateShiftIso(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function eventEt(startsAt: string) {
  const date = new Date(startsAt);
  if (!Number.isFinite(date.getTime())) return { date: "", time: "" };
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  const dayPeriod = get("dayPeriod").toUpperCase();
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${Number(get("hour"))}:${get("minute")} ${dayPeriod}`,
  };
}

function catalogGameKey(date: string, awayTeam: string, homeTeam: string) {
  return `${date}|${textKey(awayTeam)}|${textKey(homeTeam)}`;
}

function eventIdKey(row: SheetRow) {
  return String(row["Event ID"] || "").trim();
}

function participantName(event: LumifyEvent, role: "away" | "home") {
  const participant = (event.participants || []).find(
    (item) => String(item.role || "").toLowerCase() === role,
  );
  return String(participant?.team?.name || "").trim();
}

async function lumifyJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = apiKey();
  if (!key) throw new Error("LUMIFY_API_KEY is not configured.");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${key}`);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetch(`${LUMIFY_BASE_URL}${path}`, {
    ...init,
    cache: "no-store",
    headers,
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Lumify ${path} failed ${response.status}: ${body.slice(0, 240)}`);
  }
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(`Lumify ${path} returned invalid JSON.`);
  }
}

function sportSlug(sport: FootballSport) {
  return sport === "NFL" ? "nfl" : "ncaaf";
}

async function listLumifyEvents(sport: FootballSport) {
  const params = new URLSearchParams({
    sport: sportSlug(sport),
    from: dateShiftIso(-1),
    to: dateShiftIso(8),
    limit: "100",
    include_scores: "true",
  });
  const payload = await lumifyJson<{
    events?: LumifyEvent[];
    next_after_id?: number | null;
  }>(`/v1/events?${params.toString()}`);
  return Array.isArray(payload.events) ? payload.events : [];
}

function trackableStatus(value: unknown) {
  return ["scheduled", "delayed", "upcoming"].includes(String(value || "").toLowerCase());
}

export async function discoverBetMgmFootballEvents(sport: FootballSport) {
  await ensureSportWorksheet(sport, EVENT_CATALOG_TAB, EVENT_CATALOG_HEADERS);
  if (!betMgmTrackingConfigured()) {
    return {
      ok: true,
      sport,
      source: "BetMGM",
      configured: false,
      configurationNeeded: "LUMIFY_API_KEY",
      eventsFound: 0,
      eventsStored: 0,
    };
  }

  const existing = await readSportWorksheet(sport, EVENT_CATALOG_TAB, EVENT_CATALOG_HEADERS);
  const existingById = new Map(existing.map((row) => [eventIdKey(row), row]));
  const events = await listLumifyEvents(sport);
  const stamp = nowIso();
  const rows: SheetRow[] = [];

  for (const event of events) {
    const eventId = Number(event.id);
    const startsAt = String(event.starts_at || "").trim();
    const awayTeam = participantName(event, "away");
    const homeTeam = participantName(event, "home");
    if (!Number.isFinite(eventId) || !startsAt || !awayTeam || !homeTeam) continue;
    if (!trackableStatus(event.status)) continue;
    const et = eventEt(startsAt);
    if (!et.date || !et.time) continue;
    const existingRow = existingById.get(String(eventId));
    rows.push({
      Date: et.date,
      "Game Key": catalogGameKey(et.date, awayTeam, homeTeam),
      "Game Time": et.time,
      Game: `${awayTeam} @ ${homeTeam}`,
      "Away Team": awayTeam,
      "Home Team": homeTeam,
      "Event ID": String(eventId),
      "Starts At UTC": startsAt,
      Status: String(event.status || ""),
      Source: "BetMGM",
      "Source URL": `${LUMIFY_BASE_URL}/v1/events/${eventId}/splits`,
      "First Seen": String(existingRow?.["First Seen"] || stamp),
      "Last Seen": stamp,
      "Last Snapshot": String(existingRow?.["Last Snapshot"] || ""),
    });
  }

  if (rows.length) {
    await upsertSportRows(
      sport,
      EVENT_CATALOG_TAB,
      EVENT_CATALOG_HEADERS,
      rows,
      eventIdKey,
    );
  }

  return {
    ok: true,
    sport,
    source: "BetMGM",
    configured: true,
    eventsFound: events.length,
    eventsStored: rows.length,
    updatedAt: stamp,
  };
}

function minutesUntil(startsAt: unknown) {
  const stamp = Date.parse(String(startsAt || ""));
  return Number.isFinite(stamp) ? (stamp - Date.now()) / 60_000 : null;
}

function lastSnapshotAgeMinutes(value: unknown) {
  const stamp = Date.parse(String(value || ""));
  return Number.isFinite(stamp) ? Math.max(0, (Date.now() - stamp) / 60_000) : null;
}

function snapshotIntervalMinutes(minutesToKickoff: number) {
  if (minutesToKickoff > 36 * 60) return null;
  if (minutesToKickoff > 12 * 60) return 12 * 60;
  if (minutesToKickoff > 6 * 60) return 4 * 60;
  if (minutesToKickoff > 2 * 60) return 90;
  if (minutesToKickoff > 15) return 30;
  if (minutesToKickoff >= -15) return 15;
  return null;
}

function snapshotDue(row: SheetRow) {
  if (!trackableStatus(row.Status)) return false;
  const minutes = minutesUntil(row["Starts At UTC"]);
  if (minutes == null) return false;
  const interval = snapshotIntervalMinutes(minutes);
  if (interval == null) return false;
  const age = lastSnapshotAgeMinutes(row["Last Snapshot"]);
  return age == null || age >= interval - 0.5;
}

async function fetchOddsBatch(eventIds: number[]) {
  if (!eventIds.length) return new Map<number, LumifyEvent>();
  const payload = await lumifyJson<{
    events?: LumifyEvent[];
    not_found?: number[];
  }>("/v1/events/batch", {
    method: "POST",
    body: JSON.stringify({
      event_ids: eventIds,
      include_odds: true,
      bookmaker: BETMGM_BOOKMAKER,
    }),
  });
  return new Map(
    (payload.events || [])
      .filter((event) => Number.isFinite(Number(event.id)))
      .map((event) => [Number(event.id), event]),
  );
}

async function fetchSplits(eventId: number) {
  return lumifyJson<LumifySplits>(`/v1/events/${eventId}/splits`);
}

function betMgmOddsBook(event: LumifyEvent | undefined) {
  return (event?.odds?.bookmakers || []).find(
    (book) => String(book.bookmaker || "").toLowerCase() === BETMGM_BOOKMAKER,
  );
}

function oddsPrice(
  event: LumifyEvent | undefined,
  marketKey: "spreads" | "totals",
  outcomeName: string,
  point: number | null,
) {
  const market = (betMgmOddsBook(event)?.markets || []).find(
    (item) => String(item.key || "").toLowerCase() === marketKey,
  );
  const outcomes = market?.outcomes || [];
  const targetName = textKey(outcomeName);
  const exact = outcomes.find((outcome) => {
    if (textKey(outcome.outcome) !== targetName) return false;
    if (point == null || outcome.point == null) return true;
    return Math.abs(Number(outcome.point) - point) < 0.01;
  });
  const fallback = exact || outcomes.find((outcome) => textKey(outcome.outcome) === targetName);
  const price = Number(fallback?.price);
  return Number.isFinite(price) ? price : -110;
}

function americanOddsLabel(value: number) {
  return value > 0 ? `+${Math.round(value)}` : String(Math.round(value));
}

function finitePct(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100 ? number : null;
}

function finiteLine(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function splitRow(
  catalog: SheetRow,
  market: "Spread" | "Total",
  selectionTeam: string,
  side: "Over" | "Under" | "",
  line: number,
  odds: number,
  betsPct: number,
  moneyPct: number,
  sourceUrl: string,
): ExternalFootballMarketSplit {
  const warning = footballPublicSplitWarning(betsPct, moneyPct);
  const sideGroup = market === "Total"
    ? side
    : line < 0
      ? "Favorite"
      : line > 0
        ? "Underdog"
        : "";
  const lineLabel = line > 0 ? `+${line}` : String(line);
  return {
    date: String(catalog.Date || ""),
    eventTime: String(catalog["Game Time"] || ""),
    game: String(catalog.Game || ""),
    awayTeam: String(catalog["Away Team"] || ""),
    homeTeam: String(catalog["Home Team"] || ""),
    market,
    selection: market === "Total" ? `${side} ${line}` : `${selectionTeam} ${lineLabel}`,
    selectionTeam,
    side,
    sideGroup,
    line,
    odds: americanOddsLabel(odds),
    moneyPct,
    betsPct,
    gapPct: warning.gapPct,
    warningKey: warning.warningKey,
    warning: warning.warning,
    warningTone: warning.warningTone,
    warningNegative: warning.warningNegative,
    sourceUrl,
  };
}

function normalizeBetMgmEvent(
  catalog: SheetRow,
  splitPayload: LumifySplits,
  eventDetail: LumifyEvent | undefined,
) {
  const sourceUrl = String(catalog["Source URL"] || "");
  const book = (splitPayload.bookmakers || []).find(
    (item) => String(item.bookmaker || "").toLowerCase() === BETMGM_BOOKMAKER,
  );
  if (!splitPayload.available || !book) return [] as ExternalFootballMarketSplit[];

  const rows: ExternalFootballMarketSplit[] = [];
  const awayTeam = String(catalog["Away Team"] || "");
  const homeTeam = String(catalog["Home Team"] || "");

  const spreadSides = [
    { data: book.spread?.away, team: awayTeam },
    { data: book.spread?.home, team: homeTeam },
  ];
  for (const item of spreadSides) {
    const betsPct = finitePct(item.data?.bets_pct);
    const moneyPct = finitePct(item.data?.handle_pct);
    const line = finiteLine(item.data?.line);
    if (betsPct == null || moneyPct == null || line == null || !item.team) continue;
    rows.push(splitRow(
      catalog,
      "Spread",
      item.team,
      "",
      line,
      oddsPrice(eventDetail, "spreads", item.team, line),
      betsPct,
      moneyPct,
      sourceUrl,
    ));
  }

  const totalSides = [
    { data: book.total?.over, side: "Over" as const },
    { data: book.total?.under, side: "Under" as const },
  ];
  for (const item of totalSides) {
    const betsPct = finitePct(item.data?.bets_pct);
    const moneyPct = finitePct(item.data?.handle_pct);
    const line = finiteLine(item.data?.line);
    if (betsPct == null || moneyPct == null || line == null) continue;
    rows.push(splitRow(
      catalog,
      "Total",
      "",
      item.side,
      line,
      oddsPrice(eventDetail, "totals", item.side, line),
      betsPct,
      moneyPct,
      sourceUrl,
    ));
  }

  return rows;
}

export async function syncBetMgmFootballMarket(sport: FootballSport) {
  await ensureSportWorksheet(sport, EVENT_CATALOG_TAB, EVENT_CATALOG_HEADERS);
  if (!betMgmTrackingConfigured()) {
    const readOnly = await readExternalFootballMarket(sport, BETMGM_MARKET_CONFIG);
    return {
      ...readOnly,
      configured: false,
      configurationNeeded: "LUMIFY_API_KEY",
      dueEvents: 0,
      snapshotEvents: 0,
      sourceErrors: [],
    };
  }

  let catalog = await readSportWorksheet(sport, EVENT_CATALOG_TAB, EVENT_CATALOG_HEADERS);
  if (!catalog.length) {
    await discoverBetMgmFootballEvents(sport);
    catalog = await readSportWorksheet(sport, EVENT_CATALOG_TAB, EVENT_CATALOG_HEADERS);
  }

  const allDue = catalog
    .filter(snapshotDue)
    .sort((left, right) =>
      Number(minutesUntil(left["Starts At UTC"]) || 0) - Number(minutesUntil(right["Starts At UTC"]) || 0)
    );
  // NFL never exceeds this in one slate and this keeps the split requests
  // inside Lumify's documented per-minute request limit.
  const due = allDue.slice(0, 16);
  const deferred = Math.max(0, allDue.length - due.length);
  const ids = due
    .map((row) => Number(row["Event ID"]))
    .filter((id) => Number.isFinite(id));

  const errors: string[] = [];
  if (deferred) errors.push(`${deferred} due events deferred to the next snapshot cycle for rate-limit safety.`);

  let oddsById = new Map<number, LumifyEvent>();
  if (ids.length) {
    try {
      oddsById = await fetchOddsBatch(ids);
    } catch (error) {
      errors.push(`BetMGM odds batch failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const splitResponses = await Promise.all(due.map(async (row) => {
    const eventId = Number(row["Event ID"]);
    if (!Number.isFinite(eventId)) return { row, eventId, payload: null as LumifySplits | null };
    try {
      return { row, eventId, payload: await fetchSplits(eventId) };
    } catch (error) {
      errors.push(`BetMGM splits ${eventId} failed: ${error instanceof Error ? error.message : String(error)}`);
      return { row, eventId, payload: null as LumifySplits | null };
    }
  }));

  const splits: ExternalFootballMarketSplit[] = [];
  const successfulRows: SheetRow[] = [];
  const snapshotStamp = nowIso();

  for (const item of splitResponses) {
    if (!item.payload) continue;
    const normalized = normalizeBetMgmEvent(
      item.row,
      item.payload,
      oddsById.get(item.eventId),
    );
    if (!normalized.length) {
      errors.push(`No BetMGM spread/total splits were available for event ${item.eventId}.`);
      continue;
    }
    splits.push(...normalized);
    successfulRows.push({ ...item.row, "Last Snapshot": snapshotStamp, "Last Seen": snapshotStamp });
  }

  const sync = await syncExternalFootballMarkets(
    sport,
    BETMGM_MARKET_CONFIG,
    splits,
    errors,
  );

  if (successfulRows.length) {
    await upsertSportRows(
      sport,
      EVENT_CATALOG_TAB,
      EVENT_CATALOG_HEADERS,
      successfulRows,
      eventIdKey,
    );
  }

  return {
    ...sync,
    configured: true,
    provider: "Lumify",
    bookmaker: "betmgm",
    dueEvents: due.length,
    deferredEvents: deferred,
    snapshotEvents: successfulRows.length,
    sourceErrors: errors,
  };
}

export async function readBetMgmFootballMarket(sport: FootballSport) {
  await ensureSportWorksheet(sport, EVENT_CATALOG_TAB, EVENT_CATALOG_HEADERS);
  const [market, catalog] = await Promise.all([
    readExternalFootballMarket(sport, BETMGM_MARKET_CONFIG),
    readSportWorksheet(sport, EVENT_CATALOG_TAB, EVENT_CATALOG_HEADERS),
  ]);
  return {
    ...market,
    configured: betMgmTrackingConfigured(),
    configurationNeeded: betMgmTrackingConfigured() ? null : "LUMIFY_API_KEY",
    provider: "Lumify",
    bookmaker: "betmgm",
    eventCatalog: catalog,
  };
}
