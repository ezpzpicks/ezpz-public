from pathlib import Path
import re


def replace_once(path: Path, old: str, new: str, label: str):
    text = path.read_text()
    if new in text:
        print(f"{label}: already applied")
        return False
    if old not in text:
        raise SystemExit(f"Could not find patch target: {label}")
    path.write_text(text.replace(old, new, 1))
    print(f"{label}: applied")
    return True


def regex_once(path: Path, pattern: str, replacement: str, label: str):
    text = path.read_text()
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"Could not uniquely patch {label}: {count} matches")
    path.write_text(updated)
    print(f"{label}: applied")


board = Path("app/FootballBoard.tsx")

helpers = r'''
type FbFormWindow = "last7Days" | "last7Bets";
type FbRecordType = "Favorite Spread" | "Underdog Spread" | "Over" | "Under";
type FbFormInfo = {
  label: "Hot" | "Cold" | "Neutral" | "Small Sample" | "Need 7 Bets";
  icon: string;
  className: "hot" | "cold" | "neutral" | "sample";
  detail: string;
};

const FB_RECORD_TYPES: FbRecordType[] = ["Favorite Spread", "Underdog Spread", "Over", "Under"];

function fbTrailingLine(value: unknown) {
  const match = String(value || "").replace(/[−–—]/g, "-").match(/([+-]?\d+(?:\.\d+)?)\s*$/);
  const parsed = match ? Number(match[1]) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function fbFormInfo(summary: Summary | null, window: FbFormWindow): FbFormInfo {
  const record = summary ? `${summary.wins}-${summary.losses}-${summary.pushes}` : "0-0-0";
  const totalBets = summary?.totalBets || 0;

  if (window === "last7Bets") {
    if (!summary || totalBets < 7) {
      return { label: "Need 7 Bets", icon: "➖", className: "sample", detail: `${record} • ${totalBets}/7 completed` };
    }
    if (summary.wins >= 5) return { label: "Hot", icon: "🔥", className: "hot", detail: `${record} most recent` };
    if (summary.losses >= 5) return { label: "Cold", icon: "❄️", className: "cold", detail: `${record} most recent` };
    return { label: "Neutral", icon: "➖", className: "neutral", detail: `${record} most recent` };
  }

  if (!summary || totalBets < 5) {
    return { label: "Small Sample", icon: "⚠️", className: "sample", detail: `${record} • ${totalBets}/5 minimum` };
  }
  if (summary.wins > summary.losses && summary.winPct >= 60) {
    return { label: "Hot", icon: "🔥", className: "hot", detail: `${record} in 7 days` };
  }
  if (summary.losses > summary.wins && summary.winPct <= 40) {
    return { label: "Cold", icon: "❄️", className: "cold", detail: `${record} in 7 days` };
  }
  return { label: "Neutral", icon: "➖", className: "neutral", detail: `${record} in 7 days` };
}

function FbFormTag({ summary, window }: { summary: Summary | null; window: FbFormWindow }) {
  const form = fbFormInfo(summary, window);
  const periodLabel = window === "last7Days" ? "7 Days" : "Last 7 Bets";
  return (
    <div className={`formPill ${form.className}`} title="Record context only; this does not change the current model score.">
      {form.icon} {periodLabel}: {form.label}{" "}
      <span style={{ opacity: 0.72 }}>• {form.detail}</span>
    </div>
  );
}

function fbComparableGame(value: unknown) {
  return textKey(value).replace(/\b(?:at|vs|versus)\b/g, " ").replace(/\s+/g, " ").trim();
}

function fbRecordTypeForSelection(market: "Spread" | "Total", selection: unknown, line: number | null): FbRecordType | null {
  if (market === "Total") {
    const side = textKey(selection);
    if (side.startsWith("over")) return "Over";
    if (side.startsWith("under")) return "Under";
    return null;
  }
  if (line == null || Math.abs(line) < 1e-9) return null;
  return line < 0 ? "Favorite Spread" : "Underdog Spread";
}

function fbTrackerRecordType(row: SheetRow): FbRecordType | null {
  const marketKey = textKey(row["Bet Type"] || row.Market);
  if (marketKey.includes("total")) return fbRecordTypeForSelection("Total", row.Selection, fbTrailingLine(row.Selection));
  if (marketKey.includes("spread")) return fbRecordTypeForSelection("Spread", row.Selection, fbTrailingLine(row.Selection));
  return null;
}

function fbBestPlayRecordType(play: Play, split?: DraftKingsSplit): FbRecordType | null {
  const market: "Spread" | "Total" = textKey(play.role || play.playType).includes("total") ? "Total" : "Spread";
  if (market === "Total") return fbRecordTypeForSelection(market, split?.side || play.play, split?.line ?? fbTrailingLine(play.play));
  return fbRecordTypeForSelection(market, play.play, split?.line ?? fbTrailingLine(play.play));
}

function fbPickSplit(pick: EzpzPick, splits: DraftKingsSplit[]) {
  const sameGame = (split: DraftKingsSplit) => fbComparableGame(split.game) === fbComparableGame(pick.game);
  if (pick.market === "Total") {
    const side = textKey(pick.selection).startsWith("under") ? "Under" : "Over";
    return splits.find((split) => split.market === "Total" && split.side === side && sameGame(split));
  }
  const selection = String(pick.selection || "").replace(/\s+[+-]?\d+(?:\.\d+)?\s*$/, "").trim();
  return splits.find((split) => split.market === "Spread" && sameGame(split) && sameSlateTeam(split.selectionTeam, selection));
}

function fbEzpzRecordType(pick: EzpzPick, splits: DraftKingsSplit[]): FbRecordType | null {
  const split = fbPickSplit(pick, splits);
  return fbRecordTypeForSelection(pick.market, pick.market === "Total" ? split?.side || pick.selection : pick.selection, split?.line ?? fbTrailingLine(pick.selection));
}

function fbTodayRecordMap(rows: SheetRow[], today: string) {
  return new Map<string, Summary>(FB_RECORD_TYPES.map((betType) => {
    const matching = rows.filter((row) => fbResult(row.Result || row.Status) && fbDate(row.Date) === today && fbTrackerRecordType(row) === betType);
    return [betType, fbSummary(betType, fbTotals(matching, today))];
  }));
}

function fbLastSevenBetsRecordMap(rows: SheetRow[], today: string) {
  return new Map<string, Summary>(FB_RECORD_TYPES.map((betType) => {
    const matching = rows
      .map((row, index) => ({ row, index, stamp: Date.parse(`${fbDate(row.Date)}T12:00:00Z`) || 0 }))
      .filter(({ row }) => fbResult(row.Result || row.Status) && fbTrackerRecordType(row) === betType)
      .sort((a, b) => b.stamp - a.stamp || b.index - a.index)
      .slice(0, 7)
      .map(({ row }) => row);
    return [betType, fbSummary(betType, fbTotals(matching, today))];
  }));
}

function fbAiSummaryRecord(summary: Summary | null) {
  return summary?.totalBets ? `${summary.wins}-${summary.losses}-${summary.pushes}` : "—";
}

function fbAiSummaryRoi(summary: Summary | null) {
  if (!summary?.totalBets) return "—";
  const value = Number(summary.roiPct || 0);
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function fbSignedPercent(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function fbTrendPlayForPick(pick: EzpzPick, trendPlays: TrendPlay[]) {
  const sameMarket = trendPlays.filter((play) => fbComparableGame(play.game) === fbComparableGame(pick.game) && play.market === pick.market);
  if (pick.market === "Total") {
    const wantedSide = textKey(pick.selection).startsWith("under") ? "under" : "over";
    return sameMarket.find((play) => textKey(play.side) === wantedSide) || null;
  }
  const pickTeam = textKey(String(pick.selection || "").replace(/\s+[+-]?\d+(?:\.\d+)?\s*$/, ""));
  return sameMarket.find((play) => {
    const trendTeam = textKey(play.selectionTeam || play.selection);
    return Boolean(trendTeam && (pickTeam === trendTeam || pickTeam.includes(trendTeam) || trendTeam.includes(pickTeam)));
  }) || null;
}

function fbTrendSignalRoi(signal: TrendSignal) {
  const records = signal.records;
  const last7Decisions = records.last7.wins + records.last7.losses;
  const last7Weight = Math.min(0.5, Math.max(0, last7Decisions) * 0.1);
  const carry = (0.5 - last7Weight) / 2;
  const windows = [
    { record: records.allTime, weight: 0.25 + carry },
    { record: records.last30, weight: 0.25 + carry },
    { record: records.last7, weight: last7Weight },
  ].filter((item) => item.record.totalBets > 0 && item.weight > 0);
  if (!windows.length) return null;
  const totalWeight = windows.reduce((sum, item) => sum + item.weight, 0);
  return windows.reduce((sum, item) => sum + item.record.roiPct * item.weight, 0) / totalWeight;
}

function fbTrendPlayRoi(play: TrendPlay) {
  const signalRois = (play.signals || []).map(fbTrendSignalRoi).filter((value): value is number => value != null && Number.isFinite(value));
  return signalRois.length ? signalRois.reduce((sum, value) => sum + value, 0) / signalRois.length : null;
}

function fbTrendNetRoiSummary(play: TrendPlay, trendPlays: TrendPlay[]) {
  const candidateRoiPct = fbTrendPlayRoi(play);
  if (candidateRoiPct == null) return null;
  const sideKey = play.market === "Total" ? textKey(play.side) : textKey(play.selectionTeam || play.selection);
  const opponents = trendPlays
    .filter((candidate) => fbComparableGame(candidate.game) === fbComparableGame(play.game) && candidate.market === play.market)
    .filter((candidate) => (candidate.market === "Total" ? textKey(candidate.side) : textKey(candidate.selectionTeam || candidate.selection)) !== sideKey)
    .map((candidate) => ({ play: candidate, roiPct: fbTrendPlayRoi(candidate) }))
    .filter((candidate): candidate is { play: TrendPlay; roiPct: number } => candidate.roiPct != null && Number.isFinite(candidate.roiPct))
    .sort((a, b) => b.roiPct - a.roiPct);
  const opponent = opponents[0];
  if (!opponent) return null;
  return { candidateRoiPct, opponentRoiPct: opponent.roiPct, netRoiPct: candidateRoiPct - opponent.roiPct };
}

'''

