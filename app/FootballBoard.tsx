"use client";

import { useEffect, useMemo, useState } from "react";

type SheetRow = Record<string, string>;
type Tab = "Today’s Best Plays" | "Today’s Trend Plays" | "EZPZ AI Picks" | "Full Slate" | "Records";
type Sport = "NFL" | "NCAAF";

type RecordTotals = {
  record: string; totalBets: number; winPct: number; unitsWon: number; roiPct: number;
  wins: number; losses: number; pushes: number;
};

type Summary = RecordTotals & { betType: string; status: "WINNING" | "EVEN" | "LOSING" };

type Play = {
  playType: string; game: string; play: string; oddsLine: string; score: string | number;
  awayTeam: string; homeTeam: string; reliability?: string | number; role?: string;
};

type TrendSignal = {
  signal: string; score: number; exactSample: number; recordScope: string;
  records: { allTime: RecordTotals; last30: RecordTotals; last7: RecordTotals };
};

type TrendPlay = {
  date?: string; week?: string;
  game: string; gameKey: string; gameTime?: string; market: "Spread" | "Total"; selection: string;
  selectionTeam: string; side: "Over" | "Under" | ""; sideGroup?: string; line: number | null; odds: string;
  betsPct: number; moneyPct: number; gapPct: number; openingBetsPct?: number; openingMoneyPct?: number;
  publicMovementPct?: number; sharpMovementPct?: number; openingLine?: number | null; openingOdds?: string;
  openingImpliedPct?: number | null; currentImpliedPct?: number | null;
  comparisonGap?: number; opponentScore?: number | null; updatedAt?: string; frozenAt?: string;
  lockWarning?: string;
  snapshotStatus?: "LIVE" | "FINAL_PREGAME" | "MISSED_LOCK";
  score: number; tier: "Pass" | "Good" | "Strong" | "Elite";
  signals: TrendSignal[]; lineMovementSignal?: string; lineMovementBasis?: string; lineMovementValue?: number | null;
};

type DraftKingsSplit = {
  game: string; market: "Spread" | "Total"; selection: string; selectionTeam: string;
  side: "Over" | "Under" | ""; line: number | null; odds: string; betsPct: number;
  moneyPct: number; gapPct: number; warning: string; lineMovementSignal?: string;
};

type FootballData = {
  today: string; lastUpdated: string; database?: string; bestPlays: Play[]; slateToday: SheetRow[];
  betTrackerRows?: SheetRow[]; trendPlays?: TrendPlay[]; recordSummary?: Summary[];
  last7RecordSummary?: Summary[]; aiSelectorStatus?: { message?: string };
  draftKings?: { status: string; updatedAt: string; splits: DraftKingsSplit[]; errors?: string[] };
};

type WeeklyMarketData = {
  ok: boolean;
  games: SheetRow[];
  trendPlays: TrendPlay[];
  splits: DraftKingsSplit[];
  updatedAt?: string;
};

function pct(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const p = n <= 1 ? n * 100 : n;
  return `${p.toFixed(1)}%`;
}

function num(value: unknown, digits = 1) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : "—";
}

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

function signedPct(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function marketLine(play: TrendPlay, value: number | null | undefined) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  if (play.market === "Spread") return `${n > 0 ? "+" : ""}${n}`;
  return `${n}`;
}

function impliedPctValue(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.abs(n) <= 1 ? n * 100 : n;
}

function priceMove(play: TrendPlay) {
  const opening = impliedPctValue(play.openingImpliedPct);
  const current = impliedPctValue(play.currentImpliedPct);
  if (opening == null || current == null) return "—";
  const move = current - opening;
  return `${move > 0 ? "+" : ""}${move.toFixed(1)} implied pts`;
}

