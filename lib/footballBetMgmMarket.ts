import {
  footballPublicSplitWarning,
  readExternalFootballMarket,
  syncExternalFootballMarkets,
  type ExternalFootballMarketSourceConfig,
  type ExternalFootballMarketSplit,
} from "./footballWeeklyMarket";
import { readSportWorksheet, type FootballSport, type SheetRow } from "./sportSheets";

const BETMGM_NFL_PUBLIC_URL =
  "https://sports.betmgm.com/en/blog/nfl/nfl-week-public-betting-odds-picks-expert-predictions-bm16/";

export const BETMGM_MARKET_CONFIG: ExternalFootballMarketSourceConfig = {
  source: "BetMGM",
  sourceUrl: BETMGM_NFL_PUBLIC_URL,
  postedGamesTab: "betmgm_posted_games",
  weeklyTrendsTab: "betmgm_weekly_market_trends",
  marketHistoryTab: "betmgm_odds_snapshot",
  resultHistoryTab: "betmgm_all_game_trends",
};

type ParsedSpreadRow = {
  teamOneLabel: string;
  teamTwoLabel: string;
  favoriteLabel: string;
  favoriteLine: number;
  betsPct: number;
  betsTeamLabel: string;
  moneyPct: number;
  moneyTeamLabel: string;
};

type ParsedTotalRow = {
  teamOneLabel: string;
  teamTwoLabel: string;
  totalLine: number;
  betsPct: number;
  betsSide: "Over" | "Under";
  moneyPct: number;
  moneySide: "Over" | "Under";
};

type ScheduleGame = {
  date: string;
  eventTime: string;
  awayTeam: string;
  homeTeam: string;
  awayCode: string;
  homeCode: string;
};

const NFL_ALIASES: Record<string, string[]> = {
  ARI: ["Arizona Cardinals", "Cardinals", "Arizona", "ARI", "ARZ"],
  ATL: ["Atlanta Falcons", "Falcons", "Atlanta", "ATL"],
  BAL: ["Baltimore Ravens", "Ravens", "Baltimore", "BAL", "BLT"],
  BUF: ["Buffalo Bills", "Bills", "Buffalo", "BUF"],
  CAR: ["Carolina Panthers", "Panthers", "Carolina", "CAR"],
  CHI: ["Chicago Bears", "Bears", "Chicago", "CHI"],
  CIN: ["Cincinnati Bengals", "Bengals", "Cincinnati", "CIN"],
  CLE: ["Cleveland Browns", "Browns", "Cleveland", "CLE", "CLV"],
  DAL: ["Dallas Cowboys", "Cowboys", "Dallas", "DAL"],
  DEN: ["Denver Broncos", "Broncos", "Denver", "DEN"],
  DET: ["Detroit Lions", "Lions", "Detroit", "DET"],
  GB: ["Green Bay Packers", "Packers", "Green Bay", "GB"],
  HOU: ["Houston Texans", "Texans", "Houston", "HOU", "HST"],
  IND: ["Indianapolis Colts", "Colts", "Indianapolis", "IND"],
  JAX: ["Jacksonville Jaguars", "Jaguars", "Jacksonville", "JAX", "JAC"],
  KC: ["Kansas City Chiefs", "Chiefs", "Kansas City", "KC"],
  LV: ["Las Vegas Raiders", "Raiders", "Las Vegas", "LV", "OAK"],
  LAC: ["Los Angeles Chargers", "LA Chargers", "Chargers", "LAC"],
  LAR: ["Los Angeles Rams", "LA Rams", "Rams", "LAR", "LA"],
  MIA: ["Miami Dolphins", "Dolphins", "Miami", "MIA"],
  MIN: ["Minnesota Vikings", "Vikings", "Minnesota", "MIN"],
  NE: ["New England Patriots", "Patriots", "New England", "NE"],
  NO: ["New Orleans Saints", "Saints", "New Orleans", "NO"],
  NYG: ["New York Giants", "NY Giants", "Giants", "NYG"],
  NYJ: ["New York Jets", "NY Jets", "Jets", "NYJ"],
  PHI: ["Philadelphia Eagles", "Eagles", "Philadelphia", "PHI"],
  PIT: ["Pittsburgh Steelers", "Steelers", "Pittsburgh", "PIT"],
  SEA: ["Seattle Seahawks", "Seahawks", "Seattle", "SEA"],
  SF: ["San Francisco 49ers", "49ers", "San Francisco", "SF"],
  TB: ["Tampa Bay Buccaneers", "Buccaneers", "Bucs", "Tampa Bay", "TB"],
  TEN: ["Tennessee Titans", "Titans", "Tennessee", "TEN"],
  WAS: ["Washington Commanders", "Commanders", "Washington", "WAS", "WSH"],
};

