import { NextRequest, NextResponse } from "next/server";
import { buildFootballPublicData } from "../../../lib/footballPublicData";
import type { FootballSport, SheetRow } from "../../../lib/sportSheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 180;

type Signal = "RLM" | "Public Fade" | "Sharp";

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
  const iso = raw.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const us = raw.match(/(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?/);
  if (!us) return "";
  const year = us[3] || String(new Date().getFullYear());
  return `${year}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
}

function resultCode(value: unknown) {
  const key = String(value || "").trim().toUpperCase();
  if (["W", "WIN", "WON"].includes(key)) return "W";
  if (["L", "LOSS", "LOST"].includes(key)) return "L";
  if (["P", "PUSH"].includes(key)) return "P";
  return "";
}

function americanOdds(value: unknown) {
  const raw = String(value ?? "").replace(/−/g, "-");
  const tokens = raw.match(/[+-]?\d+(?:\.\d+)?/g) || [];
  for (const token of [...tokens].reverse()) {
    const parsed = Number(token);
    if (Number.isFinite(parsed) && Math.abs(parsed) >= 100 && Math.abs(parsed) <= 10000) return Math.round(parsed);
  }
  return null;
}

function selectionKey(row: SheetRow) {
  if (textKey(row.Market) === "total") {
    const key = textKey(row.Side || row.Selection || row["Public Split Selection"]);
    return key.startsWith("under") ? "under" : key.startsWith("over") ? "over" : key;
  }
  const key = textKey(row["Public Split Selection"] || row.Selection || "");
  const parts = key.split(" ").filter(Boolean);
  return parts[parts.length - 1] || key;
}

function groupKey(row: SheetRow) {
  return `${String(row.Date || "")}|${String(row["Game Key"] || row["Game ID"] || row.Game || "")}|${textKey(row.Market)}`;
}

function labels(row: SheetRow, group: SheetRow[], sport: FootballSport): Signal[] {
  const out: Signal[] = [];
  const ownBets = Number(row["Public Bets %"] || row["Current Public %"]);
  const ownMoney = Number(row["Public Money %"] || row["Current Sharp %"]);
  const sharpMin = sport === "NFL" ? 25 : 40;
  if (Number.isFinite(ownBets) && Number.isFinite(ownMoney) && ownMoney - ownBets >= sharpMin) out.push("Sharp");

  const ownKey = selectionKey(row);
  const publicSide = group.find((candidate) => selectionKey(candidate) !== ownKey);
  if (!publicSide) return out;

  const publicBets = Number(publicSide["Public Bets %"] || publicSide["Current Public %"]);
  const publicMoney = Number(publicSide["Public Money %"] || publicSide["Current Sharp %"]);
  const placeholder = (publicBets === 100 && publicMoney === 100) || (publicBets === 0 && publicMoney === 0);
  const fade = sport === "NFL"
    ? !placeholder && Number.isFinite(publicBets) && publicBets >= 80
    : Number.isFinite(publicBets) && Number.isFinite(publicMoney) && publicBets > 75 && publicBets - publicMoney >= 55;
  if (fade) out.push("Public Fade");

  const openingBets = Number(publicSide["Opening Public %"] || publicSide["Opening Bets %"]);
  const publicMove = Number(publicSide["Public Change %"]);
  const lineMove = Number(publicSide["Line Movement Value"]);
  const marketKey = textKey(row.Market);
  const marketMatches =
    (marketKey === "spread" && String(publicSide["Line Movement Basis"] || "").includes("Spread")) ||
    (marketKey === "total" && String(publicSide["Line Movement Basis"] || "").includes("Total Line"));
  if (
    marketMatches &&
    Number.isFinite(openingBets) && openingBets > 0 && openingBets < 100 &&
    Number.isFinite(publicMove) && publicMove >= 5 &&
    Number.isFinite(lineMove) && lineMove <= -1.5
  ) out.push("RLM");
  return out;
}

function record(rows: SheetRow[], sport: FootballSport, signal: Signal, beforeDate: string) {
  const grouped = new Map<string, SheetRow[]>();
  for (const row of rows || []) {
    if (!resultCode(row.Result || row.Status)) continue;
    const key = groupKey(row);
    const current = grouped.get(key);
    if (current) current.push(row); else grouped.set(key, [row]);
  }

  const qualified: SheetRow[] = [];
  grouped.forEach((group) => {
    const unique = new Map<string, SheetRow>();
    group.forEach((row) => {
      const key = selectionKey(row);
      if (key && !unique.has(key)) unique.set(key, row);
    });
    const sides = [...unique.values()];
    sides.forEach((row) => {
      if (labels(row, sides, sport).includes(signal)) qualified.push(row);
    });
  });

  const deduped = new Map<string, SheetRow>();
  for (const row of qualified) {
    const key = [
      String(row.Date || ""),
      textKey(row.Market),
      selectionKey(row),
      String(row["Public Bets %"] || row["Current Public %"] || ""),
      String(row["Public Money %"] || row["Current Sharp %"] || ""),
      String(row["Public Split Line"] || row.Line || ""),
      String(row["Public Split Odds"] || row.Odds || ""),
      resultCode(row.Result || row.Status),
    ].join("|");
    if (!deduped.has(key)) deduped.set(key, row);
  }

  const recent = [...deduped.values()]
    .filter((row) => {
      const date = isoDate(row.Date || row["Game Date"] || "");
      return !beforeDate || Boolean(date && date < beforeDate);
    })
    .sort((a, b) => isoDate(b.Date || b["Game Date"] || "").localeCompare(isoDate(a.Date || a["Game Date"] || "")))
    .slice(0, 7);

  let wins = 0, losses = 0, pushes = 0, units = 0;
  const details = recent.map((row) => {
    const result = resultCode(row.Result || row.Status);
    const odds = americanOdds(row["Public Split Odds"] || row.Odds) ?? -110;
    if (result === "W") { wins += 1; units += odds > 0 ? odds / 100 : 100 / Math.abs(odds); }
    else if (result === "L") { losses += 1; units -= 1; }
    else if (result === "P") pushes += 1;
    return {
      date: isoDate(row.Date),
      game: row.Game,
      gameKey: row["Game Key"],
      market: row.Market,
      selection: row.Selection,
      line: row["Public Split Line"] || row.Line,
      result,
      odds,
      source: row["Result Source"],
      trendTier: row["Trend Tier"],
    };
  });
  const total = wins + losses + pushes;
  return {
    record: `${wins}-${losses}-${pushes}`,
    totalBets: total,
    units: Math.round(units * 100) / 100,
    roi: total ? Math.round((units / total) * 1000) / 10 : 0,
    rows: details,
  };
}

export async function GET(request: NextRequest) {
  const rawSport = String(request.nextUrl.searchParams.get("sport") || "NCAAF").toUpperCase();
  const sport: FootballSport = rawSport === "NFL" ? "NFL" : "NCAAF";
  const before = String(request.nextUrl.searchParams.get("before") || "").trim();
  const data = await buildFootballPublicData(sport, { forceFresh: false, persist: false });
  const rows = Array.isArray(data.trendRecordRows) ? data.trendRecordRows as SheetRow[] : [];
  return NextResponse.json({
    sport,
    before,
    rowCount: rows.length,
    records: {
      RLM: record(rows, sport, "RLM", before),
      PublicFade: record(rows, sport, "Public Fade", before),
      Sharp: record(rows, sport, "Sharp", before),
    },
  }, { headers: { "Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex" } });
}