function scheduledLockTime(gameTime?: string) {
  const raw = String(gameTime || "");
  const match = raw.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return "—";
  let hour = Number(match[1]) % 12;
  if (match[3].toUpperCase() === "PM") hour += 12;
  const total = (hour * 60 + Number(match[2]) - 15 + 1440) % 1440;
  const lockHour24 = Math.floor(total / 60);
  const minute = total % 60;
  const suffix = lockHour24 >= 12 ? "PM" : "AM";
  const lockHour12 = lockHour24 % 12 || 12;
  return `${lockHour12}:${String(minute).padStart(2, "0")} ${suffix} ET`;
}

function gameTimeSortValue(gameTime?: string) {
  const raw = String(gameTime || "");
  const match = raw.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return Number.POSITIVE_INFINITY;
  let hour = Number(match[1]) % 12;
  if (match[3].toUpperCase() === "PM") hour += 12;
  return hour * 60 + Number(match[2]);
}

function compactTimestamp(value?: string) {
  const raw = String(value || "").trim();
  return raw || "—";
}

function selectedSplit(play: Play, splits: DraftKingsSplit[]) {
  const role = textKey(play.role || play.playType);
  if (role.includes("total")) {
    const side = textKey(play.play).startsWith("under") ? "Under" : "Over";
    return splits.find((split) => split.game === play.game && split.market === "Total" && split.side === side) ||
      splits.find((split) => split.market === "Total" && split.side === side && textKey(split.game) === textKey(play.game));
  }
  const selection = textKey(String(play.play).replace(/\s+[+-]?\d+(?:\.\d+)?(?:\s|$).*/, ""));
  return splits.find((split) => split.market === "Spread" && textKey(split.selectionTeam) === selection && textKey(split.game) === textKey(play.game)) ||
    splits.find((split) => split.market === "Spread" && (textKey(play.play).includes(textKey(split.selectionTeam)) || textKey(split.selectionTeam).includes(selection)));
}

function weekLabel(play: TrendPlay) {
  return String(play.week || "").trim() || "Current Week";
}

function weekSort(label: string) {
  if (label === "Preseason") return -10;
  const match = label.match(/Week\s+(\d+)/i);
  if (match) return Number(match[1]);
  if (label === "Postseason") return 100;
  return 99;
}

function defaultWeek(trends: TrendPlay[], today: string) {
  const dated = [...trends].filter((play) => play.date).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const sameDay = dated.find((play) => play.date === today);
  if (sameDay) return weekLabel(sameDay);
  const next = dated.find((play) => String(play.date) > today);
  if (next) return weekLabel(next);
  if (dated.length) return weekLabel(dated[dated.length - 1]);
  return trends.length ? weekLabel(trends[0]) : "";
}

function RecordTile({ label, value }: { label: string; value: RecordTotals | undefined }) {
  const record = value || { record: "0-0-0", totalBets: 0, winPct: 0, unitsWon: 0, roiPct: 0, wins: 0, losses: 0, pushes: 0 };
  return (
    <div className="fbRecordTile">
      <span>{label}</span>
      <strong>{record.record}</strong>
      <small>{record.winPct.toFixed(1)}% • {record.unitsWon.toFixed(2)}u • ROI {record.roiPct.toFixed(1)}%</small>
    </div>
  );
}

function BestPlayCard({ play, splits }: { play: Play; splits: DraftKingsSplit[] }) {
  const split = selectedSplit(play, splits);
  return (
    <article className="fbCard">
      <div className="fbCardTop"><span className="fbGrade">{play.playType}</span><span>{play.game}</span></div>
      <h3>{play.play}</h3>
      <div className="fbMetrics">
        <div><span>Model probability</span><strong>{pct(play.score)}</strong></div>
        <div><span>Reliability</span><strong>{play.reliability || "—"}</strong></div>
        <div><span>Price / line</span><strong>{play.oddsLine || "—"}</strong></div>
      </div>
      {split ? (
        <div className="fbDkBox">
          <b>DraftKings splits</b>
          <span>{split.betsPct}% bets • {split.moneyPct}% handle • {split.gapPct >= 0 ? "+" : ""}{split.gapPct}% gap</span>
          <span>{split.warning}</span>
          {split.lineMovementSignal ? <span>{split.lineMovementSignal}</span> : null}
        </div>
      ) : <div className="fbMuted">DraftKings selected-side split not matched yet.</div>}
    </article>
  );
}

