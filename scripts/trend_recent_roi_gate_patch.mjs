import fs from "node:fs";

const ROUTE_PATH = "app/api/public-data/route.ts";
const PAGE_PATH = "app/page.tsx";

function replaceRequired(text, pattern, replacement, label) {
  const next = text.replace(pattern, replacement);
  if (next === text) {
    throw new Error(`Trend recent ROI gate patch target not found: ${label}`);
  }
  return next;
}

function patchWindowWeights(text, label) {
  if (text.includes("All-time is display-only for trend grading")) return text;

  return replaceRequired(
    text,
    /function trendWindowWeights\(records: TrendWindowRecords\) \{[\s\S]*?\n\}\n\nfunction trendRecordScore/,
    `function trendWindowWeights(_records: TrendWindowRecords) {
  // All-time is display-only for trend grading. The live grade and ROI use only
  // the two recent windows, with Last 7 weighted twice as heavily as Last 30.
  return [
    { key: "allTime" as const, weight: 0 },
    { key: "last30" as const, weight: 1 / 3 },
    { key: "last7" as const, weight: 2 / 3 },
  ];
}

function trendRecordScore`,
    `${label} trendWindowWeights`,
  );
}

function patchRoute(text) {
  text = patchWindowWeights(text, "route");

  if (!text.includes("Recent-window availability, not all-time history, chooses the grading scope.")) {
    text = replaceRequired(
      text,
      `  // Exact market + side history receives full weight regardless of bet count.\n  // Broader history is only a fallback when the exact category has no results.\n  const displayRecords = exact.allTime.totalBets\n    ? exact\n    : marketRecords.allTime.totalBets\n      ? marketRecords\n      : overall;\n  const weights: TrendDatasetWeights = exact.allTime.totalBets\n    ? { exact: 1, market: 0, overall: 0 }\n    : marketRecords.allTime.totalBets\n      ? { exact: 0, market: 1, overall: 0 }\n      : overall.allTime.totalBets\n        ? { exact: 0, market: 0, overall: 1 }\n        : { exact: 0, market: 0, overall: 0 };\n  const metrics = trendWindowMetrics(displayRecords);\n  const recordScope = exact.allTime.totalBets\n    ? \`${market} • ${sideGroup}\`\n    : marketRecords.allTime.totalBets\n      ? \`${market} • all sides\`\n      : "All tracked markets";`,
      `  // Exact market + side history receives full weight regardless of bet count.\n  // Broader history is only a fallback when the exact category has no recent\n  // results. Recent-window availability, not all-time history, chooses the grading scope.\n  const hasRecent = (records: TrendWindowRecords) =>\n    records.last30.totalBets > 0 || records.last7.totalBets > 0;\n  const displayRecords = hasRecent(exact)\n    ? exact\n    : hasRecent(marketRecords)\n      ? marketRecords\n      : overall;\n  const weights: TrendDatasetWeights = hasRecent(exact)\n    ? { exact: 1, market: 0, overall: 0 }\n    : hasRecent(marketRecords)\n      ? { exact: 0, market: 1, overall: 0 }\n      : hasRecent(overall)\n        ? { exact: 0, market: 0, overall: 1 }\n        : { exact: 0, market: 0, overall: 0 };\n  const metrics = trendWindowMetrics(displayRecords);\n  const recordScope = hasRecent(exact)\n    ? \`${market} • ${sideGroup}\`\n    : hasRecent(marketRecords)\n      ? \`${market} • all sides\`\n      : "All tracked markets";`,
      "route recent grading scope",
    );
  }

  if (!text.includes("netRoiAdvantage >= 10")) {
    text = replaceRequired(
      text,
      `    const rawGap = metrics.score - opponent.metrics.score;\n    const comparisonGap = Math.abs(rawGap);\n    const comparisonWinner = rawGap > 0.01;\n    const eligible = Boolean(\n      comparisonWinner && metrics.hasData && opponent.metrics.hasData,\n    );`,
      `    const rawGap = metrics.score - opponent.metrics.score;\n    const comparisonGap = Math.abs(rawGap);\n    const comparisonWinner = rawGap > 0.01;\n    const candidateRoiPct = metrics.roiPct;\n    const opponentRoiPct = opponent.metrics.roiPct;\n    const netRoiAdvantage = candidateRoiPct - opponentRoiPct;\n    const opponentLast7Green = opponent.play.signals.some(\n      (signal) => trendRecordTone(signal.records.last7) === "positive",\n    );\n    const eligible = Boolean(\n      comparisonWinner &&\n        metrics.hasData &&\n        opponent.metrics.hasData &&\n        candidateRoiPct > 0 &&\n        netRoiAdvantage >= 10 &&\n        !opponentLast7Green,\n    );`,
      "route ROI/opposing-side eligibility",
    );
  }

  return text;
}

function patchPage(text) {
  text = patchWindowWeights(text, "page");

  if (!text.includes("const netRoiAdvantage = opponent ? candidateRoiPct - opponentRoiPct : -Infinity;")) {
    text = replaceRequired(
      text,
      `    const comparisonWinner = Boolean(opponent && rawGap > 0.01);\n    const comparisonGap = Math.abs(rawGap);`,
      `    const comparisonWinner = Boolean(opponent && rawGap > 0.01);\n    const comparisonGap = Math.abs(rawGap);\n    const candidateRoiPct = metrics.roiPct;\n    const opponentRoiPct = opponent?.metrics.roiPct ?? 0;\n    const netRoiAdvantage = opponent ? candidateRoiPct - opponentRoiPct : -Infinity;\n    const opponentLast7Green = Boolean(\n      opponent?.play.signals.some(\n        (signal) => trendRecordTone(signal.records.last7) === "positive",\n      ),\n    );`,
      "page ROI comparison values",
    );

    text = replaceRequired(
      text,
      `    const eligible = Boolean(\n      comparisonWinner && metrics.hasData && opponent?.metrics.hasData,\n    );`,
      `    const eligible = Boolean(\n      comparisonWinner &&\n        metrics.hasData &&\n        opponent?.metrics.hasData &&\n        candidateRoiPct > 0 &&\n        netRoiAdvantage >= 10 &&\n        !opponentLast7Green,\n    );`,
      "page ROI/opposing-side eligibility",
    );
  }

  return text;
}

const routeOriginal = fs.readFileSync(ROUTE_PATH, "utf8");
const pageOriginal = fs.readFileSync(PAGE_PATH, "utf8");
const routeNext = patchRoute(routeOriginal);
const pageNext = patchPage(pageOriginal);

if (routeNext !== routeOriginal) fs.writeFileSync(ROUTE_PATH, routeNext, "utf8");
if (pageNext !== pageOriginal) fs.writeFileSync(PAGE_PATH, pageNext, "utf8");

if (routeNext !== routeOriginal || pageNext !== pageOriginal) {
  console.log("Trend grading now uses 7D/30D only, positive own ROI, +10% net ROI, and an opposing-7D-green veto.");
} else {
  console.log("Trend recent ROI gate is already applied.");
}
