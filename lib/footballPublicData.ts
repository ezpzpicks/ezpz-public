import {
  buildFootballPublicData as buildLegacyFootballPublicData,
} from "./footballPublicDataLegacy";
import {
  readSportWorksheet,
  type FootballSport,
  type SheetRow,
} from "./sportSheets";

export {
  PUBLIC_SPLIT_HEADERS,
  ALL_GAME_TRENDS_HEADERS,
  __test__,
} from "./footballPublicDataLegacy";
export type { FootballMarket } from "./footballPublicDataLegacy";

type EzpzForm = "HOT" | "COLD" | "NEUTRAL" | "SAMPLE";

type FormResult = {
  status: EzpzForm;
  record: string;
  totalBets: number;
  wins: number;
  losses: number;
  pushes: number;
};

type NflEzpzPick = {
  source: "Best Play" | "Trend Play" | "Best + Trend";
  game: string;
  market: "Spread" | "Total" | "Player Prop";
  selection: string;
  odds: string;
  score: number;
  tier: string;
  qualification: string;
  record?: string;
  formStatus?: EzpzForm;
  formType?: string;
  headshotUrl?: string;
  playerName?: string;
  playerTeam?: string;
  propMarket?: string;
  propSide?: string;
  propLine?: string | number;
  gapPct?: number;
  modelGapPct?: number;
  predictedWinPct?: number;
  impliedProbabilityPct?: number;
  trendModelVersion?: string;
  snapshotStatus?: string;
};

