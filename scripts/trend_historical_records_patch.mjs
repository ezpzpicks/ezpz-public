import fs from "node:fs";

const path = "app/api/public-data/route.ts";
let text = fs.readFileSync(path, "utf8");
const original = text;

// Trend record history should use the same combined completed source set that
// already preserves pre-all_game_trends history from bet_tracker. The previous
// call only passed completedAllGameTrendRows, which made the Records page's
// "Overall" history effectively begin when all_game_trends was introduced.
const oldCall = `    const trendRecordRows = buildTrendRecordRows(\n      completedAllGameTrendRows,\n      authoritativeFrozenTrendPlays,\n      slateTodayRaw as SheetRow[],\n      savedPublicSplits,\n    );`;

const newCall = `    const trendRecordRows = buildTrendRecordRows(\n      trendSourceRows,\n      authoritativeFrozenTrendPlays,\n      slateTodayRaw as SheetRow[],\n      savedPublicSplits,\n    );`;

if (text.includes(oldCall)) {
  text = text.replace(oldCall, newCall);
} else if (!text.includes(newCall)) {
  throw new Error("Trend record source call not found for historical-record recovery");
}

if (text !== original) {
  fs.writeFileSync(path, text, "utf8");
  console.log("Trend Records now use combined historical trend source rows.");
} else {
  console.log("Trend Records already use combined historical trend source rows.");
}
