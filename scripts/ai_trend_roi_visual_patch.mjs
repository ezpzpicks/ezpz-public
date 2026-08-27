import fs from "node:fs";

const path = "app/page.tsx";
let text = fs.readFileSync(path, "utf8");
const original = text;

function replaceRequired(oldText, newText, label) {
  if (text.includes(newText)) return;
  if (!text.includes(oldText)) throw new Error(label + " marker not found");
  text = text.replace(oldText, newText);
}

const cardMarker = `function AiPickSelectorCard({\n`;
if (!text.includes("function aiTrendNetRoiSummary(")) {
  if (!text.includes(cardMarker)) throw new Error("AI selector card marker not found");
  const helper = `function aiSignedPercent(value: number) {
  return (value > 0 ? "+" : "") + value.toFixed(1) + "%";
}

function aiTrendNetRoiSummary(play: TrendPlay, trendPlays: TrendPlay[]) {
  const candidateMetrics = trendPlayMetrics(play);
  if (!candidateMetrics.hasData) return null;

  const sideKey = trendSideComparisonKey(play);
  const opponents = trendPlays
    .filter(
      (candidate) =>
        aiTrendKey(candidate.game) === aiTrendKey(play.game) &&
        trendMarketComparisonKey(candidate) === trendMarketComparisonKey(play) &&
        trendSideComparisonKey(candidate) !== sideKey,
    )
    .map((candidate) => ({ play: candidate, metrics: trendPlayMetrics(candidate) }))
    .filter((candidate) => candidate.metrics.hasData)
    .sort((a, b) => {
      if (b.metrics.score !== a.metrics.score) return b.metrics.score - a.metrics.score;
      if (b.metrics.roiPct !== a.metrics.roiPct) return b.metrics.roiPct - a.metrics.roiPct;
      return b.metrics.winPct - a.metrics.winPct;
    });

  const opponent = opponents[0];
  if (!opponent) return null;

  return {
    candidateRoiPct: candidateMetrics.roiPct,
    opponentRoiPct: opponent.metrics.roiPct,
    netRoiPct: candidateMetrics.roiPct - opponent.metrics.roiPct,
    opponentLabel: trendPickLabel(opponent.play),
  };
}

`;
  text = text.replace(cardMarker, helper + cardMarker);
}

replaceRequired(
  `  trendPlay,\n  handpicked = false,`,
  `  trendPlay,\n  trendPlays,\n  handpicked = false,`,
  "AI trend plays prop declaration",
);
replaceRequired(
  `  trendPlay: TrendPlay | null;\n  handpicked?: boolean;`,
  `  trendPlay: TrendPlay | null;\n  trendPlays: TrendPlay[];\n  handpicked?: boolean;`,
  "AI trend plays prop type",
);
replaceRequired(
  `  const historicalNotes = cleanAiDisplayList(pick.historicalNotes);\n  const researchSummary = cleanAiDisplayText(pick.researchSummary);`,
  `  const historicalNotes = cleanAiDisplayList(pick.historicalNotes);\n  const trendRoiSummary = trendPlay ? aiTrendNetRoiSummary(trendPlay, trendPlays) : null;\n  const researchSummary = cleanAiDisplayText(pick.researchSummary);`,
  "AI trend net ROI summary",
);

const oldTrendEvidence = `        {!pick.bestPlayType && trendPlay?.signals?.length ? (
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
        ) : !pick.bestPlayType && historicalNotes.length ? (`;

