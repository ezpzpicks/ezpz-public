export type SheetRow = Record<string, string>;

export type TrackerSummaryRow = {
  betType: string;
  status: "WINNING" | "EVEN" | "LOSING";
  wins: number;
  losses: number;
  pushes: number;
  totalBets: number;
  winPct: number;
  unitsWon: number;
  roiPct: number;
};

export type RecordTotals = {
  label: string;
  record: string;
  wins: number;
  losses: number;
  pushes: number;
  totalBets: number;
  winPct: number;
  unitsWon: number;
  roiPct: number;
};

export type BestPlay = {
  playType: string;
  game: string;
  play: string;
  oddsLine: string;
  score: number | string;
  isGreen: boolean;
  awayTeam: string;
  homeTeam: string;
  headshotUrl?: string;
};

export function todayEtString() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function nowEtLabel() {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date()) + " ET";
}

export function normalizeBetTypeText(value: unknown) {
  const text = String(value ?? "").trim().toUpperCase();
  if (!text || text === "PASS" || text === "NAN") return "";
  if (text.includes("A MONEYLINE")) return "A MONEYLINE";
  if (text.includes("B MONEYLINE")) return "B MONEYLINE";
  if (text.includes("NON-EDGE MONEYLINE")) return "NON-EDGE MONEYLINE";
  if (text.includes("ELITE NRFI")) return "ELITE NRFI";
  if (text.includes("STRONG NRFI")) return "STRONG NRFI";
  if (text === "NRFI" || text.includes(" NRFI")) return "NRFI";
  if (text.includes("LEAN NRFI")) return "LEAN NRFI";
  if (text.includes("YRFI")) return "YRFI";
  if (text.includes("STRONG OVER")) return "STRONG OVER";
  if (text.includes("LEAN OVER")) return "LEAN OVER";
  if (text === "OVER" || text.endsWith(" OVER")) return "OVER";
  if (text.includes("STRONG UNDER")) return "STRONG UNDER";
  if (text.includes("LEAN UNDER")) return "LEAN UNDER";
  if (text === "UNDER" || text.endsWith(" UNDER")) return "UNDER";
  return text;
}

function toNumber(value: unknown) {
  const num = Number(String(value ?? "").replace("%", "").trim());
  return Number.isFinite(num) ? num : 0;
}

function parseAmericanOdds(value: unknown) {
  const text = String(value ?? "").trim();
  const matches = text.match(/[+-]?\d+/g);
  if (!matches) return -110;
  const odds = Number(matches[matches.length - 1]);
  if (!Number.isFinite(odds) || (odds > -100 && odds < 100)) return -110;
  return odds;
}

function profitUnits(oddsLine: unknown, result: unknown) {
  const res = String(result ?? "").trim();
  if (res === "Push") return 0;
  if (res === "Loss") return -1;
  if (res !== "Win") return 0;
  const odds = parseAmericanOdds(oddsLine);
  return odds > 0 ? odds / 100 : 100 / Math.abs(odds);
}

export function isCompleted(row: SheetRow) {
  return ["Win", "Loss", "Push"].includes(String(row.Result ?? "").trim());
}

export function summarizeTracker(rows: SheetRow[]): TrackerSummaryRow[] {
  const groups = new Map<string, SheetRow[]>();
  rows.filter(isCompleted).forEach((row) => {
    const type = normalizeBetTypeText(row["Bet Type"]);
    if (!type) return;
    groups.set(type, [...(groups.get(type) ?? []), row]);
  });

  return [...groups.entries()].map(([betType, bets]) => {
    const wins = bets.filter((b) => b.Result === "Win").length;
    const losses = bets.filter((b) => b.Result === "Loss").length;
    const pushes = bets.filter((b) => b.Result === "Push").length;
    const decisions = wins + losses;
    const unitsWon = bets.reduce((sum, b) => sum + profitUnits(b["Odds/Line"], b.Result), 0);
    const status: TrackerSummaryRow["status"] = wins > losses ? "WINNING" : wins === losses ? "EVEN" : "LOSING";
    return {
      betType,
      status,
      wins,
      losses,
      pushes,
      totalBets: wins + losses + pushes,
      winPct: decisions ? +(wins / decisions * 100).toFixed(1) : 0,
      unitsWon: +unitsWon.toFixed(2),
      roiPct: decisions ? +(unitsWon / decisions * 100).toFixed(1) : 0,
    };
  }).sort((a, b) => b.unitsWon - a.unitsWon || b.winPct - a.winPct);
}

function totalsFromRows(label: string, rows: SheetRow[]): RecordTotals {
  const completed = rows.filter(isCompleted);
  const wins = completed.filter((b) => b.Result === "Win").length;
  const losses = completed.filter((b) => b.Result === "Loss").length;
  const pushes = completed.filter((b) => b.Result === "Push").length;
  const decisions = wins + losses;
  const unitsWon = completed.reduce((sum, b) => sum + profitUnits(b["Odds/Line"], b.Result), 0);
  return {
    label,
    record: `${wins}-${losses}-${pushes}`,
    wins,
    losses,
    pushes,
    totalBets: wins + losses + pushes,
    winPct: decisions ? +(wins / decisions * 100).toFixed(1) : 0,
    unitsWon: +unitsWon.toFixed(2),
    roiPct: decisions ? +(unitsWon / decisions * 100).toFixed(1) : 0,
  };
}