function MiniBubble({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="miniBubble">
      <div className="miniLabel">{label}</div>
      <div className="miniValue">{value || "—"}</div>
    </div>
  );
}

function trendPickLabel(play: TrendPlay) {
  if (play.market === "Total") return `${play.side} ${play.line ?? ""}`.trim();
  const line = play.line == null ? "" : `${play.line > 0 ? "+" : ""}${play.line}`;
  return `${play.selection} ${line}`.trim();
}

function TrendSelectionRow({ play, selectionRank, initiallyOpen }: { play: TrendPlay; selectionRank: number; initiallyOpen: boolean }) {
  const primary = play.signals?.[0];
  const compactSignals = play.signals?.map((signal) => signal.signal).filter(Boolean).join(" • ") || "";
  return (
    <details className={`trendSelectionRow ${selectionRank === 1 ? "leader" : ""}`} open={initiallyOpen}>
      <summary className="trendSelectionSummary">
        <span className="trendSelectionRank">#{selectionRank}</span>
        <span className="trendSelectionIdentity">
          <strong>{trendPickLabel(play)}</strong>
          <small>{play.market}{play.sideGroup ? ` • ${play.sideGroup}` : ""}{compactSignals ? ` • ${compactSignals}` : ""}</small>
        </span>
        <span className="trendSelectionMarket">
          <small>{play.tier}</small>
          <strong>{Math.round(play.score)}</strong>
        </span>
        <span className="trendSelectionChevron" aria-hidden="true">⌄</span>
      </summary>

      <div className="trendSelectionBody">
        <div className="bubbleGrid trendSelectionMetrics">
          <MiniBubble label="Opening Bets" value={pct(play.openingBetsPct)} />
          <MiniBubble label="Current Bets" value={pct(play.betsPct)} />
          <MiniBubble label="Bets Change" value={signedPct(play.publicMovementPct)} />
          <MiniBubble label="Opening Handle" value={pct(play.openingMoneyPct)} />
          <MiniBubble label="Current Handle" value={pct(play.moneyPct)} />
          <MiniBubble label="Handle Change" value={signedPct(play.sharpMovementPct)} />
          <MiniBubble label="Handle − Bets" value={`${play.gapPct >= 0 ? "+" : ""}${Number(play.gapPct || 0).toFixed(1)}%`} />
          <MiniBubble label="Opening Odds" value={play.openingOdds || "—"} />
          <MiniBubble label="Current Odds" value={play.odds || "—"} />
          <MiniBubble label="Opening Line" value={marketLine(play, play.openingLine)} />
          <MiniBubble label="Current Line" value={marketLine(play, play.line)} />
          <MiniBubble label="Price Move" value={priceMove(play)} />
        </div>

        <div className="trendRecordGrid">
          <div className="trendRecordCard"><span>All time</span><strong>{primary?.records.allTime.record || "0-0-0"}</strong></div>
          <div className="trendRecordCard"><span>Last 30</span><strong>{primary?.records.last30.record || "0-0-0"}</strong></div>
          <div className="trendRecordCard"><span>Last 7</span><strong>{primary?.records.last7.record || "0-0-0"}</strong></div>
        </div>

        {primary ? (
          <div className="trendSignalBox">
            <b>{primary.signal}</b>
            <span>{primary.recordScope} • exact sample {primary.exactSample}</span>
          </div>
        ) : null}
        {play.lineMovementSignal ? <div className="trendMovement">{play.lineMovementSignal}</div> : null}
        {play.lockWarning ? <div className="trendMovement">{play.lockWarning}</div> : null}
        <div className="trendTrackingStrip">
          <span>Bets {pct(play.openingBetsPct)} → {pct(play.betsPct)}</span>
          <span>Line {marketLine(play, play.openingLine)} → {marketLine(play, play.line)}</span>
          <span>Exact sample: {primary?.exactSample || 0} bets</span>
          <span>{play.snapshotStatus === "FINAL_PREGAME" ? "Locked" : play.snapshotStatus === "MISSED_LOCK" ? "Lock missed" : "Locks"} {scheduledLockTime(play.gameTime)}</span>
          <span>Updated {compactTimestamp(play.updatedAt)}</span>
        </div>
      </div>
    </details>
  );
}