function textKey(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/−/g, "-")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isoDate(value: unknown) {
  const raw = String(value || "").trim();
  const match = raw.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  const us = raw.match(/(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?/);
  if (!us) return "";
  const year = us[3] || String(new Date().getFullYear());
  return `${year}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
}

function resultCode(value: unknown) {
  const key = String(value || "").trim().toUpperCase();
  if (["W", "WIN", "WON"].includes(key)) return "W" as const;
  if (["L", "LOSS", "LOST"].includes(key)) return "L" as const;
  if (["P", "PUSH"].includes(key)) return "P" as const;
  return "";
}

function parseAmericanOdds(value: unknown) {
  const raw = String(value || "").replace(/−/g, "-");
  const signed = raw.match(/[+-]\d{3,4}/)?.[0];
  if (signed) {
    const parsed = Number(signed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const plain = raw.match(/(?:^|\s)(\d{3})(?:\s|$)/)?.[1];
  if (!plain) return null;
  const parsed = Number(plain);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatAmericanOdds(value: unknown) {
  const odds = parseAmericanOdds(value);
  if (odds == null) return "";
  return odds > 0 ? `+${odds}` : String(odds);
}

function formFromRows(rows: SheetRow[]): FormResult {
  const settled = rows
    .map((row, index) => ({
      row,
      index,
      stamp: Date.parse(`${isoDate(row.Date || row["Game Date"] || "")}T12:00:00Z`) || 0,
    }))
    .filter(({ row }) => Boolean(resultCode(row.Result || row.Status)))
    .sort((a, b) => b.stamp - a.stamp || b.index - a.index)
    .slice(0, 7)
    .map(({ row }) => row);

  let wins = 0;
  let losses = 0;
  let pushes = 0;
  for (const row of settled) {
    const result = resultCode(row.Result || row.Status);
    if (result === "W") wins += 1;
    else if (result === "L") losses += 1;
    else if (result === "P") pushes += 1;
  }
  const totalBets = wins + losses + pushes;
  const status: EzpzForm = totalBets < 7
    ? "SAMPLE"
    : wins >= 5
      ? "HOT"
      : losses >= 5
        ? "COLD"
        : "NEUTRAL";
  return { status, record: `${wins}-${losses}-${pushes}`, totalBets, wins, losses, pushes };
}

const NFL_TEAM_SLUGS: Record<string, string> = {};
const NFL_TEAM_ALIASES: Record<string, string[]> = {
  ari: ["ARI", "Arizona Cardinals", "Cardinals", "Arizona"],
  atl: ["ATL", "Atlanta Falcons", "Falcons", "Atlanta"],
  bal: ["BAL", "Baltimore Ravens", "Ravens", "Baltimore"],
  buf: ["BUF", "Buffalo Bills", "Bills", "Buffalo"],
  car: ["CAR", "Carolina Panthers", "Panthers", "Carolina"],
  chi: ["CHI", "Chicago Bears", "Bears", "Chicago"],
  cin: ["CIN", "Cincinnati Bengals", "Bengals", "Cincinnati"],
  cle: ["CLE", "Cleveland Browns", "Browns", "Cleveland"],
  dal: ["DAL", "Dallas Cowboys", "Cowboys", "Dallas"],
  den: ["DEN", "Denver Broncos", "Broncos", "Denver"],
  det: ["DET", "Detroit Lions", "Lions", "Detroit"],
  gb: ["GB", "Green Bay Packers", "Packers", "Green Bay"],
  hou: ["HOU", "Houston Texans", "Texans", "Houston"],
  ind: ["IND", "Indianapolis Colts", "Colts", "Indianapolis"],
  jax: ["JAX", "Jacksonville Jaguars", "Jaguars", "Jacksonville"],
  kc: ["KC", "Kansas City Chiefs", "Chiefs", "Kansas City"],
  lv: ["LV", "Las Vegas Raiders", "Raiders", "Las Vegas"],
  lac: ["LAC", "Los Angeles Chargers", "LA Chargers", "Chargers"],
  lar: ["LAR", "Los Angeles Rams", "LA Rams", "Rams"],
  mia: ["MIA", "Miami Dolphins", "Dolphins", "Miami"],
  min: ["MIN", "Minnesota Vikings", "Vikings", "Minnesota"],
  ne: ["NE", "New England Patriots", "Patriots", "New England"],
  no: ["NO", "New Orleans Saints", "Saints", "New Orleans"],
  nyg: ["NYG", "New York Giants", "NY Giants", "Giants"],
  nyj: ["NYJ", "New York Jets", "NY Jets", "Jets"],
  phi: ["PHI", "Philadelphia Eagles", "Eagles", "Philadelphia"],
  pit: ["PIT", "Pittsburgh Steelers", "Steelers", "Pittsburgh"],
  sea: ["SEA", "Seattle Seahawks", "Seahawks", "Seattle"],
  sf: ["SF", "San Francisco 49ers", "49ers", "San Francisco"],
  tb: ["TB", "Tampa Bay Buccaneers", "Buccaneers", "Tampa Bay"],
  ten: ["TEN", "Tennessee Titans", "Titans", "Tennessee"],
  wsh: ["WAS", "WSH", "Washington Commanders", "Commanders", "Washington"],
};
for (const [slug, aliases] of Object.entries(NFL_TEAM_ALIASES)) {
  NFL_TEAM_SLUGS[textKey(slug)] = slug;
  for (const alias of aliases) NFL_TEAM_SLUGS[textKey(alias)] = slug;
}

function teamSlug(value: unknown) {
  return NFL_TEAM_SLUGS[textKey(value)] || textKey(value).replace(/\s+/g, "");
}

function sameTeam(a: unknown, b: unknown) {
  const left = teamSlug(a);
  const right = teamSlug(b);
  return Boolean(left && right && left === right);
}

function rowGameTeams(row: SheetRow) {
  const game = String(row.Game || "").trim();
  const parts = game.split(/\s+(?:@|at)\s+/i).map((part) => part.trim()).filter(Boolean);
  if (parts.length === 2) return { away: parts[0], home: parts[1] };
  const team = String(row.Team || "").trim();
  const opponent = String(row.Opponent || "").trim();
  return textKey(row["Home/Away"]) === "home"
    ? { away: opponent, home: team }
    : { away: team, home: opponent };
}

function matchingSlateGame(prop: SheetRow, slate: SheetRow[]) {
  const propId = String(prop["Game ID"] || prop["Game Key"] || "").trim();
  const teams = rowGameTeams(prop);
  return slate.find((row) => {
    const slateId = String(row["Game ID"] || row["Game Key"] || "").trim();
    if (propId && slateId && propId === slateId) return true;
    return sameTeam(teams.away, row["Away Team"]) && sameTeam(teams.home, row["Home Team"]);
  });
}

function qualifiedNflPropGrade(value: unknown) {
  const grade = textKey(value);
  return grade === "a prop" || grade === "b prop";
}

function propSide(row: SheetRow) {
  const direct = String(row.Pick || row.Side || "").trim();
  const key = textKey(direct);
  if (key.startsWith("under")) return "Under";
  if (key.startsWith("over")) return "Over";
  return direct;
}

function propRecordType(row: SheetRow) {
  const market = String(row.Market || "Player Prop").trim();
  const side = propSide(row);
  return `${market}${side ? ` ${side}` : ""}`.trim();
}

function propMarketLine(row: SheetRow) {
  const direct = row["Market Line"] ?? row.Line ?? row["Listed Line"] ?? row["Prop Line"];
  if (String(direct ?? "").trim()) return String(direct).trim();
  const pick = String(row.Pick || "").trim();
  const match = pick.match(/(?:over|under)\s+([+-]?\d+(?:\.\d+)?)/i);
  return match?.[1] || "";
}

function propTrackerMatchesType(row: SheetRow, recordType: string) {
  return textKey(propRecordType(row)) === textKey(recordType);
}

function gameBestRecordType(play: any) {
  return textKey(play.role || play.playType).includes("total") ? "Total" : "Spread";
}

function trackerMatchesGameBest(row: SheetRow, recordType: string) {
  const market = textKey(row["Bet Type"] || row.Market);
  return recordType === "Total" ? market.includes("total") : market.includes("spread");
}

function sameGame(play: any, split: any) {
  if (textKey(play.game) && textKey(play.game) === textKey(split.game)) return true;
  return sameTeam(play.awayTeam, split.awayTeam) && sameTeam(play.homeTeam, split.homeTeam);
}

function splitForBestPlay(play: any, splits: any[]) {
  const recordType = gameBestRecordType(play);
  const same = splits.filter((split) => sameGame(play, split));
  if (recordType === "Total") {
    const side = textKey(play.play).startsWith("under") ? "under" : "over";
    return same.find((split) => textKey(split.market) === "total" && textKey(split.side) === side);
  }
  const selection = String(play.play || "").replace(/\s+[+-]?\d+(?:\.\d+)?\s*$/, "").trim();
  return same.find((split) => textKey(split.market) === "spread" && sameTeam(split.selectionTeam || split.selection, selection));
}

const rosterCache = new Map<string, { savedAt: number; players: Map<string, string> }>();
const ROSTER_CACHE_MS = 6 * 60 * 60 * 1000;

function flattenRosterAthletes(payload: any) {
  const groups = Array.isArray(payload?.athletes) ? payload.athletes : [];
  const athletes: any[] = [];
  for (const group of groups) {
    if (Array.isArray(group?.items)) athletes.push(...group.items);
    else if (group?.athlete) athletes.push(group.athlete);
    else if (group) athletes.push(group);
  }
  return athletes;
}

async function rosterHeadshots(slug: string) {
  if (!slug) return new Map<string, string>();
  const cached = rosterCache.get(slug);
  if (cached && Date.now() - cached.savedAt < ROSTER_CACHE_MS) return cached.players;
  const players = new Map<string, string>();
  try {
    const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${slug}/roster`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(7000),
    });
    if (response.ok) {
      const payload = await response.json() as any;
      for (const athlete of flattenRosterAthletes(payload)) {
        const name = String(athlete?.fullName || athlete?.displayName || athlete?.shortName || "").trim();
        if (!name) continue;
        const id = String(athlete?.id || "").trim();
        const url = String(athlete?.headshot?.href || (id ? `https://a.espncdn.com/i/headshots/nfl/players/full/500/${id}.png` : "")).trim();
        if (url) players.set(textKey(name), url);
      }
    }
  } catch {
    // A missing headshot should never block the public NFL payload.
  }
  rosterCache.set(slug, { savedAt: Date.now(), players });
  return players;
}