const newTrendEvidence = `        {!pick.bestPlayType && trendPlay?.signals?.length ? (
          <section className="aiPickDetailSection historical aiTrendEvidence">
            <div className="aiTrendEvidenceHead">
              <div>
                <h3>Trend Evidence</h3>
                <p>Historical market-signal performance behind this Trend Play.</p>
              </div>
              {pick.trendTier ? <span className="aiTrendTierPill">{pick.trendTier}</span> : null}
            </div>

            {trendRoiSummary ? (
              <div className="aiTrendNetRoiCard">
                <div className="aiTrendNetRoiMain">
                  <div>
                    <span>Final Net ROI</span>
                    <small>Recent-window ROI edge versus the opposing side</small>
                  </div>
                  <strong className={trendRoiSummary.netRoiPct >= 0 ? "positive" : "negative"}>
                    {aiSignedPercent(trendRoiSummary.netRoiPct)}
                  </strong>
                </div>
                <div className="aiTrendNetRoiBreakdown">
                  <span>
                    Selected side <b>{aiSignedPercent(trendRoiSummary.candidateRoiPct)}</b>
                  </span>
                  <span>
                    Opposing side <b>{aiSignedPercent(trendRoiSummary.opponentRoiPct)}</b>
                  </span>
                </div>
              </div>
            ) : null}

            <div className="aiTrendSignalList">
              {trendPlay.signals.map((signal, index) => (
                <div className="aiTrendSignalCard" key={signal.signalKey + "-" + index}>
                  <div className="aiTrendSignalName">{signal.signal}</div>
                  <div className="aiTrendSignalStats">
                    <div>
                      <span>Overall</span>
                      <strong>{signal.records.allTime.record}</strong>
                      <small className={signal.records.allTime.roiPct >= 0 ? "positive" : "negative"}>
                        {aiSignedPercent(signal.records.allTime.roiPct)} ROI
                      </small>
                    </div>
                    <div>
                      <span>Last 30</span>
                      <strong>{signal.records.last30.record}</strong>
                      <small className={signal.records.last30.roiPct >= 0 ? "positive" : "negative"}>
                        {aiSignedPercent(signal.records.last30.roiPct)} ROI
                      </small>
                    </div>
                    <div>
                      <span>Last 7</span>
                      <strong>{signal.records.last7.record}</strong>
                      <small className={signal.records.last7.roiPct >= 0 ? "positive" : "negative"}>
                        {aiSignedPercent(signal.records.last7.roiPct)} ROI
                      </small>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : !pick.bestPlayType && historicalNotes.length ? (`;
replaceRequired(oldTrendEvidence, newTrendEvidence, "Trend Evidence redesign");

replaceRequired(
  `                  trendPlay={aiTrendPlayForPick(pick, trendPlays)}\n                  handpicked={Boolean(`,
  `                  trendPlay={aiTrendPlayForPick(pick, trendPlays)}\n                  trendPlays={trendPlays}\n                  handpicked={Boolean(`,
  "AI trend plays card call",
);

