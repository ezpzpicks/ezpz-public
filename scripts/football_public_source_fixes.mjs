import fs from "node:fs";

const path = "lib/footballPublicData.ts";
let text = fs.readFileSync(path, "utf8");
const oldBlock = `function normalizeTeam(value: unknown, sport: FootballSport) {\n  const raw = String(value || "").trim();\n  const key = textKey(raw);`;
const newBlock = `function normalizeTeam(value: unknown, sport: FootballSport) {\n  // Selections commonly arrive as \"Team -3.5\". Strip only a trailing spread\n  // number so team matching remains identical for model rows and DraftKings rows.\n  const raw = String(value || "")\n    .trim()\n    .replace(/\\s+[+-]?\\d+(?:\\.\\d+)?$/, "")\n    .trim();\n  const key = textKey(raw);`;
if (!text.includes(newBlock)) {
  const count = text.split(oldBlock).length - 1;
  if (count !== 1) throw new Error(`football team normalization: expected one block, found ${count}`);
  text = text.replace(oldBlock, newBlock);
}
fs.writeFileSync(path, text);
