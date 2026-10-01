import { NextResponse } from "next/server";
import { readSportWorksheet } from "../../../../lib/sportSheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Row = Record<string, string>;

function n(v: unknown) {
  const x = Number(String(v ?? "").replace(/%/g, "").trim());
  return Number.isFinite(x) ? x : null;
}
function res(v: unknown) {
  const s = String(v ?? "").trim().toUpperCase();
  if (s === "W" || s === "WIN" || s === "WON") return "W";
  if (s === "L" || s === "LOSS" || s === "LOST") return "L";
  if (s === "P" || s === "PUSH") return "P";
  return "";
}
function side(r: Row) {
  const p = String(r.Pick ?? "").toLowerCase();
  if (p.startsWith("over")) return "Over";
  if (p.startsWith("under")) return "Under";
  if (String(r.Market ?? "").toLowerCase().includes("touchdown")) return "Anytime TD";
  return "Other";
}
function summary(rows: Row[]) {
  const done = rows.filter(r => res(r.Result));
  const w = done.filter(r => res(r.Result) === "W").length;
  const l = done.filter(r => res(r.Result) === "L").length;
  const p = done.filter(r => res(r.Result) === "P").length;
  const vals = done.map(r => n(r["Role Confidence"])).filter((x): x is number => x !== null);
  return {
    n: done.length,
    w, l, p,
    winPct: w + l ? Number((100 * w / (w + l)).toFixed(2)) : null,
    avgRC: vals.length ? Number((vals.reduce((a,b)=>a+b,0) / vals.length).toFixed(2)) : null,
  };
}
function cutoffs(rows: Row[]) {
  return [0,40,45,50,55,60,62.5,65,67.5,70,72.5,75,77.5,80,82.5,85].map(min => ({
    min,
    kept: summary(rows.filter(r => (n(r["Role Confidence"]) ?? -1) >= min)),
    removed: summary(rows.filter(r => (n(r["Role Confidence"]) ?? -1) < min)),
  }));
}
function bands(rows: Row[]) {
  const defs: Array<[string, number, number]> = [
    ["<50", -1, 50], ["50-54.9",50,55], ["55-59.9",55,60], ["60-64.9",60,65],
    ["65-69.9",65,70], ["70-74.9",70,75], ["75-79.9",75,80], ["80+",80,999],
  ];
  return defs.map(([label, lo, hi]) => ({
    label,
    ...summary(rows.filter(r => { const x=n(r["Role Confidence"]); return x !== null && x >= lo && x < hi; })),
  }));
}
function grouped(rows: Row[], fn: (r: Row) => string) {
  const out: Record<string, Row[]> = {};
  for (const r of rows) {
    const k = fn(r) || "(blank)";
    (out[k] ||= []).push(r);
  }
  const ans: Record<string, unknown> = {};
  for (const k of Object.keys(out).sort()) ans[k] = { overall: summary(out[k]), cutoffs: cutoffs(out[k]), bands: bands(out[k]) };
  return ans;
}

export async function GET() {
  const tracker = (await readSportWorksheet("NFL", "prop_tracker")) as Row[];
  const completed = tracker.filter(r => res(r.Result));
  const rows = completed.filter(r => n(r["Role Confidence"]) !== null);
  return NextResponse.json({
    ok: true,
    source: "NFL prop_tracker",
    totals: { trackerRows: tracker.length, completedRows: completed.length, completedWithRC: rows.length },
    overall: summary(rows),
    winnerRC: summary(rows.filter(r => res(r.Result) === "W")),
    loserRC: summary(rows.filter(r => res(r.Result) === "L")),
    cutoffs: cutoffs(rows),
    bands: bands(rows),
    byMarket: grouped(rows, r => String(r.Market ?? "")),
    byMarketSide: grouped(rows, r => `${String(r.Market ?? "")} | ${side(r)}`),
    byPosition: grouped(rows, r => String(r.Position ?? "")),
    byGrade: grouped(rows, r => String(r.Grade ?? "")),
    byModelVersion: grouped(rows, r => String(r["Model Version"] ?? "")),
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