text = board.read_text()
if "type FbFormWindow" not in text:
    anchor = "function BestPlayCard("
    if anchor not in text:
        raise SystemExit("Could not find BestPlayCard insertion anchor")
    board.write_text(text.replace(anchor, helpers + anchor, 1))
    print("Add MLB-parity CFB form and ROI helpers: applied")
else:
    print("Add MLB-parity CFB form and ROI helpers: already applied")

best_play_replacement = r'''function BestPlayCard({ play, splits, index, recentByType, lastSevenBetsByType }: { play: Play; splits: DraftKingsSplit[]; index: number; recentByType: Map<string, Summary>; lastSevenBetsByType: Map<string, Summary> }) {
  const split = selectedSplit(play, splits);
  const roleKey = textKey(play.role || play.playType);
  const market = roleKey.includes("total") ? "Total" : "Spread";
  const recordType = fbBestPlayRecordType(play, split);
  const recentSummary = recordType ? recentByType.get(recordType) || null : null;
  const lastSevenBetsSummary = recordType ? lastSevenBetsByType.get(recordType) || null : null;
  const scoreValue = Number(play.score);
  const scoreLabel = Number.isFinite(scoreValue)
    ? (scoreValue <= 1 ? scoreValue * 100 : scoreValue).toFixed(1)
    : "—";
  const odds = play.oddsLine || split?.odds || "—";
  const topPlay = index < 3;

  return (
    <article className={`card green fade-in best footballBestCard ${topPlay ? "top" : ""}`}>
      <div className="cardTop">
        <div className="rankBadge">#{index + 1}</div>
        <div className="scorePill" aria-label={`Model probability ${scoreLabel}%`}>
          <span className="scorePillLabel">MODEL</span>
          <strong>{scoreLabel}</strong>
          <span className="scorePillSub">WIN %</span>
        </div>
      </div>

      <div className="cardSub footballMatchup">{play.game}</div>

      <div className="projectionBlock footballProjectionBlock">
        <div className="projection footballProjection">{play.play}</div>
        <div className="grade">{play.playType}</div>
      </div>

      <div className="divider" />

      <div className="bubbleGrid footballBestMetrics">
        <MiniBubble label="Odds" value={odds} green />
        <MiniBubble label="Model Probability" value={pct(play.score)} green />
        <MiniBubble label="Reliability" value={play.reliability || "—"} green />
        <MiniBubble label="Market" value={market} green />
      </div>

      {recordType ? (
        <div className="formRow">
          <FbFormTag summary={recentSummary} window="last7Days" />
          <FbFormTag summary={lastSevenBetsSummary} window="last7Bets" />
        </div>
      ) : null}

      {split ? (
        <div className="publicSplitPanel footballPublicSplitPanel">
          <div className="publicSplitTitle">
            <span>DraftKings market</span>
            <strong>{split.selection || play.play}</strong>
          </div>
          <div className="footballSplitGrid">
            <MiniBubble label="Bets" value={`${split.betsPct}%`} />
            <MiniBubble label="Handle" value={`${split.moneyPct}%`} />
            <MiniBubble label="Handle − Bets" value={`${split.gapPct >= 0 ? "+" : ""}${split.gapPct}%`} />
          </div>
          {split.warning ? <div className="footballSplitSignal">{split.warning}</div> : null}
          {split.lineMovementSignal ? <div className="footballSplitSignal">{split.lineMovementSignal}</div> : null}
        </div>
      ) : (
        <div className="modelMeta footballModelMeta">
          <span>DraftKings selected-side split pending</span>
        </div>
      )}

      <div className="modelMeta footballModelMeta">
        <span>{recordType || "Regression model"}</span>
        <span>Spread + Total workflow</span>
      </div>
    </article>
  );
}

function MiniBubble'''
regex_once(board, r'function BestPlayCard\([\s\S]*?\n}\n\nfunction MiniBubble', best_play_replacement, "Add MLB form badges to football Model Play cards")

