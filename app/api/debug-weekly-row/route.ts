import { NextResponse } from "next/server";
import { readSportWorksheet } from "../../../../lib/sportSheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

export async function GET() {
  const rows = await readSportWorksheet("NCAAF", "weekly_market_trends");
  const matches = rows
    .filter((row) => /missouri state|smu/i.test(String(row.Game || "") + " " + String(row["Away Team"] || "") + " " + String(row["Home Team"] || "")))
    .map((row) => {
      let details: unknown = null;
      try { details = JSON.parse(String(row["Details JSON"] || "")); } catch {}
      return {
        Date: row.Date,
        Game: row.Game,
        GameTime: row["Game Time"],
        Market: row.Market,
        Selection: row.Selection,
        Side: row.Side,
        Line: row.Line,
        Odds: row.Odds,
        OpeningBets: row["Opening Bets %"],
        CurrentBets: row["Current Bets %"],
        BetsChange: row["Bets Change %"],
        OpeningHandle: row["Opening Handle %"],
        CurrentHandle: row["Current Handle %"],
        LineMovementSignal: row["Line Movement Signal"],
        SnapshotStatus: row["Snapshot Status"],
        UpdatedAt: row["Updated At"],
        details,
      };
    });
  return NextResponse.json({ ok: true, count: matches.length, matches });
}
