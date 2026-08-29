import fs from "node:fs";

const path = "lib/footballWeeklyMarket.ts";
let text = fs.readFileSync(path, "utf8");

const groupsBefore = '  const groups = sport === "NFL" ? ["NFL"] : ["College Football", "NCAAF", "CFB"];';
const groupsOldIds = '  const groups = sport === "NFL" ? ["42648"] : ["88808", "94682", "212333"];';
const groupsAfter = '  const groups = sport === "NFL" ? ["84240"] : ["NCAA Football"];';
if (text.includes(groupsBefore)) text = text.replace(groupsBefore, groupsAfter);
else if (text.includes(groupsOldIds)) text = text.replace(groupsOldIds, groupsAfter);
else if (!text.includes(groupsAfter)) throw new Error("Could not patch weekly football DraftKings event groups");

const horizonsBefore = '  for (const group of groups) {\n    for (const horizon of ["n7days", ""]) {';
const horizonsAfter = '  const horizons = sport === "NFL" ? ["n7days"] : ["n30days"];\n  for (const group of groups) {\n    for (const horizon of horizons) {';
if (text.includes(horizonsBefore)) text = text.replace(horizonsBefore, horizonsAfter);
else if (!text.includes(horizonsAfter)) throw new Error("Could not patch weekly football DraftKings date window");

const numericBefore = `function numericLine(value: unknown) {
  const match = String(value || "").replace(/[−–—]/g, "-").match(/[+-]?\\d+(?:\\.\\d+)?/);
  const n = match ? Number(match[0]) : NaN;
  return Number.isFinite(n) ? n : null;
}`;
const numericAfter = `function numericLine(value: unknown) {
  const matches = String(value || "").replace(/[−–—]/g, "-").match(/[+-]?\\d+(?:\\.\\d+)?/g);
  const raw = matches?.length ? matches[matches.length - 1] : "";
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}`;
if (text.includes(numericBefore)) text = text.replace(numericBefore, numericAfter);
else if (!text.includes(numericAfter)) throw new Error("Could not patch weekly football numeric line parser");

fs.writeFileSync(path, text);
console.log("Aligned weekly football discovery with the current DraftKings NFL mixed feed and NCAA Football feed.");