async function playerHeadshotMap(rows: SheetRow[]) {
  const byTeam = new Map<string, SheetRow[]>();
  for (const row of rows) {
    const slug = teamSlug(row.Team || row["Player Team"] || "");
    if (!slug) continue;
    const current = byTeam.get(slug) || [];
    current.push(row);
    byTeam.set(slug, current);
  }
  const result = new Map<string, string>();
  await Promise.all([...byTeam.keys()].map(async (slug) => {
    const roster = await rosterHeadshots(slug);
    for (const row of byTeam.get(slug) || []) {
      const player = String(row.Player || "").trim();
      const url = roster.get(textKey(player));
      if (player && url) result.set(textKey(player), url);
    }
  }));
  return result;
}

function annotateGameBestPlays(best: any[], tracker: SheetRow[], splits: any[]) {
  return best.map((play) => {
    const formType = gameBestRecordType(play);
    const form = formFromRows(tracker.filter((row) => trackerMatchesGameBest(row, formType)));
    const split = splitForBestPlay(play, splits);
    return {
      ...play,
      formStatus: form.status,
      formRecord: form.record,
      formTotalBets: form.totalBets,
      formType,
      marketOdds: formatAmericanOdds(split?.odds || play.oddsLine),
    };
  });
}

async function buildNflPropBestPlays(
  propRows: SheetRow[],
  propTracker: SheetRow[],
  slate: SheetRow[],
  today: string,
) {
  const eligible = propRows
    .filter((row) => isoDate(row.Date || row["Game Date"] || "") === today)
    .filter((row) => qualifiedNflPropGrade(row.Grade))
    .map((row) => ({ row, game: matchingSlateGame(row, slate) }))
    .filter((entry) => Boolean(entry.game));
  const headshots = await playerHeadshotMap(eligible.map((entry) => entry.row));

  return eligible.map(({ row, game }) => {
    const playerName = String(row.Player || "").trim();
    const propMarket = String(row.Market || "Player Prop").trim();
    const side = propSide(row);
    const line = propMarketLine(row);
    const formType = propRecordType(row);
    const form = formFromRows(propTracker.filter((trackerRow) => propTrackerMatchesType(trackerRow, formType)));
    const awayTeam = String(game?.["Away Team"] || rowGameTeams(row).away || "").trim();
    const homeTeam = String(game?.["Home Team"] || rowGameTeams(row).home || "").trim();
    const playerTeam = String(row.Team || row["Player Team"] || "").trim();
    const odds = formatAmericanOdds(row["Pick Odds"] || row.Odds || "");
    const projection = String(row.Projection || row["Raw Projection"] || "").trim();
    return {
      playType: String(row.Grade || "").trim(),
      game: `${awayTeam} @ ${homeTeam}`,
      play: `${playerName} ${side}${line ? ` ${line}` : ""}`.replace(/\s+/g, " ").trim(),
      oddsLine: odds,
      marketOdds: odds,
      score: String(row["Model Probability"] || ""),
      isGreen: true,
      awayTeam,
      homeTeam,
      reliability: row.Reliability,
      selectedProbability: row["Model Probability"],
      modelVersion: row["Model Version"],
      role: `Player Prop • ${propMarket}`,
      playerName,
      playerTeam,
      propMarket,
      propSide: side,
      propLine: line,
      propProjection: projection,
      headshotUrl: headshots.get(textKey(playerName)) || "",
      formStatus: form.status,
      formRecord: form.record,
      formTotalBets: form.totalBets,
      formType,
    };
  }).sort((a, b) => {
    const hot = (value: EzpzForm) => value === "HOT" ? 4 : value === "NEUTRAL" ? 3 : value === "SAMPLE" ? 2 : 1;
    const formDiff = hot(b.formStatus) - hot(a.formStatus);
    if (formDiff) return formDiff;
    const grade = (value: unknown) => textKey(value) === "a prop" ? 2 : 1;
    const gradeDiff = grade(b.playType) - grade(a.playType);
    if (gradeDiff) return gradeDiff;
    return Number(b.score || 0) - Number(a.score || 0);
  });
}