ezpz_replacement = r'''function EzpzPickCard({
  pick,
  splits,
  trendPlays,
  slateRows,
  todayByType,
  recentByType,
  lastSevenBetsByType,
  overallByType,
}: {
  pick: EzpzPick;
  splits: DraftKingsSplit[];
  trendPlays: TrendPlay[];
  slateRows: SheetRow[];
  todayByType: Map<string, Summary>;
  recentByType: Map<string, Summary>;
  lastSevenBetsByType: Map<string, Summary>;
  overallByType: Map<string, Summary>;
}) {
  const trendPlay = pick.source === "Trend Play" ? fbTrendPlayForPick(pick, trendPlays) : null;
  const trendRoiSummary = trendPlay ? fbTrendNetRoiSummary(trendPlay, trendPlays) : null;
  const recordType = pick.source !== "Trend Play" ? fbEzpzRecordType(pick, splits) : null;
  const todaySummary = recordType ? todayByType.get(recordType) || null : null;
  const last7DaysSummary = recordType ? recentByType.get(recordType) || null : null;
  const lastSevenBetsSummary = recordType ? lastSevenBetsByType.get(recordType) || null : null;
  const overallSummary = recordType ? overallByType.get(recordType) || null : null;
  const bestPlayGate = recordType ? fbFormInfo(lastSevenBetsSummary, "last7Bets") : null;
  const slateRow = slateRows.find((row) => fbComparableGame(row.Game || `${row["Away Team"]} @ ${row["Home Team"]}`) === fbComparableGame(pick.game));
  const timeLabel = trendPlay?.gameTime || String(slateRow?.["Game Time"] || slateRow?.Time || "TBD");
  const isFinal = pick.source !== "Trend Play" || trendPlay?.snapshotStatus === "FINAL_PREGAME";

  return (
    <details className="aiPickDropdown">
      <summary className="aiPickSummary">
        <div className="aiPickSummaryTime">
          <strong>{timeLabel}</strong>
          <span>{pick.market}</span>
        </div>
        <div className="aiPickSummaryMain">
          <div className="aiPickSummaryMeta">
            <span>{pick.game}</span>
            <span className={`aiStatusBadge ${isFinal ? "final" : "pending"}`}>
              {isFinal ? "FINAL" : "LIVE — NOT LOCKED"}
            </span>
          </div>
          <strong>{pick.selection}</strong>
        </div>
        <div className="aiPickSummaryOdds">{pick.odds || "—"}</div>
        <span className="aiPickChevron" aria-hidden="true">⌄</span>
      </summary>

      <div className="aiPickExpanded">
        <div className="aiPickExpandedHead">
          <span>EZPZ PICK</span>
          <strong>{pick.selection}</strong>
          <small>{pick.game}</small>
        </div>

        {bestPlayGate && recordType ? (
          <section className={`aiPickQualificationGate ${bestPlayGate.className}`}>
            <div className="aiPickQualificationGateHead">
              <div>
                <span>Best Play Record Snapshot</span>
                <strong>{recordType}</strong>
              </div>
              <span className={`formPill ${bestPlayGate.className}`}>
                {bestPlayGate.icon} Last 7 Bets: {bestPlayGate.label}
              </span>
            </div>
            <div className="aiPickGateGrid">
              <div className="aiPickGateMetric">
                <span>Today</span>
                <strong>{fbAiSummaryRecord(todaySummary)}</strong>
                <small>ROI {fbAiSummaryRoi(todaySummary)}</small>
              </div>
              <div className="aiPickGateMetric">
                <span>Last 7 Days</span>
                <strong>{fbAiSummaryRecord(last7DaysSummary)}</strong>
                <small>ROI {fbAiSummaryRoi(last7DaysSummary)}</small>
              </div>
              <div className="aiPickGateMetric">
                <span>Last 7 Bets</span>
                <strong>{fbAiSummaryRecord(lastSevenBetsSummary)}</strong>
                <small>ROI {fbAiSummaryRoi(lastSevenBetsSummary)}</small>
              </div>
              <div className="aiPickGateMetric">
                <span>Overall</span>
                <strong>{fbAiSummaryRecord(overallSummary)}</strong>
                <small>Final Net ROI {fbAiSummaryRoi(overallSummary)}</small>
              </div>
            </div>
          </section>
        ) : null}

        {trendPlay?.signals?.length ? (
          <section className="aiPickDetailSection historical aiTrendEvidence">
            <div className="aiTrendEvidenceHead">
              <div>
                <h3>Trend Evidence</h3>
                <p>Historical market-signal performance behind this Trend Play.</p>
              </div>
              <span className="aiTrendTierPill">{trendPlay.tier}</span>
            </div>

            {trendRoiSummary ? (
              <div className="aiTrendNetRoiCard">
                <div className="aiTrendNetRoiMain">
                  <div>
                    <span>Final Net ROI</span>
                    <small>Recent-window ROI edge versus the opposing side</small>
                  </div>
                  <strong className={trendRoiSummary.netRoiPct >= 0 ? "positive" : "negative"}>
                    {fbSignedPercent(trendRoiSummary.netRoiPct)}
                  </strong>
                </div>
                <div className="aiTrendNetRoiBreakdown">
                  <span>Selected side <b>{fbSignedPercent(trendRoiSummary.candidateRoiPct)}</b></span>
                  <span>Opposing side <b>{fbSignedPercent(trendRoiSummary.opponentRoiPct)}</b></span>
                </div>
              </div>
            ) : null}

            <div className="aiTrendSignalList">
              {trendPlay.signals.map((signal, signalIndex) => (
                <div className="aiTrendSignalCard" key={`${signal.signal}-${signalIndex}`}>
                  <div className="aiTrendSignalName">{signal.signal}</div>
                  <div className="aiTrendSignalStats">
                    <div>
                      <span>Overall</span>
                      <strong>{signal.records.allTime.record}</strong>
                      <small className={signal.records.allTime.roiPct >= 0 ? "positive" : "negative"}>{fbSignedPercent(signal.records.allTime.roiPct)} ROI</small>
                    </div>
                    <div>
                      <span>Last 30</span>
                      <strong>{signal.records.last30.record}</strong>
                      <small className={signal.records.last30.roiPct >= 0 ? "positive" : "negative"}>{fbSignedPercent(signal.records.last30.roiPct)} ROI</small>
                    </div>
                    <div>
                      <span>Last 7</span>
                      <strong>{signal.records.last7.record}</strong>
                      <small className={signal.records.last7.roiPct >= 0 ? "positive" : "negative"}>{fbSignedPercent(signal.records.last7.roiPct)} ROI</small>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="aiPickDetailSection data">
          <h3>Data Status</h3>
          <ul>
            <li>{pick.qualification}</li>
            <li>Max favorite price -150</li>
          </ul>
        </section>
      </div>
    </details>
  );
}

function SlateCard'''
regex_once(board, r'function EzpzPickCard\([\s\S]*?\n}\n\nfunction SlateCard', ezpz_replacement, "Match football EZPZ card layout to MLB")

