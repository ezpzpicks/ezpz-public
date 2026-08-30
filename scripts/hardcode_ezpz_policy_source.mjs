import fs from "node:fs";

const path = "app/api/public-data/route.ts";
let text = fs.readFileSync(path, "utf8");

function functionRange(name, nextName) {
  const start = text.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Missing function ${name}`);
  const end = text.indexOf(`\nfunction ${nextName}`, start);
  if (end < 0) throw new Error(`Missing function ${nextName}`);
  return { start, end, body: text.slice(start, end) };
}

// Best Play is one permanent path: HOT only. Non-HOT Best Play evidence may not
// qualify through Best Play, but it also may not suppress a separately valid
// Trend path on a Best + Trend candidate.
{
  const { start, end, body } = functionRange("aiRecordAdjustments", "aiApplyMarketContext");
  const tailStart = body.indexOf('  if (form !== EZPZ_BEST_PLAY_POLICY.requiredForm) {');
  if (tailStart < 0) throw new Error("Missing HOT-only record gate");
  let prefix = body.slice(0, tailStart);
  const oldComment = `  // Every Best Play market uses the same rolling Last-7-Bets qualification\n  // system displayed on the public site. This includes pitcher props, A/B\n  // Moneylines, Total Over/Under, and Elite NRFI/YRFI. Historical form changes\n  // the mandatory score/probability/advantage gates; it does not inflate the\n  // underlying EZPZ score. Cold buckets are deterministically excluded until\n  // their rolling seven naturally improves.\n`;
  const newComment = `  // Every Best Play market uses the same rolling Last-7-Bets form. The\n  // Best Play EZPZ path is HOT-only: seven completed bets are required and at\n  // least five of those seven must be wins. Neutral, Cold, and Small Sample\n  // can never qualify through the Best Play path.\n`;
  prefix = prefix.replace(oldComment, newComment);

  const tail = `  if (form !== EZPZ_BEST_PLAY_POLICY.requiredForm) {\n    const formLabel =\n      form === "NEUTRAL"\n        ? "Neutral"\n        : form === "COLD"\n          ? "Cold"\n          : "Need 7 Bets";\n    const reason =\n      \`\${recordType} Last 7 Bets is \${formLabel} (\${lastSeven.record}); \` +\n      "Best Play EZPZ Picks are HOT-only (7 completed bets with 5+ wins)";\n\n    candidate.historicalNotes.push(\n      form === "SAMPLE"\n        ? \`\${recordType} Last 7 Bets: Need 7 Bets • \${lastSeven.totalBets}/7 completed\`\n        : \`\${recordType} Last 7 Bets: \${formLabel} • \${lastSeven.record}\`,\n    );\n\n    // Best + Trend is two independent qualification paths.\n    if (candidate.trendPlay) {\n      candidate.dataStatus.push(\n        \`\${reason} • Best Play path excluded; Trend path remains independently eligible\`,\n      );\n    } else {\n      candidate.protectionReasons.push(reason);\n      candidate.dataStatus.push(\`\${reason} • blocked\`);\n    }\n    return;\n  }\n\n  candidate.dataStatus.push(\n    \`\${recordType} Last 7 Bets: Hot • \${lastSeven.record} • minimum score \${profile.score} • minimum probability \${profile.probability}% • minimum advantage \${profile.advantage}%\`,\n  );\n  candidate.historicalNotes.push(\n    \`\${recordType} Last 7 Bets: Hot • \${lastSeven.record}\`,\n  );\n  candidate.whySelected.push(\n    \`\${recordType} is Hot over its last 7 completed bets (\${lastSeven.record}); Best Play gates are score 74+, estimated probability 50%+, estimated advantage 1.5%+, and odds no worse than -150\`,\n  );\n}`;

  text = text.slice(0, start) + prefix + tail + text.slice(end);
}

// Trend eligibility is independently defended at final selection. Upstream,
// a non-Pass Trend tier is produced only after the direct +10% net ROI gate;
// final selection additionally rechecks that every active signal is green.
{
  const { start, end, body } = functionRange("finalizeAiCandidates", "aiFullGameMarketSourceRank");
  const oldBlock = `    const qualifiesByTrend =\n      trendBacked &&\n      rawTrendScore >= 69 &&\n      aiScore >= 80;`;
  const newBlock = `    const trendSignalsAllGreen = Boolean(\n      candidate.trendPlay && aiTrendSignalsAllGreen(candidate.trendPlay),\n    );\n    const qualifiesByTrend =\n      trendBacked &&\n      trendSignalsAllGreen &&\n      candidate.trendPlay?.tier !== "Pass" &&\n      rawTrendScore >= 69 &&\n      aiScore >= 80;`;
  if (!body.includes(oldBlock)) throw new Error("Missing Trend final qualification block");
  const next = body.replace(oldBlock, newBlock);
  text = text.slice(0, start) + next + text.slice(end);
}

for (const marker of [
  'requiredForm: "HOT" as const',
  'maxFavoritePrice: -150',
  'minimumNetRoiAdvantage: 10',
  'if (form !== EZPZ_BEST_PLAY_POLICY.requiredForm)',
  'candidate.trendPlay?.tier !== "Pass"',
  'aiTrendSignalsAllGreen(candidate.trendPlay)',
  'netRoiAdvantage >= EZPZ_TREND_POLICY.minimumNetRoiAdvantage',
  'signals.every((signal) => signal.tone === "positive")',
]) {
  if (!text.includes(marker)) throw new Error(`Missing direct-source invariant: ${marker}`);
}

fs.writeFileSync(path, text);
console.log("Finalized direct EZPZ source policy: HOT-only Best Plays, -150 max price, all-green Trends, +10% net ROI.");
