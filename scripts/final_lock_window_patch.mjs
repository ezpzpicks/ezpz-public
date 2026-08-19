import fs from "node:fs";

const path = "app/api/public-data/route.ts";
let text = fs.readFileSync(path, "utf8");
const original = text;

const legacyWindowBlock = `function isFifteenMinuteTrackingWindow(row: SheetRow, now = Date.now()) {
  const minutes = minutesBeforeScheduledStart(row, now);
  // GitHub wakes the route near common MLB start times. The tolerance handles
  // uncommon start minutes and normal scheduler delay while still creating
  // exactly one dedicated tracking snapshot per game.
  return minutes != null && minutes >= 7 && minutes <= 23;
}`;

const broadFallbackBlock = `function isFifteenMinuteTrackingWindow(row: SheetRow, now = Date.now()) {
  const minutes = minutesBeforeScheduledStart(row, now);
  // Prefer the normal ~15-minute capture, but accept any remaining pregame
  // opportunity when GitHub's scheduler runs late. alreadyCapturedGameKeys keeps
  // the first official lock immutable, so a later run cannot overwrite it.
  return minutes != null && minutes > 0 && minutes <= 23;
}`;

const preferredWindowBlock = `function isFifteenMinuteTrackingWindow(row: SheetRow, now = Date.now()) {
  const minutes = minutesBeforeScheduledStart(row, now);
  // Target the first successful poll inside 15 minutes before first pitch.
  // With the 5-minute workflow cadence this normally lands 10-15 minutes out.
  // If that poll is delayed or missed, any remaining pregame poll is still a
  // fallback. alreadyCapturedGameKeys keeps the first lock immutable.
  return minutes != null && minutes > 0 && minutes <= 15;
}`;

if (text.includes(legacyWindowBlock)) {
  text = text.replace(legacyWindowBlock, preferredWindowBlock);
} else if (text.includes(broadFallbackBlock)) {
  text = text.replace(broadFallbackBlock, preferredWindowBlock);
} else if (!text.includes(preferredWindowBlock)) {
  throw new Error("Final-lock tracking window target not found");
}

if (text !== original) {
  fs.writeFileSync(path, text, "utf8");
  console.log("Set final-lock tracking to prefer 10-15 minutes before first pitch with pregame fallback.");
} else {
  console.log("Final-lock tracking already prefers 10-15 minutes before first pitch.");
}
