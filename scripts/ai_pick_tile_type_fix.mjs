import fs from "node:fs";

const path = "app/page.tsx";
let text = fs.readFileSync(path, "utf8");
const statusPattern = /type AiPickExternalStatus =\s*(?:\|\s*"[A-Z_]+"\s*)+;/g;
const matches = [...text.matchAll(statusPattern)];
if (!matches.length) throw new Error("AiPickExternalStatus union not found");

const replacement = `type AiPickExternalStatus =
  | "PENDING_FINAL_REVIEW"
  | "WEB_REVIEWED"
  | "NO_VERIFIED_CONTEXT"
  | "NOT_CONFIGURED"
  | "NOT_REQUIRED"
  | "REVIEW_ERROR";`;

text = text.replace(statusPattern, replacement);
fs.writeFileSync(path, text, "utf8");

const remaining = [...text.matchAll(/type AiPickExternalStatus =[\s\S]*?;/g)].map((match) => match[0]);
if (!remaining.length || remaining.some((block) => !block.includes('"NOT_REQUIRED"'))) {
  throw new Error("Failed to force NOT_REQUIRED into every AiPickExternalStatus union");
}
console.log(`Forced NOT_REQUIRED into ${remaining.length} AI external status union(s).`);
