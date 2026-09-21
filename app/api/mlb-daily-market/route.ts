import { NextRequest, NextResponse } from "next/server";
import {
  readTursoDataset,
  readTursoDatasetByDateKeys,
  type TursoRow,
} from "../../../lib/tursoStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

type Row = Record<string, string>;

function isoDate(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return `${iso[1]}-${String(iso[2]).padStart(2, "0")}-${String(iso[3]).padStart(2, "0")}`;
  const us = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2}|\d{4})$/);
  if (us) {
    const year = us[3].length === 2 ? `20${us[3]}` : us[3];
    return `${year}-${String(us[1]).padStart(2, "0")}-${String(us[2]).padStart(2, "0")}`;
  }
  return "";
}

function n(value: unknown) {
  const parsed = Number(String(value ?? "").replace("%", "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function oddsNumber(value: unknown) {
  const match = String(value || "").replace(/−/g, "-").match(/[+-]?\d+/);
  const parsed = match ? Number(match[0]) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanGameKey(value: unknown) {
  return String(value || "").trim().replace(/\.0$/, "");
}

function pointFromRow(row: Row, opening: boolean) {
  const line = n(opening ? row["Opening Public Split Line"] : row["Public Split Line"]);
  return {
    snapshotTime: String(
      opening
        ? row["Opening Public Split Snapshot Time"] || row["Public Split Snapshot Time"] || ""
        : row["Public Split Snapshot Time"] || row["Result Updated"] || "",
    ),
    line,
    odds: String(
      opening
        ? row["Opening Public Split Odds"] || row["Public Split Odds"] || row.Odds || ""
        : row["Public Split Odds"] || row.Odds || "",
    ),
    betsPct: n(opening ? row["Opening Public %"] : row["Current Public %"] || row["Public Bets %"]) ?? 0,
    moneyPct: n(opening ? row["Opening Sharp %"] : row["Current Sharp %"] || row["Public Money %"]) ?? 0,
  };
}

function snapshotEpoch(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function v2HistoryFor(
  rows: Row[],
  gameKey: string,
  market: string,
  selection: string,
) {
  const normalized = (value: unknown) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const selected = normalized(selection);
  return rows
    .filter((row) => {
      if (cleanGameKey(row["Game Key"]) !== gameKey) return false;
      if (String(row.Market || "") !== market) return false;
      return normalized(row.Selection || row.Side) === selected;
    })
    .map((row) => {
      let details: any = {};
      try { details = JSON.parse(String(row["Details JSON"] || "{}")); } catch {}
      return {
        snapshotTime: String(row["Snapshot Time ET"] || ""),
        line: n(row.Line ?? details.line),
        odds: String(row.Odds || details.odds || ""),
        betsPct: n(details.betsPct) ?? 0,
        moneyPct: n(details.moneyPct) ?? 0,
      };
    })
    .filter((point) => point.snapshotTime && Number.isFinite(point.betsPct) && Number.isFinite(point.moneyPct))
    .sort((a, b) => snapshotEpoch(a.snapshotTime) - snapshotEpoch(b.snapshotTime));
}

function marketHistoryFor(
  rows: Row[],
  row: Row,
  market: string,
  selection: string,
) {
  const normalized = (value: unknown) =>
    String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const targetDate = isoDate(row.Date);
  const targetAway = normalized(row["Away Team"]);
  const targetHome = normalized(row["Home Team"]);
  const targetGame = normalized(row.Game);
  const targetSelection = normalized(selection);
  const targetTime = String(row["Game Time"] || "").trim();

  const points = rows
    .filter((saved) => {
      if (isoDate(saved.Date) !== targetDate) return false;
      if (String(saved.Market || "") !== market) return false;
      if (normalized(saved.Selection || saved.Side) !== targetSelection) return false;

      const savedAway = normalized(saved["Away Team"]);
      const savedHome = normalized(saved["Home Team"]);
      const savedGame = normalized(saved.Game);
      const teamsMatch =
        targetAway && targetHome && savedAway === targetAway && savedHome === targetHome;
      const gameMatch = targetGame && savedGame === targetGame;
      if (!teamsMatch && !gameMatch) return false;

      const savedTime = String(saved["Game Time ET"] || "").trim();
      return !targetTime || !savedTime || targetTime.includes(savedTime) || savedTime.includes(targetTime);
    })
    .map((saved) => ({
      snapshotTime: String(saved["Snapshot Time ET"] || ""),
      line: market === "Moneyline" ? null : n(saved.Line),
      odds: String(saved.Odds || ""),
      betsPct: n(saved["Current Public %"] || saved["Public Bets %"]) ?? 0,
      moneyPct: n(saved["Current Sharp %"] || saved["Public Money %"]) ?? 0,
    }))
    .filter((point) => point.snapshotTime)
    .sort((a, b) => snapshotEpoch(a.snapshotTime) - snapshotEpoch(b.snapshotTime));

  const deduped = new Map<string, (typeof points)[number]>();
  for (const point of points) {
    const key = [
      point.snapshotTime,
      point.line == null ? "" : String(point.line),
      point.odds,
      point.betsPct,
      point.moneyPct,
    ].join("|");
    deduped.set(key, point);
  }
  return [...deduped.values()];
}

function historicalPlay(row: Row, v2Rows: Row[], marketHistoryRows: Row[]) {
  const market = String(row.Market || "");
  if (market !== "Moneyline" && market !== "Total") return null;
  const date = isoDate(row.Date);
  const selection = market === "Total"
    ? String(row.Side || row.Selection || "")
    : String(row.Selection || row["Public Split Selection"] || "");
  const gameKey = cleanGameKey(row["Game Key"]) || `${date}|${row.Game}`;
  const currentLine = market === "Moneyline"
    ? null
    : n(row["Public Split Line"] || row.Line || row["Odds/Line"]);
  const currentOdds = String(row["Public Split Odds"] || row.Odds || "");
  const currentBets = n(row["Current Public %"] || row["Public Bets %"]) ?? 0;
  const currentMoney = n(row["Current Sharp %"] || row["Public Money %"]) ?? 0;
  const openingBets = n(row["Opening Public %"]);
  const openingMoney = n(row["Opening Sharp %"]);
  const openingLine = market === "Moneyline" ? null : n(row["Opening Public Split Line"]);
  const openingOdds = String(row["Opening Public Split Odds"] || currentOdds);
  const retainedHistory = marketHistoryFor(
    marketHistoryRows,
    row,
    market,
    selection,
  );
  const v2History = v2HistoryFor(v2Rows, gameKey, market, selection);
  const fallbackHistory = [pointFromRow(row, true), pointFromRow(row, false)]
    .filter((point, index, array) =>
      point.snapshotTime &&
      (index === 0 || point.snapshotTime !== array[index - 1]?.snapshotTime)
    );
  const movementHistory = retainedHistory.length
    ? retainedHistory
    : v2History.length >= 2
      ? v2History
      : fallbackHistory;
  const updatedAt = String(
    movementHistory.at(-1)?.snapshotTime ||
    row["Public Split Snapshot Time"] ||
    row["Result Updated"] ||
    "",
  );

  return {
    date,
    gameKey,
    recordDate: date,
    recordGameKey: gameKey,
    recordGameTime: String(row["Game Time"] || ""),
    gameTime: String(row["Game Time"] || ""),
    game: String(row.Game || ""),
    awayTeam: String(row["Away Team"] || ""),
    homeTeam: String(row["Home Team"] || ""),
    market,
    selection,
    selectionTeam: market === "Moneyline" ? selection : "",
    side: market === "Total" ? selection : "",
    sideGroup: market === "Total"
      ? selection
      : oddsNumber(currentOdds) < 0
        ? "Favorite"
        : "Underdog",
    line: currentLine,
    odds: currentOdds,
    betsPct: currentBets,
    moneyPct: currentMoney,
    gapPct: Math.round((currentMoney - currentBets) * 10) / 10,
    openingBetsPct: openingBets,
    openingMoneyPct: openingMoney,
    publicMovementPct: openingBets == null ? null : Math.round((currentBets - openingBets) * 10) / 10,
    sharpMovementPct: openingMoney == null ? null : Math.round((currentMoney - openingMoney) * 10) / 10,
    openingLine,
    openingOdds,
    openingImpliedPct: n(row["Opening Implied %"]),
    currentImpliedPct: n(row["Current Implied %"]),
    lineMovementBasis: String(row["Line Movement Basis"] || ""),
    lineMovementValue: n(row["Line Movement Value"]),
    lineMovementSignal: String(row["Line Movement Signal"] || ""),
    score: 0,
    tier: "Pass",
    signals: [],
    firstTrackedAt: String(
      row["Opening Public Split Snapshot Time"] ||
      movementHistory[0]?.snapshotTime ||
      "",
    ),
    updatedAt,
    snapshotStatus: "FINAL_PREGAME",
    movementHistory,
  };
}

function asRows(rows: TursoRow[]): Row[] {
  return rows.map((row) => {
    const out: Row = {};
    for (const [key, value] of Object.entries(row || {})) out[key] = String(value ?? "");
    return out;
  });
}

export async function GET(request: NextRequest) {
  try {
    const allTrendRows = asRows(await readTursoDataset("MLB", "all_game_trends"));
    const availableDates = [...new Set(
      allTrendRows
        .map((row) => isoDate(row.Date))
        .filter(Boolean),
    )].sort((a, b) => b.localeCompare(a));

    const requested = isoDate(request.nextUrl.searchParams.get("date") || "");
    const selectedDate = requested || availableDates[0] || "";
    if (!selectedDate) {
      return NextResponse.json({
        ok: true,
        selectedDate: "",
        availableDates: [],
        games: [],
        trendPlays: [],
      }, { headers: { "Cache-Control": "no-store, max-age=0" } });
    }

    const [dailyTrendRaw, v2SnapshotRaw, marketHistoryRaw] = await Promise.all([
      readTursoDatasetByDateKeys("MLB", "all_game_trends", [selectedDate]),
      readTursoDatasetByDateKeys("MLB", "trend_v2_snapshots", [selectedDate]),
      readTursoDatasetByDateKeys("MLB", "public_split_history", [selectedDate]),
    ]);
    const dailyTrendRows = asRows(dailyTrendRaw);
    const v2Rows = asRows(v2SnapshotRaw);
    const marketHistoryRows = asRows(marketHistoryRaw);
    const trendPlays = dailyTrendRows
      .map((row) => historicalPlay(row, v2Rows, marketHistoryRows))
      .filter(Boolean);

    const gamesMap = new Map<string, Row>();
    for (const row of dailyTrendRows) {
      const key = cleanGameKey(row["Game Key"]) || String(row.Game || "");
      if (!key || gamesMap.has(key)) continue;
      gamesMap.set(key, {
        Date: selectedDate,
        "Game Key": key,
        "Game Time": String(row["Game Time"] || ""),
        Game: String(row.Game || ""),
        "Away Team": String(row["Away Team"] || ""),
        "Home Team": String(row["Home Team"] || ""),
      });
    }

    return NextResponse.json({
      ok: true,
      selectedDate,
      availableDates,
      games: [...gamesMap.values()],
      trendPlays,
      source: "stored-all_game_trends+public_split_history",
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    console.error("MLB daily market history read failed", error);
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
