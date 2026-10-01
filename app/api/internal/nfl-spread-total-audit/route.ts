import { NextResponse } from "next/server";
import { readSportWorksheet } from "../../../../lib/sportSheets";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Row = Record<string, string>;
type Game = {
  date: string;
  week: number;
  gameId: string;
  game: string;
  away: string;
  home: string;
  projectedAway: number;
  projectedHome: number;
  projectedMargin: number;
  projectedTotal: number;
  marketHomeSpread: number | null;
  marketTotal: number | null;
  spreadPick: string;
  spreadProbability: number | null;
  spreadEdgeSaved: number | null;
  spreadGrade: string;
  spreadConfluence: string;
  totalPick: string;
  totalProbability: number | null;
  totalEdgeSaved: number | null;
  totalGrade: string;
  totalConfluence: string;
  reliability: number | null;
  dataConfidence: number | null;
  personnelConfidence: number | null;
  weatherAdjustment: number | null;
  modelVersion: string;
  actualAway: number;
  actualHome: number;
  actualMargin: number;
  actualTotal: number;
};

const txt = (v: unknown) => String(v ?? "").trim();
const num = (v: unknown): number | null => {
  const n = Number(txt(v));
  return Number.isFinite(n) ? n : null;
};
const mean = (x: number[]) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : null);
const rnd = (x: number | null, d = 3) => (x == null ? null : Number(x.toFixed(d)));
const keyTeam = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const dateKey = (s: string) => txt(s).slice(0, 10);

function slateKey(r: Row) {
  const id = txt(r["Game ID"]);
  if (id) return `id:${id}`;
  return `${dateKey(r.Date)}|${keyTeam(txt(r["Away Team"]))}|${keyTeam(txt(r["Home Team"]))}`;
}
function schedKeys(r: Row) {
  const out: string[] = [];
  const id = txt(r["Game ID"]);
  if (id) out.push(`id:${id}`);
  out.push(`${dateKey(r["Game Date"])}|${keyTeam(txt(r["Away Team"]))}|${keyTeam(txt(r["Home Team"]))}`);
  return out;
}

function metrics(games: Game[]) {
  const marginErr = games.map(g => g.projectedMargin - g.actualMargin);
  const totalErr = games.map(g => g.projectedTotal - g.actualTotal);
  const marketMargin = games.filter(g => g.marketHomeSpread != null);
  const marketTotal = games.filter(g => g.marketTotal != null);
  return {
    n: games.length,
    margin: {
      mae: rnd(mean(marginErr.map(Math.abs))),
      rmse: rnd(Math.sqrt(mean(marginErr.map(x => x * x)) ?? 0)),
      bias: rnd(mean(marginErr)),
      modelMean: rnd(mean(games.map(g => g.projectedMargin))),
      actualMean: rnd(mean(games.map(g => g.actualMargin))),
      marketMae: rnd(mean(marketMargin.map(g => Math.abs((-Number(g.marketHomeSpread)) - g.actualMargin))), 3),
    },
    total: {
      mae: rnd(mean(totalErr.map(Math.abs))),
      rmse: rnd(Math.sqrt(mean(totalErr.map(x => x * x)) ?? 0)),
      bias: rnd(mean(totalErr)),
      modelMean: rnd(mean(games.map(g => g.projectedTotal))),
      actualMean: rnd(mean(games.map(g => g.actualTotal))),
      marketMae: rnd(mean(marketTotal.map(g => Math.abs(Number(g.marketTotal) - g.actualTotal))), 3),
    },
  };
}

