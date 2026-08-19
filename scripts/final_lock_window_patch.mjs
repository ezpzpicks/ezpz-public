import fs from "node:fs";

const path = "app/api/public-data/route.ts";
let text = fs.readFileSync(path, "utf8");
const original = text;

const oldBlock = `function isFifteenMinuteTrackingWindow(row: SheetRow, now = Date.now()) {
  const minutes = minutesBeforeScheduledStart(row, now);
  // GitHub wakes the route near common MLB start times. The tolerance handles
  // uncommon start minutes and normal scheduler delay while still creating
  // exactly one dedicated tracking snapshot per game.
  return minutes != null && minutes >= 7 && minutes <= 23;
}`;

const newBlock = `function isFifteenMinuteTrackingWindow(row: SheetRow, now = Date.now()) {
  const minutes = minutesBeforeScheduledStart(row, now);
  // Prefer the normal ~15-minute capture, but accept any remaining pregame
  // opportunity when GitHub's scheduler runs late. alreadyCapturedGameKeys keeps
  // the first official lock immutable, so a later run cannot overwrite it.
  return minutes != null && minutes > 0 && minutes <= 23;
}`;

if (text.includes(oldBlock)) {
  text = text.replace(oldBlock, newBlock);
} else if (!text.includes(newBlock)) {
  throw new Error("Final-lock tracking window target not found");
}

if (text !== original) {
  fs.writeFileSync(path, text, "utf8");
  console.log("Expanded final-lock tracking window through first pitch.");
} else {
  console.log("Final-lock tracking window already expanded.");
}
