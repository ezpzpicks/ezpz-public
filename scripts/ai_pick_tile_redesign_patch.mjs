import fs from "node:fs";

const path = "app/page.tsx";
let text = fs.readFileSync(path, "utf8");
const original = text;

function replaceOnce(oldText, newText, label) {
  if (text.includes(newText)) return;
  if (!text.includes(oldText)) throw new Error(label + " marker not found");
  text = text.replace(oldText, newText);
}

// The final selector uses NOT_REQUIRED after the no-final-review patch. Make the
// display patch tolerant whether that earlier patch has already added the type.
if (!text.includes('| "NOT_REQUIRED"')) {
  const statusStart = text.indexOf("type AiPickExternalStatus =");
  const statusEnd = text.indexOf(";", statusStart);
  if (statusStart < 0 || statusEnd < 0) throw new Error("AI external status type not found");
  const statusBlock = text.slice(statusStart, statusEnd + 1);
  if (!statusBlock.includes('| "REVIEW_ERROR"')) throw new Error("AI external status insertion point not found");
  const updatedStatus = statusBlock.replace(
    '  | "REVIEW_ERROR";',
    '  | "NOT_REQUIRED"\n  | "REVIEW_ERROR";',
  );
  text = text.slice(0, statusStart) + updatedStatus + text.slice(statusEnd + 1);
}

if (!text.includes("Separate AI/web review not required")) {
  const labelMarker = `function aiExternalReviewLabel(status: AiPickExternalStatus) {`;
  if (!text.includes(labelMarker)) throw new Error("AI external status label helper not found");
  text = text.replace(
    labelMarker,
    labelMarker + `\n  if (status === "NOT_REQUIRED") return "Separate AI/web review not required";`,
  );
}

const cardMarker = `function AiPickSelectorCard({\n`;
const helperBlock = `function aiSummaryRoi(summary: Summary | null) {
  if (!summary || !summary.totalBets) return "—";
  const value = Number(summary.roiPct || 0);
  return (value > 0 ? "+" : "") + value.toFixed(1) + "%";
}

function aiSummaryRecord(summary: Summary | null) {
  if (!summary || !summary.totalBets) return "—";
  return summaryRecord(summary);
}

function aiTrendKey(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/\\b(?:moneyline|ml)\\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function aiTrendPlayForPick(pick: AiPick, trendPlays: TrendPlay[]) {
  if (pick.market !== "Moneyline" && pick.market !== "Total") return null;
  const sameMarket = trendPlays.filter(
    (play) => aiTrendKey(play.game) === aiTrendKey(pick.game) && play.market === pick.market,
  );
  if (pick.market === "Total") {
    const pickKey = aiTrendKey(pick.play + " " + pick.selection);
    const wantedSide = pickKey.includes("under")
      ? "under"
      : pickKey.includes("over")
        ? "over"
        : "";
    return sameMarket.find((play) => aiTrendKey(play.side) === wantedSide) || null;
  }

  const pickKey = aiTrendKey(pick.selection || pick.play);
  return (
    sameMarket.find((play) => {
      const trendKey = aiTrendKey(play.selectionTeam || play.selection);
      return Boolean(
        trendKey &&
          (pickKey === trendKey || pickKey.includes(trendKey) || trendKey.includes(pickKey)),
      );
    }) || null
  );
}

`;
if (!text.includes("function aiSummaryRoi(")) {
  if (!text.includes(cardMarker)) throw new Error("AI card marker not found");
  text = text.replace(cardMarker, helperBlock + cardMarker);
}

