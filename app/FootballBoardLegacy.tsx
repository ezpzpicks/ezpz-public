"use client";

import { useMemo, useState } from "react";
import FootballBoardBase from "./FootballBoardBase";
import FootballGameTabs from "./FootballGameTabs";
import { DirectTrendRecords } from "./FootballTrendMarketBoard";
import { MatchupWithLogos, SelectionWithTeamLogo, TeamLogoName } from "./TeamLogoName";

type Tab = "Today’s Model Plays" | "Today’s Trend Plays" | "EZPZ Picks" | "Full Slate" | "Records";
type Sport = "NFL" | "NCAAF";
type FormStatus = "HOT" | "COLD" | "NEUTRAL" | "SAMPLE";
type SheetRow = Record<string, string>;
type RecordTotals = {
  label?: string;
  record: string;
  totalBets: number;
  winPct: number;
  unitsWon: number;
  roiPct: number;
  wins: number;
  losses: number;
  pushes: number;
};
type Summary = RecordTotals & { betType: string; status?: "WINNING" | "EVEN" | "LOSING" };

type NflPlay = {
  playType?: string;
  game?: string;
  play?: string;
  oddsLine?: string;
  marketOdds?: string;
  score?: string | number;
  reliability?: string | number;
  role?: string;
  playerName?: string;
  playerTeam?: string;
  propMarket?: string;
  propSide?: string;
  propLine?: string | number;
  propProjection?: string | number;
  headshotUrl?: string;
  formStatus?: FormStatus;
  formRecord?: string;
  formTotalBets?: number;
  formType?: string;
};

type NflEzpzPick = {
  source: "Best Play" | "Trend Play" | "Best + Trend";
  game: string;
  market: "Spread" | "Total" | "Player Prop";
  selection: string;
  odds?: string;
  score?: number;
  tier?: string;
  qualification?: string;
  record?: string;
  formStatus?: FormStatus;
  formType?: string;
  headshotUrl?: string;
  playerName?: string;
  playerTeam?: string;
  propMarket?: string;
  propSide?: string;
  propLine?: string | number;
  propProjection?: string | number;
  gapPct?: number;
  modelGapPct?: number;
  predictedWinPct?: number;
  impliedProbabilityPct?: number;
  trendModelVersion?: string;
  snapshotStatus?: string;
};

type FootballData = {
  today?: string;
  lastUpdated?: string;
  bestPlays?: NflPlay[];
  aiPicks?: NflEzpzPick[];
  aiPickRecordRows?: any[];
  aiSelectorStatus?: { message?: string };
  betTrackerRows?: SheetRow[];
  trendRecordRows?: SheetRow[];
  trendPlays?: any[];
  recordSummary?: Summary[];
  last7RecordSummary?: Summary[];
  database?: string;
  tiles?: {
    last7Days?: RecordTotals;
    overallGreen?: RecordTotals;
  };
};