function TrendGameCard({ game, plays }: { game: string; plays: TrendPlay[] }) {
  const ordered = [...plays].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.market !== b.market) return a.market === "Spread" ? -1 : 1;
    return trendPickLabel(a).localeCompare(trendPickLabel(b));
  });
  const topScore = Math.max(...ordered.map((play) => play.score), 0);
  const gameTime = ordered.find((play) => play.gameTime)?.gameTime || "";
  const gameDate = ordered.find((play) => play.date)?.date || "";
  const lockTime = scheduledLockTime(gameTime);
  const isLocked = ordered.some((play) => play.snapshotStatus === "FINAL_PREGAME");
  const lockMissed = !isLocked && ordered.some((play) => play.snapshotStatus === "MISSED_LOCK");

  return (
    <article className={`card trendGameCard ${topScore >= 75 ? "top" : ""}`}>
      <div className="trendGameHeader">
        <div className="cardTitle">{game}</div>
        {gameTime || gameDate ? <div className="trendGameTimeBox"><strong>{gameTime || "TBD"}</strong>{gameDate ? <small>{gameDate}</small> : null}<small>{isLocked ? "Locked" : lockMissed ? "Lock missed" : "Locks"} {lockTime}</small></div> : null}
      </div>
      <div className="trendSelectionStack">
        {ordered.map((play, index) => (
          <TrendSelectionRow
            key={`${play.gameKey}-${play.market}-${play.selection}-${play.side}-${play.line ?? ""}`}
            play={play}
            selectionRank={index + 1}
            initiallyOpen={index === 0}
          />
        ))}
      </div>
    </article>
  );
}

function SlateCard({ row, splits }: { row: SheetRow; splits: DraftKingsSplit[] }) {
  const game = row.Game || `${row["Away Team"]} @ ${row["Home Team"]}`;
  const gameSplits = splits.filter((split) => textKey(split.game) === textKey(game));
  return (
    <details className="fbSlateCard">
      <summary><strong>{game}</strong><span>{row["Spread Grade"] || "No spread play"} • {row["Total Grade"] || "No total play"}</span></summary>
      <div className="fbSlateBody">
        <div className="fbScore"><span>{row["Away Team"]}</span><b>{num(row["Projected Away"], 1)}</b><span>{row["Home Team"]}</span><b>{num(row["Projected Home"], 1)}</b></div>
        <div className="fbMetrics">
          <div><span>Projected margin</span><strong>{num(row["Projected Margin"], 1)}</strong></div>
          <div><span>Projected total</span><strong>{num(row["Projected Total"], 1)}</strong></div>
          <div><span>Reliability</span><strong>{row.Reliability || "—"}</strong></div>
        </div>
        <div className="fbMarketRow"><b>Spread:</b> {row["Spread Pick"] || "—"} • {pct(row["Spread Probability"])} • {row["Spread Grade"] || "No Play"}</div>
        <div className="fbMarketRow"><b>Total:</b> {row["Total Pick"] || "—"} • {pct(row["Total Probability"])} • {row["Total Grade"] || "No Play"}</div>
        {gameSplits.length ? <div className="fbDkBox"><b>DraftKings</b>{gameSplits.map((split, i) => <span key={`${split.market}-${split.selection}-${i}`}>{split.market}: {split.selection} {split.odds} • {split.betsPct}% bets / {split.moneyPct}% handle</span>)}</div> : null}
      </div>
    </details>
  );
}

