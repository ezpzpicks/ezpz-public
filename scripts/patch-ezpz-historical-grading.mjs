import fs from "node:fs";
import path from "node:path";

const target = path.join(process.cwd(), "app", "api", "public-data-core.ts");
let source = fs.readFileSync(target, "utf8");
let changed = false;

const oldTimeBlock = `  const pickStart = scheduledGameStart({ Date: pick.date, "Game Time": pick.gameTime });
  const rowStart = scheduledGameStart(row);
  if (pickStart != null && rowStart != null && Math.abs(pickStart - rowStart) > 30 * 60_000) {
    return false;
  }

  if (teamsMatch) return true;
  if (!rowGame) return false;
`;

const newTimeBlock = `  // Exact canonical teams on the same date are the primary historical identity.
  // Scheduled time is only a doubleheader/ambiguous-match disambiguator; it must
  // never reject the one obvious team/date match because legacy start times moved.
  if (teamsMatch) return true;

  const pickStart = scheduledGameStart({ Date: pick.date, "Game Time": pick.gameTime });
  const rowStart = scheduledGameStart(row);
  if (pickStart != null && rowStart != null && Math.abs(pickStart - rowStart) > 30 * 60_000) {
    return false;
  }

  if (!rowGame) return false;
`;

if (source.includes(oldTimeBlock)) {
  source = source.replace(oldTimeBlock, newTimeBlock);
  changed = true;
} else if (!source.includes("Exact canonical teams on the same date are the primary historical identity.")) {
  throw new Error("EZPZ historical grading patch could not locate aiRowMatchesGame time block.");
}

const overlayMarker = `function overlayAiPickResults(
  picks: AiPick[],
  trackerRows: SheetRow[],
  allGameTrendRows: SheetRow[],
) {
`;

const finalScoreHelper = `function aiPickFinalScoreSource(
  pick: AiPick,
  allGameTrendRows: SheetRow[],
): SheetRow | null {
  if (pick.market !== "Moneyline" && pick.market !== "Total") return null;
  const date = isoPublicDate(pick.date);
  const candidates = allGameTrendRows.filter((row) => {
    if (isoPublicDate(row.Date || row["Bet Date"] || "") !== date) return false;
    if (!aiRowMatchesGame(pick, row)) return false;
    // Actual score columns are populated by the final-result sync. Requiring a
    // completed row prevents live/in-progress scores from grading a pick.
    if (!resultCode(row.Result)) return false;
    return (
      numericLine(row["Actual Away Runs"]) != null &&
      numericLine(row["Actual Home Runs"]) != null
    );
  });
  const source = candidates[0];
  if (!source) return null;

  const awayRuns = numericLine(source["Actual Away Runs"]);
  const homeRuns = numericLine(source["Actual Home Runs"]);
  if (awayRuns == null || homeRuns == null) return null;
  const storedTotal = numericLine(source["Actual Total"]);
  const actualTotal = storedTotal == null ? awayRuns + homeRuns : storedTotal;
  let result: AiPick["result"] = "";

  if (pick.market === "Total") {
    const line = numericLine(pick.line || pick.play || pick.selection || "");
    const side = normalizeType(\`\${pick.selection} \${pick.play}\`);
    if (line == null) return null;
    if (Math.abs(actualTotal - line) < 0.001) result = "P";
    else if (side.includes("OVER")) result = actualTotal > line ? "W" : "L";
    else if (side.includes("UNDER")) result = actualTotal < line ? "W" : "L";
  } else {
    if (awayRuns === homeRuns) return null;
    const awayTeam = normalizeTeam(
      pick.awayTeam || source["Away Team"] || source.Away || "",
    );
    const homeTeam = normalizeTeam(
      pick.homeTeam || source["Home Team"] || source.Home || "",
    );
    const selectedTeam = normalizeTeam(
      teamFromSelection(pick.selection || pick.play || ""),
    );
    const winner = awayRuns > homeRuns ? awayTeam : homeTeam;
    if (selectedTeam && winner) result = selectedTeam === winner ? "W" : "L";
  }

  if (!result) return null;
  return {
    ...source,
    Result: result,
    "Result Updated": String(source["Result Updated"] || nowET()),
  };
}

`;

if (!source.includes("function aiPickFinalScoreSource(")) {
  if (!source.includes(overlayMarker)) {
    throw new Error("EZPZ historical grading patch could not locate overlayAiPickResults.");
  }
  source = source.replace(overlayMarker, finalScoreHelper + overlayMarker);
  changed = true;
}

const oldOverlayBlock = `    if (
      (pick.market === "Moneyline" || pick.market === "Total") &&
      (!source || !resultCode(source.Result))
    ) {
      const allGameSource = aiPickTrackerMatch(pick, allGameTrendRows);
      if (allGameSource && resultCode(allGameSource.Result)) source = allGameSource;
    }

    const authoritativeResult = source ? resultCode(source.Result) : "";
`;

const newOverlayBlock = `    if (
      (pick.market === "Moneyline" || pick.market === "Total") &&
      (!source || !resultCode(source.Result))
    ) {
      const allGameSource = aiPickTrackerMatch(pick, allGameTrendRows);
      if (allGameSource && resultCode(allGameSource.Result)) source = allGameSource;
    }
    if (
      (pick.market === "Moneyline" || pick.market === "Total") &&
      (!source || !resultCode(source.Result))
    ) {
      // Grade the frozen EZPZ line directly from the completed final score when
      // legacy tracker metadata or a moved market line prevents an exact match.
      const finalScoreSource = aiPickFinalScoreSource(pick, allGameTrendRows);
      if (finalScoreSource) source = finalScoreSource;
    }

    const authoritativeResult = source ? resultCode(source.Result) : "";
`;

if (source.includes(oldOverlayBlock)) {
  source = source.replace(oldOverlayBlock, newOverlayBlock);
  changed = true;
} else if (!source.includes("const finalScoreSource = aiPickFinalScoreSource(pick, allGameTrendRows);")) {
  throw new Error("EZPZ historical grading patch could not locate overlay result block.");
}

if (changed) {
  fs.writeFileSync(target, source);
  console.log("Applied EZPZ historical grading patch.");
} else {
  console.log("EZPZ historical grading patch is already present.");
}