function pct(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const p = Math.abs(n) <= 1 ? n * 100 : n;
  return `${p.toFixed(1)}%`;
}
function displayOdds(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "—";
  const signed = raw.replace(/−/g, "-").match(/[+-]\d{3,4}/)?.[0];
  return signed || raw;
}
function PlayerHeadshot({ play, compact = false }: { play: NflPlay | NflEzpzPick; compact?: boolean }) {
  const name = String(play.playerName || "").trim();
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "NFL";
  return (
    <div className={`nflHeadshot ${compact ? "compact" : ""}`}>
      <span>{initials}</span>
      {play.headshotUrl ? (
        <img src={play.headshotUrl} alt={`${name} headshot`} loading="lazy" onError={(event) => { event.currentTarget.style.display = "none"; }} />
      ) : null}
    </div>
  );
}
function ezpzTextKey(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/−/g, "-")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function ezpzPickIsFinal(pick: NflEzpzPick, data: FootballData) {
  if (pick.source !== "Trend Play") return true;
  if (String(pick.snapshotStatus || "").toUpperCase() === "FINAL_PREGAME") return true;
  const trendPlays = (data as FootballData & { trendPlays?: Array<Record<string, unknown>> }).trendPlays || [];
  const pickGame = ezpzTextKey(pick.game);
  const pickMarket = ezpzTextKey(pick.market);
  const pickSide = ezpzTextKey(pick.selection).startsWith("under") ? "under" : ezpzTextKey(pick.selection).startsWith("over") ? "over" : "";
  const pickTeam = ezpzTextKey(String(pick.selection || "").replace(/\s+[+-]?\d+(?:\.\d+)?\s*$/, ""));
  const match = trendPlays.find((play) => {
    if (ezpzTextKey(play.game) !== pickGame || ezpzTextKey(play.market) !== pickMarket) return false;
    if (pickMarket === "total") return ezpzTextKey(play.side || play.selection) === pickSide;
    const trendTeam = ezpzTextKey(play.selectionTeam || play.selection);
    return Boolean(pickTeam && trendTeam && (pickTeam === trendTeam || pickTeam.includes(trendTeam) || trendTeam.includes(pickTeam)));
  });
  return String(match?.snapshotStatus || "").toUpperCase() === "FINAL_PREGAME";
}
function FootballEzpzCard({ pick, sport, data }: { pick: NflEzpzPick; sport: Sport; data: FootballData }) {
  const isProp = pick.market === "Player Prop" || Boolean(pick.playerName);
  const final = ezpzPickIsFinal(pick, data);
  const propPick = [String(pick.propSide || "").trim(), String(pick.propLine ?? "").trim()].filter(Boolean).join(" ") || pick.selection;
  return (
    <article className={`nflEzpzCard ${isProp ? "prop" : ""}`}>
      <div className="nflEzpzTop"><div className="nflEzpzBadges"><span className={`nflStatusBadge ${final ? "final" : "pending"}`}>{final ? "FINAL" : "PENDING"}</span></div><strong className="nflEzpzOdds">{displayOdds(pick.odds)}</strong></div>
      {isProp ? (
        <>
          <div className="nflPlayerHero compactHero"><PlayerHeadshot play={pick} compact /><div><span className="nflEyebrow"><TeamLogoName sport="NFL" team={pick.playerTeam || ""} text={pick.playerTeam || "NFL"} compact /> • {pick.propMarket || "Player Prop"}</span><h3>{pick.playerName || pick.selection}</h3><p><MatchupWithLogos sport="NFL" game={pick.game || ""} compact /></p></div></div>
          <div className="nflPropPickLine"><span>Pick</span><strong>{propPick}</strong></div>
        </>
      ) : (
        <div className="nflEzpzSelection"><span><MatchupWithLogos sport={sport} game={pick.game || ""} compact /></span><h3><SelectionWithTeamLogo sport={sport} selection={pick.selection || ""} game={pick.game || ""} /></h3><p>{pick.market}</p></div>
      )}
    </article>
  );
}
function FootballEzpzPicks({ sport, data }: { sport: Sport; data: FootballData }) {
  const picks = data.aiPicks || [];
  return (
    <section className="nflOptimizedSection">
      <div className="nflOptimizedHead"><div><h2>{sport} EZPZ Picks</h2></div><span>{picks.length} picks</span></div>
      {picks.length ? <div className="nflEzpzStack">{picks.map((pick, index) => <FootballEzpzCard key={`${pick.game}-${pick.market}-${pick.selection}-${index}`} pick={pick} sport={sport} data={data} />)}</div> : <div className="nflOptimizedEmpty">No {sport} EZPZ Picks right now.</div>}
    </section>
  );
}

