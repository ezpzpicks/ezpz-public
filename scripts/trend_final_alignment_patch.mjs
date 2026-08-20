import fs from "node:fs";

const path = "app/api/public-data/route.ts";
let text = fs.readFileSync(path, "utf8");
const original = text;

// This patch runs after the existing selector patches. Trend-backed AI picks may
// remain visible as LIVE/PENDING before the market lock, but they cannot enter
// FINAL_PREGAME research until the exact TrendPlay object is from the official
// FINAL_PREGAME snapshot used by the Trend Plays board.
const versionPattern =
  /const AI_PICK_SELECTOR_VERSION = "(?:hybrid-web-context-v22-balanced-final-review|hybrid-structured-context-v23-builder-first|hybrid-web-context-v23-final-trend-alignment)";/;
const alignedVersion =
  'const AI_PICK_SELECTOR_VERSION = "hybrid-web-context-v23-final-trend-alignment";';
if (versionPattern.test(text)) {
  text = text.replace(versionPattern, alignedVersion);
} else if (!text.includes(alignedVersion)) {
  throw new Error("AI selector version target not found for trend final alignment");
}

const helperMarker = 'const AI_STORED_LAST7_GATE_PREFIX = "Last-7 qualification recheck:";';
const helperBlock = `const AI_STORED_TREND_RECHECK_PREFIX = "Official final trend snapshot recheck:";

function aiOfficialTrendPlayForStoredPick(
  pick: AiPick,
  trendPlays: TrendPlay[],
) {
  const pickGameKey = String(pick.gameKey || "").trim().replace(/\\.0$/, "");
  const pickAway = normalizeTeam(pick.awayTeam || "");
  const pickHome = normalizeTeam(pick.homeTeam || "");

  return trendPlays.find((play) => {
    if (play.snapshotStatus !== "FINAL_PREGAME") return false;
    if (play.market !== pick.market) return false;

    const playGameKey = String(play.recordGameKey || "").trim().replace(/\\.0$/, "");
    const teamsMatch =
      normalizeTeam(play.awayTeam || "") === pickAway &&
      normalizeTeam(play.homeTeam || "") === pickHome;
    if (pickGameKey && playGameKey) {
      if (pickGameKey !== playGameKey) return false;
    } else if (!teamsMatch) {
      return false;
    }

    if (pick.market === "Moneyline") {
      return (
        normalizeTeam(play.selectionTeam || play.selection || "") ===
        normalizeTeam(pick.selection || "")
      );
    }
    if (pick.market === "Total") {
      return String(play.side || "").trim() === String(pick.selection || "").trim();
    }
    return false;
  }) || null;
}

function aiStoredTrendQualificationCorrection(
  pick: AiPick,
  trendPlays: TrendPlay[],
  selectorNow: number,
): AiPick | null {
  if (
    pick.snapshotStatus !== "FINAL_PREGAME" ||
    (pick.source !== "Trend Play" && pick.source !== "Best + Trend") ||
    Number(pick.trendScore || 0) <= 0
  ) {
    return null;
  }

  // This is only a pregame repair. Never rewrite a published decision after
  // first pitch from data that may have become live/in-game.
  const start = scheduledGameStart({
    Date: pick.date,
    "Game Time": pick.gameTime,
  });
  if (start != null && selectorNow >= start) return null;

  const official = aiOfficialTrendPlayForStoredPick(pick, trendPlays);
  if (!official) return null;

  const officialScore = Number(official.score || 0);
  const officialTier = String(official.tier || "Pass");
  const scoreChanged = Math.abs(Number(pick.trendScore || 0) - officialScore) > 0.01;
  const tierChanged = String(pick.trendTier || "") !== officialTier;
  if (!scoreChanged && !tierChanged) return null;

  const officialStrong =
    officialScore >= 69 && (officialTier === "Strong" || officialTier === "Elite");
  const statusLine =
    AI_STORED_TREND_RECHECK_PREFIX +
    " locked trend is " +
    officialTier +
    " " +
    officialScore +
    " (stored " +
    String(pick.trendTier || "") +
    " " +
    String(pick.trendScore || 0) +
    ")";

  if (pick.source === "Trend Play" && !officialStrong) {
    const rejectionReason =
      statusLine +
      "; trend-only AI picks require the official final score to be 69+ Strong/Elite.";
    return {
      ...pick,
      selected: false,
      protectionStatus: "BLOCKED",
      rejectionReason,
      trendScore: officialScore,
      trendTier: officialTier,
      confidenceReason: [],
      whySelected: [rejectionReason],
      historicalNotes: [],
      risks: [],
      researchSummary: "",
      verdict: rejectionReason,
      dataStatus: [statusLine, ...pick.dataStatus.filter((item) => !String(item).startsWith(AI_STORED_TREND_RECHECK_PREFIX))].slice(0, 5),
      updatedAt: nowET(),
      selectorVersion: AI_PICK_SELECTOR_VERSION,
    };
  }

  // If an earlier final review used a different still-qualifying trend score,
  // reopen that one pregame decision so the reviewer receives the same locked
  // TrendPlay object now shown on the Trend Plays page. Best+Trend rows are also
  // reopened so they can be judged with their official final trend support.
  const reopenReason =
    statusLine +
    "; reopening final AI review so the locked Trend Plays score is authoritative.";
  return {
    ...pick,
    selected: false,
    protectionStatus: "PASSED",
    rejectionReason: "",
    trendScore: officialScore,
    trendTier: officialTier,
    confidenceReason: [],
    whySelected: [reopenReason],
    historicalNotes: [],
    risks: [],
    researchSummary: "",
    verdict: "",
    dataStatus: [statusLine, ...pick.dataStatus.filter((item) => !String(item).startsWith(AI_STORED_TREND_RECHECK_PREFIX))].slice(0, 5),
    externalReviewStatus: "PENDING_FINAL_REVIEW",
    updatedAt: nowET(),
    selectorVersion: AI_PICK_SELECTOR_VERSION,
  };
}

`;
if (!text.includes("function aiStoredTrendQualificationCorrection(")) {
  if (!text.includes(helperMarker)) {
    throw new Error("Stored Last-7 helper marker not found for trend final alignment");
  }
  text = text.replace(helperMarker, helperBlock + helperMarker);
}