function edgeRecord(games: Game[], kind: "spread" | "total", threshold: number) {
  let n = 0, wins = 0, losses = 0, pushes = 0;
  const rows: Array<Record<string, unknown>> = [];
  for (const g of games) {
    if (kind === "spread") {
      if (g.marketHomeSpread == null) continue;
      const modelEdge = g.projectedMargin + g.marketHomeSpread;
      if (Math.abs(modelEdge) < threshold) continue;
      const actualCover = g.actualMargin + g.marketHomeSpread;
      const pickHome = modelEdge > 0;
      const signed = pickHome ? actualCover : -actualCover;
      n++;
      if (Math.abs(signed) < 1e-9) pushes++; else if (signed > 0) wins++; else losses++;
      rows.push({date:g.date,week:g.week,game:g.game,edge:rnd(modelEdge),pick:pickHome?g.home:g.away,market:g.marketHomeSpread,projection:rnd(g.projectedMargin),actual:rnd(g.actualMargin),result:signed>0?"W":signed<0?"L":"P"});
    } else {
      if (g.marketTotal == null) continue;
      const modelEdge = g.projectedTotal - g.marketTotal;
      if (Math.abs(modelEdge) < threshold) continue;
      const actualEdge = g.actualTotal - g.marketTotal;
      const pickOver = modelEdge > 0;
      const signed = pickOver ? actualEdge : -actualEdge;
      n++;
      if (Math.abs(signed) < 1e-9) pushes++; else if (signed > 0) wins++; else losses++;
      rows.push({date:g.date,week:g.week,game:g.game,edge:rnd(modelEdge),pick:pickOver?"Over":"Under",market:g.marketTotal,projection:rnd(g.projectedTotal),actual:rnd(g.actualTotal),result:signed>0?"W":signed<0?"L":"P"});
    }
  }
  return {threshold,n,wins,losses,pushes,winRate: rnd(wins + losses ? wins/(wins+losses) : null), rows};
}

function group(games: Game[], fn: (g: Game) => string) {
  const m = new Map<string, Game[]>();
  for (const g of games) { const k = fn(g); if (!m.has(k)) m.set(k, []); m.get(k)!.push(g); }
  return [...m.entries()].map(([key, rows]) => ({key, ...metrics(rows)}));
}

function bestBiasCorrection(games: Game[], kind: "margin"|"total") {
  if (!games.length) return null;
  const errors = games.map(g => (kind === "margin" ? g.projectedMargin - g.actualMargin : g.projectedTotal - g.actualTotal));
  const correction = -(mean(errors) ?? 0);
  const current = mean(errors.map(Math.abs)) ?? 0;
  const adjusted = mean(games.map(g => Math.abs((kind === "margin" ? g.projectedMargin : g.projectedTotal) + correction - (kind === "margin" ? g.actualMargin : g.actualTotal)))) ?? 0;
  return {correction:rnd(correction),currentMae:rnd(current),adjustedMae:rnd(adjusted)};
}

function bestMarketBlend(games: Game[], kind: "margin"|"total") {
  const eligible = games.filter(g => kind === "margin" ? g.marketHomeSpread != null : g.marketTotal != null);
  let best: any = null;
  for (let w = 0; w <= 1.0001; w += 0.05) {
    const errs = eligible.map(g => {
      const model = kind === "margin" ? g.projectedMargin : g.projectedTotal;
      const market = kind === "margin" ? -Number(g.marketHomeSpread) : Number(g.marketTotal);
      const actual = kind === "margin" ? g.actualMargin : g.actualTotal;
      const p = w * model + (1-w) * market;
      return Math.abs(p-actual);
    });
    const mae = mean(errs) ?? 999;
    if (!best || mae < best.mae) best = {modelWeight:rnd(w,2),marketWeight:rnd(1-w,2),mae:rnd(mae)};
  }
  return best;
}

