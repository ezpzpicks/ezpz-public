import fs from "node:fs";

const path = "lib/footballPublicData.ts";
let text = fs.readFileSync(path, "utf8");

const before = '  const queries = sport === "NFL" ? ["NFL"] : ["College Football", "NCAAF", "CFB"];';
const after = '  const queries = sport === "NFL" ? ["42648"] : ["212333"];';

if (text.includes(after)) {
  console.log("football DraftKings event-group patch already applied");
  process.exit(0);
}

if (!text.includes(before)) {
  throw new Error("Could not find football DraftKings event-group query block");
}

text = text.replace(before, after);
fs.writeFileSync(path, text);
console.log("patched football DraftKings event-group filters");