// Replace the card declaration structurally so it remains compatible with the
// handpicked-badge prebuild patch that runs earlier and adds its own prop.
if (!text.includes("todaySummary: Summary | null;")) {
  const cardStart = text.indexOf("function AiPickSelectorCard({");
  const researchMarker = `  const researchSummary = cleanAiDisplayText(pick.researchSummary);`;
  const researchStart = text.indexOf(researchMarker, cardStart);
  if (cardStart < 0 || researchStart < 0) throw new Error("AI card declaration boundaries not found");

  const newCardHead = `function AiPickSelectorCard({
  pick,
  todaySummary,
  last7DaysSummary,
  lastSevenBetsSummary,
  overallSummary,
  trendPlay,
  handpicked = false,
}: {
  pick: AiPick;
  todaySummary: Summary | null;
  last7DaysSummary: Summary | null;
  lastSevenBetsSummary: Summary | null;
  overallSummary: Summary | null;
  trendPlay: TrendPlay | null;
  handpicked?: boolean;
}) {
  const schedule = scheduleInfoFromRaw(pick.gameTime, pick.date);
  const bestPlayGate = pick.bestPlayType
    ? aiBestPlayGateInfo(lastSevenBetsSummary)
    : null;
  const isFinalReview =
    pick.snapshotStatus === "FINAL_PREGAME" && pick.protectionStatus === "PASSED";
  const historicalNotes = cleanAiDisplayList(pick.historicalNotes);
`;
  text = text.slice(0, cardStart) + newCardHead + text.slice(researchStart);
}

const cardBodyStartMarker = `        <div className="aiPickConfidenceBlock">`;
const cardBodyEndMarker = `        {researchSummary ? (`;
const cardFunctionStart = text.indexOf("function AiPickSelectorCard(");
const cardBodyStart = text.indexOf(cardBodyStartMarker, cardFunctionStart);
const cardBodyEnd = text.indexOf(cardBodyEndMarker, cardBodyStart);
if (cardBodyStart < 0 || cardBodyEnd < 0) {
  if (!text.includes("Best Play Record Snapshot")) {
    throw new Error("AI card redesign body markers not found");
  }
} else {
  const redesignedBody = `        {bestPlayGate ? (
          <section className={"aiPickQualificationGate " + bestPlayGate.className}>
            <div className="aiPickQualificationGateHead">
              <div>
                <span>Best Play Record Snapshot</span>
                <strong>{normalizeType(pick.bestPlayType || "Best Play")}</strong>
              </div>
              <span className={"formPill " + bestPlayGate.className}>
                {bestPlayGate.className === "hot" ? "🔥 " : ""}
                Last 7 Bets: {bestPlayGate.label}
              </span>
            </div>
            <div className="aiPickGateGrid">
              <div className="aiPickGateMetric">
                <span>Today</span>
                <strong>{aiSummaryRecord(todaySummary)}</strong>
                <small>ROI {aiSummaryRoi(todaySummary)}</small>
              </div>
              <div className="aiPickGateMetric">
                <span>Last 7 Days</span>
                <strong>{aiSummaryRecord(last7DaysSummary)}</strong>
                <small>ROI {aiSummaryRoi(last7DaysSummary)}</small>
              </div>
              <div className="aiPickGateMetric">
                <span>Last 7 Bets</span>
                <strong>{aiSummaryRecord(lastSevenBetsSummary)}</strong>
                <small>ROI {aiSummaryRoi(lastSevenBetsSummary)}</small>
              </div>
              <div className="aiPickGateMetric">
                <span>Overall</span>
                <strong>{aiSummaryRecord(overallSummary)}</strong>
                <small>Final Net ROI {aiSummaryRoi(overallSummary)}</small>
              </div>
            </div>
          </section>
        ) : null}

        {!pick.bestPlayType && trendPlay?.signals?.length ? (
          <section className="aiPickDetailSection historical">
            <h3>Trend Evidence</h3>
            <p>
              These are the records for the individual market signals behind this Trend Play — not head-to-head matchup history.
            </p>
            <div className="aiPickGateGrid">
              {trendPlay.signals.map((signal, index) => (
                <div className="aiPickGateMetric" key={signal.signalKey + "-" + index}>
                  <span>{signal.signal}</span>
                  <strong>
                    {signal.records.allTime.record} • ROI {signal.records.allTime.roiPct > 0 ? "+" : ""}{signal.records.allTime.roiPct.toFixed(1)}%
                  </strong>
                  <small>
                    Last 7: {signal.records.last7.record} • ROI {signal.records.last7.roiPct > 0 ? "+" : ""}{signal.records.last7.roiPct.toFixed(1)}%
                  </small>
                </div>
              ))}
            </div>
          </section>
        ) : !pick.bestPlayType && historicalNotes.length ? (
          <section className="aiPickDetailSection historical">
            <h3>Trend Evidence</h3>
            <p>
              Each saved record pair is one trend signal: all-time record first, recent record second. These are not team-vs-team matchup records.
            </p>
            <ul>
              {historicalNotes.map((item, index) => (
                <li key={"trend-history-" + pick.candidateId + "-" + index}>{item}</li>
              ))}
            </ul>
          </section>
        ) : null}

`;
  text = text.slice(0, cardBodyStart) + redesignedBody + text.slice(cardBodyEnd);
}

