import { readTursoDataset, replaceTursoDataset, type TursoRow } from "./tursoStore";
import { V2_DAILY_PICK_HEADERS } from "./mlbTrendV2Store";

type Row = TursoRow;
type GradeCode = "W" | "L" | "P" | "";

type FinalGame = {
  date: string;
  gameKey: string;
  game: string;
  awayTeam: string;
  homeTeam: string;
  awayRuns: number;
  homeRuns: number;
  totalRuns: number;
  gameTime: string;
  firstInningRuns: number | null;
  official: boolean;
};

type PitcherResult = {
  names: string[];
  strikeouts: number;
};

export type HistoricalEzpzGradeRepair = {
  scanned: number;
  selected: number;
  fullGameSelected: number;
  graded: number;
  corrected: number;
  stillPending: number;
  changedCandidateIds: string[];
  v2Scanned: number;
  v2Graded: number;
  v2StillPending: number;
  v2ChangedCandidateIds: string[];
  officialDatesFetched: number;
  officialGamesFound: number;
  pitcherBoxscoresFetched: number;
  firstInningLinescoresFetched: number;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function key(value: unknown) {
  return text(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isoDate(value: unknown) {
  const raw = text(value);
  if (!raw) return "";
  const iso = raw.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const us = raw.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function truthy(value: unknown) {
  return ["1", "true", "yes", "y"].includes(key(value));
}

function gradeCode(value: unknown): GradeCode {
  const normalized = key(value).toUpperCase();
  if (normalized === "W" || normalized === "WIN" || normalized === "WON") return "W";
  if (normalized === "L" || normalized === "LOSS" || normalized === "LOST") return "L";
  if (normalized === "P" || normalized === "PUSH" || normalized === "TIE") return "P";
  return "";
}

function number(value: unknown): number | null {
  const raw = text(value).replace(/,/g, "");
  if (!raw) return null;
  const match = raw.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function americanOdds(value: unknown) {
  const raw = text(value).replace(/[−–—]/g, "-");
  const signed = raw.match(/[+-]\d{3,}/)?.[0];
  const parsed = Number(signed || raw.match(/-?\d{3,}/)?.[0] || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function unitsFor(result: GradeCode, oddsRaw: unknown) {
  if (result === "P") return 0;
  if (result === "L") return -1;
  const odds = americanOdds(oddsRaw);
  if (odds > 0) return Math.round((odds / 100) * 100) / 100;
  if (odds < 0) return Math.round((100 / Math.abs(odds)) * 100) / 100;
  return 1;
}

function teamIdentity(value: unknown) {
  const normalized = key(value);
  if (!normalized) return "";
  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length > 1 && tokens[0].length <= 3) tokens.shift();
  const joined = tokens.join(" ");
  for (const multi of ["red sox", "white sox", "blue jays"]) {
    if (joined.endsWith(multi)) return multi;
  }
  return tokens[tokens.length - 1] || joined;
}

function sameTeam(left: unknown, right: unknown) {
  const leftKey = key(left);
  const rightKey = key(right);
  if (!leftKey || !rightKey) return false;
  return leftKey === rightKey || teamIdentity(leftKey) === teamIdentity(rightKey);
}

function gameNumber(value: unknown) {
  return text(value).match(/\b(?:game|gm|dh)\s*#?\s*([12])\b/i)?.[1] || "";
}

function parseClockMinutes(value: unknown): number | null {
  const raw = text(value);
  if (!raw) return null;
  const match = raw.match(/\b(\d{1,2}):(\d{2})\s*(AM|PM)?\b/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const suffix = String(match[3] || "").toUpperCase();
  if (suffix === "AM" && hour === 12) hour = 0;
  if (suffix === "PM" && hour !== 12) hour += 12;
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function pickData(row: Row) {
  let details: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(text(row["Details JSON"]) || "{}");
    if (parsed && typeof parsed === "object") details = parsed as Record<string, unknown>;
  } catch {
    details = {};
  }
  const get = (...names: string[]) => {
    for (const name of names) {
      const direct = row[name];
      if (text(direct)) return direct;
      const detail = details[name];
      if (text(detail)) return detail;
    }
    return "";
  };
  return {
    details,
    candidateId: text(get("Candidate ID", "candidateId")),
    date: isoDate(get("Date", "date")),
    gameKey: text(get("Game Key", "gameKey")).replace(/\.0$/, ""),
    game: text(get("Game", "game")),
    gameTime: text(get("Game Time", "gameTime")),
    awayTeam: text(get("Away Team", "awayTeam")),
    homeTeam: text(get("Home Team", "homeTeam")),
    market: text(get("Market", "market")),
    selection: text(get("Selection", "selection")),
    line: text(get("Line", "line")),
    odds: text(get("Odds", "odds")),
    play: text(get("Play", "play")),
    selected: truthy(get("Selected", "selected")),
  };
}

function finalGameFromRow(row: Row): FinalGame | null {
  if (!gradeCode(row.Result)) return null;
  const awayRuns = number(row["Actual Away Runs"]);
  const homeRuns = number(row["Actual Home Runs"]);
  if (awayRuns == null || homeRuns == null) return null;
  const totalRuns = number(row["Actual Total"]);
  return {
    date: isoDate(row.Date || row["Bet Date"]),
    gameKey: text(row["Game Key"] || row["Game ID"]).replace(/\.0$/, ""),
    game: text(row.Game || row.Matchup || row["Game Label"]),
    awayTeam: text(row["Away Team"] || row.Away || row["Visitor Team"]),
    homeTeam: text(row["Home Team"] || row.Home),
    awayRuns,
    homeRuns,
    totalRuns: totalRuns == null ? awayRuns + homeRuns : totalRuns,
    gameTime: text(row["Game Time"] || row["Game Time ET"] || row.Time),
    firstInningRuns: null,
    official: false,
  };
}

function uniqueFinalGames(rows: Row[]) {
  const map = new Map<string, FinalGame>();
  for (const row of rows) {
    const game = finalGameFromRow(row);
    if (!game || !game.date) continue;
    const identity = [
      game.date,
      game.gameKey,
      teamIdentity(game.awayTeam),
      teamIdentity(game.homeTeam),
      game.awayRuns,
      game.homeRuns,
    ].join("|");
    if (!map.has(identity)) map.set(identity, game);
  }
  return [...map.values()];
}

function matchFinalGame(pick: ReturnType<typeof pickData>, games: FinalGame[]) {
  let candidates = games.filter((game) => game.date === pick.date);
  if (!candidates.length) return null;

  if (pick.gameKey) {
    const keyed = candidates.filter((game) => {
      if (!game.gameKey) return false;
      const pickTail = pick.gameKey.split("|").pop() || pick.gameKey;
      const gameTail = game.gameKey.split("|").pop() || game.gameKey;
      return pick.gameKey === game.gameKey || pickTail === gameTail;
    });
    if (keyed.length === 1) return keyed[0];
    if (keyed.length > 1) candidates = keyed;
  }

  const teamMatched = candidates.filter(
    (game) => sameTeam(game.awayTeam, pick.awayTeam) && sameTeam(game.homeTeam, pick.homeTeam),
  );
  if (teamMatched.length === 1) return teamMatched[0];
  if (teamMatched.length) candidates = teamMatched;

  if (!teamMatched.length && pick.game) {
    const gameText = key(pick.game);
    const textMatched = candidates.filter((game) => {
      const rowText = key(game.game);
      return rowText && gameText && (rowText === gameText || rowText.includes(gameText) || gameText.includes(rowText));
    });
    if (textMatched.length === 1) return textMatched[0];
    if (textMatched.length) candidates = textMatched;
  }

  if (candidates.length <= 1) return candidates[0] || null;

  const pickNumber = gameNumber(pick.game);
  if (pickNumber) {
    const numbered = candidates.filter((game) => gameNumber(game.game) === pickNumber);
    if (numbered.length === 1) return numbered[0];
    if (numbered.length) candidates = numbered;
  }

  const pickMinutes = parseClockMinutes(pick.gameTime);
  if (pickMinutes != null) {
    const timed = candidates
      .map((game) => ({ game, minutes: parseClockMinutes(game.gameTime) }))
      .filter((item) => item.minutes != null)
      .sort((a, b) => Math.abs((a.minutes as number) - pickMinutes) - Math.abs((b.minutes as number) - pickMinutes));
    if (timed.length && Math.abs((timed[0].minutes as number) - pickMinutes) <= 120) {
      return timed[0].game;
    }
  }

  return null;
}

function totalLine(pick: ReturnType<typeof pickData>) {
  const direct = number(pick.line);
  if (direct != null) return direct;
  const match = `${pick.selection} ${pick.play}`.match(/\b(?:over|under)\s*([0-9]+(?:\.[0-9]+)?)/i);
  return match ? Number(match[1]) : null;
}

function totalSide(pick: ReturnType<typeof pickData>) {
  const source = `${pick.selection} ${pick.play}`.toUpperCase();
  if (source.includes("UNDER")) return "UNDER";
  if (source.includes("OVER")) return "OVER";
  return "";
}

function gradeFromFinalGame(pick: ReturnType<typeof pickData>, game: FinalGame): GradeCode {
  const market = key(pick.market);
  if (market === "total") {
    const line = totalLine(pick);
    const side = totalSide(pick);
    if (line == null || !side) return "";
    if (Math.abs(game.totalRuns - line) < 0.001) return "P";
    if (side === "OVER") return game.totalRuns > line ? "W" : "L";
    return game.totalRuns < line ? "W" : "L";
  }

  if (market === "moneyline") {
    if (game.awayRuns === game.homeRuns) return "";
    const winner = game.awayRuns > game.homeRuns ? game.awayTeam : game.homeTeam;
    const selectedTeam = pick.selection || pick.play;
    if (!selectedTeam) return "";
    return sameTeam(selectedTeam, winner) ? "W" : "L";
  }

  if (market === "run line") {
    const line = number(pick.line);
    const selectedTeam = pick.selection || pick.play;
    if (line == null || !selectedTeam) return "";
    const selectedIsAway = sameTeam(selectedTeam, game.awayTeam);
    const selectedIsHome = sameTeam(selectedTeam, game.homeTeam);
    if (!selectedIsAway && !selectedIsHome) return "";
    const selectedRuns = selectedIsAway ? game.awayRuns : game.homeRuns;
    const opponentRuns = selectedIsAway ? game.homeRuns : game.awayRuns;
    const adjusted = selectedRuns + line;
    if (Math.abs(adjusted - opponentRuns) < 0.001) return "P";
    return adjusted > opponentRuns ? "W" : "L";
  }

  if (market === "first inning") {
    if (game.firstInningRuns == null) return "";
    const source = `${pick.selection} ${pick.play}`.toUpperCase();
    if (source.includes("YRFI")) return game.firstInningRuns > 0 ? "W" : "L";
    if (source.includes("NRFI")) return game.firstInningRuns === 0 ? "W" : "L";
  }

  return "";
}

function recognizedMarket(pick: ReturnType<typeof pickData>) {
  const market = key(pick.market);
  return (
    market === "moneyline" ||
    market === "run line" ||
    market === "total" ||
    market === "first inning" ||
    market === "pitcher strikeouts"
  );
}

async function officialFinalGamesForDate(date: string): Promise<FinalGame[]> {
  const url = new URL("https://statsapi.mlb.com/api/v1/schedule");
  url.searchParams.set("sportId", "1");
  url.searchParams.set("date", date);
  url.searchParams.set("hydrate", "linescore");

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as any;
    const output: FinalGame[] = [];

    for (const day of payload?.dates || []) {
      for (const game of day?.games || []) {
        const detailedState = String(game?.status?.detailedState || "").toLowerCase();
        const abstractState = String(game?.status?.abstractGameState || "").toLowerCase();
        const codedState = String(game?.status?.codedGameState || "").toUpperCase();
        const statusCode = String(game?.status?.statusCode || "").toUpperCase();
        const finalLike =
          abstractState === "final" ||
          codedState === "F" ||
          statusCode === "F" ||
          detailedState.includes("final") ||
          detailedState.includes("completed") ||
          detailedState.includes("game over");
        if (!finalLike) continue;

        const gameKey = text(game?.gamePk).replace(/\.0$/, "");
        const awayRuns = Number(game?.teams?.away?.score);
        const homeRuns = Number(game?.teams?.home?.score);
        if (!gameKey || !Number.isFinite(awayRuns) || !Number.isFinite(homeRuns)) continue;

        const innings = Array.isArray(game?.linescore?.innings) ? game.linescore.innings : [];
        const first = innings.find((inning: any) => Number(inning?.num) === 1) || innings[0];
        const firstAway = Number(first?.away?.runs);
        const firstHome = Number(first?.home?.runs);
        const firstInningRuns =
          Number.isFinite(firstAway) && Number.isFinite(firstHome)
            ? firstAway + firstHome
            : null;

        const awayTeam = text(game?.teams?.away?.team?.name);
        const homeTeam = text(game?.teams?.home?.team?.name);
        output.push({
          date,
          gameKey,
          game: `${awayTeam} at ${homeTeam}`,
          awayTeam,
          homeTeam,
          awayRuns,
          homeRuns,
          totalRuns: awayRuns + homeRuns,
          gameTime: text(game?.gameDate),
          firstInningRuns,
          official: true,
        });
      }
    }
    return output;
  } catch (error) {
    console.warn("Official MLB historical final lookup failed", { date, error });
    return [];
  }
}

async function officialFinalGamesForDates(dates: string[]) {
  const uniqueDates = [...new Set(dates.filter(Boolean))];
  const byDate = await Promise.all(
    uniqueDates.map(async (date) => [date, await officialFinalGamesForDate(date)] as const),
  );
  return {
    datesFetched: uniqueDates.length,
    games: byDate.flatMap(([, games]) => games),
  };
}

function pitcherNameFromPick(pick: ReturnType<typeof pickData>) {
  const selection = text(pick.selection);
  if (selection.includes("|")) return text(selection.split("|")[0]);
  return text(pick.play)
    .replace(/\b(?:over|under)\b.*$/i, "")
    .replace(/\bstrikeouts?\b/gi, "")
    .trim();
}

function samePersonName(left: unknown, right: unknown) {
  const ignored = new Set(["jr", "sr", "ii", "iii", "iv"]);
  const leftTokens = key(left).split(" ").filter((token) => token && !ignored.has(token));
  const rightTokens = key(right).split(" ").filter((token) => token && !ignored.has(token));
  if (!leftTokens.length || !rightTokens.length) return false;
  const rightSet = new Set(rightTokens);
  const overlap = leftTokens.filter((token) => rightSet.has(token)).length;
  if (leftTokens.length === 1 || rightTokens.length === 1) return overlap === 1;
  return overlap >= 2;
}

async function firstInningRunsForGame(gameKey: string): Promise<number | null> {
  if (!/^\d+$/.test(gameKey)) return null;
  const url = new URL(`https://statsapi.mlb.com/api/v1/game/${gameKey}/linescore`);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as any;
    const innings = Array.isArray(payload?.innings) ? payload.innings : [];
    const first = innings.find((inning: any) => Number(inning?.num) === 1) || innings[0];
    const away = Number(first?.away?.runs);
    const home = Number(first?.home?.runs);
    return Number.isFinite(away) && Number.isFinite(home) ? away + home : null;
  } catch (error) {
    console.warn("Official MLB first-inning linescore lookup failed", { gameKey, error });
    return null;
  }
}

async function pitcherResultsForGame(gameKey: string): Promise<PitcherResult[]> {
  if (!/^\d+$/.test(gameKey)) return [];
  const url = new URL(`https://statsapi.mlb.com/api/v1/game/${gameKey}/boxscore`);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as any;
    const output: PitcherResult[] = [];

    for (const side of ["away", "home"] as const) {
      const players = payload?.teams?.[side]?.players || {};
      for (const player of Object.values(players) as any[]) {
        const strikeouts = Number(player?.stats?.pitching?.strikeOuts);
        if (!Number.isFinite(strikeouts)) continue;
        const names = [
          player?.person?.fullName,
          player?.person?.boxscoreName,
          player?.person?.lastFirstName,
        ]
          .map((value) => text(value))
          .filter(Boolean);
        if (names.length) output.push({ names: [...new Set(names)], strikeouts });
      }
    }
    return output;
  } catch (error) {
    console.warn("Official MLB historical pitcher boxscore lookup failed", { gameKey, error });
    return [];
  }
}

async function gradePitcherPick(
  pick: ReturnType<typeof pickData>,
  game: FinalGame,
  pitcherCache: Map<string, Promise<PitcherResult[]>>,
) {
  if (!game.official || !game.gameKey) return "" as GradeCode;
  let request = pitcherCache.get(game.gameKey);
  if (!request) {
    request = pitcherResultsForGame(game.gameKey);
    pitcherCache.set(game.gameKey, request);
  }
  const pitchers = await request;
  const targetName = pitcherNameFromPick(pick);
  const pitcher = pitchers.find((item) =>
    item.names.some((name) => samePersonName(targetName, name)),
  );
  if (!pitcher) return "" as GradeCode;

  const line = totalLine(pick);
  const side = totalSide(pick);
  if (line == null || !side) return "" as GradeCode;
  if (Math.abs(pitcher.strikeouts - line) < 0.001) return "P" as GradeCode;
  if (side === "OVER") return (pitcher.strikeouts > line ? "W" : "L") as GradeCode;
  return (pitcher.strikeouts < line ? "W" : "L") as GradeCode;
}

async function gradePick(
  pick: ReturnType<typeof pickData>,
  game: FinalGame,
  pitcherCache: Map<string, Promise<PitcherResult[]>>,
  firstInningCache: Map<string, Promise<number | null>>,
) {
  const market = key(pick.market);
  if (market === "pitcher strikeouts") {
    return gradePitcherPick(pick, game, pitcherCache);
  }
  if (market === "first inning" && game.firstInningRuns == null && game.official) {
    let request = firstInningCache.get(game.gameKey);
    if (!request) {
      request = firstInningRunsForGame(game.gameKey);
      firstInningCache.set(game.gameKey, request);
    }
    const firstInningRuns = await request;
    if (firstInningRuns != null) {
      return gradeFromFinalGame(pick, { ...game, firstInningRuns });
    }
  }
  return gradeFromFinalGame(pick, game);
}

function updateDetailsJson(row: Row, result: GradeCode, units: number, updatedAt: string) {
  const raw = text(row["Details JSON"]);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return;
    parsed.result = result;
    parsed.units = units;
    parsed.resultUpdated = updatedAt;
    row["Details JSON"] = JSON.stringify(parsed);
  } catch {
    // Keep the row columns authoritative when legacy Details JSON is malformed.
  }
}

function rowNeedsGrade(row: Row) {
  return !gradeCode(row.Result);
}

export async function repairHistoricalEzpzGrades(): Promise<HistoricalEzpzGradeRepair> {
  const [selectorRows, trendRows, v2Rows] = await Promise.all([
    readTursoDataset("MLB", "ai_pick_selector"),
    readTursoDataset("MLB", "all_game_trends"),
    readTursoDataset("MLB", "trend_v2_daily_picks", V2_DAILY_PICK_HEADERS),
  ]);

  const pendingDates = new Set<string>();
  for (const row of selectorRows) {
    const pick = pickData(row);
    if (pick.selected && recognizedMarket(pick) && rowNeedsGrade(row) && pick.date) {
      pendingDates.add(pick.date);
    }
  }
  for (const row of v2Rows) {
    const pick = pickData(row);
    if (recognizedMarket(pick) && rowNeedsGrade(row) && pick.date) {
      pendingDates.add(pick.date);
    }
  }

  const official = await officialFinalGamesForDates([...pendingDates]);
  const trendFinalGames = uniqueFinalGames(trendRows);
  const pitcherCache = new Map<string, Promise<PitcherResult[]>>();
  const firstInningCache = new Map<string, Promise<number | null>>();
  const updatedAt = new Date().toISOString();

  let selected = 0;
  let fullGameSelected = 0;
  let graded = 0;
  let corrected = 0;
  let stillPending = 0;
  let selectorChanged = false;
  const changedCandidateIds: string[] = [];
  const repairedSelector: Row[] = [];

  for (const source of selectorRows) {
    const row: Row = { ...source };
    const pick = pickData(row);
    if (!pick.selected) {
      repairedSelector.push(row);
      continue;
    }
    selected += 1;

    const market = key(pick.market);
    if (market === "moneyline" || market === "total") fullGameSelected += 1;
    if (!recognizedMarket(pick)) {
      repairedSelector.push(row);
      continue;
    }

    const prior = gradeCode(row.Result);
    let result: GradeCode = "";
    let game: FinalGame | null = null;

    if (!prior) {
      game = matchFinalGame(pick, official.games) || matchFinalGame(pick, trendFinalGames);
      if (game) result = await gradePick(pick, game, pitcherCache, firstInningCache);
    } else if (market === "moneyline" || market === "total") {
      // Preserve the previous historical-correction behavior for already graded
      // full-game picks without adding any extra MLB API requests.
      game = matchFinalGame(pick, trendFinalGames);
      if (game) result = gradeFromFinalGame(pick, game);
    }

    if (!result) {
      if (!prior) stillPending += 1;
      repairedSelector.push(row);
      continue;
    }

    graded += 1;
    const units = unitsFor(result, pick.odds);
    const priorUnits = Number(text(row.Units));
    const needsUpdate =
      prior !== result ||
      !Number.isFinite(priorUnits) ||
      Math.abs(priorUnits - units) > 0.005;
    if (!needsUpdate) {
      repairedSelector.push(row);
      continue;
    }

    if (prior && prior !== result) corrected += 1;
    row.Result = result;
    row.Units = String(units);
    row["Result Updated"] = updatedAt;
    updateDetailsJson(row, result, units, updatedAt);
    changedCandidateIds.push(
      pick.candidateId || `${pick.date}|${pick.game}|${pick.market}|${pick.selection}`,
    );
    selectorChanged = true;
    repairedSelector.push(row);
  }

  let v2Graded = 0;
  let v2StillPending = 0;
  let v2Changed = false;
  const v2ChangedCandidateIds: string[] = [];
  const repairedV2: Row[] = [];

  for (const source of v2Rows) {
    const row: Row = { ...source };
    const pick = pickData(row);
    const prior = gradeCode(row.Result);
    if (prior || !recognizedMarket(pick)) {
      repairedV2.push(row);
      continue;
    }

    const game = matchFinalGame(pick, official.games) || matchFinalGame(pick, trendFinalGames);
    const result = game ? await gradePick(pick, game, pitcherCache, firstInningCache) : "";
    if (!result) {
      v2StillPending += 1;
      repairedV2.push(row);
      continue;
    }

    v2Graded += 1;
    const units = unitsFor(result, pick.odds);
    row.Result = result;
    row.Units = String(units);
    row["Result Updated"] = updatedAt;
    updateDetailsJson(row, result, units, updatedAt);
    v2ChangedCandidateIds.push(
      pick.candidateId || `${pick.date}|${pick.game}|${pick.market}|${pick.selection}`,
    );
    v2Changed = true;
    repairedV2.push(row);
  }

  if (selectorChanged) {
    await replaceTursoDataset("MLB", "ai_pick_selector", repairedSelector);
  }
  if (v2Changed) {
    await replaceTursoDataset(
      "MLB",
      "trend_v2_daily_picks",
      repairedV2,
      V2_DAILY_PICK_HEADERS,
    );
  }

  return {
    scanned: selectorRows.length,
    selected,
    fullGameSelected,
    graded,
    corrected,
    stillPending,
    changedCandidateIds,
    v2Scanned: v2Rows.length,
    v2Graded,
    v2StillPending,
    v2ChangedCandidateIds,
    officialDatesFetched: official.datesFetched,
    officialGamesFound: official.games.length,
    pitcherBoxscoresFetched: pitcherCache.size,
    firstInningLinescoresFetched: firstInningCache.size,
  };
}