const correctionMarker = `  // Re-run only the free rolling Last-7 Best Play qualification gate against
  // completed/locked AI picks before their game starts. The external web
  // review remains frozen, so this never creates another OpenAI request.
`;
const correctionBlock = `  // Reconcile any legacy/early finalized trend-backed pick against the exact
  // official FINAL_PREGAME TrendPlay now used by the Trend Plays board. This
  // removes a stale trend-only pick that fell below Strong, or reopens an
  // earlier review when the locked Strong/Elite score changed.
  const trendSnapshotCorrections = storedToday
    .map((pick) =>
      aiStoredTrendQualificationCorrection(
        pick,
        trendPlays,
        selectorNow,
      ),
    )
    .filter((pick): pick is AiPick => Boolean(pick));
  if (trendSnapshotCorrections.length) {
    try {
      await persistAiPickRows(trendSnapshotCorrections);
    } catch (error) {
      console.error("AI final trend snapshot correction persistence failed", error);
    }
    const correctedByKey = new Map(
      trendSnapshotCorrections.map(
        (pick) => [pick.date + "|" + pick.candidateId, pick] as const,
      ),
    );
    workingStoredRows = workingStoredRows.map((row) => {
      const parsed = parseAiPickRow(row);
      if (!parsed) return row;
      const replacement = correctedByKey.get(parsed.date + "|" + parsed.candidateId);
      return replacement ? aiPickRow(replacement) : row;
    });
    stored = workingStoredRows
      .map(parseAiPickRow)
      .filter((pick): pick is AiPick => Boolean(pick));
    storedToday = stored.filter((pick) => pick.date === isoPublicDate(today));
  }

`;
if (!text.includes("const trendSnapshotCorrections = storedToday")) {
  if (!text.includes(correctionMarker)) {
    throw new Error("Last-7 correction marker not found for trend final alignment");
  }
  text = text.replace(correctionMarker, correctionBlock + correctionMarker);
}

const targetCandidateAnchor = `  const targetCandidates = candidates.filter((candidate) => {
    if (!targetGameKeys.has(candidate.gameKey)) return false;
`;
const targetCandidateReplacement = `  const targetCandidates = candidates.filter((candidate) => {
    if (!targetGameKeys.has(candidate.gameKey)) return false;
    // A trend-backed wager can remain LIVE/PENDING before the official market
    // lock, but FINAL_PREGAME research must use the exact frozen TrendPlay object
    // displayed on the Trend Plays page. This closes the old 23-to-15-minute gap
    // where AI could finalize on a live Strong score that later fell to Good/Pass.
    if (
      candidate.trendPlay &&
      candidate.trendPlay.snapshotStatus !== "FINAL_PREGAME"
    ) {
      return false;
    }
`;
if (!text.includes("closes the old 23-to-15-minute gap")) {
  if (!text.includes(targetCandidateAnchor)) {
    throw new Error("AI target candidate filter not found for trend final alignment");
  }
  text = text.replace(targetCandidateAnchor, targetCandidateReplacement);
}

if (text !== original) {
  fs.writeFileSync(path, text, "utf8");
  console.log("Aligned trend-backed AI final review with the official final Trend Plays snapshot.");
} else {
  console.log("Trend-backed AI final review is already aligned with the official final Trend Plays snapshot.");
}
