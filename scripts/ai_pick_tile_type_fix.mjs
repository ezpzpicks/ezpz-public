import fs from "node:fs";

const path = "app/page.tsx";
let text = fs.readFileSync(path, "utf8");
const start = text.indexOf("type AiPickExternalStatus =");
const end = text.indexOf(";", start);
if (start < 0 || end < 0) throw new Error("AiPickExternalStatus union not found");
const block = text.slice(start, end + 1);
if (!block.includes('"NOT_REQUIRED"')) {
  if (!block.includes('  | "REVIEW_ERROR";')) {
    throw new Error("AiPickExternalStatus REVIEW_ERROR marker not found");
  }
  const next = block.replace(
    '  | "REVIEW_ERROR";',
    '  | "NOT_REQUIRED"\n  | "REVIEW_ERROR";',
  );
  text = text.slice(0, start) + next + text.slice(end + 1);
  fs.writeFileSync(path, text, "utf8");
  console.log("Added NOT_REQUIRED to AI external status union for redesigned tile.");
} else {
  console.log("AI external status union already includes NOT_REQUIRED.");
}
