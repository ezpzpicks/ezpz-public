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

// Make the Best Play record/ROI tiles feel more like polished stat cards.
replaceRequired(
  `.aiPickGateMetric{background:#040a1594;border:1px solid #4f9cff26;border-radius:12px;gap:6px;min-height:68px;padding:11px;display:grid}.aiPickGateMetric span{color:var(--ez-muted);text-transform:uppercase;letter-spacing:.05em;font-size:9px;line-height:1.25}.aiPickGateMetric strong{align-self:end;font-size:17px}`,
  `.aiPickGateMetric{background:linear-gradient(145deg,#071426e8,#040b16e8);border:1px solid #4f9cff30;border-radius:15px;gap:6px;min-height:82px;padding:13px;display:grid;position:relative;overflow:hidden;box-shadow:inset 0 1px #ffffff08,0 10px 24px #00000020}.aiPickGateMetric:before{content:"";background:linear-gradient(90deg,#2f8cff,#24c7ff,#2bd875);height:2px;position:absolute;inset:0 18% auto 18%;opacity:.72}.aiPickGateMetric span{color:#8fa9c9;text-transform:uppercase;letter-spacing:.075em;font-size:9px;font-weight:850;line-height:1.25}.aiPickGateMetric strong{align-self:end;color:#f6fbff;font-variant-numeric:tabular-nums;font-size:20px;letter-spacing:-.02em}.aiPickGateMetric small{color:#aac0d9;font-size:10px;font-weight:750}`, 
  "Best Play stat-card styling",
);

const cssAnchor = `.aiPickDetailSection{background:#2bd8750b;border:1px solid #2bd87533;border-radius:14px;padding:16px}`;
if (!text.includes(".aiTrendNetRoiCard{")) {
  if (!text.includes(cssAnchor)) throw new Error("AI detail CSS anchor not found");
  const trendCss = `.aiTrendEvidence{background:linear-gradient(145deg,#071c22d9,#06101dd9);border-color:#2bd87538;padding:18px}.aiTrendEvidenceHead{justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:14px;display:flex}.aiTrendEvidenceHead h3{margin:0 0 5px}.aiTrendEvidenceHead p{color:#9fb5cf;font-size:12px;line-height:1.45}.aiTrendTierPill{color:#bff3d2;white-space:nowrap;background:#14764029;border:1px solid #2bd87542;border-radius:999px;padding:6px 9px;font-size:9px;font-weight:900;letter-spacing:.06em;text-transform:uppercase}.aiTrendNetRoiCard{background:radial-gradient(circle at 92% 18%,#2bd87520,#0000 38%),linear-gradient(135deg,#0a2130f5,#071321f5);border:1px solid #3aa6d747;border-radius:17px;margin-bottom:12px;padding:14px;box-shadow:inset 0 1px #ffffff08,0 12px 28px #0000002e}.aiTrendNetRoiMain{justify-content:space-between;align-items:center;gap:14px;display:flex}.aiTrendNetRoiMain>div{gap:4px;display:grid}.aiTrendNetRoiMain span{color:#9bb6d6;letter-spacing:.085em;text-transform:uppercase;font-size:9px;font-weight:900}.aiTrendNetRoiMain small{color:#8da6c3;font-size:10px}.aiTrendNetRoiMain>strong{font-variant-numeric:tabular-nums;font-size:31px;font-weight:950;letter-spacing:-.045em;line-height:1}.aiTrendNetRoiMain>strong.positive,.aiTrendSignalStats small.positive{color:#55e59a}.aiTrendNetRoiMain>strong.negative,.aiTrendSignalStats small.negative{color:#ff8a96}.aiTrendNetRoiBreakdown{border-top:1px solid #72a6ca24;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:12px;padding-top:10px;display:grid}.aiTrendNetRoiBreakdown span{color:#8fa8c6;background:#ffffff05;border:1px solid #6a98bd1f;border-radius:10px;padding:8px 9px;font-size:10px}.aiTrendNetRoiBreakdown b{color:#edf7ff;float:right;font-variant-numeric:tabular-nums}.aiTrendSignalList{gap:9px;display:grid}.aiTrendSignalCard{background:linear-gradient(145deg,#07111fdb,#040a14db);border:1px solid #5689b22b;border-radius:15px;padding:12px 13px;box-shadow:inset 0 1px #ffffff06}.aiTrendSignalName{color:#e8f3ff;letter-spacing:.045em;text-transform:uppercase;margin-bottom:10px;font-size:10px;font-weight:900}.aiTrendSignalStats{grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;display:grid}.aiTrendSignalStats>div{background:#ffffff04;border:1px solid #6a8faf1c;border-radius:11px;gap:3px;min-width:0;padding:8px;display:grid}.aiTrendSignalStats span{color:#829bb8;letter-spacing:.07em;text-transform:uppercase;font-size:8px;font-weight:850}.aiTrendSignalStats strong{color:#f3f8ff;font-variant-numeric:tabular-nums;font-size:15px;font-weight:900}.aiTrendSignalStats small{font-variant-numeric:tabular-nums;font-size:9px;font-weight:850}.aiPickDetailSection{background:#2bd8750b;border:1px solid #2bd87533;border-radius:14px;padding:16px}`;
  text = text.replace(cssAnchor, trendCss);
}

if (!text.includes("@media (width<=520px){.aiTrendNetRoiMain")) {
  const reduceAnchor = `@media (prefers-reduced-motion:reduce){`;
  if (!text.includes(reduceAnchor)) throw new Error("Reduced-motion CSS anchor not found");
  text = text.replace(
    reduceAnchor,
    `@media (width<=520px){.aiTrendEvidence{padding:14px}.aiTrendEvidenceHead{align-items:flex-start}.aiTrendNetRoiMain>strong{font-size:28px}.aiTrendNetRoiBreakdown{grid-template-columns:1fr}.aiTrendSignalStats{grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}.aiTrendSignalStats>div{padding:7px 6px}.aiTrendSignalStats strong{font-size:13px}.aiTrendSignalStats small{font-size:8px}}` + reduceAnchor,
  );
}

if (text !== original) {
  fs.writeFileSync(path, text, "utf8");
  console.log("Polished Trend Evidence with official net ROI and cleaner record cards.");
} else {
  console.log("Trend Evidence ROI visual polish already applied.");
}
