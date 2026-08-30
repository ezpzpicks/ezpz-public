import fs from "node:fs";

const path = "scripts/football_records_parity_patch.mjs";
let text = fs.readFileSync(path, "utf8");

function jsonizeTemplateAssignment(prefix, followingMarker, label) {
  const start = text.indexOf(prefix);
  if (start < 0) return;
  const contentStart = start + prefix.length;
  const following = text.indexOf(followingMarker, contentStart);
  if (following < 0) throw new Error(`${label}: following marker not found`);
  const closing = text.lastIndexOf("`;", following);
  if (closing < contentStart) throw new Error(`${label}: closing template marker not found`);
  const raw = text.slice(contentStart, closing);
  const assignmentPrefix = prefix.slice(0, -1);
  text = text.slice(0, start) + assignmentPrefix + JSON.stringify(raw) + ";" + text.slice(closing + 2);
}

jsonizeTemplateAssignment("  const helpers = `", "\n\n  text = insertBefore(text, \"function decodeHtmlEntities\"", "backend helpers");
jsonizeTemplateAssignment("  const signalType = `", "\n  text = insertBefore(text, \"type FootballData = {\"", "signal type");
jsonizeTemplateAssignment("  const components = `", "\n  text = insertBefore(text, \"function BestPlayCard(\"", "record components");
jsonizeTemplateAssignment("    const replacement = `", "\n    text = replaceBetween(text, recordsStart", "records replacement");
jsonizeTemplateAssignment("  const styles = `", "\n  if (!text.includes('.footballRecordsPage{display:grid'))", "record styles");

fs.writeFileSync(path, text);
console.log("Normalized football records patch code blocks for prebuild execution.");