if (!text.includes(".aiTrendNetRoiCard {")) {
  const cssAnchor = `        @media (max-width: 720px) {`;
  if (!text.includes(cssAnchor)) throw new Error("AI responsive CSS anchor not found");
  const css = `        /* AI record / ROI visual polish */
        .aiPickGateMetric {
          position: relative;
          overflow: hidden;
          min-height: 82px;
          padding: 13px;
          border-color: rgba(79, 156, 255, 0.19);
          border-radius: 15px;
          background: linear-gradient(145deg, rgba(7, 20, 38, 0.91), rgba(4, 11, 22, 0.91));
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03), 0 10px 24px rgba(0, 0, 0, 0.13);
        }

        .aiPickGateMetric::before {
          content: "";
          position: absolute;
          inset: 0 18% auto 18%;
          height: 2px;
          background: linear-gradient(90deg, #2f8cff, #24c7ff, #2bd875);
          opacity: 0.72;
        }

        .aiPickGateMetric span {
          color: #8fa9c9;
          font-weight: 850;
          letter-spacing: 0.075em;
        }

        .aiPickGateMetric strong {
          color: #f6fbff;
          font-size: 20px;
          font-variant-numeric: tabular-nums;
          letter-spacing: -0.02em;
        }

        .aiPickGateMetric small {
          color: #aac0d9;
          font-size: 10px;
          font-weight: 750;
        }

        .aiTrendEvidence {
          padding: 18px;
          border-color: rgba(43, 216, 117, 0.22);
          background: linear-gradient(145deg, rgba(7, 28, 34, 0.85), rgba(6, 16, 29, 0.85));
        }

        .aiTrendEvidenceHead {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 14px;
        }

        .aiTrendEvidenceHead h3 {
          margin: 0 0 5px;
        }

        .aiTrendEvidenceHead p {
          color: #9fb5cf;
          font-size: 12px;
          line-height: 1.45;
        }

        .aiTrendTierPill {
          flex: 0 0 auto;
          border: 1px solid rgba(43, 216, 117, 0.26);
          border-radius: 999px;
          padding: 6px 9px;
          color: #bff3d2;
          background: rgba(20, 118, 64, 0.16);
          font-size: 9px;
          font-weight: 900;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          white-space: nowrap;
        }

        .aiTrendNetRoiCard {
          margin-bottom: 12px;
          padding: 14px;
          border: 1px solid rgba(58, 166, 215, 0.28);
          border-radius: 17px;
          background:
            radial-gradient(circle at 92% 18%, rgba(43, 216, 117, 0.13), transparent 38%),
            linear-gradient(135deg, rgba(10, 33, 48, 0.96), rgba(7, 19, 33, 0.96));
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03), 0 12px 28px rgba(0, 0, 0, 0.18);
        }

        .aiTrendNetRoiMain {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
        }

        .aiTrendNetRoiMain > div {
          display: grid;
          gap: 4px;
        }

        .aiTrendNetRoiMain span {
          color: #9bb6d6;
          font-size: 9px;
          font-weight: 900;
          letter-spacing: 0.085em;
          text-transform: uppercase;
        }

        .aiTrendNetRoiMain small {
          color: #8da6c3;
          font-size: 10px;
        }

        .aiTrendNetRoiMain > strong {
          font-size: 31px;
          font-weight: 950;
          font-variant-numeric: tabular-nums;
          letter-spacing: -0.045em;
          line-height: 1;
        }

        .aiTrendNetRoiMain > strong.positive,
        .aiTrendSignalStats small.positive {
          color: #55e59a;
        }

        .aiTrendNetRoiMain > strong.negative,
        .aiTrendSignalStats small.negative {
          color: #ff8a96;
        }

        .aiTrendNetRoiBreakdown {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
          margin-top: 12px;
          padding-top: 10px;
          border-top: 1px solid rgba(114, 166, 202, 0.14);
        }

        .aiTrendNetRoiBreakdown span {
          padding: 8px 9px;
          border: 1px solid rgba(106, 152, 189, 0.12);
          border-radius: 10px;
          color: #8fa8c6;
          background: rgba(255, 255, 255, 0.02);
          font-size: 10px;
        }

        .aiTrendNetRoiBreakdown b {
          float: right;
          color: #edf7ff;
          font-variant-numeric: tabular-nums;
        }

        .aiTrendSignalList {
          display: grid;
          gap: 9px;
        }

        .aiTrendSignalCard {
          padding: 12px 13px;
          border: 1px solid rgba(86, 137, 178, 0.17);
          border-radius: 15px;
          background: linear-gradient(145deg, rgba(7, 17, 31, 0.86), rgba(4, 10, 20, 0.86));
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.025);
        }

        .aiTrendSignalName {
          margin-bottom: 10px;
          color: #e8f3ff;
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 0.045em;
          text-transform: uppercase;
        }

        .aiTrendSignalStats {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 7px;
        }

        .aiTrendSignalStats > div {
          display: grid;
          gap: 3px;
          min-width: 0;
          padding: 8px;
          border: 1px solid rgba(106, 143, 175, 0.11);
          border-radius: 11px;
          background: rgba(255, 255, 255, 0.016);
        }

        .aiTrendSignalStats span {
          color: #829bb8;
          font-size: 8px;
          font-weight: 850;
          letter-spacing: 0.07em;
          text-transform: uppercase;
        }

        .aiTrendSignalStats strong {
          color: #f3f8ff;
          font-size: 15px;
          font-weight: 900;
          font-variant-numeric: tabular-nums;
        }

        .aiTrendSignalStats small {
          font-size: 9px;
          font-weight: 850;
          font-variant-numeric: tabular-nums;
        }

        @media (max-width: 520px) {
          .aiTrendEvidence {
            padding: 14px;
          }

          .aiTrendNetRoiMain > strong {
            font-size: 28px;
          }

          .aiTrendNetRoiBreakdown {
            grid-template-columns: 1fr;
          }

          .aiTrendSignalStats {
            gap: 5px;
          }

          .aiTrendSignalStats > div {
            padding: 7px 6px;
          }

          .aiTrendSignalStats strong {
            font-size: 13px;
          }

          .aiTrendSignalStats small {
            font-size: 8px;
          }
        }

`;
  text = text.replace(cssAnchor, css + cssAnchor);
}

if (text !== original) {
  fs.writeFileSync(path, text, "utf8");
  console.log("Polished Trend Evidence with official net ROI and cleaner record cards.");
} else {
  console.log("Trend Evidence ROI visual polish already applied.");
}