function fallbackTotals(): RecordTotals {
  return { record: "0-0-0", totalBets: 0, winPct: 0, unitsWon: 0, roiPct: 0, wins: 0, losses: 0, pushes: 0 };
}
function recordTone(row: Pick<RecordTotals, "wins" | "losses" | "totalBets">) {
  if (!row.totalBets) return "neutral";
  if (row.wins > row.losses) return "green";
  if (row.losses > row.wins) return "red";
  return "yellow";
}
function recordStatus(row: Pick<RecordTotals, "wins" | "losses" | "totalBets">) {
  if (!row.totalBets) return "NO RESULTS";
  if (row.wins > row.losses) return "WINNING";
  if (row.losses > row.wins) return "LOSING";
  return "EVEN";
}
function RecordTile({ label, value }: { label: string; value?: RecordTotals }) {
  const row = value || fallbackTotals();
  const tone = recordTone(row);
  return (
    <div className={`card footballCanonicalRecordTile ${tone}`}>
      <div className="footballRecordTileTop"><span>{label}</span><b className={`footballRecordStatus ${tone}`}>{recordStatus(row)}</b></div>
      <strong>{row.record}</strong>
      <small>{row.totalBets} bets • {row.winPct.toFixed(1)}% • {row.unitsWon > 0 ? "+" : ""}{row.unitsWon.toFixed(2)}u • ROI {row.roiPct > 0 ? "+" : ""}{row.roiPct.toFixed(1)}%</small>
    </div>
  );
}
function RecordTable({ rows }: { rows: Summary[] }) {
  return (
    <div className="tableWrap"><table className="recordsTable"><thead><tr><th>Model subset</th><th>Status</th><th>Record</th><th>Win %</th><th>Units</th><th>ROI</th><th>Bets</th></tr></thead><tbody>
      {rows.map((row) => {
        const tone = recordTone(row);
        return <tr key={row.betType} className={`footballCanonicalRecordRow ${tone}`}><td><strong>{row.betType}</strong></td><td><span className={`footballRecordStatus ${tone}`}>{row.status || recordStatus(row)}</span></td><td><b>{row.record}</b></td><td><span className={`footballRecordWinPct ${tone}`}>{row.winPct.toFixed(1)}%</span></td><td>{row.unitsWon > 0 ? "+" : ""}{row.unitsWon.toFixed(2)}u</td><td>{row.roiPct > 0 ? "+" : ""}{row.roiPct.toFixed(1)}%</td><td>{row.totalBets}</td></tr>;
      })}
    </tbody></table></div>
  );
}
function RecordDropdown({ title, subtitle, rows, open = false }: { title: string; subtitle: string; rows: Summary[]; open?: boolean }) {
  return <details className="recordsDropdown" open={open || undefined}><summary className="recordsSummary"><div><div className="recordsSummaryTitle">{title}</div><div className="recordsSummarySub">{subtitle}</div></div><span className="recordsCount">{rows.reduce((sum, row) => sum + row.totalBets, 0)} bets</span></summary>{rows.length ? <RecordTable rows={rows} /> : <div className="empty insideDropdown">No completed results yet.</div>}</details>;
}
function resultCode(value: unknown) {
  const key = String(value || "").trim().toUpperCase();
  if (["W", "WIN", "WON"].includes(key)) return "W";
  if (["L", "LOSS", "LOST"].includes(key)) return "L";
  if (["P", "PUSH"].includes(key)) return "P";
  return "";
}
function rowAmericanOdds(row: SheetRow) {
  const side = ezpzTextKey(row.Pick || row.Side || row.Selection || "");
  const sideOdds = side.startsWith("under") ? row["Under Odds"] : row["Over Odds"];
  for (const value of [row["Pick Odds"], row.Odds, row["Odds/Line"], sideOdds]) {
    const raw = String(value || "").replace(/−/g, "-");
    const signed = raw.match(/[+-]\d{3,4}/)?.[0];
    if (signed) return Number(signed);
    const exact = raw.match(/^\d{3,4}$/)?.[0];
    if (exact) return Number(exact);
  }
  return -110;
}
function recordTotalsFromRows(rows: SheetRow[]): RecordTotals {
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let unitsWon = 0;
  for (const row of rows) {
    const result = resultCode(row.Result || row.Status);
    if (!result) continue;
    const odds = rowAmericanOdds(row);
    if (result === "W") {
      wins += 1;
      unitsWon += odds > 0 ? odds / 100 : 100 / Math.abs(odds || -110);
    } else if (result === "L") {
      losses += 1;
      unitsWon -= 1;
    } else {
      pushes += 1;
    }
  }
  const totalBets = wins + losses + pushes;
  const decisions = wins + losses;
  return {
    record: `${wins}-${losses}-${pushes}`,
    totalBets,
    winPct: decisions ? Math.round((wins / decisions) * 1000) / 10 : 0,
    unitsWon: Math.round(unitsWon * 100) / 100,
    roiPct: totalBets ? Math.round((unitsWon / totalBets) * 1000) / 10 : 0,
    wins,
    losses,
    pushes,
  };
}
function ezpzGradeBucket(row: SheetRow) {
  const grade = ezpzTextKey(row.Grade || row["Model Grade"] || row.Tier || "");
  if (grade === "a" || grade.startsWith("a ")) return "A";
  if (grade === "b" || grade.startsWith("b ")) return "B";
  return "";
}
function ezpzMarketLine(value: unknown) {
  const matches = String(value || "").replace(/[−–—]/g, "-").match(/[+-]?\d+(?:\.\d+)?/g) || [];
  for (const raw of [...matches].reverse()) {
    const line = Number(raw);
    if (Number.isFinite(line) && Math.abs(line) <= 60) return line;
  }
  return null;
}
function ezpzSide(value: unknown) {
  const key = ezpzTextKey(value);
  if (key.startsWith("under")) return "Under";
  if (key.startsWith("over")) return "Over";
  return "";
}
function ezpzModelRecordType(row: SheetRow, sport: Sport) {
  const grade = ezpzGradeBucket(row);
  if (!grade) return "";
  if (sport === "NFL" && isNflPlayerPropRow(row)) {
    const market = ezpzTextKey(row.Market || row["Bet Type"] || "Player Prop");
    const side = ezpzSide(row.Pick || row.Side || row.Selection);
    return market && side ? `${grade}|PROP|${market}|${side}` : "";
  }
  const market = ezpzTextKey(row["Bet Type"] || row.Market);
  if (market.includes("total")) {
    const side = ezpzSide(row.Selection || row.Side || row.Pick);
    return side ? `${grade}|TOTAL|${side}` : "";
  }
  if (market.includes("spread")) {
    const line = ezpzMarketLine(row.Selection) ?? ezpzMarketLine(row.Line) ?? ezpzMarketLine(row["Odds/Line"]);
    if (line == null || Math.abs(line) < 1e-9) return "";
    return `${grade}|SPREAD|${line < 0 ? "Favorite" : "Underdog"}`;
  }
  return "";
}
function ezpzModelHistoryRows(rows: SheetRow[], sport: Sport) {
  const settled = rows
    .map((row, index) => ({ row, index, date: signalIsoDate(row.Date || row["Game Date"] || ""), type: ezpzModelRecordType(row, sport) }))
    .filter((item) => Boolean(item.date && item.type && resultCode(item.row.Result || item.row.Status)))
    .sort((a, b) => a.date.localeCompare(b.date) || a.index - b.index);
  const dates = [...new Set(settled.map((item) => item.date))];
  const priorByType = new Map<string, SheetRow[]>();
  const picks: SheetRow[] = [];
  for (const date of dates) {
    const day = settled.filter((item) => item.date === date);
    for (const item of day) {
      const prior = priorByType.get(item.type) || [];
      const lastSeven = prior.slice(-7);
      const form = recordTotalsFromRows(lastSeven);
      if (form.totalBets === 7 && form.wins >= 5 && rowAmericanOdds(item.row) >= -150) picks.push(item.row);
    }
    for (const item of day) {
      const prior = priorByType.get(item.type) || [];
      prior.push(item.row);
      priorByType.set(item.type, prior);
    }
  }
  return picks;
}
function ezpzTrendDetails(row: SheetRow): Record<string, any> | null {
  const raw = String(row["Trend Score Details"] || "").trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
function ezpzTrendSignalRoi(signal: Record<string, any>) {
  const records = signal?.records;
  if (!records?.allTime || !records?.last30 || !records?.last7) return null;
  const last7Decisions = Number(records.last7.wins || 0) + Number(records.last7.losses || 0);
  const last7Weight = Math.min(0.5, Math.max(0, last7Decisions) * 0.1);
  const carry = (0.5 - last7Weight) / 2;
  const windows = [
    { row: records.allTime, weight: 0.25 + carry },
    { row: records.last30, weight: 0.25 + carry },
    { row: records.last7, weight: last7Weight },
  ].filter((item) => Number(item.row.totalBets || 0) > 0 && item.weight > 0);
  if (!windows.length) return null;
  const totalWeight = windows.reduce((sum, item) => sum + item.weight, 0);
  return windows.reduce((sum, item) => sum + Number(item.row.roiPct || 0) * item.weight, 0) / totalWeight;
}
function ezpzTrendRoi(details: Record<string, any> | null) {
  const signals = Array.isArray(details?.signals) ? details.signals as Array<Record<string, any>> : [];
  const values = signals.map(ezpzTrendSignalRoi).filter((value): value is number => value != null && Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}
function ezpzCfbTrendHistoryRows(rows: SheetRow[]) {
  const settled = rows
    .map((row, index) => ({ row, index, details: ezpzTrendDetails(row) }))
    .filter((item) => Boolean(resultCode(item.row.Result || item.row.Status)) && ezpzTextKey(item.row["Trend Play"]) !== "false")
    .map((item) => ({
      ...item,
      date: signalIsoDate(item.row.Date || item.row["Game Date"] || ""),
      game: ezpzTextKey(item.row.Game || item.row["Game Key"] || ""),
      market: ezpzTextKey(item.row.Market || item.details?.market || ""),
      selection: ezpzTextKey(item.row.Selection || item.row.Side || item.details?.selection || item.details?.side || ""),
      tier: String(item.details?.tier || item.row["Trend Tier"] || ""),
      score: Number(item.details?.score ?? item.row["Trend Score"] ?? 0),
      sample: Number(item.details?.TrendSampleSize ?? item.row["Trend Sample Size"] ?? 0),
      roi: ezpzTrendRoi(item.details),
    }))
    .filter((item) => Boolean(item.date && item.game && item.market));
  const qualified: typeof settled = [];
  for (const item of settled) {
    if (item.tier !== "Strong" && item.tier !== "Elite") continue;
    if (item.sample < 8 || item.roi == null || item.roi <= 0 || rowAmericanOdds(item.row) < -150) continue;
    const signals = Array.isArray(item.details?.signals) ? item.details.signals as Array<Record<string, any>> : [];
    if (!signals.length || !signals.every((signal) => Number(signal?.records?.allTime?.wins || 0) > Number(signal?.records?.allTime?.losses || 0))) continue;
    const peers = settled.filter((peer) => peer.date === item.date && peer.game === item.game && peer.market === item.market);
    const maxScore = Math.max(...peers.map((peer) => Number(peer.score || 0)));
    if (Number(item.score || 0) + 1e-9 < maxScore) continue;
    const opponents = peers.filter((peer) => peer.selection !== item.selection && peer.roi != null).map((peer) => Number(peer.roi));
    if (!opponents.length) continue;
    const opposingRoi = Math.max(...opponents);
    if (item.roi - opposingRoi < 25) continue;
    qualified.push(item);
  }
  const byGame = new Map<string, (typeof qualified)[number]>();
  for (const item of qualified.sort((a, b) => b.score - a.score || a.index - b.index)) {
    const key = `${item.date}|${item.game}`;
    if (!byGame.has(key)) byGame.set(key, item);
  }
  return [...byGame.values()].map((item) => item.row);
}
function ezpzHistoryKey(row: SheetRow) {
  const date = signalIsoDate(row.Date || row["Game Date"] || "");
  const game = ezpzTextKey(row.Game || row["Game Key"] || "");
  const market = ezpzTextKey(row.Market || row["Bet Type"] || "");
  if (String(row.Player || "").trim()) {
    const player = ezpzTextKey(row.Player);
    const propMarket = ezpzTextKey(row.Market || row["Bet Type"]);
    const side = ezpzTextKey(ezpzSide(row.Pick || row.Side || row.Selection));
    const line = String(row["Market Line"] || row.Line || row["Prop Line"] || "").trim();
    return `${date}|${game}|prop|${player}|${propMarket}|${side}|${line}`;
  }
  if (market.includes("total")) return `${date}|${game}|total|${ezpzTextKey(ezpzSide(row.Selection || row.Side || row.Pick))}`;
  const team = ezpzTextKey(String(row.Selection || row.Pick || "").replace(/\s+[+-]?\d+(?:\.\d+)?\s*$/, ""));
  return `${date}|${game}|spread|${team}`;
}
function footballEzpzHistoryRows(data: FootballData, sport: Sport) {
  const modelRows = ezpzModelHistoryRows(data.betTrackerRows || [], sport);
  const trendRows = sport === "NCAAF" ? ezpzCfbTrendHistoryRows(data.trendRecordRows || []) : [];
  const merged = new Map<string, SheetRow>();
  for (const row of [...modelRows, ...trendRows]) {
    const key = ezpzHistoryKey(row);
    if (key && !merged.has(key)) merged.set(key, row);
  }
  return [...merged.values()].sort((a, b) => signalIsoDate(a.Date || a["Game Date"] || "").localeCompare(signalIsoDate(b.Date || b["Game Date"] || "")));
}

function isNflPlayerPropRow(row: SheetRow) {
  return Boolean(String(row.Player || "").trim());
}
function recentLabel(row: SheetRow) {
  const market = String(row["Bet Type"] || row.Market || "Model Play").trim();
  const grade = String(row.Grade || row["Model Grade"] || "").trim();
  return [grade, market].filter(Boolean).join(" • ");
}
function recentSelection(row: SheetRow) {
  const direct = String(row.Selection || row.Pick || "").trim();
  if (direct) return direct;
  const player = String(row.Player || "").trim();
  const side = String(row.Side || "").trim();
  const line = String(row["Market Line"] || row.Line || row["Prop Line"] || "").trim();
  return [player, side, line].filter(Boolean).join(" ");
}
function recentGame(row: SheetRow) {
  const game = String(row.Game || "").trim();
  if (game) return game;
  const team = String(row.Team || "").trim();
  const opponent = String(row.Opponent || "").trim();
  return [team, opponent].filter(Boolean).join(" vs ") || "—";
}

function signalIsoDate(value: unknown) {
  const raw = String(value || "").trim();
  const iso = raw.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const us = raw.match(/(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?/);
  if (!us) return "";
  const year = us[3] || String(new Date().getFullYear());
  return `${year}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
}
function signalDateWithin(date: unknown, today: string, days: number) {
  if (!days) return true;
  const rowDate = signalIsoDate(date);
  const referenceDate = signalIsoDate(today);
  if (!rowDate || !referenceDate) return false;
  const diff = Math.round((Date.parse(`${referenceDate}T12:00:00Z`) - Date.parse(`${rowDate}T12:00:00Z`)) / 86_400_000);
  return Number.isFinite(diff) && diff >= 0 && diff < days;
}
function FootballRecords({ sport, data }: { sport: Sport; data: FootballData }) {
  const overall = data.tiles?.overallGreen || fallbackTotals();
  const last7 = data.tiles?.last7Days || fallbackTotals();
  const overallRows = data.recordSummary || [];
  const last7Rows = data.last7RecordSummary || [];
  const trackerRows = data.betTrackerRows || [];
  const ezpzRows = footballEzpzHistoryRows(data, sport);
  const ezpzOverall = recordTotalsFromRows(ezpzRows);
  const ezpzLast7 = recordTotalsFromRows(ezpzRows.filter((row) => signalDateWithin(row.Date || row["Game Date"] || "", data.today || "", 7)));
  const nflPropRecord = sport === "NFL" ? recordTotalsFromRows(trackerRows.filter(isNflPlayerPropRow)) : null;
  const recent = trackerRows.filter((row) => resultCode(row.Result || row.Status)).sort((a, b) => String(b.Date || b["Game Date"] || "").localeCompare(String(a.Date || a["Game Date"] || ""))).slice(0, 30);
  return (
    <>
      <section className="footballCanonicalRecords">
        <div className="sectionHead"><div><h2>{sport} Model Play Records</h2><p>{sport === "NFL" ? "Official graded NFL game and player-prop Model Plays from the canonical trackers." : "Official graded CFB Model Plays with A/B grade, market, and direction subsets."}</p></div></div>
        <div className="qualifiedGrid">
          <RecordTile label="Model Plays - Last 7 Days" value={last7} />
          <RecordTile label="Model Plays - Running Total" value={overall} />
          {nflPropRecord ? <RecordTile label="NFL Player Props - Running Total" value={nflPropRecord} /> : null}
        </div>
        <div className="sectionHead"><div><h2>{sport} EZPZ Pick Records</h2></div></div>
        <div className="qualifiedGrid">
          <RecordTile label="EZPZ Picks - Last 7 Days" value={ezpzLast7} />
          <RecordTile label="EZPZ Picks - Running Total" value={ezpzOverall} />
        </div>
        <div className="sectionHead"><div><h2>Market Trend Records</h2><p>Only the three active market signals: Public Fade, Strong RLM, and Sharp.</p></div></div>
        <div className="recordsDropdownStack advancedRecordsStack">
          <DirectTrendRecords rows={data.trendRecordRows || []} trendPlays={data.trendPlays || []} aiPickRows={data.aiPickRecordRows || []} today={data.today || ""} sport={sport} />
        </div>
        <div className="sectionHead"><div><h2>Bet Type Records</h2><p>These are the exact subsets used for HOT / COLD / SMALL SAMPLE status.</p></div></div>
        <div className="advancedRecordsStack"><RecordDropdown title="Last 7 Days Model Plays" subtitle={`Exact ${sport} grade / market / direction records`} rows={last7Rows} open /><RecordDropdown title="Overall Model Plays" subtitle={`Running exact ${sport} grade / market / direction records`} rows={overallRows} /></div>
        <details className="recordsDropdown"><summary className="recordsSummary"><div><div className="recordsSummaryTitle">Recent Graded Model Plays</div><div className="recordsSummarySub">Individual graded plays behind the record</div></div><span className="recordsCount">{recent.length} results</span></summary>
          {recent.length ? <div className="tableWrap"><table className="recordsTable"><thead><tr><th>Date</th><th>Game</th><th>Type</th><th>Play</th><th>Result</th></tr></thead><tbody>{recent.map((row, index) => { const result = resultCode(row.Result || row.Status); return <tr className={`footballRecentResult result-${result.toLowerCase()}`} key={`${row.Date}-${recentGame(row)}-${recentSelection(row)}-${index}`}><td>{row.Date || row["Game Date"]}</td><td>{recentGame(row)}</td><td>{recentLabel(row)}</td><td><strong>{recentSelection(row)}</strong></td><td><b>{result}</b></td></tr>; })}</tbody></table></div> : <div className="empty insideDropdown">Completed Model Plays will populate here automatically.</div>}
        </details>
        <div className="card footballCanonicalInfo"><b>Record grading database:</b> {data.database || `${sport} Model Database`}<br />Model Plays and the active Public Fade, Strong RLM, and Sharp records are graded only after a completed game has a verified final result.</div>
      </section>
      <style jsx global>{`
        .footballCanonicalRecords{display:grid;gap:18px}.footballCanonicalRecordTile{display:grid;gap:7px;transition:border-color .2s ease,box-shadow .2s ease}.footballRecordTileTop{display:flex;align-items:center;justify-content:space-between;gap:10px}.footballRecordTileTop>span{color:var(--ez-muted);font-size:.75rem;font-weight:850}.footballCanonicalRecordTile>strong{font-size:1.75rem;letter-spacing:-.035em}.footballCanonicalRecordTile>small{color:var(--ez-muted);font-size:.72rem}.footballCanonicalRecordTile.green{border-color:rgba(43,216,117,.42);box-shadow:0 0 0 1px rgba(43,216,117,.08),0 0 22px rgba(43,216,117,.09)}.footballCanonicalRecordTile.yellow{border-color:rgba(247,200,92,.38);box-shadow:0 0 0 1px rgba(247,200,92,.06)}.footballCanonicalRecordTile.red{border-color:rgba(255,105,120,.38);box-shadow:0 0 0 1px rgba(255,105,120,.06)}.footballRecordStatus{display:inline-flex;width:max-content;border:1px solid rgba(123,151,190,.18);border-radius:999px;padding:4px 7px;font-size:.62rem;font-weight:950;letter-spacing:.055em}.footballRecordStatus.green{color:#aef2c6;border-color:rgba(43,216,117,.3);background:rgba(28,130,78,.14)}.footballRecordStatus.yellow{color:#ffe29a;border-color:rgba(247,200,92,.28);background:rgba(150,105,20,.14)}.footballRecordStatus.red{color:#ffc0c8;border-color:rgba(255,105,120,.3);background:rgba(145,34,52,.15)}.footballRecordStatus.neutral{color:#c9d8eb;background:rgba(82,105,136,.12)}.footballCanonicalRecordRow.green{background:rgba(43,216,117,.035)}.footballCanonicalRecordRow.yellow{background:rgba(247,200,92,.035)}.footballCanonicalRecordRow.red{background:rgba(255,105,120,.035)}.footballCanonicalRecordRow.green td:first-child{border-left:3px solid rgba(43,216,117,.7)}.footballCanonicalRecordRow.yellow td:first-child{border-left:3px solid rgba(247,200,92,.7)}.footballCanonicalRecordRow.red td:first-child{border-left:3px solid rgba(255,105,120,.7)}.footballRecordWinPct{display:inline-flex;border-radius:999px;padding:4px 7px;font-weight:900}.footballRecordWinPct.green{color:#aef2c6;background:rgba(28,130,78,.14)}.footballRecordWinPct.yellow{color:#ffe29a;background:rgba(150,105,20,.14)}.footballRecordWinPct.red{color:#ffc0c8;background:rgba(145,34,52,.15)}.footballRecentResult.result-w td:last-child{color:#aef2c6}.footballRecentResult.result-l td:last-child{color:#ffc0c8}.footballRecentResult.result-p td:last-child{color:#ffe29a}.footballCanonicalInfo{line-height:1.55}
      `}</style>
    </>
  );
}

export default function FootballBoard({ sport, tab, data }: { sport: Sport; tab: Tab; data: FootballData & Record<string, any> }) {
  if (tab === "Full Slate" || tab === "Today’s Model Plays") {
    return <FootballGameTabs sport={sport} tab={tab} data={data} />;
  }
  if (tab === "Records") return <FootballRecords sport={sport} data={data} />;
  if (tab !== "EZPZ Picks") {
    return <FootballBoardBase sport={sport} tab={tab} data={data as any} />;
  }
  return (
    <>
      <FootballEzpzPicks sport={sport} data={data} />
      <style jsx global>{`
        .nflOptimizedSection{display:grid;gap:18px}.nflOptimizedHead{display:flex;align-items:flex-end;justify-content:space-between;gap:18px}.nflOptimizedHead h2{margin:0 0 5px;font-size:clamp(1.4rem,4vw,2.2rem);letter-spacing:-.04em}.nflOptimizedHead p{margin:0;max-width:800px;color:var(--ez-muted);font-size:.86rem;line-height:1.45}.nflOptimizedHead>span{flex:0 0 auto;border:1px solid var(--ez-border);border-radius:999px;padding:7px 11px;color:var(--ez-muted);font-size:.8rem;font-weight:850}.nflOptimizedGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.nflOptimizedCard,.nflEzpzCard{position:relative;overflow:hidden;border:1px solid rgba(80,132,197,.2);border-radius:24px;padding:18px;background:linear-gradient(145deg,var(--ez-panel),var(--ez-panel-2));box-shadow:0 24px 65px rgba(0,0,0,.24)}.nflOptimizedCard.hotCard{border-color:rgba(43,216,117,.42);box-shadow:0 0 0 1px rgba(43,216,117,.1),0 0 25px rgba(43,216,117,.12),0 24px 65px rgba(0,0,0,.25)}.nflCardTop,.nflEzpzTop{display:flex;align-items:center;justify-content:space-between;gap:12px}.nflRank{display:grid;place-items:center;width:38px;height:38px;border-radius:12px;background:rgba(47,140,255,.12);border:1px solid rgba(47,140,255,.2);font-size:.78rem;font-weight:950}.nflMiniForm,.nflStatusBadge,.nflSourceBadge{display:inline-flex;align-items:center;border-radius:999px;padding:6px 9px;border:1px solid rgba(112,145,186,.2);font-size:.68rem;font-weight:950;letter-spacing:.04em}.nflMiniForm.hot,.nflFormPill.hot,.nflGate.hot{color:#adf4c7;border-color:rgba(43,216,117,.34);background:rgba(28,130,78,.15)}.nflMiniForm.cold,.nflFormPill.cold,.nflGate.cold{color:#b7d7ff;border-color:rgba(94,167,255,.3);background:rgba(50,108,180,.14)}.nflMiniForm.neutral,.nflFormPill.neutral,.nflGate.neutral{color:#d4deeb;background:rgba(100,120,146,.12)}.nflMiniForm.sample,.nflFormPill.sample,.nflGate.sample{color:#f7d98d;border-color:rgba(247,200,92,.26);background:rgba(155,115,30,.13)}.nflPlayerHero{display:grid;grid-template-columns:92px minmax(0,1fr);align-items:center;gap:14px;margin-top:15px}.nflPlayerHero.compactHero{grid-template-columns:72px minmax(0,1fr)}.nflHeadshot{position:relative;display:grid;place-items:center;width:92px;height:92px;overflow:hidden;border:1px solid rgba(94,159,247,.24);border-radius:20px;background:radial-gradient(circle at 50% 30%,rgba(64,146,255,.22),rgba(8,18,34,.88));color:rgba(181,211,246,.7);font-weight:950}.nflHeadshot.compact{width:72px;height:72px;border-radius:17px}.nflHeadshot img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;object-position:center bottom}.nflEyebrow{display:block;color:#78b9ff;font-size:.7rem;font-weight:900;letter-spacing:.06em;text-transform:uppercase}.nflPlayerHero h3,.nflGameHero h3,.nflEzpzSelection h3{margin:4px 0 3px;color:#f5f9ff;font-size:clamp(1.35rem,4vw,2rem);line-height:1.06;letter-spacing:-.035em}.nflPlayerHero p,.nflGameHero p,.nflEzpzSelection p{margin:0;color:var(--ez-muted);font-size:.8rem}.nflGameHero{margin-top:18px}.nflPropPickLine{display:grid;grid-template-columns:auto 1fr auto;align-items:baseline;gap:9px;margin-top:15px;border-radius:16px;padding:12px 14px;background:rgba(47,140,255,.075);border:1px solid rgba(47,140,255,.15)}.nflPropPickLine span{color:#9ccaff;font-size:.8rem;font-weight:950;text-transform:uppercase}.nflPropPickLine strong{font-size:1.7rem;letter-spacing:-.04em}.nflPropPickLine small,.nflGradeLine{color:var(--ez-muted);font-size:.75rem;font-weight:850}.nflGradeLine{margin-top:12px}.nflMetricGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:13px}.nflMetric{min-width:0;border:1px solid rgba(105,140,184,.14);border-radius:14px;padding:10px 11px;background:rgba(8,17,31,.6)}.nflMetric.accent{border-color:rgba(43,216,117,.16);background:rgba(11,38,35,.35)}.nflMetric span{display:block;color:var(--ez-muted);font-size:.62rem;font-weight:850;text-transform:uppercase;letter-spacing:.055em}.nflMetric strong{display:block;margin-top:4px;color:#f1f7ff;font-size:.95rem;overflow-wrap:anywhere}.nflFormPill{display:grid;gap:3px;margin-top:13px;border:1px solid rgba(112,145,186,.2);border-radius:14px;padding:10px 12px}.nflFormPill strong{font-size:.78rem}.nflFormPill span{font-size:.68rem;opacity:.78}.nflRuleHint{margin-top:9px;color:var(--ez-muted);font-size:.67rem;line-height:1.35}.nflOptimizedEmpty{border:1px solid var(--ez-border);border-radius:22px;padding:30px;text-align:center;color:var(--ez-muted);background:linear-gradient(145deg,var(--ez-panel),var(--ez-panel-2))}.nflRulesStrip{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.nflRulesStrip>div{display:grid;gap:3px;border:1px solid rgba(83,127,181,.17);border-radius:15px;padding:11px 12px;background:rgba(8,18,34,.55)}.nflRulesStrip b{font-size:.77rem}.nflRulesStrip span{color:var(--ez-muted);font-size:.67rem;line-height:1.3}.nflEzpzStack{display:grid;gap:12px}.nflEzpzCard{border-color:rgba(43,216,117,.35)}.nflEzpzBadges{display:flex;flex-wrap:wrap;gap:6px}.nflSourceBadge{color:#aef2c6;border-color:rgba(43,216,117,.28);background:rgba(28,130,78,.13)}.nflStatusBadge.final{color:#aef2c6}.nflStatusBadge.pending{color:#f4d482;border-color:rgba(247,200,92,.25)}.nflEzpzOdds{font-size:1.05rem}.nflEzpzSelection{margin-top:15px}.nflGateRow{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:9px;margin-top:14px}.nflGate{display:grid;gap:4px;border:1px solid rgba(83,127,181,.17);border-radius:15px;padding:11px 12px;background:rgba(8,18,34,.58)}.nflGate>span{color:var(--ez-muted);font-size:.62rem;font-weight:900;text-transform:uppercase;letter-spacing:.06em}.nflGate strong{font-size:.95rem}.nflGate small{color:var(--ez-muted);font-size:.67rem}.nflGate.trend{border-color:rgba(47,140,255,.26);background:rgba(47,140,255,.075)}.nflGate.trend strong{color:#8bc5ff;font-size:1.22rem}.nflEzpzRuleText{display:grid;gap:4px;margin-top:11px;padding-top:10px;border-top:1px solid rgba(103,139,185,.12)}.nflEzpzRuleText strong{font-size:.72rem;color:#dcecff}.nflEzpzRuleText span{font-size:.66rem;color:var(--ez-muted);line-height:1.35}.footballCanonicalRecords{display:grid;gap:18px}.footballCanonicalRecordTile{display:grid;gap:5px}.footballCanonicalRecordTile>span{color:var(--ez-muted);font-size:.78rem;font-weight:850}.footballCanonicalRecordTile>strong{font-size:1.7rem}.footballCanonicalRecordTile>small{color:var(--ez-muted)}.footballCanonicalInfo{line-height:1.55}
        @media(max-width:850px){.nflOptimizedGrid{grid-template-columns:1fr}.nflRulesStrip{grid-template-columns:1fr}}
        @media(max-width:620px){.nflOptimizedHead{align-items:flex-start;flex-direction:column}.nflPlayerHero{grid-template-columns:78px minmax(0,1fr)}.nflHeadshot{width:78px;height:78px;border-radius:18px}.nflMetricGrid{grid-template-columns:repeat(2,minmax(0,1fr))}.nflOptimizedCard,.nflEzpzCard{padding:15px;border-radius:21px}}
      `}</style>
    </>
  );
}
