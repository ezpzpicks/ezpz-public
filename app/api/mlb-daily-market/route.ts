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

function easternDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function eventTimeKey(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const simple = raw.match(/(?:^|T|\s)([01]?\d|2[0-3]):([0-5]\d)(?::\d{2})?(?:Z|\s*(?:ET|EST|EDT))?$/i);
  if (simple && !raw.endsWith("Z")) {
    return `${String(Number(simple[1])).padStart(2, "0")}:${simple[2]}`;
  }
  const stamp = Date.parse(raw);
  if (!Number.isFinite(stamp)) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(stamp));
  const hour = parts.find((part) => part.type === "hour")?.value || "";
  const minute = parts.find((part) => part.type === "minute")?.value || "";
  return hour && minute ? `${hour}:${minute}` : "";
}

function marketSelectionKey(market: string, value: unknown) {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (market === "Total") {
    if (normalized.startsWith("over")) return "over";
    if (normalized.startsWith("under")) return "under";
  }
  return normalized;
}

function latestCurrentSnapshotFor(
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
  const targetSelection = marketSelectionKey(market, selection);
  const targetTime = eventTimeKey(row["Game Time"]);

  return rows
    .filter((saved) => {
      if (isoDate(saved.Date) !== targetDate) return false;
      if (String(saved.Market || "") !== market) return false;
      if (marketSelectionKey(market, saved.Selection || saved.Side) !== targetSelection) return false;
      if (
        normalized(saved["Away Team"]) !== targetAway ||
        normalized(saved["Home Team"]) !== targetHome
      ) return false;
      const savedTime = eventTimeKey(saved["Game Time ET"]);
      return !targetTime || !savedTime || targetTime === savedTime;
    })
    .sort(
      (left, right) =>
        snapshotEpoch(right["Snapshot Time ET"]) -
        snapshotEpoch(left["Snapshot Time ET"]),
    )[0] || null;
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
  const targetSelection = marketSelectionKey(market, selection);
  const targetTime = eventTimeKey(row["Game Time"]);

  const points = rows
    .filter((saved) => {
      if (isoDate(saved.Date) !== targetDate) return false;
      if (String(saved.Market || "") !== market) return false;
      if (marketSelectionKey(market, saved.Selection || saved.Side) !== targetSelection) return false;

      const savedAway = normalized(saved["Away Team"]);
      const savedHome = normalized(saved["Home Team"]);
      const savedGame = normalized(saved.Game);
      const teamsMatch =
        targetAway && targetHome && savedAway === targetAway && savedHome === targetHome;
      const gameMatch = targetGame && savedGame === targetGame;
      if (!teamsMatch && !gameMatch) return false;

      const savedTime = eventTimeKey(saved["Game Time ET"]);
      return !targetTime || !savedTime || targetTime === savedTime;
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

function historicalPlay(
  row: Row,
  v2Rows: Row[],
  marketHistoryRows: Row[],
  currentSnapshotRows: Row[] = [],
) {
  const market = String(row.Market || "");
  if (market !== "Moneyline" && market !== "Total") return null;
  const date = isoDate(row.Date);
  const selection = market === "Total"
    ? String(row.Side || row.Selection || "")
    : String(row.Selection || row["Public Split Selection"] || "");
  const gameKey = cleanGameKey(row["Game Key"]) || `${date}|${row.Game}`;
  const currentSnapshot = latestCurrentSnapshotFor(
    currentSnapshotRows,
    row,
    market,
    selection,
  );
  const currentLine = market === "Moneyline"
    ? null
    : n(currentSnapshot?.Line || row["Public Split Line"] || row.Line || row["Odds/Line"]);
  const currentOdds = String(currentSnapshot?.Odds || row["Public Split Odds"] || row.Odds || "");
  const currentBets = n(
    currentSnapshot?.["Current Public %"] ||
    currentSnapshot?.["Public Bets %"] ||
    row["Current Public %"] ||
    row["Public Bets %"],
  ) ?? 0;
  const currentMoney = n(
    currentSnapshot?.["Current Sharp %"] ||
    currentSnapshot?.["Public Money %"] ||
    row["Current Sharp %"] ||
    row["Public Money %"],
  ) ?? 0;
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
  const baseHistory = retainedHistory.length
    ? retainedHistory
    : v2History.length >= 2
      ? v2History
      : fallbackHistory;
  const currentPoint = currentSnapshot
    ? {
        snapshotTime: String(currentSnapshot["Snapshot Time ET"] || ""),
        line: market === "Moneyline" ? null : n(currentSnapshot.Line),
        odds: String(currentSnapshot.Odds || ""),
        betsPct: n(currentSnapshot["Current Public %"] || currentSnapshot["Public Bets %"]) ?? 0,
        moneyPct: n(currentSnapshot["Current Sharp %"] || currentSnapshot["Public Money %"]) ?? 0,
      }
    : null;
  const dedupedHistory = new Map<string, (typeof baseHistory)[number]>();
  for (const point of [...baseHistory, ...(currentPoint?.snapshotTime ? [currentPoint] : [])]) {
    const key = [
      point.snapshotTime,
      point.line == null ? "" : String(point.line),
      point.odds,
      point.betsPct,
      point.moneyPct,
    ].join("|");
    dedupedHistory.set(key, point);
  }
  const movementHistory = [...dedupedHistory.values()].sort(
    (a, b) => snapshotEpoch(a.snapshotTime) - snapshotEpoch(b.snapshotTime),
  );
  const latestPoint = movementHistory.at(-1);
  const effectiveLine =
    market === "Moneyline"
      ? null
      : latestPoint?.line ?? currentLine;
  const effectiveOdds = String(latestPoint?.odds || currentOdds);
  const effectiveBets = Number.isFinite(Number(latestPoint?.betsPct))
    ? Number(latestPoint?.betsPct)
    : currentBets;
  const effectiveMoney = Number.isFinite(Number(latestPoint?.moneyPct))
    ? Number(latestPoint?.moneyPct)
    : currentMoney;
  const updatedAt = String(
    latestPoint?.snapshotTime ||
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
      : oddsNumber(effectiveOdds) < 0
        ? "Favorite"
        : "Underdog",
    line: effectiveLine,
    odds: effectiveOdds,
    betsPct: effectiveBets,
    moneyPct: effectiveMoney,
    gapPct: Math.round((effectiveMoney - effectiveBets) * 10) / 10,
    openingBetsPct: openingBets,
    openingMoneyPct: openingMoney,
    publicMovementPct: openingBets == null ? null : Math.round((effectiveBets - openingBets) * 10) / 10,
    sharpMovementPct: openingMoney == null ? null : Math.round((effectiveMoney - openingMoney) * 10) / 10,
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
    snapshotStatus:
      currentSnapshot &&
      !String(currentSnapshot["Match Confidence"] || "")
        .toLowerCase()
        .includes("15-minute tracking snapshot")
        ? "LIVE"
        : "FINAL_PREGAME",
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

    const currentDate = easternDateKey();
    const [dailyTrendRaw, v2SnapshotRaw, marketHistoryRaw, currentSnapshotRaw] = await Promise.all([
      readTursoDatasetByDateKeys("MLB", "all_game_trends", [selectedDate]),
      readTursoDatasetByDateKeys("MLB", "trend_v2_snapshots", [selectedDate]),
      readTursoDatasetByDateKeys("MLB", "public_split_history", [selectedDate]),
      selectedDate === currentDate
        ? readTursoDatasetByDateKeys("MLB", "public_split_snapshots", [selectedDate])
        : Promise.resolve([]),
    ]);
    const dailyTrendRows = asRows(dailyTrendRaw);
    const v2Rows = asRows(v2SnapshotRaw);
    const marketHistoryRows = asRows(marketHistoryRaw);
    const currentSnapshotRows = asRows(currentSnapshotRaw);
    const trendPlays = dailyTrendRows
      .map((row) =>
        historicalPlay(
          row,
          v2Rows,
          marketHistoryRows,
          currentSnapshotRows,
        ),
      )
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
      source:
        selectedDate === currentDate
          ? "stored-all_game_trends+public_split_history+current_public_split_snapshots"
          : "stored-all_game_trends+public_split_history",
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    console.error("MLB daily market history read failed", error);
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
