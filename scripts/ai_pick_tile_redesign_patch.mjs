import fs from "node:fs";

const path = "app/page.tsx";
let text = fs.readFileSync(path, "utf8");
const original = text;

function replaceOnce(oldText, newText, label) {
  if (text.includes(newText)) return;
  if (!text.includes(oldText)) throw new Error(label + " marker not found");
  text = text.replace(oldText, newText);
}

// The selector no longer uses a separate web-review decision for finalized picks.
replaceOnce(
  `type AiPickExternalStatus =
  | "PENDING_FINAL_REVIEW"
  | "WEB_REVIEWED"
  | "NO_VERIFIED_CONTEXT"
  | "NOT_CONFIGURED"
  | "REVIEW_ERROR";`,
  `type AiPickExternalStatus =
  | "PENDING_FINAL_REVIEW"
  | "WEB_REVIEWED"
  | "NO_VERIFIED_CONTEXT"
  | "NOT_CONFIGURED"
  | "NOT_REQUIRED"
  | "REVIEW_ERROR";`,
  "AI external status type",
);

replaceOnce(
  `function aiExternalReviewLabel(status: AiPickExternalStatus) {
  if (status === "WEB_REVIEWED") return "External context reviewed";
  if (status === "NO_VERIFIED_CONTEXT") return "No verified outside context changed the play";
  if (status === "PENDING_FINAL_REVIEW") return "External context review pending final snapshot";
  if (status === "REVIEW_ERROR") return "External context review was unavailable";
  return "External research is not configured";
}`,
  `function aiExternalReviewLabel(status: AiPickExternalStatus) {
  if (status === "NOT_REQUIRED") return "Separate AI/web review not required";
  if (status === "WEB_REVIEWED") return "External context reviewed";
  if (status === "NO_VERIFIED_CONTEXT") return "No verified outside context changed the play";
  if (status === "PENDING_FINAL_REVIEW") return "External context review pending final snapshot";
  if (status === "REVIEW_ERROR") return "External context review was unavailable";
  return "External research is not configured";
}`,
  "AI external status label",
);

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

const oldCardHead = `function AiPickSelectorCard({
  pick,
  lastSevenBetsSummary,
}: {
  pick: AiPick;
  lastSevenBetsSummary: Summary | null;
}) {
  const schedule = scheduleInfoFromRaw(pick.gameTime, pick.date);
  const bestPlayGate = pick.bestPlayType
    ? aiBestPlayGateInfo(lastSevenBetsSummary)
    : null;
  const isFinalReview =
    pick.snapshotStatus === "FINAL_PREGAME" &&
    pick.externalReviewStatus === "WEB_REVIEWED" &&
    pick.protectionStatus === "PASSED";
  const cleanedConfidence = cleanAiDisplayList(pick.confidenceReason);
  const cleanedWhy = cleanAiDisplayList(pick.whySelected);
  const confidenceReason = cleanedConfidence.length
    ? cleanedConfidence
    : [
        isFinalReview
          ? "This play cleared the AI score, probability, value, and protection thresholds after final verification."
          : "This candidate currently clears the preliminary score, probability, value, and protection thresholds; final AI review is still pending.",
      ];
  const why = cleanedWhy.length
    ? cleanedWhy
    : [
        isFinalReview
          ? "The candidate passed the final EZPZ AI selection threshold and protection checks."
          : "The candidate currently passes the preliminary EZPZ AI selection threshold and protection checks.",
      ];
  const historicalNotes = cleanAiDisplayList(pick.historicalNotes);`;

const newCardHead = `function AiPickSelectorCard({
  pick,
  todaySummary,
  last7DaysSummary,
  lastSevenBetsSummary,
  overallSummary,
  trendPlay,
}: {
  pick: AiPick;
  todaySummary: Summary | null;
  last7DaysSummary: Summary | null;
  lastSevenBetsSummary: Summary | null;
  overallSummary: Summary | null;
  trendPlay: TrendPlay | null;
}) {
  const schedule = scheduleInfoFromRaw(pick.gameTime, pick.date);
  const bestPlayGate = pick.bestPlayType
    ? aiBestPlayGateInfo(lastSevenBetsSummary)
    : null;
  const isFinalReview =
    pick.snapshotStatus === "FINAL_PREGAME" && pick.protectionStatus === "PASSED";
  const historicalNotes = cleanAiDisplayList(pick.historicalNotes);`;
replaceOnce(oldCardHead, newCardHead, "AI card props and legacy confidence logic");

const cardBodyStartMarker = `        <div className="aiPickConfidenceBlock">`;
const cardBodyEndMarker = `        {researchSummary ? (`;
const cardBodyStart = text.indexOf(cardBodyStartMarker, text.indexOf("function AiPickSelectorCard("));
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

// Add a true current-date record map alongside the existing rolling windows.
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

const oldCardCall = `                <AiPickSelectorCard
                  key={pick.candidateId}
                  pick={pick}
                  lastSevenBetsSummary={
                    pick.bestPlayType
                      ? lastSevenBetsByType.get(normalizeType(pick.bestPlayType)) || null
                      : null
                  }
                />`;
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
                />`;
replaceOnce(oldCardCall, newCardCall, "AI card render call");

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