export default function FootballBoard({ sport, tab, data }: { sport: Sport; tab: Tab; data: FootballData }) {
  const [weeklyData, setWeeklyData] = useState<WeeklyMarketData | null>(null);
  const [selectedWeek, setSelectedWeek] = useState("");

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    fetch(`/api/football-weekly-market?sport=${sport}`, { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((result) => { if (active && result?.ok) setWeeklyData(result as WeeklyMarketData); })
      .catch(() => undefined);
    return () => { active = false; controller.abort(); };
  }, [sport, data.lastUpdated]);

  const splits = useMemo(() => {
    const map = new Map<string, DraftKingsSplit>();
    for (const split of [...(data.draftKings?.splits || []), ...(weeklyData?.splits || [])]) {
      const key = `${textKey(split.game)}|${split.market}|${textKey(split.market === "Total" ? split.side : split.selectionTeam)}`;
      map.set(key, split);
    }
    return [...map.values()];
  }, [data.draftKings?.splits, weeklyData?.splits]);

  const trends = weeklyData?.trendPlays?.length ? weeklyData.trendPlays : (data.trendPlays || []);
  const trendWeeks = useMemo(() => [...new Set(trends.map(weekLabel))].sort((a, b) => weekSort(a) - weekSort(b) || a.localeCompare(b)), [trends]);
  const fallbackWeek = defaultWeek(trends, data.today);
  const activeWeek = selectedWeek && trendWeeks.includes(selectedWeek) ? selectedWeek : fallbackWeek;
  const filteredTrends = activeWeek ? trends.filter((play) => weekLabel(play) === activeWeek) : trends;

  const trendGroups = [...filteredTrends].reduce((map, play) => {
    const key = play.gameKey || play.game;
    const existing = map.get(key);
    if (existing) existing.plays.push(play);
    else map.set(key, { game: play.game, plays: [play] });
    return map;
  }, new Map<string, { game: string; plays: TrendPlay[] }>());
  const displayedTrendGroups = [...trendGroups.values()].sort((a, b) => {
    const aDate = a.plays.find((play) => play.date)?.date || "";
    const bDate = b.plays.find((play) => play.date)?.date || "";
    if (aDate !== bDate) return aDate.localeCompare(bDate);
    const aTime = gameTimeSortValue(a.plays.find((play) => play.gameTime)?.gameTime);
    const bTime = gameTimeSortValue(b.plays.find((play) => play.gameTime)?.gameTime);
    return aTime - bTime || a.game.localeCompare(b.game);
  });

  const slateRows = useMemo(() => {
    const map = new Map<string, SheetRow>();
    for (const row of weeklyData?.games || []) {
      if (String(row.Date || "") !== data.today) continue;
      const key = String(row["Game Key"] || row["Game ID"] || row.Game || "");
      if (key) map.set(key, row);
    }
    for (const row of data.slateToday || []) {
      const key = String(row["Game Key"] || row["Game ID"] || row.Game || "");
      if (key) map.set(key, row);
    }
    return [...map.values()];
  }, [weeklyData?.games, data.slateToday, data.today]);

  const summaryMap = new Map((data.recordSummary || []).map((row) => [row.betType, row]));
  const last7Map = new Map((data.last7RecordSummary || []).map((row) => [row.betType, row]));

  let content;
  if (tab === "Today’s Best Plays") {
    content = data.bestPlays.length ? <div className="fbGrid">{data.bestPlays.map((play, index) => <BestPlayCard key={`${play.game}-${play.play}-${index}`} play={play} splits={splits} />)}</div> : <div className="fbEmpty">No graded {sport} Best Plays are saved for {data.today}.</div>;
  } else if (tab === "Today’s Trend Plays") {
    content = <>
      <div className="trendWeekControls">
        <label><span>View market week</span><select value={activeWeek} onChange={(event) => setSelectedWeek(event.target.value)} disabled={!trendWeeks.length}>{trendWeeks.length ? trendWeeks.map((week) => <option key={week} value={week}>{week}</option>) : <option value="">No weeks yet</option>}</select></label>
        <div><strong>{activeWeek || "Waiting for DraftKings"}</strong><small>{displayedTrendGroups.length} games stored • games appear here as soon as DraftKings posts them</small></div>
      </div>
      {displayedTrendGroups.length ? <div className="trendGameGrid">{displayedTrendGroups.map((group) => <TrendGameCard key={group.plays[0]?.gameKey || group.game} game={group.game} plays={group.plays} />)}</div> : <div className="fbEmpty">No {sport} DraftKings Spread/Total markets are stored for {activeWeek || "this week"} yet.</div>}
    </>;
  } else if (tab === "EZPZ AI Picks") {
    content = <div className="fbEmpty">{data.aiSelectorStatus?.message || `${sport} AI picks are not enabled yet. Model Best Plays and sport-specific Trend Plays are live.`}</div>;
  } else if (tab === "Full Slate") {
    content = slateRows.length ? <div className="fbSlateStack">{slateRows.map((row, index) => <SlateCard key={`${row["Game Key"] || row["Game ID"] || row.Game}-${index}`} row={row} splits={splits} />)}</div> : <div className="fbEmpty">No {sport} games are posted for {data.today} yet.</div>;
  } else {
    content = <>
      <div className="fbRecordsGrid">
        <RecordTile label="Spread - Last 7" value={last7Map.get("Spread")} />
        <RecordTile label="Spread - Overall" value={summaryMap.get("Spread")} />
        <RecordTile label="Total - Last 7" value={last7Map.get("Total")} />
        <RecordTile label="Total - Overall" value={summaryMap.get("Total")} />
      </div>
      <div className="fbInfo"><b>Trend grading database:</b> {data.database || `${sport} Model Database`}<br />Every Spread/Total signal above is graded only from this sport’s own completed trend history.</div>
    </>;
  }

  const displayTab = tab === "Today’s Trend Plays" ? "Trend Plays" : tab;
  return (
    <section className="footballBoard">
      <div className="fbHead"><div><h2>{sport === "NFL" ? "NFL" : "College Football"} {displayTab}</h2><p>Regression projections • Spread + Total • sport-specific DraftKings trends</p></div><span className={`fbStatus ${data.draftKings?.status === "LIVE" || weeklyData?.trendPlays?.length ? "live" : ""}`}>{data.draftKings?.status === "LIVE" || weeklyData?.trendPlays?.length ? "DraftKings live" : "DraftKings pending"}</span></div>
      {content}
      <style jsx global>{`
        .footballBoard{display:grid;gap:18px}.fbHead{display:flex;justify-content:space-between;gap:16px;align-items:flex-end}.fbHead h2{margin:0 0 4px}.fbHead p,.fbMuted{color:var(--ez-muted);margin:0}.fbStatus{border:1px solid var(--ez-border);border-radius:999px;padding:7px 11px;color:var(--ez-muted)}.fbStatus.live{color:var(--ez-green);border-color:rgba(43,216,117,.35)}
        .fbGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(285px,1fr));gap:14px}.fbCard,.fbSlateCard,.fbRecordTile,.fbInfo,.fbEmpty{border:1px solid var(--ez-border);background:linear-gradient(145deg,var(--ez-panel),var(--ez-panel-2));border-radius:20px;padding:16px}.fbCardTop{display:flex;justify-content:space-between;gap:8px;color:var(--ez-muted);font-size:.82rem}.fbGrade{color:var(--ez-blue-soft);font-weight:800;text-transform:uppercase}.fbCard h3{font-size:1.28rem;margin:12px 0}.fbMetrics{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.fbMetrics div{background:rgba(255,255,255,.025);border:1px solid var(--ez-border);border-radius:12px;padding:9px}.fbMetrics span{display:block;color:var(--ez-muted);font-size:.72rem}.fbMetrics strong{display:block;margin-top:4px}.fbDkBox{display:grid;gap:4px;margin-top:12px;border-left:3px solid var(--ez-blue);padding:9px 10px;background:rgba(47,140,255,.07);border-radius:10px}.fbDkBox span{color:var(--ez-muted);font-size:.82rem}
        .trendWeekControls{display:flex;align-items:end;justify-content:space-between;gap:14px;border:1px solid rgba(78,145,255,.22);background:linear-gradient(145deg,rgba(9,20,39,.88),rgba(5,13,26,.9));border-radius:18px;padding:13px 15px}.trendWeekControls label{display:grid;gap:6px}.trendWeekControls label span,.trendWeekControls small{color:var(--ez-muted);font-size:.74rem}.trendWeekControls select{min-width:150px;border:1px solid rgba(92,138,202,.28);background:#081427;color:#f3f7ff;border-radius:11px;padding:9px 12px;font-weight:850;outline:none}.trendWeekControls>div{display:grid;justify-items:end;gap:3px;text-align:right}.trendWeekControls strong{color:#f2f7ff;font-size:1rem}
        .trendGameGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,350px),1fr));gap:17px;align-items:start}.card{position:relative;overflow:hidden;min-width:0;border-radius:24px;border:1px solid var(--ez-border);padding:18px;background:linear-gradient(145deg,var(--ez-panel),var(--ez-panel-2))}.trendGameCard{border-color:rgba(78,145,255,.25)}.trendGameCard::before{content:"";position:absolute;inset:14px auto 14px 0;width:3px;border-radius:0 3px 3px 0;background:linear-gradient(180deg,#7c8cff,var(--ez-blue));box-shadow:0 0 22px rgba(91,123,255,.34)}.trendGameHeader{position:relative;z-index:2;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:13px}.cardTitle{color:#f4f8ff;font-size:18px;font-weight:950;line-height:1.2}.trendGameTimeBox{flex:0 0 auto;display:grid;gap:2px;border:1px solid rgba(91,143,214,.18);border-radius:13px;padding:7px 9px;background:rgba(8,19,36,.68);color:rgba(188,210,238,.88);font-size:10px}.trendGameTimeBox small{color:rgba(113,184,255,.92);font-size:9px;font-weight:900}.trendSelectionStack{position:relative;z-index:2;display:grid;gap:9px}.trendSelectionRow{overflow:hidden;border:1px solid rgba(100,139,190,.15);border-radius:17px;background:rgba(4,11,23,.62)}.trendSelectionRow.leader{border-color:rgba(70,155,255,.3);background:rgba(7,22,46,.72)}.trendSelectionSummary{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;align-items:center;gap:10px;padding:11px 12px;cursor:pointer;list-style:none}.trendSelectionSummary::-webkit-details-marker{display:none}.trendSelectionRank{display:grid;place-items:center;width:34px;height:34px;border-radius:11px;color:#c8d9ee;background:rgba(29,76,139,.18);font-size:12px;font-weight:950}.trendSelectionIdentity{display:grid;gap:4px;min-width:0}.trendSelectionIdentity strong{overflow:hidden;color:#f2f7ff;font-size:15px;font-weight:950;text-overflow:ellipsis;white-space:nowrap}.trendSelectionIdentity small{overflow:hidden;color:rgba(145,174,209,.72);font-size:9px;line-height:1.25;text-overflow:ellipsis;white-space:nowrap}.trendSelectionMarket{display:grid;justify-items:end;gap:2px;min-width:88px}.trendSelectionMarket small{color:rgba(154,182,215,.74);font-size:8px;font-weight:900;letter-spacing:.04em;text-transform:uppercase}.trendSelectionMarket strong{color:#f4f8ff;font-size:24px;font-weight:950;line-height:1}.trendSelectionChevron{color:rgba(163,191,225,.68);font-size:18px;transition:transform .2s ease}.trendSelectionRow[open] .trendSelectionChevron{transform:rotate(180deg)}.trendSelectionBody{border-top:1px solid rgba(100,139,190,.12);padding:12px}.bubbleGrid{display:grid;gap:8px}.trendSelectionMetrics{grid-template-columns:repeat(4,minmax(0,1fr))}.miniBubble{min-width:0;border-radius:15px;padding:11px 12px;background:linear-gradient(145deg,rgba(12,22,39,.82),rgba(6,13,25,.84));border:1px solid rgba(108,142,187,.14);box-shadow:inset 0 1px 0 rgba(255,255,255,.018)}.miniLabel{color:rgba(142,169,203,.68);font-size:8px;font-weight:800;letter-spacing:.03em;text-transform:uppercase}.miniValue{margin-top:4px;color:#eef5ff;font-size:13px;font-weight:900;white-space:nowrap}.trendRecordGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:10px}.trendRecordCard{border:1px solid rgba(100,139,190,.13);border-radius:13px;padding:9px 10px;background:rgba(6,14,27,.64)}.trendRecordCard span{display:block;color:rgba(145,174,209,.65);font-size:8px;font-weight:800;text-transform:uppercase}.trendRecordCard strong{display:block;margin-top:3px;color:#f0f6ff;font-size:13px}.trendSignalBox{display:grid;gap:3px;margin-top:10px;border-left:3px solid var(--ez-blue);padding:9px 10px;border-radius:10px;background:rgba(47,140,255,.07)}.trendSignalBox b{color:#f3f7ff;font-size:12px}.trendSignalBox span,.trendMovement{color:var(--ez-muted);font-size:10px}.trendMovement{margin-top:8px}.trendTrackingStrip{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px;padding-top:12px;border-top:1px solid rgba(100,139,190,.10)}.trendTrackingStrip span{border:1px solid rgba(100,139,190,.14);border-radius:999px;padding:6px 9px;background:rgba(8,18,34,.6);color:rgba(153,181,214,.76);font-size:9px;font-weight:800}
        .fbSlateStack{display:grid;gap:10px}.fbSlateCard{padding:0;overflow:hidden}.fbSlateCard summary{cursor:pointer;list-style:none;padding:15px;display:flex;justify-content:space-between;gap:10px}.fbSlateCard summary span{color:var(--ez-muted);font-size:.8rem}.fbSlateBody{display:grid;gap:12px;padding:0 15px 15px}.fbScore{display:grid;grid-template-columns:1fr auto;gap:7px 12px}.fbScore b{font-size:1.25rem}.fbMarketRow{padding:9px;border-radius:10px;background:rgba(255,255,255,.025)}.fbRecordsGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.fbRecordTile{display:grid;gap:6px}.fbRecordTile span,.fbRecordTile small{color:var(--ez-muted)}.fbRecordTile strong{font-size:1.45rem}.fbInfo{color:var(--ez-muted);line-height:1.7}.fbEmpty{color:var(--ez-muted);text-align:center;padding:30px}
        @media(max-width:620px){.fbHead{align-items:flex-start;flex-direction:column}.fbMetrics{grid-template-columns:1fr}.fbSlateCard summary{flex-direction:column}.trendWeekControls{align-items:stretch;flex-direction:column}.trendWeekControls>div{justify-items:start;text-align:left}.trendWeekControls select{width:100%}.card{border-radius:22px;padding:16px}.trendGameHeader{gap:9px}.trendSelectionRank{width:30px;height:30px}.trendSelectionIdentity strong{font-size:13px}.trendSelectionMarket{min-width:66px}.trendSelectionMarket small{max-width:70px;text-align:right}.trendSelectionMarket strong{font-size:21px}.trendSelectionChevron{display:none}.trendSelectionMetrics{grid-template-columns:repeat(2,minmax(0,1fr))}.trendRecordGrid{grid-template-columns:1fr}}
      `}</style>
    </section>
  );
}