function bestPlayEzpzPick(play: any): NflEzpzPick | null {
  if (play.formStatus !== "HOT") return null;
  const odds = parseAmericanOdds(play.marketOdds || play.oddsLine);
  if (odds == null || odds < -150) return null;
  const rawScore = Number(play.score || 0);
  const score = Number.isFinite(rawScore) ? (rawScore <= 1 ? rawScore * 100 : rawScore) : 0;
  const isProp = textKey(play.role).includes("player prop");
  return {
    source: "Best Play",
    game: play.game,
    market: isProp ? "Player Prop" : gameBestRecordType(play) as "Spread" | "Total",
    selection: play.play,
    odds: formatAmericanOdds(odds),
    score,
    tier: play.playType || "Best Play",
    qualification: `HOT Last 7 ${play.formType || "Best Play"} (${play.formRecord || "0-0-0"}) • -150 or better`,
    record: play.formRecord,
    formStatus: play.formStatus,
    formType: play.formType,
    headshotUrl: play.headshotUrl,
    playerName: play.playerName,
    playerTeam: play.playerTeam,
    propMarket: play.propMarket,
    propSide: play.propSide,
    propLine: play.propLine,
    snapshotStatus: "FINAL",
  };
}

type NflTrendModelSpec = {
  features: string[];
  median: number[];
  mean: number[];
  scale: number[];
  coef: number[];
  intercept: number;
};

