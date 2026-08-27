import fs from "node:fs";

const path = "lib/footballPublicData.ts";
let text = fs.readFileSync(path, "utf8");
const oldText = `function resultCode(value: unknown): ResultCode | "" {
  const key = String(value || "").trim().toUpperCase();
  if (key.startsWith("W")) return "W";
  if (key.startsWith("L")) return "L";
  if (key.startsWith("P")) return "P";
  return "";
}`;
const newText = `function resultCode(value: unknown): ResultCode | "" {
  const key = String(value || "").trim().toUpperCase();
  if (["W", "WIN", "WON"].includes(key)) return "W";
  if (["L", "LOSS", "LOST"].includes(key)) return "L";
  if (["P", "PUSH"].includes(key)) return "P";
  return "";
}`;
if (!text.includes(newText)) {
  const count = text.split(oldText).length - 1;
  if (count !== 1) throw new Error(`football result parser: expected one target, found ${count}`);
  text = text.replace(oldText, newText);
}
fs.writeFileSync(path, text);
console.log("Football Pending rows no longer count as Push results.");
