import fs from "node:fs";

const path = "app/page.tsx";
let text = fs.readFileSync(path, "utf8");

// The selector no longer performs a separate final AI/web review. Remove the
// legacy NOT_REQUIRED special case regardless of formatting and let the helper
// default describe the current deterministic finalization flow.
text = text.replace(
  /\s*if\s*\(status\s*===\s*"NOT_REQUIRED"\)\s*return\s*"Separate AI\/web review not required";\s*/g,
  "\n",
);
text = text.replace(
  /return\s*"External research is not configured";/g,
  'return "Separate AI/web review not required";',
);

fs.writeFileSync(path, text, "utf8");

if (!text.includes('return "Separate AI/web review not required";')) {
  throw new Error("Current no-review status label was not applied");
}
console.log("Removed obsolete final-review status comparison from redesigned AI tile.");