type NflTrendModelState = {
  status: string;
  version: string;
  threshold: number;
  model: NflTrendModelSpec | null;
  reason: string;
};

function finiteNumber(value: unknown) {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace(/%/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function impliedProbabilityPct(value: unknown) {
  const odds = parseAmericanOdds(value);
  if (odds == null || odds === 0) return null;
  return odds > 0
    ? (100 / (odds + 100)) * 100
    : (Math.abs(odds) / (Math.abs(odds) + 100)) * 100;
}

function parseNflTrendModelState(rows: SheetRow[]): NflTrendModelState {
  const row = rows.find((entry) => textKey(entry.Sport) === "nfl") || rows[0] || {};
  const status = String(row.Status || "COLLECTING").trim() || "COLLECTING";
  const version = String(row["Active Model Version"] || "").trim();
  const threshold = finiteNumber(row["Normal Gap"]) ?? 15;
  const raw = String(row["Active Model JSON"] || "").trim();
  let model: NflTrendModelSpec | null = null;
  if (version && raw) {
    try {
      const parsed = JSON.parse(raw) as NflTrendModelSpec;
      const size = Array.isArray(parsed.features) ? parsed.features.length : 0;
      const valid = size > 0
        && Array.isArray(parsed.median) && parsed.median.length === size
        && Array.isArray(parsed.mean) && parsed.mean.length === size
        && Array.isArray(parsed.scale) && parsed.scale.length === size
        && Array.isArray(parsed.coef) && parsed.coef.length === size
        && Number.isFinite(Number(parsed.intercept));
      if (valid) model = parsed;
    } catch {
      model = null;
    }
  }
  return {
    status,
    version,
    threshold,
    model,
    reason: String(row["Promotion Reason"] || "").trim(),
  };
}

function trendSignalKeys(play: any) {
  const keys = (Array.isArray(play?.signals) ? play.signals : [])
    .map((signal: any) => String(signal?.signalKey || "").trim())
    .filter((key: string) => Boolean(key));
  return new Set<string>(keys);
}

function trendSideGroup(play: any) {
  const direct = textKey(play?.sideGroup || "");
  if (direct) return direct;
  const market = textKey(play?.market || "");
  if (market === "total") return textKey(play?.side || play?.selection || "").startsWith("under") ? "under" : "over";
  const line = finiteNumber(play?.line);
  return line != null && line < 0 ? "favorite" : "underdog";
}

function nflTrendFeatureValue(play: any, feature: string, implied: number | null, signalKeys: Set<string>) {
  const side = trendSideGroup(play);
  const market = textKey(play?.market || "");
  if (feature === "implied") return implied;
  if (feature === "legacy") return finiteNumber(play?.score);
  if (feature === "gapPct") return finiteNumber(play?.gapPct);
  if (feature === "publicMovementPct") return finiteNumber(play?.publicMovementPct);
  if (feature === "sharpMovementPct") return finiteNumber(play?.sharpMovementPct);
  if (feature === "lineMovementValue") return finiteNumber(play?.lineMovementValue);
  if (feature === "market_spread") return market === "spread" ? 1 : 0;
  if (feature === "market_total") return market === "total" ? 1 : 0;
  if (feature === "side_favorite") return side === "favorite" ? 1 : 0;
  if (feature === "side_underdog") return side === "underdog" ? 1 : 0;
  if (feature === "side_over") return side === "over" ? 1 : 0;
  if (feature === "side_under") return side === "under" ? 1 : 0;
  if (feature.startsWith("sig_")) return signalKeys.has(feature.slice(4)) ? 1 : 0;
  return finiteNumber(play?.[feature]);
}

function scoreNflTrendPlay(play: any, state: NflTrendModelState) {
  const spec = state.model;
  if (!spec) return null;
  const implied = finiteNumber(play?.currentImpliedPct)
    ?? finiteNumber(play?.impliedPct)
    ?? impliedProbabilityPct(play?.odds);
  if (implied == null) return null;
  const signalKeys = trendSignalKeys(play);
  let linear = Number(spec.intercept);
  for (let i = 0; i < spec.features.length; i += 1) {
    const raw = nflTrendFeatureValue(play, spec.features[i], implied, signalKeys);
    const value = raw == null || !Number.isFinite(raw) ? Number(spec.median[i]) : raw;
    const scale = Number(spec.scale[i]) || 1;
    linear += Number(spec.coef[i]) * ((value - Number(spec.mean[i])) / scale);
  }
  const probability = linear >= 0
    ? 1 / (1 + Math.exp(-linear))
    : Math.exp(linear) / (1 + Math.exp(linear));
  const predictedWinPct = probability * 100;
  const modelGapPct = predictedWinPct - implied;
  return {
    ...play,
    predictedWinPct,
    impliedProbabilityPct: implied,
    modelGapPct,
    trendModelVersion: state.version,
  };
}

function scoreNflTrendBoard(plays: any[], state: NflTrendModelState) {
  if (!state.model) return [];
  const scored = plays
    .map((play) => scoreNflTrendPlay(play, state))
    .filter(Boolean) as any[];
  const groups = new Map<string, any[]>();
  for (const play of scored) {
    const key = `${textKey(play.game)}|${textKey(play.market)}`;
    const group = groups.get(key) || [];
    group.push(play);
    groups.set(key, group);
  }
  const winners: any[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => Number(b.modelGapPct) - Number(a.modelGapPct));
    if (group[0]) winners.push(group[0]);
  }
  return winners;
}

function trendEzpzPick(play: any, threshold: number): NflEzpzPick | null {
  const modelGapPct = Number(play.modelGapPct);
  if (!Number.isFinite(modelGapPct) || modelGapPct < threshold) return null;
  const predictedWinPct = Number(play.predictedWinPct);
  const impliedPct = Number(play.impliedProbabilityPct);
  const line = play.line == null ? "" : `${Number(play.line) > 0 ? "+" : ""}${play.line}`;
  const selection = textKey(play.market) === "total"
    ? `${play.side || play.selection} ${line}`.trim()
    : `${play.selection || play.selectionTeam} ${line}`.trim();
  return {
    source: "Trend Play",
    game: play.game,
    market: textKey(play.market) === "total" ? "Total" : "Spread",
    selection,
    odds: formatAmericanOdds(play.odds) || String(play.odds || ""),
    score: Math.round(modelGapPct * 10) / 10,
    tier: `${threshold}%+ NFL V2 Model Gap`,
    qualification: `NFL V2 model gap +${modelGapPct.toFixed(1)}% • ${predictedWinPct.toFixed(1)}% predicted vs ${impliedPct.toFixed(1)}% implied • ${threshold}%+ Trend gate`,
    gapPct: modelGapPct,
    modelGapPct,
    predictedWinPct,
    impliedProbabilityPct: impliedPct,
    trendModelVersion: String(play.trendModelVersion || ""),
    snapshotStatus: String(play.snapshotStatus || "LIVE"),
  };
}

function dedupeEzpzPicks(picks: NflEzpzPick[]) {
  const map = new Map<string, NflEzpzPick>();
  for (const pick of picks) {
    const key = `${textKey(pick.game)}|${pick.market}|${textKey(pick.selection)}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, pick);
      continue;
    }
    map.set(key, {
      ...existing,
      source: "Best + Trend",
      score: Math.max(existing.score, pick.score),
      tier: `${existing.tier} + ${pick.tier}`,
      qualification: `${existing.qualification} • ${pick.qualification}`,
      gapPct: pick.gapPct ?? existing.gapPct,
      modelGapPct: pick.modelGapPct ?? existing.modelGapPct,
      predictedWinPct: pick.predictedWinPct ?? existing.predictedWinPct,
      impliedProbabilityPct: pick.impliedProbabilityPct ?? existing.impliedProbabilityPct,
      trendModelVersion: pick.trendModelVersion || existing.trendModelVersion,
      snapshotStatus: pick.snapshotStatus || existing.snapshotStatus,
    });
  }
  return [...map.values()].sort((a, b) => b.score - a.score || a.game.localeCompare(b.game));
}

export async function buildFootballPublicData(
  sport: FootballSport,
  options: { forceFresh?: boolean; persist?: boolean } = {},
) {
  const legacy = await buildLegacyFootballPublicData(sport, options) as any;
  if (sport !== "NFL") return legacy;

  const [propRows, propTracker, trendModelRows] = await Promise.all([
    readSportWorksheet("NFL", "prop_projections"),
    readSportWorksheet("NFL", "prop_tracker"),
    readSportWorksheet("NFL", "trend_v2_models"),
  ]);
  const nflTrendModel = parseNflTrendModelState(trendModelRows);

  const today = String(legacy.today || "");
  const slate = Array.isArray(legacy.slateToday) ? legacy.slateToday : [];
  const tracker = Array.isArray(legacy.betTrackerRows) ? legacy.betTrackerRows : [];
  const splits = Array.isArray(legacy.draftKings?.splits) ? legacy.draftKings.splits : [];
  const legacyGameBest = (Array.isArray(legacy.bestPlays) ? legacy.bestPlays : [])
    .filter((play: any) => !textKey(play.role || "").includes("player prop"));
  const gameBest = annotateGameBestPlays(legacyGameBest, tracker, splits);
  const propBest = await buildNflPropBestPlays(propRows, propTracker, slate, today);
  const bestPlays = [...gameBest, ...propBest];

  const todayTrendPlays = (Array.isArray(legacy.trendPlays) ? legacy.trendPlays : [])
    .filter((play: any) => isoDate(play.date || today) === today);
  const bestPicks = bestPlays.map(bestPlayEzpzPick).filter(Boolean) as NflEzpzPick[];
  const scoredTrendPlays = scoreNflTrendBoard(todayTrendPlays, nflTrendModel);
  const trendPicks = scoredTrendPlays
    .map((play) => trendEzpzPick(play, nflTrendModel.threshold))
    .filter(Boolean) as NflEzpzPick[];
  const aiPicks = dedupeEzpzPicks([...bestPicks, ...trendPicks]);

  const trendRule = nflTrendModel.model
    ? `Trend gate = NFL V2 predicted win probability − market-implied probability ≥ +${nflTrendModel.threshold.toFixed(1)}%.`
    : `NFL Trend V2 is ${nflTrendModel.status || "COLLECTING"}; no Trend EZPZ pick can qualify until an active NFL regression is promoted.${nflTrendModel.reason ? ` ${nflTrendModel.reason}` : ""}`;
  const ruleMessage = aiPicks.length
    ? `NFL EZPZ Picks live: Best Play = HOT Last-7 + -150 or better. ${trendRule} Net ROI is not used.`
    : `No NFL EZPZ Picks qualify right now. Best Play = HOT Last-7 + -150 or better. ${trendRule} Net ROI is not used.`;

  return {
    ...legacy,
    bestPlays,
    tiles: {
      ...(legacy.tiles || {}),
      bestPlaysToday: bestPlays.length,
    },
    aiPicks,
    nflTrendV2: {
      status: nflTrendModel.status,
      version: nflTrendModel.version,
      active: Boolean(nflTrendModel.model),
      threshold: nflTrendModel.threshold,
      reason: nflTrendModel.reason,
    },
    aiSelectorStatus: {
      ...(legacy.aiSelectorStatus || {}),
      message: ruleMessage,
      candidateCount: bestPlays.length + scoredTrendPlays.length,
      selectedCount: aiPicks.length,
      updatedAt: legacy.lastUpdated,
    },
  };
}
