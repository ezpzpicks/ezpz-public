import fs from "node:fs";

const path = "app/page.tsx";
let text = fs.readFileSync(path, "utf8");

// The selector no longer performs a separate final AI/web review. Remove the
// legacy NOT_REQUIRED special-case comparison regardless of formatting. This
// keeps the redesigned tile aligned with deterministic finalization.
text = text.replace(
  /\s*if\s*\(status\s*===\s*"NOT_REQUIRED"\)\s*return\s*"Separate AI\/web review not required";\s*/g,
  "\n",
);
text = text.replace(
  /return\s*"External research is not configured";/g,
  'return "Separate AI/web review not required";',
);

fs.writeFileSync(path, text, "utf8");
console.log("Cleaned obsolete final-review display logic from redesigned AI tile.");
