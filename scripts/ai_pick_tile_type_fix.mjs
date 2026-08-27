import fs from "node:fs";

const path = "app/page.tsx";
let text = fs.readFileSync(path, "utf8");

// The selector no longer performs a separate final AI/web review. Avoid an
// obsolete NOT_REQUIRED comparison in the legacy display helper and make the
// default label describe the current deterministic finalization flow.
text = text.replace(
  '  if (status === "NOT_REQUIRED") return "Separate AI/web review not required";\n',
  "",
);
text = text.replace(
  '  return "External research is not configured";',
  '  return "Separate AI/web review not required";',
);

fs.writeFileSync(path, text, "utf8");

if (text.includes('status === "NOT_REQUIRED"')) {
  throw new Error("Obsolete NOT_REQUIRED status comparison remains in page.tsx");
}
if (!text.includes('return "Separate AI/web review not required";')) {
  throw new Error("Current no-review status label was not applied");
}
console.log("Removed obsolete final-review status comparison from redesigned AI tile.");
