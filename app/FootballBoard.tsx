"use client";

import { useMemo, useState } from "react";
import LegacyFootballBoard from "./FootballBoardLegacy";
import { MatchupWithLogos, SelectionWithTeamLogo, TeamLogoName } from "./TeamLogoName";
import FootballModelFormBadges from "./FootballModelFormBadges";

type Tab = "Today’s Model Plays" | "Public Betting Splits" | "EZPZ Picks" | "Full Slate" | "Records";
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
  betsPct?: number;
  moneyPct?: number;
  publicSideBetsPct?: number;
  publicSideMoneyPct?: number;
  publicMovePct?: number;
  lineMoveValue?: number;
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
  const map = new Map<string, EzpzPick>();
  for (const pick of modelRows) {
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

function pickFormMeta(value: unknown) {
  const status = String(value || "").trim().toUpperCase();
  if (status === "HOT") return { icon: "🔥", label: "HOT", tone: "hot" };
  if (status === "COLD") return { icon: "❄️", label: "COLD", tone: "cold" };
  if (status === "NEUTRAL") return { icon: "➖", label: "NEUTRAL", tone: "neutral" };
  if (status === "SAMPLE") return { icon: "⚠️", label: "SMALL SAMPLE", tone: "sample" };
  return null;
}


type DirectTrendSignal = "RLM" | "Public Fade" | "Sharp";

function matchupTeams(game: unknown) {
  const raw = String(game || "").trim();
  const at = raw.split(/\s*@\s*/).map((part) => part.trim()).filter(Boolean);
  if (at.length === 2) return { away: at[0], home: at[1] };
  const words = raw.split(/\s+(?:at|vs\.?|versus)\s+/i).map((part) => part.trim()).filter(Boolean);
  return words.length === 2 ? { away: words[0], home: words[1] } : null;
}

function directTrendTypes(pick: EzpzPick): DirectTrendSignal[] {
  if (pick.source !== "Trend Play" && pick.source !== "Best + Trend") return [];
  const key = textKey(`${pick.tier || ""} ${pick.qualification || ""}`);
  const types: DirectTrendSignal[] = [];
  if (key.includes("rlm")) types.push("RLM");
  if (key.includes("public fade")) types.push("Public Fade");
  if (key.includes("sharp")) types.push("Sharp");
  return types;
}

function historicalTrendSelectionKey(row: SheetRow) {
  if (textKey(row.Market) === "total") {
    const key = textKey(row.Side || row.Selection || row["Public Split Selection"]);
    return key.startsWith("under") ? "under" : key.startsWith("over") ? "over" : key;
  }
  const key = textKey(row["Public Split Selection"] || row.Selection || "");
  const parts = key.split(" ").filter(Boolean);
  return parts[parts.length - 1] || key;
}

function directTrendGroupKey(row: SheetRow) {
  return `${String(row.Date || "")}|${String(row["Game Key"] || row["Game ID"] || row.Game || "")}|${textKey(row.Market)}`;
}

function directTrendLabels(row: SheetRow, group: SheetRow[], sport: Sport): DirectTrendSignal[] {
  const labels: DirectTrendSignal[] = [];
  const ownBets = Number(row["Public Bets %"] || row["Current Public %"]);
  const ownMoney = Number(row["Public Money %"] || row["Current Sharp %"]);
  const sharpMin = sport === "NFL" ? 25 : 40;
  if (Number.isFinite(ownBets) && Number.isFinite(ownMoney) && ownMoney - ownBets >= sharpMin) {
    labels.push("Sharp");
  }

  const ownKey = historicalTrendSelectionKey(row);
  const publicSide = group.find((candidate) => historicalTrendSelectionKey(candidate) !== ownKey);
  if (!publicSide) return labels;

  const publicBets = Number(publicSide["Public Bets %"] || publicSide["Current Public %"]);
  const publicMoney = Number(publicSide["Public Money %"] || publicSide["Current Sharp %"]);
  const placeholder = (publicBets === 100 && publicMoney === 100) || (publicBets === 0 && publicMoney === 0);
  const publicFade = sport === "NFL"
    ? !placeholder && Number.isFinite(publicBets) && publicBets >= 80
    : Number.isFinite(publicBets) && Number.isFinite(publicMoney) && publicBets > 75 && publicBets - publicMoney >= 55;
  if (publicFade) labels.push("Public Fade");

  const openingBets = Number(publicSide["Opening Public %"] || publicSide["Opening Bets %"]);
  const publicMove = Number(publicSide["Public Change %"]);
  const lineMove = Number(publicSide["Line Movement Value"]);
  const marketKey = textKey(row.Market);
  const rlmMarketMatches =
    (marketKey === "spread" &&
      String(publicSide["Line Movement Basis"] || "").includes("Spread")) ||
    (marketKey === "total" &&
      String(publicSide["Line Movement Basis"] || "").includes("Total Line"));
  if (
    rlmMarketMatches &&
    Number.isFinite(openingBets) && openingBets > 0 && openingBets < 100 &&
    Number.isFinite(publicMove) && publicMove >= 5 &&
    Number.isFinite(lineMove) && lineMove <= -1.5
  ) labels.push("RLM");

  return labels;
}

function directTrendRecord(rows: SheetRow[], sport: Sport, signal: DirectTrendSignal, beforeDate = "") {
  const grouped = new Map<string, SheetRow[]>();
  for (const row of rows || []) {
    if (!resultCode(row.Result || row.Status)) continue;
    const key = directTrendGroupKey(row);
    const current = grouped.get(key);
    if (current) current.push(row); else grouped.set(key, [row]);
  }

  const qualified: SheetRow[] = [];
  grouped.forEach((group) => {
    const unique = new Map<string, SheetRow>();
    group.forEach((row) => {
      const key = historicalTrendSelectionKey(row);
      if (key && !unique.has(key)) unique.set(key, row);
    });
    const sides = [...unique.values()];
    sides.forEach((row) => {
      if (directTrendLabels(row, sides, sport).includes(signal)) qualified.push(row);
    });
  });

  // Historical storage can contain the same settled market under two game IDs.
  // Deduplicate by the actual market state/result so the tile record never double-counts it.
  const deduped = new Map<string, SheetRow>();
  for (const row of qualified) {
    const key = [
      String(row.Date || ""),
      textKey(row.Market),
      historicalTrendSelectionKey(row),
      String(row["Public Bets %"] || row["Current Public %"] || ""),
      String(row["Public Money %"] || row["Current Sharp %"] || ""),
      String(row["Public Split Line"] || row.Line || ""),
      String(row["Public Split Odds"] || row.Odds || ""),
      resultCode(row.Result || row.Status),
    ].join("|");
    if (!deduped.has(key)) deduped.set(key, row);
  }

  const recentRows = [...deduped.values()]
    .filter((row) => {
      const rowDate = isoDate(row.Date || row["Game Date"] || "");
      return !beforeDate || Boolean(rowDate && rowDate < beforeDate);
    })
    .sort((a, b) => {
      const aDate = isoDate(a.Date || a["Game Date"] || "");
      const bDate = isoDate(b.Date || b["Game Date"] || "");
      return bDate.localeCompare(aDate);
    })
    .slice(0, 7);

  let wins = 0, losses = 0, pushes = 0, units = 0;
  recentRows.forEach((row) => {
    const result = resultCode(row.Result || row.Status);
    const odds = americanOdds(row["Public Split Odds"] || row.Odds) ?? -110;
    if (result === "W") {
      wins += 1;
      units += odds > 0 ? odds / 100 : 100 / Math.abs(odds);
    } else if (result === "L") {
      losses += 1;
      units -= 1;
    } else if (result === "P") pushes += 1;
  });
  const totalBets = wins + losses + pushes;
  return {
    record: `${wins}-${losses}-${pushes}`,
    totalBets,
    units: Math.round(units * 100) / 100,
    roi: totalBets ? Math.round((units / totalBets) * 1000) / 10 : 0,
  };
}

function trendRecordTitle(signal: DirectTrendSignal, sport: Sport) {
  if (signal === "Sharp") return `${sport} Sharp ${sport === "NFL" ? "25%+" : "40%+"} Record`;
  if (signal === "Public Fade") return sport === "NFL" ? "NFL Public Fade 80%+ Record" : "CFB Public Fade 75% / 55-gap Record";
  return `${sport} RLM Record`;
}

function trendSignalDetail(pick: EzpzPick, signal: DirectTrendSignal) {
  if (signal === "Sharp" && Number.isFinite(Number(pick.gapPct))) {
    const gap = Number(pick.gapPct);
    return `${gap >= 0 ? "+" : ""}${Math.round(gap * 10) / 10} pt money edge`;
  }
  if (signal === "Public Fade" && Number.isFinite(Number(pick.publicSideBetsPct))) {
    return `Fade ${Math.round(Number(pick.publicSideBetsPct))}% of bets`;
  }
  if (signal === "RLM") {
    const publicMove = Number(pick.publicMovePct);
    const lineMove = Number(pick.lineMoveValue);
    if (Number.isFinite(publicMove) && Number.isFinite(lineMove)) {
      return `Bets +${Math.round(publicMove * 10) / 10} pts • line ${lineMove > 0 ? "+" : ""}${Math.round(lineMove * 10) / 10}`;
    }
  }
  return String(pick.qualification || signal);
}

function propMarketDisplayLabel(pick: EzpzPick) {
  const market = String(pick.propMarket || "Player Prop").trim();
  const side = String(pick.propSide || "").trim();
  const tier = textKey(pick.tier);
  return [tier === "strong" ? "Strong" : "", side, market].filter(Boolean).join(" ");
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

function HistoryPickCard({ pick, sport, viewingToday, data }: { pick: EzpzPick; sport: Sport; viewingToday: boolean; data: FootballData }) {
  const isProp = pick.market === "Player Prop" || Boolean(pick.playerName);
  const result = resultMeta(pick.result);
  const liveStatus = String(pick.snapshotStatus || "").toUpperCase() === "FINAL_PREGAME" || pick.source !== "Trend Play" ? "FINAL" : "PENDING";
  const statusLabel = result.label !== "PENDING" ? result.label : viewingToday ? liveStatus : "PENDING";
  const statusTone = result.label !== "PENDING" ? result.tone : liveStatus === "FINAL" ? "final" : "pending";
  const propSelection = [String(pick.propSide || "").trim(), String(pick.propLine ?? "").trim()].filter(Boolean).join(" ") || String(pick.selection || "");
  const propProjection = String(pick.propProjection ?? "").trim();
  const propSelectionWithProjection = propProjection ? `${propSelection} • Proj. ${propProjection}` : propSelection;
  const form = sport === "NFL" ? pickFormMeta(pick.formStatus) : null;
  const formRecord = String(pick.record || "").trim();
  const trendTypes = directTrendTypes(pick);
  const primaryTrend = trendTypes[0];
  const matchup = matchupTeams(pick.game);

  if (!isProp && primaryTrend) {
    const trendRecord = directTrendRecord(
      data.trendRecordRows || [],
      sport,
      primaryTrend,
      isoDate(pick.date) || isoDate(data.today),
    );
    return (
      <article className="footballHistoryPickCard footballHistoryTrendCard">
        <div className="footballHistoryTrendTop">
          <span className={`footballHistoryResult ${statusTone}`}><span className="footballHistoryStatusDot">●</span>{statusLabel}</span>
          <div className="footballHistoryTrendBadges">
            {trendTypes.map((signal) => <span className={`footballTrendTypeBadge ${textKey(signal).replace(/\s+/g, "-")}`} key={signal}>{signal}</span>)}
          </div>
        </div>

        {matchup ? (
          <div className="footballHistoryTrendMatchup">
            <TeamLogoName sport={sport} team={matchup.away} text={matchup.away} className="footballHistoryTrendTeam" />
            <span className="footballHistoryTrendAt">AT</span>
            <TeamLogoName sport={sport} team={matchup.home} text={matchup.home} className="footballHistoryTrendTeam home" />
          </div>
        ) : <div className="footballHistoryTrendMatchupText"><MatchupWithLogos sport={sport} game={pick.game || ""} /></div>}

        <div className="footballHistoryTrendPickRow">
          <div>
            <h3>{pick.selection}</h3>
            <p>{pick.market || "Betting Split"}</p>
          </div>
          <strong className="footballHistoryTrendOdds">{displayOdds(pick.odds)}</strong>
        </div>

        <div className="footballHistoryTrendRecordInline">
          <span className="footballHistoryTrendRecordLabel">{trendRecordTitle(primaryTrend, sport)} • Last 7</span>
          <strong>L7 {trendRecord.record}</strong>
          {trendRecord.totalBets ? <span>{trendRecord.units >= 0 ? "+" : ""}{trendRecord.units.toFixed(2)}u</span> : null}
          {trendRecord.totalBets ? <span>ROI {trendRecord.roi >= 0 ? "+" : ""}{trendRecord.roi.toFixed(1)}%</span> : null}
        </div>
      </article>
    );
  }

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
            <span className="footballHistoryEyebrow"><TeamLogoName sport="NFL" team={pick.playerTeam || ""} text={pick.playerTeam || "NFL"} compact /> • {propMarketDisplayLabel(pick)}</span>
            <h3>{pick.playerName || pick.selection}</h3>
            <p><MatchupWithLogos sport="NFL" game={pick.game || ""} compact /></p>
            <div className="footballHistoryPropPick"><span>Pick</span><b>{propSelectionWithProjection}</b></div>
          </div>
        </div>
      ) : (
        <div className="footballHistoryGameHero">
          <span><MatchupWithLogos sport={sport} game={pick.game || ""} compact /></span>
          <h3><SelectionWithTeamLogo sport={sport} selection={pick.selection || ""} game={pick.game || ""} /></h3>
          <p>{pick.market || "Model Play"}</p>
        </div>
      )}
      {form || formRecord ? (
        <div className="footballHistoryFormLine">
          {form ? <span className={`footballHistoryFormBadge ${form.tone}`}>{form.icon} {form.label}</span> : null}
          <span className="footballHistoryFormRecord">L7 <b>{formRecord || "0-0-0"}</b></span>
        </div>
      ) : null}
      {!isProp && sport !== "NFL" && pick.source !== "Trend Play" ? (
        <FootballModelFormBadges
          rows={data.betTrackerRows || []}
          today={data.today}
          grade={pick.tier || pick.formType || pick.qualification}
          market={pick.market}
          selection={pick.selection}
          recordType={pick.formType}
          qualification={pick.qualification}
          className="footballHistoryFormBadges"
        />
      ) : null}
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

        {picks.length ? <div className="footballHistoryStack">{picks.map((pick, index) => <HistoryPickCard key={`${pickIdentity(pick)}-${index}`} pick={pick} sport={sport} viewingToday={viewingToday} data={data} />)}</div> : <div className="footballHistoryEmpty">{viewingToday ? `No ${sport} EZPZ Picks right now.` : `No ${sport} EZPZ Picks were saved for ${dateLabel}. Choose another date from Pick history.`}</div>}
      </section>
      <style jsx global>{`
        .footballEzpzHistorySection{display:grid;gap:18px}.footballHistoryHead{display:flex;align-items:flex-end;justify-content:space-between;gap:18px}.footballHistoryHead h2{margin:0 0 5px;font-size:clamp(1.4rem,4vw,2.2rem);letter-spacing:-.04em}.footballHistoryHead p{margin:0;color:var(--ez-muted);font-size:.86rem;line-height:1.45}.footballHistoryHead>span{flex:0 0 auto;border:1px solid var(--ez-border);border-radius:999px;padding:7px 11px;color:var(--ez-muted);font-size:.8rem;font-weight:850}.footballHistoryDropdown{overflow:hidden;border:1px solid rgba(80,132,197,.24);border-radius:22px;background:linear-gradient(145deg,var(--ez-panel),var(--ez-panel-2))}.footballHistoryDropdown>summary{display:flex;align-items:center;justify-content:space-between;gap:14px;list-style:none;cursor:pointer;padding:17px 18px}.footballHistoryDropdown>summary::-webkit-details-marker{display:none}.footballHistoryDropdown>summary>div{display:grid;gap:3px}.footballHistoryDropdown>summary strong{font-size:1rem}.footballHistoryDropdown>summary span{color:var(--ez-muted);font-size:.78rem}.footballHistoryDropdown>summary>b{color:#83c8ff;font-size:.8rem}.footballHistoryControls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;padding:0 18px 18px}.footballHistoryControls label{display:grid;gap:6px}.footballHistoryControls label>span{color:var(--ez-muted);font-size:.7rem;font-weight:850;text-transform:uppercase;letter-spacing:.045em}.footballHistoryControls input,.footballHistoryControls select{width:100%;min-height:44px;border:1px solid rgba(93,137,191,.24);border-radius:13px;padding:10px 12px;background:rgba(5,14,27,.7);color:#eef6ff;font:inherit}.footballHistoryStack{display:grid;gap:12px}.footballHistoryPickCard{position:relative;overflow:hidden;border:1px solid rgba(43,216,117,.35);border-radius:24px;padding:18px;background:linear-gradient(145deg,var(--ez-panel),var(--ez-panel-2));box-shadow:0 24px 65px rgba(0,0,0,.24)}.footballHistoryCardTop{display:flex;align-items:center;justify-content:space-between;gap:12px}.footballHistoryCardTop>strong{font-size:1.05rem}.footballHistoryResult{display:inline-flex;align-items:center;border-radius:999px;padding:6px 9px;border:1px solid rgba(112,145,186,.2);font-size:.68rem;font-weight:950;letter-spacing:.04em}.footballHistoryResult.win,.footballHistoryResult.final{color:#aef2c6;border-color:rgba(43,216,117,.34);background:rgba(28,130,78,.15)}.footballHistoryResult.loss{color:#ffc0c8;border-color:rgba(255,105,120,.3);background:rgba(145,34,52,.15)}.footballHistoryResult.push,.footballHistoryResult.pending{color:#f4d482;border-color:rgba(247,200,92,.25);background:rgba(155,115,30,.13)}.footballHistoryGameHero{margin-top:15px}.footballHistoryGameHero h3{margin:4px 0 3px;color:#f5f9ff;font-size:clamp(1.35rem,4vw,2rem);line-height:1.06;letter-spacing:-.035em}.footballHistoryGameHero p{margin:0;color:var(--ez-muted);font-size:.8rem}.footballHistoryPropHero{display:grid;grid-template-columns:72px minmax(0,1fr);align-items:center;gap:14px;margin-top:15px}.footballHistoryHeadshot{position:relative;display:grid;place-items:center;width:72px;height:72px;overflow:hidden;border:1px solid rgba(94,159,247,.24);border-radius:17px;background:radial-gradient(circle at 50% 30%,rgba(64,146,255,.22),rgba(8,18,34,.88));color:rgba(181,211,246,.7);font-weight:950}.footballHistoryHeadshot img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;object-position:center bottom}.footballHistoryEyebrow{display:block;color:#78b9ff;font-size:.7rem;font-weight:900;letter-spacing:.06em;text-transform:uppercase}.footballHistoryPropHero h3{margin:4px 0 3px;color:#f5f9ff;font-size:clamp(1.25rem,4vw,1.8rem);line-height:1.06;letter-spacing:-.035em}.footballHistoryPropHero p{margin:0;color:var(--ez-muted);font-size:.8rem}.footballHistoryPropPick{display:flex;align-items:baseline;gap:9px;margin-top:10px}.footballHistoryPropPick span{color:#9ccaff;font-size:.72rem;font-weight:950;text-transform:uppercase}.footballHistoryPropPick b{font-size:1.25rem}.footballHistoryFormLine{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:13px}.footballHistoryFormBadge,.footballHistoryFormRecord{display:inline-flex;align-items:center;border:1px solid rgba(112,145,186,.2);border-radius:999px;padding:7px 10px;font-size:.7rem;font-weight:900;line-height:1}.footballHistoryFormBadge.hot{color:#fed7aa;border-color:rgba(249,115,22,.3);background:rgba(249,115,22,.12)}.footballHistoryFormBadge.cold{color:#bae6fd;border-color:rgba(56,189,248,.3);background:rgba(56,189,248,.12)}.footballHistoryFormBadge.neutral{color:#d4dbe5;border-color:rgba(148,163,184,.22);background:rgba(148,163,184,.09)}.footballHistoryFormBadge.sample{color:#fde3a7;border-color:rgba(245,158,11,.3);background:rgba(245,158,11,.1)}.footballHistoryFormRecord{color:var(--ez-muted);background:rgba(100,120,146,.08)}.footballHistoryFormRecord b{margin-left:4px;color:#eef6ff}.footballHistoryTrendCard{border-color:rgba(56,151,236,.5);background:radial-gradient(circle at 100% 0%,rgba(15,112,214,.10),transparent 38%),linear-gradient(150deg,rgba(5,17,34,.99),rgba(3,10,22,.99));box-shadow:0 16px 44px rgba(0,0,0,.28),0 0 0 1px rgba(50,143,230,.025) inset}.footballHistoryTrendTop{display:flex;align-items:center;justify-content:space-between;gap:10px}.footballHistoryStatusDot{font-size:.55em;margin-right:5px;opacity:.9}.footballHistoryTrendBadges{display:flex;justify-content:flex-end;gap:6px;flex-wrap:wrap}.footballTrendTypeBadge{display:inline-flex;align-items:center;border:1px solid rgba(72,170,255,.4);border-radius:999px;padding:5px 10px;color:#86cbff;background:rgba(22,105,181,.12);font-size:.65rem;font-weight:950;letter-spacing:.05em;text-transform:uppercase}.footballTrendTypeBadge.rlm{color:#c9b8ff;border-color:rgba(139,92,246,.38);background:rgba(109,40,217,.11)}.footballTrendTypeBadge.public-fade{color:#ffd59a;border-color:rgba(245,158,11,.34);background:rgba(180,105,8,.10)}.footballHistoryTrendMatchup{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:10px;margin-top:14px;padding:11px 0 12px;border-bottom:1px solid rgba(91,139,196,.12)}.footballHistoryTrendTeam{font-size:.82rem!important;font-weight:900;color:#f1f7ff;letter-spacing:.005em}.footballHistoryTrendTeam.home{justify-self:end}.footballHistoryTrendTeam img{width:42px!important;height:42px!important}.footballHistoryTrendAt{color:#657991;font-size:.64rem;font-weight:950;letter-spacing:.08em}.footballHistoryTrendMatchupText{margin-top:14px;color:#f1f7ff;font-weight:850}.footballHistoryTrendPickRow{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:13px;margin-top:14px}.footballHistoryTrendPickRow h3{margin:0;color:#f7fbff;font-size:clamp(1.4rem,4.6vw,1.95rem);line-height:1;letter-spacing:-.04em}.footballHistoryTrendPickRow p{margin:6px 0 0;color:#8398b3;font-size:.71rem;font-weight:760}.footballHistoryTrendPickRow p span{padding:0 3px;opacity:.6}.footballHistoryTrendOdds{display:grid;place-items:center;min-width:72px;min-height:54px;padding:8px 11px;border:1px solid rgba(58,157,247,.28);border-radius:14px;background:linear-gradient(145deg,rgba(10,34,64,.68),rgba(4,18,35,.66));font-size:1.05rem}.footballHistoryTrendMeta{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:13px}.footballHistoryTrendSignal{display:inline-flex;align-items:center;border:1px solid rgba(42,215,136,.36);border-radius:999px;padding:7px 10px;color:#63ebb0;background:rgba(17,131,81,.10);font-size:.68rem;font-weight:950}.footballHistoryTrendSource{color:#6f839d;font-size:.61rem;font-weight:800;text-transform:uppercase;letter-spacing:.045em;white-space:nowrap}.footballHistoryTrendRecordInline{display:grid;grid-template-columns:minmax(0,1fr) auto auto auto;align-items:center;gap:9px;margin-top:12px;padding-top:11px;border-top:1px solid rgba(82,128,183,.14);color:#93a7c0}.footballHistoryTrendRecordLabel{min-width:0;font-size:.64rem;font-weight:820;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.footballHistoryTrendRecordInline strong{color:#f2f7ff;font-size:.83rem}.footballHistoryTrendRecordInline>span:not(.footballHistoryTrendRecordLabel){font-size:.65rem;font-weight:780;color:#9eb1c8}.footballHistoryEmpty{border:1px solid var(--ez-border);border-radius:22px;padding:30px;text-align:center;color:var(--ez-muted);background:linear-gradient(145deg,var(--ez-panel),var(--ez-panel-2))}@media(max-width:620px){.footballHistoryHead{align-items:flex-start;flex-direction:column}.footballHistoryControls{grid-template-columns:1fr}.footballHistoryPickCard{padding:15px;border-radius:21px}.footballHistoryDropdown>summary{align-items:flex-start}.footballHistoryDropdown>summary>b{white-space:nowrap}.footballHistoryTrendMatchup{gap:7px}.footballHistoryTrendTeam{font-size:.74rem!important}.footballHistoryTrendTeam img{width:40px!important;height:40px!important}.footballHistoryTrendMeta{align-items:flex-start;flex-direction:column;gap:6px}.footballHistoryTrendSource{font-size:.57rem}.footballHistoryTrendRecordInline{grid-template-columns:minmax(0,1fr) auto auto;gap:7px}.footballHistoryTrendRecordInline>span:last-child{grid-column:2 / -1}.footballHistoryTrendOdds{min-width:68px;min-height:52px}}
      `}</style>
    </>
  );
}

export default function FootballBoard({ sport, tab, data }: { sport: Sport; tab: Tab; data: FootballData }) {
  if (tab !== "EZPZ Picks") return <LegacyFootballBoard sport={sport} tab={tab} data={data as any} />;
  return <FootballEzpzHistory sport={sport} data={data} />;
}
