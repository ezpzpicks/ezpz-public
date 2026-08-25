import fs from "node:fs";

const routePath = "app/api/public-data/route.ts";
let source = fs.readFileSync(routePath, "utf8");
let changed = false;

const helperMarker = "function aiTrendSignalsAllGreen(play: TrendPlay)";
if (!source.includes(helperMarker)) {
  const anchor = "\nfunction aiMergeTrendCandidate(\n";
  if (!source.includes(anchor)) {
    throw new Error("Could not find aiMergeTrendCandidate anchor for trend-signal agreement patch");
  }

  const helper = `
function aiTrendSignalsAllGreen(play: TrendPlay) {
  const signals = play.signals || [];
  return signals.length > 0 && signals.every((signal) => signal.tone === "positive");
}
`;

  source = source.replace(anchor, `${helper}${anchor}`);
  changed = true;
}

const oldGate = '  if (play.tier === "Pass") return;';
const newGate = '  if (play.tier === "Pass" || !aiTrendSignalsAllGreen(play)) return;';
if (source.includes(oldGate)) {
  source = source.replace(oldGate, newGate);
  changed = true;
} else if (!source.includes(newGate)) {
  throw new Error("Could not find trend candidate gate for trend-signal agreement patch");
}

const versionPattern = /const AI_PICK_SELECTOR_VERSION = "[^"]+";/;
const versionLine = 'const AI_PICK_SELECTOR_VERSION = "hybrid-web-context-v20-trend-signal-agreement";';
if (!source.includes(versionLine)) {
  if (!versionPattern.test(source)) {
    throw new Error("Could not find AI_PICK_SELECTOR_VERSION for trend-signal agreement patch");
  }
  source = source.replace(versionPattern, versionLine);
  changed = true;
}

if (changed) {
  fs.writeFileSync(routePath, source);
  console.log("Applied AI trend signal agreement gate: every trend signal must be positive/green.");
} else {
  console.log("AI trend signal agreement gate already applied.");
}