replace_once(
    board,
    '  const summaryMap = new Map((data.recordSummary || []).map((row) => [row.betType, row]));\n  const last7Map = new Map((data.last7RecordSummary || []).map((row) => [row.betType, row]));\n',
    '  const summaryMap = new Map<string, Summary>((data.recordSummary || []).map((row) => [row.betType, row]));\n  const last7Map = new Map<string, Summary>((data.last7RecordSummary || []).map((row) => [row.betType, row]));\n  const trackerRows = data.betTrackerRows || [];\n  const todayByType = fbTodayRecordMap(trackerRows, data.today);\n  const lastSevenBetsByType = fbLastSevenBetsRecordMap(trackerRows, data.today);\n',
    "Build football Today and Last 7 Bets record maps",
)

replace_once(
    board,
    '    content = data.bestPlays.length ? <div className="fbGrid">{data.bestPlays.map((play, index) => <BestPlayCard key={`${play.game}-${play.play}-${index}`} play={play} splits={splits} index={index} />)}</div> : <div className="empty footballEmpty">No graded {sport} Best Plays are saved for {data.today}.</div>;\n',
    '    content = data.bestPlays.length ? <div className="fbGrid">{data.bestPlays.map((play, index) => <BestPlayCard key={`${play.game}-${play.play}-${index}`} play={play} splits={splits} index={index} recentByType={last7Map} lastSevenBetsByType={lastSevenBetsByType} />)}</div> : <div className="empty footballEmpty">No graded {sport} Best Plays are saved for {data.today}.</div>;\n',
    "Pass MLB-parity form summaries into Model Play cards",
)

