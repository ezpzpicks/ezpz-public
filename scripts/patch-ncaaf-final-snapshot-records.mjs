import fs from "node:fs";
import path from "node:path";

const target = path.join(process.cwd(), "lib", "footballPublicDataCore.ts");
let source = fs.readFileSync(target, "utf8");
let changed = false;
const marker = "NCAAF_FINAL_SNAPSHOT_RECORDS_PATCH";

if (!source.includes(marker)) {
  const signature = `function buildFootballEzpzRecordRows(\n  tracker: SheetRow[],\n  trendRows: SheetRow[],\n  sport: FootballSport,\n): FootballEzpzRecordRow[] {\n`;
  const replacement = `// ${marker}\nfunction gradeFinalNcaafTrendPlay(play: TrendPlay, trendRows: SheetRow[]): ResultCode | "" {\n  const candidates = trendRows.filter((row) => {\n    if (isoDate(row.Date || row["Game Date"] || "") !== play.date) return false;\n    return textKey(row.Game) === textKey(play.game) || (\n      sameTeam(row["Away Team"], play.awayTeam, "NCAAF") &&\n      sameTeam(row["Home Team"], play.homeTeam, "NCAAF")\n    );\n  });\n  const scoreRow = candidates.find((row) =>\n    finiteSnapshotNumber(row["Actual Away Runs"]) != null &&\n    finiteSnapshotNumber(row["Actual Home Runs"]) != null\n  );\n  if (scoreRow && play.line != null) {\n    const away = finiteSnapshotNumber(scoreRow["Actual Away Runs"]);\n    const home = finiteSnapshotNumber(scoreRow["Actual Home Runs"]);\n    if (away != null && home != null) {\n      if (play.market === "Total") {\n        const actualTotal = finiteSnapshotNumber(scoreRow["Actual Total"]) ?? away + home;\n        const diff = actualTotal - play.line;\n        if (Math.abs(diff) < 0.001) return "P";\n        return play.side === "Over" ? (diff > 0 ? "W" : "L") : (diff < 0 ? "W" : "L");\n      }\n      const selectedAway = sameTeam(play.selectionTeam || play.selection, play.awayTeam, "NCAAF");\n      const selectedHome = sameTeam(play.selectionTeam || play.selection, play.homeTeam, "NCAAF");\n      if (selectedAway || selectedHome) {\n        const margin = selectedAway ? away - home : home - away;\n        const adjusted = margin + play.line;\n        if (Math.abs(adjusted) < 0.001) return "P";\n        return adjusted > 0 ? "W" : "L";\n      }\n    }\n  }\n  const exact = candidates.find((row) => {\n    if (String(row.Market || "") !== play.market) return false;\n    if (play.market === "Total") return textKey(row.Side || row.Selection) === textKey(play.side || play.selection);\n    return sameTeam(row.Selection || row["Public Split Selection"], play.selectionTeam || play.selection, "NCAAF");\n  });\n  return resultCode(exact?.Result || exact?.Status);\n}\n\nfunction buildFootballEzpzRecordRows(\n  tracker: SheetRow[],\n  trendRows: SheetRow[],\n  sport: FootballSport,\n  finalTrendPlays: TrendPlay[] = [],\n): FootballEzpzRecordRow[] {\n`;
  if (!source.includes(signature)) throw new Error("Could not locate EZPZ record builder signature.");
  source = source.replace(signature, replacement);
  changed = true;

  const settled = `  const settledTrendRows = trendRows.filter((row) => Boolean(resultCode(row.Result || row.Status)));\n`;
  const finalBlock = `  if (sport === "NCAAF") {\n    const canonical = new Map<string, TrendPlay>();\n    for (const play of finalTrendPlays) {\n      if (play.snapshotStatus !== "FINAL_PREGAME" || !String(play.frozenAt || play.updatedAt || "").trim()) continue;\n      const key = \`${play.date}|${textKey(play.game)}|${play.market}|${textKey(play.market === "Total" ? play.side || play.selection : play.selectionTeam || play.selection)}\`;\n      canonical.set(key, play);\n    }\n    const finalPlays = [...canonical.values()];\n    for (const play of finalPlays) {\n      const direct = directTrendQualification(play, [], sport, finalPlays);\n      const labels = direct.labels.filter((label) => label === "RLM" || label === "Sharp" || label === "Public Fade");\n      if (!labels.length) continue;\n      const result = gradeFinalNcaafTrendPlay(play, trendRows);\n      if (!result) continue;\n      const oddsNumber = parseOdds(play.odds) || -110;\n      const strengthScore = labels.includes("RLM")\n        ? Math.min(100, 85 + Math.max(0, Math.abs(Number(direct.publicSide?.lineMovementValue || 0)) - RLM_MIN_MARKET_MOVE_POINTS) * 5)\n        : 85;\n      candidates.push({\n        date: play.date, game: play.game, market: play.market,\n        selection: play.market === "Total"\n          ? \`${play.side} ${play.line ?? ""}\`.trim()\n          : \`${play.selectionTeam || play.selection} ${play.line == null ? "" : `${play.line > 0 ? "+" : ""}${play.line}`}\`.trim(),\n        odds: play.odds || "-110", score: Math.round(strengthScore * 10) / 10,\n        source: "Trend Play", qualification: labels.join(" • "), selected: true, result,\n        units: result === "P" ? 0 : result === "L" ? -1 : profitUnits(oddsNumber),\n      });\n    }\n  }\n\n  const settledTrendRows = sport === "NCAAF"\n    ? []\n    : trendRows.filter((row) => Boolean(resultCode(row.Result || row.Status)));\n`;
  if (!source.includes(settled)) throw new Error("Could not locate settled trend rows block.");
  source = source.replace(settled, finalBlock);

  const display = `  const displayTrendPlays = Array.isArray(weeklyMarket.trendPlays)\n    ? weeklyMarket.trendPlays as unknown as TrendPlay[]\n    : [];\n`;
  const displayReplacement = `${display}  const completedTrendDates = sport === "NCAAF"\n    ? [...new Set(trendRows\n        .filter((row) => Boolean(resultCode(row.Result || row.Status)))\n        .map((row) => isoDate(row.Date || row["Game Date"] || ""))\n        .filter(Boolean))]\n    : [];\n  const recordWeeklyMarket = sport === "NCAAF" && completedTrendDates.length\n    ? await readWeeklyFootballMarket(sport, { dateKeys: completedTrendDates, hydrateHistory: false })\n    : weeklyMarket;\n  const recordTrendPlays = Array.isArray(recordWeeklyMarket.trendPlays)\n    ? recordWeeklyMarket.trendPlays as unknown as TrendPlay[]\n    : [];\n`;
  if (!source.includes(display)) throw new Error("Could not locate weekly trend display block.");
  source = source.replace(display, displayReplacement);

  const call = `  const aiPickRecordRows = buildFootballEzpzRecordRows(effectiveTracker, publicTrendRows, sport);\n`;
  const callReplacement = `  const aiPickRecordRows = buildFootballEzpzRecordRows(effectiveTracker, publicTrendRows, sport, recordTrendPlays);\n`;
  if (!source.includes(call)) throw new Error("Could not locate EZPZ record builder call.");
  source = source.replace(call, callReplacement);
}

if (changed) {
  fs.writeFileSync(target, source);
  console.log("Applied NCAAF final-snapshot EZPZ record patch.");
} else {
  console.log("NCAAF final-snapshot EZPZ record patch is already present.");
}