export async function GET() {
  const [slate, schedule] = await Promise.all([
    readSportWorksheet("NFL", "daily_slate") as Promise<Row[]>,
    readSportWorksheet("NFL", "schedule") as Promise<Row[]>,
  ]);

  const actualMap = new Map<string, {away:number;home:number}>();
  for (const r of schedule) {
    const a = num(r["Away Score"]), h = num(r["Home Score"]);
    if (a == null || h == null) continue;
    for (const k of schedKeys(r)) actualMap.set(k, {away:a, home:h});
  }

  const dedup = new Map<string, Row>();
  for (const r of slate) dedup.set(slateKey(r), r);
  const games: Game[] = [];
  for (const r of dedup.values()) {
    const actual = actualMap.get(slateKey(r)) || actualMap.get(`${dateKey(r.Date)}|${keyTeam(txt(r["Away Team"]))}|${keyTeam(txt(r["Home Team"]))}`);
    if (!actual) continue;
    const pa = num(r["Projected Away"]), ph = num(r["Projected Home"]), pm = num(r["Projected Margin"]), pt = num(r["Projected Total"]);
    if (pa == null || ph == null || pm == null || pt == null) continue;
    games.push({
      date: dateKey(r.Date), week: num(r.Week) ?? 0, gameId:txt(r["Game ID"]), game:txt(r.Game),
      away:txt(r["Away Team"]), home:txt(r["Home Team"]), projectedAway:pa, projectedHome:ph,
      projectedMargin:pm, projectedTotal:pt, marketHomeSpread:num(r["Market Home Spread"]), marketTotal:num(r["Market Total"]),
      spreadPick:txt(r["Spread Pick"]), spreadProbability:num(r["Spread Probability"]), spreadEdgeSaved:num(r["Spread Edge"]), spreadGrade:txt(r["Spread Grade"]), spreadConfluence:txt(r["Spread Confluence"]),
      totalPick:txt(r["Total Pick"]), totalProbability:num(r["Total Probability"]), totalEdgeSaved:num(r["Total Edge"]), totalGrade:txt(r["Total Grade"]), totalConfluence:txt(r["Total Confluence"]),
      reliability:num(r.Reliability), dataConfidence:num(r["Data Confidence"]), personnelConfidence:num(r["Personnel Confidence"]), weatherAdjustment:num(r["Weather Adjustment"]), modelVersion:txt(r["Model Version"]),
      actualAway:actual.away, actualHome:actual.home, actualMargin:actual.home-actual.away, actualTotal:actual.home+actual.away,
    });
  }
  games.sort((a,b)=>a.date.localeCompare(b.date)||a.game.localeCompare(b.game));
  const dates=[...new Set(games.map(g=>g.date))].sort();
  const holdoutDate=dates.at(-1) ?? "";
  const pre=games.filter(g=>g.date<holdoutDate), hold=games.filter(g=>g.date===holdoutDate);

  const versions:Record<string,number>={}; for(const g of games) versions[g.modelVersion]=(versions[g.modelVersion]??0)+1;
  const spreadThresholds=[0,1,1.5,2,2.5,3,3.5,4,5,6,7].map(x=>edgeRecord(games,"spread",x));
  const totalThresholds=[0,1,1.75,2,2.5,3,3.5,4,5,6,7].map(x=>edgeRecord(games,"total",x));
  const spreadPre=[0,1.5,2.5,3.5,5].map(x=>edgeRecord(pre,"spread",x));
  const spreadHold=[0,1.5,2.5,3.5,5].map(x=>edgeRecord(hold,"spread",x));
  const totalPre=[0,1.75,3,4,5].map(x=>edgeRecord(pre,"total",x));
  const totalHold=[0,1.75,3,4,5].map(x=>edgeRecord(hold,"total",x));

  const favorite = games.filter(g=>g.marketHomeSpread!=null && Number(g.marketHomeSpread)<0);
  const homeDog = games.filter(g=>g.marketHomeSpread!=null && Number(g.marketHomeSpread)>0);
  const highTotal = games.filter(g=>g.marketTotal!=null && Number(g.marketTotal)>=47);
  const lowTotal = games.filter(g=>g.marketTotal!=null && Number(g.marketTotal)<=42);

  return NextResponse.json({
    source:{slateRows:slate.length,scheduleRows:schedule.length,dedupedSlate:dedup.size,completedMatched:games.length,dates,holdoutDate,versions},
    overall:metrics(games), development:metrics(pre), holdout:metrics(hold),
    byDate:group(games,g=>g.date), byWeek:group(games,g=>String(g.week)),
    bands:{homeFavorite:metrics(favorite),homeDog:metrics(homeDog),marketTotal47Plus:metrics(highTotal),marketTotal42OrLess:metrics(lowTotal)},
    spread:{all:spreadThresholds,development:spreadPre,holdout:spreadHold},
    total:{all:totalThresholds,development:totalPre,holdout:totalHold},
    developmentCalibrations:{marginBias:bestBiasCorrection(pre,"margin"),totalBias:bestBiasCorrection(pre,"total"),marginMarketBlend:bestMarketBlend(pre,"margin"),totalMarketBlend:bestMarketBlend(pre,"total")},
    holdoutRows:hold,
  });
}
