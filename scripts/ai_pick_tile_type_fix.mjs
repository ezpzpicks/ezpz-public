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

// Keep the display helper independently tolerant of NOT_REQUIRED even if an
// earlier build transform narrows the base alias again.
text = text.replace(
  "function aiExternalReviewLabel(status: AiPickExternalStatus) {",
  'function aiExternalReviewLabel(status: AiPickExternalStatus | "NOT_REQUIRED") {',
);

fs.writeFileSync(path, text, "utf8");

if (!text.includes('function aiExternalReviewLabel(status: AiPickExternalStatus | "NOT_REQUIRED") {')) {
  throw new Error("Failed to widen AI external-review display helper");
}
console.log("Forced NOT_REQUIRED support for the redesigned AI tile display.");
