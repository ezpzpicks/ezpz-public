import fs from "node:fs";
import path from "node:path";

const target = path.join(process.cwd(), "lib", "footballPublicDataHistory.ts");
let source = fs.readFileSync(target, "utf8");
const marker = "NCAAF_FINAL_ONLY_HISTORY_PATCH";

if (!source.includes(marker)) {
  const currentRowsBlock = `  const existingByKey = new Map(history.map((row) => [String(row["Pick Key"] || pickKey(row, row.Date)), row]));\n  const currentRows = currentPicks\n    .map((pick: AnyPick) => historyRowFromPick(pick, today, existingByKey.get(pickKey(pick, today))))\n    .filter((row: SheetRow) => Boolean(row["Pick Key"]));\n`;
  const currentRowsReplacement = `  // ${marker}\n  const existingByKey = new Map(history.map((row) => [String(row["Pick Key"] || pickKey(row, row.Date)), row]));\n  const historyEligibleCurrentPicks = sport === "NCAAF"\n    ? currentPicks.filter((pick: AnyPick) => textKey(pick.snapshotStatus) === "final pregame")\n    : currentPicks;\n  const currentRows = historyEligibleCurrentPicks\n    .map((pick: AnyPick) => historyRowFromPick(pick, today, existingByKey.get(pickKey(pick, today))))\n    .filter((row: SheetRow) => Boolean(row["Pick Key"]));\n`;
  if (!source.includes(currentRowsBlock)) throw new Error("Could not locate NCAAF history persistence block.");
  source = source.replace(currentRowsBlock, currentRowsReplacement);

  const recordBlock = `  const aiPickRecordRows = gradedHistory\n    .map(historyPickFromRow)\n    .filter((pick) => sport !== "NCAAF" || isPublicSplitEzpzPick(pick))\n    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(a.game || "").localeCompare(String(b.game || "")));\n`;
  const recordReplacement = `  const aiPickRecordRows = gradedHistory\n    .map(historyPickFromRow)\n    .filter((pick) => sport !== "NCAAF" || (\n      textKey(pick.snapshotStatus) === "final pregame" && isPublicSplitEzpzPick(pick)\n    ))\n    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(a.game || "").localeCompare(String(b.game || "")));\n`;
  if (!source.includes(recordBlock)) throw new Error("Could not locate NCAAF record output block.");
  source = source.replace(recordBlock, recordReplacement);
  fs.writeFileSync(target, source);
  console.log("Applied NCAAF final-only history patch.");
} else {
  console.log("NCAAF final-only history patch is already present.");
}