const last7Memo = `  const trackerLast7RecordSummary = useMemo(
    () => calculateTrackerRecordSummary(data?.betTrackerRows, "last7", data?.today || ""),
    [data?.betTrackerRows, data?.today],
  );`;
const todayAndLast7Memo = `  const trackerTodayRecordSummary = useMemo(
    () => calculateTrackerRecordSummary(data?.betTrackerRows, "today", data?.today || ""),
    [data?.betTrackerRows, data?.today],
  );
  const trackerLast7RecordSummary = useMemo(
    () => calculateTrackerRecordSummary(data?.betTrackerRows, "last7", data?.today || ""),
    [data?.betTrackerRows, data?.today],
  );`;
replaceOnce(last7Memo, todayAndLast7Memo, "today record memo");

const recentMap = `    const recentByType = new Map(
      mergedLast7RecordSummary.map((row) => [normalizeType(row.betType), row]),
    );
    const lastSevenBetsByType = new Map<string, Summary>(`;
const expandedMaps = `    const todayByType = new Map(
      trackerTodayRecordSummary.map((row) => [normalizeType(row.betType), row]),
    );
    const recentByType = new Map(
      mergedLast7RecordSummary.map((row) => [normalizeType(row.betType), row]),
    );
    const overallByType = new Map(
      mergedOverallRecordSummary.map((row) => [normalizeType(row.betType), row]),
    );
    const lastSevenBetsByType = new Map<string, Summary>(`;
replaceOnce(recentMap, expandedMaps, "AI record maps");

if (!text.includes("trendPlay={aiTrendPlayForPick(pick, trendPlays)}")) {
  const aiSection = text.indexOf('if (active === "EZPZ AI Picks")');
  const callStart = text.indexOf("                <AiPickSelectorCard", aiSection);
  const callEndMarker = `                />`;
  const callEnd = text.indexOf(callEndMarker, callStart);
  if (callStart < 0 || callEnd < 0) throw new Error("AI card render call boundaries not found");

  const newCardCall = `                <AiPickSelectorCard
                  key={pick.candidateId}
                  pick={pick}
                  todaySummary={
                    pick.bestPlayType
                      ? todayByType.get(normalizeType(pick.bestPlayType)) || null
                      : null
                  }
                  last7DaysSummary={
                    pick.bestPlayType
                      ? recentByType.get(normalizeType(pick.bestPlayType)) || null
                      : null
                  }
                  lastSevenBetsSummary={
                    pick.bestPlayType
                      ? lastSevenBetsByType.get(normalizeType(pick.bestPlayType)) || null
                      : null
                  }
                  overallSummary={
                    pick.bestPlayType
                      ? overallByType.get(normalizeType(pick.bestPlayType)) || null
                      : null
                  }
                  trendPlay={aiTrendPlayForPick(pick, trendPlays)}
                  handpicked={Boolean(
                    favoriteRowMap.get(favoriteKeyFromAiPick(pick, data.today)),
                  )}
                />`;
  text = text.slice(0, callStart) + newCardCall + text.slice(callEnd + callEndMarker.length);
}

const dependencyMarker = `    mergedLast7RecordSummary,
    trackerLastSevenBetsRecordSummary,`;
const expandedDependencies = `    mergedLast7RecordSummary,
    mergedOverallRecordSummary,
    trackerTodayRecordSummary,
    trackerLastSevenBetsRecordSummary,`;
replaceOnce(dependencyMarker, expandedDependencies, "AI card record dependencies");

if (text !== original) {
  fs.writeFileSync(path, text, "utf8");
  console.log("Redesigned AI Pick tiles: records/ROI, HOT badge, Trend Evidence, and current final status.");
} else {
  console.log("AI Pick tile redesign already applied.");
}
