import fs from "node:fs";

const path = "lib/footballPublicData.ts";
let text = fs.readFileSync(path, "utf8");

const queryBefore = '  const queries = sport === "NFL" ? ["NFL"] : ["College Football", "NCAAF", "CFB"];';
const queryAfter = '  const queries = sport === "NFL" ? ["42648"] : ["88808", "94682", "212333"];';
if (text.includes(queryBefore)) text = text.replace(queryBefore, queryAfter);
else if (!text.includes(queryAfter)) throw new Error("Could not find football DraftKings event-group query block");

// A later page can contain the football games even when the current page has
// no matches. Only stop when DraftKings actually returns an empty page.
const stopBefore = '        if (!parsed.length || added === 0) break;';
const stopAfter = '        if (!parsed.length) break;';
if (text.includes(stopBefore)) text = text.replace(stopBefore, stopAfter);

// Always parse the final number in a market selection. This prevents team
// names such as "SF 49ers +3" from being interpreted as a 49-point spread.
const lineBefore = `function numericLine(value: unknown) {
  const match = String(value || "").replace(/[−–—]/g, "-").match(/[+-]?\\d+(?:\\.\\d+)?/);
  const number = match ? Number(match[0]) : NaN;
  return Number.isFinite(number) ? number : null;
}`;
const lineAfter = `function numericLine(value: unknown) {
  const matches = String(value || "").replace(/[−–—]/g, "-").match(/[+-]?\\d+(?:\\.\\d+)?/g);
  const raw = matches?.length ? matches[matches.length - 1] : "";
  const number = raw ? Number(raw) : NaN;
  return Number.isFinite(number) ? number : null;
}`;
if (text.includes(lineBefore)) text = text.replace(lineBefore, lineAfter);
else if (!text.includes(lineAfter)) throw new Error("Could not find football numeric-line parser");

// College feeds often shorten names and normalize punctuation differently
// (for example Hawai'i vs Hawaii). Compare a compact form before token overlap.
const teamBefore = `function sameTeam(a: unknown, b: unknown, sport: FootballSport) {
  const left = normalizeTeam(a, sport);
  const right = normalizeTeam(b, sport);
  if (!left || !right) return false;
  if (left === right) return true;
  if (sport === "NFL") return false;
  const l = new Set(left.split(" ").filter((token) => token.length > 2));
  const r = new Set(right.split(" ").filter((token) => token.length > 2));
  const overlap = [...l].filter((token) => r.has(token)).length;
  return overlap >= Math.min(2, Math.max(1, Math.min(l.size, r.size)));
}`;
const teamAfter = `function sameTeam(a: unknown, b: unknown, sport: FootballSport) {
  const left = normalizeTeam(a, sport);
  const right = normalizeTeam(b, sport);
  if (!left || !right) return false;
  if (left === right) return true;
  const compactLeft = left.replace(/\\s+/g, "");
  const compactRight = right.replace(/\\s+/g, "");
  if (sport !== "NFL" && (compactLeft.includes(compactRight) || compactRight.includes(compactLeft))) return true;
  if (sport === "NFL") return false;
  const l = new Set(left.split(" ").filter((token) => token.length > 2));
  const r = new Set(right.split(" ").filter((token) => token.length > 2));
  const overlap = [...l].filter((token) => r.has(token)).length;
  return overlap >= Math.min(2, Math.max(1, Math.min(l.size, r.size)));
}`;
if (text.includes(teamBefore)) text = text.replace(teamBefore, teamAfter);
else if (!text.includes(teamAfter)) throw new Error("Could not find football team matcher");

fs.writeFileSync(path, text);
console.log("patched football DraftKings filters, pagination, line parsing, and team matching");
