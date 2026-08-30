import fs from "node:fs";

const path = "lib/footballPublicData.ts";
let text = fs.readFileSync(path, "utf8");

const oldMap = '  const settled = rows.map((row) => {';
const newMap = '  const settled: SheetRow[] = rows.map((row): SheetRow => {';
if (!text.includes(newMap)) {
  const count = text.split(oldMap).length - 1;
  if (count !== 1) throw new Error(`football tracker settled typing: expected 1 target, found ${count}`);
  text = text.replace(oldMap, newMap);
}

const oldUpdated = '    const updated = { ...row, Result: result, Units: String(Math.round(units * 10000) / 10000), "Actual Away": String(away), "Actual Home": String(home) };';
const newUpdated = '    const updated: SheetRow = { ...row, Result: result, Units: String(Math.round(units * 10000) / 10000), "Actual Away": String(away), "Actual Home": String(home) };';
if (!text.includes(newUpdated)) {
  const count = text.split(oldUpdated).length - 1;
  if (count !== 1) throw new Error(`football tracker updated typing: expected 1 target, found ${count}`);
  text = text.replace(oldUpdated, newUpdated);
}

fs.writeFileSync(path, text);
console.log("Fixed football Best Play tracker TypeScript inference.");
