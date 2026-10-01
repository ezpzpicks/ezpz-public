import { NextResponse } from "next/server";
import { readSportWorksheet } from "../../../../lib/sportSheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Row = Record<string, string>;

type Joined = Row & {
  _date: string;
  _player: string;
  _market: string;
  _side: string;
  _line: string;
  _tier: string;
  _roleConfidence: string;
  _reliability: string;
  _grade: string;
  _modelVersion: string;
  _position: string;
  _slot: string;
  _join: string;
};

function txt(v: unknown) { return String(v ?? "").trim(); }
function key(v: unknown) { return txt(v).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim(); }
function num(v: unknown) {
  const x = Number(txt(v).replace(/%/g, ""));
  return Number.isFinite(x) ? x : null;
}
function result(v: unknown) {
  const s = txt(v).toUpperCase();
  if (["W","WIN","WON"].includes(s)) return "W";
  if (["L","LOSS","LOST"].includes(s)) return "L";
  if (["P","PUSH"].includes(s)) return "P";
  return "";
}
function isoDate(v: unknown) {
  const s = txt(v);
  const iso = s.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2,"0")}-${iso[3].padStart(2,"0")}`;
  const us = s.match(/(\d{1,2})\/(\d{1,2})\/(20\d{2})/);
  if (us) return `${us[3]}-${us[1].padStart(2,"0")}-${us[2].padStart(2,"0")}`;
  return "";
}
function parseDetails(row: Row) {
  try { return JSON.parse(txt(row["Details JSON"]) || "{}") as Record<string, unknown>; }
  catch { return {} as Record<string, unknown>; }
}
function projectionSide(row: Row) {
  const p = txt(row.Pick).toLowerCase();
  if (p.startsWith("over")) return "over";
  if (p.startsWith("under")) return "under";
  if (key(row.Market).includes("anytime td")) return "anytime td";
  return "";
}
function summary(rows: Joined[]) {
  const done = rows.filter(r => result(r.Result));
  const w = done.filter(r => result(r.Result) === "W").length;
  const l = done.filter(r => result(r.Result) === "L").length;
  const p = done.filter(r => result(r.Result) === "P").length;
  const vals = done.map(r => num(r._roleConfidence)).filter((x): x is number => x !== null);
  return { n: done.length, w, l, p, winPct: w+l ? +(100*w/(w+l)).toFixed(2) : null, avgRC: vals.length ? +(vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(2) : null };
}
function cutoffs(rows: Joined[]) {
  return [0,40,45,50,55,60,62.5,65,67.5,70,72.5,75,77.5,80,82.5,85].map(min => ({
    min,
    kept: summary(rows.filter(r => (num(r._roleConfidence) ?? -1) >= min)),
    removed: summary(rows.filter(r => (num(r._roleConfidence) ?? -1) < min)),
  }));
}
function bands(rows: Joined[]) {
  const defs: Array<[string,number,number]> = [
    ["<50",-1,50],["50-54.9",50,55],["55-59.9",55,60],["60-64.9",60,65],
    ["65-69.9",65,70],["70-74.9",70,75],["75-79.9",75,80],["80+",80,999],
  ];
  return defs.map(([label,lo,hi]) => ({ label, ...summary(rows.filter(r => { const x=num(r._roleConfidence); return x !== null && x >= lo && x < hi; })) }));
}
function grouped(rows: Joined[], fn: (r: Joined)=>string) {
  const groups: Record<string, Joined[]> = {};
  for (const r of rows) (groups[fn(r) || "(blank)"] ||= []).push(r);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(groups).sort()) out[k] = { overall: summary(groups[k]), cutoffs: cutoffs(groups[k]), bands: bands(groups[k]) };
  return out;
}

export async function GET() {
  const [history, projections] = await Promise.all([
    readSportWorksheet("NFL", "ezpz_pick_history") as Promise<Row[]>,
    readSportWorksheet("NFL", "prop_projections") as Promise<Row[]>,
  ]);

  const saved = history.filter(row => {
    const d = parseDetails(row);
    const pm = txt(row["Prop Market"] || d.propMarket);
    return key(row.Market) === "player prop" || Boolean(pm);
  });

  const seen = new Set<string>();
  const completed = saved.filter(row => result(row.Result)).filter(row => {
    const d = parseDetails(row);
    const id = txt(row["Pick Key"]) || [isoDate(row.Date || d.date), key(row.Player || d.playerName), key(row["Prop Market"] || d.propMarket), key(row["Prop Side"] || d.propSide), txt(row["Prop Line"] || d.propLine)].join("|");
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  const exact = new Map<string, Row[]>();
  const loose = new Map<string, Row[]>();
  for (const p of projections) {
    const d = isoDate(p.Date || p["Game Date"]);
    const player = key(p.Player || p["Player Name"]);
    const market = key(p.Market);
    const side = projectionSide(p);
    const line = txt(p["Market Line"]);
    const ek = [d,player,market,side,line].join("|");
    const lk = [d,player,market].join("|");
    (exact.get(ek) || exact.set(ek,[]).get(ek)!).push(p);
    (loose.get(lk) || loose.set(lk,[]).get(lk)!).push(p);
  }

  const joined: Joined[] = [];
  const unmatched: Array<Record<string,string>> = [];
  for (const h of completed) {
    const d = parseDetails(h);
    const date = isoDate(h.Date || d.date);
    const playerRaw = txt(h.Player || h["Player Name"] || d.playerName);
    const marketRaw = txt(h["Prop Market"] || d.propMarket);
    const sideRaw = txt(h["Prop Side"] || d.propSide).toLowerCase();
    const lineRaw = txt(h["Prop Line"] || d.propLine);
    const ek = [date,key(playerRaw),key(marketRaw),key(sideRaw),lineRaw].join("|");
    const lk = [date,key(playerRaw),key(marketRaw)].join("|");
    let candidates = exact.get(ek) || [];
    let joinType = "exact";
    if (!candidates.length) { candidates = loose.get(lk) || []; joinType = "loose"; }
    if (candidates.length > 1 && sideRaw) {
      const sideMatches = candidates.filter(p => projectionSide(p) === key(sideRaw));
      if (sideMatches.length) candidates = sideMatches;
    }
    let p = candidates.find(x => num(x["Role Confidence"]) !== null) || candidates[0];
    if (!p || num(p["Role Confidence"]) === null) {
      unmatched.push({ date, player: playerRaw, market: marketRaw, side: sideRaw, line: lineRaw, result: result(h.Result) });
      continue;
    }
    joined.push({
      ...h,
      _date: date,
      _player: playerRaw,
      _market: marketRaw,
      _side: sideRaw || projectionSide(p),
      _line: lineRaw,
      _tier: txt(d.tier || h.Tier || h["Prop Tier"]),
      _roleConfidence: txt(p["Role Confidence"]),
      _reliability: txt(p.Reliability),
      _grade: txt(p.Grade),
      _modelVersion: txt(p["Model Version"]),
      _position: txt(p.Position),
      _slot: txt(p.Slot),
      _join: joinType,
    });
  }

  return NextResponse.json({
    ok: true,
    source: "NFL ezpz_pick_history joined to prop_projections",
    totals: {
      historyRows: history.length,
      savedPlayerProps: saved.length,
      completedDedupedSavedProps: completed.length,
      joinedWithRoleConfidence: joined.length,
      unmatched: unmatched.length,
      exactJoins: joined.filter(r=>r._join === "exact").length,
      looseJoins: joined.filter(r=>r._join === "loose").length,
    },
    overall: summary(joined),
    winners: summary(joined.filter(r=>result(r.Result)==="W")),
    losers: summary(joined.filter(r=>result(r.Result)==="L")),
    cutoffs: cutoffs(joined),
    bands: bands(joined),
    byMarket: grouped(joined, r=>r._market),
    byMarketSide: grouped(joined, r=>`${r._market} | ${r._side}`),
    byTier: grouped(joined, r=>r._tier),
    byPosition: grouped(joined, r=>r._position),
    byModelVersion: grouped(joined, r=>r._modelVersion),
    byDate: grouped(joined, r=>r._date),
    unmatched: unmatched.slice(0,50),
    rows: joined.map(r=>({ date:r._date, player:r._player, market:r._market, side:r._side, line:r._line, result:result(r.Result), tier:r._tier, roleConfidence:r._roleConfidence, reliability:r._reliability, grade:r._grade, modelVersion:r._modelVersion, position:r._position, slot:r._slot, join:r._join })),
  }, { headers: { "Cache-Control":"no-store, max-age=0" } });
}
