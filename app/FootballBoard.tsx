"use client";

import { useMemo, useState } from "react";
import LegacyFootballBoard from "./FootballBoardLegacy";
import { MatchupWithLogos, SelectionWithTeamLogo, TeamLogoName } from "./TeamLogoName";

type Tab = "Today’s Model Plays" | "Today’s Trend Plays" | "EZPZ Picks" | "Full Slate" | "Records";
type Sport = "NFL" | "NCAAF";
type SheetRow = Record<string, string>;
type ResultCode = "W" | "L" | "P" | "";
type FormStatus = "HOT" | "COLD" | "NEUTRAL" | "SAMPLE";

type EzpzPick = {
  date?: string;
  source?: "Best Play" | "Trend Play" | "Best + Trend";
  game?: string;
  market?: "Spread" | "Total" | "Player Prop" | string;
  selection?: string;
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
  result?: ResultCode | string;
  resultUpdated?: string;
};

type FootballData = Record<string, any> & {
  today?: string;
  aiPicks?: EzpzPick[];
  aiPickRecordRows?: EzpzPick[];
  betTrackerRows?: SheetRow[];
  trendRecordRows?: SheetRow[];
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
  const iso = raw.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const us = raw.match(/(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?/);
  if (!us) return "";
  const year = us[3] || String(new Date().getFullYear());
  return `${year}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
}

function formatDateLabel(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(year, month - 1, day, 12));
}

function resultCode(value: unknown): ResultCode {
  const key = String(value || "").trim().toUpperCase();
  if (["W", "WIN", "WON"].includes(key)) return "W";
  if (["L", "LOSS", "LOST"].includes(key)) return "L";
  if (["P", "PUSH"].includes(key)) return "P";
  return "";
}

function americanOdds(value: unknown) {
  const raw = String(value ?? "").trim().replace(/−/g, "-");
  const signed = raw.match(/[+-]\d{3,4}/)?.[0];
  if (signed) return Number(signed);
  const exact = raw.match(/^\d{3,4}$/)?.[0];
  return exact ? Number(exact) : null;
}

function displayOdds(value: unknown) {
  const parsed = americanOdds(value);
  if (parsed == null) return String(value || "—");
  return parsed > 0 ? `+${parsed}` : String(parsed);
}

function rowAmericanOdds(row: SheetRow) {
  const side = textKey(row.Pick || row.Side || row.Selection || "");
  const sideOdds = side.startsWith("under") ? row["Under Odds"] : row["Over Odds"];
  for (const value of [row["Pick Odds"], row.Odds, row["Odds/Line"], sideOdds]) {
    const parsed = americanOdds(value);
    if (parsed != null) return parsed;
  }
  return -110;
}

function recordTotalsFromRows(rows: SheetRow[]) {
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  for (const row of rows) {
    const result = resultCode(row.Result || row.Status);
    if (result === "W") wins += 1;
    else if (result === "L") losses += 1;
    else if (result === "P") pushes += 1;
  }
  return { totalBets: wins + losses + pushes, wins, losses, pushes };
}

function gradeBucket(row: SheetRow) {
  const grade = textKey(row.Grade || row["Model Grade"] || row.Tier || "");
  if (grade === "a" || grade.startsWith("a ")) return "A";
  if (grade === "b" || grade.startsWith("b ")) return "B";
  return "";
}

function marketLine(value: unknown) {
  const matches = String(value || "").replace(/[−–—]/g, "-").match(/[+-]?\d+(?:\.\d+)?/g) || [];
  for (const raw of [...matches].reverse()) {
    const line = Number(raw);
    if (Number.isFinite(line) && Math.abs(line) <= 60) return line;
  }
  return null;
}

function side(value: unknown) {
  const key = textKey(value);
  if (key.startsWith("under")) return "Under";
  if (key.startsWith("over")) return "Over";
  return "";
}

function isPlayerPropRow(row: SheetRow) {
  return Boolean(String(row.Player || "").trim());
}

function modelRecordType(row: SheetRow, sport: Sport) {
  const grade = gradeBucket(row);
  if (!grade) return "";
  if (sport === "NFL" && isPlayerPropRow(row)) {
    const market = textKey(row.Market || row["Bet Type"] || "Player Prop");
    const direction = side(row.Pick || row.Side || row.Selection);
    return market && direction ? `${grade}|PROP|${market}|${direction}` : "";
  }
  const market = textKey(row["Bet Type"] || row.Market);
  if (market.includes("total")) {
    const direction = side(row.Selection || row.Side || row.Pick);
    return direction ? `${grade}|TOTAL|${direction}` : "";
  }
  if (market.includes("spread")) {
    const line = marketLine(row.Selection) ?? marketLine(row.Line) ?? marketLine(row["Odds/Line"]);
    if (line == null || Math.abs(line) < 1e-9) return "";
    return `${grade}|SPREAD|${line < 0 ? "Favorite" : "Underdog"}`;
  }
  return "";
}

function modelHistoryRows(rows: SheetRow[], sport: Sport) {
  const settled = rows
    .map((row, index) => ({ row, index, date: isoDate(row.Date || row["Game Date"] || ""), type: modelRecordType(row, sport) }))
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

function trendDetails(row: SheetRow): Record<string, any> | null {
  const raw = String(row["Trend Score Details"] || "").trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function trendSignalRoi(signal: Record<string, any>) {
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

function trendRoi(details: Record<string, any> | null) {
  const signals = Array.isArray(details?.signals) ? details.signals as Array<Record<string, any>> : [];
  const values = signals.map(trendSignalRoi).filter((value): value is number => value != null && Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function cfbTrendHistoryRows(rows: SheetRow[]) {
  const settled = rows
    .map((row, index) => ({ row, index, details: trendDetails(row) }))
    .filter((item) => Boolean(resultCode(item.row.Result || item.row.Status)) && textKey(item.row["Trend Play"]) !== "false")
    .map((item) => ({
      ...item,
      date: isoDate(item.row.Date || item.row["Game Date"] || ""),
      game: textKey(item.row.Game || item.row["Game Key"] || ""),
      market: textKey(item.row.Market || item.details?.market || ""),
      selection: textKey(item.row.Selection || item.row.Side || item.details?.selection || item.details?.side || ""),
      tier: String(item.details?.tier || item.row["Trend Tier"] || ""),
      score: Number(item.details?.score ?? item.row["Trend Score"] ?? 0),
      sample: Number(item.details?.TrendSampleSize ?? item.row["Trend Sample Size"] ?? 0),
      roi: trendRoi(item.details),
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
    if (item.roi - Math.max(...opponents) < 25) continue;
    qualified.push(item);
  }
  const byGame = new Map<string, (typeof qualified)[number]>();
  for (const item of qualified.sort((a, b) => b.score - a.score || a.index - b.index)) {
    const key = `${item.date}|${item.game}`;
    if (!byGame.has(key)) byGame.set(key, item);
  }
  return [...byGame.values()].map((item) => item.row);
}

function rowGame(row: SheetRow) {
  const direct = String(row.Game || "").trim();
  if (direct) return direct;
  const team = String(row.Team || "").trim();
  const opponent = String(row.Opponent || "").trim();
  return [team, opponent].filter(Boolean).join(" vs ");
}

function rowSelection(row: SheetRow) {
  if (isPlayerPropRow(row)) {
    const player = String(row.Player || "").trim();
    const direction = String(row.Pick || row.Side || "").trim();
    const line = String(row["Market Line"] || row.Line || row["Prop Line"] || "").trim();
    return [player, direction, line].filter(Boolean).join(" ");
  }
  return String(row.Selection || row.Pick || row.Side || "").trim();
}

function rowToHistoryPick(row: SheetRow, source: EzpzPick["source"] = "Best Play"): EzpzPick {
  const prop = isPlayerPropRow(row);
  const player = String(row.Player || "").trim();
  const propSide = side(row.Pick || row.Side || row.Selection);
  const propLine = String(row["Market Line"] || row.Line || row["Prop Line"] || "").trim();
  const marketRaw = String(row.Market || row["Bet Type"] || (prop ? "Player Prop" : "")).trim();
  const normalizedMarket = prop ? "Player Prop" : textKey(marketRaw).includes("total") ? "Total" : "Spread";
  return {
    date: isoDate(row.Date || row["Game Date"] || ""),
    source,
    game: rowGame(row),
    market: normalizedMarket,
    selection: prop ? [propSide, propLine].filter(Boolean).join(" ") : rowSelection(row),
    odds: displayOdds(row["Pick Odds"] || row.Odds || row["Odds/Line"] || (propSide === "Under" ? row["Under Odds"] : row["Over Odds"])),
    playerName: prop ? player : undefined,
    playerTeam: prop ? String(row.Team || row["Player Team"] || "").trim() : undefined,
    propMarket: prop ? marketRaw : undefined,
    propSide: prop ? propSide : undefined,
    propLine: prop ? propLine : undefined,
    result: resultCode(row.Result || row.Status),
    snapshotStatus: "FINAL_PREGAME",
  };
}

function pickIdentity(pick: EzpzPick) {
  const date = isoDate(pick.date);
  const game = textKey(pick.game);
  const market = textKey(pick.market);
  if (pick.playerName) return `${date}|${game}|prop|${textKey(pick.playerName)}|${textKey(pick.propMarket)}|${textKey(pick.propSide)}|${String(pick.propLine ?? "")}`;
  return `${date}|${game}|${market}|${textKey(pick.selection)}`;
}

function buildFallbackHistory(data: FootballData, sport: Sport) {
  const modelRows = modelHistoryRows(data.betTrackerRows || [], sport).map((row) => rowToHistoryPick(row, "Best Play"));
  const trendRows = sport === "NCAAF"
    ? cfbTrendHistoryRows(data.trendRecordRows || []).map((row) => rowToHistoryPick(row, "Trend Play"))
    : [];
  const map = new Map<string, EzpzPick>();
  for (const pick of [...modelRows, ...trendRows]) {
    const key = pickIdentity(pick);
    const existing = map.get(key);
    if (!existing) map.set(key, pick);
    else if (existing.source !== pick.source) map.set(key, { ...existing, source: "Best + Trend" });
  }
  return [...map.values()];
}

function resultMeta(value: unknown) {
  const result = resultCode(value);
  if (result === "W") return { label: "WON", tone: "win" };
  if (result === "L") return { label: "LOST", tone: "loss" };
  if (result === "P") return { label: "PUSH", tone: "push" };
  return { label: "PENDING", tone: "pending" };
}

function PlayerAvatar({ pick }: { pick: EzpzPick }) {
  const name = String(pick.playerName || "").trim();
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "NFL";
  return (
    <div className="footballHistoryHeadshot">
      <span>{initials}</span>
      {pick.headshotUrl ? <img src={pick.headshotUrl} alt={`${name} headshot`} loading="lazy" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : null}
    </div>
  );
}

function HistoryPickCard({ pick, sport, viewingToday }: { pick: EzpzPick; sport: Sport; viewingToday: boolean }) {
  const isProp = pick.market === "Player Prop" || Boolean(pick.playerName);
  const result = resultMeta(pick.result);
  const liveStatus = String(pick.snapshotStatus || "").toUpperCase() === "FINAL_PREGAME" || pick.source !== "Trend Play" ? "FINAL" : "PENDING";
  const statusLabel = result.label !== "PENDING" ? result.label : viewingToday ? liveStatus : "PENDING";
  const statusTone = result.label !== "PENDING" ? result.tone : liveStatus === "FINAL" ? "final" : "pending";
  const propSelection = [String(pick.propSide || "").trim(), String(pick.propLine ?? "").trim()].filter(Boolean).join(" ") || String(pick.selection || "");
  return (
    <article className="footballHistoryPickCard">
      <div className="footballHistoryCardTop">
        <span className={`footballHistoryResult ${statusTone}`}>{statusLabel}</span>
        <strong>{displayOdds(pick.odds)}</strong>
      </div>
      {isProp ? (
        <div className="footballHistoryPropHero">
          <PlayerAvatar pick={pick} />
          <div>
            <span className="footballHistoryEyebrow"><TeamLogoName sport="NFL" team={pick.playerTeam || ""} text={pick.playerTeam || "NFL"} compact /> • {pick.propMarket || "Player Prop"}</span>
            <h3>{pick.playerName || pick.selection}</h3>
            <p><MatchupWithLogos sport="NFL" game={pick.game || ""} compact /></p>
            <div className="footballHistoryPropPick"><span>Pick</span><b>{propSelection}</b></div>
          </div>
        </div>
      ) : (
        <div className="footballHistoryGameHero">
          <span><MatchupWithLogos sport={sport} game={pick.game || ""} compact /></span>
          <h3><SelectionWithTeamLogo sport={sport} selection={pick.selection || ""} game={pick.game || ""} /></h3>
          <p>{pick.market || "Model Play"}</p>
        </div>
      )}
    </article>
  );
}

function FootballEzpzHistory({ sport, data }: { sport: Sport; data: FootballData }) {
  const today = isoDate(data.today) || new Date().toISOString().slice(0, 10);
  const [selectedDate, setSelectedDate] = useState(today);
  const fallbackHistory = useMemo(() => buildFallbackHistory(data, sport), [data, sport]);
  const savedHistory = useMemo(() => {
    const map = new Map<string, EzpzPick>();
    for (const pick of fallbackHistory) map.set(pickIdentity(pick), pick);
    for (const raw of data.aiPickRecordRows || []) {
      const pick = { ...raw, date: isoDate(raw.date) } as EzpzPick;
      if (!pick.date) continue;
      map.set(pickIdentity(pick), { ...map.get(pickIdentity(pick)), ...pick });
    }
    return [...map.values()].filter((pick) => Boolean(isoDate(pick.date)));
  }, [data.aiPickRecordRows, fallbackHistory]);

  const currentPicks = useMemo(() => (data.aiPicks || []).map((pick) => ({ ...pick, date: today })), [data.aiPicks, today]);
  const viewingToday = selectedDate === today;
  const picks = viewingToday ? currentPicks : savedHistory.filter((pick) => isoDate(pick.date) === selectedDate);
  const availableDates = useMemo(() => [...new Set([today, ...savedHistory.map((pick) => isoDate(pick.date)).filter(Boolean)])].sort((a, b) => b.localeCompare(a)), [savedHistory, today]);
  const dateLabel = formatDateLabel(selectedDate);

  return (
    <>
      <section className="footballEzpzHistorySection">
        <div className="footballHistoryHead">
          <div>
            <h2>{sport} EZPZ Picks</h2>
            <p>{viewingToday ? "Today’s qualifying EZPZ Picks." : `Saved EZPZ Picks for ${dateLabel}. Final grading is shown on each play.`}</p>
          </div>
          <span>{picks.length} {picks.length === 1 ? "pick" : "picks"}</span>
        </div>

        <details className="footballHistoryDropdown">
          <summary>
            <div><strong>Pick history</strong><span>{dateLabel} • {picks.length} saved {picks.length === 1 ? "pick" : "picks"}</span></div>
            <b>Choose date ▾</b>
          </summary>
          <div className="footballHistoryControls">
            <label><span>Calendar date</span><input type="date" value={selectedDate} max={today} onChange={(event) => setSelectedDate(event.target.value || today)} /></label>
            <label><span>Dates with saved picks</span><select value={availableDates.includes(selectedDate) ? selectedDate : ""} onChange={(event) => setSelectedDate(event.target.value)}>
              {!availableDates.includes(selectedDate) ? <option value="" disabled>No saved picks on selected date</option> : null}
              {availableDates.map((date) => <option key={date} value={date}>{date === today ? `${date} — Today` : date}</option>)}
            </select></label>
          </div>
        </details>

        {picks.length ? <div className="footballHistoryStack">{picks.map((pick, index) => <HistoryPickCard key={`${pickIdentity(pick)}-${index}`} pick={pick} sport={sport} viewingToday={viewingToday} />)}</div> : <div className="footballHistoryEmpty">{viewingToday ? `No ${sport} EZPZ Picks right now.` : `No ${sport} EZPZ Picks were saved for ${dateLabel}. Choose another date from Pick history.`}</div>}
      </section>
      <style jsx global>{`
        .footballEzpzHistorySection{display:grid;gap:18px}.footballHistoryHead{display:flex;align-items:flex-end;justify-content:space-between;gap:18px}.footballHistoryHead h2{margin:0 0 5px;font-size:clamp(1.4rem,4vw,2.2rem);letter-spacing:-.04em}.footballHistoryHead p{margin:0;color:var(--ez-muted);font-size:.86rem;line-height:1.45}.footballHistoryHead>span{flex:0 0 auto;border:1px solid var(--ez-border);border-radius:999px;padding:7px 11px;color:var(--ez-muted);font-size:.8rem;font-weight:850}.footballHistoryDropdown{overflow:hidden;border:1px solid rgba(80,132,197,.24);border-radius:22px;background:linear-gradient(145deg,var(--ez-panel),var(--ez-panel-2))}.footballHistoryDropdown>summary{display:flex;align-items:center;justify-content:space-between;gap:14px;list-style:none;cursor:pointer;padding:17px 18px}.footballHistoryDropdown>summary::-webkit-details-marker{display:none}.footballHistoryDropdown>summary>div{display:grid;gap:3px}.footballHistoryDropdown>summary strong{font-size:1rem}.footballHistoryDropdown>summary span{color:var(--ez-muted);font-size:.78rem}.footballHistoryDropdown>summary>b{color:#83c8ff;font-size:.8rem}.footballHistoryControls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;padding:0 18px 18px}.footballHistoryControls label{display:grid;gap:6px}.footballHistoryControls label>span{color:var(--ez-muted);font-size:.7rem;font-weight:850;text-transform:uppercase;letter-spacing:.045em}.footballHistoryControls input,.footballHistoryControls select{width:100%;min-height:44px;border:1px solid rgba(93,137,191,.24);border-radius:13px;padding:10px 12px;background:rgba(5,14,27,.7);color:#eef6ff;font:inherit}.footballHistoryStack{display:grid;gap:12px}.footballHistoryPickCard{position:relative;overflow:hidden;border:1px solid rgba(43,216,117,.35);border-radius:24px;padding:18px;background:linear-gradient(145deg,var(--ez-panel),var(--ez-panel-2));box-shadow:0 24px 65px rgba(0,0,0,.24)}.footballHistoryCardTop{display:flex;align-items:center;justify-content:space-between;gap:12px}.footballHistoryCardTop>strong{font-size:1.05rem}.footballHistoryResult{display:inline-flex;align-items:center;border-radius:999px;padding:6px 9px;border:1px solid rgba(112,145,186,.2);font-size:.68rem;font-weight:950;letter-spacing:.04em}.footballHistoryResult.win,.footballHistoryResult.final{color:#aef2c6;border-color:rgba(43,216,117,.34);background:rgba(28,130,78,.15)}.footballHistoryResult.loss{color:#ffc0c8;border-color:rgba(255,105,120,.3);background:rgba(145,34,52,.15)}.footballHistoryResult.push,.footballHistoryResult.pending{color:#f4d482;border-color:rgba(247,200,92,.25);background:rgba(155,115,30,.13)}.footballHistoryGameHero{margin-top:15px}.footballHistoryGameHero h3{margin:4px 0 3px;color:#f5f9ff;font-size:clamp(1.35rem,4vw,2rem);line-height:1.06;letter-spacing:-.035em}.footballHistoryGameHero p{margin:0;color:var(--ez-muted);font-size:.8rem}.footballHistoryPropHero{display:grid;grid-template-columns:72px minmax(0,1fr);align-items:center;gap:14px;margin-top:15px}.footballHistoryHeadshot{position:relative;display:grid;place-items:center;width:72px;height:72px;overflow:hidden;border:1px solid rgba(94,159,247,.24);border-radius:17px;background:radial-gradient(circle at 50% 30%,rgba(64,146,255,.22),rgba(8,18,34,.88));color:rgba(181,211,246,.7);font-weight:950}.footballHistoryHeadshot img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;object-position:center bottom}.footballHistoryEyebrow{display:block;color:#78b9ff;font-size:.7rem;font-weight:900;letter-spacing:.06em;text-transform:uppercase}.footballHistoryPropHero h3{margin:4px 0 3px;color:#f5f9ff;font-size:clamp(1.25rem,4vw,1.8rem);line-height:1.06;letter-spacing:-.035em}.footballHistoryPropHero p{margin:0;color:var(--ez-muted);font-size:.8rem}.footballHistoryPropPick{display:flex;align-items:baseline;gap:9px;margin-top:10px}.footballHistoryPropPick span{color:#9ccaff;font-size:.72rem;font-weight:950;text-transform:uppercase}.footballHistoryPropPick b{font-size:1.25rem}.footballHistoryEmpty{border:1px solid var(--ez-border);border-radius:22px;padding:30px;text-align:center;color:var(--ez-muted);background:linear-gradient(145deg,var(--ez-panel),var(--ez-panel-2))}@media(max-width:620px){.footballHistoryHead{align-items:flex-start;flex-direction:column}.footballHistoryControls{grid-template-columns:1fr}.footballHistoryPickCard{padding:15px;border-radius:21px}.footballHistoryDropdown>summary{align-items:flex-start}.footballHistoryDropdown>summary>b{white-space:nowrap}}
      `}</style>
    </>
  );
}

export default function FootballBoard({ sport, tab, data }: { sport: Sport; tab: Tab; data: FootballData }) {
  if (tab !== "EZPZ Picks") return <LegacyFootballBoard sport={sport} tab={tab} data={data as any} />;
  return <FootballEzpzHistory sport={sport} data={data} />;
}