function dateToUtcNoon(dateStr: string) {
  return new Date(`${dateStr}T12:00:00Z`);
}

export function lastSevenDaysGreenTotals(rows: SheetRow[], summary: TrackerSummaryRow[], todayEt = todayEtString()) {
  const today = dateToUtcNoon(todayEt);
  const cutoff = new Date(today);
  cutoff.setUTCDate(cutoff.getUTCDate() - 6);
  const winningTypes = new Set(summary.filter((s) => s.wins > s.losses).map((s) => s.betType));
  return totalsFromRows("LAST 7 DAYS GREEN BETS", rows.filter((row) => {
    const d = dateToUtcNoon(String(row.Date ?? ""));
    return !Number.isNaN(d.valueOf()) && d >= cutoff && d <= today && winningTypes.has(normalizeBetTypeText(row["Bet Type"]));
  }));
}

export function overallGreenTotals(rows: SheetRow[], summary: TrackerSummaryRow[]) {
  const winningTypes = new Set(summary.filter((s) => s.wins > s.losses).map((s) => s.betType));
  const greenRows = rows.filter((row) => winningTypes.has(normalizeBetTypeText(row["Bet Type"])));
  return totalsFromRows("OVERALL GREEN BETS", greenRows);
}

export function pendingGreenCount(rows: SheetRow[], summary: TrackerSummaryRow[]) {
  const winningTypes = new Set(summary.filter((s) => s.wins > s.losses).map((s) => s.betType));
  return rows.filter((row) => row.Result === "Pending" && winningTypes.has(normalizeBetTypeText(row["Bet Type"]))).length;
}

export function buildBetTypeGreenSet(summary: TrackerSummaryRow[]) {
  return new Set(summary.filter((s) => s.wins > s.losses).map((s) => s.betType));
}

function getScore(value: unknown) {
  const n = toNumber(value);
  return n || "";
}

function firstUrl(row: SheetRow, keys: string[]) {
  for (const key of keys) {
    const value = String(row[key] ?? "").trim();
    if (value.startsWith("http")) return value;
  }
  return "";
}

export function isGreenPlayType(type: string, greenSet: Set<string>) {
  const normalized = normalizeBetTypeText(type);
  return greenSet.has(normalized);
}

export function buildBestPlays(slateRows: SheetRow[], greenSet: Set<string>): BestPlay[] {
  const plays: BestPlay[] = [];
  for (const row of slateRows) {
    const game = row["Game Label"] || `${row["Away Team"]} at ${row["Home Team"]}`;
    const awayTeam = row["Away Team"] || "";
    const homeTeam = row["Home Team"] || "";
    const base = { game, awayTeam, homeTeam };

    const mlGrade = normalizeBetTypeText(row["ML Grade"]);
    if (mlGrade && mlGrade !== "NON-EDGE MONEYLINE" && row["Better ML"] && isGreenPlayType(mlGrade, greenSet)) {
      plays.push({
        ...base,
        playType: mlGrade,
        play: row["Better ML"],
        oddsLine: row["ML Odds"] || "",
        score: "Model edge",
        isGreen: true,
      });
    }

    const nrfiGrade = normalizeBetTypeText(row["NRFI Grade"]);
    if (["ELITE NRFI", "STRONG NRFI", "YRFI"].includes(nrfiGrade) && isGreenPlayType(nrfiGrade, greenSet)) {
      plays.push({ ...base, playType: nrfiGrade, play: nrfiGrade.includes("YRFI") ? "YRFI" : "NRFI", oddsLine: "", score: "High confidence", isGreen: true });
    }

    const awayK = String(row["Away Pitcher K + Grade"] ?? "").trim();
    const awayType = normalizeBetTypeText(awayK);
    if (awayK && awayType && awayType !== "PASS" && isGreenPlayType(awayType, greenSet)) {
      plays.push({
        ...base,
        playType: awayType,
        play: awayK,
        oddsLine: "Pitcher Ks",
        score: getScore(row["Away Pitcher K Score"]),
        isGreen: true,
        headshotUrl: firstUrl(row, ["Away Pitcher Headshot", "Away Pitcher Headshot URL", "Away Pitcher Image", "Away Pitcher Image URL"]),
      });
    }

    const homeK = String(row["Home Pitcher K + Grade"] ?? "").trim();
    const homeType = normalizeBetTypeText(homeK);
    if (homeK && homeType && homeType !== "PASS" && isGreenPlayType(homeType, greenSet)) {
      plays.push({
        ...base,
        playType: homeType,
        play: homeK,
        oddsLine: "Pitcher Ks",
        score: getScore(row["Home Pitcher K Score"]),
        isGreen: true,
        headshotUrl: firstUrl(row, ["Home Pitcher Headshot", "Home Pitcher Headshot URL", "Home Pitcher Image", "Home Pitcher Image URL"]),
      });
    }
  }
  return plays.sort((a, b) => toNumber(b.score) - toNumber(a.score));
}