function textKey(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nflTeamCode(value: unknown) {
  const key = textKey(value);
  if (!key) return "";
  for (const [code, aliases] of Object.entries(NFL_ALIASES)) {
    if (textKey(code) === key) return code;
    if (aliases.some((alias) => {
      const aliasKey = textKey(alias);
      return aliasKey === key || aliasKey.endsWith(` ${key}`) || key.endsWith(` ${aliasKey}`);
    })) return code;
  }
  return "";
}

function decodeHtml(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function plainText(value: string) {
  return decodeHtml(
    String(value || "")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tableRows(rawHtml: string) {
  const tables = String(rawHtml || "").match(/<table\b[^>]*>[\s\S]*?<\/table>/gi) || [];
  return tables.map((table) => {
    const rows = table.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
    return {
      text: textKey(plainText(table)),
      rows: rows.map((row) => {
        const cells = row.match(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/gi) || [];
        return cells.map(plainText).filter(Boolean);
      }).filter((cells) => cells.length),
    };
  });
}

function matchupLabels(value: string) {
  const parts = String(value || "").split(/\s+(?:vs\.?|at|@)\s+/i).map((item) => item.trim()).filter(Boolean);
  return parts.length >= 2 ? [parts[0], parts[1]] as const : null;
}

function pctSelection(value: string) {
  const match = String(value || "").match(/(\d+(?:\.\d+)?)%\s+(.+)/i);
  if (!match) return null;
  const pct = Number(match[1]);
  return Number.isFinite(pct) ? { pct, label: match[2].trim() } : null;
}

function sidePct(value: string) {
  const match = String(value || "").match(/(\d+(?:\.\d+)?)%\s*(over|under)\b/i);
  if (!match) return null;
  const pct = Number(match[1]);
  if (!Number.isFinite(pct)) return null;
  return { pct, side: (match[2][0].toUpperCase() + match[2].slice(1).toLowerCase()) as "Over" | "Under" };
}

function parseBetMgmPublicTables(rawHtml: string) {
  const spreads: ParsedSpreadRow[] = [];
  const totals: ParsedTotalRow[] = [];

  for (const table of tableRows(rawHtml)) {
    const hasBets = table.text.includes("of bets");
    const hasMoney = table.text.includes("of money");
    if (!hasBets || !hasMoney) continue;

    const spreadTable = table.text.includes("spread");
    const totalTable = table.text.includes("total");

    for (const cells of table.rows) {
      if (cells.length < 4) continue;
      const matchup = matchupLabels(cells[0]);
      if (!matchup) continue;

      if (spreadTable) {
        const spreadMatch = cells[1].match(/^(.+?)\s+([+-]\d+(?:\.\d+)?)$/);
        const bets = pctSelection(cells[2]);
        const money = pctSelection(cells[3]);
        if (!spreadMatch || !bets || !money) continue;
        const line = Number(spreadMatch[2]);
        if (!Number.isFinite(line)) continue;
        spreads.push({
          teamOneLabel: matchup[0],
          teamTwoLabel: matchup[1],
          favoriteLabel: spreadMatch[1].trim(),
          favoriteLine: line,
          betsPct: bets.pct,
          betsTeamLabel: bets.label,
          moneyPct: money.pct,
          moneyTeamLabel: money.label,
        });
        continue;
      }

      // If BetMGM starts publishing a full Total / Bets / Money table, ingest it
      // automatically. Current NFL weekly pages expose full money splits for
      // spreads but only a "Most Bet Totals" ticket list, which is intentionally
      // not used because it cannot satisfy the DraftKings-equivalent money gate.
      if (totalTable) {
        const lineMatch = cells[1].match(/(\d+(?:\.\d+)?)/);
        const bets = sidePct(cells[2]);
        const money = sidePct(cells[3]);
        const line = lineMatch ? Number(lineMatch[1]) : NaN;
        if (!Number.isFinite(line) || !bets || !money) continue;
        totals.push({
          teamOneLabel: matchup[0],
          teamTwoLabel: matchup[1],
          totalLine: line,
          betsPct: bets.pct,
          betsSide: bets.side,
          moneyPct: money.pct,
          moneySide: money.side,
        });
      }
    }
  }

  return { spreads, totals };
}

async function fetchBetMgmPublicHtml() {
  const response = await fetch(BETMGM_NFL_PUBLIC_URL, {
    cache: "no-store",
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; EZPZ-Picks/1.0; +https://ezpzpicks.com)",
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`BetMGM public betting page failed ${response.status}`);
  return response.text();
}

function normalizedDate(value: unknown) {
  const raw = String(value || "").trim();
  const iso = raw.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const us = raw.match(/(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?/);
  if (!us) return "";
  const year = us[3] || new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
  }).format(new Date());
  return `${year}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
}

function parsedWeek(rawHtml: string) {
  const text = plainText(rawHtml);
  const match = text.match(/NFL\s+Week\s+(\d+)\s+Public\s+Betting/i)
    || text.match(/Public\s+Betting[^.]{0,80}Week\s+(\d+)/i);
  const week = match ? Number(match[1]) : NaN;
  return Number.isFinite(week) && week > 0 && week <= 25 ? week : null;
}

function storedScheduleGame(row: SheetRow): ScheduleGame | null {
  const date = normalizedDate(row.Date || row["Game Date"]);
  const eventTime = String(row["Game Time"] || row["Kickoff Time"] || row.Kickoff || "").trim();
  const awayTeam = String(row["Away Team"] || "").trim();
  const homeTeam = String(row["Home Team"] || "").trim();
  const awayCode = nflTeamCode(awayTeam);
  const homeCode = nflTeamCode(homeTeam);
  if (!date || !eventTime || !awayCode || !homeCode) return null;
  return { date, eventTime, awayTeam, homeTeam, awayCode, homeCode };
}

async function loadTrackedScheduleGames(sport: FootballSport) {
  const [posted, weekly] = await Promise.all([
    readSportWorksheet(sport, "posted_games"),
    readSportWorksheet(sport, "weekly_market_trends"),
  ]);
  const map = new Map<string, ScheduleGame>();
  for (const row of [...posted, ...weekly]) {
    const game = storedScheduleGame(row);
    if (!game) continue;
    const key = `${game.date}|${game.awayCode}|${game.homeCode}`;
    if (!map.has(key)) map.set(key, game);
  }
  return [...map.values()];
}

function matchScheduleGame(teamOneLabel: string, teamTwoLabel: string, games: ScheduleGame[]) {
  const one = nflTeamCode(teamOneLabel);
  const two = nflTeamCode(teamTwoLabel);
  if (!one || !two || one === two) return null;
  return games.find((game) => {
    const codes = new Set([game.awayCode, game.homeCode]);
    return codes.has(one) && codes.has(two);
  }) || null;
}

function complement(value: number) {
  return Math.round((100 - value) * 10) / 10;
}

function selectedPct(selectionCode: string, listedCode: string, listedPct: number) {
  return selectionCode === listedCode ? listedPct : complement(listedPct);
}

function spreadSplits(row: ParsedSpreadRow, game: ScheduleGame): ExternalFootballMarketSplit[] {
  const favoriteCode = nflTeamCode(row.favoriteLabel);
  const betsCode = nflTeamCode(row.betsTeamLabel);
  const moneyCode = nflTeamCode(row.moneyTeamLabel);
  if (!favoriteCode || !betsCode || !moneyCode) return [];
  if (![game.awayCode, game.homeCode].includes(favoriteCode)) return [];
  if (![game.awayCode, game.homeCode].includes(betsCode)) return [];
  if (![game.awayCode, game.homeCode].includes(moneyCode)) return [];

  const favoriteLine = row.favoriteLine > 0 ? -row.favoriteLine : row.favoriteLine;
  const selections = [
    { code: game.awayCode, team: game.awayTeam },
    { code: game.homeCode, team: game.homeTeam },
  ];

  return selections.map(({ code, team }) => {
    const line = code === favoriteCode ? favoriteLine : -favoriteLine;
    const betsPct = selectedPct(code, betsCode, row.betsPct);
    const moneyPct = selectedPct(code, moneyCode, row.moneyPct);
    const warning = footballPublicSplitWarning(betsPct, moneyPct);
    return {
      date: game.date,
      eventTime: game.eventTime,
      game: `${game.awayTeam} @ ${game.homeTeam}`,
      awayTeam: game.awayTeam,
      homeTeam: game.homeTeam,
      market: "Spread",
      selection: `${team} ${line > 0 ? "+" : ""}${line}`,
      selectionTeam: team,
      side: "",
      sideGroup: line < 0 ? "Favorite" : line > 0 ? "Underdog" : "",
      line,
      // BetMGM's public weekly split table publishes the spread number but not
      // the price. Use the standard -110 research price so W/L and signal
      // qualification remain exact; ROI is explicitly an estimated -110 ROI.
      odds: "-110",
      betsPct,
      moneyPct,
      gapPct: warning.gapPct,
      warningKey: warning.warningKey,
      warning: warning.warning,
      warningTone: warning.warningTone,
      warningNegative: warning.warningNegative,
      sourceUrl: BETMGM_NFL_PUBLIC_URL,
    };
  });
}

function totalSplits(row: ParsedTotalRow, game: ScheduleGame): ExternalFootballMarketSplit[] {
  const betsPctFor = (side: "Over" | "Under") =>
    side === row.betsSide ? row.betsPct : complement(row.betsPct);
  const moneyPctFor = (side: "Over" | "Under") =>
    side === row.moneySide ? row.moneyPct : complement(row.moneyPct);

  return (["Over", "Under"] as const).map((side) => {
    const betsPct = betsPctFor(side);
    const moneyPct = moneyPctFor(side);
    const warning = footballPublicSplitWarning(betsPct, moneyPct);
    return {
      date: game.date,
      eventTime: game.eventTime,
      game: `${game.awayTeam} @ ${game.homeTeam}`,
      awayTeam: game.awayTeam,
      homeTeam: game.homeTeam,
      market: "Total",
      selection: `${side} ${row.totalLine}`,
      selectionTeam: "",
      side,
      sideGroup: side,
      line: row.totalLine,
      odds: "-110",
      betsPct,
      moneyPct,
      gapPct: warning.gapPct,
      warningKey: warning.warningKey,
      warning: warning.warning,
      warningTone: warning.warningTone,
      warningNegative: warning.warningNegative,
      sourceUrl: BETMGM_NFL_PUBLIC_URL,
    };
  });
}

async function loadDirectBetMgmSplits(sport: FootballSport) {
  if (sport !== "NFL") {
    return {
      splits: [] as ExternalFootballMarketSplit[],
      errors: ["Direct BetMGM pilot is currently enabled for NFL only."],
      spreadGames: 0,
      totalGames: 0,
      week: null as number | null,
    };
  }

  const rawHtml = await fetchBetMgmPublicHtml();
  const parsed = parseBetMgmPublicTables(rawHtml);
  const week = parsedWeek(rawHtml);
  const schedule = await loadTrackedScheduleGames(sport);
  const splits: ExternalFootballMarketSplit[] = [];
  const errors: string[] = [];
  if (!schedule.length) errors.push("No stored DraftKings NFL game-time map is available yet; BetMGM rows will retry on the next five-minute cycle.");

  let spreadGames = 0;
  for (const row of parsed.spreads) {
    const game = matchScheduleGame(row.teamOneLabel, row.teamTwoLabel, schedule);
    if (!game) {
      errors.push(`Could not match BetMGM spread matchup: ${row.teamOneLabel} vs ${row.teamTwoLabel}`);
      continue;
    }
    const normalized = spreadSplits(row, game);
    if (normalized.length) {
      spreadGames += 1;
      splits.push(...normalized);
    }
  }

  let totalGames = 0;
  for (const row of parsed.totals) {
    const game = matchScheduleGame(row.teamOneLabel, row.teamTwoLabel, schedule);
    if (!game) {
      errors.push(`Could not match BetMGM total matchup: ${row.teamOneLabel} vs ${row.teamTwoLabel}`);
      continue;
    }
    const normalized = totalSplits(row, game);
    if (normalized.length) {
      totalGames += 1;
      splits.push(...normalized);
    }
  }

  if (!parsed.spreads.length) {
    errors.push("BetMGM public NFL page did not expose a full Spread / Bets / Money table.");
  }
  if (!parsed.totals.length) {
    errors.push(
      "BetMGM currently does not expose a full Total / Bets / Money table; totals are skipped rather than fabricating handle percentages.",
    );
  }

  return { splits, errors, spreadGames, totalGames, week };
}

export function betMgmTrackingConfigured() {
  return true;
}

export async function discoverBetMgmFootballEvents(sport: FootballSport) {
  const direct = await loadDirectBetMgmSplits(sport);
  const games = new Set(direct.splits.map((split) => `${split.date}|${split.game}`));
  return {
    ok: true,
    sport,
    source: "BetMGM",
    mode: "DIRECT_PUBLIC_SCRAPE",
    configured: true,
    credentialRequired: false,
    week: direct.week,
    eventsFound: games.size,
    spreadGamesFound: direct.spreadGames,
    totalGamesFound: direct.totalGames,
    marketSidesFound: direct.splits.length,
    errors: direct.errors,
    sourceUrl: BETMGM_NFL_PUBLIC_URL,
  };
}

export async function syncBetMgmFootballMarket(sport: FootballSport) {
  const direct = await loadDirectBetMgmSplits(sport);
  const sync = await syncExternalFootballMarkets(
    sport,
    BETMGM_MARKET_CONFIG,
    direct.splits,
    direct.errors,
  );
  return {
    ...sync,
    configured: true,
    credentialRequired: false,
    mode: "DIRECT_PUBLIC_SCRAPE",
    week: direct.week,
    spreadGamesFound: direct.spreadGames,
    totalGamesFound: direct.totalGames,
    exactPriceAvailable: false,
    roiPricingAssumption: "-110 because BetMGM's public split table does not publish side prices",
    sourceUrl: BETMGM_NFL_PUBLIC_URL,
  };
}

export async function readBetMgmFootballMarket(sport: FootballSport) {
  const market = await readExternalFootballMarket(sport, BETMGM_MARKET_CONFIG);
  return {
    ...market,
    configured: true,
    credentialRequired: false,
    configurationNeeded: null,
    mode: "DIRECT_PUBLIC_SCRAPE",
    sourceUrl: BETMGM_NFL_PUBLIC_URL,
    exactPriceAvailable: false,
    roiPricingAssumption: "-110 because BetMGM's public split table does not publish side prices",
  };
}