old_ezpz_render = '''      {data.aiPicks?.length ? <div className="fbGrid">{data.aiPicks.map((pick, index) => <EzpzPickCard key={`${pick.game}-${pick.market}-${pick.selection}-${index}`} pick={pick} index={index} />)}</div> : <div className="empty footballEmpty">No {sport} EZPZ Picks qualify right now.</div>}\n'''
new_ezpz_render = '''      {data.aiPicks?.length ? <div className="aiPickStack">{data.aiPicks.map((pick, index) => <EzpzPickCard key={`${pick.game}-${pick.market}-${pick.selection}-${index}`} pick={pick} splits={splits} trendPlays={trends} slateRows={slateRows} todayByType={todayByType} recentByType={last7Map} lastSevenBetsByType={lastSevenBetsByType} overallByType={summaryMap} />)}</div> : <div className="empty footballEmpty">No {sport} EZPZ Picks qualify right now.</div>}\n'''
replace_once(board, old_ezpz_render, new_ezpz_render, "Use MLB EZPZ pick stack and card props")

replace_once(
    board,
    '    const trackerRows = data.betTrackerRows || [];\n    const trendRows = data.trendRecordRows || [];\n',
    '    const trendRows = data.trendRecordRows || [];\n',
    "Reuse hoisted football tracker rows",
)


