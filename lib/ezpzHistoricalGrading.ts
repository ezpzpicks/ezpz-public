import { readTursoDataset, replaceTursoDataset, type TursoRow } from "./tursoStore";

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
};

export type HistoricalEzpzGradeRepair = {
  scanned: number;
  selected: number;
  fullGameSelected: number;
  graded: number;
  corrected: number;
  stillPending: number;
  changedCandidateIds: string[];
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
  const raw = text(value);
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

  // Only use game number or scheduled time when a same-date matchup is genuinely
  // ambiguous (normally a doubleheader). Time is never allowed to reject the one
  // obvious team/date match.
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
    if (game.totalRuns === line) return "P";
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

  return "";
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

export async function repairHistoricalEzpzGrades(): Promise<HistoricalEzpzGradeRepair> {
  const [selectorRows, trendRows] = await Promise.all([
    readTursoDataset("MLB", "ai_pick_selector"),
    readTursoDataset("MLB", "all_game_trends"),
  ]);

  const finalGames = uniqueFinalGames(trendRows);
  let selected = 0;
  let fullGameSelected = 0;
  let graded = 0;
  let corrected = 0;
  let stillPending = 0;
  const changedCandidateIds: string[] = [];
  const updatedAt = new Date().toISOString();
  let changed = false;

  const repaired = selectorRows.map((source) => {
    const row: Row = { ...source };
    const pick = pickData(row);
    if (!pick.selected) return row;
    selected += 1;

    const market = key(pick.market);
    if (market !== "moneyline" && market !== "total") return row;
    fullGameSelected += 1;

    const game = matchFinalGame(pick, finalGames);
    const result = game ? gradeFromFinalGame(pick, game) : "";
    if (!result) {
      if (!gradeCode(row.Result)) stillPending += 1;
      return row;
    }

    graded += 1;
    const prior = gradeCode(row.Result);
    const units = unitsFor(result, pick.odds);
    const priorUnits = Number(text(row.Units));
    const needsUpdate =
      prior !== result ||
      !Number.isFinite(priorUnits) ||
      Math.abs(priorUnits - units) > 0.005;
    if (!needsUpdate) return row;

    if (prior && prior !== result) corrected += 1;
    row.Result = result;
    row.Units = String(units);
    row["Result Updated"] = updatedAt;
    updateDetailsJson(row, result, units, updatedAt);
    changedCandidateIds.push(pick.candidateId || `${pick.date}|${pick.game}|${pick.market}|${pick.selection}`);
    changed = true;
    return row;
  });

  if (changed) {
    await replaceTursoDataset("MLB", "ai_pick_selector", repaired);
  }

  return {
    scanned: selectorRows.length,
    selected,
    fullGameSelected,
    graded,
    corrected,
    stillPending,
    changedCandidateIds,
  };
}
