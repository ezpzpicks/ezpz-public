import fs from "node:fs";

const path = "app/api/public-data/route.ts";
let text = fs.readFileSync(path, "utf8");
const original = text;

const oldBlock = `  if (!String(candidate.odds || "").trim() || !parseAmericanOdds(candidate.odds)) {
    candidate.protectionReasons.push("Playable odds are missing");
  }
  if ((candidate.market === "Total" || candidate.market === "Pitcher Strikeouts") && !String(candidate.line || "").trim()) {`;

const newBlock = `  const playableOdds = parseAmericanOdds(candidate.odds);
  if (!String(candidate.odds || "").trim() || !playableOdds) {
    candidate.protectionReasons.push("Playable odds are missing");
  } else if (playableOdds < -150) {
    candidate.protectionReasons.push(
      "AI play odds " + playableOdds + " exceed the -150 maximum price",
    );
    candidate.dataStatus.push("AI odds cap: -150 maximum");
  }
  if ((candidate.market === "Total" || candidate.market === "Pitcher Strikeouts") && !String(candidate.line || "").trim()) {`;

if (text.includes(oldBlock)) {
  text = text.replace(oldBlock, newBlock);
} else if (!text.includes(newBlock)) {
  throw new Error("AI max-odds protection target not found");
}

if (text !== original) {
  fs.writeFileSync(path, text, "utf8");
  console.log("Applied AI Pick maximum odds cap of -150.");
} else {
  console.log("AI Pick maximum odds cap already applied.");
}