public_data = Path("lib/footballPublicData.ts")

old_helpers = '''function footballLastSevenForMarket(rows: SheetRow[], market: "Spread" | "Total") {
  const key = textKey(market);
  const completed = rows
    .map((row, index) => ({
      row,
      index,
      stamp: Date.parse(`${isoDate(row.Date)}T12:00:00Z`) || 0,
    }))
    .filter(({ row }) => resultCode(row.Result || row.Status) && textKey(row["Bet Type"] || row.Market).includes(key))
    .sort((a, b) => b.stamp - a.stamp || b.index - a.index)
    .slice(0, 7)
    .map(({ row }) => row);
  return recordTotals(completed);
}
'''
new_helpers = '''type FootballBestRecordType = "Spread" | "Total" | "Favorite Spread" | "Underdog Spread" | "Over" | "Under";

function footballTrackerRecordType(row: SheetRow, sport: FootballSport): FootballBestRecordType | "" {
  const marketKey = textKey(row["Bet Type"] || row.Market);
  if (sport !== "NCAAF") return marketKey.includes("total") ? "Total" : marketKey.includes("spread") ? "Spread" : "";
  if (marketKey.includes("total")) {
    const side = textKey(row.Selection);
    return side.startsWith("under") ? "Under" : side.startsWith("over") ? "Over" : "";
  }
  if (!marketKey.includes("spread")) return "";
  const line = trackerLine(row.Selection);
  return line == null || Math.abs(line) < 1e-9 ? "" : line < 0 ? "Favorite Spread" : "Underdog Spread";
}

function footballLastSevenForType(rows: SheetRow[], recordType: FootballBestRecordType, sport: FootballSport) {
  const completed = rows
    .map((row, index) => ({ row, index, stamp: Date.parse(`${isoDate(row.Date)}T12:00:00Z`) || 0 }))
    .filter(({ row }) => resultCode(row.Result || row.Status) && footballTrackerRecordType(row, sport) === recordType)
    .sort((a, b) => b.stamp - a.stamp || b.index - a.index)
    .slice(0, 7)
    .map(({ row }) => row);
  return recordTotals(completed);
}
'''
replace_once(public_data, old_helpers, new_helpers, "Use side-specific Last 7 Bets records for CFB")

