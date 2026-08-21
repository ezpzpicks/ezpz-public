"use client";

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
  game: string; gameKey: string; market: "Spread" | "Total"; selection: string;
  selectionTeam: string; side: "Over" | "Under" | ""; line: number | null; odds: string;
  betsPct: number; moneyPct: number; gapPct: number; score: number; tier: "Pass" | "Good" | "Strong" | "Elite";
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
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
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

function TrendCard({ play }: { play: TrendPlay }) {
  const primary = play.signals?.[0];
  return (
    <article className={`fbCard fbTrend ${play.tier.toLowerCase()}`}>
      <div className="fbCardTop"><span className="fbGrade">{play.tier} Trend</span><span>{play.market}</span></div>
      <h3>{play.market === "Total" ? `${play.side} ${play.line ?? ""}` : `${play.selection} ${play.line ?? ""}`}</h3>
      <p className="fbGame">{play.game}</p>
      <div className="fbMetrics">
        <div><span>Trend score</span><strong>{Math.round(play.score)}</strong></div>
        <div><span>Bets</span><strong>{play.betsPct}%</strong></div>
        <div><span>Handle</span><strong>{play.moneyPct}%</strong></div>
      </div>
      {primary ? (
        <div className="fbDkBox">
          <b>{primary.signal}</b>
          <span>All time {primary.records.allTime.record} • Last 30 {primary.records.last30.record} • Last 7 {primary.records.last7.record}</span>
          <span>{primary.recordScope} • exact sample {primary.exactSample}</span>
        </div>
      ) : null}
      {play.lineMovementSignal ? <div className="fbMuted">{play.lineMovementSignal}</div> : null}
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
  const splits = data.draftKings?.splits || [];
  const trends = data.trendPlays || [];
  const qualifiedTrends = trends.filter((play) => play.tier !== "Pass").sort((a, b) => b.score - a.score);
  const summaryMap = new Map((data.recordSummary || []).map((row) => [row.betType, row]));
  const last7Map = new Map((data.last7RecordSummary || []).map((row) => [row.betType, row]));

  let content;
  if (tab === "Today’s Best Plays") {
    content = data.bestPlays.length ? <div className="fbGrid">{data.bestPlays.map((play, index) => <BestPlayCard key={`${play.game}-${play.play}-${index}`} play={play} splits={splits} />)}</div> : <div className="fbEmpty">No graded {sport} Best Plays are saved for {data.today}.</div>;
  } else if (tab === "Today’s Trend Plays") {
    content = qualifiedTrends.length ? <div className="fbGrid">{qualifiedTrends.map((play, index) => <TrendCard key={`${play.gameKey}-${play.market}-${play.selection}-${index}`} play={play} />)}</div> : <div className="fbEmpty">No {sport} Spread/Total trend has reached the Good/Strong/Elite grading requirement yet. Trend history is isolated to {sport}.</div>;
  } else if (tab === "EZPZ AI Picks") {
    content = <div className="fbEmpty">{data.aiSelectorStatus?.message || `${sport} AI picks are not enabled yet. Model Best Plays and sport-specific Trend Plays are live.`}</div>;
  } else if (tab === "Full Slate") {
    content = data.slateToday.length ? <div className="fbSlateStack">{data.slateToday.map((row, index) => <SlateCard key={`${row["Game ID"] || row.Game}-${index}`} row={row} splits={splits} />)}</div> : <div className="fbEmpty">No {sport} games are saved for {data.today}.</div>;
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

  return (
    <section className="footballBoard">
      <div className="fbHead"><div><h2>{sport === "NFL" ? "NFL" : "College Football"} {tab}</h2><p>Regression projections • Spread + Total • sport-specific DraftKings trends</p></div><span className={`fbStatus ${data.draftKings?.status === "LIVE" ? "live" : ""}`}>{data.draftKings?.status === "LIVE" ? "DraftKings live" : "DraftKings pending"}</span></div>
      {content}
      <style jsx>{`
        .footballBoard{display:grid;gap:18px}.fbHead{display:flex;justify-content:space-between;gap:16px;align-items:flex-end}.fbHead h2{margin:0 0 4px}.fbHead p,.fbMuted,.fbGame{color:var(--ez-muted);margin:0}.fbStatus{border:1px solid var(--ez-border);border-radius:999px;padding:7px 11px;color:var(--ez-muted)}.fbStatus.live{color:var(--ez-green);border-color:rgba(43,216,117,.35)}.fbGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(285px,1fr));gap:14px}.fbCard,.fbSlateCard,.fbRecordTile,.fbInfo,.fbEmpty{border:1px solid var(--ez-border);background:linear-gradient(145deg,var(--ez-panel),var(--ez-panel-2));border-radius:20px;padding:16px}.fbCardTop{display:flex;justify-content:space-between;gap:8px;color:var(--ez-muted);font-size:.82rem}.fbGrade{color:var(--ez-blue-soft);font-weight:800;text-transform:uppercase}.fbCard h3{font-size:1.28rem;margin:12px 0}.fbMetrics{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.fbMetrics div{background:rgba(255,255,255,.025);border:1px solid var(--ez-border);border-radius:12px;padding:9px}.fbMetrics span{display:block;color:var(--ez-muted);font-size:.72rem}.fbMetrics strong{display:block;margin-top:4px}.fbDkBox{display:grid;gap:4px;margin-top:12px;border-left:3px solid var(--ez-blue);padding:9px 10px;background:rgba(47,140,255,.07);border-radius:10px}.fbDkBox span{color:var(--ez-muted);font-size:.82rem}.fbSlateStack{display:grid;gap:10px}.fbSlateCard{padding:0;overflow:hidden}.fbSlateCard summary{cursor:pointer;list-style:none;padding:15px;display:flex;justify-content:space-between;gap:10px}.fbSlateCard summary span{color:var(--ez-muted);font-size:.8rem}.fbSlateBody{display:grid;gap:12px;padding:0 15px 15px}.fbScore{display:grid;grid-template-columns:1fr auto;gap:7px 12px}.fbScore b{font-size:1.25rem}.fbMarketRow{padding:9px;border-radius:10px;background:rgba(255,255,255,.025)}.fbRecordsGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.fbRecordTile{display:grid;gap:6px}.fbRecordTile span,.fbRecordTile small{color:var(--ez-muted)}.fbRecordTile strong{font-size:1.45rem}.fbInfo{color:var(--ez-muted);line-height:1.7}.fbEmpty{color:var(--ez-muted);text-align:center;padding:30px}@media(max-width:620px){.fbHead{align-items:flex-start;flex-direction:column}.fbMetrics{grid-template-columns:1fr}.fbSlateCard summary{flex-direction:column}}
      `}</style>
    </section>
  );
}