best_split_anchor = '''function footballBestPlaySplit(play: any, splits: DraftKingsSplit[], sport: FootballSport) {
  const sameGame = (split: DraftKingsSplit) =>
    textKey(split.game) === textKey(play.game) ||
    (sameTeam(play.awayTeam, split.awayTeam, sport) && sameTeam(play.homeTeam, split.homeTeam, sport));
  const market = textKey(play.role || play.playType).includes("total") ? "Total" : "Spread";
  if (market === "Total") {
    const side = textKey(play.play).startsWith("under") ? "Under" : "Over";
    return splits.find((split) => split.market === "Total" && split.side === side && sameGame(split));
  }
  const selection = String(play.play || "").replace(/\\s+[+-]?\\d+(?:\\.\\d+)?\\s*$/, "").trim();
  return splits.find((split) => split.market === "Spread" && sameGame(split) && sameTeam(split.selectionTeam, selection, sport));
}
'''
addition = best_split_anchor + '''
function footballBestPlayRecordType(play: any, split: DraftKingsSplit | undefined, sport: FootballSport): FootballBestRecordType {
  const market: "Spread" | "Total" = textKey(play.role || play.playType).includes("total") ? "Total" : "Spread";
  if (sport !== "NCAAF") return market;
  if (market === "Total") return split?.side === "Under" || textKey(play.play).startsWith("under") ? "Under" : "Over";
  if (split?.sideGroup === "Favorite" || split?.sideGroup === "Underdog") return `${split.sideGroup} Spread` as FootballBestRecordType;
  const line = split?.line ?? trackerLine(play.play);
  return line != null && line > 0 ? "Underdog Spread" : "Favorite Spread";
}
'''
replace_once(public_data, best_split_anchor, addition, "Classify CFB Best Plays by favorite/underdog/over/under")

old_loop = '''  const picks: FootballEzpzPick[] = [];
  const formCache = new Map<"Spread" | "Total", ReturnType<typeof recordTotals>>();
  for (const play of best) {
    const market: "Spread" | "Total" = textKey(play.role || play.playType).includes("total") ? "Total" : "Spread";
    const lastSeven = formCache.get(market) || footballLastSevenForMarket(tracker, market);
    formCache.set(market, lastSeven);
    if (footballBestForm(lastSeven) !== "HOT") continue;
    const split = footballBestPlaySplit(play, splits, sport);
    const odds = americanOddsText(split?.odds || play.oddsLine);
'''
new_loop = '''  const picks: FootballEzpzPick[] = [];
  const formCache = new Map<FootballBestRecordType, ReturnType<typeof recordTotals>>();
  for (const play of best) {
    const market: "Spread" | "Total" = textKey(play.role || play.playType).includes("total") ? "Total" : "Spread";
    const split = footballBestPlaySplit(play, splits, sport);
    const recordType = footballBestPlayRecordType(play, split, sport);
    const lastSeven = formCache.get(recordType) || footballLastSevenForType(tracker, recordType, sport);
    formCache.set(recordType, lastSeven);
    if (footballBestForm(lastSeven) !== "HOT") continue;
    const odds = americanOddsText(split?.odds || play.oddsLine);
'''
replace_once(public_data, old_loop, new_loop, "Align CFB HOT gate to displayed bet-type badge")

replace_once(
    public_data,
    '      qualification: `HOT Last 7 Best Play (${lastSeven.record})`,\n',
    '      qualification: `HOT Last 7 ${recordType} Best Play (${lastSeven.record})`,\n',
    "Label CFB HOT qualification with its record bucket",
)

print("CFB tiles now mirror MLB form badges, EZPZ card layout, and trend ROI evidence.")
